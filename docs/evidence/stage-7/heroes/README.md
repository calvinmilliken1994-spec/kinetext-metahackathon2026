# Stage 7c slice P1 — physics heroes (screenshots)

Full app window at 1920×1080, dark and light, from real stored lessons on the local API (GET only; no jobs created).

| Hero | Stored run | Shots |
|---|---|---|
| Moon throw (projectile-v1 inside a lesson) | `job-20261030031842-3b2790f3` (Spark 1.3, prompt v10) | `moon-{dark,light}-1-opening.png`, `-2-mid-reveal.png`, `-3-after-reveal.png` |
| NASA Drag (formula-explorer-v1) | `job-20261029122502-af74462a` (Spark 1.3; the only stored Drag lesson with an explorer) | `drag-{dark,light}-1-opening.png`, `-2-mid-reveal.png`, `-3-after-reveal.png` |

What each frame shows:
- **Opening**: case 1 is unanswered, so the peak label, readout and equation show `?` (Moon); the graph keeps its curve but withholds the y-axis numbers and the value (Drag).
- **Mid-reveal**: Moon, guess 15 m. The ball is in flight, and the class's guess is already a level line. The peak stays `?` until the ball reaches the top. Drag, guess 5,000: the graph has scrolled into view and the point is travelling from the guess height to the calculator's value.
- **After reveal**: the peak marker settles, a band shows the teaching margin (max(case tolerance, 2 % of the engine value)) around the engine value, and a bracket gives the gap in words ("4.75 m too low", "1,250 too low", or "inside the ±0.395 m margin").

Every number comes from the engines (`projectile-v1`, the formula evaluator) and the stored lesson data. The animation is schematic. With reduced motion the reveal appears at once, without movement.
