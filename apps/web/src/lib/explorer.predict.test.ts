/// <reference types="node" />
// Presentation pass 2: the formula explorer's predict beat. The graph's x range is narrowed so case 1 sits near the middle
// (on the full slider range a low case is squeezed into the bottom corner and its reveal cannot be read from the back of
// a room), and the reveal labels can name whose guess it is.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExplorer, curveSamples, evalAt, graphGeometry, graphReveal, gradeCaseGuess, inputsOfCase, predictSpec } from './explorer.ts';
import { loadDemoLessons } from './stage6-fixtures.ts';
import type { FormulaExplorerSpec } from '../../../../packages/contracts/kit.ts';

function dragExplorer(): FormulaExplorerSpec {
  const drag = loadDemoLessons().find((l) => l.id === 'drag');
  const spec = Object.values(drag?.specs ?? {}).find((s) => s.componentId === 'formula-explorer-v1');
  if (spec === undefined || spec.componentId !== 'formula-explorer-v1') throw new Error('drag explorer missing');
  return spec;
}

test('predictSpec narrows the x range so case 1 sits near the middle, inside the slider range', () => {
  const spec = dragExplorer();
  const first = spec.cases[0];
  assert.ok(first !== undefined);
  const x0 = inputsOfCase(first)[spec.xVariable] as number;
  const before = spec.variables.find((v) => v.name === spec.xVariable);
  const narrowed = predictSpec(spec);
  const after = narrowed.variables.find((v) => v.name === spec.xVariable);
  assert.ok(before !== undefined && after !== undefined);
  assert.equal(after.min, before.min);
  assert.ok(after.max <= before.max && after.max > x0);
  const frac = (x0 - after.min) / (after.max - after.min);
  assert.ok(frac >= 0.3 && frac <= 0.6, `case 1 at ${frac.toFixed(2)} of the range`);
  // only the x range changes: the formula, the cases and the other variables are the same
  assert.equal(narrowed.expression, spec.expression);
  assert.deepEqual(narrowed.cases, spec.cases);
  for (const v of narrowed.variables) if (v.name !== spec.xVariable) assert.deepEqual(v, spec.variables.find((w) => w.name === v.name));
  // the value at case 1 is unchanged (same formula, same inputs)
  const m1 = buildExplorer(spec);
  const m2 = buildExplorer(narrowed);
  assert.ok(m1.ok && m2.ok);
  assert.equal(evalAt(m2, inputsOfCase(first)), evalAt(m1, inputsOfCase(first)));
});

test('predictSpec leaves a case already in the middle or at the top of the range alone', () => {
  const spec = dragExplorer();
  const xv = spec.variables.find((v) => v.name === spec.xVariable);
  assert.ok(xv !== undefined);
  const atTop = { ...spec, cases: spec.cases.map((c, i) => (i === 0 ? { ...c, inputs: c.inputs.map((inp) => (inp.name === spec.xVariable ? { ...inp, value: xv.max } : inp)) } : c)) };
  assert.deepEqual(predictSpec(atTop).variables, spec.variables);
  const mid = (xv.min + xv.max) / 2;
  const atMid = { ...spec, cases: spec.cases.map((c, i) => (i === 0 ? { ...c, inputs: c.inputs.map((inp) => (inp.name === spec.xVariable ? { ...inp, value: mid } : inp)) } : c)) };
  assert.deepEqual(predictSpec(atMid).variables, spec.variables);
});

test('graphReveal can say whose guess it is', () => {
  const spec = dragExplorer();
  const model = buildExplorer(spec);
  assert.ok(model.ok);
  const first = spec.cases[0];
  assert.ok(first !== undefined);
  const at = inputsOfCase(first);
  const out = evalAt(model, at);
  const g = graphGeometry(curveSamples(model, spec, at), { x: at[spec.xVariable] ?? 0, y: out });
  assert.match(graphReveal(g, gradeCaseGuess(out * 1.4, out), 'class').guessLabel.text, /^class guess /);
  assert.match(graphReveal(g, gradeCaseGuess(out * 1.4, out)).guessLabel.text, /^your guess /);
});
