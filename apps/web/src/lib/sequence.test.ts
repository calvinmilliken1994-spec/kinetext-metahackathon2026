/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import type { SequenceSpec } from '../../../../packages/contracts/kit.ts';
import { gradeSequence, sequenceStart, sequenceSummary } from './sequence.ts';
import { loadDemoLessons } from './stage6-fixtures.ts';

const gallery = loadDemoLessons().find((l) => l.id === 'gallery');
const spec = Object.values(gallery?.specs ?? {}).find((s) => s.componentId === 'sequence-v1') as SequenceSpec;
const stored = spec.steps.map((s) => s.id);

test('fixture has four steps in page order', () => {
  assert.equal(stored.length, 4);
  assert.equal(spec.orderBasis, 'page-order');
});

test('the starting order is a seeded shuffle that is never the answer', () => {
  const start = sequenceStart(spec);
  assert.deepEqual([...start].sort(), [...stored].sort());
  assert.deepEqual(start, sequenceStart(spec));
  for (let seed = 0; seed < 100; seed++) assert.notDeepEqual(sequenceStart({ ...spec, seed }), stored, `seed ${seed}`);
});

test('the stored order is correct and marks every place', () => {
  const g = gradeSequence(spec, stored);
  assert.equal(g.correct, true);
  assert.equal(g.rightCount, 4);
  assert.deepEqual(g.positions, [true, true, true, true]);
  assert.deepEqual(g.correctOrderIds, stored);
});

test('swapping the middle two steps marks them and the result is not correct', () => {
  const order = [stored[0], stored[2], stored[1], stored[3]] as string[];
  const g = gradeSequence(spec, order);
  assert.equal(g.correct, false);
  assert.deepEqual(g.positions, [true, false, false, true]);
  assert.equal(g.rightCount, 2);
});

test('an incomplete or unknown list is never correct', () => {
  assert.equal(gradeSequence(spec, stored.slice(0, 3)).correct, false);
  assert.equal(gradeSequence(spec, [...stored.slice(0, 3), 'zzz']).correct, false);
  assert.equal(gradeSequence(spec, [stored[0], stored[0], stored[1], stored[2]] as string[]).correct, false);
});

test('a cycle accepts any starting point but not a different direction', () => {
  const cyc: SequenceSpec = { ...spec, cyclic: true };
  const rotated = [stored[2], stored[3], stored[0], stored[1]] as string[];
  const g = gradeSequence(cyc, rotated);
  assert.equal(g.correct, true);
  assert.equal(g.cyclic, true);
  assert.equal(gradeSequence(cyc, [...stored].reverse()).correct, false);
  assert.equal(gradeSequence(spec, rotated).correct, false, 'a non-cyclic sequence has one starting point');
});

test('a wrong cyclic order marks places against the best rotation', () => {
  const cyc: SequenceSpec = { ...spec, cyclic: true };
  const g = gradeSequence(cyc, [stored[1], stored[2], stored[0], stored[3]] as string[]);
  assert.equal(g.correct, false);
  assert.equal(g.rightCount, 2, 'best rotation keeps the two that follow each other');
});

test('summary is plain language and names the page start for a cycle', () => {
  const labels = Object.fromEntries(spec.steps.map((s) => [s.id, s.label]));
  assert.match(sequenceSummary(gradeSequence(spec, stored), labels, spec), /^✓ Correct/);
  const bad = sequenceSummary(gradeSequence(spec, [stored[1], stored[0], stored[2], stored[3]] as string[]), labels, spec);
  assert.match(bad, /^✗ 2 of 4 steps are in the right place/);
  const cyc: SequenceSpec = { ...spec, cyclic: true };
  assert.match(sequenceSummary(gradeSequence(cyc, stored), labels, cyc), /cycle.*Drafted in secret/);
});
