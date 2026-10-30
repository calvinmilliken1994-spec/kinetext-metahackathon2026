/// <reference types="node" />
// Stage 7 item 4b/4c: comparison ghost arcs at the same launch speeds and peak / landing labels that never collide.
import test from 'node:test';
import assert from 'node:assert/strict';
import { densify, leaderLine, PROJECTILE_FRAME, projectileScene, textBox } from './geometry.ts';
import type { LabelBox, ProjectileScene } from './geometry.ts';

const { W, H } = PROJECTILE_FRAME;

const overlaps = (a: LabelBox, b: LabelBox): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (p: { px: number; py: number }, b: LabelBox): boolean => p.px > b.x && p.px < b.x + b.w && p.py > b.y && p.py < b.y + b.h;

/** Independent re-check of a scene: labels inside the drawing, apart from each other, the fixed texts and every drawn curve. */
function assertClear(scene: ProjectileScene, what: string): void {
  const labels = [scene.labels.apex, scene.labels.landing, ...scene.ghosts.map((g) => g.label)];
  const leaders = [leaderLine(scene.labels.apex, scene.apex), ...scene.ghosts.map((g) => leaderLine(g.label, g.apex))]
    .filter((l) => l !== null)
    .map((l) => [{ px: l.x1, py: l.y1 }, { px: l.x2, py: l.y2 }]);
  const curves = [scene.points, ...scene.ghosts.map((g) => g.points), ...leaders].map((pts) => densify(pts, 2));
  for (const l of labels) {
    assert.ok(l.box.x >= 0 && l.box.y >= 0 && l.box.x + l.box.w <= W && l.box.y + l.box.h <= H, `${what}: "${l.text}" leaves the drawing`);
    for (const fixed of scene.fixedBoxes) assert.ok(!overlaps(l.box, fixed), `${what}: "${l.text}" covers an axis label or the title`);
    for (const pts of curves) assert.ok(!pts.some((p) => inside(p, l.box)), `${what}: "${l.text}" sits on a trajectory or a leader line`);
  }
  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) assert.ok(!overlaps(labels[i]!.box, labels[j]!.box), `${what}: "${labels[i]!.text}" overlaps "${labels[j]!.text}"`);
  }
}

test('Moon case 1 with the Earth ghost: the ghost uses the same launch speeds and peaks about six times lower', () => {
  const scene = projectileScene({ horizontalSpeedMps: 20, verticalSpeedMps: 15, gravityMps2: 1.62 }, [9.8]);
  assert.ok(scene !== null);
  assert.equal(scene.ghosts.length, 1);
  const ghost = scene.ghosts[0]!;
  assert.equal(ghost.gravityMps2, 9.8);
  assert.ok(Math.abs(ghost.maxHeightM - 15 ** 2 / (2 * 9.8)) < 1e-9);
  assert.ok(Math.abs(scene.maxHeightM / ghost.maxHeightM - 9.8 / 1.62) < 1e-9, 'heights scale as 1/g');
  // Same pixel scale for both arcs, so the drawn heights keep the real ratio.
  const groundY = scene.land.py;
  assert.ok(Math.abs((groundY - scene.apex.py) / (groundY - ghost.apex.py) - 9.8 / 1.62) < 1e-6);
  assert.equal(ghost.label.text, 'g = 9.8 m/s²');
  assert.equal(scene.labels.apex.text, 'max height 69.44 m');
  assert.equal(scene.labels.landing.text, 'lands at t = 18.52 s');
  assertClear(scene, 'Moon case 1');
});

test('Earth with the Moon ghost: the layout grows to fit the higher ghost arc', () => {
  const scene = projectileScene({ horizontalSpeedMps: 20, verticalSpeedMps: 15, gravityMps2: 9.8 }, [1.62]);
  assert.ok(scene !== null);
  const ghost = scene.ghosts[0]!;
  assert.ok(ghost.apex.py < scene.apex.py, 'the Moon ghost peaks higher on screen');
  assert.ok(ghost.apex.py >= PROJECTILE_FRAME.box.top - 1e-9 && ghost.land.px <= PROJECTILE_FRAME.box.right + 1e-9, 'the ghost fits the plot box');
  assertClear(scene, 'Earth + Moon ghost');
});

test('the old collision: "lands at" no longer sits on the descending curve (Moon spec opening at 9.8 before the fix)', () => {
  const scene = projectileScene({ horizontalSpeedMps: 20, verticalSpeedMps: 15, gravityMps2: 9.8 }, []);
  assert.ok(scene !== null);
  assert.equal(scene.labels.landing.text, 'lands at t = 3.06 s');
  // The pre-Stage-7 spot (right-aligned to the landing x, 20 px above the ground) lies on the descending arc.
  const old = textBox(scene.labels.landing.text, 12, scene.land.px, scene.land.py - 20, 'end');
  assert.ok(densify(scene.points, 2).some((p) => inside(p, old)), 'the old spot really collided');
  assertClear(scene, 'Earth, no ghost');
});

test('labels stay clear at every slider extreme of the Moon lesson, with and without ghosts', () => {
  const us = [5, 12, 20, 50];
  const vs = [5, 15, 30];
  const gs = [1.6, 1.62, 9.8, 24.8];
  let n = 0;
  for (const u of us) {
    for (const v of vs) {
      for (const g of gs) {
        for (const ghosts of [[], [1.62, 9.8].filter((x) => x !== g)]) {
          const scene = projectileScene({ horizontalSpeedMps: u, verticalSpeedMps: v, gravityMps2: g }, ghosts);
          assert.ok(scene !== null);
          assertClear(scene, `U0=${u} V0=${v} g=${g} ghosts=[${ghosts.join(',')}]`);
          n++;
        }
      }
    }
  }
  assert.equal(n, us.length * vs.length * gs.length * 2);
});

test('engine-rejected inputs give no scene; a rejected ghost is skipped', () => {
  assert.equal(projectileScene({ horizontalSpeedMps: 20, verticalSpeedMps: 15, gravityMps2: 0 }, []), null);
  const scene = projectileScene({ horizontalSpeedMps: 20, verticalSpeedMps: 15, gravityMps2: 9.8 }, [-1]);
  assert.ok(scene !== null);
  assert.equal(scene.ghosts.length, 0);
});
