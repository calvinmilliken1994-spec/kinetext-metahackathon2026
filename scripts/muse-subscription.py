"""Bounded Hermes -> logged-in Muse CLI subscription delegation.

This is a CLI delegation route, not a native Hermes inference-provider adapter.
No browser/OAuth token is exported or copied. No API-key/PAYG fallback.
"""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone

API_OVERRIDES = {'META_API_KEY', 'MODEL_API_KEY', 'META_MODEL_API_KEY', 'META_BASE_URL'}
MODELS = ('muse-wonder-1.0', 'muse-spark-1.3')


def subscription_env(env):
    return {k: v for k, v in env.items() if k not in API_OVERRIDES}


def command(exe, model, prompt_file, workspace, mode):
    return [str(exe), 'exec', '--json', '--preset', 'empty', '--model', model,
            '--contributor-mode', mode, '--workspace', str(workspace),
            '--reasoning-effort', 'high', '--max-model-steps', '1',
            '--disable-reminders', '--disable-web-tools', '--disable-request-user-input',
            '--no-foreign-personal-context', '--disable-write', '--disable-shell',
            '--approval-judge', 'off', '--no-session-log', '--prompt-file', str(prompt_file)]


def confirmed_model(usage, model):
    used = {entry.get('model') for entry in usage.get('models', []) if entry.get('calls', 0) > 0}
    return used == {model} and usage.get('completed_calls', 0) > 0


def locate_muse():
    # Use the installer's active version marker; do not select a guessed version.
    root = Path.home() / 'AppData/Local/Programs/muse'
    version = (root / '.muse-version').read_text(encoding='utf-8').strip()
    if not version or any(c in version for c in '/\\\r\n'):
        raise RuntimeError('INVALID_MUSE_VERSION_MARKER')
    exe = root / ('muse-bin-' + version + '.exe')
    if not exe.is_file():
        raise RuntimeError('MUSE_EXECUTABLE_NOT_FOUND')
    return exe


def timeout_seconds(value):
    """Wall-clock deadline for one bridge run: default 90 s, bounded to 30..600 s."""
    if value is None:
        return 90
    if not 30 <= value <= 600:
        raise ValueError('TIMEOUT_OUT_OF_RANGE')
    return value


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model', choices=MODELS, default='muse-wonder-1.0')
    parser.add_argument('--prompt-file', type=Path)
    parser.add_argument('--contributor-mode', choices=('on', 'off'), default='off')
    parser.add_argument('--receipt', type=Path)
    parser.add_argument('--timeout-seconds', type=int, help='Deadline in seconds (30-600, default 90)')
    args = parser.parse_args()
    try:
        deadline = timeout_seconds(args.timeout_seconds)
    except ValueError:
        parser.error('--timeout-seconds must be between 30 and 600')
    if args.contributor_mode == 'on' and args.prompt_file:
        parser.error('Contributor-mode route is limited to the fixed non-private smoke prompt')
    started = time.monotonic()
    report = {'status': 'failed', 'route': 'hermes-to-muse-cli-subscription',
              'requestedModel': args.model, 'contributorMode': args.contributor_mode,
              'checkedAt': datetime.now(timezone.utc).isoformat(), 'fallbackUsed': False,
              'maxModelSteps': 1, 'timeoutSeconds': deadline}
    try:
        # Read only credential metadata. Never print/copy the token or key.
        config_home = Path(os.environ.get('XDG_CONFIG_HOME', str(Path.home() / '.config')))
        auth = json.loads((config_home / 'muse/auth.json').read_text(encoding='utf-8'))
        meta = auth.get('providers', {}).get('meta', {})
        if meta.get('mechanism') != 'oauth' or not meta.get('subs_active'):
            raise RuntimeError('LOGGED_IN_MUSE_SUBSCRIPTION_REQUIRED')
        exe = locate_muse()
        env = subscription_env(os.environ)
        home = Path(os.environ.get('HERMES_HOME', str(Path.home() / 'AppData/Local/hermes')))
        scratch = home / 'cache/scratch'
        scratch.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='muse-subscription-', dir=scratch) as temp:
            work = Path(temp)
            allowance = subprocess.run([str(exe), 'usage', '--json'], capture_output=True,
                                       text=True, encoding='utf-8', errors='replace',
                                       env=env, cwd=work, timeout=20)
            allowance_data = json.loads(allowance.stdout).get('allowance') if allowance.returncode == 0 else None
            if not allowance_data or not allowance_data.get('tier'):
                raise RuntimeError('SUBSCRIPTION_ALLOWANCE_NOT_VERIFIED')
            report['subscriptionTier'] = allowance_data['tier']
            report['allowanceBefore'] = allowance_data
            prompt = work / 'prompt.txt'
            prompt.write_text(args.prompt_file.read_text(encoding='utf-8') if args.prompt_file else
                              'Reply with exactly: MUSE_SUBSCRIPTION_OK. Do not use tools.', encoding='utf-8')
            result = subprocess.run(command(exe, args.model, prompt, work, args.contributor_mode),
                                    capture_output=True, text=True, encoding='utf-8', errors='replace',
                                    env=env, cwd=work, timeout=max(1, deadline-(time.monotonic()-started)))
            report['exitCode'] = result.returncode
            terminal = None
            statuses = []
            for line in result.stdout.splitlines():
                try:
                    event = json.loads(line)
                except json.JSONDecodeError:
                    continue
                payload = event.get('payload', {})
                if event.get('payload_type') == 'run.model.configured':
                    report['configuredModel'] = payload.get('model_id')
                if event.get('payload_type') == 'run.usage':
                    report['usage'] = payload
                if payload.get('kind') == 'run_terminal':
                    terminal = payload
                details = payload.get('event', {}).get('details', {})
                for facet in details.get('facets', []):
                    if 'http_status' in facet:
                        statuses.append(facet['http_status'])
            report['httpStatuses'] = statuses
            if terminal:
                report['terminal'] = terminal.get('terminal')
                report['answer'] = terminal.get('text', '')
                report['reason'] = terminal.get('reason')
            complete = bool(terminal and terminal.get('terminal') == 'completed')
            if (result.returncode == 0 and complete and report.get('configuredModel') == args.model
                    and confirmed_model(report.get('usage', {}), args.model)):
                report['status'] = 'passed'
                if not args.prompt_file and report.get('answer', '').strip() != 'MUSE_SUBSCRIPTION_OK':
                    report['status'] = 'failed'
                    report['reason'] = 'SMOKE_OUTPUT_MISMATCH'
            elif not terminal:
                report['reason'] = 'CLI_FAILED_WITHOUT_TERMINAL_EVENT'
    except subprocess.TimeoutExpired:
        report['reason'] = 'CLI_TIME_BUDGET_EXCEEDED'
    except (OSError, ValueError, RuntimeError) as error:
        report['reason'] = str(error) if isinstance(error, RuntimeError) else type(error).__name__
    report['elapsedSeconds'] = round(time.monotonic()-started, 3)
    if args.receipt:
        args.receipt.parent.mkdir(parents=True, exist_ok=True)
        args.receipt.write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report, indent=2))
    return 0 if report['status'] == 'passed' else 1


if __name__ == '__main__':
    sys.exit(main())
