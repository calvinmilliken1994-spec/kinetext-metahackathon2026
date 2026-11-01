/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { LabelDiagramGen, LabelDiagramSpec, LabelPartGen } from '../../../../packages/contracts/kit.ts';
import { KIT_LIMITS } from '../../../../packages/contracts/kit.ts';
import type { Provenance } from '../../../../packages/contracts/index.ts';
import {
  checkPlacements, coverMasks, coverSource, FIGURE_COVER_PAD, figureLabelMasks, fitSlotText, fitSlotTexts, groupLabelBoxes, hasLabelBox, labelDiagramPresentationSteps,
  labelDiagramRevealQuote, labelMasks, labelSlots, LESSON_MAX_UPSCALE, lessonFigureMaxWidth, MASK_PAD, MASK_PAD_X, normToPx, partViews, pixelBoxPct, place,
  changedBy, finishLine, keepResults, labelTextKey, markerSpots, slotGroups, slotText,
  placeTags, pointPct, pointPx, rectsOverlap, sameName, slotStates, stageFigureSize, stageOutline, stageQuestion, stageView, unplace, wordBank,
} from './labelDiagramView.ts';
import type { Rect } from './labelDiagramView.ts';
import { buildLabelDiagramDemos, figureRefOf, LIVE_DNA_GEN, LIVE_DNA_REGIONS } from './labelDiagramDemoSpecs.ts';
import type { FigureLabelsLike, FigureMetaLike } from './labelDiagramDemoSpecs.ts';

const root = new URL('../../../../', import.meta.url);
const json = <T>(p: string): T => JSON.parse(readFileSync(new URL(p, root), 'utf8')) as T;
const golden = json<LabelDiagramGen>('tests/fixtures/stage6/label-diagram.gen.json');
const provenance = json<Provenance>('tests/fixtures/provenance.fixture.json');
const figureMeta = json<FigureMetaLike>('data/figures/medlineplus-dna-structure-1.json');
const figureLabels = json<FigureLabelsLike>('data/figures/medlineplus-dna-structure-1.labels.json');
const waterMeta = json<FigureMetaLike>('data/figures/noaa-hydrologic-cycle-1.json');
const waterLabels = json<FigureLabelsLike>('data/figures/noaa-hydrologic-cycle-1.labels.json');
const demos = buildLabelDiagramDemos(golden, { meta: figureMeta, labels: figureLabels }, provenance, {}, { meta: waterMeta, labels: waterLabels });
const demo = (id: string): LabelDiagramSpec => {
  const d = demos.find((x) => x.id === id);
  assert.ok(d !== undefined, id);
  return d.spec;
};
const dna = demo('dna');

const part = (over: Partial<LabelPartGen>): LabelPartGen => ({
  id: 'p', name: 'part', sourceId: 's', quote: 'q', x: 500, y: 500, labelX1: 0, labelY1: 0, labelX2: 0, labelY2: 0, ...over,
});

// ---- geometry -------------------------------------------------------------------------------------------------------

test('normalised 0..1000 maps to rendered pixels, clamped to the image', () => {
  assert.equal(normToPx(0, 600), 0);
  assert.equal(normToPx(500, 600), 300);
  assert.equal(normToPx(1000, 437), 437);
  assert.equal(normToPx(1200, 600), 600);
  assert.equal(normToPx(-5, 600), 0);
  assert.deepEqual(pointPx(part({ x: 283, y: 475 }), { width: 600, height: 300 }), { x: 169.8, y: 142.5 });
});

test('a part point as a percentage of the figure', () => {
  assert.deepEqual(pointPct(part({ x: 283, y: 475 })), { left: 28.3, top: 47.5 });
  assert.deepEqual(pointPct(part({ x: 1001, y: -3 })), { left: 100, top: 0 });
});

test('a SAM pixel box becomes a percentage box of the figure (clamped; empty boxes are null)', () => {
  assert.deepEqual(pixelBoxPct({ x1: 60, y1: 150, x2: 180, y2: 300 }, { width: 600, height: 600 }), { left: 10, top: 25, width: 20, height: 25 });
  assert.deepEqual(pixelBoxPct({ x1: -20, y1: 0, x2: 300, y2: 700 }, { width: 600, height: 600 }), { left: 0, top: 0, width: 50, height: 100 });
  assert.equal(pixelBoxPct({ x1: 50, y1: 50, x2: 50, y2: 80 }, { width: 600, height: 600 }), null);
  assert.equal(pixelBoxPct({ x1: 10, y1: 10, x2: 20, y2: 20 }, { width: 0, height: 600 }), null);
});

test('a part has a printed-label box only when it is well formed (all 0 = none)', () => {
  assert.equal(hasLabelBox(part({})), false);
  assert.equal(hasLabelBox(part({ labelX1: 10, labelY1: 10, labelX2: 50, labelY2: 30 })), true);
  assert.equal(hasLabelBox(part({ labelX1: 50, labelY1: 10, labelX2: 10, labelY2: 30 })), false, 'x1 > x2');
  assert.equal(hasLabelBox(part({ labelX1: 10, labelY1: 10, labelX2: 50, labelY2: 10 })), false, 'no height');
});

test('label masks: one padded cover per printed label, never over a part point, duplicates merged', () => {
  const masks = labelMasks(dna.parts);
  assert.equal(masks.length, 6, 'the golden has six printed labels');
  const bp = masks.find((m) => m.partIds.includes('part-base-pairs'));
  assert.ok(bp !== undefined);
  // base pairs label 397..542 × 303..330 padded by MASK_PAD_X left/right and MASK_PAD above/below
  assert.deepEqual(bp.box, { left: (397 - MASK_PAD_X) / 10, top: (303 - MASK_PAD) / 10, width: (542 - 397 + 2 * MASK_PAD_X) / 10, height: (330 - 303 + 2 * MASK_PAD) / 10 });
  // No mask covers any part's point.
  for (const m of masks) {
    for (const p of dna.parts) {
      const inside = p.x / 10 > m.box.left && p.x / 10 < m.box.left + m.box.width && p.y / 10 > m.box.top && p.y / 10 < m.box.top + m.box.height;
      assert.equal(inside, false, `${m.partIds.join(',')} covers ${p.id}`);
    }
  }
  // Padding that would cover a point is dropped (the plain box is used).
  const near = labelMasks([part({ id: 'a', x: 105, y: 100, labelX1: 110, labelY1: 90, labelX2: 200, labelY2: 110 })]);
  assert.deepEqual(near[0]?.box, { left: 11, top: 9, width: 9, height: 2 });
  // Two parts naming one printed label (same box) get one mask.
  const twin = labelMasks([part({ id: 'a', labelX1: 10, labelY1: 10, labelX2: 40, labelY2: 20 }), part({ id: 'b', x: 900, labelX1: 10, labelY1: 10, labelX2: 40, labelY2: 20 })]);
  assert.equal(twin.length, 1);
  assert.deepEqual(twin[0]?.partIds, ['a', 'b']);
  // Padding is clamped to the figure.
  const edge = labelMasks([part({ labelX1: 0, labelY1: 2, labelX2: 40, labelY2: 20 })]);
  assert.equal(edge[0]?.box.left, 0);
  assert.equal(edge[0]?.box.top, 0);
  assert.deepEqual(labelMasks([part({})]), []);
});

test('part views number the markers in spec order and attach each part’s region', () => {
  const views = partViews(dna);
  assert.deepEqual(views.map((v) => v.number), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(views[0]?.point, { left: 28.3, top: 47.5 });
  for (const v of views) assert.ok(v.region !== null, v.part.id);
  // adenine region 346..435 × 181..199 px on the 600 px figure
  assert.deepEqual(views.find((v) => v.part.id === 'part-adenine')?.region, pixelBoxPct({ x1: 346, y1: 181, x2: 435, y2: 199 }, { width: 600, height: 600 }));
  const noRegions = partViews({ ...dna, regions: [] });
  assert.ok(noRegions.every((v) => v.region === null));
});

test('the stage figure keeps the image aspect inside its box', () => {
  assert.deepEqual(stageFigureSize({ width: 600, height: 600 }, 620, 430), { width: 430, height: 430 });
  assert.deepEqual(stageFigureSize({ width: 1200, height: 600 }, 620, 430), { width: 620, height: 310 });
  assert.deepEqual(stageFigureSize({ width: 300, height: 600 }, 620, 430), { width: 215, height: 430 });
  assert.deepEqual(stageFigureSize({ width: 0, height: 0 }, 620, 430), { width: 430, height: 430 }, 'unknown size: square');
});

test('a lesson never draws a figure wider than 1.6× its natural width', () => {
  assert.equal(LESSON_MAX_UPSCALE, 1.6);
  assert.equal(lessonFigureMaxWidth({ width: 600, height: 600 }), 960);
  assert.equal(lessonFigureMaxWidth({ width: 572, height: 504 }), 915);
  assert.equal(lessonFigureMaxWidth({ width: 0, height: 0 }), null);
});

// ---- word bank and answers -----------------------------------------------------------------------------------------

test('the word bank holds every name once per part, in a seeded order that is never the marker order', () => {
  const bank = wordBank(dna);
  assert.equal(bank.length, dna.parts.length);
  assert.deepEqual([...bank.map((b) => b.token)].sort(), dna.parts.map((p) => p.id).sort());
  assert.notDeepEqual(bank.map((b) => b.token), dna.parts.map((p) => p.id));
  assert.deepEqual(wordBank(dna), bank, 'same spec, same order');
  assert.equal(bank.find((b) => b.token === 'part-base-pairs')?.name, 'Base pairs', 'shown in sentence case');
});

test('placing a name: one name per marker, a name sits on one marker only, a displaced name returns to the bank', () => {
  let p = place({}, 'part-adenine', 'part-base-pairs');
  assert.deepEqual(p, { 'part-base-pairs': 'part-adenine' });
  p = place(p, 'part-adenine', 'part-thymine');
  assert.deepEqual(p, { 'part-thymine': 'part-adenine' }, 'moved, not copied');
  p = place(p, 'part-guanine', 'part-thymine');
  assert.deepEqual(p, { 'part-thymine': 'part-guanine' }, 'adenine went back to the bank');
  assert.deepEqual(unplace(p, 'part-thymine'), {});
});

test('D3: dropping a placed name onto a filled number swaps the two names', () => {
  const p = { 'part-adenine': 'part-thymine', 'part-thymine': 'part-adenine', 'part-guanine': 'part-cytosine' };
  assert.deepEqual(place(p, 'part-thymine', 'part-thymine'), { 'part-thymine': 'part-thymine', 'part-adenine': 'part-adenine', 'part-guanine': 'part-cytosine' });
  assert.deepEqual(changedBy(p, 'part-thymine', 'part-thymine'), ['part-thymine', 'part-adenine']);
  assert.deepEqual(changedBy(p, 'part-base-pairs', 'part-guanine'), ['part-guanine'], 'from the bank: one number changes');
  assert.deepEqual(place(p, 'part-base-pairs', 'part-guanine'), { 'part-adenine': 'part-thymine', 'part-thymine': 'part-adenine', 'part-guanine': 'part-base-pairs' }, 'the bank name sends cytosine back');
});

test('D1: after a Check, a move clears only the marks of the numbers it changed', () => {
  const spec = { parts: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }] } as unknown as LabelDiagramSpec;
  const r = checkPlacements(spec, { a: 'a', b: 'c', c: 'b' });
  assert.equal(r.right, 1);
  const kept = keepResults(r, ['b', 'c']);
  assert.ok(kept !== null);
  assert.equal(kept.results.a, 'right', 'the untouched ✓ stays');
  assert.equal(kept.results.b, 'empty');
  assert.equal(kept.right, 1);
  assert.equal(kept.stale, true);
  assert.equal(keepResults(null, ['a']), null);
  assert.equal(keepResults(kept, ['b']), kept, 'nothing marked changes: same result');
});

test('D4: a calm finish line, the count in words', () => {
  assert.equal(finishLine(6, true), 'All six parts named. Every name sits on the figure’s own label.');
  assert.equal(finishLine(5, false), 'All five parts named.');
  assert.equal(finishLine(1, false), 'The part is named.');
});

test('D2: a marker on a printed label moves just clear of it; markers never stack; a clear one stays on its point', () => {
  const avoid = [{ x: 354, y: 304, w: 73, h: 20 }];
  const [on, clear] = markerSpots({ width: 600, height: 600, marker: 26, points: [{ x: 384, y: 301 }, { x: 100, y: 100 }], avoid });
  assert.ok(on !== undefined && clear !== undefined);
  const r = { x: on.x - 13, y: on.y - 13, w: 26, h: 26 };
  assert.ok(r.y + r.h <= 304 - 2 || r.y >= 324 + 2 || r.x + r.w <= 354 - 2 || r.x >= 427 + 2, 'clear of the label');
  assert.ok(Math.hypot(on.x - 384, on.y - 301) <= 26, 'stays beside its part');
  assert.deepEqual(clear, { x: 100, y: 100 });
  const [a, b] = markerSpots({ width: 600, height: 600, marker: 26, points: [{ x: 300, y: 300 }, { x: 305, y: 300 }], avoid: [] });
  assert.ok(a !== undefined && b !== undefined && Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) >= 26, 'two markers do not overlap');
});

test('names match ignoring case, spacing and hyphen spacing', () => {
  assert.equal(sameName('Sugar-phosphate  backbone', 'sugar-phosphate backbone'), true);
  assert.equal(sameName('adenine', 'Adenine '), true);
  assert.equal(sameName('adenine', 'guanine'), false);
});

test('checking marks each marker right, wrong or empty; a repeated name counts on either of its markers', () => {
  const ids = dna.parts.map((p) => p.id);
  const all = Object.fromEntries(ids.map((id) => [id, id]));
  const r = checkPlacements(dna, all);
  assert.equal(r.right, 6);
  assert.equal(r.total, 6);
  assert.equal(r.complete, true);
  const swapped = { ...all, 'part-adenine': 'part-thymine', 'part-thymine': 'part-adenine' };
  delete (swapped as Record<string, string>)['part-backbone'];
  const s = checkPlacements(dna, swapped);
  assert.equal(s.results['part-adenine'], 'wrong');
  assert.equal(s.results['part-thymine'], 'wrong');
  assert.equal(s.results['part-backbone'], 'empty');
  assert.equal(s.right, 3);
  assert.equal(s.complete, false);
  const twins: LabelDiagramSpec = { ...dna, parts: [part({ id: 'a', name: 'Rung' }), part({ id: 'b', name: 'rung' }), part({ id: 'c', name: 'Helix' })] };
  assert.equal(checkPlacements(twins, { a: 'b', b: 'a', c: 'c' }).right, 3);
});

// ---- presentation --------------------------------------------------------------------------------------------------

test('presentation steps: one per part, plus one to uncover the printed labels when there are any', () => {
  assert.equal(labelDiagramPresentationSteps(dna), 7);
  const unlabelled = { ...dna, figure: { ...dna.figure, labelBoxes: undefined }, parts: dna.parts.map((p) => ({ ...p, labelX1: 0, labelY1: 0, labelX2: 0, labelY2: 0 })) };
  assert.equal(labelDiagramPresentationSteps(unlabelled), 6);
  // Stored label boxes alone (Muse wrote none) still give the uncover step.
  assert.equal(labelDiagramPresentationSteps({ ...unlabelled, figure: dna.figure }), 7);
  assert.equal(labelDiagramPresentationSteps({ ...dna, parts: [] }), 1, 'never zero steps');
});

test('step k shows the names of the parts before it; R names part k; the last step uncovers the printed labels', () => {
  const s0 = stageView(dna, 0, false);
  assert.deepEqual(s0.named, [false, false, false, false, false, false]);
  assert.equal(s0.current, 0);
  assert.equal(s0.labelsShown, false);
  assert.deepEqual(stageView(dna, 0, true).named, [true, false, false, false, false, false]);
  const s3 = stageView(dna, 3, false);
  assert.deepEqual(s3.named, [true, true, true, false, false, false]);
  assert.equal(s3.current, 3);
  assert.deepEqual(stageView(dna, 3, true).named, [true, true, true, true, false, false]);
  const last = stageView(dna, 6, false);
  assert.ok(last.named.every(Boolean));
  assert.equal(last.current, null);
  assert.equal(last.final, true);
  assert.equal(last.labelsShown, false);
  assert.equal(stageView(dna, 6, true).labelsShown, true);
  assert.equal(stageView(dna, 99, true).labelsShown, true, 'clamped to the last step');
  // Without printed labels the last part's step is the last step; nothing to uncover.
  const unlabelled = { ...dna, figure: { ...dna.figure, labelBoxes: undefined }, parts: dna.parts.map((p) => ({ ...p, labelX1: 0, labelY1: 0, labelX2: 0, labelY2: 0 })) };
  const u = stageView(unlabelled, 5, true);
  assert.ok(u.named.every(Boolean));
  assert.equal(u.final, false);
});

test('the slide question names the marker number only, never the answer', () => {
  for (let s = 0; s < 6; s++) {
    const q = stageQuestion(dna, s);
    assert.match(q.question, new RegExp(`number ${s + 1}\\b`));
    for (const p of dna.parts) assert.ok(!q.question.toLowerCase().includes(p.name.toLowerCase()), `${q.question} leaks ${p.name}`);
    assert.equal(q.eyebrow, `Part ${s + 1} of 6`);
  }
  assert.deepEqual(stageQuestion(dna, 6), { eyebrow: 'Last step', question: 'Now the figure’s own labels.' });
});

test('a revealed step puts that part’s page sentence in the quote zone (the labels step has none)', () => {
  assert.deepEqual(labelDiagramRevealQuote(dna, 0), { sourceId: 'medlineplus-what-is-dna', quote: 'to form units called base pairs' });
  assert.equal(labelDiagramRevealQuote(dna, 5)?.quote, 'DNA is a double helix formed by base pairs attached to a sugar-phosphate backbone');
  assert.equal(labelDiagramRevealQuote(dna, 6), null);
});

// ---- the harness fixtures are plausible SAM output -----------------------------------------------------------------

test('demo fixtures quote the page exactly and carry the figure’s own credit and size', () => {
  assert.deepEqual(demos.map((d) => d.id), ['dna', 'dna-live', 'water-live', 'dna-demo', 'water-demo', 'bare']);
  for (const d of demos) {
    const text = readFileSync(new URL(`data/sources/${d.sourceId}.txt`, root), 'utf8');
    for (const p of d.spec.parts) assert.ok(text.includes(p.quote), `${d.id}: ${p.quote}`);
    const meta = d.spec.figureId === waterMeta.id ? waterMeta : figureMeta;
    assert.equal(d.spec.figure.credit, meta.credit);
    assert.equal(d.spec.figure.width, meta.width);
    assert.equal(d.spec.figure.id, d.spec.figureId);
  }
  assert.deepEqual(figureRefOf(figureMeta), {
    id: figureMeta.id, width: 600, height: 600, caption: figureMeta.caption, credit: figureMeta.credit, license: figureMeta.license, labelsInImage: true,
  });
  // The stored label boxes ride along for every demo but the bare layout check.
  assert.deepEqual(demo('dna').figure.labelBoxes, figureLabels.boxes);
  assert.deepEqual(demo('dna-live').figure.labelBoxes, figureLabels.boxes);
  assert.deepEqual(demo('water-live').figure.labelBoxes, waterLabels.boxes);
  assert.equal(demo('bare').figure.labelBoxes, undefined);
  assert.equal(figureRefOf(figureMeta, waterLabels).labelBoxes, undefined, 'another figure’s boxes are never attached');
});

test('hand-made demo regions satisfy the LD-06 / LD-07 rules (contain the point, sane area, distinct)', () => {
  const lim = KIT_LIMITS.labelDiagram;
  const { width: W, height: H } = dna.figure;
  for (const p of dna.parts) {
    const r = dna.regions.find((x) => x.partId === p.id);
    assert.ok(r !== undefined, p.id);
    const px = (p.x / 1000) * W;
    const py = (p.y / 1000) * H;
    assert.ok(px >= r.x1 && px <= r.x2 && py >= r.y1 && py <= r.y2, `${p.id} point outside its region`);
    const frac = ((r.x2 - r.x1) * (r.y2 - r.y1)) / (W * H);
    assert.ok(frac >= lim.minRegionAreaFraction && frac <= lim.maxRegionAreaFraction, `${p.id} area ${frac}`);
  }
  const iou = (a: { x1: number; y1: number; x2: number; y2: number }, b: typeof a): number => {
    const ix = Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1));
    const iy = Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
    const inter = ix * iy;
    const area = (r: typeof a): number => (r.x2 - r.x1) * (r.y2 - r.y1);
    return inter / (area(a) + area(b) - inter);
  };
  for (let i = 0; i < dna.regions.length; i++) {
    for (let j = i + 1; j < dna.regions.length; j++) {
      const a = dna.regions[i];
      const b = dna.regions[j];
      assert.ok(a !== undefined && b !== undefined);
      assert.ok(iou(a, b) <= lim.maxRegionOverlapIoU, `${a.partId} × ${b.partId}`);
    }
  }
});


// ---- covers from the figure's stored label boxes (Stage 8b live run 3 fix) ------------------------------------------

const liveDna = demo('dna-live');

test('stored label boxes become covers: pixels → % of the figure, padded by FIGURE_COVER_PAD, clamped to the image', () => {
  assert.equal(FIGURE_COVER_PAD, 2);
  const masks = figureLabelMasks({ width: 600, height: 600, labelBoxes: [{ x1: 235, y1: 180, x2: 327, y2: 203 }] }, []);
  assert.equal(masks.length, 1);
  assert.deepEqual(masks[0]?.partIds, []);
  const b = masks[0]?.box;
  assert.ok(b !== undefined);
  const near = (a: number, e: number): void => assert.ok(Math.abs(a - e) < 1e-9, `${a} vs ${e}`);
  near(b.left, (233 * 100) / 600); near(b.top, (178 * 100) / 600); near(b.width, (96 * 100) / 600); near(b.height, (27 * 100) / 600);
  // a non-square figure maps x and y on their own axes (water cycle 572 × 504)
  const w = figureLabelMasks({ width: 572, height: 504, labelBoxes: [{ x1: 194, y1: 54, x2: 327, y2: 73 }] }, [])[0]?.box;
  assert.ok(w !== undefined);
  near(w.left, (192 * 100) / 572); near(w.top, (52 * 100) / 504); near(w.width, (137 * 100) / 572); near(w.height, (23 * 100) / 504);
  // clamped at the image edge; empty boxes skipped
  const edge = figureLabelMasks({ width: 600, height: 600, labelBoxes: [{ x1: 0, y1: 1, x2: 40, y2: 20 }, { x1: 50, y1: 50, x2: 50, y2: 80 }] }, []);
  assert.equal(edge.length, 1);
  assert.equal(edge[0]?.box.left, 0);
  assert.equal(edge[0]?.box.top, 0);
  // padding that would hide a part's point is dropped (the box itself is used)
  const tight = figureLabelMasks({ width: 1000, height: 1000, labelBoxes: [{ x1: 100, y1: 100, x2: 200, y2: 120 }] }, [{ x: 99, y: 110 }]);
  assert.deepEqual(tight[0]?.box, { left: 10, top: 10, width: 10, height: 2 });
  assert.deepEqual(figureLabelMasks({ width: 0, height: 600, labelBoxes: [{ x1: 1, y1: 1, x2: 9, y2: 9 }] }, []), [], 'unknown size: no covers');
});

test('with stored label boxes the lesson covers exactly those boxes and never Muse’s part boxes', () => {
  assert.equal(coverSource(liveDna), 'figure');
  const masks = coverMasks(liveDna);
  assert.equal(masks.length, figureLabels.boxes.length, 'one cover per stored box (7 on the DNA figure)');
  assert.ok(masks.every((m) => m.key.startsWith('figure-') && m.partIds.length === 0));
  // every stored box sits wholly under its cover (no part of a printed word left beside it)
  const W = liveDna.figure.width;
  const H = liveDna.figure.height;
  figureLabels.boxes.forEach((b, i) => {
    const m = masks[i]?.box;
    assert.ok(m !== undefined);
    assert.ok((m.left * W) / 100 <= b.x1 + 1e-9 && ((m.left + m.width) * W) / 100 >= b.x2 - 1e-9, `box ${i} x`);
    assert.ok((m.top * H) / 100 <= b.y1 + 1e-9 && ((m.top + m.height) * H) / 100 >= b.y2 - 1e-9, `box ${i} y`);
  });
  // Muse's own (offset) box for the backbone (465..730 × 704..767 grid) is not a cover.
  const museBackbone = labelMasks(liveDna.parts).find((m) => m.partIds.includes('sugar-phosphate-backbone'));
  assert.ok(museBackbone !== undefined);
  assert.ok(!masks.some((m) => Math.abs(m.box.left - museBackbone.box.left) < 1e-9 && Math.abs(m.box.top - museBackbone.box.top) < 1e-9));
});

test('without stored label boxes (older lessons, empty or unusable list) the covers fall back to Muse’s part boxes', () => {
  const older = { ...liveDna, figure: { ...liveDna.figure, labelBoxes: undefined } };
  assert.equal(coverSource(older), 'model');
  assert.deepEqual(coverMasks(older), labelMasks(liveDna.parts));
  const empty = { ...liveDna, figure: { ...liveDna.figure, labelBoxes: [] } };
  assert.equal(coverSource(empty), 'model');
  assert.deepEqual(coverMasks(empty), labelMasks(liveDna.parts));
  const degenerate = { ...liveDna, figure: { ...liveDna.figure, labelBoxes: [{ x1: 10, y1: 10, x2: 10, y2: 30 }] } };
  assert.equal(coverSource(degenerate), 'model', 'a list with no usable box does not leave the labels uncovered');
  assert.equal(coverMasks(demo('bare')).length, 0, 'the bare layout check has nothing to cover');
});

// ---- name tags on the revealed figure --------------------------------------------------------------------------------

/** A name tag's size at a font size: padding 6 px each side plus ~0.56 em per character, 1.4 line height + 2 px. */
const tagSize = (name: string, font: number): { w: number; h: number } => ({ w: 12 + name.length * font * 0.56, h: font * 1.4 + 2 });

function tagLayout(spec: LabelDiagramSpec, width: number, marker: number, font: number) {
  const height = (width * spec.figure.height) / spec.figure.width;
  const views = partViews(spec);
  const covers: Rect[] = coverMasks(spec).map((m) => ({ x: (m.box.left * width) / 100, y: (m.box.top * height) / 100, w: (m.box.width * width) / 100, h: (m.box.height * height) / 100 }));
  const tags = views.map((v) => ({ x: (v.point.left * width) / 100, y: (v.point.top * height) / 100, ...tagSize(v.name, font) }));
  const input = { width, height, marker, tags, covers };
  return { input, places: placeTags(input), views };
}

function assertClear(label: string, l: ReturnType<typeof tagLayout>): void {
  const { input, places } = l;
  const rects = places.map((p, i) => ({ x: p.x, y: p.y, w: input.tags[i]?.w ?? 0, h: input.tags[i]?.h ?? 0 }));
  const markers = input.tags.map((t) => ({ x: t.x - input.marker / 2, y: t.y - input.marker / 2, w: input.marker, h: input.marker }));
  rects.forEach((r, i) => {
    const name = l.views[i]?.name ?? String(i);
    assert.ok(places[i]?.clear, `${label}: ${name} found no clear position`);
    assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= input.width + 1e-9 && r.y + r.h <= input.height + 1e-9, `${label}: ${name} leaves the figure`);
    rects.forEach((o, j) => { if (j > i) assert.ok(!rectsOverlap(r, o), `${label}: ${name} overlaps ${l.views[j]?.name}`); });
    input.covers.forEach((c, j) => assert.ok(!rectsOverlap(r, c), `${label}: ${name} sits on cover ${j}`));
    markers.forEach((m, j) => assert.ok(!rectsOverlap(r, m), `${label}: ${name} sits on marker ${j + 1}`));
  });
}

test('live DNA geometry: two base pairs 150 grid units apart at one height, six tags, no collisions at slide and lesson sizes', () => {
  assert.equal(liveDna.parts.length, 6);
  const [, , a, t, g, c] = liveDna.parts;
  assert.ok(a !== undefined && t !== undefined && g !== undefined && c !== undefined);
  assert.equal(t.x - a.x, 150);
  assert.equal(a.y, t.y);
  assert.equal(g.y, c.y);
  assertClear('slide 436 px, 14 px tags', tagLayout(liveDna, 436, 28, 14));
  assertClear('lesson 560 px, 12 px tags', tagLayout(liveDna, 560, 26, 12));
  assertClear('lesson 520 px, 12 px tags', tagLayout(liveDna, 520, 26, 12));
  // The hand-made golden and the water cycle (live parts, stored boxes) clear too.
  assertClear('golden slide', tagLayout(dna, 436, 28, 14));
  assertClear('water slide', tagLayout(demo('water-live'), 495, 28, 14));
  assertClear('water lesson', tagLayout(demo('water-live'), 560, 26, 12));
});

test('tags that would collide above their markers are moved, in the fixed order, and the result is deterministic', () => {
  // A small figure: Adenine and Thymine are 45 px apart, narrower than their tags, so both cannot sit above.
  const l = tagLayout(liveDna, 300, 20, 14);
  const ia = liveDna.parts.findIndex((p) => p.id === 'adenine');
  const it = liveDna.parts.findIndex((p) => p.id === 'thymine');
  const ta = l.input.tags[ia];
  const tt = l.input.tags[it];
  assert.ok(ta !== undefined && tt !== undefined && ta.w > tt.x - ta.x, 'naive above-tags would overlap');
  assert.equal(l.places[ia]?.side, 'above', 'the first tag keeps the first choice');
  const pa = l.places[ia];
  const pt = l.places[it];
  assert.ok(pa !== undefined && pt !== undefined);
  assert.ok(!rectsOverlap({ x: pa.x, y: pa.y, w: ta.w, h: ta.h }, { x: pt.x, y: pt.y, w: tt.w, h: tt.h }), 'Adenine and Thymine tags do not collide');
  assert.deepEqual(placeTags(l.input), l.places, 'same input, same layout');
  // Order of sides when everything is free: above first.
  const free = placeTags({ width: 400, height: 400, marker: 20, tags: [{ x: 200, y: 200, w: 60, h: 20 }], covers: [] });
  assert.equal(free[0]?.side, 'above');
  assert.equal(free[0]?.clear, true);
  // Above blocked by a cover → below; above and below blocked → right; → left.
  const block = (r: Rect[]) => placeTags({ width: 400, height: 400, marker: 20, tags: [{ x: 200, y: 200, w: 60, h: 20 }], covers: r })[0]?.side;
  const coverAbove: Rect = { x: 100, y: 120, w: 200, h: 68 };
  const coverBelow: Rect = { x: 100, y: 212, w: 200, h: 68 };
  assert.equal(block([coverAbove]), 'below');
  assert.equal(block([coverAbove, coverBelow]), 'right');
  assert.equal(block([coverAbove, coverBelow, { x: 212, y: 150, w: 150, h: 100 }]), 'left');
});

test('a tag with no clear position takes the least-overlapping one inside the figure and says so', () => {
  const p = placeTags({ width: 100, height: 40, marker: 20, tags: [{ x: 50, y: 20, w: 90, h: 18 }], covers: [{ x: 0, y: 0, w: 100, h: 40 }] });
  assert.equal(p[0]?.clear, false);
  assert.ok(p[0] !== undefined && p[0].x >= 0 && p[0].x + 90 <= 100 && p[0].y >= 0 && p[0].y + 18 <= 40);
  const huge = placeTags({ width: 50, height: 50, marker: 20, tags: [{ x: 25, y: 25, w: 80, h: 18 }], covers: [] });
  assert.equal(huge[0]?.clear, false);
  assert.equal(huge[0]?.x, 0, 'a tag wider than the figure is pulled to its left edge');
  assert.deepEqual(placeTags({ width: 100, height: 100, marker: 20, tags: [], covers: [] }), []);
});

test('the live DNA run’s SAM regions are carried as recorded (the harness copy is the stored output)', () => {
  assert.deepEqual(liveDna.regions, LIVE_DNA_REGIONS);
  assert.deepEqual(liveDna.parts.map((p) => p.id), LIVE_DNA_GEN.parts.map((p) => p.id));
});


// ---- label slots: the printed labels as worksheet slots, each part's name revealed in its own slot ------------------

const dnaDemo = demo('dna-demo');
const waterDemo = demo('water-demo');
const slotNames = (spec: LabelDiagramSpec): (string | null)[] => labelSlots(spec).map((s) => (s.partIndex === null ? null : spec.parts[s.partIndex]?.name ?? '?'));
/** The same lesson with an older label store: boxes without printed text or groups (the proximity fallback). */
const noText = (spec: LabelDiagramSpec): LabelDiagramSpec => ({
  ...spec, figure: { ...spec.figure, labelBoxes: spec.figure.labelBoxes?.map((b) => ({ x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2 })) },
});

test('stored boxes that overlap or stack as one multi-line label are grouped; separate labels are not', () => {
  // DNA: box 5 is "Sugar phosphate backbone" (two lines), box 6 is "backbone" inside it.
  assert.deepEqual(groupLabelBoxes(figureLabels.boxes, []), [[0], [1], [2], [3], [4], [5, 6]]);
  // Water cycle: 3 sits inside 2 (Transpiration), 7 inside 6 (Surface Runoff).
  assert.deepEqual(groupLabelBoxes(waterLabels.boxes, []), [[0], [1], [2, 3], [4], [5], [6, 7]]);
  // Two lines of one label (small gap, overlapping columns) group; two labels a full line apart do not.
  const lines = [{ x1: 100, y1: 100, x2: 240, y2: 120 }, { x1: 100, y1: 124, x2: 180, y2: 144 }, { x1: 100, y1: 190, x2: 200, y2: 210 }];
  assert.deepEqual(groupLabelBoxes(lines, []), [[0, 1], [2]]);
  // Side by side on one baseline (Adenine, Thymine) never group.
  assert.deepEqual(groupLabelBoxes([{ x1: 354, y1: 210, x2: 426, y2: 230 }, { x1: 454, y1: 209, x2: 528, y2: 233 }], []), [[0], [1]]);
  // A group whose joined box would hide a part's point stays split.
  assert.deepEqual(groupLabelBoxes(lines, [{ x: 220, y: 135 }]), [[0], [1], [2]]);
});

test('each part is matched to the printed label that says its name (demo-set DNA run)', () => {
  assert.deepEqual(slotNames(dnaDemo), ['Base pairs', 'Thymine', 'Adenine', 'Guanine', 'Cytosine', 'Sugar-phosphate backbone']);
  assert.ok(labelSlots(dnaDemo).every((s) => s.partIndex === null || s.matchedBy === 'text'));
  // Live DNA run (Muse boxes offset differently) maps the same way.
  assert.deepEqual(slotNames(liveDna), ['Base pairs', 'Thymine', 'Adenine', 'Guanine', 'Cytosine', 'Sugar-phosphate backbone']);
});

test('without stored text (older stores) parts fall back to overlap, else nearest centre', () => {
  assert.deepEqual(slotNames(noText(dnaDemo)), ['Base pairs', 'Thymine', 'Adenine', 'Guanine', 'Cytosine', 'Sugar-phosphate backbone']);
  assert.ok(labelSlots(noText(dnaDemo)).every((s) => s.partIndex === null || s.matchedBy === 'proximity'));
});

test('W-01: exchanging two parts’ label boxes cannot move a name into the wrong printed label', () => {
  const ad = dnaDemo.parts.find((p) => p.id === 'adenine');
  const th = dnaDemo.parts.find((p) => p.id === 'thymine');
  assert.ok(ad !== undefined && th !== undefined);
  const box = (p: typeof ad) => ({ labelX1: p.labelX1, labelY1: p.labelY1, labelX2: p.labelX2, labelY2: p.labelY2 });
  const swapped = { ...dnaDemo, parts: dnaDemo.parts.map((p) => (p.id === 'adenine' ? { ...p, ...box(th) } : p.id === 'thymine' ? { ...p, ...box(ad) } : p)) };
  const slots = labelSlots(swapped);
  for (const s of slots) {
    if (s.partIndex === null) continue;
    assert.equal(labelTextKey(s.text ?? ''), labelTextKey(swapped.parts[s.partIndex]?.name ?? ''), `${s.text}`);
  }
  assert.deepEqual(slotNames(swapped), slotNames(dnaDemo));
});

test('label text keys ignore case, spacing, hyphens and a plural s; whole label first, then a line', () => {
  assert.equal(labelTextKey('Sugar-phosphate  backbone'), labelTextKey('Sugar phosphate backbone'));
  assert.equal(labelTextKey('Base pairs'), labelTextKey('base pair'));
  assert.equal(labelTextKey('gas'), 'gas');
  assert.equal(labelTextKey('Glass'), 'glass');
  assert.notEqual(labelTextKey('Runoff'), labelTextKey('Surface Runoff'));
  // a word box inside its line box is not read twice; lines read top to bottom
  const boxes = [{ x1: 0, y1: 0, x2: 100, y2: 40, text: 'Sugar phosphate backbone', group: 1 }, { x1: 0, y1: 20, x2: 60, y2: 40, text: 'backbone', group: 1 }];
  assert.equal(slotText(boxes, [0, 1]), 'Sugar phosphate backbone');
  const lines = [{ x1: 0, y1: 22, x2: 60, y2: 40, text: 'backbone' }, { x1: 0, y1: 0, x2: 100, y2: 20, text: 'Sugar phosphate' }];
  assert.equal(slotText(lines, [0, 1]), 'Sugar phosphate backbone');
  assert.equal(slotText([{ x1: 0, y1: 0, x2: 1, y2: 1 }], [0]), null);
  // stored groups decide which boxes are one label
  assert.deepEqual(slotGroups([{ x1: 0, y1: 0, x2: 10, y2: 10, group: 2 }, { x1: 500, y1: 500, x2: 510, y2: 510, group: 2 }, { x1: 20, y1: 0, x2: 30, y2: 10, group: 1 }], []), [[0, 1], [2]]);
});

test('water cycle: a process gets the label that prints its name; "Runoff" goes into the "… Runoff" label its own box points at (same rule as LD-02)', () => {
  assert.deepEqual(slotNames(waterDemo), ['Condensation', 'Precipitation', 'Transpiration', null, 'Evaporation', 'Runoff']);
  const live = demo('water-live');
  const slots = labelSlots(live);
  assert.deepEqual(slotNames(live), ['Condensation', 'Precipitation', 'Transpiration', null, 'Evaporation', 'Runoff']);
  const runoff = slots.find((s) => s.text === 'Surface Runoff');
  assert.equal(runoff?.matchedBy, 'text');
  // the older store (no text) put it in the nearest label by distance
  assert.deepEqual(slotNames(noText(waterDemo)), ['Condensation', 'Precipitation', 'Transpiration', null, 'Evaporation', 'Runoff']);
  const clouds = live.parts.findIndex((p) => p.id === 'clouds');
  assert.ok(!slots.some((s) => s.partIndex === clouds), 'clouds has no printed label: floating tag');
});

test('without text, a part whose label box is far from every stored box is left unmatched (no wrong name in a slot)', () => {
  const far = { ...noText(dnaDemo), parts: dnaDemo.parts.map((p) => (p.id === 'adenine' ? { ...p, labelX1: 20, labelY1: 900, labelX2: 90, labelY2: 930 } : p)) };
  const names = slotNames(far);
  assert.ok(!names.includes('Adenine'));
  assert.equal(names[2], null, 'the Adenine slot stays a plain cover');
  // Two parts cannot take one slot: the closer one wins, the other falls back to a tag.
  const twin = { ...noText(dnaDemo), parts: dnaDemo.parts.map((p) => (p.id === 'thymine' ? { ...p, labelX1: 548, labelY1: 392, labelX2: 662, labelY2: 421 } : p)) };
  const t = labelSlots(twin);
  assert.equal(t.find((s) => s.boxes.includes(2))?.partIndex, 2, 'Adenine (first in spec order on a tie) keeps its slot');
  assert.ok(!t.some((s) => s.partIndex === 3), 'Thymine, pointing at the same printed word, gets no slot');
  assert.equal(new Set(t.map((s) => s.partIndex).filter((i) => i !== null)).size, t.filter((s) => s.partIndex !== null).length);
});

test('slots cover every stored box (padded, never over a part point); older lessons have no slots', () => {
  for (const spec of [dnaDemo, waterDemo, liveDna]) {
    const slots = labelSlots(spec);
    const W = spec.figure.width;
    const H = spec.figure.height;
    (spec.figure.labelBoxes ?? []).forEach((b, i) => {
      const s = slots.find((x) => x.boxes.includes(i));
      assert.ok(s !== undefined, `box ${i} has a slot`);
      assert.ok((s.box.left * W) / 100 <= b.x1 + 1e-9 && ((s.box.left + s.box.width) * W) / 100 >= b.x2 - 1e-9, `box ${i} x`);
      assert.ok((s.box.top * H) / 100 <= b.y1 + 1e-9 && ((s.box.top + s.box.height) * H) / 100 >= b.y2 - 1e-9, `box ${i} y`);
    });
    for (const s of slots) {
      for (const p of spec.parts) {
        const x = p.x / 10;
        const y = p.y / 10;
        // (the older live DNA run put Guanine's point on its printed word, which LD-04 now rejects: the bare box is used)
        const onPrinted = s.boxes.some((i) => { const b = spec.figure.labelBoxes?.[i]; return b !== undefined && (x * W) / 100 > b.x1 && (x * W) / 100 < b.x2 && (y * H) / 100 > b.y1 && (y * H) / 100 < b.y2; });
        if (onPrinted) continue;
        assert.ok(!(x > s.box.left && x < s.box.left + s.box.width && y > s.box.top && y < s.box.top + s.box.height), `${s.key} hides ${p.id}`);
      }
    }
  }
  assert.deepEqual(labelSlots({ ...dnaDemo, figure: { ...dnaDemo.figure, labelBoxes: undefined } }), []);
  assert.deepEqual(labelSlots(demo('bare')), []);
});

// a fake text measure: 0.56 em per character
const measure = (text: string, px: number): number => text.length * px * 0.56;

test('slot text: the largest size that fits on one line, else two lines split at a space, never past the min size', () => {
  const one = fitSlotText('Adenine', { w: 72, h: 20 }, measure, { min: 8, max: 18 });
  assert.equal(one.lines.length, 1);
  assert.ok(one.fits);
  assert.ok(measure('Adenine', one.fontSize) <= 72 - 2 * one.padX + 1e-9);
  assert.ok(one.fontSize * one.lineHeight <= 20 + 1e-9);
  // shrinks for a narrow slot
  const narrow = fitSlotText('Adenine', { w: 40, h: 20 }, measure, { min: 6, max: 18 });
  assert.ok(narrow.fontSize < one.fontSize);
  // a tall slot takes two lines when that is larger than one
  const two = fitSlotText('Sugar-phosphate backbone', { w: 144, h: 40 }, measure, { min: 8, max: 18 });
  assert.deepEqual(two.lines, ['Sugar-phosphate', 'backbone']);
  assert.ok(two.fits);
  assert.ok(two.fontSize > fitSlotText('Sugar-phosphate backbone', { w: 144, h: 40 }, measure, { min: 8, max: 18, maxLines: 1 }).fontSize);
  // never more than two lines; a name that does not fit at the min size says so
  const tiny = fitSlotText('Sugar-phosphate backbone', { w: 30, h: 10 }, measure, { min: 8, max: 18 });
  assert.equal(tiny.fits, false);
  assert.equal(tiny.fontSize, 8);
  assert.ok(tiny.lines.length <= 2);
  assert.deepEqual(fitSlotText('Adenine', { w: 72, h: 20 }, measure, { min: 8, max: 18 }), one, 'deterministic');
});

test('all slots share one font size (the smallest of their own best fits); a name that cannot fit keeps its own', () => {
  const items = [{ name: 'Adenine', w: 72, h: 20 }, null, { name: 'Base pairs', w: 92, h: 23 }, { name: 'Sugar-phosphate backbone', w: 144, h: 40 }, { name: 'Sugar-phosphate backbone', w: 30, h: 10 }];
  const fits = fitSlotTexts(items, measure, { min: 8, max: 18 });
  assert.equal(fits[1], null);
  const own = items.map((it) => (it === null ? null : fitSlotText(it.name, it, measure, { min: 8, max: 18 })));
  const shared = Math.min(...own.filter((f) => f !== null && f.fits).map((f) => f?.fontSize ?? 99));
  for (const i of [0, 2, 3]) {
    assert.equal(fits[i]?.fontSize, shared, `slot ${i}`);
    assert.ok(fits[i]?.fits);
  }
  assert.deepEqual(fits[4], own[4], 'the overflowing one keeps its min-size fit');
});

test('slot states: covered until its part is named, the name written in; the final step (or a part-less slot after the lesson reveal) uncovers', () => {
  const slots = labelSlots(dnaDemo);
  const none = dnaDemo.parts.map(() => false);
  assert.ok(slotStates(slots, none, { labelsShown: false, openUnmatched: false }).every((s) => s === 'covered'));
  const st = stageView(dnaDemo, 2, true);
  const states = slotStates(slots, st.named, { labelsShown: false, openUnmatched: false });
  // parts 0..2 named: base pairs (slot 0), backbone (slot 5), adenine (slot 2)
  assert.deepEqual(states, ['named', 'covered', 'named', 'covered', 'covered', 'named']);
  assert.ok(slotStates(slots, st.named, { labelsShown: true, openUnmatched: false }).every((s) => s === 'open'));
  const water = labelSlots(waterDemo);
  const all = waterDemo.parts.map(() => true);
  assert.deepEqual(slotStates(water, all, { labelsShown: false, openUnmatched: true }), ['named', 'named', 'named', 'open', 'named', 'named']);
  assert.deepEqual(slotStates(water, all, { labelsShown: false, openUnmatched: false }), ['named', 'named', 'named', 'muted', 'named', 'named']);
});

test('presentation outlines: only the current part’s region, never on the labels step', () => {
  assert.equal(stageOutline(stageView(dnaDemo, 0, false)), 0);
  assert.equal(stageOutline(stageView(dnaDemo, 3, true)), 3);
  assert.equal(stageOutline(stageView(dnaDemo, 6, false)), null);
  assert.equal(stageOutline(stageView(dnaDemo, 6, true)), null);
});
