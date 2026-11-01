# Stage 9: the live build view

Goal: while a lesson job runs, the lesson column assembles itself from the job's real events, so a viewer sees Muse read
the page, plan, write, check and repair, and SAM outline a figure. Every visual beat maps to one recorded event or one
artifact the API has served. Nothing is simulated; nothing waits on a timer to look busy.

## What the browser receives (measured from `apps/web/src/hooks.ts` and `workers/generation/{jobs,lesson}.ts`)

`GET /api/jobs/:id` is polled every 1.5 s while `summary.status === 'running'`. Each poll returns all events so far
(each with an ISO `at`, `seq`, and on finished calls `latencyMs`, `usage`, `estCostUSD`) plus whatever artifacts exist:

| Job moment (event) | New in the detail |
|---|---|
| `ingest` started/succeeded | the summary only |
| `analyze` started | nothing else (the analysis call runs 20 to 50 s) |
| `analyze` succeeded + `overview` succeeded (same ms) | `analysisV2` (headline, key points, key terms, component plan with reasons), `analysisV2Report`, `lesson.json` with the overview, `summary.lesson.componentsPlanned` |
| `component` started (two at a time) | nothing else |
| `segment` started/succeeded (label diagram only) | SAM 3.1 call: part count, `latencyMs` |
| `component` failed (`detail: failed checks: LD-04`) then `repair` started | nothing else: an unverified revision is never served |
| `repair` succeeded/failed | `latencyMs`, `usage` of the repair call |
| `component` succeeded (`detail: 11/11 checks passed`) | on this or the next poll: the `lesson.components` entry, its `kitSpecs` spec, `componentReports` report, `summary.componentRepairs` |
| `done` | final summary (status, cost) |

So the API already serves everything the view and the replay need. No new endpoint is required.

## Beats (what appears, driven by what)

1. Strip (top of the lesson column, one line, fixed height): `Muse Spark 1.3 · Reading the page · 12 s`. Each open
   call (started event without its end) is listed with its real elapsed time; SAM calls are named `SAM 3.1`. Finished
   job: `Built in 1 min 23 s · 4 Muse Spark calls · 2 SAM 3.1 calls · $0.144 est.` (sums of the recorded events).
2. Analysis lands: the title becomes Muse's headline (crossfade), the key points arrive one by one (staggered 70 ms),
   and the cited sentences light up in the source page in the same order (marks fade in, staggered 60 ms).
3. Plan: one frame per planned part appears, named by its kind, with Muse's one-line reason for choosing it.
4. Each frame keeps a short work log, one line per event: writing (live elapsed) → written in N s with token count →
   SAM outlined n of n parts in N s → n checks failed (plain check names) → reworking as revision 2 → revision 2
   written → n of n checks passed, shown as a row of n ticks filling in order.
5. The part arrives: the log collapses to a one-line trace under the part title and the content reveals top-down
   (clip + fade, 380 ms). A label diagram draws its markers and SAM regions part by part (150 ms apart), then lets them fade, so the
   lesson figure ends in its normal covered state.
6. A failed part ends in its usual plain "could not be verified" card, keeping the trace.

## Motion rules

- 150 to 400 ms, `cubic-bezier(0.16, 1, 0.3, 1)`, opacity, transform (≤ 6 px), clip-path only. No bounce, glow,
  gradient, shimmer or spinner. Staggers are capped (a list never takes more than ~600 ms to finish).
- Animations play on mount only, and only in a view that saw the job running (`is-live`). Opening a stored lesson
  shows it at rest, exactly as before.
- Several events that land in one poll are revealed in seq order through the stagger, never delayed past real time.
- Reserved space: the strip has a fixed height; the title box never shrinks (a shorter headline sits at its foot); an
  invisible twin of the Present button holds its column; the status line keeps the trust receipt's height and the
  provenance line keeps room for one repair phrase; each frame reserves a per-kind estimate of its part's height
  (`lib/liveBuild.ts reserveHeight`). Content above an arriving part never moves; a later part may move by the
  estimate's error only (Chrome's scroll anchoring keeps a scrolled reader's viewport still).
- `prefers-reduced-motion`: no movement, no stagger, no outline draw, no mark flash; the app's global reduced-motion
  rule makes the remaining fades instant. Counters still update.

## Replay

`?replay=<jobId>&speed=N` (N in 0.25 to 16, default 1) loads the stored job once through the existing GET, then
rebuilds, for each moment, the detail the server would have served then (events with `at <= t`, each artifact from
the event that wrote it) and feeds it through the same view. A banner above the strip says `Replay of a recorded run ·
N× speed · recorded <date>` with a Replay again button, and the strip says Replay instead of Live. Never shown as live.

## Degrading

- A job with no `at` timestamps or an unknown event shape: frames fall back to the existing placeholder wording.
- Older servers (no lesson fields): the classic `JobOutcome` card, unchanged.
- A declined page: the decline card fades in where the overview would go.
- A failed job: the existing outcome card.

## Files

`lib/liveBuild.ts` (strip, part logs, traces, reserves), `lib/replay.ts` (request parsing, moment snapshots),
`components/LiveBuild.tsx`, `components/useReplay.ts`, `styles/live.css`; small props on `LessonView`, `KitCard`,
`OverviewView`, `SourcePanel`, `LabelDiagramView`, wired in `App.tsx`. Evidence: `docs/evidence/stage-9/live-build/`.

## Amendment (2026-11-01): working cues
Calvin: the seconds counter alone did not show that work was happening. While calls are open, three indeterminate cues loop: a light sweeping the strip's lower edge, a breathing dot on each open call, and a shimmer on the sketches of parts being written or reworked and on the summary placeholder. They stop the moment the strip closes. No fake percentages. Reduced motion: no loops (a static accent line).
