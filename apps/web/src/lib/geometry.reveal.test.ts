/// <reference types="node" />
// Stage 7c (P1): the reveal moment of the projectile scene. After a prediction is run, the scene draws the class's guess
// as a level line, the engine's peak with the teaching margin as a band around it, and a bracket that names the gap.
import test from 'node:test';
import assert from 'node:assert/strict';
import { densify, leaderLine, PROJECTILE_FRAME, projectileScene, sceneGuess } from './geometry.ts';
import type { LabelBox, PlacedLabel, ProjectileScene } from './geometry.ts';
import { studentTolerance } from './predictions.ts';

const { W, H, box } = PROJECTILE_FRAME;
const MOON = { horizontalSpeedMps: 10, verticalSpeedMps: 8, gravityMps2: 1.62 };
const PEAK = 8 ** 2 / (2 * 1.62);
const TOL = studentTolerance(PEAK, 0.01);

const overlaps = (a: LabelBox, b: LabelBox): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (p: { px: number; py: number }, b: LabelBox): boolean => p.px > b.x && p.px < b.x + b.w && p.py > b.y && p.py < b.y + b.h;

function allLabels(s: ProjectileScene): PlacedLabel[] {
  return [s.labels.apex, s.labels.landing, ...s.ghosts.map((g) => g.label), ...(s.arcLabel ? [s.arcLabel] : []), ...(s.reveal ? [s.reveal.label, s.reveal.delta] : [])];
}

/** Every label inside the drawing, off the fixed texts, the arcs and the guess line, and apart from the others. */
function assertClear(s: ProjectileScene, what: string): void {
  const labels = allLabels(s);
  const lines: { px: number; py: number }[][] = [s.points, ...s.ghosts.map((g) => g.points)];
  if (s.reveal !== null) lines.push([{ px: box.left, py: s.reveal.guessPy }, { px: box.right, py: s.reveal.guessPy }]);
  const curves = lines.map((pts) => densify(pts, 2));
  for (const l of labels) {
    assert.ok(l.box.x >= 0 && l.box.y >= 0 && l.box.x + l.box.w <= W && l.box.y + l.box.h <= H, `${what}: "${l.text}" leaves the drawing`);
    for (const f of s.fixedBoxes) assert.ok(!overlaps(l.box, f), `${what}: "${l.text}" covers the title or an axis label`);
    for (const pts of curves) assert.ok(!pts.some((p) => inside(p, l.box)), `${what}: "${l.text}" sits on a line`);
  }
  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) assert.ok(!overlaps(labels[i]!.box, labels[j]!.box), `${what}: "${labels[i]!.text}" overlaps "${labels[j]!.text}"`);
  }
}

test('the guess is drawn only while the sliders still show the graded case', () => {
  const caseIn = { horizontalSpeedMps: 10, verticalSpeedMps: 8, gravityMps2: 1.62 };
  const grade = { guess: 15, tolerance: TOL };
  assert.deepEqual(sceneGuess(caseIn, { ...caseIn }, grade), { guessM: 15, toleranceM: TOL });
  assert.equal(sceneGuess(caseIn, { ...caseIn, gravityMps2: 9.8 }, grade), null, 'a slider moved');
  assert.equal(sceneGuess(caseIn, { horizontalSpeedMps: 10, verticalSpeedMps: 8 }, grade), null, 'an input is missing');
  assert.equal(sceneGuess(null, caseIn, grade), null);
  assert.equal(sceneGuess(caseIn, caseIn, null), null);
});

test('no guess: the scene has no reveal overlay (the opening scene is unchanged)', () => {
  const s = projectileScene(MOON, [9.8]);
  assert.ok(s !== null);
  assert.equal(s.reveal, null);
});

test('a low guess: level line at the guessed height on the same scale, margin band around the engine peak, gap named', () => {
  const s = projectileScene(MOON, [9.8], 'Thrown ball', { guessM: 15, toleranceM: TOL });
  assert.ok(s !== null && s.reveal !== null);
  const r = s.reveal;
  assert.equal(r.offScale, null);
  assert.ok(Math.abs(r.guessPy - s.layout.toPx(0, 15).py) < 1e-9, 'the guess line uses the scene scale');
  assert.ok(Math.abs(r.band.top - s.layout.toPx(0, PEAK + TOL).py) < 1e-9);
  assert.ok(Math.abs(r.band.bottom - s.layout.toPx(0, PEAK - TOL).py) < 1e-9);
  assert.ok(r.band.bottom - r.band.top >= 4, 'a margin band is always visible, even when 2% is a few pixels');
  assert.equal(r.within, false);
  assert.equal(r.direction, 'low');
  assert.equal(r.label.text, 'your guess 15 m');
  assert.equal(r.delta.text, '4.75 m too low');
  assert.equal(r.bracket.y1, r.guessPy);
  assert.equal(r.bracket.y2, s.apex.py);
  assertClear(s, 'low guess');
});

test('a guess inside the teaching margin says so and quotes the margin', () => {
  const s = projectileScene(MOON, [9.8], '', { guessM: 19.6, toleranceM: TOL });
  assert.ok(s !== null && s.reveal !== null);
  assert.equal(s.reveal.within, true);
  assert.equal(s.reveal.delta.text, 'inside the ±0.395 m margin');
  assertClear(s, 'close guess');
});

test('a guess above the peak but within reach widens the drawing so the line fits', () => {
  const s = projectileScene(MOON, [9.8], '', { guessM: 40, toleranceM: TOL });
  assert.ok(s !== null && s.reveal !== null);
  assert.equal(s.reveal.offScale, null);
  assert.ok(s.reveal.guessPy >= box.top - 1e-9 && s.reveal.guessPy < s.apex.py);
  assert.equal(s.reveal.delta.text, '20.2 m too high');
  assertClear(s, 'high guess');
});

test('a wild guess does not crush the arc: it is drawn at the top edge and labelled as off the drawing', () => {
  const s = projectileScene(MOON, [9.8], '', { guessM: 5000, toleranceM: TOL });
  const plain = projectileScene(MOON, [9.8]);
  assert.ok(s !== null && s.reveal !== null && plain !== null);
  assert.equal(s.reveal.offScale, 'above');
  assert.equal(s.layout.scale, plain.layout.scale, 'the arc keeps its size');
  assert.ok(s.reveal.guessPy < box.top);
  assert.match(s.reveal.label.text, /^your guess 5000 m, above the drawing$/);
  assertClear(s, 'wild guess');
});

test('a negative guess sits on the ground line and says it is below the ground', () => {
  const s = projectileScene(MOON, [], '', { guessM: -3, toleranceM: TOL });
  assert.ok(s !== null && s.reveal !== null);
  assert.equal(s.reveal.offScale, 'below');
  assert.equal(s.reveal.guessPy, box.bottom);
  assert.match(s.reveal.label.text, /below the ground/);
});

test('with a comparison arc, the live arc carries its own g label so the two read apart at a glance', () => {
  const s = projectileScene(MOON, [9.8], 'Thrown ball');
  assert.ok(s !== null && s.arcLabel !== null);
  assert.equal(s.arcLabel.text, 'g = 1.62 m/s²');
  assert.equal(projectileScene(MOON, [])?.arcLabel, null, 'no comparison, no extra label');
  assertClear(s, 'arc label');
  // A tiny arc under long comparison arcs: no label far away on a long leader.
  const tiny = projectileScene({ horizontalSpeedMps: 50, verticalSpeedMps: 2, gravityMps2: 24.8 }, [1.62, 9.8], 'Thrown ball');
  assert.ok(tiny !== null);
  if (tiny.arcLabel !== null && tiny.arcLabelAnchor !== null) {
    const lead = leaderLine(tiny.arcLabel, tiny.arcLabelAnchor);
    assert.ok(lead === null || Math.hypot(lead.x2 - lead.x1, lead.y2 - lead.y1) <= 60);
  }
});

test('reveal labels stay clear across the slider extremes and every Moon/Earth case', () => {
  const launches = [
    { horizontalSpeedMps: 5, verticalSpeedMps: 2, gravityMps2: 24.8 },
    { horizontalSpeedMps: 50, verticalSpeedMps: 30, gravityMps2: 1 },
    { horizontalSpeedMps: 5, verticalSpeedMps: 30, gravityMps2: 1 },
    { horizontalSpeedMps: 50, verticalSpeedMps: 2, gravityMps2: 24.8 },
    { horizontalSpeedMps: 10, verticalSpeedMps: 8, gravityMps2: 9.8 },
    { horizontalSpeedMps: 12, verticalSpeedMps: 12, gravityMps2: 1.62 },
    { horizontalSpeedMps: 20, verticalSpeedMps: 15, gravityMps2: 1.62 },
  ];
  for (const input of launches) {
    const peak = input.verticalSpeedMps ** 2 / (2 * input.gravityMps2);
    const ghosts = [1.62, 9.8].filter((g) => g !== input.gravityMps2);
    for (const factor of [0, 0.5, 0.99, 1, 1.4, 2.4, 50]) {
      const s = projectileScene(input, ghosts, 'Thrown ball · Level field on the Moon', { guessM: peak * factor, toleranceM: studentTolerance(peak, 0.01) });
      assert.ok(s !== null && s.reveal !== null);
      for (const l of allLabels(s)) assert.ok(l.box.x >= 0 && l.box.x + l.box.w <= W && l.box.y >= 0 && l.box.y + l.box.h <= H, `${JSON.stringify(input)} x${factor}: "${l.text}" leaves the drawing`);
      const lead = leaderLine(s.labels.apex, s.apex);
      if (lead !== null) assert.ok(Number.isFinite(lead.x1 + lead.y2));
      // The two reveal labels never sit on each other or on the peak label.
      const [a, b, c] = [s.reveal.label, s.reveal.delta, s.labels.apex];
      assert.ok(!overlaps(a.box, b.box) && !overlaps(a.box, c.box) && !overlaps(b.box, c.box), `${JSON.stringify(input)} x${factor}: reveal labels collide`);
    }
  }
});
