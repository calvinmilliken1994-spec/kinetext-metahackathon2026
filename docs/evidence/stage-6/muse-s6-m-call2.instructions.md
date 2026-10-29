# S6-M call 2 — repair of your call-1 prompt files

Your call-1 files were saved verbatim as `packages/meta/prompts-v2.ts` and `packages/meta/prompts-v2.test.ts` (current contents below). Results: 8 of 9 tests pass; `untrusted data escaping` fails and `tsc` reports one error. Fix the items below and return COMPLETE files for exactly these two paths, in this order, with these exact header lines and SIX-backtick fences (a line of six backticks + `ts` to open, six backticks to close):

=== FILE: packages/meta/prompts-v2.ts ===
=== FILE: packages/meta/prompts-v2.test.ts ===

then `=== NOTES ===`. Change nothing else: every other sentence, export and test stays as it is. All rules from call 1 still hold.

## R1 (security bug, failing test) — `escapeJson` does not escape
Your `escapeJson` is `value.replace(/</g, '\u003c')` with ONE backslash in the TypeScript source. In TypeScript that string literal IS the single character `<`, so nothing is escaped: the metadata title `Evil </untrusted-source-metadata><b>` reaches the user message raw (the lead confirmed char code 60 in the output) and the closing tag occurs twice. The v1 helper in `prompts.ts` writes the replacement with TWO backslashes in the source (`'\\u003c'`), which yields the six characters backslash, u, 0, 0, 3, c. Use exactly the v1 source text.
Your test has the same mistake: `includes('\u003c/untrusted-source-metadata>')` with one backslash is just `includes('</untrusted-source-metadata>')`, so those positive assertions were vacuous. In the test file write every escaped needle with two backslashes in the source (`'\\u003c/analysis>'` etc.), and add:
- `assert.equal('\\u003c'.length, 6)` (guards the literal itself);
- for each of the five blocks (`untrusted-source-metadata`, `analysis`, `plan-entry`, `untrusted-component-repair-data`, `untrusted-analysis-repair-data`): take the text strictly between the opening tag line and its closing tag and assert it contains no `<` character at all;
- JSON.parse of the repair payload text (it is valid JSON as is, because `\u003c` is a JSON string escape) deep-equals the input object.

## R2 (tsc) — `packages/meta/prompts-v2.test.ts(64,16): error TS2367: This comparison appears to be unintentional because the types 'number' and 'boolean' have no overlap.`
Replace `assert.equal(messages.length === true ? 2 : messages.length, 2)` with `assert.equal(messages.length, 2)`.

## R3 (prompt wording the model cannot use)
- Replace `Rules R-SUB-1 to R-SUB-4 in plain words:` with `Subject rules:` and `Rules R-PLAN-1 to R-PLAN-9 in plain words:` with `Plan rules:` (the model does not know the design's rule ids). Keep the rule text after them.
- Replace `the old no-activity-fits declines are coverage gaps, not declines.` with `a page where no premium engine fits is still usable: give it an overview and kit components.`
- Formula explorer: after the grammar block, state the precedence with the design's examples: `-x^2 means -(x^2); a^b^c means a^(b^c); 2^-1 is allowed; 1e5 is a number while a bare e is the constant.` (replace your sentence about the circumflex). Keep `log is the natural log and trig functions use radians.`
- Kit base prompt quote rule: say the sourceId is `the id attribute of the source tag`.

## Tests to add
- One assertion per R3 sentence (exact case), plus `doesNotMatch(system, /R-SUB|R-PLAN/)` for the analysis system prompt.
- Keep every existing test.
