/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import type { CompareTableSpec } from '../../../../packages/contracts/kit.ts';
import { NOT_STATED, compareGrid, gradePredict, planPredict } from './compare.ts';
import { loadDemoLessons, loadDemoRaw } from './stage6-fixtures.ts';
import { assembleKitSpec } from '../../../../packages/contracts/kit.ts';

const three = Object.values(loadDemoLessons().find((l) => l.id === 'gallery')?.specs ?? {}).find((s) => s.componentId === 'compare-table-v1') as CompareTableSpec;
const raw = loadDemoRaw();
const two = assembleKitSpec(raw.compare, 'compare-table-v1', { id: 'two', sources: [], provenance: raw.provenance, seed: 4 });

test('three-zone fixture has six cells', () => {
  assert.equal(three.entities.length, 3);
  assert.equal(three.cells.length, 6);
});

test('grid puts each cell under its entity and attribute', () => {
  const g = compareGrid(three);
  assert.deepEqual(g.attributes, ['temperature', 'pressure']);
  assert.equal(g.rows.length, 3);
  assert.equal(g.rows[1]?.entity, 'lower stratosphere');
  assert.equal(g.rows[1]?.cells[0]?.value, 'temperature is constant');
  assert.equal(g.rows[2]?.cells[0]?.value, 'temperature increases slightly');
});

test('a cell the page did not state is blank, not invented', () => {
  const partial: CompareTableSpec = { ...three, cells: three.cells.filter((c) => c.id !== 'cell-1-1') };
  const g = compareGrid(partial);
  assert.equal(g.rows[1]?.cells[1], null);
  assert.equal(NOT_STATED, 'Not stated on this page');
});

test('cells with out-of-range or repeated positions are ignored (first one wins)', () => {
  const messy: CompareTableSpec = { ...three, cells: [
    ...three.cells,
    { id: 'dup', entityIndex: 0, attributeIndex: 0, value: 'DUPLICATE', sourceId: 's', quote: 'q' },
    { id: 'far', entityIndex: 9, attributeIndex: 0, value: 'FAR', sourceId: 's', quote: 'q' },
  ] };
  const g = compareGrid(messy);
  assert.equal(g.rows[0]?.cells[0]?.value, 'temperature decreases linearly');
  assert.equal(g.rows.flatMap((r) => r.cells).some((c) => c?.value === 'FAR'), false);
});

test('two zones cannot give three options, so predict falls back to reveal-only', () => {
  assert.equal(planPredict(two), null);
});

test('predict plan hides one cell and offers three distinct options from the same column', () => {
  const plan = planPredict(three);
  assert.ok(plan !== null);
  assert.equal(plan.options.length, 3);
  assert.equal(new Set(plan.options).size, 3);
  const cell = three.cells.find((c) => c.id === plan.cellId);
  assert.ok(cell !== undefined);
  assert.equal(plan.correct, cell.value);
  assert.ok(plan.options.includes(cell.value));
  const columnValues = three.cells.filter((c) => c.attributeIndex === cell.attributeIndex).map((c) => c.value);
  for (const o of plan.options) assert.ok(columnValues.includes(o), `option ${o} is from the same column`);
  assert.deepEqual(plan, planPredict(three));
});

test('the right option is not always first', () => {
  const firsts = new Set<boolean>();
  for (let seed = 0; seed < 50; seed++) {
    const p = planPredict({ ...three, seed });
    if (p !== null) firsts.add(p.options[0] === p.correct);
  }
  assert.ok(firsts.has(false));
});

test('grading compares the pick with the cell value', () => {
  const plan = planPredict(three);
  assert.ok(plan !== null);
  assert.equal(gradePredict(plan, plan.correct), true);
  assert.equal(gradePredict(plan, plan.options.find((o) => o !== plan.correct) as string), false);
  assert.equal(gradePredict(plan, 'something else'), false);
});
