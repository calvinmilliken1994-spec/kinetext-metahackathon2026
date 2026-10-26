# Security policy

Project: **Make knowledge interactive.** (product name provisional) — Meta AI Developer Hackathon 2026 entry. Early-stage hackathon code; no production deployment exists.

## Reporting a vulnerability

Please do **not** open a public issue for security problems. Use GitHub's private vulnerability reporting on this repository (Security tab → "Report a vulnerability"). If that is unavailable, open a minimal public issue asking for a private contact channel, without technical details. Expect a best-effort response during the hackathon period.

In scope: credential exposure, injection through uploaded source material (prompt injection, SSRF, path traversal), unsafe execution of generated activity code, client-side key leakage, and budget/limit bypass in model-calling code.

## Credential handling

- Real credentials (`MODEL_API_KEY`, partner keys, tokens) are never committed. They live only in ignored `.env.local` files, the Hermes profile secret store, or server-side process environment.
- `.env.example` contains placeholder names only. Copy it to `.env.local` and fill values locally.
- Keys must never reach browser bundles, generated activity code, agent logs, or public evidence receipts. Receipts in `docs/evidence/` are sanitized: model IDs, status codes, timing and usage only.
- Approved metered spend defaults to USD 0 (`docs/RESOURCE_POLICY.md`); positive budgets require explicit human approval.
- If a secret is ever committed: revoke/rotate it at the provider **first**, then remove it from history. Deleting it in a later commit is not enough; history rewriting requires maintainer approval.

## Pre-commit checklist

1. `git status` and `git diff --cached` reviewed.
2. `git check-ignore -v <path>` confirms that env files, uploads and runtime state are ignored.
3. Staged content scanned for keys, tokens, passwords and personal data.
4. No copyrighted textbook uploads, private student material, or unlicensed assets staged.
5. `.gitignore` does not untrack files already committed; use `git rm --cached` (with review) for those.

## Untrusted input

Uploaded educational material is treated as data, never as instructions. Generated activity code is not executed until real process/container isolation with no network and resource limits exists; v0.1 permits only allowlisted, tested activity components. An iframe alone is not a server-side sandbox.
