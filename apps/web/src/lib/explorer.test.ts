/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import type { FormulaExplorerSpec } from '../../../../packages/contracts/kit.ts';
import {
  buildExplorer, caseOutputs, casePrompt, curveSamples, defaultInputs, evalAt, graphGeometry, gradeCaseGuess, niceRange, outputName,
  niceValueRows, pageFormulaStatus, sig6, sliderStep, tickValues, valueTable,
} from './explorer.ts';
import { loadDemoLessons } from './stage6-fixtures.ts';

const drag = loadDemoLessons().find((l) => l.id === 'drag');
const spec = Object.values(drag?.specs ?? {}).find((s) => s.componentId === 'formula-explorer-v1') as FormulaExplorerSpec;
const model = buildExplorer(spec);
if (!model.ok) throw new Error('fixture explorer should build');
const m = model;

test('the fixture builds an explorer with four variables', () => {
  assert.deepEqual(m.names, ['cd', 'rho', 'v', 'a']);
  assert.equal(m.xVariable, 'v');
});

test('opening inputs come from the first case and sliders have 100 steps', () => {
  assert.deepEqual(defaultInputs(spec), { cd: 0.5, rho: 1.2, v: 10, a: 1 });
  assert.ok(Math.abs(sliderStep({ min: 1, max: 100 }) - 0.99) < 1e-12);
  assert.ok(Math.abs(sliderStep({ min: 0.1, max: 1 }) - 0.009) < 1e-12);
});

test('Stage 7: the explorer opens on the FIRST case (clamped to the slider range); spec defaults only with no case', () => {
  const second = spec.cases[1];
  assert.ok(second !== undefined);
  const reordered: FormulaExplorerSpec = { ...spec, cases: [second, ...spec.cases.filter((c) => c.id !== second.id)] };
  assert.deepEqual(defaultInputs(reordered), { cd: 0.8, rho: 1, v: 20, a: 2 });
  const outOfRange: FormulaExplorerSpec = {
    ...spec,
    cases: [{ ...second, inputs: second.inputs.map((i) => (i.name === 'v' ? { ...i, value: 1e6 } : i.name === 'cd' ? { ...i, value: -5 } : i)) }],
  };
  const vMax = spec.variables.find((v) => v.name === 'v')?.max;
  const cdMin = spec.variables.find((v) => v.name === 'cd')?.min;
  assert.deepEqual(defaultInputs(outOfRange), { cd: cdMin, rho: 1, v: vMax, a: 2 });
  const partial: FormulaExplorerSpec = { ...spec, cases: [{ ...second, inputs: second.inputs.filter((i) => i.name !== 'rho') }] };
  assert.deepEqual(defaultInputs(partial), { cd: 0.8, rho: 1.2, v: 20, a: 2 }, 'a variable the case lacks keeps its default');
  assert.deepEqual(defaultInputs({ ...spec, cases: [] }), { cd: 0.5, rho: 1.2, v: 10, a: 1 });
});

test('the output is computed by our evaluator from the expression', () => {
  assert.equal(evalAt(m, defaultInputs(spec)), 30);
  assert.equal(evalAt(m, { cd: 0.8, rho: 1, v: 20, a: 2 }), 320);
});

test('case outputs are recomputed, not read from the spec', () => {
  const out = caseOutputs(m, spec);
  assert.deepEqual(out.map((c) => [c.id, c.output]), [['case-one', 30], ['case-two', 320]]);
  assert.deepEqual(out[1]?.inputs, { cd: 0.8, rho: 1, v: 20, a: 2 });
});

test('the curve has 101 samples over the x slider range with the other inputs held', () => {
  const s = curveSamples(m, spec, defaultInputs(spec));
  assert.equal(s.length, 101);
  assert.equal(s[0]?.x, 1);
  assert.ok(Math.abs((s[100]?.x ?? 0) - 100) < 1e-9);
  assert.ok(Math.abs((s[0]?.y ?? 0) - 0.3) < 1e-9);
  assert.ok(Math.abs((s[100]?.y ?? 0) - 3000) < 1e-6);
  for (let i = 1; i < s.length; i++) assert.ok((s[i]?.y ?? 0) > (s[i - 1]?.y ?? 0), 'drag rises with v');
  const halfArea = curveSamples(m, spec, { ...defaultInputs(spec), a: 0.5 });
  assert.ok(Math.abs((halfArea[100]?.y ?? 0) - 1500) < 1e-6, 'other sliders change the curve');
});

test('tick values are nice numbers inside the range', () => {
  assert.deepEqual(tickValues(0, 100, 5), [0, 20, 40, 60, 80, 100]);
  assert.deepEqual(tickValues(1, 100, 5), [20, 40, 60, 80, 100]);
  assert.deepEqual(tickValues(0, 1, 5), [0, 0.2, 0.4, 0.6, 0.8, 1]);
  assert.deepEqual(tickValues(5, 5, 5), [5]);
});

test('y range starts at zero for all-positive data and pads a flat line', () => {
  assert.deepEqual(niceRange(0.3, 3000), { min: 0, max: 3000, ticks: [0, 1000, 2000, 3000] });
  const mixed = niceRange(-5, 5);
  assert.ok(mixed.min <= -5 && mixed.max >= 5 && mixed.ticks.includes(0));
  const flat = niceRange(4, 4);
  assert.ok(flat.min < 4 && flat.max > 4);
  const high = niceRange(900, 1000);
  assert.ok(high.min > 0, 'data far from zero keeps a tight range');
});

test('graph geometry scales samples into the plot box and marks the current point', () => {
  const samples = curveSamples(m, spec, defaultInputs(spec));
  const g = graphGeometry(samples, { x: 10, y: 30 });
  assert.ok(g.plot.l < g.plot.r && g.plot.t < g.plot.b);
  assert.equal(g.segments.length, 1);
  const pts = (g.segments[0] ?? '').split(' ').map((p) => p.split(',').map(Number) as [number, number]);
  assert.equal(pts.length, 101);
  assert.ok(Math.abs((pts[0]?.[0] ?? 0) - g.plot.l) < 0.06 && Math.abs((pts[100]?.[0] ?? 0) - g.plot.r) < 0.06);
  assert.ok((pts[100]?.[1] ?? 99) < (pts[0]?.[1] ?? 0), 'bigger values are higher on screen');
  for (const [x, y] of pts) assert.ok(x >= g.plot.l - 0.1 && x <= g.plot.r + 0.1 && y >= g.plot.t - 0.1 && y <= g.plot.b + 0.1);
  const xr = g.plot.r - g.plot.l;
  assert.ok(Math.abs((g.current.px) - (g.plot.l + ((10 - 1) / 99) * xr)) < 1e-6);
  assert.equal(g.current.defined, true);
  const yr = g.yMax - g.yMin;
  assert.ok(Math.abs((g.current.py ?? 0) - (g.plot.b - ((30 - g.yMin) / yr) * (g.plot.b - g.plot.t))) < 1e-6);
  assert.ok(g.xTicks.every((t) => t.px >= g.plot.l - 0.01 && t.px <= g.plot.r + 0.01));
  assert.ok(g.yTicks.every((t) => t.py >= g.plot.t - 0.01 && t.py <= g.plot.b + 0.01));
});

test('undefined stretches break the line into segments instead of joining across them', () => {
  const samples = Array.from({ length: 101 }, (_, i) => ({ x: i, y: i >= 40 && i <= 60 ? Number.NaN : i + 1 }));
  const g = graphGeometry(samples, { x: 50, y: Number.NaN });
  assert.equal(g.segments.length, 2);
  assert.equal(g.hasGap, true);
  assert.equal(g.current.defined, false);
  assert.equal(g.current.py, null);
  assert.ok(g.segments.every((s) => !s.includes('NaN')));
});

test('an all-undefined curve draws nothing and does not crash', () => {
  const samples = Array.from({ length: 101 }, (_, i) => ({ x: i, y: Number.NaN }));
  const g = graphGeometry(samples, { x: 3, y: Number.NaN });
  assert.deepEqual(g.segments, []);
  assert.ok(Number.isFinite(g.plot.l));
});

test('the value table has six evenly spaced rows including both ends', () => {
  const rows = valueTable(curveSamples(m, spec, defaultInputs(spec)), 6);
  assert.equal(rows.length, 6);
  assert.equal(rows[0]?.x, 1);
  assert.ok(Math.abs((rows[5]?.x ?? 0) - 100) < 1e-9);
  assert.ok(Math.abs((rows[1]?.x ?? 0) - 20.8) < 1e-9);
});

test('numbers are shown to six significant figures', () => {
  assert.equal(sig6(30), '30');
  assert.equal(sig6(0.123456789), '0.123457');
  assert.equal(sig6(1234567), '1234570');
  assert.equal(sig6(-0), '0');
  assert.equal(sig6(Number.NaN), 'not defined');
});

test('the output is named after the left side of the page formula', () => {
  assert.equal(outputName(spec), 'D');
  assert.equal(outputName({ ...spec, formulaText: 'no equals sign here' }), 'result');
  assert.equal(outputName({ ...spec, formulaText: 'Drag force = Cd * x' }), 'result');
});

test('the page formula is compared with the expression using the page symbols', () => {
  assert.equal(pageFormulaStatus(spec), 'matches');
  assert.equal(pageFormulaStatus({ ...spec, expression: 'cd * (rho * v^2 * a)' }), 'mismatch');
  assert.equal(pageFormulaStatus({ ...spec, formulaText: 'Drag equals the coefficient times half the density' }), 'unparseable');
  assert.equal(pageFormulaStatus({ ...spec, formulaText: 'D = Cd * (rho * V^2 * A) / 2 * Zeta' }), 'unparseable');
});

test('the page formula comparison uses independently varied points, not only the five fixed fractions', () => {
  const v = spec.variables.find((x) => x.name === 'v') as FormulaExplorerSpec['variables'][number];
  const one: FormulaExplorerSpec = {
    ...spec,
    variables: [{ ...v, pageSymbol: 'V', min: 0, max: 10, default: 5.5 }],
    xVariable: 'v',
    cases: [],
    formulaText: 'D = V',
    expression: 'v',
  };
  assert.equal(pageFormulaStatus(one), 'matches');
  // This extra term is zero at 1, 3, 5, 7 and 9 (the old fixed sample points) and nowhere near zero elsewhere.
  assert.equal(pageFormulaStatus({ ...one, expression: 'v + (v - 1) * (v - 3) * (v - 5) * (v - 7) * (v - 9)' }), 'mismatch');
});

test('a spec whose expression does not parse does not build, with a plain reason', () => {
  const bad = buildExplorer({ ...spec, expression: 'cd * q' });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.match(bad.reason, /calculator/i);
  assert.equal(buildExplorer({ ...spec, xVariable: 'nope' }).ok, false);
  assert.equal(buildExplorer({ ...spec, variables: spec.variables.map((v) => (v.name === 'v' ? { ...v, min: 5, max: 5 } : v)) }).ok, false);
});

test('case prompt names the quantities with their values and units', () => {
  const p = casePrompt(spec, spec.cases[0] as FormulaExplorerSpec['cases'][number]);
  assert.match(p, /velocity = 10 m\/s/);
  assert.match(p, /drag coefficient = 0\.5/);
  assert.doesNotMatch(p, /0\.5 1/);
  assert.match(p, /What is D\?/);
});

test('guesses are graded with the teaching margin of 2% of the engine value', () => {
  assert.equal(gradeCaseGuess(30.5, 30).withinTolerance, true);
  assert.equal(gradeCaseGuess(32, 30).withinTolerance, false);
  assert.equal(gradeCaseGuess(32, 30).direction, 'high');
  assert.equal(gradeCaseGuess(30, 30).tolerance, 0.6);
});

test('the value table uses round x values between the two ends, each worked out by the calculator', () => {
  const inputs = defaultInputs(spec);
  const rows = niceValueRows(m, spec, inputs);
  const xv = spec.variables.find((v) => v.name === spec.xVariable) as FormulaExplorerSpec['variables'][number];
  assert.equal(rows[0]?.x, xv.min);
  assert.equal(rows[rows.length - 1]?.x, xv.max);
  assert.ok(rows.length >= 2 && rows.length <= 8);
  const ticks = tickValues(xv.min, xv.max);
  for (const r of rows.slice(1, -1)) assert.ok(ticks.includes(r.x), `${r.x} is a tick`);
  for (let i = 1; i < rows.length; i++) assert.ok((rows[i] as { x: number }).x > (rows[i - 1] as { x: number }).x);
  for (const r of rows) assert.equal(r.y, evalAt(m, { ...inputs, [spec.xVariable]: r.x }));
  // A range that starts on a tick does not repeat that row.
  const zero = niceValueRows(m, { ...spec, variables: spec.variables.map((v) => (v.name === spec.xVariable ? { ...v, min: 0, max: 10, default: 5 } : v)) }, { ...inputs, [spec.xVariable]: 5 });
  assert.deepEqual(zero.map((r) => r.x), [0, 2, 4, 6, 8, 10]);
});
