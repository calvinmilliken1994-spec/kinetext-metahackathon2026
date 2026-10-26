# Git workflow

## Branches
| Branch | Purpose |
|---|---|
| `main` | Stable integration branch. Lead (Opus 5.5) owns merges. Tests must pass on every merge. |
| `feature/<task-id>-<description>` | Implementation work, e.g. `feature/T3-forces-component`. |
| `fix/<task-id>-<description>` | Bug fixes, e.g. `fix/T3-slider-clamp`. |
| `experiment/<description>` | Isolated spikes; never merged without review and a task record. |

Task IDs come from `docs/TASKS.md`.

## Parallel agents and worktrees
- One writer per file. Ownership, branch and worktree are recorded in `docs/TASKS.md` before work starts (see `docs/AGENT_ROLES.md`).
- No parallel implementation until schema, interfaces and ownership are frozen.
- Create worktrees outside the repo:
  ```
  git status --short --branch
  git worktree add ../meta-hackathon-worktrees/<task-id> -b feature/<task-id>-<description>
  ```
- Shared manifests, lockfile and `schemas/` belong to the lead; request integration rather than editing them concurrently.
- Never stash, drop, reset or delete another agent's work. Inspect dirty state before any branch operation.
- Worktrees are not execution sandboxes.

## Integration
1. Owner reports changed files and real test evidence.
2. `npm test` (and Python tests where relevant) rerun by the lead on the branch.
3. Independent review: Anthropic/OpenAI for Meta-authored code; OpenAI for Opus-authored code.
4. Serial merge into `main`, then rerun integration tests.
5. Record the merge in `docs/REPOSITORY_LOG.md`.

## Commits
Conventional prefixes (`feat:`, `fix:`, `docs:`, `test:`, `chore:`). Note the authoring model/agent in the commit body for anything substantial, to support the Meta contribution ledger and event-origin provenance.

## Remote and publication
- Remote: `https://github.com/calvinmilliken1994-spec/meta-hackathon-2026` — **public** for the whole event, so every push is a publication.
- Commit only project files; run the `SECURITY.md` pre-commit checklist before every push.
- No push, visibility change, force-push, history rewrite or deployment without Calvin's explicit approval.
