# Welcome v2 (Stage 10c slice A): browser evidence

Calvin's ask (2 Nov): a Welcome with more impact: an animated background, the real figure as a centrepiece, and one
refined Get started card. Frames captured with the browser tool against the local Vite dev server and the read-only
API (gate off, live builds off). No POST reached the server: the gate-on, granted and builds-open states and the
missing-run fallback came through a GET-only fetch shim registered in the capturing tab (files marked `-shim`); the
one wrong-code submit in frame 13 was answered inside the tab by that shim.

## What is on screen
- Left: the unchanged statement and lede, the facts line, then one Get started card: the credential field with its
  button, an "or" divider, one big button into the guide, and a line on what comes next.
- Right: the NOAA water-cycle figure from the pinned opening run `job-20261101234914-97ba271b`
  (`DEMO_PINS.opening[0]`), dimmed. Every box comes from that run's stored label-diagram spec (GET /api/jobs/:id):
  white dashed = the box Muse Spark's grounding call located (`regions[].ground`), blue glow = SAM 3.1's box
  (`labelDiagramView.regionDrawing`, the build's glow). Numbers are the served part order (page order).
- Caption, derived from the run: "Recorded run · Muse Spark 1.3 located 5 parts · SAM 3.1 confirmed 5 of 5", plus the
  figure credit from the stored figure licence.
- Behind everything: sentences of the page itself (GET /api/sources/noaa-jetstream-hydrologic-cycle), faint and drifting
  slowly; the five sentences the parts were written from light up as each part is located, then stay softly tinted
  until the part fades.

## Loop (14 s, CSS keyframes on opacity, transform and text colour; parts start 650 ms apart)
| Frame | Time in loop | What it shows |
|---|---|---|
| 01 | 1.6 s | Muse located: dashed boxes on Evaporation and Transpiration; backdrop still fading in on first load |
| 02 | 3.3 s | SAM's glow on 1-3, dashed boxes on 4-5, numbers 1-2 landed, cited sentences lit |
| 03 | 5.4 s | all five glows and numbers 1-5 |
| 04 | 9.0 s | hold: five glows, five numbers, five cited sentences tinted |
| 05 | 11.9 s | fading out in page order (only 5 left) |
| 06 | 13.6 s | quiet gap: the dimmed figure alone before the loop restarts |

Other frames: 07-08 light theme, 09 2560×1440, 10 1366×768, 11 prefers-reduced-motion (still frame, every stored
box and number shown, cited sentences tinted, no drift, no animations running), 12 gate on and locked (code field
focused on load), 13 wrong code (error line in place of the helper, `role=alert`), 14 granted ("Judge access is on:
$47.12 of $50 left." and Continue), 15 gate off with live builds on ("Builds are open on this server"), 16 the run
cannot load (figure-less layout: statement beside the card over the page text, no broken frame).

## Measured
- No scrolling at 1920×1080, 2560×1440 and 1366×768: `.welcome` scrollHeight equals clientHeight and the document
  never overflows the viewport.
- Keyboard: locked focuses the code field; Enter on an empty field shows "Enter the access code you were given.";
  Tab goes field → button → Explore read-only. Explore read-only opens the guide ("Step 1 of 6").
- `impeccable detect --json apps/web/src apps/web/index.html`: 0 findings.
