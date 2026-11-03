# Kinetext · Make knowledge interactive

Kinetext turns a licensed page into a short, checked, interactive lesson for teachers, built by Meta's models:
Muse Spark writes the lesson, SAM 3.1 confirms the parts of a diagram, and deterministic code checks every quote,
number and formula before anything is shown. Solo entry (Indie Developer) to the Meta Global AI Developer Hackathon
2026 (Cerebral Valley), track **Build for Your World**.

## Run the demo (judges)

### 1. You need

- **Node.js 24** (22.18 or newer also works). Check with `node --version`; download from https://nodejs.org.
- **Git** and an internet connection. Windows, macOS and Linux all work. Nothing else to install.

### 2. Start it

```bash
git clone https://github.com/calvinmilliken1994-spec/meta-hackathon-2026.git
cd meta-hackathon-2026
npm install
npm start
```

The first `npm start` builds the web app (about a minute), then opens **http://127.0.0.1:8787** in your browser.
Leave the terminal open; press **Ctrl+C** in it to stop. The recorded lessons are included, so the app is full the
first time it opens.

### 3. Choose how to use it (on the welcome screen)

| You have | Do this | What works |
|---|---|---|
| **The judge access code** (in the submission notes) | Paste it into **Judge access code** and press **Unlock** | Everything, including **live builds** on Muse Spark 1.3 and Muse Spark Open, and SAM 3.1 diagrams. The model keys stay on our relay; the code is held only in your local server's memory. A shared judging budget is shown in the sidebar. |
| Nothing | Press **Explore read-only** | Every recorded lesson, the Demo, Results and presenting. No new builds. |
| **Your own Meta Model API key** | Copy `.env.example` to `.env`, set `MODEL_API_KEY=`, then `npm start` again | Live builds on Muse Spark 1.3 and SAM 3.1 on your own credit. Muse Spark Open runs on our Modal deployment, so in this mode it shows its recorded lessons only. |

### 4. A five-minute tour

1. **Demo** (sidebar): replays a real recorded build step by step, including a check that failed and Muse's repair.
2. **All lessons**: open any lesson on the **Published** shelf. Try the activity (drag the names onto the diagram,
   then **Check**), then open **Checks and run details** to see every check behind it and, where Muse revised a part,
   what failed and what changed.
3. **New lesson** (needs the code or your key): pick a page, for example *What Are Volcano Hazards?* (Earth & space),
   keep **Muse Spark 1.3**, press **Build lesson** and watch each Meta call in the strip. A build takes 1 to 4 minutes
   and costs about USD 0.20 of the judging budget.
4. **Your own source** (on New lesson): paste a page you have the rights to use, and optionally paste a diagram
   screenshot (beta: Muse reads its printed labels before building the diagram part).
5. **Review and publish**: a lesson says *Needs review* until a teacher ticks each part and publishes it.
6. **Results**: the evaluation of both Muse models over 194 lessons each.

### If something goes wrong

- **`npm start` stops with an error:** it prints the reason. Most often Node is too old (install Node 24) or
  `npm install` was skipped.
- **Port 8787 is busy:** the next free port is used automatically and printed; or set one, e.g. `PORT=8800 npm start`
  (PowerShell: `$env:PORT=8800; npm start`).
- **The web build fails:** run `npm install` again, then `npm start -- --rebuild`.
- **"Live builds are unavailable":** no code was entered and there is no key in `.env`. Read-only still works.
- **Privacy:** text you paste is sent to Meta's model API (and to Modal for Spark Open) to build the lesson. The relay
  forwards model calls and keeps a spend counter; it stores no lessons, pages or student data.

## What it is

A teacher picks a licensed public page (or pastes one they have rights to). Muse Spark, Meta's model,
reads it and builds a page overview whose every claim is quote-linked to the source, plus interactive
parts: quiz cards (predict, then reveal), sequence, sort, concept map, compare table, a formula
explorer with sliders and a live graph, and balance-the-equation — along with tested premium
simulations (forces, projectile, lift, speed of sound, compound interest, half-life, Hardy-Weinberg)
and dated timelines. Deterministic code then checks every quote against the stored page text, every
number against the engine that computes it, and every formula with a safe parser and exact evaluator.
Whatever fails goes back to Muse for a bounded repair; only parts that pass are published, and a part
that cannot be fixed is left out instead of shipping wrong. This is not a chatbot: the output is an
interactive artifact with a visible verify-and-repair loop, not a conversation.

## Results

Two evaluation series on the same 29 licensed public pages. The pre-registered v1 evaluation scored
the first product shape (one premium activity per page, or an honest decline). The lesson flow is a
later, broader shape (overview plus two to three checked interactive parts). The lesson-flow runs are
**follow-up runs, not a new pre-registered benchmark**; the pre-registered v1 scores are unchanged.

| Run | Pages with a lesson | Failed pages | Interactive parts kept | Median time | Cost | Evidence |
|---|---|---|---|---|---|---|
| v1, pre-registered (one premium activity, Spark 1.3) | 9 / 29 | 3 | — | — | USD 0.93 total | `docs/evidence/stage-5b/evaluation/` |
| Lesson flow, Spark 1.3 via Meta API | **28 / 29** | 1 (BUG-006, since fixed) | 63 / 67 (94%) | 74 s | **USD 4.53** (~0.14/page) | `docs/evidence/stage-6/evaluation-lesson-1.3/` |
| Lesson flow, Spark Open on Modal (first run) | 27 / 29 | 2 | 61 / 77 (79%) | 139 s | USD 6.86 (Modal credits) | `docs/evidence/stage-6/evaluation-lesson-open/` |
| Lesson flow, Spark Open after the s6-v2 prompt fixes | **28 / 29** | **0** | 48 / 56 (86%) | 100 s | USD 4.95 (Modal credits) | `docs/evidence/stage-6/evaluation-lesson-open-v2/` |

What the runs show, beyond the counts:

- The v1 run's 9/29 was a coverage problem, not a quality problem: requiring exactly one premium
  activity per page leaves most pages declined (17 of 29 in v1, including 8 later judged declined in
  error). The lesson flow turns nearly every page into something interactive (28/29) on both the
  hosted and the open-weights model.
- The 254-character glossary stub is correctly declined (`too-short`, 8 s) instead of padded into a lesson.
- Five **natural** analysis repairs (no injected faults) all passed on the Spark 1.3 run; on Spark Open
  the checks keep weak parts out rather than failing the page.
- One truncation inside a single component used to fail the whole lesson (BUG-006); since `a53c1f0` only
  that part is left out.
- The two Spark Open runs bracket a real engineering loop: its first run lost 16 planned parts (6 ran
  out of room, formula and table shape misses). Muse then rewrote its own generation instructions
  (s6-v2, commits `a6d98bb`/`ef2dee2`); the re-run had 0 failed pages, 0 truncations, and was faster
  and cheaper. Compare tables remain the weak part on Spark Open (see Limits).
- The open-weights runs used 3 pages at once (whole 29-page run: 19 minutes).

## How Meta AI is used

- **Runtime, hosted:** Muse Spark 1.3 (`muse-spark-1.3`) via the Meta Model API. Every live call uses
  constrained decoding (`response_format: json_schema`) and reasoning effort high. Muse decides the
  subject, writes the overview and the component plan, generates each component, and performs every
  repair. Without Muse there is no lesson — this is the core intelligence layer, not decoration.
- **Runtime, open weights:** Muse Spark Open (`meta-models/Muse-Spark-Open-816B-A42B`) served on the
  Modal Shared Endpoint, selectable per job in the UI, the API and the evaluation driver. Same
  pipeline, prompts, checks and repair loop — the product's guarantees come from the deterministic
  checks, not from one hosted API, so a school district or publisher could run it on infrastructure
  it controls.
- **Engineering:** Muse Spark 1.3, through the Muse Code subscription bridge, authored `packages/meta`
  (client, spend ledger, prompts, pipeline), the Stage 6 contracts, prompts and pipeline, the
  provider-aware open-weights client, and the s6-v2 prompt tuning. Each contribution is applied
  byte-for-byte after verification and recorded with usage, latency and receipts in
  `docs/META_CONTRIBUTIONS.md`. Meta Model API participant credits (USD 150) are spent only on product
  runtime; building runs on subscriptions.

## Architecture

Pipeline: source → Muse analysis v2 (subject, overview, component plan) → per-component generation →
deterministic checks (63 Stage 6 check ids; `SEQ-02 labels-in-quotes` was retired in Stage 7e —
sequence step labels are AI-written short event names, each still grounded by its verbatim quote)
→ bounded Muse repair → prune → partial publish.
Live events, artifacts and costs are stored per job under `storage/runs/` (gitignored). A curated set of real recorded runs ships in `data/demo-runs/` and is copied into `storage/runs/` on first start (never overwriting a run).

| Path | Responsibility |
|---|---|
| `packages/contracts` | Frozen types and JSON schemas: the strict `full` schemas Ajv validates against, and the flat `gen` schemas Muse receives for constrained decoding; engine catalogue; kit component contracts |
| `packages/meta` | Provider-aware model client (Meta API / Modal), spend ledger with reserve-then-reconcile and per-provider caps, prompts, generation and repair pipeline |
| `packages/validation` | Deterministic checks: verbatim-quote grounding, source sha256, range checks, safe formula parser/evaluator, exact chemical balancer, date grounding, repair no-weakening comparison |
| `packages/activities` | Pure, tested engines (forces, projectile, lift, speed of sound, compound interest, half-life, Hardy-Weinberg) shared by the validator and the browser — the same code computes the check and the animation |
| `workers/generation` | Job machine: stage events, per-component checks/prune/repair, partial publish |
| `apps/api` | Localhost-only `node:http` JSON API (loopback, Host/Origin allowlist; live generation opt-in) |
| `apps/web` | Vite + React teacher workspace: lesson view with all component types, repair cards, cost and scope honesty |
| `data/sources`, `data/evaluation` | 41 licensed source texts with per-source license/locator/sha256 records; the 29-page evaluation manifest |

## Trust and honesty

- **Deterministic checks, not vibes.** Every evidence quote must appear verbatim (whitespace-normalised)
  in the stored page text; every expected number is recomputed by the tested engine; every formula
  expression is parsed and evaluated by our own safe parser (no `eval`, no `Function`); every chemical
  equation is balanced exactly. Schema validity alone never passes the gate.
- **Repair integrity.** Repairs are compared against the immutable revision-1 baseline, never against
  the previous revision. Tolerances are never raised; cases cannot be deleted, renamed or replaced
  (a name that violates the publisher policy may be renamed positionally, numbers frozen); a repair may
  change only the fields a failing check names (`authorizedPaths`). Maximum two repair attempts.
- **Labelled faults vs natural repairs.** Demo faults are injected only through an explicit, labelled
  system-made toggle, are recorded with whether the intended check actually caught them, and are
  excluded from natural-repair metrics. Natural repairs (model mistakes found in honest runs) are shown
  with before/after diffs.
- **Honest declines.** A page that cannot support a lesson ends in a decline card with a reason — no
  forced activity.
- **AI-written labels.** Generated text is labelled; every activity carries "AI-written" plus the
  disclosure that the material comes from the source's real publisher and that the publisher has not
  reviewed or endorsed the lesson. Publisher-attribution policy is enforced by a validator check, not
  only a prompt.
- **Licensed sources.** Library sources are US-Gov-Work public pages, stored with locator, license,
  attribution and sha256; the loader rejects changed bytes. Teacher-pasted sources require a rights
  confirmation and an allowlisted license. Because free API credits may let the provider retain content,
  only licensed public, project-authored or synthetic text is ever sent.
- **No generated-code execution.** Activities are data rendered by tested components; `generatedCodeAllowed: false`.
- **Money honesty.** Every call is reserved against a cap before sending and reconciled after; unknown
  cost renders as *unknown*, never as $0.

## Run it locally (development)

The one-command launch is in Quick start above; this section is the developer setup with the API and Vite run separately.

Prerequisites: Node.js **>= 22** (`package.json` engines; developed and verified on Node 24, which runs
the TypeScript directly via type stripping — no build step for server or packages).

```bash
npm ci --ignore-scripts
npm run check          # typecheck + the offline test suite (fake transports; no network, no spend)
```

Offline demo — no API key needed:

```bash
npm run api            # localhost API on 127.0.0.1:8787, live generation off (POSTing a job answers 503)
npm run web            # Vite dev server on 127.0.0.1:5173, proxies /api to the API
```

Open `http://127.0.0.1:5173/?lesson-demo=1` for the development-only lesson harness: it renders
committed fixtures of a full lesson (overview, components, partial publish, decline) with no API and no
keys; the harness is compiled out of production builds.

Live generation (spends Meta participant credits; needs explicit approval):

1. Copy `.env.example` to `.env.local` (gitignored) and fill in the variable names it lists —
   `MODEL_API_KEY` and a positive `META_APPROVED_JOB_BUDGET_USD`. Never commit or paste values.
2. Start the API with those variables in its environment and live mode on, e.g.
   `META_LIVE=1 MODEL_API_KEY=… node apps/api/main.ts` (optional: `META_PURPOSE=demo`, `PORT`, `STORAGE_DIR`).
   For Muse Spark Open jobs the server additionally reads `MODAL_PROXY_TOKEN`, only at submission time.
3. Batch evaluation (same 29 pages): with the live API running,
   `node scripts/evaluation-run.ts --flow lesson [--model muse-spark-open] [--concurrency 3]`.

## Built during the hackathon

The official building window opened 2026-10-27 (kickoff Oct 26 12:00 ET). Two setup-scaffold commits
(`23ae633`, `b5f25da`, 2026-10-27 05:44–05:47 KST ≈ Oct 26 16:45 ET) contain setup documentation, a
draft schema, contract tests and a connectivity smoke probe — **no product functionality**. They are
excluded from everything the demo shows. **All product features were built from 2026-10-27 onward.**

| When | Commits | What landed (all event-built) |
|---|---|---|
| Setup scaffold — not demoed | `23ae633`, `b5f25da` | Setup docs, draft schema, tests, smoke probe. No product functionality. |
| 2026-10-27 | `f39bcab` … `1ea0c7c` | Contracts frozen; licensed NASA sources with sha256 loader; deterministic forces engine; validator; Muse-authored Meta client/ledger/prompts/pipeline; job worker + localhost API; teacher web workspace; three rounds of independent review with fix waves. |
| 2026-10-28 | `02df071` … `04520a8` | Stage 5: engine catalogue (projectile, lift, speed of sound), agentic repair loop with no-weakening integrity, teacher-pasted sources with injection tests, labelled demo faults; 11 live jobs (USD 0.53) incl. an honest decline. |
| 2026-10-28/29 | `1aa1df2` … `ca2b576` | Stage 5b: subjects beyond physics (compound interest, Hardy-Weinberg, half-life, timeline); analysis check-then-repair; 29-page pre-registered evaluation; four independent review rounds and fix waves. |
| 2026-10-29 | `6c93ce1`, `630a522`, `0fbeac0`, `c0bf205` | Open-weights mode: provider-aware client, per-job model choice, Modal token handling, model picker with labels on every step and repair. |
| 2026-10-29 | `cc1a9b5` … `d4f94af` | Stage 6 lesson flow: design and contracts (Muse), prompts/pipeline (Muse), 64 kit validators, worker/API, full lesson UI wired to live streaming. |
| 2026-10-29/30 | `00a0a07`, `a53c1f0`, `5992739`, `a6d98bb`, `ef2dee2`, `a2e1d07` | The four evaluation runs above; BUG-006 fix (a truncated part fails only itself); bounded concurrency (3 pages at once); s6-v2 prompt fixes and the Spark Open re-run. |
| 2026-10-30 | `e286b7e`, `4acace9`, `de83727` | App reskin with the official Meta logo footer naming the hackathon; publisher-correct AI disclosure; final UI pass (teacher view by default). |

Solo human developer. Parts of the implementation were written by AI agents (Muse Spark 1.3, Claude,
Qwen, GPT reviewers) under the developer's direction; every commit's authoring route is recorded in
`docs/REPOSITORY_LOG.md` and Meta contributions in `docs/META_CONTRIBUTIONS.md`.

## Limits and known issues

- **Compare tables were the weak part.** On the Spark Open re-run they published 0/5: the model wrote
  kebab-case ids as entity names and wrong cell counts. The fix — Muse only names rows/columns and
  supplies one value per column while our code builds the grid, and id-like names are rejected — is
  specified in `docs/specs/STAGE-6-compare-grid.md`; its effect on live runs is measured in the
  follow-up evaluation runs under `docs/evidence/stage-6/`.
- **Timeline date grounding fails closed on purpose.** The accepted date rule rejects some legitimate
  phrasings (disclosed false rejections, e.g. "not approved until…" events in the Lee Resolution
  timeline). The limits are documented in the Stage 5b close-out.
- **Teaching quality is not independently rated.** The checks verify quotes, numbers, formulas and
  structure — "this is what the cited sentence says" — not how well a component teaches. No human
  quality rating has been run.
- Sequence step labels in stored runs from before Stage 7e are copied quote fragments (the retired
  `labels-in-quotes` validator rule required each label to occur in its own quote); labels are now
  AI-written short event names, with each step's verbatim quote kept as the grounded evidence.
- The `componentRepairs` field is empty in the 1.3 run's result rows (reporting gap fixed after that
  run in `a53c1f0`); repairs did start.
- Teacher-pasted source texts live in gitignored runtime storage, so their grounding cannot be
  re-verified from the repository alone.
- Costs and latencies come from the local ledger and provider receipts; anything not measured is
  recorded as unknown, never zero.
- There is no external publishing path: publication is disabled; everything here runs and stays local.

## Sources and attribution

- The 41 library sources (`data/sources/`) are US-Gov-Work public-domain pages from NASA Glenn Research
  Center, the National Archives, NOAA, the CFPB, the NRC, the USGS and the NIJ. Each source record keeps
  its locator, license, attribution text and sha256. Per NASA's media-usage conditions, generated output
  is attributed to this product, never to NASA, and the validator enforces that.
- The test fixture source text (`tests/fixtures/source.txt`) is original and CC0-1.0.
- The app footer names the hackathon in plain text only. No Meta logo is used, and no endorsement by
  Meta is implied.
- A blanket repository license has not been chosen yet (developer decision pending; see
  `docs/PROVENANCE.md`).

## Where to read more

- `docs/HACKATHON_RULES.md` — the verified contest rules this README's provenance section follows.
- `docs/ARCHITECTURE.md` — full architecture, contracts, and the review history behind them.
- `docs/specs/STAGE-6-design.md` — the lesson-flow design (Muse-authored, lead-frozen).
- `docs/evidence/` — receipts, live runs and the four evaluation folders cited above.
- `docs/RESOURCE_POLICY.md` — spend, privacy and execution policy.
