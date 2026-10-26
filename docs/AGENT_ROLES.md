# Agent roles and ownership

All roles inherit `AGENTS.md` and the addendum. No implementation agents have been started.

| Role | Route preference | Owned paths | Acceptance gate |
|---|---|---|---|
| Lead / contract owner | Anthropic Opus 5.5, OpenAI secondary | schemas/, docs/, package manifests | Freeze interfaces, resolve scope and budget; integration ownership |
| Meta integration engineer | Muse Spark / Muse Code | packages/meta/, workers/generation/meta-* | Actual bounded tool calls + receipts; independent non-Meta review |
| Source understanding engineer | Muse Spark | packages/meta/source-* | Licensed PDF/image interpreted with source-linked evidence |
| Activity / repair engineer | Muse Spark | packages/meta/planning-*, packages/meta/repair-* | Valid structured spec; bounded real repair; no raw eval |
| Frontend engineer | Anthropic Sonnet 5.5 (claude-sonnet-5-5), High; OpenAI secondary | apps/web/ | Real journey + accessibility + browser verification |
| Backend / deterministic engine | Qwen, Anthropic secondary | workers/generation/ excluding meta-*, packages/activities/, packages/validation/ | Deterministic physics and failure gating tests |
| Test/documentation engineer | Tests: Alibaba deepseek-v4.1-flash-1017, High; docs: Qwen Flash, High; OpenAI secondary | tests/ (claim files first), docs/ (lead approval) | Executed evidence; no fabricated fixtures labeled as model output |
| Independent reviewer | Anthropic, OpenAI secondary | read-only initially | Security, correctness, grounding, budget/sandbox review |

## Ownership protocol
Before assignment record task ID, owner, exact files, parent dependencies, branch/worktree, contract version, acceptance tests, and review owner in `docs/TASKS.md`. One writer per file. Shared manifests/schema/lockfile belong to lead; request lead integration instead of simultaneous editing. Agents report evidence and changed files; lead verifies claims.

## Worktrees
Local repo only; no remote publication is authorized. Lead retains main. After initial setup commit and approval, use `git status --short --branch` then `git worktree add ../meta-hackathon-worktrees/<task-id> -b task/<task-id>` from the project root. Each role has one worktree/branch and no shared mutable build output. Inspect all dirty state before branch operations; never stash/drop/delete another agent's work. Merge/review serially, then rerun integration tests. Worktrees are not execution sandboxes.

## Explicit route pin examples (do not auto-execute)
> **2026-10-27 — building uses subscriptions only** (`RESOURCE_POLICY.md` § Usage split). Launch workers by alias, e.g. `hermes -p meta-hackathon-2026 chat -m qwen-backend --reasoning high -q "<task>"`; aliases `qwen-backend`, `routine-tests` and `qwen-docs` pin the Alibaba Token Plan endpoint and key. **Do not use `--provider alibaba`**: it targets the DashScope pay-as-you-go endpoint (the Token Plan key 401s there, so it fails rather than bills, but it is the wrong route). Never use `--provider meta-ai` for building: it bills the participant credits. The `meta-generation`/`meta-repair` aliases were removed for that reason. The examples below predate this note.

Every explicit worker launch must use High reasoning: Hermes `--reasoning high`; Muse `--reasoning-effort high`. Profile defaults and delegate overrides are also High. Routine-test workers pin `--provider alibaba -m deepseek-v4.1-flash-1017 --reasoning high`; frontend workers pin `--provider anthropic -m claude-sonnet-5-5 --reasoning high`.
Run from assigned worktree; profile supplies project rules and local credential discovery:
- Lead: `hermes -p meta-hackathon-2026 chat --provider anthropic -m claude-opus-5-5 -q "<task>"`.
- Qwen: same command with `--provider alibaba -m qwen3.8-flash` or `qwen3.8-max`, only after credential/billing validation.
- Anthropic: select exact live-account-validated ID first (fallback cache is insufficient).
- Meta subscription: load `muse-subscription` skill and invoke `python scripts/muse-subscription.py --model muse-wonder-1.0` (fixed smoke) or `--model muse-spark-1.3 --prompt-file <file>` for authorized bounded text-in/text-out work. This routes through the logged-in CLI, not PAYG. Wonder currently returns 404; never silently switch it to Spark. Separate direct product API route uses the built-in `meta-ai` provider and project API key, with independent billing approval.

Do not rely on `delegate_task` for different per-task providers when its schema does not expose that routing. No worker profiles or unattended dispatchers are configured in this checkpoint.
