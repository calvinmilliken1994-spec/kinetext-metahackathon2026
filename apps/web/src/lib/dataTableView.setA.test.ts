/// <reference types="node" />
// Set A data-table fixes: one filing column named in the tax question (P1), band edges on the axis (P2), the
// validator's bracketFloors for a ceiling-style first row (W-06), signed chart values around zero (W-09), and an
// extreme income as a field error, never a crash (W-10).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { DataTableGen, DataTableSpec } from '../../../../packages/contracts/kit.ts';
import type { Provenance } from '../../../../packages/contracts/index.ts';
import {
  bracketColumnName, bracketSchedule, chartBars, chartRowsNote, dataTablePresentationSteps, MAX_INCOME, parseIncome, placeEdgeLabels, questionViews,
  taxQuestion, taxView,
} from './dataTableView.ts';
import { buildDataTableDemos } from './dataTableDemo.ts';

const root = new URL('../../../../', import.meta.url);
const json = <T>(p: string): T => JSON.parse(readFileSync(new URL(p, root), 'utf8')) as T;
const demos = buildDataTableDemos(json<DataTableGen>('tests/fixtures/stage6/data-table.gen.json'), json<Provenance>('tests/fixtures/provenance.fixture.json'), {});
const spec = (id: string): DataTableSpec => {
  const d = demos.find((x) => x.id === id);
  assert.ok(d !== undefined);
  return d.spec;
};

/** The stored IRS run's shape (job-20261031023421-facdad1d): rows named by the Single thresholds, brackets on the Married column. */
function storedIrs(): DataTableSpec {
  const cell = (value: string) => ({ value, sourceId: 'irs', quote: value });
  const row = (single: string, rate: string, married: string) => ({ label: single, sourceId: 'irs', quote: single, values: [cell(rate), cell(married)] });
  return {
    ...spec('irs'),
    labelHeader: 'Single',
    columns: [
      { header: 'Rates', numeric: true, unit: '%', sourceId: 'irs', quote: 'Rates' },
      { header: 'Married', numeric: true, unit: '$', sourceId: 'irs', quote: 'Married' },
    ],
    rows: [
      row('$12,400', '12%', '$24,800'), row('$50,400', '22%', '$100,800'), row('$105,700', '24%', '$211,400'),
      row('$201,775', '32%', '$403,550'), row('$256,225', '35%', '$512,450'), row('$640,600', '37%', '$768,700'),
    ],
    questions: [{ id: 'largest-joint-limit', kind: 'largest', columnIndex: 1, rowIndex: -1 }],
    chartColumnIndex: 1,
    brackets: { enabled: true, exampleIncome: 640600, overColumnIndex: 1, rateColumnIndex: 0 },
  } as DataTableSpec;
}

test('P1: the tax question names the one column the calculator reads', () => {
  const s = storedIrs();
  assert.equal(bracketColumnName(s), 'Married');
  assert.equal(taxQuestion(s, '$'), 'Using the Married column, how much tax is due on $640,600 of income?');
  // the worked answer uses exactly that column's thresholds
  const t = taxView(s, 640600);
  assert.ok(t !== null);
  assert.deepEqual(t.parts.map((p) => p.from), [24800, 100800, 211400, 403550, 512450]);
  assert.equal(t.below, 24800);
  // numeric row labels are 'row', not 'single'
  assert.equal(questionViews(s)[0]?.text, 'Which row has the largest value in the Married ($) column?');
  assert.equal(chartRowsNote(s), 'Rows named by the Single column');
  assert.equal(chartRowsNote(spec('planets')), null);
});

test('P2: edge labels are band edges, kept inside the axis, never overlapping, the income always shown', () => {
  // first edge near the left: pulled inside, not clipped
  const placed = placeEdgeLabels([{ x: 20, w: 60 }, { x: 150, w: 60 }, { x: 600, w: 60 }, { x: 640, w: 60 }, { x: 1000, w: 60 }], 1000);
  assert.equal(placed[0]?.left, 0);
  assert.equal(placed[0]?.shown, true);
  assert.equal(placed[4]?.left, 940, 'the last label stays inside the right edge');
  assert.equal(placed[4]?.shown, true);
  assert.equal(placed[3]?.shown, false, 'a label that would touch its neighbour is dropped');
  const shown = placed.flatMap((p, i) => (p.shown ? [{ l: p.left, r: p.left + 60, i }] : []));
  for (let k = 1; k < shown.length; k++) assert.ok((shown[k]?.l ?? 0) >= (shown[k - 1]?.r ?? 0), 'no overlap');
  assert.deepEqual(placeEdgeLabels([], 100), []);
});

test('W-06: a validated ceiling-style first row ("$12,400 or less") is floor 0, end to end', () => {
  const s = spec('irs');
  const rate = s.brackets.rateColumnIndex;
  const over = s.brackets.overColumnIndex;
  const first = s.rows[0];
  assert.ok(first !== undefined);
  const values = first.values.map((v, c) => (c === rate ? { ...v, value: '10%' } : c === over ? { ...v, value: '$12,400 or less' } : v));
  const withCeiling = { ...s, rows: [{ ...first, label: '10%', values }, ...s.rows] } as DataTableSpec;
  const sched = bracketSchedule(withCeiling);
  assert.ok(sched !== null, 'the view reads what the validator accepts');
  assert.deepEqual(sched.brackets.map((b) => b.over), [0, 12400, 50400, 105700, 201775, 256225, 640600]);
  assert.equal(sched.brackets[0]?.overText, '$12,400 or less', 'the printed cell is kept for display');
  assert.equal(sched.currency, '$');
  assert.equal(dataTablePresentationSteps(withCeiling), dataTablePresentationSteps(s), 'the calculator step is still there');
  const t = taxView(withCeiling, 100000);
  assert.ok(t !== null);
  assert.equal(t.below, 0);
  assert.equal(t.parts[0]?.rate, 10);
});

test('W-09: signed values are drawn around a zero baseline; all-zero data has no chart', () => {
  const s = spec('planets');
  const col = s.chartColumnIndex;
  const signed = (vals: string[]) => ({ ...s, rows: s.rows.map((r, i) => ({ ...r, values: r.values.map((v, c) => (c === col ? { ...v, value: vals[i] ?? '0' } : v)) })) }) as DataTableSpec;
  const mixed = chartBars(signed(['-140', '15', '-60', '30']), [0, 1, 2, 3]);
  assert.ok(mixed !== null);
  assert.equal(mixed.signed, true);
  assert.ok(Math.abs(mixed.zero - 140 / 170) < 1e-9);
  const [sat, earth] = mixed.bars;
  assert.ok(sat !== undefined && earth !== undefined);
  assert.equal(sat.negative, true);
  assert.ok(Math.abs(sat.start + sat.fraction - mixed.zero) < 1e-9, 'a negative bar ends at zero');
  assert.equal(earth.negative, false);
  assert.equal(earth.start, mixed.zero, 'a positive bar starts at zero');
  const neg = chartBars(signed(['-1', '-2', '-3', '-4']), [0, 1, 2, 3]);
  assert.ok(neg !== null);
  assert.equal(neg.zero, 1);
  for (const b of neg.bars) assert.ok(b.start >= 0 && b.start + b.fraction <= 1 + 1e-9);
  assert.equal(chartBars(signed(['0', '0', '0', '0']), [0, 1, 2, 3]), null);
  const pos = chartBars(s, [0, 1, 2, 3]);
  assert.ok(pos !== null && pos.signed === false && pos.zero === 0);
});

test('W-10: extreme, negative, empty and malformed incomes are field errors; the engine never throws into render', () => {
  assert.deepEqual(parseIncome('$100,000'), { ok: true, income: 100000 });
  assert.deepEqual(parseIncome(' 640 600 '), { ok: true, income: 640600 });
  for (const bad of ['', '-5', 'abc', '1e308', '12,34x', String(MAX_INCOME * 10)]) {
    const r = parseIncome(bad);
    assert.equal(r.ok, false, bad);
    if (!r.ok) assert.ok(r.error.length > 0);
  }
  assert.doesNotThrow(() => taxView(spec('irs'), 1e308));
  assert.ok(taxView(spec('irs'), 1e308) !== null, 'clamped to the largest income taken');
});
