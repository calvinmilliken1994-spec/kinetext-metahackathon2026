/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { casePrompt, shortMeaning, valueRowsWithNow } from './explorer.ts';
import type { FormulaExplorerSpec } from '../../../../packages/contracts/kit.ts';

/** The stored NASA Drag lesson's formula explorer (job-20261030055141-b79a84e7), trimmed to what the prompt reads. */
const DRAG = {
  formulaText: 'D = Cd * (rho * V^2 * A) / 2',
  variables: [
    { name: 'cd', meaning: 'drag coefficient that collects shape and flow effects', unit: 'dimensionless', default: 0.5 },
    { name: 'rho', meaning: 'density of the air', unit: 'kilograms per cubic meter', default: 1.2 },
    { name: 'v', meaning: 'speed of the flow relative to the body', unit: 'meters per second', default: 50 },
    { name: 'area', meaning: 'reference area for the body size', unit: 'square meters', default: 1 },
  ],
  cases: [{ id: 'steady-cruise', inputs: [{ name: 'cd', value: 0.5 }, { name: 'rho', value: 1.2 }, { name: 'v', value: 50 }, { name: 'area', value: 1 }] }],
} as unknown as FormulaExplorerSpec;

test('the case prompt names each quantity by its short label, so the question is one readable line', () => {
  assert.equal(
    casePrompt(DRAG, DRAG.cases[0] as FormulaExplorerSpec['cases'][number]),
    'With drag coefficient = 0.5, density of the air = 1.2 kg/m³, speed of the flow = 50 m/s, reference area = 1 m². What is D?',
  );
});

test('shortMeaning: a long variable meaning becomes a short slider label at a natural break', () => {
  assert.equal(shortMeaning('drag coefficient that collects shape and flow effects'), 'drag coefficient');
  assert.equal(shortMeaning('speed of the flow relative to the body'), 'speed of the flow');
  assert.equal(shortMeaning('reference area for the body size'), 'reference area');
  assert.equal(shortMeaning('mass of the object, measured in kilograms on a scale'), 'mass of the object');
});

test('shortMeaning keeps a meaning that is already short, and never ends on a dangling small word', () => {
  assert.equal(shortMeaning('density of the air'), 'density of the air');
  assert.equal(shortMeaning('wing area'), 'wing area');
  assert.equal(shortMeaning('number of times interest is added in each year of the loan period'), 'number of times interest');
  const long = shortMeaning('extraordinarily lengthy unbroken description words continuing onwards');
  assert.ok(long.length <= 32, long);
  assert.ok(!/\b(of|the|a|an|and|to|in|for|that|with)$/.test(long), long);
});

test('valueRowsWithNow: the current x sits in order among the table rows, marked as now', () => {
  const rows = [{ x: 10, y: 1 }, { x: 20, y: 2 }, { x: 40, y: 4 }, { x: 60, y: 6 }];
  assert.deepEqual(valueRowsWithNow(rows, 50, 5), [
    { x: 10, y: 1, now: false }, { x: 20, y: 2, now: false }, { x: 40, y: 4, now: false }, { x: 50, y: 5, now: true }, { x: 60, y: 6, now: false },
  ]);
  assert.deepEqual(valueRowsWithNow(rows, 20, 2).map((r) => r.now), [false, true, false, false], 'a row already at x is marked, not duplicated');
  assert.deepEqual(valueRowsWithNow(rows, 5, 0.5)[0], { x: 5, y: 0.5, now: true }, 'below the first row');
  assert.deepEqual(valueRowsWithNow(rows, 70, 7).at(-1), { x: 70, y: 7, now: true }, 'past the last row');
});
