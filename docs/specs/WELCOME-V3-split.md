# Welcome v3: split screen, "page becomes lesson"

Agreed with Calvin on 3 Nov 2026. Design change only: what the Welcome does (access code, read-only, the guide and Demo
prompts after it, `?welcome=1|0`, `mki.welcome`) stays exactly as it is.

## Layout (Calvin's draft)

- **Left half:** a solid panel in the app's blue (the existing accent token, not a new hex). On it, the app name, large
  (`APP_NAME`, one constant; provisional "Make knowledge interactive" until Calvin picks a name), a one-line statement,
  and a minimal sign-in: the existing access-code field + Unlock, an "or" divider, "Explore read-only", and the existing
  helper lines (no code needed here / live builds off). Same wiring as today (`WELCOME_CREDENTIALS`, access messages).
- **Right half:** the visual below, on the window background. The footer line "Built for the Meta Global AI Developer
  Hackathon 2026" stays.
- 1920×1080 and 2560×1440 first; 1366×768 must fit without scrolling; narrow windows stack (panel on top, visual below
  or hidden).

## The visual: page → lesson, fast and jumpy (option 1)

A fast montage across the **published lessons** (real stored runs, so every word and outline is real):

- Each beat is one lesson: a clean excerpt of its source page appears with the one sentence a part was written from
  lit; a beat later that part snaps out beside it as a small, faithful preview, joined to the sentence by a thin line.
  Then a hard jump to the next lesson (a different subject). About 1.5 to 2 s per beat; cuts, not slow fades.
- Part previews are drawn from the stored spec, small and calm: label diagram (the figure, with SAM 3.1's stored
  outline traced on its parts), sequence (first three steps), quiz card (question + options), formula explorer
  (formula + a slider), compare/data table (a few cells), sort groups (two groups of chips), half-life / compound
  interest (the curve). Unknown kinds are skipped.
- A small caption per beat: subject, model, and for diagrams "SAM 3.1 outlined". Label it as recorded lessons ("From
  published lessons"), never as a live build. Outlines and boxes only from the stored model output.
- Order: alternate subjects; open on the volcano. Lessons (job ids): volcano `job-20261102050029-1ebd79c6`, water
  `job-20261101235049-c31ad262`, DNA `job-20261101211438-e741b91a`, radioactive waste `job-20261031154139-c6facfdb`,
  saving `job-20261031152958-aa411e2f`, branches of government `job-20261031110323-8979fdcd`, free fall
  `job-20261031103341-bac931f2`, phishing `job-20261031100603-3a2687b8`, Voting Rights Act `job-20261031094943-7234f176`.
  Not the airplane (retired page). A lesson that fails to load is skipped; with none, the right side shows a calm still.
- Performance: animate only `transform` and `opacity` (the Welcome lagged before: no animated colour, no filters or
  masks over moving content, no full-screen repaints). Reduced motion: one still beat, no cycling.
- Look: in line with the app (dev.meta.ai feel), monochrome with the one accent, nothing cartoony; `impeccable detect`
  stays at 0.

## Option 2, kept for later

If option 1 does not work out, Calvin will switch to a slow wall of the same published lessons as mini previews. Keep
the part-preview components reusable (one preview per part kind, sized by the caller) so option 2 can reuse them.
