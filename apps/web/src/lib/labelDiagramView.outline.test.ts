/// <reference types="node" />
// Stage 8c slice W (docs/specs/STAGE-8c-label-coverage-and-outlines.md): SAM's traced outlines draw in during the build
// (boxes stay the fallback), and a printed label no part claims is a muted patch, never a fillable slot.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { LabelDiagramGen, LabelDiagramSpec } from '../../../../packages/contracts/kit.ts';
import type { Provenance } from '../../../../packages/contracts/index.ts';
import {
  isOutlinePath, labelSlots, MAX_OUTLINE_CHARS, outlineToDraw, outlineViewBox, partViews, patchColour, patchFill, patchFills, regionDrawing, slotStates, stageView,
} from './labelDiagramView.ts';
import { buildLabelDiagramDemos } from './labelDiagramDemoSpecs.ts';
import type { FigureLabelsLike, FigureMetaLike } from './labelDiagramDemoSpecs.ts';
import { WATER_OUTLINES } from './labelOutline.fixtures.ts';

const root = new URL('../../../../', import.meta.url);
const json = <T>(p: string): T => JSON.parse(readFileSync(new URL(p, root), 'utf8')) as T;
const demos = buildLabelDiagramDemos(
  json<LabelDiagramGen>('tests/fixtures/stage6/label-diagram.gen.json'),
  { meta: json<FigureMetaLike>('data/figures/medlineplus-dna-structure-1.json'), labels: json<FigureLabelsLike>('data/figures/medlineplus-dna-structure-1.labels.json') },
  json<Provenance>('tests/fixtures/provenance.fixture.json'), {},
  { meta: json<FigureMetaLike>('data/figures/noaa-hydrologic-cycle-1.json'), labels: json<FigureLabelsLike>('data/figures/noaa-hydrologic-cycle-1.labels.json') },
);
const demo = (id: string): LabelDiagramSpec => {
  const d = demos.find((x) => x.id === id);
  assert.ok(d !== undefined, id);
  return d.spec;
};

const box = { left: 1, top: 2, width: 3, height: 4 };

// ---- outlines -------------------------------------------------------------------------------------------------------

test('an outline path is SVG move/line/close commands with numbers only, at most 6000 characters', () => {
  assert.equal(MAX_OUTLINE_CHARS, 6000);
  assert.equal(isOutlinePath('M 1 2 L 3.5 4 L -0.5 6 Z'), true);
  assert.equal(isOutlinePath(WATER_OUTLINES.runoff), true);
  assert.equal(isOutlinePath(''), false);
  assert.equal(isOutlinePath('L 1 2 Z'), false, 'must start with a move');
  assert.equal(isOutlinePath('M 1 2 C 3 4 5 6 7 8 Z'), false, 'curves are not in the frozen shape');
  assert.equal(isOutlinePath('M 1 2 L 3 4 Z"><script>'), false);
  assert.equal(isOutlinePath(`M 0 0${' L 1 1'.repeat(1300)} Z`), false, 'over 6000 characters');
  assert.equal(isOutlinePath(42), false);
});

test('a confident region with an outline draws the outline; a weak one draws nothing (same 50% rule as boxes)', () => {
  const d = WATER_OUTLINES.condensation;
  assert.equal(outlineToDraw({ outline: d, confidence: 0.79 }), d);
  assert.equal(outlineToDraw({ outline: d, confidence: 0.5 }), d);
  assert.equal(outlineToDraw({ outline: d, confidence: 0.28 }), null);
  assert.equal(outlineToDraw({ outline: d, confidence: null }), d, 'no score (older runs) draws, like a box');
  assert.equal(outlineToDraw({ outline: null, confidence: 0.9 }), null);
  assert.equal(outlineToDraw({ outline: 'M 1 2 C 3 4 5 6 7 8 Z', confidence: 0.9 }), null, 'a malformed path falls back');
});

test('what a region draws in the build (Addendum A): always its box, outline or not; weak ones too', () => {
  const d = WATER_OUTLINES.runoff;
  assert.deepEqual(regionDrawing({ region: box, outline: d, confidence: 0.93 }), { kind: 'box', box });
  assert.deepEqual(regionDrawing({ region: box, outline: null, confidence: 0.93 }), { kind: 'box', box });
  assert.deepEqual(regionDrawing({ region: box, outline: 'bad', confidence: 0.93 }), { kind: 'box', box });
  assert.deepEqual(regionDrawing({ region: box, outline: d, confidence: 0.28 }), { kind: 'box', box });
  assert.deepEqual(regionDrawing({ region: box, outline: null, confidence: 0.28 }), { kind: 'box', box });
  assert.equal(regionDrawing({ region: null, outline: null, confidence: null }), null);
});

test('part views carry the stored outline (stored lessons have none: null)', () => {
  const water = demo('water-demo');
  assert.ok(partViews(water).every((v) => v.outline === null), 'stored demo run: no outlines');
  const traced: LabelDiagramSpec = { ...water, regions: water.regions.map((r) => ({ ...r, outline: WATER_OUTLINES[r.partId] })) };
  const views = partViews(traced);
  assert.equal(views.find((v) => v.part.id === 'runoff')?.outline, WATER_OUTLINES.runoff);
  // every part glows as a box, evaporation's 0.28 region too (Calvin 2026-11-02); outlines stay stored only
  assert.deepEqual(views.map((v) => regionDrawing(v)?.kind ?? null), ['box', 'box', 'box', 'box', 'box']);
});

test('the fixture outlines are absolute image pixels inside their SAM boxes (probe paths were box-local)', () => {
  const water = demo('water-demo');
  for (const r of water.regions) {
    const d = WATER_OUTLINES[r.partId];
    assert.ok(d !== undefined && isOutlinePath(d), r.partId);
    const nums = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
    const xs = nums.filter((_, i) => i % 2 === 0);
    const ys = nums.filter((_, i) => i % 2 === 1);
    assert.ok(Math.min(...xs) >= r.x1 - 1 && Math.max(...xs) <= r.x2 + 1, `${r.partId} x within ${r.x1}..${r.x2}`);
    assert.ok(Math.min(...ys) >= r.y1 - 1 && Math.max(...ys) <= r.y2 + 1, `${r.partId} y within ${r.y1}..${r.y2}`);
  }
});

test('the outline overlay uses the figure’s own pixel grid; unknown size draws none', () => {
  assert.equal(outlineViewBox({ width: 572, height: 504 }), '0 0 572 504');
  assert.equal(outlineViewBox({ width: 0, height: 504 }), null);
});

// ---- unclaimed printed labels -----------------------------------------------------------------------------------------

// Calvin, 3 Nov: a printed label no part claims shows as printed, always ("this is the way it should always be"): it
// gives nothing away, and a blank patch leaves its arrow pointing at nothing.
test('water cycle (demo-set run): six printed labels, five parts; "Snowmelt Runoff" is no part’s and shows as printed', () => {
  const water = demo('water-demo');
  const slots = labelSlots(water);
  assert.equal(slots.length, 6);
  const unclaimed = slots.filter((s) => s.partIndex === null);
  assert.deepEqual(unclaimed.map((s) => s.text), ['Snowmelt Runoff']);
  const k = slots.indexOf(unclaimed[0] as (typeof slots)[number]);
  const none = water.parts.map(() => false);
  const rest = slotStates(slots, none, { labelsShown: false, openUnmatched: false });
  assert.equal(rest[k], 'open');
  assert.equal(rest.filter((s) => s === 'covered').length, 5, 'the five claimed labels are the blank slots');
  // it uncovers with the others: the lesson's Show the answers, the slide's labels step
  assert.equal(slotStates(slots, water.parts.map(() => true), { labelsShown: false, openUnmatched: true })[k], 'open');
  const last = stageView(water, water.parts.length, true);
  assert.ok(slotStates(slots, last.named, { labelsShown: last.labelsShown, openUnmatched: false }).every((s) => s === 'open'));
  // every step before that shows it too, named parts or not
  for (let step = 0; step < water.parts.length; step++) {
    for (const revealed of [false, true]) {
      const st = stageView(water, step, revealed);
      assert.equal(slotStates(slots, st.named, { labelsShown: st.labelsShown, openUnmatched: false })[k], 'open', `step ${step} ${revealed}`);
    }
  }
});

test('DNA (demo-set run): every printed label is claimed, so nothing is muted', () => {
  const dna = demo('dna-demo');
  const slots = labelSlots(dna);
  assert.ok(slots.length > 0);
  assert.ok(slots.every((s) => s.partIndex !== null));
  assert.ok(!slotStates(slots, dna.parts.map(() => false), { labelsShown: false, openUnmatched: false }).includes('muted'));
});

// ---- the patch's colour ----------------------------------------------------------------------------------------------

/** A w×h RGBA image filled with `bg`, with `ink` inside the box (the printed word). */
function image(w: number, h: number, bg: [number, number, number], ink: [number, number, number], b: { x1: number; y1: number; x2: number; y2: number }) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = x >= b.x1 && x < b.x2 && y >= b.y1 && y < b.y2 ? ink : bg;
      data.set([c[0], c[1], c[2], 255], (y * w + x) * 4);
    }
  }
  return { data, width: w, height: h };
}

test('a patch over a label that straddles two backgrounds runs from one to the other (a left-to-right gradient of band medians)', () => {
  const b = { x1: 10, y1: 10, x2: 30, y2: 16 };
  const img = image(40, 30, [120, 180, 230], [0, 0, 0], b);
  // the right half of the picture is a lighter arrow
  for (let y = 0; y < 30; y++) for (let x = 20; x < 40; x++) if (!(x < 30 && y >= 10 && y < 16)) img.data.set([200, 220, 240, 255], (y * 40 + x) * 4);
  const g = patchFill(img, b, 4) ?? '';
  assert.match(g, /^linear-gradient\(to right, /);
  assert.ok(g.startsWith('linear-gradient(to right, rgb(120, 180, 230) 0%'), g);
  assert.ok(g.endsWith('rgb(200, 220, 240) 100%)'), g);
  // a plain background gives a plain colour
  assert.equal(patchFill(image(40, 30, [250, 250, 250], [0, 0, 0], b), b, 4), 'rgb(250, 250, 250)');
  const all = { x1: 0, y1: 0, x2: 40, y2: 30 };
  assert.equal(patchFill(image(40, 30, [250, 250, 250], [0, 0, 0], all), all, 4), null);
});

test('a patch on a sky that darkens upwards has an upper and a lower fill (the view fades one into the other)', () => {
  const b = { x1: 10, y1: 10, x2: 30, y2: 16 };
  const img = image(40, 30, [60, 140, 210], [0, 0, 0], b);
  for (let y = 13; y < 30; y++) for (let x = 0; x < 40; x++) if (!(x >= 10 && x < 30 && y < 16)) img.data.set([150, 205, 215, 255], (y * 40 + x) * 4);
  assert.deepEqual(patchFills(img, b, 4), { top: 'rgb(60, 140, 210)', bottom: 'rgb(150, 205, 215)' });
  const plain = image(40, 30, [250, 250, 250], [0, 0, 0], b);
  assert.deepEqual(patchFills(plain, b, 4), { top: 'rgb(250, 250, 250)', bottom: 'rgb(250, 250, 250)' });
  const all = { x1: 0, y1: 0, x2: 40, y2: 30 };
  assert.equal(patchFills(plain, all, 4), null);
});

test('a muted patch takes the colour around the printed label (the median of a thin ring outside it), not the ink', () => {
  const b = { x1: 10, y1: 10, x2: 30, y2: 16 };
  assert.equal(patchColour(image(40, 30, [120, 180, 230], [0, 0, 0], b), b), 'rgb(120, 180, 230)');
  // a few dark leader-line pixels in the ring do not move the median
  const img = image(40, 30, [120, 180, 230], [0, 0, 0], b);
  for (let x = 8; x < 12; x++) img.data.set([0, 0, 0, 255], (8 * 40 + x) * 4);
  assert.equal(patchColour(img, b), 'rgb(120, 180, 230)');
  // a box at the image edge still finds its ring inside the image; a box covering the whole image has none
  const edge = { x1: 0, y1: 0, x2: 12, y2: 6 };
  assert.equal(patchColour(image(40, 30, [250, 250, 250], [0, 0, 0], edge), edge), 'rgb(250, 250, 250)');
  const all = { x1: 0, y1: 0, x2: 40, y2: 30 };
  assert.equal(patchColour(image(40, 30, [250, 250, 250], [0, 0, 0], all), all), null);
});
