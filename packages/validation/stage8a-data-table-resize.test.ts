// Stage 8a (lead): data-table-v1 DT-04 `/rows/i/values` count findings get exactly the compare-table S6R-06
// structural permission — add or remove TAIL slots of that row to reach the revision-1 column count, never a
// rewrite of the retained prefix cells.
// Run: node --test packages/validation/stage8a-data-table-resize.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';

import type { DataTableGen } from '../contracts/kit.ts';
import { compareKitRevisions, validateKitComponent } from './kit/index.ts';
import { checkOf, clone, failedIds, synthSource } from './fixtures/stage6.ts';

const A = 'Alpha rock has a mass of 12 kg and an age of 300 years.';
const B = 'Beta rock has a mass of 15 kg and an age of 200 years.';
const G = 'Gamma rock has a mass of 9 kg and an age of 100 years.';
const SRC = synthSource('rocks', 'Classroom rocks', `${A} ${B} ${G}`);
const cell = (value: string, quote: string) => ({ value, sourceId: 'rocks', quote });

function shortRowBaseline(): DataTableGen {
  return {
    schemaVersion: 'data-table-v1',
    title: 'Compare the classroom rocks',
    labelHeader: 'Rock',
    columns: [
      { header: 'mass', unit: 'kg', numeric: true, sourceId: 'rocks', quote: A },
      { header: 'age', unit: 'years', numeric: true, sourceId: 'rocks', quote: A },
    ],
    rows: [
      { label: 'Alpha rock', sourceId: 'rocks', quote: A, values: [cell('12', A)] },
      { label: 'Beta rock', sourceId: 'rocks', quote: B, values: [cell('15', B), cell('200', B)] },
      { label: 'Gamma rock', sourceId: 'rocks', quote: G, values: [cell('9', G), cell('100', G)] },
    ],
    questions: [{ id: 'q-heaviest', kind: 'largest', rowIndex: -1, columnIndex: 0 }],
    chartColumnIndex: -1,
    brackets: { enabled: false, rateColumnIndex: -1, overColumnIndex: -1, exampleIncome: 0 },
  };
}
function honestFix(): DataTableGen {
  const g = clone(shortRowBaseline());
  g.rows[0]!.values.push(cell('300', A));
  return g;
}
const check = (base: DataTableGen, next: DataTableGen) => compareKitRevisions('data-table-v1', base, next, { sources: [SRC] });
const verdict = (g: DataTableGen) => validateKitComponent('data-table-v1', g, [SRC]);

test('control: the short row fails only DT-04 naming /rows/0/values; the honest tail append passes both gates', () => {
  const base = verdict(shortRowBaseline());
  assert.deepEqual(failedIds(base), ['DT-04']);
  assert.ok((checkOf(base, 'DT-04').affected ?? []).includes('/rows/0/values'));
  assert.equal(verdict(honestFix()).publishable, true, failedIds(verdict(honestFix())).join());
  const c = check(shortRowBaseline(), honestFix());
  assert.equal(c.passed, true, c.message);
});

test('append plus a rewrite of the valid prefix cell is rejected', () => {
  const changed = clone(honestFix());
  changed.rows[0]!.values[0]!.value = '300';
  changed.rows[0]!.values[1]!.value = '12';
  const c = check(shortRowBaseline(), changed);
  assert.equal(c.passed, false, 'the comparator must reject the prefix rewrite');
});

test('a resize that overshoots the column count is rejected', () => {
  const over = clone(honestFix());
  over.rows[0]!.values.push(cell('12', A));
  assert.equal(check(shortRowBaseline(), over).passed, false);
});

test('resizing a row the finding did not name is rejected', () => {
  const other = clone(honestFix());
  other.rows[1]!.values.pop();
  assert.equal(check(shortRowBaseline(), other).passed, false);
});
