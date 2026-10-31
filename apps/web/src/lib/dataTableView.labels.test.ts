/// <reference types="node" />
// A data table whose row labels repeat one of its value columns (IRS brackets: label '12%', Rate column '12%') shows that
// column once: the label column is dropped and the value column becomes the row header.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { DataTableGen, DataTableSpec } from '../../../../packages/contracts/kit.ts';
import type { Provenance } from '../../../../packages/contracts/index.ts';
import { duplicateLabelColumn } from './dataTableView.ts';
import { buildDataTableDemos } from './dataTableDemo.ts';

const root = new URL('../../../../', import.meta.url);
const json = <T>(p: string): T => JSON.parse(readFileSync(new URL(p, root), 'utf8')) as T;
const golden = json<DataTableGen>('tests/fixtures/stage6/data-table.gen.json');
const provenance = json<Provenance>('tests/fixtures/provenance.fixture.json');
const demos = buildDataTableDemos(golden, provenance, {});
const spec = (id: string): DataTableSpec => {
  const d = demos.find((x) => x.id === id);
  assert.ok(d !== undefined);
  return d.spec;
};

/** The IRS demo with its rows and questions replaced (cells keep the demo's source and quote). */
function variant(rows: { label: string; values: string[] }[], questions: DataTableSpec['questions'] = []): DataTableSpec {
  const base = spec('irs');
  const sourceId = base.rows[0]?.sourceId ?? 's';
  const cell = (value: string) => ({ value, sourceId, quote: 'q' });
  return {
    ...base,
    rows: rows.map((r) => ({ label: r.label, sourceId, quote: 'q', values: r.values.map(cell) })),
    questions,
  } as DataTableSpec;
}

test('IRS brackets: the label column repeats the Rate column, so Rate becomes the row header', () => {
  assert.equal(duplicateLabelColumn(spec('irs')), 0);
});

test('tables whose labels are their own data keep the label column', () => {
  assert.equal(duplicateLabelColumn(spec('planets')), null);
  assert.equal(duplicateLabelColumn(spec('fed')), null);
});

test('a match ignores spacing and letter case, and accepts the column unit written beside the number', () => {
  // Labels '12%' against a Rate column whose cells print '12' with the unit '%' in the header.
  const base = variant([{ label: '12 %', values: ['12', '$1', '$2'] }, { label: '22%', values: ['22', '$3', '$4'] }]);
  assert.equal(duplicateLabelColumn(base), 0);
  assert.equal(duplicateLabelColumn(variant([{ label: 'Mars', values: ['12%', 'MARS', 'x'] }, { label: 'Venus', values: ['22%', 'venus', 'y'] }])), 1);
});

test('every row must match: one different label keeps the label column', () => {
  assert.equal(duplicateLabelColumn(variant([{ label: '12%', values: ['12%', '$1', '$2'] }, { label: 'Top', values: ['37%', '$3', '$4'] }])), null);
});

test('a lookup question on that column keeps the label column (hiding the cell would hide which row it is)', () => {
  const rows = [{ label: '12%', values: ['12%', '$1', '$2'] }, { label: '22%', values: ['22%', '$3', '$4'] }];
  assert.equal(duplicateLabelColumn(variant(rows, [{ id: 'q', kind: 'lookup', rowIndex: 1, columnIndex: 0 }])), null);
  assert.equal(duplicateLabelColumn(variant(rows, [{ id: 'q', kind: 'lookup', rowIndex: 1, columnIndex: 1 }])), 0);
  assert.equal(duplicateLabelColumn(variant(rows, [{ id: 'q', kind: 'largest', rowIndex: -1, columnIndex: 0 }])), 0);
});

test('an empty table or empty labels never drop the label column', () => {
  assert.equal(duplicateLabelColumn(variant([])), null);
  assert.equal(duplicateLabelColumn(variant([{ label: '', values: ['', 'a', 'b'] }, { label: ' ', values: [' ', 'c', 'd'] }])), null);
});
