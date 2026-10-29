// Wave A3 (Stage 6 review S6R-06): the compare-table CT-03 `/rows/i/values` count finding grants
// STRUCTURAL permission only (add or remove tail slots to reach the column count). It must not
// unlock the content of the retained prefix cells. Turned from the reviewer probes
// `compare-resize-control`, `compare-resize-changes-passing-cell` and `compare-excess-tail-removal`.
// Run: node --test packages/validation/stage6-a3-compare-resize.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';

import type { CompareTableGen } from '../contracts/kit.ts';
import { compareKitRevisions, validateKitComponent } from './kit/index.ts';
import { checkOf, clone, failedIds, synthSource } from './fixtures/stage6.ts';

const SRC = synthSource('compare', 'Classroom text', 'Alpha rock is hard and old. Beta rock is soft and young.');
const cell = (value: string, quote: string) => ({ value, sourceId: 'compare', quote });
const ALPHA = 'Alpha rock is hard and old.';
const BETA = 'Beta rock is soft and young.';

/** Reviewer probe table: Alpha's row holds only the valid texture, so CT-03 alone fails. */
function shortRowBaseline(): CompareTableGen {
  return {
    schemaVersion: 'compare-table-v1',
    title: 'Compare rock properties',
    attributes: ['texture', 'age'],
    rows: [
      { entity: 'Alpha rock', values: [cell('hard', ALPHA)] },
      { entity: 'Beta rock', values: [cell('soft', BETA), cell('young', BETA)] },
    ],
  };
}
function honestFix(): CompareTableGen {
  const g = clone(shortRowBaseline());
  g.rows[0]!.values.push(cell('old', ALPHA));
  return g;
}
const check = (base: CompareTableGen, next: CompareTableGen) => compareKitRevisions('compare-table-v1', base, next, { sources: [SRC] });
const verdict = (g: CompareTableGen) => validateKitComponent('compare-table-v1', g, [SRC]);

test('control: the baseline fails only CT-03 naming /rows/0/values, the honest tail append passes both gates', () => {
  const base = verdict(shortRowBaseline());
  assert.deepEqual(failedIds(base), ['CT-03']);
  assert.deepEqual(checkOf(base, 'CT-03').affected, ['/rows/0/values']);
  assert.equal(verdict(honestFix()).publishable, true, failedIds(verdict(honestFix())).join());
  const c = check(shortRowBaseline(), honestFix());
  assert.equal(c.passed, true, c.message);
});

test('compare-resize-changes-passing-cell: append + overwriting the valid prefix cell is rejected even though the new report passes', () => {
  const changed = clone(honestFix());
  changed.rows[0]!.values[0]!.value = 'old'; // the already-valid texture 'hard' is replaced by 'old'
  assert.equal(verdict(changed).publishable, true, 'the content gate alone cannot see the swap (value "old" occurs in the quote)');
  const c = check(shortRowBaseline(), changed);
  assert.equal(c.passed, false, 'the comparator must reject the prefix rewrite');
  assert.match(c.message, /\/rows\/0\/values\/0\/value changed from "hard" to "old" outside the affected paths/);
});

test('prefix quote, sourceId and whole-cell rewrites are equally frozen', () => {
  const q = clone(honestFix());
  q.rows[0]!.values[0]!.quote = 'Alpha rock is hard and old. ';
  assert.equal(check(shortRowBaseline(), q).passed, false);
  const swapped = clone(honestFix());
  const [a, b] = [swapped.rows[0]!.values[0]!, swapped.rows[0]!.values[1]!];
  swapped.rows[0]!.values[0] = b;
  swapped.rows[0]!.values[1] = a;
  assert.equal(check(shortRowBaseline(), swapped).passed, false, 'reordering the prefix into the tail slot is a content rewrite');
});

test('compare-excess-tail-removal: an excess tail slot may be removed, down to exactly the column count', () => {
  const excess = clone(honestFix());
  excess.rows[0]!.values.push(cell('old', ALPHA));
  assert.deepEqual(failedIds(verdict(excess)), ['CT-03']);
  const c = check(excess, honestFix());
  assert.equal(c.passed, true, c.message);
});

test('excess tail removal that also edits a retained cell is rejected', () => {
  const excess = clone(honestFix());
  excess.rows[0]!.values.push(cell('old', ALPHA));
  const next = clone(honestFix());
  next.rows[0]!.values[1]!.value = 'hard';
  assert.equal(check(excess, next).passed, false);
});

test('the resize must land exactly on the column count: over-fixing or under-fixing the slot count is rejected', () => {
  const under = clone(shortRowBaseline());
  under.attributes = ['texture', 'age', 'colour'];
  under.rows[1]!.values.push(cell('young', BETA));
  // baseline has 3 columns, row 0 has 1 value and row 1 has 3? make row0 resize to 2 only (still short)
  const base = clone(under);
  base.rows[0]!.values = [cell('hard', ALPHA)];
  const next = clone(base);
  next.rows[0]!.values.push(cell('old', ALPHA)); // 2 of 3 columns: not the column count
  assert.equal(check(base, next).passed, false);
  const over = clone(shortRowBaseline());
  over.rows[0]!.values.push(cell('old', ALPHA), cell('old', ALPHA)); // 3 values for 2 columns
  assert.equal(check(shortRowBaseline(), over).passed, false);
});

test('a missing HEAD slot cannot be repaired by shifting the prefix (tail-only resize; documented limit)', () => {
  // The row holds only the age; the honest repair would need to insert the texture first.
  const base = clone(shortRowBaseline());
  base.rows[0]!.values = [cell('old', ALPHA)];
  const next = clone(base);
  next.rows[0]!.values = [cell('hard', ALPHA), cell('old', ALPHA)];
  assert.deepEqual(failedIds(verdict(base)), ['CT-03']);
  assert.equal(check(base, next).passed, false);
});

test('retained prefix cells keep their own repair authority: a failing cell is fixed together with the append', () => {
  const base = clone(shortRowBaseline());
  base.rows[0]!.values[0]!.value = 'smooth'; // not in its quote: CT-02 names the value and quote paths
  const report = verdict(base);
  assert.deepEqual(failedIds(report).sort(), ['CT-02', 'CT-03']);
  const c = check(base, honestFix());
  assert.equal(c.passed, true, c.message);
  // ... but fixing the failing cell does not unlock its passing neighbour
  const greedy = clone(honestFix());
  greedy.rows[1]!.values[0]!.value = 'young';
  assert.equal(check(base, greedy).passed, false);
});

test('resizing the rows list or the attributes list still stays frozen; other rows stay frozen during a row resize', () => {
  const dropRow = clone(honestFix());
  dropRow.rows.pop();
  assert.equal(check(shortRowBaseline(), dropRow).passed, false);
  const other = clone(honestFix());
  other.rows[1]!.values[0]!.value = 'young';
  const c = check(shortRowBaseline(), other);
  assert.equal(c.passed, false);
});

test('caller findings can only narrow: a finding naming the values list but not the check unlocks nothing', () => {
  const c = compareKitRevisions('compare-table-v1', shortRowBaseline(), honestFix(), {
    sources: [SRC],
    findings: [{ id: 'CT-01', message: 'x', affected: ['/rows/0/values'] }] as never,
  });
  assert.equal(c.passed, false);
});
