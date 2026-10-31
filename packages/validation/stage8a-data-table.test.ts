// Stage 8a V-B — data-table-v1 validator tests (DT-01..DT-08, docs/specs/STAGE-8a-subject-engines.md §1d).
// Positive gens quote REAL licensed library pages exactly: the NASA planetary fact sheet (golden), the
// IRS tax-year-2026 marginal-rate prose (progressive brackets), the Federal Reserve OMO rate table
// (dated rows, a non-numeric Level column) and a BLS worked percent-change table. One negative per check.
// Run: node --test packages/validation/stage8a-data-table.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';

import { checkIdsFor } from '../contracts/kit.ts';
import type { DataTableGen } from '../contracts/kit.ts';
import type { SourceDocument } from '../contracts/index.ts';
import { progressiveTax, parseTableNumber } from '../kit-engines/table.ts';
import { validateKitComponent } from './kit/index.ts';
import { validateDataTable } from './kit/data-table.ts';
import { loadSource } from '../sources/index.ts';
import { checkOf, clone, expectFailures, failedIds, failureDetail, stage6Fixture } from './fixtures/stage6.ts';

const PLANETS = 'nasa-nssdc-planetary-fact-sheet-metric';
const IRS = 'irs-tax-inflation-adjustments-2026';
const FED = 'federalreserve-open-market-operations';
const BLS = 'bls-calculating-percent-changes';

const planetsSource = (): SourceDocument => loadSource(PLANETS);
const irsSource = (): SourceDocument => loadSource(IRS);
const fedSource = (): SourceDocument => loadSource(FED);
const blsSource = (): SourceDocument => loadSource(BLS);

export const goldenDataTable = (): DataTableGen => stage6Fixture<DataTableGen>('data-table.gen.json');

const DT_IDS = ['schema.gen', ...checkIdsFor('data-table-v1')];

/** IRS tax year 2026 marginal rates (single filers, joint figures beside them) as a bracket table. */
function irsGen(): DataTableGen {
  const cell = (value: string, quote: string): { value: string; sourceId: string; quote: string } => ({ value, sourceId: IRS, quote });
  const topQuote = 'For tax year 2026, the top tax rate remains 37% for individual single taxpayers with incomes greater than $640,600';
  return {
    schemaVersion: 'data-table-v1',
    title: 'Marginal tax rates for tax year 2026',
    labelHeader: 'Bracket',
    columns: [
      { header: 'rate', unit: '%', numeric: true, sourceId: IRS, quote: topQuote },
      { header: 'single taxpayers', unit: '$', numeric: true, sourceId: IRS, quote: topQuote },
      { header: 'married couples filing jointly', unit: '$', numeric: true, sourceId: IRS, quote: '35% for incomes over $256,225 ($512,450 for married couples filing jointly)' },
    ],
    rows: [
      ['12%', '$12,400', '$24,800', '12% for incomes over $12,400 ($24,800 for married couples filing jointly)'],
      ['22%', '$50,400', '$100,800', '22% for incomes over $50,400 ($100,800 for married couples filing jointly)'],
      ['24%', '$105,700', '$211,400', '24% for incomes over $105,700 ($211,400 for married couples filing jointly)'],
      ['32%', '$201,775', '$403,550', '32% for incomes over $201,775 ($403,550 for married couples filing jointly)'],
      ['35%', '$256,225', '$512,450', '35% for incomes over $256,225 ($512,450 for married couples filing jointly)'],
      ['37%', '$640,600', '$768,700', '37% for individual single taxpayers with incomes greater than $640,600 ($768,700 for married couples filing jointly)'],
    ].map(([rate, single, joint, quote]) => ({
      label: rate as string,
      sourceId: IRS,
      quote: quote as string,
      values: [cell(rate as string, quote as string), cell(single as string, quote as string), cell(joint as string, quote as string)],
    })),
    questions: [
      { id: 'rate-over-105700', kind: 'lookup', rowIndex: 2, columnIndex: 1 },
      { id: 'top-threshold', kind: 'largest', rowIndex: -1, columnIndex: 1 },
    ],
    chartColumnIndex: -1,
    brackets: { enabled: true, rateColumnIndex: 0, overColumnIndex: 1, exampleIncome: 100000 },
  };
}

/** Federal Reserve FOMC target-range changes listed under 2022 (basis points), with a non-numeric Level column. */
function fedGen(): DataTableGen {
  const head = 'Date | Increase | Decrease | Level (%)';
  const cell = (value: string, quote: string): { value: string; sourceId: string; quote: string } => ({ value, sourceId: FED, quote });
  return {
    schemaVersion: 'data-table-v1',
    title: 'Target federal funds rate changes',
    labelHeader: 'Date',
    columns: [
      { header: 'Increase', unit: 'basis points', numeric: true, sourceId: FED, quote: head },
      { header: 'Decrease', unit: 'basis points', numeric: true, sourceId: FED, quote: head },
      { header: 'Level (%)', unit: '', numeric: false, sourceId: FED, quote: head },
    ],
    rows: [
      ['December 15', '50', '0', '4.25-4.50'],
      ['November 3', '75', '0', '3.75-4.00'],
      ['September 22', '75', '0', '3.00-3.25'],
      ['July 28', '75', '0', '2.25-2.50'],
      ['June 16', '75', '0', '1.50-1.75'],
      ['May 5', '50', '0', '0.75-1.00'],
      ['March 17', '25', '0', '0.25-0.50'],
    ].map(([date, up, down, level]) => {
      const quote = `${date} | ${up} | ${down} | ${level}`;
      return {
        label: date as string, sourceId: FED, quote,
        values: [cell(up as string, quote), cell(down as string, quote), cell(level as string, quote)],
      };
    }),
    questions: [
      { id: 'smallest-increase', kind: 'smallest', rowIndex: -1, columnIndex: 0 },
      { id: 'level-november', kind: 'lookup', rowIndex: 1, columnIndex: 2 },
    ],
    chartColumnIndex: 0,
    brackets: { enabled: false, rateColumnIndex: -1, overColumnIndex: -1, exampleIncome: 0 },
  };
}

/** BLS "Calculating percent changes", Table 2: the worked 12-month CPI change. */
function blsGen(): DataTableGen {
  const cell = (value: string, quote: string): { value: string; sourceId: string; quote: string } => ({ value, sourceId: BLS, quote });
  const head = 'Quantity | Representation | Value';
  return {
    schemaVersion: 'data-table-v1',
    title: 'A 12-month percent change in the CPI',
    labelHeader: 'Quantity',
    columns: [
      { header: 'Representation', unit: '', numeric: false, sourceId: BLS, quote: head },
      { header: 'Value', unit: '', numeric: true, sourceId: BLS, quote: head },
    ],
    rows: [
      ['Difference in index values', 'Difference in index values | 296.797 - 278.802 | 17.995', ['296.797 - 278.802', '17.995']],
      ['Ratio of difference to earlier index value', 'Ratio of difference to earlier index value | 17.995 / 278.802 | 0.065', ['17.995 / 278.802', '0.065']],
      ['Ratio multiplied by 100', 'Ratio multiplied by 100 | .065 * 100 | 6.5', ['.065 * 100', '6.5']],
    ].map(([label, quote, values]) => ({
      label: label as string,
      sourceId: BLS,
      quote: quote as string,
      values: (values as string[]).map(v => cell(v, quote as string)),
    })),
    questions: [
      { id: 'difference', kind: 'lookup', rowIndex: 0, columnIndex: 1 },
      { id: 'biggest', kind: 'largest', rowIndex: -1, columnIndex: 1 },
    ],
    chartColumnIndex: 1,
    brackets: { enabled: false, rateColumnIndex: -1, overColumnIndex: -1, exampleIncome: 0 },
  };
}

/* ------------------------------------------------------------------ */
/* Positives                                                           */
/* ------------------------------------------------------------------ */

test('golden data-table (NASA planetary fact sheet) passes every check', () => {
  const report = validateKitComponent('data-table-v1', goldenDataTable(), [planetsSource()]);
  assert.deepEqual(report.checks.map(c => c.id), DT_IDS);
  assert.deepEqual(failedIds(report), [], failureDetail(report));
  assert.equal(report.publishable, true);
});

test('IRS 2026 brackets pass; DT-07 runs progressiveTax on the page values (15472 on 100000)', () => {
  const gen = irsGen();
  const report = validateKitComponent('data-table-v1', gen, [irsSource()]);
  assert.deepEqual(failedIds(report), [], failureDetail(report));
  // The engine result the check message must agree with:
  // 12% on 12,400→50,400 = 4,560 and 22% on 50,400→100,000 = 10,912.
  const pairs = gen.rows.map(r => ({ rate: parseTableNumber(r.values[0]!.value)!, over: parseTableNumber(r.values[1]!.value)! }));
  const { total } = progressiveTax(pairs, 100000);
  assert.equal(total, 15472);
  assert.match(checkOf(report, 'DT-07').message, /15472/);
  assert.match(checkOf(report, 'DT-05').message, /\$105,700/);
});

test('Federal Reserve rate table passes with a non-numeric Level column and a unique smallest increase', () => {
  const report = validateKitComponent('data-table-v1', fedGen(), [fedSource()]);
  assert.deepEqual(failedIds(report), [], failureDetail(report));
  assert.match(checkOf(report, 'DT-06').message, /Increase/);
});

test('BLS worked percent-change table passes (representation column stays non-numeric)', () => {
  const report = validateKitComponent('data-table-v1', blsGen(), [blsSource()]);
  assert.deepEqual(failedIds(report), [], failureDetail(report));
  assert.match(checkOf(report, 'DT-05').message, /17\.995/);
});

/* ------------------------------------------------------------------ */
/* Negatives — one per check                                           */
/* ------------------------------------------------------------------ */

test('DT-01: a fabricated cell quote fails even when it still prints the value', () => {
  const gen = clone(goldenDataTable());
  gen.rows[0]!.values[0]!.quote = 'The mass value 0.330 belongs to the innermost body.';
  const report = validateKitComponent('data-table-v1', gen, [planetsSource()]);
  expectFailures(report, ['DT-01']);
  assert.ok((checkOf(report, 'DT-01').affected ?? []).includes('/rows/0/values/0/quote'));
});

test('DT-02: a row label the quote (and its paragraph) never prints fails', () => {
  const gen = clone(goldenDataTable());
  gen.rows[0]!.label = 'Mercurian sphere';
  const report = validateKitComponent('data-table-v1', gen, [planetsSource()]);
  expectFailures(report, ['DT-02']);
  assert.ok((checkOf(report, 'DT-02').affected ?? []).includes('/rows/0/label'));
});

test('DT-03: the value "12,10" cut out of the printed "12,104" fails (and takes the parse and the largest question with it)', () => {
  const gen = clone(goldenDataTable());
  gen.rows[1]!.values[1]!.value = '12,10';
  const report = validateKitComponent('data-table-v1', gen, [planetsSource()]);
  expectFailures(report, ['DT-03', 'DT-04', 'DT-05']);
  const dt03 = checkOf(report, 'DT-03');
  assert.match(dt03.message, /12,104/);
  const affected = dt03.affected ?? [];
  assert.ok(affected.includes('/rows/1/values/1/value'));
  assert.ok(affected.includes('/rows/1/values/1/quote'));
});

test('DT-03: dropping the printed "$" from "$640,600" fails — values are copied as printed', () => {
  const gen = irsGen();
  gen.rows[5]!.values[1]!.value = '640,600';
  const report = validateKitComponent('data-table-v1', gen, [irsSource()]);
  assert.ok(failedIds(report).includes('DT-03'), failureDetail(report));
  assert.match(checkOf(report, 'DT-03').message, /\$640,600/);
});

test('DT-04: a non-numeric value in a numeric column fails the shape check alone', () => {
  const gen = clone(goldenDataTable());
  gen.rows[0]!.values[0]!.value = 'Mercury';
  gen.rows[0]!.values[0]!.quote = '| | MERCURY | VENUS | EARTH | MOON | MARS |';
  const report = validateKitComponent('data-table-v1', gen, [planetsSource()]);
  expectFailures(report, ['DT-04']);
  assert.ok((checkOf(report, 'DT-04').affected ?? []).includes('/rows/0/values/0/value'));
});

test('DT-04: a row with fewer values than columns fails with the frozen count wording', () => {
  const gen = clone(goldenDataTable());
  gen.rows[0]!.values = gen.rows[0]!.values.slice(0, 1);
  const report = validateKitComponent('data-table-v1', gen, [planetsSource()]);
  assert.ok(failedIds(report).includes('DT-04'), failureDetail(report));
  assert.match(checkOf(report, 'DT-04').message, /rows\[0\] has 1 values; it needs one per column \(2\)/);
  assert.ok((checkOf(report, 'DT-04').affected ?? []).includes('/rows/0/values'));
});

test('DT-05: a largest question on a tied column has no unique answer and fails', () => {
  const gen = fedGen();
  gen.questions.push({ id: 'tie', kind: 'largest', rowIndex: -1, columnIndex: 1 });
  const report = validateKitComponent('data-table-v1', gen, [fedSource()]);
  expectFailures(report, ['DT-05']);
  const affected = checkOf(report, 'DT-05').affected ?? [];
  assert.ok(affected.includes('/questions/2/kind'));
  assert.ok(affected.includes('/questions/2/columnIndex'));
});

test('DT-05: a largest question on a text column fails', () => {
  const gen = fedGen();
  gen.questions.push({ id: 'level-largest', kind: 'largest', rowIndex: -1, columnIndex: 2 });
  const report = validateKitComponent('data-table-v1', gen, [fedSource()]);
  expectFailures(report, ['DT-05']);
});

test('DT-06: charting a text column fails', () => {
  const gen = fedGen();
  gen.chartColumnIndex = 2;
  const report = validateKitComponent('data-table-v1', gen, [fedSource()]);
  expectFailures(report, ['DT-06']);
  assert.ok((checkOf(report, 'DT-06').affected ?? []).includes('/chartColumnIndex'));
});

test('DT-07: descending bracket thresholds fail with brackets enabled', () => {
  const gen = irsGen();
  const rows = gen.rows;
  gen.rows = [rows[5]!, rows[0]!, rows[1]!, rows[2]!, rows[3]!, rows[4]!]; // 37% bracket first
  const report = validateKitComponent('data-table-v1', gen, [irsSource()]);
  expectFailures(report, ['DT-07']);
  const affected = checkOf(report, 'DT-07').affected ?? [];
  assert.ok(affected.includes('/rows/1/values/1/value'));
  assert.ok(affected.includes('/rows/1/values/0/value'));
});

test('DT-07: disabled brackets must keep the -1/-1/0 sentinels', () => {
  const gen = fedGen();
  gen.brackets = { enabled: false, rateColumnIndex: 0, overColumnIndex: -1, exampleIncome: 0 };
  const report = validateKitComponent('data-table-v1', gen, [fedSource()]);
  expectFailures(report, ['DT-07']);
  assert.ok((checkOf(report, 'DT-07').affected ?? []).includes('/brackets/rateColumnIndex'));
});

test('DT-08: a title number that is not on the page fails N-01', () => {
  const gen = clone(goldenDataTable());
  gen.title = 'Planet sizes in 1999';
  const report = validateKitComponent('data-table-v1', gen, [planetsSource()]);
  expectFailures(report, ['DT-08']);
  assert.ok((checkOf(report, 'DT-08').affected ?? []).includes('/title'));
});

test('schema.gen: a bad question id fails the structural gate only', () => {
  const gen = clone(goldenDataTable());
  gen.questions[0]!.id = 'Q One';
  const report = validateKitComponent('data-table-v1', gen, [planetsSource()]);
  assert.deepEqual(failedIds(report), ['schema.gen'], failureDetail(report));
  assert.equal(report.publishable, false);
  assert.ok((checkOf(report, 'schema.gen').affected ?? []).includes('/questions/0/id'));
});

/* ------------------------------------------------------------------ */
/* Robustness                                                          */
/* ------------------------------------------------------------------ */

test('a type-invalid data-table gen short-circuits at the Ajv gate', () => {
  const broken = { schemaVersion: 'data-table-v1', title: 42, labelHeader: 'x', columns: [], rows: [], questions: [], chartColumnIndex: 0, brackets: {} };
  const report = validateKitComponent('data-table-v1', broken, []);
  assert.equal(report.checks.length, 1);
  assert.equal(report.checks[0]?.id, 'schema.gen');
  assert.equal(report.publishable, false);
});

test('the validator never throws on junk and still emits every frozen id', () => {
  for (const junk of [null, undefined, 42, 'x', [], {}]) {
    const report = validateDataTable(junk as unknown as DataTableGen, []);
    assert.equal(report.publishable, false);
    assert.deepEqual(report.checks.map(c => c.id), DT_IDS);
  }
});
