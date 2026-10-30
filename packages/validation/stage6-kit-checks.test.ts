// S6-V — one failing fixture per Stage 6 kit check id (overview, quiz, sequence, sort, concept
// map, compare). Each mutation keeps the gen schema-valid (the Ajv gate must pass) and the
// expected failing id set is asserted EXACTLY where the design allows isolation; where two checks
// share a substring rule by construction (Q-05/Q-07) the co-failure is pinned and documented.
// Run: node --test packages/validation/stage6-kit-checks.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';

import { validateKitComponent } from './kit/index.ts';
import { labelInQuoteOrParagraph } from './kit/sort.ts';
import { buildSourceIndex } from './kit/shared.ts';
import { orderSignals } from './kit/sequence.ts';
import {
  atmosphereSource, checkOf, clone, conceptMapGen, compareGen, constitutionSource, dragSource,
  expectFailures, failedIds, nijSource, numberedSequenceGen, NUMBERED_SOURCE, quizGen,
  ROCK_SORT_SOURCE, rockSortGen, sequenceGen, sortGen, THREE_ENTITY_SOURCE, threeEntityCompareGen,
  overviewGen, repairedOverviewGen,
} from './fixtures/stage6.ts';

/** The OV fixtures mutate an OV-06-clean baseline so each mutation fails in isolation. */
const ovBase = repairedOverviewGen;

test('the repaired overview baseline passes every OV check (isolates the mutations below)', () => {
  const report = validateKitComponent('overview-v1', ovBase(), [dragSource()]);
  assert.deepEqual(failedIds(report), [], report.checks.filter(c => !c.passed).map(c => c.message).join('\n'));
});

/* ------------------------------------------------------------------ */
/* OV-01..OV-06                                                        */
/* ------------------------------------------------------------------ */

test('OV-01: a fabricated overview quote fails grounding alone', () => {
  const gen = clone(ovBase());
  gen.keyPoints[0]!.quote = 'The drag equation collects density and area factors for drag.'; // keeps OV-06 overlap
  expectFailures(validateKitComponent('overview-v1', gen, [dragSource()]), ['OV-01']);
});

test('OV-02: a fabricated term fails; the sentence fallback grounds truncated quotes', () => {
  const gen = clone(ovBase());
  gen.keyTerms[1]!.term = 'fabricated notion';
  expectFailures(validateKitComponent('overview-v1', gen, [dragSource()]), ['OV-02']);
  // The golden's "dynamic pressure" term is NOT inside its quote but IS inside the source
  // sentence containing the quote — the fallback grounds it (OV-02 passes on the golden).
  const idx = buildSourceIndex([dragSource()]);
  const sentence = idx.sentenceOf('density times the square of the velocity divided by two', 'nasa-grc-drag-equation');
  assert.ok(sentence !== null && sentence.toLowerCase().includes('dynamic pressure'));
});

test('OV-03: publisher phrasing in AI overview text fails alone', () => {
  const gen = clone(ovBase());
  gen.headline = 'According to NASA, drag rises with speed squared and air density.';
  expectFailures(validateKitComponent('overview-v1', gen, [dragSource()]), ['OV-03']);
});

test('OV-04: an off-page number in AI text fails alone (N-01)', () => {
  const gen = clone(ovBase());
  gen.keyPoints[0]!.point = 'The drag equation collects density, speed, area and coefficient for 123456 aircraft.';
  expectFailures(validateKitComponent('overview-v1', gen, [dragSource()]), ['OV-04']);
});

test('OV-05: counts outside 3-6/3-8 fail alone', () => {
  const gen = clone(ovBase());
  gen.keyPoints.pop();
  expectFailures(validateKitComponent('overview-v1', gen, [dragSource()]), ['OV-05']);
});

test('OV-06: a synonym paraphrase with too little word overlap fails alone', () => {
  const gen = clone(ovBase());
  gen.keyPoints[0]!.point = 'A single formula gathers the aerodynamic variables together neatly.';
  const report = expectFailures(validateKitComponent('overview-v1', gen, [dragSource()]), ['OV-06']);
  assert.deepEqual(checkOf(report, 'OV-06').affected, ['/keyPoints/0/point']);
  assert.match(checkOf(report, 'OV-06').message, /never the quote/);
});

/* ------------------------------------------------------------------ */
/* Q-01..Q-07                                                          */
/* ------------------------------------------------------------------ */

test('Q-01: a fabricated card quote fails alone when the options still match it', () => {
  const gen = clone(quizGen());
  gen.cards[0]!.quote = 'This fabricated line names the drag coefficient only.';
  expectFailures(validateKitComponent('quiz-cards-v1', gen, [dragSource()]), ['Q-01']);
});

test('Q-02: swapping the answer to a non-quoted option fails Q-02 (and Q-07 for the displaced answer)', () => {
  const gen = clone(quizGen());
  gen.cards[0]!.options = ['lift coefficient', 'drag coefficient', 'dynamic pressure'];
  expectFailures(validateKitComponent('quiz-cards-v1', gen, [dragSource()]), ['Q-02', 'Q-07']);
});

test('Q-03: duplicated distractors fail alone', () => {
  const gen = clone(quizGen());
  gen.cards[0]!.options = ['drag coefficient', 'lift coefficient', 'lift coefficient'];
  expectFailures(validateKitComponent('quiz-cards-v1', gen, [dragSource()]), ['Q-03']);
});

test('Q-04: a stem containing the answer fails alone', () => {
  const gen = clone(quizGen());
  gen.cards[0]!.stem = 'Which card names the drag coefficient that collects complex effects?';
  expectFailures(validateKitComponent('quiz-cards-v1', gen, [dragSource()]), ['Q-04']);
});

test('Q-05: two options matching the quote fails Q-05 (Q-07 co-fails by construction)', () => {
  const gen = clone(quizGen());
  gen.cards[0]!.options = ['drag coefficient', 'coefficient', 'dynamic pressure'];
  // Q-05 and Q-07 use the same substring rule, so a distractor that matches the quote always
  // trips both; a zero-match card trips Q-02+Q-05. Q-05 can never fail in isolation — pinned.
  expectFailures(validateKitComponent('quiz-cards-v1', gen, [dragSource()]), ['Q-05', 'Q-07']);
  const zero = clone(quizGen());
  zero.cards[0]!.options = ['lift coefficient', 'dynamic pressure', 'static pressure'];
  expectFailures(validateKitComponent('quiz-cards-v1', zero, [dragSource()]), ['Q-02', 'Q-05']);
});

test('Q-06: an off-page number in stem/hint/options fails alone', () => {
  const gen = clone(quizGen());
  gen.cards[0]!.hint = 'Recall the number 987654 from the page.';
  expectFailures(validateKitComponent('quiz-cards-v1', gen, [dragSource()]), ['Q-06']);
});

test('Q-07: a distractor occurring in the quote fails (with Q-05, see above)', () => {
  const gen = clone(quizGen());
  gen.cards[0]!.options = ['drag coefficient', 'designated', 'dynamic pressure'];
  const report = expectFailures(validateKitComponent('quiz-cards-v1', gen, [dragSource()]), ['Q-05', 'Q-07']);
  assert.ok((checkOf(report, 'Q-07').affected ?? []).includes('/cards/0/options/1'));
});

/* ------------------------------------------------------------------ */
/* SEQ-01..SEQ-06 (SEQ-02 labels-in-quotes retired, Stage 7e)          */
/* ------------------------------------------------------------------ */

test('SEQ-01: a fabricated step quote fails alone', () => {
  const gen = clone(sequenceGen());
  gen.steps[0]!.quote = 'Drafted in secret by delegates in a fabricated sentence.';
  expectFailures(validateKitComponent('sequence-v1', gen, [constitutionSource()]), ['SEQ-01']);
});

test('SEQ-02 retired (Stage 7e): a label that does not occur in its quote is no longer flagged', () => {
  const gen = clone(sequenceGen());
  gen.steps[0]!.label = 'Written behind closed doors';
  const report = validateKitComponent('sequence-v1', gen, [constitutionSource()]);
  assert.ok(!report.checks.some(c => c.id === 'SEQ-02'), 'the retired id must not be emitted, not even as a stub');
  assert.deepEqual(failedIds(report), [], report.checks.filter(c => !c.passed).map(c => c.message).join('\n'));
  assert.equal(report.publishable, true);
});

test('SEQ-03: page-order offsets must strictly ascend in array order', () => {
  const gen = clone(sequenceGen());
  const [s0, s1] = [gen.steps[0]!, gen.steps[1]!];
  gen.steps[0] = s1;
  gen.steps[1] = s0;
  const report = expectFailures(validateKitComponent('sequence-v1', gen, [constitutionSource()]), ['SEQ-03']);
  assert.ok((checkOf(report, 'SEQ-03').affected ?? []).includes('/steps/1/quote'));
});

test('SEQ-03: numbered basis needs ascending order signals in the quotes', () => {
  assert.deepEqual(orderSignals('First, evaporation lifts water vapor upward'), [1]);
  assert.deepEqual(orderSignals('3rd condensation step'), [3]);
  assert.deepEqual(orderSignals('Step 4: collection'), [4]);
  assert.deepEqual(orderSignals('2. condensation'), [2]);
  assert.deepEqual(orderSignals('condensation forms clouds'), []);
  const gen = numberedSequenceGen();
  const ok = validateKitComponent('sequence-v1', gen, [NUMBERED_SOURCE()]);
  assert.deepEqual(failedIds(ok), [], ok.checks.filter(c => !c.passed).map(c => c.message).join('\n'));
  const shuffled = clone(gen);
  const [a, b] = [shuffled.steps[0]!, shuffled.steps[1]!];
  shuffled.steps[0] = b;
  shuffled.steps[1] = a;
  expectFailures(validateKitComponent('sequence-v1', shuffled, [NUMBERED_SOURCE()]), ['SEQ-03']);
  // A quote without any signal fails the numbered basis:
  const noSignal = clone(gen);
  noSignal.steps[2]!.quote = 'precipitation returns water to the land';
  expectFailures(validateKitComponent('sequence-v1', noSignal, [NUMBERED_SOURCE()]), ['SEQ-03']);
});

test('SEQ-04: duplicate labels fail alone', () => {
  const gen = clone(sequenceGen());
  gen.steps[1]!.label = 'Convention';
  gen.steps[3]!.label = 'Convention';
  expectFailures(validateKitComponent('sequence-v1', gen, [constitutionSource()]), ['SEQ-04']);
});

test('SEQ-05: fewer than 4 steps fails alone (count-exempt gate lets the check own it)', () => {
  const gen = clone(sequenceGen());
  gen.steps.pop();
  expectFailures(validateKitComponent('sequence-v1', gen, [constitutionSource()]), ['SEQ-05']);
});

test('SEQ-06: an off-page number in an order hint fails alone', () => {
  const gen = clone(sequenceGen());
  gen.steps[0]!.orderHint = 'Occurs 987654 times';
  expectFailures(validateKitComponent('sequence-v1', gen, [constitutionSource()]), ['SEQ-06']);
});

/* ------------------------------------------------------------------ */
/* SORT-01..SORT-06                                                    */
/* ------------------------------------------------------------------ */

test('SORT-01: a fabricated item quote fails alone', () => {
  const gen = clone(sortGen());
  gen.items[0]!.quote = 'If an individual has two different alleles, the individual is heterozygous (fabricated span).';
  expectFailures(validateKitComponent('sort-groups-v1', gen, [nijSource()]), ['SORT-01']);
});

test('SORT-02: an item label missing from its quote fails alone', () => {
  const gen = clone(sortGen());
  gen.items[0]!.label = 'three different alleles';
  expectFailures(validateKitComponent('sort-groups-v1', gen, [nijSource()]), ['SORT-02']);
});

test('SORT-02: the group label may live in the same paragraph as the quote (computed by our code)', () => {
  // The synthetic rock sort grounds every group label through the paragraph fallback only.
  const ok = validateKitComponent('sort-groups-v1', rockSortGen(), [ROCK_SORT_SOURCE()]);
  assert.deepEqual(failedIds(ok), [], ok.checks.filter(c => !c.passed).map(c => c.message).join('\n'));
  // A group label that occurs nowhere near the quote fails:
  const gen = clone(rockSortGen());
  gen.groups[0]!.label = 'Metamorphic rocks';
  const report = validateKitComponent('sort-groups-v1', gen, [ROCK_SORT_SOURCE()]);
  assert.ok(failedIds(report).includes('SORT-02'));
  // Unit: the shared rule itself.
  const idx = buildSourceIndex([ROCK_SORT_SOURCE()]);
  assert.equal(labelInQuoteOrParagraph('Igneous rocks', 'A granite sample cools slowly underground, forming large crystals', 'rock-sort', idx), true);
  assert.equal(labelInQuoteOrParagraph('Metamorphic rocks', 'A granite sample cools slowly underground, forming large crystals', 'rock-sort', idx), false);
});

test('SORT-03: an unknown groupId fails alone while the group minimums hold', () => {
  const gen = clone(sortGen());
  gen.items[0]!.groupId = 'unknown-group';
  expectFailures(validateKitComponent('sort-groups-v1', gen, [nijSource()]), ['SORT-03']);
});

test('SORT-04: duplicate item labels fail alone', () => {
  const gen = clone(sortGen());
  gen.items[0]!.label = 'individual';
  gen.items[3]!.label = 'individual';
  expectFailures(validateKitComponent('sort-groups-v1', gen, [nijSource()]), ['SORT-04']);
});

test('SORT-05: fewer than 6 items fails alone', () => {
  const gen = clone(sortGen());
  gen.items.pop();
  expectFailures(validateKitComponent('sort-groups-v1', gen, [nijSource()]), ['SORT-05']);
});

test('SORT-06: an off-page number in the title fails alone', () => {
  const gen = clone(sortGen());
  gen.title = 'Genotype vocabulary sort 987654';
  expectFailures(validateKitComponent('sort-groups-v1', gen, [nijSource()]), ['SORT-06']);
});

/* ------------------------------------------------------------------ */
/* CM-01..CM-06                                                        */
/* ------------------------------------------------------------------ */

test('CM-01: a fabricated link quote fails alone', () => {
  const gen = clone(conceptMapGen());
  gen.links[0]!.quote = 'drag D equals the coefficient Cd times density rho in a fabricated line';
  expectFailures(validateKitComponent('concept-map-v1', gen, [dragSource()]), ['CM-01']);
});

test('CM-02: an endpoint label found nowhere fails alone', () => {
  const gen = clone(conceptMapGen());
  gen.nodes[1]!.label = 'fabricated concept';
  expectFailures(validateKitComponent('concept-map-v1', gen, [dragSource()]), ['CM-02']);
});

test('CM-03: a relation with no grounding trigger in quote or sentence fails alone', () => {
  const gen = clone(conceptMapGen());
  gen.links[0]!.relation = 'contrasts with';
  expectFailures(validateKitComponent('concept-map-v1', gen, [dragSource()]), ['CM-03']);
});

test('CM-04: an isolated node breaks connectivity alone; self-loops and duplicates fail', () => {
  const gen = clone(conceptMapGen());
  gen.nodes.push({ id: 'pressure', label: 'pressure' });
  expectFailures(validateKitComponent('concept-map-v1', gen, [dragSource()]), ['CM-04']);
  const loop = clone(conceptMapGen());
  loop.links[2]!.toId = 'drag'; // self-loop (drag -> drag)
  assert.ok(failedIds(validateKitComponent('concept-map-v1', loop, [dragSource()])).includes('CM-04'));
  const dup = clone(conceptMapGen());
  dup.links.push({ id: 'link-density-drag', fromId: 'density', toId: 'drag', relation: 'uses', sourceId: 'nasa-grc-drag-equation', quote: 'drag D is equal to the drag coefficient Cd times the density rho' });
  assert.ok(failedIds(validateKitComponent('concept-map-v1', dup, [dragSource()])).includes('CM-04'));
  const dangling = clone(conceptMapGen());
  dangling.links[0]!.fromId = 'no-such-node';
  assert.ok(failedIds(validateKitComponent('concept-map-v1', dangling, [dragSource()])).includes('CM-04'));
});

test('CM-05: dropping a link and its leaf node fails counts alone', () => {
  const gen = clone(conceptMapGen());
  gen.links.pop();
  gen.nodes.pop(); // 'reference-area' was only used by the popped link
  expectFailures(validateKitComponent('concept-map-v1', gen, [dragSource()]), ['CM-05']);
});

test('CM-06: an off-page number in the title fails alone', () => {
  const gen = clone(conceptMapGen());
  gen.title = 'Drag factors map 987654';
  expectFailures(validateKitComponent('concept-map-v1', gen, [dragSource()]), ['CM-06']);
});

/* ------------------------------------------------------------------ */
/* CT-01..CT-05 (Stage 6 compare-grid: rows of values, code-built grid) */
/* ------------------------------------------------------------------ */

test('CT-01: a fabricated cell quote fails alone', () => {
  const gen = clone(compareGen());
  gen.rows[0]!.values[0]!.quote = 'In the troposphere the temperature decreases linearly, in a fabricated ending.';
  expectFailures(validateKitComponent('compare-table-v1', gen, [atmosphereSource()]), ['CT-01']);
});

test('CT-02: a cell value missing from its quote fails alone', () => {
  const gen = clone(compareGen());
  gen.rows[0]!.values[0]!.value = 'temperature increases linearly';
  const report = expectFailures(validateKitComponent('compare-table-v1', gen, [atmosphereSource()]), ['CT-02']);
  assert.ok(checkOf(report, 'CT-02').affected?.includes('/rows/0/values/0/value'));
  assert.ok(checkOf(report, 'CT-02').affected?.includes('/rows/0/values/0/quote'));
});

test('CT-02: an entity absent from quote and paragraph fails alone with the row entity path', () => {
  const gen = clone(threeEntityCompareGen());
  gen.rows[1]!.entity = 'Basalt rock'; // not in the compare-three text at all
  const report = expectFailures(validateKitComponent('compare-table-v1', gen, [THREE_ENTITY_SOURCE()]), ['CT-02']);
  assert.ok(checkOf(report, 'CT-02').affected?.includes('/rows/1/entity'));
});

test('CT-03: a short row fails the shape check alone with the precise per-row message', () => {
  const gen = clone(compareGen());
  gen.rows[1]!.values.pop();
  const report = expectFailures(validateKitComponent('compare-table-v1', gen, [atmosphereSource()]), ['CT-03']);
  assert.match(checkOf(report, 'CT-03').message, /rows\[1\] has 1 values; it needs one per column \(2\)/);
  assert.ok(checkOf(report, 'CT-03').affected?.includes('/rows/1/values'));
});

test('CT-03: duplicate entity names are a shape problem', () => {
  const gen = clone(threeEntityCompareGen());
  gen.rows[1]!.entity = 'Alpha rock';
  const report = expectFailures(validateKitComponent('compare-table-v1', gen, [THREE_ENTITY_SOURCE()]), ['CT-03']);
  assert.match(checkOf(report, 'CT-03').message, /occurs more than once/);
  assert.ok(checkOf(report, 'CT-03').affected?.includes('/rows/1/entity'));
});

test('CT-03: duplicate attribute names are a shape problem', () => {
  const gen = clone(threeEntityCompareGen());
  gen.attributes[1] = 'texture';
  const report = expectFailures(validateKitComponent('compare-table-v1', gen, [THREE_ENTITY_SOURCE()]), ['CT-03']);
  assert.match(checkOf(report, 'CT-03').message, /attributes\[1\] "texture" occurs more than once/);
  assert.ok(checkOf(report, 'CT-03').affected?.includes('/attributes/1'));
});

test('CT-03: a row count outside 2-4 fails alone', () => {
  const gen = clone(threeEntityCompareGen());
  gen.rows.pop();
  gen.rows.pop();
  const report = expectFailures(validateKitComponent('compare-table-v1', gen, [THREE_ENTITY_SOURCE()]), ['CT-03']);
  assert.match(checkOf(report, 'CT-03').message, /rows has 1 entries, expected 2-4/);
  assert.ok(checkOf(report, 'CT-03').affected?.includes('/rows'));
});

test('schema.gen: id-like entity names from the live failures are caught (page-wording rule)', () => {
  // The real Spark Open failures: entities written as ids that never occur on the page.
  for (const idLike of ['this-equation', 'constant-pressure-process', 'starting-at-age-14']) {
    const gen = clone(compareGen());
    gen.rows[0]!.entity = idLike;
    const report = validateKitComponent('compare-table-v1', gen, [atmosphereSource()]);
    const gate = checkOf(report, 'schema.gen');
    assert.equal(gate.passed, false, `"${idLike}" must fail schema.gen`);
    assert.match(gate.message, new RegExp(`rows\\[0\\]\\.entity "${idLike}" looks like an id; use the words the page uses`));
    assert.ok(gate.affected?.includes('/rows/0/entity'), `"${idLike}" must unlock /rows/0/entity`);
    assert.equal(report.publishable, false);
  }
});

test('schema.gen: kebab-case and underscore attribute names are caught too', () => {
  const kebab = clone(compareGen());
  kebab.attributes[1] = 'air-pressure';
  const r1 = validateKitComponent('compare-table-v1', kebab, [atmosphereSource()]);
  assert.equal(checkOf(r1, 'schema.gen').passed, false);
  assert.match(checkOf(r1, 'schema.gen').message, /attributes\[1\] "air-pressure" looks like an id; use the words the page uses/);
  assert.ok(checkOf(r1, 'schema.gen').affected?.includes('/attributes/1'));
  const underscore = clone(compareGen());
  underscore.attributes[0] = 'air_temperature';
  const r2 = validateKitComponent('compare-table-v1', underscore, [atmosphereSource()]);
  assert.equal(checkOf(r2, 'schema.gen').passed, false);
  assert.ok(checkOf(r2, 'schema.gen').affected?.includes('/attributes/0'));
  // Ordinary page words with hyphens or spaces are NOT ids:
  const fine = clone(compareGen());
  fine.attributes[0] = 'temperature trend';
  assert.equal(checkOf(validateKitComponent('compare-table-v1', fine, [atmosphereSource()]), 'schema.gen').passed, true);
});

test('CT-04: an off-page number in the title fails alone', () => {
  const gen = clone(compareGen());
  gen.title = 'Atmosphere zones compare 987654';
  expectFailures(validateKitComponent('compare-table-v1', gen, [atmosphereSource()]), ['CT-04']);
});

test('CT-05: never fails — a 3-entity column enables predict mode, otherwise reveal-only', () => {
  const reveal = validateKitComponent('compare-table-v1', compareGen(), [atmosphereSource()]);
  assert.equal(checkOf(reveal, 'CT-05').passed, true);
  assert.match(checkOf(reveal, 'CT-05').message, /reveal-only/);
  const predict = validateKitComponent('compare-table-v1', threeEntityCompareGen(), [THREE_ENTITY_SOURCE()]);
  assert.deepEqual(failedIds(predict), [], predict.checks.filter(c => !c.passed).map(c => c.message).join('\n'));
  assert.equal(checkOf(predict, 'CT-05').passed, true);
  assert.match(checkOf(predict, 'CT-05').message, /predict mode is available/);
});
