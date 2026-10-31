// Stage 8a V-A — log-ladder-v1 validator tests (LOG-01..LOG-07, frozen in
// docs/specs/STAGE-8a-subject-engines.md §1b). Positive vectors are REAL library pages
// (USGS earthquake magnitude/energy: "tenfold" and "32 times"; USGS pH and water: "ten times"
// with pH values printed as digits) plus the frozen golden; every check has a negative vector.
// Run: node --test packages/validation/stage8a-log-ladder.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';

import { checkIdsFor } from '../contracts/kit.ts';
import type { LogLadderGen } from '../contracts/kit.ts';
import { validateKitComponent } from './kit/index.ts';
import { validateLogLadder } from './kit/log-ladder.ts';
import { loadSource } from '../sources/index.ts';
import { checkOf, clone, expectFailures, failedIds, failureDetail, stage6Fixture } from './fixtures/stage6.ts';

const quakeSource = (): ReturnType<typeof loadSource> => loadSource('usgs-earthquake-magnitude-energy-intensity');
const phSource = (): ReturnType<typeof loadSource> => loadSource('usgs-wss-ph-and-water');

const goldenGen = (): LogLadderGen => stage6Fixture<LogLadderGen>('log-ladder.gen.json');

/** The energy ladder on the same USGS page: factor 32 stated as "32 times" (digits). */
function quakeEnergyGen(): LogLadderGen {
  return {
    schemaVersion: 'log-ladder-v1',
    title: 'Earthquake energy ladder',
    quantity: 'magnitude',
    factor: 32,
    factorText: '32 times',
    effectPhrase: 'more energy release',
    increasing: true,
    sourceId: 'usgs-earthquake-magnitude-energy-intensity',
    quote: 'each whole number increase in magnitude represents a tenfold increase in the measured amplitude, it represents an 32 times more energy release.',
    rungs: [
      {
        id: 'moderate',
        label: 'moderate earthquake',
        value: 5.3,
        sourceId: 'usgs-earthquake-magnitude-energy-intensity',
        quote: 'a magnitude 5.3 is a moderate earthquake,',
      },
      {
        id: 'strong',
        label: 'strong earthquake',
        value: 6.3,
        sourceId: 'usgs-earthquake-magnitude-energy-intensity',
        quote: 'and a 6.3 is a strong earthquake.',
      },
    ],
    cases: [{ id: 'one-step', fromValue: 5.3, toValue: 6.3 }],
  };
}

/** The pH ladder: "ten times" (number words), increasing false, digit-printed rung values. */
function phGen(): LogLadderGen {
  return {
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
      {
        id: 'mine-water',
        label: 'acid mine drainage',
        value: 2,
        sourceId: 'usgs-wss-ph-and-water',
        quote: 'water coming out of an abandoned coal mine can have a pH of 2, which is very acidic',
      },
      {
        id: 'rainfall',
        label: 'normal rainfall',
        value: 5.6,
        sourceId: 'usgs-wss-ph-and-water',
        quote: 'Normal rainfall has a pH of about 5.6—slightly acidic due to carbon dioxide gas from the atmosphere.',
      },
      {
        id: 'neutral',
        label: 'neutral water',
        value: 7,
        sourceId: 'usgs-wss-ph-and-water',
        quote: 'The range goes from 0 to 14, with 7 being neutral.',
      },
    ],
    cases: [
      { id: 'mine-to-neutral', fromValue: 2, toValue: 7 },
      { id: 'rain-to-neutral', fromValue: 5.6, toValue: 7 },
    ],
  };
}

function validate(gen: LogLadderGen, sources: ReturnType<typeof loadSource>[]) {
  return validateKitComponent('log-ladder-v1', gen, sources);
}

/* ------------------------------------------------------------------ */
/* Positive: the golden and real library pages                          */
/* ------------------------------------------------------------------ */

test('golden log-ladder (tenfold amplitude) passes every check', () => {
  const report = validate(goldenGen(), [quakeSource()]);
  assert.deepEqual(report.checks.map(c => c.id), ['schema.gen', ...checkIdsFor('log-ladder-v1')]);
  assert.deepEqual(failedIds(report), [], failureDetail(report));
  assert.equal(report.publishable, true);
});

test('the "32 times" energy ladder on the real USGS page passes every check', () => {
  const report = validate(quakeEnergyGen(), [quakeSource()]);
  assert.deepEqual(failedIds(report), [], failureDetail(report));
  assert.equal(report.publishable, true);
  assert.match(checkOf(report, 'LOG-06').message, /32/);
});

test('the pH "ten times" ladder on the real USGS page passes every check', () => {
  const report = validate(phGen(), [phSource()]);
  assert.deepEqual(failedIds(report), [], failureDetail(report));
  assert.equal(report.publishable, true);
  // The page itself states the 2 -> 7 case: "100,000 times more acidic than neutral water".
  assert.match(checkOf(report, 'LOG-06').message, /100000|100,000/);
});

/* ------------------------------------------------------------------ */
/* Negative: one vector per check                                       */
/* ------------------------------------------------------------------ */

test('schema.gen: one rung is below the frozen 2-8 count', () => {
  const gen = goldenGen();
  gen.rungs = gen.rungs.slice(0, 1);
  const report = validate(gen, [quakeSource()]);
  assert.equal(checkOf(report, 'schema.gen').passed, false);
  assert.match(checkOf(report, 'schema.gen').message, /2-8/);
  assert.ok((checkOf(report, 'schema.gen').affected ?? []).includes('/rungs'));
  assert.equal(report.publishable, false);
});

test('schema.gen: an empty quantity fails the structural gate', () => {
  const gen = goldenGen();
  gen.quantity = '';
  const report = validate(gen, [quakeSource()]);
  assert.equal(checkOf(report, 'schema.gen').passed, false);
  assert.ok((checkOf(report, 'schema.gen').affected ?? []).includes('/quantity'));
});

test('LOG-01: a fabricated root quote fails and names the quote pointer', () => {
  const gen = goldenGen();
  // Keeps "magnitude" and "tenfold" (so LOG-02/LOG-03 stay green) but is not on the page.
  gen.quote = 'each whole number increase in magnitude represents a tenfold increase in shaking';
  const report = validate(gen, [quakeSource()]);
  assert.deepEqual(failedIds(report), ['LOG-01'], failureDetail(report));
  assert.ok((checkOf(report, 'LOG-01').affected ?? []).includes('/quote'));
  assert.match(checkOf(report, 'LOG-01').message, /verbatim/);
});

test('LOG-01: a fabricated rung quote fails and names the rung quote pointer', () => {
  const gen = goldenGen();
  gen.rungs[1]!.quote = 'and a 6.3 is a very strong earthquake.';
  const report = validate(gen, [quakeSource()]);
  assert.deepEqual(failedIds(report), ['LOG-01'], failureDetail(report));
  assert.ok((checkOf(report, 'LOG-01').affected ?? []).includes('/rungs/1/quote'));
});

test('LOG-02: factor 100 against the page\'s "ten times" fails', () => {
  const gen = phGen();
  gen.factor = 100;
  expectFailures(validate(gen, [phSource()]), ['LOG-02']);
  const report = validate(gen, [phSource()]);
  assert.ok((checkOf(report, 'LOG-02').affected ?? []).includes('/factor'));
  assert.match(checkOf(report, 'LOG-02').message, /10/);
});

test('LOG-02: a factorText that is not in the quote fails', () => {
  const gen = goldenGen();
  gen.factorText = '32 times';
  gen.factor = 32;
  const report = validate(gen, [quakeSource()]);
  assert.deepEqual(failedIds(report), ['LOG-02'], failureDetail(report));
  const affected = checkOf(report, 'LOG-02').affected ?? [];
  assert.ok(affected.includes('/factorText'));
  assert.ok(affected.includes('/quote'));
});

test('LOG-02: a factorText that states no factor fails closed', () => {
  const gen = goldenGen();
  gen.factorText = 'much bigger';
  const report = validate(gen, [quakeSource()]);
  assert.ok(failedIds(report).includes('LOG-02'), failureDetail(report));
  assert.ok((checkOf(report, 'LOG-02').affected ?? []).includes('/factorText'));
});

test('LOG-02: a factor outside the frozen 1-1000 bounds fails', () => {
  const gen = goldenGen();
  gen.factor = 1;
  gen.factorText = 'tenfold';
  const report = validate(gen, [quakeSource()]);
  assert.ok(failedIds(report).includes('LOG-02'), failureDetail(report));
  assert.ok((checkOf(report, 'LOG-02').affected ?? []).includes('/factor'));
});

test('LOG-03: a quantity that is not in the quote fails', () => {
  const gen = goldenGen();
  gen.quantity = 'energy';
  expectFailures(validate(gen, [quakeSource()]), ['LOG-03']);
  const report = validate(gen, [quakeSource()]);
  assert.ok((checkOf(report, 'LOG-03').affected ?? []).includes('/quantity'));
});

test('LOG-04: a rung value that is only part of the printed number fails (6 inside 6.3)', () => {
  const gen = goldenGen();
  gen.rungs[0]!.value = 5; // the quote prints 5.3
  const report = validate(gen, [quakeSource()]);
  assert.deepEqual(failedIds(report), ['LOG-04'], failureDetail(report));
  assert.ok((checkOf(report, 'LOG-04').affected ?? []).includes('/rungs/0/value'));
  assert.match(checkOf(report, 'LOG-04').message, /5\.3/);
});

test('LOG-04: a rung value the quote does not print at all fails (3 where the page says 33)', () => {
  const gen = phGen();
  gen.rungs[0]!.value = 12; // the quote prints "a pH of 2"
  const report = validate(gen, [phSource()]);
  assert.ok(failedIds(report).includes('LOG-04'), failureDetail(report));
  assert.ok((checkOf(report, 'LOG-04').affected ?? []).includes('/rungs/0/value'));
});

test('LOG-05: two rungs with the same value fail with both pointers', () => {
  const gen = phGen();
  gen.rungs.push({ ...clone(gen.rungs[2]!), id: 'neutral-again' });
  expectFailures(validate(gen, [phSource()]), ['LOG-05']);
  const affected = checkOf(validate(gen, [phSource()]), 'LOG-05').affected ?? [];
  assert.ok(affected.includes('/rungs/2/value'));
  assert.ok(affected.includes('/rungs/3/value'));
});

test('LOG-06: a case value outside the rung range fails', () => {
  const gen = goldenGen();
  gen.cases[0]!.fromValue = 4; // below the smallest rung 5.3
  expectFailures(validate(gen, [quakeSource()]), ['LOG-06']);
  assert.ok((checkOf(validate(gen, [quakeSource()]), 'LOG-06').affected ?? []).includes('/cases/0/fromValue'));
});

test('LOG-06: a case that does not move (from == to) fails', () => {
  const gen = goldenGen();
  gen.cases[0]!.toValue = 5.3;
  expectFailures(validate(gen, [quakeSource()]), ['LOG-06']);
  assert.ok((checkOf(validate(gen, [quakeSource()]), 'LOG-06').affected ?? []).includes('/cases/0/toValue'));
});

test('LOG-06: a ratio beyond the frozen maximum fails (10^14 over 1e12)', () => {
  const gen = phGen();
  gen.rungs = [
    {
      id: 'scale-bottom',
      label: 'bottom of the scale',
      value: 0,
      sourceId: 'usgs-wss-ph-and-water',
      quote: 'The range goes from 0 to 14, with 7 being neutral.',
    },
    {
      id: 'scale-top',
      label: 'top of the scale',
      value: 14,
      sourceId: 'usgs-wss-ph-and-water',
      quote: 'The range goes from 0 to 14, with 7 being neutral.',
    },
  ];
  gen.cases = [{ id: 'bottom-to-top', fromValue: 0, toValue: 14 }];
  expectFailures(validate(gen, [phSource()]), ['LOG-06']);
  assert.match(checkOf(validate(gen, [phSource()]), 'LOG-06').message, /ratio/i);
});

test('LOG-07: a number in the title that is not on the page fails', () => {
  const gen = goldenGen();
  gen.title = 'Magnitude ladder of 1000 steps';
  expectFailures(validate(gen, [quakeSource()]), ['LOG-07']);
  assert.ok((checkOf(validate(gen, [quakeSource()]), 'LOG-07').affected ?? []).includes('/title'));
  assert.match(checkOf(validate(gen, [quakeSource()]), 'LOG-07').message, /1000/);
});

test('LOG-07: a number in a rung label that is not on the page fails', () => {
  const gen = goldenGen();
  gen.rungs[0]!.label = 'level 42 shaking';
  const report = validate(gen, [quakeSource()]);
  assert.ok(failedIds(report).includes('LOG-07'), failureDetail(report));
  assert.ok((checkOf(report, 'LOG-07').affected ?? []).includes('/rungs/0/label'));
});

test('malformed gen input never throws and emits every check id', () => {
  const report = validateLogLadder({} as LogLadderGen, []);
  assert.deepEqual(report.checks.map(c => c.id), ['schema.gen', ...checkIdsFor('log-ladder-v1')]);
  assert.equal(report.publishable, false);
  for (const c of report.checks) assert.doesNotMatch(c.message, /crashed/);
  const gated = validateKitComponent('log-ladder-v1', null, []);
  assert.equal(gated.publishable, false);
});
