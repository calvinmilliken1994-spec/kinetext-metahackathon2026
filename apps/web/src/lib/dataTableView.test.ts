/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { DataTableGen } from '../../../../packages/contracts/kit.ts';
import type { Provenance } from '../../../../packages/contracts/index.ts';
import {
  bracketSchedule, chartBars, columnViews, dataTablePresentationSteps, dataTableRevealQuote, moneyText, percentText,
  presentationStep, questionViews, quoteLeaksAnswer, sortedRows, taxView,
} from './dataTableView.ts';
import { buildDataTableDemos } from './dataTableDemo.ts';

const root = new URL('../../../../', import.meta.url);
const json = <T>(p: string): T => JSON.parse(readFileSync(new URL(p, root), 'utf8')) as T;
const golden = json<DataTableGen>('tests/fixtures/stage6/data-table.gen.json');
const provenance = json<Provenance>('tests/fixtures/provenance.fixture.json');
const demos = buildDataTableDemos(golden, provenance, {});
const spec = (id: string) => {
  const d = demos.find((x) => x.id === id);
  assert.ok(d !== undefined);
  return d.spec;
};

test('every demo quote is the page’s exact words and every value is in its quote', () => {
  for (const d of demos) {
    const text = readFileSync(new URL(`data/sources/${d.sourceId}.txt`, root), 'utf8');
    for (const c of d.spec.columns) assert.ok(text.includes(c.quote) && c.quote.includes(c.header), `${d.id}: ${c.header}`);
    for (const r of d.spec.rows) {
      assert.ok(text.includes(r.quote) && r.quote.includes(r.label), `${d.id}: ${r.label}`);
      for (const v of r.values) assert.ok(text.includes(v.quote) && v.quote.includes(v.value), `${d.id}: ${v.value}`);
    }
  }
});

test('steps: one per question, plus the tax calculator first in brackets mode', () => {
  assert.equal(dataTablePresentationSteps(spec('planets')), 2);
  assert.equal(dataTablePresentationSteps(spec('irs')), 3);
  assert.deepEqual(presentationStep(spec('irs'), 0), { kind: 'tax' });
  assert.deepEqual(presentationStep(spec('irs'), 1), { kind: 'question', index: 0 });
  assert.deepEqual(presentationStep(spec('planets'), 0), { kind: 'question', index: 0 });
  assert.deepEqual(presentationStep(spec('planets'), 9), { kind: 'question', index: 1 }, 'clamped');
});

test('headers carry their unit once; numeric columns are marked', () => {
  const planets = columnViews(spec('planets'));
  assert.equal(planets[0]?.headerText, 'Mass (10²⁴kg)', 'unit already in the header is not repeated');
  assert.equal(planets[1]?.headerText, 'Diameter (km)');
  const fed = columnViews(spec('fed'));
  assert.equal(fed[0]?.headerText, 'Increase (basis points)');
  assert.equal(fed[2]?.headerText, 'Level (%)');
  assert.equal(fed[2]?.numeric, false);
  assert.equal(columnViews(spec('irs'))[1]?.headerText, 'Single taxpayers ($)');
});

test('sorting uses the parsed numbers, not the text', () => {
  const s = spec('planets');
  // Diameters: 4879, 12,104, 12,756, 6792 → as text "12,104" < "4879"; as numbers 4879 < 6792 < 12,104 < 12,756.
  assert.deepEqual(sortedRows(s, { column: 1, dir: 'asc' }), [0, 3, 1, 2]);
  assert.deepEqual(sortedRows(s, { column: 1, dir: 'desc' }), [2, 1, 3, 0]);
  assert.deepEqual(sortedRows(s, null), [0, 1, 2, 3]);
  // A tie keeps page order.
  assert.deepEqual(sortedRows(spec('fed'), { column: 0, dir: 'desc' }), [1, 2, 3, 4, 0, 5, 6]);
});

test('the chart has one bar per row in the shown order, scaled to the largest', () => {
  const s = spec('planets');
  const bars = chartBars(s, [2, 0]);
  assert.ok(bars !== null);
  assert.deepEqual(bars.bars.map((b) => b.rowIndex), [2, 0]);
  assert.equal(bars.bars[0]?.fraction, 1);
  assert.equal(bars.bars[1]?.text, '4879', 'labels print the page’s value as written');
  assert.equal(bars.headerText, 'Diameter (km)');
  assert.equal(chartBars(spec('irs'), [0, 1]), null, 'no chart when chartColumnIndex is -1');
});

test('questions are worded by code and answered by the engine', () => {
  const [q1, q2] = questionViews(spec('planets'));
  assert.equal(q1?.text, 'What does the table give for EARTH in the Mass (10²⁴kg) column?');
  assert.deepEqual(q1?.answer, { rowIndex: 2, value: '5.97' });
  assert.equal(q2?.text, 'Which planet has the largest value in the Diameter (km) column?');
  assert.deepEqual(q2?.answer, { rowIndex: 2, value: '12,756' });
  assert.deepEqual(q2?.choices, [0, 1, 2, 3]);
  const [f1, f2] = questionViews(spec('fed'));
  assert.equal(f1?.text, 'Which date has the smallest value in the Increase (basis points) column?');
  assert.deepEqual(f1?.answer, { rowIndex: 6, value: '25' });
  assert.deepEqual(f2?.answer, { rowIndex: 1, value: '3.75-4.00' });
  assert.deepEqual(f2?.choices, [], 'a lookup has no row choices');
});

test('a quote that contains the hidden answer as a whole token leaks it', () => {
  assert.equal(quoteLeaksAnswer('| Mass (10^24kg) | 0.330 | 4.87 | 5.97 | 0.073 |', '5.97'), true);
  assert.equal(quoteLeaksAnswer('| Mass | 15.97 |', '5.97'), false);
  assert.equal(quoteLeaksAnswer('November 3 | 75 | 0 | 3.75-4.00', '3.75-4.00'), true);
});

test('the bracket schedule reads the rate and threshold columns', () => {
  const sched = bracketSchedule(spec('irs'));
  assert.ok(sched !== null);
  assert.deepEqual(sched.brackets.map((b) => [b.rate, b.over]), [[12, 12400], [22, 50400], [24, 105700], [32, 201775], [35, 256225], [37, 640600]]);
  assert.equal(sched.currency, '$');
  assert.equal(bracketSchedule(spec('planets')), null);
});

test('the calculator applies the page’s schedule with the engine', () => {
  const t = taxView(spec('irs'), 100000);
  assert.ok(t !== null);
  assert.equal(t.below, 12400, 'income under the first threshold is outside the table');
  assert.deepEqual(t.parts.map((p) => [p.rate, p.from, p.to, p.tax]), [[12, 12400, 50400, 4560], [22, 50400, 100000, 10912]]);
  assert.equal(t.total, 15472);
  assert.equal(percentText(t.effectiveRate), '15.5%');
  assert.equal(taxView(spec('irs'), 5000)?.total, 0);
  assert.equal(taxView(spec('planets'), 100), null);
});

test('money reads as people write it', () => {
  assert.equal(moneyText(15472, '$'), '$15,472');
  assert.equal(moneyText(1234.5, '$'), '$1,234.50');
  assert.equal(moneyText(0, '$'), '$0');
  assert.equal(moneyText(1500, ''), '1,500');
});

test('a revealed step quotes the answer cell, or the top bracket used', () => {
  assert.equal(dataTableRevealQuote(spec('planets'), 0)?.quote, golden.rows[2]?.values[0]?.quote);
  assert.match(dataTableRevealQuote(spec('irs'), 0)?.quote ?? '', /^22% for incomes over \$50,400/);
});
