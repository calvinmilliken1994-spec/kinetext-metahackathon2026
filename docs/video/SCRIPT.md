# Demo video script (draft 2, 3 Nov 2026)

Calvin reads the voiceover on camera (corner bubble). The screen is the real app, driven by a script and captured at
1920×1080. Target 2:55, hard limit 3:00. Rules: `docs/HACKATHON_RULES.md`, "Demo video guidance".

Live vs recorded, said on screen or in the voiceover:
- Scene 3 is a **live build** (real Muse Spark 1.3 and SAM 3.1 calls). Its middle plays at 4× with a "4× speed" label.
- The Welcome montage shows lessons built earlier; it is labeled "From published lessons" on screen and in the voiceover.
- Numbers marked ⟨…⟩ are filled in from the actual take.

---

## 1. Before and after (0:00 to 0:14)

**Screen:** the Welcome screen, montage running. Calvin's camera large, then shrinking to the corner.

**Voiceover:**
> Hi, I'm Calvin. I built this on my own during the hackathon. Before October 27th, this repo held a setup scaffold and
> no product. Everything you're about to see was built between October 27th and November 4th.

## 2. What it does (0:14 to 0:30)

**Screen:** the montage cuts through two or three lessons, then the cursor clicks into New lesson.

**Voiceover:**
> It's for teachers. Pick a licensed page, or paste your own, and Meta's models turn it into a short lesson with
> interactive parts. Each part is tied to the sentence it came from and checked against the page. These are lessons it
> built earlier.

## 3. A live build (0:30 to 1:30)

**Screen:** New lesson, Earth & space, "What Are Volcano Hazards?" (USGS), model Muse Spark 1.3, Build. The build strip
names each call as it runs. Real speed for the first seconds, then "4× speed" through the parts, back to real speed for
"Lesson ready".

**Voiceover** (each line lands on its moment in the strip):
> This is a live build on Muse Spark 1.3, through Meta's Model API. The strip shows each call as it happens.
>
> Muse reads the page and writes the summary first. Each key point lights up the sentence it came from.
>
> Then it writes the parts. Before a part appears, code checks its quotes, numbers and structure against the page. If a
> check fails, the part goes back to Muse with that check, and Muse revises it.
>
> For the diagram, Muse Spark finds each labelled part on the USGS figure, and SAM 3.1, Meta's segmentation model,
> outlines it to confirm. If they disagree, the check fails and the part is reworked.
>
> I've sped up the middle. The whole build took ⟨about two minutes⟩ and cost ⟨about twenty cents⟩.

## 4. Use it, and see how it was checked (1:30 to 1:55)

**Screen:** drag "Magma" onto its number, press Check. Open "Checks and run details": the repair story (the failed
check, what Muse changed, the figure before and after) and the checks per part.

**Voiceover:**
> Students drag each name onto its number, and nothing is marked until they check. Checks and run details shows every
> check behind the lesson, and when Muse revised a part, which check failed, what it changed, and the figure before and
> after.

## 5. A teacher signs off (1:55 to 2:15)

**Screen:** the amber "Needs review" notice, Review and publish, tick each part, Publish. All lessons with the Published
shelf.

**Voiceover:**
> Every lesson says "Needs review" until a teacher reads each part and publishes it. Published lessons go on the
> shelf: ten so far, across nine subjects.

## 6. Two Meta models, measured (2:15 to 2:45)

**Screen:** the Results page: Muse Spark 1.3 against Muse Spark Open, then the line from planned parts to published.

**Voiceover:**
> It runs on two Meta models: Muse Spark 1.3 on Meta's API, and Muse Spark Open, the open-weight model, served on
> Modal. I built 194 lessons with each. Spark 1.3 made a working lesson 189 times, Spark Open 178. Muse's own repairs
> rescued 45 parts on Spark 1.3 and 70 on Spark Open.

## 7. Try it (2:45 to 2:57)

**Screen:** back to the Welcome screen, cursor on the access code field, then "Explore read-only".

**Voiceover:**
> Judges get an access code that runs live builds on my credits, or you can explore read-only with every recorded
> lesson. ⟨App name⟩: make knowledge interactive.

---

## Notes for the take

- Never type the real judge code on camera. The live build runs on the local server with Calvin's key; the field reads
  "No code needed here".
- If the live take has a repair, keep it and say so in scene 3 ("Here a check failed, and Muse revised the part").
- If a take holds a part back, re-take (about USD 0.25 each, Meta credits for demoing).
- Before recording: the Welcome montage starts about 3 s late; decide the app name.
- Draft 2: scene 4 no longer claims a per-call list (the drawer shows checks and the repair story, not each call's
  time and cost); the calls are visible in the build strip in scene 3.
