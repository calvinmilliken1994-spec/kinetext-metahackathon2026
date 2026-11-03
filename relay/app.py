"""Modal wiring for the judge relay (docs/specs/STAGE-11-judge-relay.md). All logic lives in relay_core.py.

Deploy:   modal deploy relay/app.py
Pause:    modal run relay/app.py::pause
Resume:   modal run relay/app.py::resume
Report:   modal run relay/app.py::report
Stop all: modal app stop mki-relay -y

Nothing here prints an access code or a key.
"""
import os
import sys

import modal

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

APP_NAME = "mki-relay"
SECRET_NAME = "mki-relay"
STATE_NAME = "mki-relay-state"

# Same pins the tests ran with (relay/requirements.txt).
image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install("fastapi==0.162.0", "httpx==0.28.1")
    .add_local_python_source("relay_core")
)

app = modal.App(APP_NAME, image=image)
state = modal.Dict.from_name(STATE_NAME, create_if_missing=True)
secret = modal.Secret.from_name(SECRET_NAME)
# Optional Discord pings (DISCORD_WEBHOOK_URL), kept apart so the main Secret never has to be rewritten:
#   modal secret create mki-relay-discord --from-json <file with {"DISCORD_WEBHOOK_URL": "..."}>
discord = modal.Secret.from_name("mki-relay-discord")


# One container only (REQUIRED): the lock that serialises the spentUSD read-modify-write and the rate limiter live in this
# process; spend itself is durable in the Dict (estimate persisted before forwarding), but nothing fences a second
# container. Do not raise max_containers without adding cross-process locking. Up to 8 requests in flight (async I/O).
# timeout > the 600 s upstream timeout; Modal answers callers with a 303 to a result URL after 150 s of waiting.
@app.function(max_containers=1, timeout=900, secrets=[secret, discord])
@modal.concurrent(max_inputs=8)
@modal.asgi_app(label=APP_NAME)
def web():
    import relay_core  # imported here: the local CLI process does not need fastapi/httpx

    settings = relay_core.Settings.from_env(os.environ)  # raises (naming the variable only) if the Secret is incomplete
    return relay_core.create_app(state, None, settings)


@app.function(secrets=[secret])
def report_remote() -> dict:
    """Runs remotely only because CAP_USD lives in the Secret; returns numbers, never codes or keys."""
    try:
        cap = float(os.environ.get("CAP_USD", "").strip() or 50)
    except ValueError:
        cap = float("nan")
    return {
        "capUSD": cap,
        "spentUSD": float(state.get("spentUSD", 0.0)),
        "enabled": state.get("enabled", True) is True,
    }


@app.local_entrypoint()
def pause():
    """Kill switch: every forwarding route answers 503 RELAY_PAUSED on its next request."""
    state.put("enabled", False)
    print("relay paused (enabled=False)")


@app.local_entrypoint()
def resume():
    state.put("enabled", True)
    print("relay resumed (enabled=True)")


@app.local_entrypoint()
def report():
    r = report_remote.remote()
    cap, spent = r["capUSD"], r["spentUSD"]
    print(f"spent ${spent:.2f} of ${cap:.2f} cap (${max(0.0, cap - spent):.2f} left)")
    print(f"enabled: {r['enabled']}")
