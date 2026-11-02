# Stage 10c slice D: copy and page fixes (UX review 2)

Browser checks at 1920×1080 (primary) and 2560×1440, dark theme, GET-only against the read-only local API (live generation off).
Lesson used: The Hydrologic Cycle, `job-20261101200607-c65a20bb`. Nothing was built, saved or published.

| File | What it shows |
|---|---|
| `checks-copy-1920.jpg` | H3: "Code matches every quote to the page and recomputes every number it calculates. It does not check whether the page itself is right. Open a part to see what it checked." (the trust receipt open on the lesson) |
| `review-1920.jpg`, `review-2560.jpg` | M3: each part shows "What students read" (first two lines) with "Show all N lines"; "Show in lesson →" (in-app arrow) replaces "Open" + external-link icon; the state line reads "Not reviewed yet". |
| `review-1920-expanded.jpg`, `review-1920-light.jpg` | The wording expanded (labels, hint), and the light theme. |
| `all-lessons-1920.jpg`, `all-lessons-2560.jpg` | M5: lede "673 finished lessons and activities from 104 pages: 97 in the library, 2 pasted by a teacher and 5 since retired from it."; count line "104 pages · the newest lesson of each"; "2 of 2 parts"; chips 30 px tall at 14 px; table header 14 px. |
| `new-lesson-chips-1920.jpg` | L6 on New lesson: chips 30 px at 14 px, row meta 14 px (same `nav.css` classes). |
| `sidebar-replay-badge-1920.jpg` | L4: during a replay the "Replay" badge sits on its own line under the lesson title. A long title clamps to two lines with an ellipsis and keeps the tooltip. |
| `results-1920.jpg`, `results-2560.jpg`, `results-1920-light.jpg` | Polish: "On this page" index of the 7 sections (buttons that scroll the panel, focus the section heading); "Bars are drawn on a 0–100% scale." under the headline bars; at 2560 the headline and comparison table fill the same 1440 px column as the other tables. |
| `how-it-works-1920.jpg`, `how-it-works-2560.jpg` | M2, M8, polish: lede says "a short AI-written summary, each point tied to the sentence it came from"; step 4 "left out rather than shown without passing its checks"; steps 3 to 6 each link (checks, Demo, Results, Review and publish); step 6 says publishing happens on Review and publish. **Rendered through a throwaway dev harness (deleted) because the links need `onNav` wired in `App.tsx` (see report).** |

## Checks
- `node --test apps/web/src/lib/*.test.ts`: 1211 pass, 0 fail (new: `partWording.test.ts`, `pageCopy.test.ts`, extra cases in `browse.test.ts`).
- `tsc -p apps/web/tsconfig.json`: clean. `vite build`: OK.
- `impeccable detect --json apps/web/src apps/web/index.html`: `[]` (0 findings).
- Wording sweep (GET-only, scratch script): newest lesson of each of 99 pages, 185 working parts, 0 without wording. Kinds seen: label diagram, sequence, quiz, balance, compare, sort, data table, ladder, algorithm, formula explorer, threshold, concept map, and the premium engines (decay, timeline, interest, Hardy-Weinberg, sound, forces, lift, projectile).
- The 104 vs 97: the 104 pages with a finished lesson are 97 library pages, 2 teacher texts and 5 retired library pages (counted from `/api/sources?include=retired`).
