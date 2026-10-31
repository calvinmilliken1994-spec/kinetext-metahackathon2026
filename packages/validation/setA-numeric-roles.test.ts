// Set A (reviews B-02, B-03, B-04, B2-04a/b/c, W-02): numbers and words EXIST on the page, but what do they
// MEAN? These tests pin the role bindings added under EXISTING check ids:
//   LOG-03  the scale's direction (`increasing` + effectPhrase) is bound to a catalogue of known scales,
//           or stated by the cited quote; the amplitude factor cannot be reused for energy;
//   LOG-06  rung span and case steps are capped (the view must never be asked for millions of ticks);
//   LOG-07  the number that NAMES a rung (the one after the quantity word) must equal its value;
//   LOG-04 / DT-03 / TH-02 / TH-03  a number continues past the quote's edge in the SOURCE: rejected;
//   TH-04   "N of M body": total = M, required = N, body word matches; TH-07 a fraction is at most 1;
//   table parsing and grounding share one minus-sign grammar (U+2212, U+FF0D, U+FE63).
// Run: node --test packages/validation/setA-numeric-roles.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';

import type { DataTableGen, LogLadderGen, ThresholdGen } from '../contracts/kit.ts';
import type { SourceDocument } from '../contracts/index.ts';
import { parseTableNumber } from '../kit-engines/table.ts';
import { loadSource } from '../sources/index.ts';
import { validateKitComponent } from './kit/index.ts';
import { valueAsPrintedIn } from './kit/data-table.ts';
import { signedNumberTokens, quoteEdgeCutsNumber } from './kit/shared.ts';
import { scaleDirectionProblems } from './kit/log-scales.ts';
import { checkOf, clone, failedIds, failureDetail, stage6Fixture, synthSource } from './fixtures/stage6.ts';

const quakeSource = (): SourceDocument => loadSource('usgs-earthquake-magnitude-energy-intensity');
const phSource = (): SourceDocument => loadSource('usgs-wss-ph-and-water');
const validateLadder = (gen: LogLadderGen, sources: SourceDocument[]) => validateKitComponent('log-ladder-v1', gen, sources);
const quakeGolden = (): LogLadderGen => stage6Fixture<LogLadderGen>('log-ladder.gen.json');

/* ------------------------------------------------------------------ */
/* LOG-03 direction                                                    */
/* ------------------------------------------------------------------ */

test('B-02: the earthquake golden is clean; the same quote with increasing flipped is rejected by LOG-03', () => {
  assert.deepEqual(failedIds(validateLadder(quakeGolden(), [quakeSource()])), []);
  const flipped = quakeGolden();
  flipped.increasing = false; // "magnitude 6.3 has LESS amplitude than 5.3"
  const report = validateLadder(flipped, [quakeSource()]);
  assert.deepEqual(failedIds(report), ['LOG-03'], failureDetail(report));
  const c = checkOf(report, 'LOG-03');
  assert.match(c.message, /higher/i);
  assert.match(c.message, /amplitude/i);
  assert.ok((c.affected ?? []).includes('/increasing'), (c.affected ?? []).join(', '));
});

test('B-02: pH catalogue — "more acidic" needs increasing=false, "less acidic" needs true', () => {
  const base = (): LogLadderGen => ({
    schemaVersion: 'log-ladder-v1',
    title: 'The pH ladder',
    quantity: 'pH',
    factor: 10,
    factorText: 'ten times',
    effectPhrase: 'more acidic',
    increasing: false,
    sourceId: 'usgs-wss-ph-and-water',
    quote: 'Water with a pH of five is ten times more acidic than water having a pH of six.',
    rungs: [
      { id: 'mine', label: 'acid mine drainage', value: 2, sourceId: 'usgs-wss-ph-and-water', quote: 'water coming out of an abandoned coal mine can have a pH of 2, which is very acidic' },
      { id: 'rain', label: 'normal rainfall', value: 5.6, sourceId: 'usgs-wss-ph-and-water', quote: 'Normal rainfall has a pH of about 5.6—slightly acidic due to carbon dioxide gas from the atmosphere.' },
    ],
    cases: [{ id: 'mine-to-rain', fromValue: 2, toValue: 5.6 }],
  });
  assert.deepEqual(failedIds(validateLadder(base(), [phSource()])), []);
  const wrong = base();
  wrong.increasing = true;
  assert.deepEqual(failedIds(validateLadder(wrong, [phSource()])), ['LOG-03']);
  // "less acidic" flips the polarity: a higher pH is less acidic, so increasing=true is right
  const less = base();
  less.effectPhrase = 'less acidic';
  less.increasing = true;
  less.quote = 'Water with a pH of five is ten times more acidic than water having a pH of six.';
  const r = validateLadder(less, [phSource()]);
  assert.equal(checkOf(r, 'LOG-03').passed, true, checkOf(r, 'LOG-03').message);
});

test('B-02: the amplitude factor cannot be reused for energy release (ladder-amplitude-as-energy)', () => {
  const gen = quakeGolden();
  gen.effectPhrase = 'more energy release';
  const report = validateLadder(gen, [quakeSource()]);
  assert.ok(failedIds(report).includes('LOG-03'), failureDetail(report));
  assert.match(checkOf(report, 'LOG-03').message, /energy/i);
  // the real 32-times energy ladder of the same page stays clean
  const energy = quakeGolden();
  energy.factor = 32;
  energy.factorText = '32 times';
  energy.effectPhrase = 'more energy release';
  energy.quote = 'each whole number increase in magnitude represents a tenfold increase in the measured amplitude, it represents an 32 times more energy release.';
  assert.deepEqual(failedIds(validateLadder(energy, [quakeSource()])), []);
});

const SYNTH = 'The Zork scale grows quickly. Each step of the Zork scale is 5 times more energetic than the step below. ' +
  'A level 3 storm is common. A level 4 storm is rare. A level 5 storm is a rarity. ' +
  'Starlight is graded by apparent magnitude: each whole step is 2.5 times dimmer, so magnitude 1 stars are brighter than magnitude 2 stars. ' +
  'A magnitude 1 star is bright. A magnitude 2 star is dimmer. A magnitude 3 star is faint. ' +
  'Sound is measured by loudness in decibels: a sound of 40 decibels is quiet, and 50 decibels is ten times more intense; 60 decibels is loud.';
const synth = (): SourceDocument => synthSource('setA-synth', 'Synthetic scales', SYNTH);
function zorkGen(): LogLadderGen {
  return {
    schemaVersion: 'log-ladder-v1', title: 'The Zork ladder', quantity: 'Zork scale', factor: 5, factorText: '5 times',
    effectPhrase: 'more energetic', increasing: true, sourceId: 'setA-synth',
    quote: 'Each step of the Zork scale is 5 times more energetic than the step below.',
    rungs: [
      { id: 'r3', label: 'common storm', value: 3, sourceId: 'setA-synth', quote: 'A level 3 storm is common.' },
      { id: 'r4', label: 'rare storm', value: 4, sourceId: 'setA-synth', quote: 'A level 4 storm is rare.' },
      { id: 'r5', label: 'rarity storm', value: 5, sourceId: 'setA-synth', quote: 'A level 5 storm is a rarity.' },
    ],
    cases: [{ id: 'c1', fromValue: 3, toValue: 5 }],
  };
}

test('B-02: a scale outside the catalogue must have its direction stated by the quote (effect words + a comparison word)', () => {
  assert.deepEqual(failedIds(validateLadder(zorkGen(), [synth()])), []);
  const noWords = zorkGen();
  noWords.effectPhrase = 'less dangerous'; // not in the cited quote
  const r1 = validateLadder(noWords, [synth()]);
  assert.deepEqual(failedIds(r1), ['LOG-03'], failureDetail(r1));
  assert.match(checkOf(r1, 'LOG-03').message, /quote/i);
  assert.ok((checkOf(r1, 'LOG-03').affected ?? []).includes('/effectPhrase'));
  // an effect that no comparison word anywhere places on the scale states no direction
  const direct = scaleDirectionProblems({ quantity: 'Plink scale', effectPhrase: 'storm count', increasing: true, factor: 7, quote: 'On the Plink scale, each step multiplies the storm count by 7.', context: '' });
  assert.equal(direct.length, 1);
  assert.match(direct[0]!.message, /comparison word/);
  const withWord = scaleDirectionProblems({ quantity: 'Plink scale', effectPhrase: 'more storms', increasing: true, factor: 7, quote: 'On the Plink scale, each step gives 7 times more storms.', context: '' });
  assert.deepEqual(withWord, []);
});

test('B-02: stellar magnitude is catalogued separately from earthquake magnitude (higher = dimmer)', () => {
  const star = (): LogLadderGen => ({
    schemaVersion: 'log-ladder-v1', title: 'Star brightness', quantity: 'magnitude', factor: 2.5, factorText: '2.5 times',
    effectPhrase: 'dimmer', increasing: true, sourceId: 'setA-synth',
    quote: 'Starlight is graded by apparent magnitude: each whole step is 2.5 times dimmer, so magnitude 1 stars are brighter than magnitude 2 stars.',
    rungs: [
      { id: 'm1', label: 'bright star', value: 1, sourceId: 'setA-synth', quote: 'A magnitude 1 star is bright.' },
      { id: 'm2', label: 'dimmer star', value: 2, sourceId: 'setA-synth', quote: 'A magnitude 2 star is dimmer.' },
      { id: 'm3', label: 'faint star', value: 3, sourceId: 'setA-synth', quote: 'A magnitude 3 star is faint.' },
    ],
    cases: [{ id: 'c1', fromValue: 1, toValue: 3 }],
  });
  assert.deepEqual(failedIds(validateLadder(star(), [synth()])), []);
  const wrong = star();
  wrong.increasing = false; // would say a HIGHER magnitude star is brighter
  const r = validateLadder(wrong, [synth()]);
  assert.deepEqual(failedIds(r), ['LOG-03'], failureDetail(r));
  assert.match(checkOf(r, 'LOG-03').message, /dimmer|fainter|brighter/i);
});

test('B-02: decibels — louder/more intense grows with the value', () => {
  const db = (): LogLadderGen => ({
    schemaVersion: 'log-ladder-v1', title: 'Loudness', quantity: 'decibels', factor: 10, factorText: 'ten times',
    effectPhrase: 'more intense', increasing: true, sourceId: 'setA-synth',
    quote: 'a sound of 40 decibels is quiet, and 50 decibels is ten times more intense; 60 decibels is loud.',
    rungs: [
      { id: 'd40', label: 'quiet', value: 40, sourceId: 'setA-synth', quote: 'a sound of 40 decibels is quiet' },
      { id: 'd50', label: 'louder sound', value: 50, sourceId: 'setA-synth', quote: '50 decibels is ten times more intense' },
    ],
    cases: [{ id: 'c1', fromValue: 40, toValue: 50 }],
  });
  assert.deepEqual(failedIds(validateLadder(db(), [synth()])), []);
  const wrong = db();
  wrong.increasing = false;
  assert.deepEqual(failedIds(validateLadder(wrong, [synth()])), ['LOG-03']);
});

/* ------------------------------------------------------------------ */
/* LOG-07 the rung's own number                                        */
/* ------------------------------------------------------------------ */

test('B-02: "Magnitude 6.3, 5.3 times stronger" on the 5.3 rung is rejected (a number elsewhere cannot rescue the rung)', () => {
  const gen = quakeGolden();
  gen.rungs[0]!.label = 'Magnitude 6.3, 5.3 times stronger'; // the rung sits at 5.3, the label names 6.3
  const report = validateLadder(gen, [quakeSource()]);
  assert.ok(failedIds(report).includes('LOG-07'), failureDetail(report));
  const c = checkOf(report, 'LOG-07');
  assert.match(c.message, /6\.3/);
  assert.match(c.message, /5\.3/);
  assert.ok((c.affected ?? []).includes('/rungs/0/label'));
  // the same rung named correctly passes: its own number follows the scale word
  const ok = quakeGolden();
  ok.rungs[0]!.label = 'Magnitude 5.3, below magnitude 6.3';
  assert.equal(checkOf(validateLadder(ok, [quakeSource()]), 'LOG-07').passed, true);
});

/* ------------------------------------------------------------------ */
/* LOG-06 caps                                                         */
/* ------------------------------------------------------------------ */

test('B2-04c/W-03: more than 60 whole steps per case or across the rungs is rejected by LOG-06', () => {
  const text = 'Each step of the Fine scale is 1.01 times larger. A level 0 sample is clear. A level 10 sample is cloudy. A level 100 sample is dark.';
  const src = synthSource('setA-fine', 'Fine', text);
  const gen = (): LogLadderGen => ({
    schemaVersion: 'log-ladder-v1', title: 'Fine ladder', quantity: 'Fine scale', factor: 1.01, factorText: '1.01 times',
    effectPhrase: 'larger', increasing: true, sourceId: 'setA-fine', quote: 'Each step of the Fine scale is 1.01 times larger.',
    rungs: [
      { id: 'l0', label: 'clear sample', value: 0, sourceId: 'setA-fine', quote: 'A level 0 sample is clear.' },
      { id: 'l10', label: 'cloudy sample', value: 10, sourceId: 'setA-fine', quote: 'A level 10 sample is cloudy.' },
    ],
    cases: [{ id: 'c1', fromValue: 0, toValue: 10 }],
  });
  assert.deepEqual(failedIds(validateLadder(gen(), [src])), []);
  const wide = gen();
  wide.rungs.push({ id: 'l100', label: 'dark sample', value: 100, sourceId: 'setA-fine', quote: 'A level 100 sample is dark.' });
  const spanReport = validateLadder(wide, [src]);
  assert.deepEqual(failedIds(spanReport), ['LOG-06'], failureDetail(spanReport));
  assert.match(checkOf(spanReport, 'LOG-06').message, /60/);
  const longCase = clone(wide);
  longCase.cases[0] = { id: 'c1', fromValue: 0, toValue: 100 };
  const caseReport = validateLadder(longCase, [src]);
  const msg = checkOf(caseReport, 'LOG-06').message;
  assert.match(msg, /c1/);
  assert.ok((checkOf(caseReport, 'LOG-06').affected ?? []).includes('/cases/0/toValue'));
});

/* ------------------------------------------------------------------ */
/* Number edges at the quote boundary                                  */
/* ------------------------------------------------------------------ */

test('B-04: a number cut at the quote edge is detected from the SOURCE (digit, decimal, grouping, sign)', () => {
  const src = 'Alpha rock has mass 120 grams. Beta rock mass is 12,104 km. Gamma is 5.3 big. Delta is -7 deep. Range 2-3 apples. Eps is \u2212120 g.';
  assert.equal(quoteEdgeCutsNumber('12', 'Alpha rock has mass 12', src), true, 'digit continues');
  assert.equal(quoteEdgeCutsNumber('12', 'Alpha rock has mass 120', src), false, 'complete token');
  assert.equal(quoteEdgeCutsNumber('12', 'Beta rock mass is 12', src), true, 'grouping continues');
  assert.equal(quoteEdgeCutsNumber('104', 'is 12,104 km. Gamma', src), false, 'complete grouped token inside the quote');
  assert.equal(quoteEdgeCutsNumber('104', '104 km. Gamma is', src), true, 'quote starts mid-grouping');
  assert.equal(quoteEdgeCutsNumber('5', 'Gamma is 5', src), true, 'decimal continues');
  assert.equal(quoteEdgeCutsNumber('3', '3 big. Delta', src), true, 'quote starts after the decimal point');
  assert.equal(quoteEdgeCutsNumber('7', '7 deep. Range', src), true, 'cut sign');
  assert.equal(quoteEdgeCutsNumber('3', '3 apples. Eps', src), false, 'a range hyphen is not a sign');
  assert.equal(quoteEdgeCutsNumber('120', '120 g.', src), true, 'cut unicode minus');
  assert.equal(quoteEdgeCutsNumber('120', 'mass 120', 'no match here'), false, 'quote not found: LD/quote checks own that');
});

test('B-04 table-source-token-cut: value 12 from the quote "...| 12" cut out of 12,104 fails DT-03', () => {
  const gen = stage6Fixture<DataTableGen>('data-table.gen.json');
  const i = gen.rows.findIndex(r => r.label === 'VENUS');
  const cut = clone(gen);
  cut.rows[i]!.values[1]!.value = '12';
  cut.rows[i]!.values[1]!.quote = '| Diameter (km) | 4879 | 12';
  const source = loadSource('nasa-nssdc-planetary-fact-sheet-metric');
  const report = validateKitComponent('data-table-v1', cut, [source]);
  assert.ok(failedIds(report).includes('DT-03'), failureDetail(report));
  assert.match(checkOf(report, 'DT-03').message, /12,104|continues|longer/i);
  assert.ok((checkOf(report, 'DT-03').affected ?? []).includes(`/rows/${i}/values/1/quote`));
  assert.deepEqual(failedIds(validateKitComponent('data-table-v1', gen, [source])), [], 'the golden stays clean');
});

test('B-04: the as-printed rule treats U+2212, U+FF0D and U+FE63 as signs like ASCII "-"', () => {
  for (const minus of ['-', '\u2212', '\uFF0D', '\uFE63']) {
    const r = valueAsPrintedIn('120', `Alpha rock has mass ${minus}120 g`);
    assert.equal(r.ok, false, `U+${minus.charCodeAt(0).toString(16)} before the number is a sign`);
    assert.equal(valueAsPrintedIn(`${minus}120`, `Alpha rock has mass ${minus}120 g`).ok, true);
  }
});

test('B2-04a: table parsing and grounding share one minus grammar; the code-point slips (F, low line) are not minus signs', () => {
  assert.equal(parseTableNumber('\u22125'), -5);
  assert.equal(parseTableNumber('\uFF0D5'), -5);
  assert.equal(parseTableNumber('\uFE635'), -5);
  assert.equal(parseTableNumber('-5'), -5);
  assert.equal(parseTableNumber('\uFF265'), null, 'fullwidth capital F is a letter');
  assert.equal(parseTableNumber('\uFF3F12'), null, 'fullwidth low line is not a minus');
  assert.deepEqual(signedNumberTokens('mass \uFF0D5 and \uFE637 and \u22129').map(t => t.value), ['-5', '-7', '-9']);
});

test('B-04: a rung value cut at the quote edge fails LOG-04 (magnitude 5 cut from 5.3)', () => {
  const gen = quakeGolden();
  gen.rungs[0]!.value = 5;
  gen.rungs[0]!.quote = 'a magnitude 5';
  gen.cases[0] = { id: 'case-1', fromValue: 5, toValue: 6.3 };
  const report = validateLadder(gen, [quakeSource()]);
  assert.ok(failedIds(report).includes('LOG-04'), failureDetail(report));
  assert.match(checkOf(report, 'LOG-04').message, /5\.3|continues/);
});

/* ------------------------------------------------------------------ */
/* Threshold roles                                                     */
/* ------------------------------------------------------------------ */

const naraSource = (): SourceDocument => loadSource('nara-constitutional-amendment-process');
const thGolden = (): ThresholdGen => stage6Fixture<ThresholdGen>('threshold.gen.json');
const validateTh = (gen: ThresholdGen) => validateKitComponent('threshold-v1', gen, [naraSource()]);

test('B-03: the golden "three-fourths of the States (38 of 50 States)" stays clean', () => {
  assert.deepEqual(failedIds(validateTh(thGolden())), []);
});

test('B-03: required-count-as-total — total 38, fraction 3/4 — is rejected: the total is the M of "38 of 50"', () => {
  const gen = thGolden();
  gen.stages[0]!.total = 38;
  gen.stages[0]!.statedCount = 0;
  gen.scenarios[0]!.yes = [30];
  const report = validateTh(gen);
  assert.ok(failedIds(report).includes('TH-04'), failureDetail(report));
  const c = checkOf(report, 'TH-04');
  assert.match(c.message, /50/);
  assert.ok((c.affected ?? []).includes('/stages/0/total'), (c.affected ?? []).join(', '));
});

test('B-03: total-as-required-count — count rule with 50 — is rejected: the required count is the N of "38 of 50"', () => {
  const gen = thGolden();
  gen.stages[0]!.rule = 'count';
  gen.stages[0]!.numerator = 0;
  gen.stages[0]!.denominator = 0;
  gen.stages[0]!.statedCount = 50;
  gen.scenarios[0]!.yes = [50];
  const report = validateTh(gen);
  assert.ok(failedIds(report).includes('TH-04'), failureDetail(report));
  assert.match(checkOf(report, 'TH-04').message, /38/);
});

test('B-03: statedCount 0 cannot suppress the check — the engine\'s required count must equal N', () => {
  const gen = thGolden();
  gen.stages[0]!.denominator = 5; // 3/5 of 50 = 30, but the page says 38 (the quote spelling check also fails)
  gen.stages[0]!.statedCount = 0;
  const report = validateTh(gen);
  assert.ok(failedIds(report).includes('TH-04'), failureDetail(report));
});

test('B-03: threshold-wrong-body — States changed to Senators — is rejected', () => {
  const gen = thGolden();
  gen.stages[0]!.body = 'Senators';
  const report = validateTh(gen);
  assert.deepEqual(failedIds(report), ['TH-04'], failureDetail(report));
  const c = checkOf(report, 'TH-04');
  assert.match(c.message, /Senators/);
  assert.match(c.message, /States/);
  assert.ok((c.affected ?? []).includes('/stages/0/body'));
  const plural = thGolden();
  plural.stages[0]!.body = 'Ratifying state legislatures'; // singular/plural of the page's body word is fine
  assert.deepEqual(failedIds(validateTh(plural)), []);
});

test('B-03: "N out of M" is read like "N of M"', () => {
  const text = 'A proposed amendment is ratified by three-fourths of the States, that is 38 out of 50 States.';
  const src = synthSource('setA-th', 'Synthetic amendment', text);
  const gen = thGolden();
  gen.stages[0]!.sourceId = 'setA-th';
  gen.stages[0]!.quote = text;
  gen.stages[0]!.totalQuote = text;
  assert.deepEqual(failedIds(validateKitComponent('threshold-v1', gen, [src])), []);
  gen.stages[0]!.total = 38;
  gen.stages[0]!.statedCount = 0;
  gen.scenarios[0]!.yes = [30];
  assert.ok(failedIds(validateKitComponent('threshold-v1', gen, [src])).includes('TH-04'));
});

test('B2-04b: a fraction above 1 (5/4) is rejected by TH-07', () => {
  const text = 'The board needs five-fourths of the 10 members to pass it.';
  const src = synthSource('setA-th2', 'Synthetic', text);
  const gen = thGolden();
  Object.assign(gen.stages[0]!, { sourceId: 'setA-th2', quote: text, totalQuote: text, total: 10, numerator: 5, denominator: 4, statedCount: 0, body: 'members' });
  gen.scenarios[0]!.yes = [10];
  const report = validateKitComponent('threshold-v1', gen, [src]);
  assert.ok(failedIds(report).includes('TH-07'), failureDetail(report));
  assert.match(checkOf(report, 'TH-07').message, /at most 1|greater than|above/i);
  assert.ok((checkOf(report, 'TH-07').affected ?? []).includes('/stages/0/numerator'));
});

test('B-04: a threshold total cut at the quote edge fails TH-02 ("38 of 5" cut from "38 of 50")', () => {
  const gen = thGolden();
  gen.stages[0]!.total = 5;
  gen.stages[0]!.totalQuote = 'ratified by three-fourths of the States (38 of 5';
  gen.stages[0]!.statedCount = 0;
  gen.scenarios[0]!.yes = [4];
  const report = validateTh(gen);
  assert.ok(failedIds(report).includes('TH-02'), failureDetail(report));
});
