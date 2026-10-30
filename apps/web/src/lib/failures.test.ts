// Stage 7e: the part-failure card says in plain words why a part was left out. Check ids and validator text are kept for
// the technical details only. The reasons below are copied verbatim from stored runs (storage/runs/<job>/lesson.json and
// the component's last report), so the sentences are tested against what the API really sends.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { partReports, teacherFailure, technicalMessage } from './failures.ts';

const MACH_REASON = 'schema.full, repair.no-weakening: spec failed schema.full: /simulation/scenario/settingLabel must NOT have more than 60 characters';
// job-20261029201515-203a61ba, speed-of-sound-v1 revision 3 — the failing checks of that revision's report.
const MACH_REPORT = {
  checks: [
    { id: 'schema.full', passed: false, message: 'spec failed schema.full: /simulation/scenario/settingLabel must NOT have more than 60 characters' },
    { id: 'repair.no-weakening', passed: false, message: 'repair weakened the spec: simulation.gamma range width shrank from 0.7 to 0.69 ([1, 1.7] -> [1.01, 1.7]) (a repair must fix the failing checks without changing the engine, renaming/replacing/deleting any baseline case occurrence, widening any tolerance, rewriting a case that passed on the baseline, or shrinking slider ranges)' },
    { id: 'grounding.quotes', passed: true, message: '' },
  ],
};

const RAW = /\b(?:[A-Z]{1,4}-\d{2}|schema\.\w+|repair\.[\w-]+|timeline\.[\w-]+)\b|\/simulation\/|cells\[\d\]|must NOT/;

test('the Mach page part: format rule broken and a repair that narrowed a slider range, in one teacher sentence', () => {
  const f = teacherFailure(MACH_REASON, MACH_REPORT);
  assert.equal(f.sentence, 'Muse’s draft broke one of our format rules and its repair tried to narrow a slider range, which isn’t allowed, so this part was left out.');
  assert.deepEqual(f.ids, ['schema.full', 'repair.no-weakening']);
  assert.equal(f.technical, MACH_REASON);
});

test('without the report, the reason alone still gives a plain sentence (the weakening kind is not guessed)', () => {
  const f = teacherFailure(MACH_REASON);
  assert.equal(f.sentence, 'Muse’s draft broke one of our format rules and its repair tried to change something that had already passed its checks, which isn’t allowed, so this part was left out.');
  assert.doesNotMatch(f.sentence, RAW);
});

test('real stored reasons map to plain sentences (kit checks)', () => {
  const cases: Array<[string, string]> = [
    ['CT-02, repair.no-weakening: cells[0] (first-law-statement): the entity "Newton’s First Law of Motion (Inertia)" occurs neither in the quote nor in the same paragraph as the located quote span (cell-in-quote)',
      'Muse’s draft filled table cells with words that are not in their quotes and its repair tried to change something that had already passed its checks, which isn’t allowed, so this part was left out.'],
    ['FE-02, FE-08: expression "v = a * t" does not parse in the frozen calculator grammar: unexpected character "=" at position 1',
      'Muse’s draft wrote a formula our calculator cannot read and a formula that does not match the page’s formula, so this part was left out.'],
    ['Q-06: cards[1].options[0] states the number 94, which does not appear on the page or in the same quote (N-01)',
      'Muse’s draft used numbers that are not on the page, so this part was left out.'],
    ['SEQ-03: steps[2] (pythagorean-formula) starts at offset 3760 of source "nasa-grc-sine-cosine-tangent", not after steps[1] (offset 3826)',
      'Muse’s draft put the steps in a different order from the page, so this part was left out.'],
    ['timeline.date-grounded: event "e7" (1777-11): date not grounded — quote "The plan for making treaties was not approved until Septembe" contains no COMPLETE source date expression',
      'Muse’s draft gave a date that its quote does not state, so this part was left out.'],
    ['CT-02, CT-03, repair.no-weakening: cells[0] (cell-weight-force-type): the entity "id" occurs neither in the quote',
      'Muse’s draft filled table cells with words that are not in their quotes and built a table with missing or extra cells, and its repair tried to change something that had already passed its checks, which isn’t allowed, so this part was left out.'],
    ['schema.gen, FE-02, FE-08: formula-explorer gen failed the structural limits: title must be a non-empty string',
      'Muse’s draft broke one of our format rules, wrote a formula our calculator cannot read and failed 1 more check, so this part was left out.'],
  ];
  for (const [reason, sentence] of cases) {
    const f = teacherFailure(reason);
    assert.equal(f.sentence, sentence, reason.slice(0, 40));
    assert.doesNotMatch(f.sentence, RAW);
    assert.equal(f.technical, reason);
  }
});

test('the repair kinds are named from the report message when it says what changed', () => {
  const timeline = { checks: [{ id: 'repair.no-weakening', passed: false, message: 'repair weakened the spec: event "e2" changed (evidence quotes changed) even though its date check passed on the baseline' }] };
  assert.equal(teacherFailure('repair.no-weakening: repair weakened the spec: event "e2" changed', timeline).sentence,
    'Muse’s repair tried to change an event that had already passed its checks, which isn’t allowed, so this part was left out.');
  const table = { checks: [{ id: 'repair.no-weakening', passed: false, message: 'repair weakened the spec: /rows/0/values/0/value changed from "$100 every year" to "starting at age 14" outside the affected paths recomputed from revision 1' }] };
  assert.equal(teacherFailure('repair.no-weakening: repair weakened the spec: /rows/0/values/0/value changed', table).sentence,
    'Muse’s repair tried to change something that had already passed its checks, which isn’t allowed, so this part was left out.');
  const tol = { checks: [{ id: 'repair.no-weakening', passed: false, message: 'repair weakened the spec: predictions[0].tolerance widened from 0.001 to 0.5' }] };
  assert.match(teacherFailure('repair.no-weakening: x', tol).sentence, /tried to loosen a tolerance/);
});

test('a reason that is already a plain sentence is shown as it is, with no technical details', () => {
  const f = teacherFailure('Muse ran out of room while writing this part, so it was left out.');
  assert.equal(f.sentence, 'Muse ran out of room while writing this part, so it was left out.');
  assert.deepEqual(f.ids, []);
  assert.equal(f.technical, '');
});

test('unknown check ids still read as a plain sentence; an empty reason gives a generic one', () => {
  assert.equal(teacherFailure('XYZ-99: something odd').sentence, 'Muse’s draft failed one of our checks against the page, so this part was left out.');
  assert.equal(teacherFailure('').sentence, 'This part did not pass our checks against the page, so it was left out.');
});

test('model text in a reason never brings control or zero-width characters into the card', () => {
  const f = teacherFailure('Muse ran out\u200b of room\u0007 while writing this part,\u202e so it was left out.\ufeff');
  assert.equal(f.sentence, 'Muse ran out of room while writing this part, so it was left out.');
  const g = teacherFailure('CT-02: cells[0]: the entity "a\u200db" occurs neither in the quote');
  assert.doesNotMatch(g.technical, /[\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/);
});

test('every failed part in the stored runs gets a teacher sentence without check ids or validator text', (t) => {
  const runs = new URL('../../../../storage/runs/', import.meta.url);
  if (!existsSync(runs)) { t.skip('no local storage/runs'); return; }
  let n = 0;
  for (const job of readdirSync(runs)) {
    const file = new URL(`${job}/lesson.json`, runs);
    if (!existsSync(file)) continue;
    let lesson: { components?: Array<{ status: string; reason?: string }> };
    try { lesson = JSON.parse(readFileSync(file, 'utf8')); } catch { continue; }
    for (const c of lesson.components ?? []) {
      if (c.status === 'passed') continue;
      const f = teacherFailure(c.reason ?? '');
      assert.doesNotMatch(f.sentence, RAW, `${job}: ${f.sentence}`);
      assert.match(f.sentence, /^[A-Z].*\.$/u, `${job}: ${f.sentence}`);
      n += 1;
    }
  }
  assert.ok(n >= 10, `expected the stored failed parts, found ${n}`);
});

test('partReports: kit parts from the component reports, the premium activity from the revision its entry names', () => {
  const r1 = { checks: [{ id: 'schema.full', passed: false, message: 'r1' }] };
  const r3 = MACH_REPORT;
  const kit = { checks: [{ id: 'SEQ-01', passed: true, message: '' }] };
  const out = partReports({
    lessonData: {
      lesson: { components: [
        { componentId: 'speed-of-sound-v1', specId: 'premium-spec', revision: 3 },
        { componentId: 'sequence-v1', specId: 'job:sequence-v1:r1', revision: 1 },
      ] },
      componentReports: { 'job:sequence-v1:r1': kit },
    },
    revisions: [{ revision: 1, report: r1 }, { revision: 3, report: r3 }],
  });
  assert.equal(out['premium-spec'], r3);
  assert.equal(out['job:sequence-v1:r1'], kit);
  assert.deepEqual(partReports({}), {});
});

test('technicalMessage: the validator text without the id prefix (the ids are listed separately)', () => {
  assert.equal(technicalMessage(teacherFailure(MACH_REASON)), 'spec failed schema.full: /simulation/scenario/settingLabel must NOT have more than 60 characters');
  assert.equal(technicalMessage({ ids: [], technical: '' }), '');
});
