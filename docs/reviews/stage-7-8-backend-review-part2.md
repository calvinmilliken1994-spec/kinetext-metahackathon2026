# Stage 7–8 backend review — part 2

Reviewer: Claude Opus 5.5 (Anthropic). Independent of the authors (Qwen 3.8 Max, Muse Spark / Meta).
Continues `stage-7-8-backend-review.md` (part 1, GPT-6.1 Sol, cut short by quota). Part 1 findings B-01..B-12 and its deployment notes 1–8 are not repeated here.

Reviewed tree: HEAD `f1a11f0`. Scope, in priority order:
1. API surface for the Render deployment (`apps/api/server.ts`, `main.ts`, `model-clients.ts`).
2. Worker job lifecycle (`workers/generation/jobs.ts`, `lesson.ts`).
3. Prompt-injection boundaries (`packages/meta/prompts-v2.ts`, `pipeline-v2.ts`, `packages/sources/*`).
4. Stage 7 backend (`c2c849a^..18aac62` in packages, workers, apps/api).
5. `packages/kit-engines/*` numeric edge cases.
Plus: run the B-08 regression recipe from part 1.

Status: complete (about 50 minutes of the 75-minute box). Five findings: two high/medium deployment blockers, one medium policy gap, two low. B-08 from part 1 was executed and is confirmed.

## Findings

| ID | Severity | File:line | Finding | Evidence | Suggested fix |
|---|---|---|---|---|---|
| B2-01 | medium (deploy) | `workers/generation/jobs.ts:1599-1605`; `apps/api/main.ts:186-192` | **Jobs cut off by a restart can stay "running" forever in a container.** Recovery trusts the recorded owner PID. In a container the new process usually gets the same PID as the old one (often PID 1). Then `pid === process.pid` returns "not abandoned", or the PID belongs to a live process. The SIGTERM handler exits at once and does not mark running jobs, and Render sends SIGTERM on every deploy. The killed job's open reservations also stay held at their worst-case amount in the ledger for good (`ledger.ts:265`), so each cut-off job eats a little of the judging cap. | Scratch `recovery-probe.mjs` over a scratch storage dir: a running job whose owner PID equals the recovering process's PID stays `running`; a dead PID is recovered. | Add a per-process boot id (random UUID) to `owner`. On startup, with one writer per disk, treat every running job with a different boot id as abandoned. On SIGTERM, stop admitting jobs, abort running ones and write them as `INTERRUPTED` before exit. Disclose that held reservations are not refunded. |
| B2-02 | low | `apps/api/server.ts:390,460,523` | **A bad percent-escape in a path returns 500.** `decodeURIComponent` throws `URIError`; the outer catch answers `500 INTERNAL`. Harmless, but it shows up as server errors in public logs and monitors. | GET on the read-only API: `/api/jobs/%E0%A4%A`, `/api/sources/%`, `/api/figures/%zz` all return `500 {"error":"INTERNAL"}`. | Wrap the three decodes in try/catch and answer `404 NOT_FOUND`. |
| B2-03 | medium | `packages/validation/kit/shared.ts:650-681,731-748` | **The narrowed publisher sweep misses the full NASA name and common endorsement words.** For the NASA Glenn page the token set is only `nasa` and `nasa glenn research center`. The attribution never spells out "National Aeronautics and Space Administration", so that name is not a token, though the docstring says the full publisher name is matched. The generic words match only as exact words: `endorsed` and `official` are caught, `endorses`, `endorsement`, `officially` and `approved by` are not. NASA's media rules forbid implied endorsement, so this is the one publisher where a miss matters. | Scratch `publisher-probe.mjs` with the real `nasa-grc-ballistic-flight-equations.json` metadata: "Approved by the National Aeronautics and Space Administration.", "The agency endorses this lesson.", "This lesson has the endorsement of the agency.", "This lesson is officially approved." and "Per N.A.S.A., ..." all return no hit; "According to NASA", "NASA says" and "endorsed by" are caught. | Add a small fixed table of acronym expansions for the library's publishers (NASA, NOAA, USGS, NARA ...) and match word stems `endors*`, `official*` and `approved by`. Replay the change on stored published outputs before adopting it (the narrowing exists because the wider rule degraded true page text). If not fixed, keep the visible "AI-generated, not reviewed by the publisher" label on every NASA lesson. |
| B2-04 | low | `packages/kit-engines/table.ts:11`; `packages/kit-engines/threshold.ts:17-31`; `packages/validation/kit/threshold.ts:185-200`; `apps/web/src/lib/logLadderView.ts:87-99` | **Three numeric edge cases a validated spec can still reach.** (a) `parseTableNumber` treats U+FF26 (fullwidth capital F) and U+FF3F (fullwidth low line) as minus signs, so "Ｆ5" parses as -5. The real fullwidth hyphen-minus U+FF0D and U+FE63 are not recognised, so "－5" is null. This looks like a code-point slip. (b) A fraction rule with numerator above denominator passes the validator (only positive integers are required). 5/4 of 10 needs 13, so the stage can never pass and the view shows an impossible vote. (c) The ladder view builds one step object per whole unit between case values. The factor floor 1.000001 with the 1e12 ratio cap allows a gap of about 27.6 million units, so a valid case would build up to 27.6 million objects per case in the browser. This needs a page (or pasted text) that states such a factor. | Scratch `engine-probe.mjs` (results JSON beside it) and a one-line `parseTableNumber` probe: "Ｆ5" → -5, "＿12" → -12, "－5" → null; `requiredCount` 5/4 of 10 → 13 and `stagePasses(…, 10)` → false; `ladderSteps(1.000001, 0, 2e6)` returned 2,000,000 steps in 650 ms. | (a) Replace U+FF26/U+FF3F with U+FF0D/U+FE63 and share one sign grammar with grounding (see part 1 B-04). (b) Reject numerator > denominator in TH (or require the fraction to be at most 1). (c) Cap whole steps in the view (for example 50) and show a summary step beyond that, or require factor ≥ 1.01 in the contract. |
| B2-05 | high (deploy) | `apps/api/server.ts:383-385,544-599`; `packages/sources/index.ts:99` | **Read-only mode still accepts pasted sources and serves them back to anyone.** `POST /api/sources` never checks `startJob`, so it writes to disk even when live generation is off. Any client without an Origin header passes `originAllowed`. Each stored text is then listed by `GET /api/sources` and served in full by `GET /api/sources/:id`, so the public site becomes an open text host under our domain. The store holds at most 200 sources (`MAX_USER_SOURCES`); after 200 junk posts every judge paste gets `409 SOURCE_LIMIT`. Part 1 asked to gate writes in general; this is the concrete hole in the planned read-only mode. | Static read of the route, plus `node --test --test-name-pattern="POST /api/sources stores a teacher source" apps/api/server.stage5.test.ts` (1 pass): the test stores a source with `startJob: null`, the read-only configuration. No POST was sent to the running API. | Refuse `POST /api/sources` with `503 LIVE_DISABLED` when live generation is off, and require the server-side access code otherwise. Count the 200 limit per access code, or keep pasted sources out of the shared store. Never list or serve pasted sources (or their job details, which quote the text) without the code. |

## B-08 recipe result

Run: scratch `b08-recipe.test.ts` = the helpers of `lesson.label-diagram.test.ts` (fake Muse client, fake SAM fetch, real DNA figure and source) plus a fake ledger whose `reserve` succeeds and whose `reconcile` always throws. Job storage in a scratch temp dir. No network, no real ledger.

| Case | Job | Label part | Segment event | `totalCostUSD` | `reservedUnknownUSD` | Expected unknown |
|---|---|---|---|---|---|---|
| SAM HTTP 400 | succeeded, partial publish (1 of 2) | failed, no repair call | `LEDGER_ERROR` | 0.03 | **0** | 0.0025 |
| SAM HTTP 500 (control) | succeeded, partial publish (1 of 2) | failed, no repair call | `LEDGER_ERROR` | 0.03 | 0.0025 | 0.0025 |

**B-08 is confirmed.** On a 4xx, sam.ts tries to reconcile 0 (`sam.ts:281`). The worker wrapper adds `max(0, actual.costUSD)` = 0 to `trace.unknown` (`lesson.ts:1230`), and `errorCharge` gets a bare `LEDGER_ERROR`. The job records no liability while the real ledger keeps the $0.0025 hold. A second, smaller effect shows in the 500 control: the unknown $0.0025 is not added to `totalCostUSD` (0.03, against 0.0325 when reconcile works), so unknown is no longer part of the total. Fix as part 1 says: in the wrapper, remember the reserved `estUSD` per reservation id, and when reconcile throws add that amount to both `unknown` and `charged`, whatever the attempted actual amount was.

## Verified correct

### Executed

- `npx --no-install tsc -p . --noEmit`: exit 0 on HEAD `f1a11f0`.
- Lifecycle and API tests, none using a real ledger (checked with grep for `openLedger` / `ledger.jsonl`): `jobs.test.ts`, `jobs.model.test.ts`, `lesson.truncated-output.test.ts`, `lesson.bug006.test.ts`, `server.lesson.test.ts`, `server.concurrency.test.ts`, `model-clients.test.ts`: **66 pass, 0 fail**.
- Pure tests: `packages/kit-engines/*.test.ts`, `packages/meta/prompts-v2.test.ts`, `packages/sources/*.test.ts`: **83 pass, 0 fail**.
- One named test from `server.stage5.test.ts` (B2-05 evidence): 1 pass.
- Scratch probes: `b08-recipe.test.ts` (2 cases, 400 case fails the B-08 invariant as expected), `recovery-probe.mjs`, `publisher-probe.mjs`, `engine-probe.mjs`. All temp job dirs were inside the profile scratch folder.
- GET-only checks on the read-only API at :8787: `/api/health` reports `live:false`; a foreign `Host` gets `403 HOST_NOT_ALLOWED`; `..%5C` traversal attempts on sources and jobs get 404; the job list (724 jobs) answers in about 0.17 s.

### Confirmed by reading

- **Error bodies.** Every API error is a fixed code (`{"error":"..."}`), never exception or provider text. `SOURCE_INVALID` returns the contract's fixed problem codes only. B2-02 is the only 500 found from client input.
- **Cross-site posts.** POST routes require `content-type: application/json`, and the server answers no CORS preflight, so a browser on another site cannot send a JSON POST. An `Origin: null` fails the Origin check. Non-browser clients are not stopped (part 1 note 1).
- **Body limits.** 10 KB for jobs and 64 KB for sources, enforced on the declared length and on the streamed bytes.
- **Path ids.** Job ids must match `^[a-z0-9-]{1,80}$`; library and user source ids are checked before any file read; figure ids are bare store ids.
- **Secrets.** `MODEL_API_KEY` and `MODAL_PROXY_TOKEN` are read server-side only. Health and models routes report booleans only. A missing or malformed Modal token fails the job with a fixed code before any reservation.
- **Deadline handling.** The Muse client checks the job signal before every reservation, so components that start after the deadline fail with the plain timeout reason at no cost. The 60 s repair guard and the timeout/network partial-publish paths (22c2982, ba79bdc) account the charge at the catch before the event write. A fatal component error (`RATE_LIMITED`, `SERVER_ERROR`) still fails the whole job by design.
- **Persistence ordering.** Artifacts are written with an atomic rename; `lesson.json` and `job.json` are rewritten after each settled component; `readJob` skips a half-written event line. Recovery never refunds a cost.
- **Prompt boundaries.** Source text sits inside a boundary derived from the text's own SHA-256, so the text cannot contain its closing tag. Metadata, analysis, plan entry, previous specs and findings are JSON with `<` escaped. The only model-derived values in a system prompt are `analysis.subject` (schema enum) and the component id (allowlist). Repair `authorizedPaths` come from validator output only; the `figureId` line uses the trusted store id. Pasted text cannot change instructions, authorized paths or figure ids through the prompt structure; what Muse writes is still policed only by the validators.
- **Browser output.** The web app has no `innerHTML`; model text passes through `cleanDisplayText`, which removes control, zero-width and bidi override characters. The backend plain-text check covers only C0 controls, so it relies on that display sanitiser.
- **Stage 7 backend.** `semantic.opening-case` checks every slider default against `predictions[0]` and unlocks only the `/simulation/<input>/default` paths. Teacher-page subjects are read-only from run files and enum-checked (they come from the newest run's highest analysis revision, even an unpublishable one; cosmetic).

## Could not verify

- **Brief range.** `git diff c2c849a^ 18aac62` is empty: 18aac62 is an ancestor of c2c849a. I reviewed the Stage 7 backend commits from `git log c2c849a^..HEAD -- packages workers apps/api` (8320337, e3eeb75, e2a27c7, e2af2ed, 2a4d675, ebceb01) instead.
- No POST, live call, real ledger, `storage/` file or `.env` was touched. B2-05 is shown with the repository's own test, not against the running server.
- B2-01 assumes the usual container PID behaviour. I did not run a container. The probe shows the same-PID and live-PID branches of the code.
- B2-03 shows wordings the narrowed rule misses. I did not replay a wider rule on stored outputs; that replay is required before any change.
- B2-04 (c) is measured in Node, not in a browser. No stored lesson was found with such a factor; it needs a crafted page.
- Not reviewed in depth: `algorithms.ts` (part 1 ran 1,400 stress cases), the v1 activity flow and `pipeline-v2.ts` beyond the prompt and authority boundaries.

## Deployment must-change checklist

Part 1 notes 1–8 still apply (server-side access code, public bind and HTTPS origins, one combined $25 budget, one writer per disk, runtime kill switch, paste privacy, trusted figure store, narrowed trust claims). Added by this part:

1. **Gate `POST /api/sources`** like `POST /api/jobs`: refuse when live is off, require the access code, and do not let anonymous posts fill the 200-source store (B2-05).
2. **Hide pasted text everywhere**, not only at `/api/sources/:id`: the source list (titles), the job list and the job detail (analysis quotes, overview, kit specs) of every `user-` source job need the access code.
3. **Ungate nothing that spends**: `demoFault` and `flow: "activity"` on `POST /api/jobs` must sit behind the same code, or be refused in production (part 1 note 1, restated because the route accepts both today).
4. **Send the access code as a request header, not a cookie**, so the existing JSON-only, no-CORS setup keeps blocking cross-site posts. Compare it in constant time and rate-limit wrong codes.
5. **Restart safety**: add a boot id to the job owner and handle SIGTERM by stopping admissions and writing running jobs as `INTERRUPTED` (B2-01). Render sends SIGTERM on every deploy.
6. **Serve the web build from the same Node process** (one `npm start`: build `apps/web`, serve `dist` with a SPA fallback, `/api/*` to the server). `main.ts` serves only the API today and there is no `start` script.
7. **Point `STORAGE_DIR` at the Render disk** and ship the curated demo runs there on first boot; test start-up on an empty disk (no `runs/`, no `ledger.jsonl`).
8. **Lower the live limits for judging**: `maxConcurrentJobs` 6 → 2 or 3, provider caps from 100/80 to the single judging budget, and an alert when the ledger nears it.
9. **Fix the 500 on bad percent-escapes** (B2-02), so monitoring is not noisy from scanners.
10. **Publisher wording**: keep the visible "AI-generated, not reviewed or endorsed by the publisher" label on NASA lessons until B2-03 is decided.

## Verdict

**CHANGES REQUIRED before public deployment.** The worker, prompt boundaries and accounting hold up well, but the API is still a localhost tool: it accepts anonymous source writes even in read-only mode, exposes pasted text, and leaves restarted jobs running forever in a container.
