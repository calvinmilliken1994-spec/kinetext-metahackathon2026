# Task S7-M4: computing subject + sequence step names (Stage 6 prompts, version s6-v6)

Frozen spec (excerpt, docs/specs/STAGE-7e-library-and-wording.md): a new subject value `computing` (computing, algorithms, data, AI and machine learning) is added to `SUBJECTS` in packages/contracts/kit.ts — the lead makes that one-line contract change itself, placing 'computing' right after 'maths':
export const SUBJECTS = ['physics', 'maths', 'computing', 'history', 'finance', 'chemistry', 'biology', 'earth-science', 'civics', 'language-reading', 'other'] as const;
Because `SUBJECT_WHEN` and `SUBJECT_GUIDANCE` in prompts-v2.ts are typed `Record<Subject, string>`, they need a `computing` row in the same commit.

Also, Calvin chose that sequence step labels become short event names written by Muse (option a): the validator rule `labels-in-quotes` (label must occur verbatim in its own quote) is being retired by another worker; each step keeps its verbatim quote as evidence; numbers rule, publisher/plain-text sweep, distinct labels and length limits still apply. The current s6-v5 sequence guidance says each label is a short self-contained event name "never a copied fragment", and somewhere it may still require the label to appear in the quote — reconcile it.

Change `packages/meta/prompts-v2.ts`:
1. `STAGE6_PROMPT_VERSION` 's6-v5' -> 's6-v6'.
2. Add `computing` rows: SUBJECT_WHEN — e.g. 'algorithms, programming concepts, data, number systems, networks and security, artificial intelligence and machine learning'; SUBJECT_GUIDANCE — in the same style and length as the other rows: preferred components (sequence-v1 for algorithm steps in page order, formula-explorer-v1 for page-stated metrics such as accuracy, precision, recall or error formulas, compare-table-v1 for model or method types, sort-groups-v1 for categories, quiz-cards-v1), quote algorithms and formulas exactly, keep worked examples inside quotes, never invent code or run code, never claim model performance numbers the page does not state; pitfalls (hype or capability claims beyond the page; mixing training and test results; invented code).
3. sequence-v1 guidance: each step label is a short event name of at most 8 words in the teacher's words (example kept), written by you; the step's quote is the verbatim evidence for that step and must contain what the label names; labels need not appear verbatim in the quote; no numbers in a label that are not in its quote. Remove any remaining instruction that the label must occur in the quote.
4. Keep everything else byte-identical (teacher wording rule, all s6-v5/v4/v3 rules, schemas, limits, repair rules).
Change `packages/meta/prompts-v2.test.ts`: version pin 's6-v6'; tests that SUBJECT_WHEN/SUBJECT_GUIDANCE have a computing row and the analysis subject list includes computing; that the sequence guidance states labels are short event names and no longer requires labels to occur in the quote; size bounds still pass.
Return ONLY the two complete files.

Output format: for each file, a line `=== FILE: <repo-relative path> ===` followed by the COMPLETE file in a fenced block (```ts); then `=== NOTES ===`. Use exactly these paths: packages/meta/prompts-v2.ts, packages/meta/prompts-v2.test.ts.

(Followed by the two current files in full; omitted here.)
