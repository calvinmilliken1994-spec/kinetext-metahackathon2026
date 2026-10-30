// Stage 7e — the sequence `labels-in-quotes` rule (SEQ-02) is RETIRED and its check id REMOVED
// (docs/specs/STAGE-7e-library-and-wording.md, option (a), frozen 2026-10-31): a step label is
// Muse's own short event name; the step's verbatim quote stays the grounded evidence. The
// ≤ 8-word event-name shape is prompt guidance, not a validator rule; the existing length limits
// (KIT_LIMITS.sequence.label) stay.
//
// Pinned here, with the real NARA constitution page:
//   1. a label that does NOT occur in its own quote is publishable (the retired rule's case);
//   2. the published sequence check-id list is schema.gen + SEQ-01, SEQ-03..SEQ-06 (no SEQ-02,
//      no always-pass stub);
//   3. quote grounding stays: an event-name label never rescues a fabricated quote (SEQ-01);
//   4. the shared numbers rule stays: an off-page number in a label fails SEQ-06 (N-01);
//   5. the publisher/plain-text sweep stays: an attributing label fails the structural gate;
//   6. distinct labels stay: two equal event names fail SEQ-04;
//   7. label length limits stay;
//   8. repair authorization: /steps/i/label changes are unlocked ONLY by the remaining
//      validator-owned label findings (SEQ-04 duplicates, gate length/policy), never by a
//      retired SEQ-02 — a clean baseline's labels stay frozen.
// Run: node --test packages/validation/stage7e-sequence-labels.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';

import { compareKitRevisions, validateKitComponent } from './kit/index.ts';
import {
  checkOf, clone, constitutionSource, expectFailures, failedIds, failureDetail, sequenceGen,
} from './fixtures/stage6.ts';

const validate = (gen: unknown) => validateKitComponent('sequence-v1', gen, [constitutionSource()]);

/**
 * The real NARA labels-as-event-names case: the quote is the page sentence "The Federal
 * Convention convened in the State House (Independence Hall) in Philadelphia on May 14, 1787,
 * to revise the Articles of Confederation." and the label is Muse's own short event name —
 * it does not occur in the quote (under the retired rule this gen failed SEQ-02).
 */
function eventNamedGen() {
  const gen = clone(sequenceGen());
  gen.steps[1]!.label = 'Delegates meet in Philadelphia';
  return gen;
}

test('labels are event names: a label that does not occur in its quote is publishable (SEQ-02 retired)', () => {
  const report = validate(eventNamedGen());
  assert.deepEqual(failedIds(report), [], failureDetail(report));
  assert.equal(report.publishable, true);
});

test('published sequence check ids: schema.gen + SEQ-01, SEQ-03..SEQ-06 in order; no SEQ-02 stub', () => {
  const report = validate(eventNamedGen());
  assert.deepEqual(report.checks.map(c => c.id), ['schema.gen', 'SEQ-01', 'SEQ-03', 'SEQ-04', 'SEQ-05', 'SEQ-06']);
});

test('quote grounding stays: an event-name label never rescues a fabricated quote (SEQ-01 alone)', () => {
  const gen = eventNamedGen();
  gen.steps[1]!.quote = 'The Federal Convention gathered behind a fabricated sentence.';
  const report = expectFailures(validate(gen), ['SEQ-01']);
  assert.ok((checkOf(report, 'SEQ-01').affected ?? []).includes('/steps/1/quote'));
});

test('numbers stay: a label number that is not on the page or in the quote fails SEQ-06 (N-01) alone', () => {
  const gen = eventNamedGen();
  gen.steps[1]!.label = 'Delegates from 987654 states meet';
  const report = expectFailures(validate(gen), ['SEQ-06']);
  assert.ok((checkOf(report, 'SEQ-06').affected ?? []).includes('/steps/1/label'));
  assert.match(checkOf(report, 'SEQ-06').message, /N-01/);
});

test('publisher sweep stays: a label attributing the step to the National Archives fails the gate alone', () => {
  const gen = clone(sequenceGen());
  gen.steps[0]!.label = 'According to the National Archives';
  const report = validate(gen);
  assert.equal(report.publishable, false);
  assert.deepEqual(failedIds(report), ['schema.gen'], failureDetail(report));
  assert.match(checkOf(report, 'schema.gen').message, /publisher claim/);
  assert.ok((checkOf(report, 'schema.gen').affected ?? []).includes('/steps/0/label'));
});

test('distinct labels stay: two steps sharing one event name fail SEQ-04 alone', () => {
  const gen = clone(sequenceGen());
  gen.steps[1]!.label = 'Delegates meet in Philadelphia';
  gen.steps[2]!.label = 'Delegates meet in Philadelphia';
  const report = expectFailures(validate(gen), ['SEQ-04']);
  assert.deepEqual(checkOf(report, 'SEQ-04').affected, ['/steps/1/label', '/steps/2/label']);
});

test('label length limits stay: an event name over 80 characters fails the structural gate', () => {
  const gen = clone(sequenceGen());
  gen.steps[0]!.label = 'Delegates gather in Philadelphia to debate and draft an entirely new frame of government';
  assert.ok(gen.steps[0]!.label.length > 80, 'fixture label must exceed the frozen 80-character limit');
  const report = validate(gen);
  assert.equal(report.publishable, false);
  assert.equal(checkOf(report, 'schema.gen').passed, false);
});

test('repair authorization: with every check passing, an event-name relabel is NOT authorized', () => {
  const baseline = sequenceGen(); // golden revision 1: all checks pass, nothing unlocks /steps/i/label
  assert.equal(validate(baseline).publishable, true, failureDetail(validate(baseline)));
  const next = clone(baseline);
  next.steps[0]!.label = 'A short event name';
  const c = compareKitRevisions('sequence-v1', baseline, next, { sources: [constitutionSource()] });
  assert.equal(c.passed, false, 'a clean baseline freezes its labels (no retired SEQ-02 unlock)');
  assert.match(c.message, /label/);
});

test('repair authorization: a SEQ-04 duplicate-label finding unlocks exactly the flagged labels', () => {
  const baseline = clone(sequenceGen());
  baseline.steps[1]!.label = 'Convention';
  baseline.steps[3]!.label = 'Convention';
  const rev1 = validate(baseline);
  assert.deepEqual(failedIds(rev1), ['SEQ-04'], failureDetail(rev1));
  const next = clone(baseline);
  next.steps[1]!.label = 'Delegates meet in Philadelphia';
  const c = compareKitRevisions('sequence-v1', baseline, next, { sources: [constitutionSource()] });
  assert.equal(c.passed, true, c.message);
  assert.equal(validate(next).publishable, true, failureDetail(validate(next)));
  // The OTHER duplicate stays frozen: changing a step the authority did not name is rejected.
  const overreach = clone(next);
  overreach.steps[3]!.quote = 'the Convention would draft an entirely new frame of government, revised';
  const c2 = compareKitRevisions('sequence-v1', baseline, overreach, { sources: [constitutionSource()] });
  assert.equal(c2.passed, false, 'a label finding never unlocks a quote');
});
