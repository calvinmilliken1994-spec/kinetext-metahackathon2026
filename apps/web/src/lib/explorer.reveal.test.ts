/// <reference types="node" />
// Stage 7c (P1): the formula explorer as a demo hero — readable units, grouped numbers, a y axis wide enough for its labels,
// and the reveal overlay on the graph (guess line, teaching-margin band, the point settling from the guess to the value).
import test from 'node:test';
import assert from 'node:assert/strict';
import type { FormulaExplorerSpec } from '../../../../packages/contracts/kit.ts';
import { buildExplorer, casePrompt, curveSamples, displayUnit, evalAt, graphGeometry, graphReveal, groupedSig6, inputsOfCase } from './explorer.ts';
import { gradeCaseGuess } from './explorer.ts';
import { loadDemoLessons } from './stage6-fixtures.ts';

const drag = loadDemoLessons().find((l) => l.id === 'drag');
const fixture = Object.values(drag?.specs ?? {}).find((s) => s.componentId === 'formula-explorer-v1') as FormulaExplorerSpec;

/** The live NASA drag lesson (job-20261029122502-af74462a) writes its units as words. */
const WORDY: FormulaExplorerSpec = {
  ...fixture,
  formulaText: 'D = Cd * (rho * V^2 * A) / 2',
  expression: 'cd*(rho*v^2*a)/2',
  xVariable: 'v',
  variables: [
    { name: 'cd', pageSymbol: 'Cd', meaning: 'drag coefficient', meaningQuoted: false, unit: 'dimensionless', min: 0.02, max: 2, default: 0.5, quote: '' },
    { name: 'rho', pageSymbol: 'rho', meaning: 'air density', meaningQuoted: false, unit: 'kilograms per cubic meter', min: 0.3, max: 1.3, default: 1, quote: '' },
    { name: 'v', pageSymbol: 'V', meaning: 'flow velocity', meaningQuoted: false, unit: 'meters per second', min: 10, max: 200, default: 50, quote: '' },
    { name: 'a', pageSymbol: 'A', meaning: 'reference area', meaningQuoted: false, unit: 'square meters', min: 1, max: 20, default: 10, quote: '' },
  ] as FormulaExplorerSpec['variables'],
  cases: [
    { id: 'low', inputs: [{ name: 'cd', value: 0.5 }, { name: 'rho', value: 1 }, { name: 'v', value: 50 }, { name: 'a', value: 10 }] },
    { id: 'high', inputs: [{ name: 'cd', value: 0.5 }, { name: 'rho', value: 1 }, { name: 'v', value: 100 }, { name: 'a', value: 10 }] },
  ] as FormulaExplorerSpec['cases'],
};

test('unit words from the page become the usual symbols; a dimensionless quantity shows no unit; unknown text passes through', () => {
  assert.equal(displayUnit('meters per second'), 'm/s');
  assert.equal(displayUnit('metres per second'), 'm/s');
  assert.equal(displayUnit('kilograms per cubic meter'), 'kg/m³');
  assert.equal(displayUnit('square meters'), 'm²');
  assert.equal(displayUnit('Square Metres'), 'm²');
  assert.equal(displayUnit('dimensionless'), '');
  assert.equal(displayUnit('1'), '');
  assert.equal(displayUnit('newtons'), 'N');
  assert.equal(displayUnit('meters per second squared'), 'm/s²');
  assert.equal(displayUnit('m/s^2'), 'm/s²');
  assert.equal(displayUnit('m/s'), 'm/s');
  assert.equal(displayUnit('furlongs per fortnight'), 'furlongs per fortnight');
});

test('large numbers are grouped for reading at a distance; six significant figures stay', () => {
  assert.equal(groupedSig6(6250), '6,250');
  assert.equal(groupedSig6(100000), '100,000');
  assert.equal(groupedSig6(1040000), '1,040,000');
  assert.equal(groupedSig6(1234.5678), '1,234.57');
  assert.equal(groupedSig6(999), '999');
  assert.equal(groupedSig6(0.3), '0.3');
  assert.equal(groupedSig6(-25000), '-25,000');
  assert.equal(groupedSig6(1.5e-7), '1.5e-7');
  assert.equal(groupedSig6(Number.NaN), 'not defined');
});

test('the case prompt uses the compact units', () => {
  const p = casePrompt(WORDY, WORDY.cases[0] as FormulaExplorerSpec['cases'][number]);
  assert.equal(p, 'With drag coefficient = 0.5, air density = 1 kg/m³, flow velocity = 50 m/s, reference area = 10 m². What is D?');
});

test('graph ticks are grouped and the y axis is wide enough for its longest label at the slider extremes', () => {
  const m = buildExplorer(WORDY);
  assert.ok(m.ok);
  const top = { cd: 2, rho: 1.3, v: 200, a: 20 };
  const g = graphGeometry(curveSamples(m, WORDY, top), { x: 200, y: evalAt(m, top) });
  assert.ok(g.yTicks.some((t) => t.label === '1,000,000'), g.yTicks.map((t) => t.label).join(' '));
  const longest = Math.max(...g.yTicks.map((t) => t.label.length));
  // 13 px tabular figures are under 8 px wide each, plus the 7 px gap to the axis.
  assert.ok(g.plot.l >= longest * 8 + 10, `left margin ${g.plot.l} for "${longest}" chars`);
  const low = { cd: 0.02, rho: 0.3, v: 10, a: 1 };
  const g2 = graphGeometry(curveSamples(m, WORDY, low), { x: 10, y: evalAt(m, low) });
  assert.ok(g2.plot.l >= 56 && g2.plot.l < g.plot.l, 'short labels keep the default margin');
});

test('the reveal overlay: guess line and margin band on the graph scale, the point travels from the guess to the value', () => {
  const m = buildExplorer(WORDY);
  assert.ok(m.ok);
  const c = WORDY.cases[0] as FormulaExplorerSpec['cases'][number];
  const inputs = inputsOfCase(c);
  const actual = evalAt(m, inputs);
  assert.equal(actual, 6250);
  const g = graphGeometry(curveSamples(m, WORDY, inputs), { x: 50, y: actual });
  const sy = (y: number): number => g.plot.b - ((y - g.yMin) / (g.yMax - g.yMin)) * (g.plot.b - g.plot.t);
  const grade = gradeCaseGuess(5000, actual);
  const r = graphReveal(g, grade);
  assert.ok(Math.abs(r.guessPy - sy(5000)) < 1e-9);
  assert.equal(r.offScale, null);
  // The exact ±2% band is under a pixel on a 0–100,000 axis, so it is drawn 4 px tall, centred on the value.
  const mid = sy(6250);
  assert.ok(sy(6250 - 125) - sy(6250 + 125) < 4);
  assert.ok(Math.abs((r.band.top + r.band.bottom) / 2 - mid) < 1e-9 && Math.abs(r.band.bottom - r.band.top - 4) < 1e-9);
  const wide = graphReveal(g, gradeCaseGuess(5000, 60000));
  assert.ok(Math.abs(wide.band.top - sy(61200)) < 1e-9 && Math.abs(wide.band.bottom - sy(58800)) < 1e-9, 'a wide margin is drawn to scale');
  assert.ok(Math.abs(r.fromDy - (sy(5000) - (g.current.py as number))) < 1e-9, 'the dot starts at the guess height');
  assert.equal(r.within, false);
  assert.equal(r.text, '1,250 too low');
  const ok = graphReveal(g, gradeCaseGuess(6300, actual));
  assert.equal(ok.within, true);
  assert.equal(ok.text, 'inside the ±125 margin');
});

test('reveal labels avoid the curve, each other and the plot edges, even when the gap is a few pixels', () => {
  const m = buildExplorer(WORDY);
  assert.ok(m.ok);
  for (const c of WORDY.cases) {
    const inputs = inputsOfCase(c);
    const actual = evalAt(m, inputs);
    const g = graphGeometry(curveSamples(m, WORDY, inputs), { x: inputs['v'] as number, y: actual });
    const curve = g.segments.flatMap((seg) => seg.split(' ').map((p) => { const [x, y] = p.split(',').map(Number); return { px: x as number, py: y as number }; }));
    for (const guess of [actual * 0.8, actual * 1.01, actual * 3, 1e9, -10]) {
      const r = graphReveal(g, gradeCaseGuess(guess, actual));
      for (const l of [r.guessLabel, r.deltaLabel]) {
        assert.ok(l.box.x >= g.plot.l - 1 && l.box.x + l.box.w <= g.plot.r + 1 && l.box.y >= g.plot.t - 1 && l.box.y + l.box.h <= g.plot.b + 1, `${guess}: "${l.text}" leaves the plot`);
        const hit = curve.some((p) => p.px > l.box.x && p.px < l.box.x + l.box.w && p.py > l.box.y && p.py < l.box.y + l.box.h);
        assert.ok(!hit, `${c.id} guess ${guess}: "${l.text}" sits on the curve`);
      }
      const a = r.guessLabel.box;
      const b = r.deltaLabel.box;
      assert.ok(!(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h), `${guess}: the two labels overlap`);
    }
  }
});

test('a guess outside the plotted range is pinned to the edge and says so; the dot travel is bounded', () => {
  const m = buildExplorer(WORDY);
  assert.ok(m.ok);
  const inputs = inputsOfCase(WORDY.cases[0] as FormulaExplorerSpec['cases'][number]);
  const g = graphGeometry(curveSamples(m, WORDY, inputs), { x: 50, y: 6250 });
  const hi = graphReveal(g, gradeCaseGuess(1e9, 6250));
  assert.equal(hi.offScale, 'above');
  assert.equal(hi.guessPy, g.plot.t);
  const lo = graphReveal(g, gradeCaseGuess(-50, 6250));
  assert.equal(lo.offScale, 'below');
  assert.equal(lo.guessPy, g.plot.b);
  assert.ok(Math.abs(hi.fromDy) <= g.plot.b - g.plot.t);
});
