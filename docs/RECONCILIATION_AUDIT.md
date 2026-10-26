# Configuration reconciliation audit — 2026-10-27 KST (partial)

Lead: Anthropic Opus 5.5. Trigger: master execution prompt (attachment `pasted_content_2026-10-26_20-52-30-876_cf345c.txt`). Read-only audit; no config, SOUL.md or user-authored files changed. Run was cut short by the profile's 180 s run budget — items marked *not yet checked* remain open.

| Item | Finding | Class |
|---|---|---|
| Git | `main`, clean, ahead of `origin/main` by 1 (`b5f25da` unpushed); no worktrees | VERIFIED |
| Baseline tests | `npm test` 2/2 pass; Python unittest 2/2 pass; Node v24.14.1 | VERIFIED |
| Profile default | `anthropic / claude-opus-5-5`; reasoning high (agent, delegation, all auxiliary slots) | VERIFIED (config readback) |
| Aliases | orchestrator, complex-frontend `claude-sonnet-5-5`, routine-tests `deepseek-v4.1-flash-1017`, qwen-backend `qwen3.8-max`, qwen-docs `qwen3.8-flash`, meta-generation/meta-repair `muse-spark-1.3`, openai-review `gpt-6.1-sol` | VERIFIED — matches master prompt routing table |
| Fallback providers | `[]` | VERIFIED |
| Muse Wonder | Master prompt: restricted, excluded, no further checks. SOUL.md, AGENTS.md, skill, PROFILE_ACTIVATION: "permitted subject to account access". Alias `meta-wonder-candidate` still configured. | CONFLICTING — latest user directive (exclude) applied operationally; SOUL.md not edited; user decision requested |
| `agent.run_budget_seconds: 180` | Caps each turn at 3 min; truncated this audit. **Unset (unlimited) by user instruction 2026-10-27** via `hermes config unset`; readback `null`. Takes effect from the next turn. | RESOLVED |
| Long-run limits (user instruction 2026-10-27: lift all) | `agent.max_turns` 80 → null (unlimited); `agent.run_budget_seconds` unset; `delegation.max_iterations` 1000; `delegation.child_timeout_seconds` 0 (none); `delegation.oneshot_max_children` 0 (unlimited). Kept: `delegation.max_concurrent_children: 1` (project no-parallel gate, a concurrency limit, not a duration limit). The 180 s budget still fired in the session that made the change, so it was evidently loaded at session start; verify in a fresh session. | RESOLVED pending fresh-session check |
| Participant guide search | Guide supplied by Calvin 2026-10-27 06:02 KST, stored privately at `docs/official/PARTICIPANT_GUIDE.md` (gitignored). Judging weights in master prompt match §8 | RESOLVED |
| `delegation.max_concurrent_children: 1` | Consistent with no-parallel gate | VERIFIED |
| `docs/MODEL_ROUTING.md` body | Still names OpenAI as orchestrator, Qwen as logged out, Meta key absent, Wonder "excluded by docs" | OUTDATED (header note marks it superseded) |
| `docs/PROVIDER_USAGE.md` rows | Meta key "absent", Alibaba "logged out" | OUTDATED (header note) |
| `docs/META_CONTRIBUTIONS.md` row | `MODEL_API_KEY_MISSING` smoke — historical | OUTDATED, retained as history |
| `docs/SPRINT_PLAN.md` | Ten-day relative plan; master prompt now requires milestone gates without dates | OUTDATED — to be replaced by Stage 0–9 roadmap |
| `docs/HACKATHON_RULES.md` | Rewritten 2026-10-27 from the official guide with § citations: deadline Nov 4 9 PM ET (= Nov 5 11:00 KST), public repo, new-work-only, 3-min video, anti-project list incl. "simple AI for Education chatbots", Baseten ID `meta-models/muse-spark-open-1026`. Setup commits predate the Oct 27 ET building-period start by hours — recorded as setup scaffold | RESOLVED |
| SOUL.md opening line | "You are Hermes Agent…" | VERIFIED, untouched |
| Obsidian | Vault created 2026-10-27 at `C:/projects/meta-hackathon/obsidian-vault` (gitignored, private): 8 folders, 37 notes incl. Project Home dashboard, Roadmap, Current Milestone, Sprint Board, Issue Register, session summary. `obsidian.json` not edited — Calvin opens the folder as a vault | RESOLVED pending user opening it |
| Credits / metered budget | **RESOLVED 2026-10-27:** user screenshot shows USD 150 Meta free credits in use, balance £0.00. Approved cap USD 150 (Meta only). Free-credit content may be used for product improvement → public/synthetic inputs only. Smoke key-format check was wrong (expected `LLM\|id\|…`, issued keys are `LLM_…`); fixed test-first. Direct API smoke then passed: `muse-spark-1.3`, 3.1 s, est. USD 0.00018 | RESOLVED |
| Baseten `muse-spark-open-1026` | Unvalidated; no key | UNVERIFIED |
