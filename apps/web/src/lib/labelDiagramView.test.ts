/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { LabelDiagramGen, LabelDiagramSpec, LabelPartGen } from '../../../../packages/contracts/kit.ts';
import { KIT_LIMITS } from '../../../../packages/contracts/kit.ts';
import type { Provenance } from '../../../../packages/contracts/index.ts';
import {
  checkPlacements, hasLabelBox, labelDiagramPresentationSteps, labelDiagramRevealQuote, labelMasks, MASK_PAD, MASK_PAD_X, normToPx,
  partViews, pixelBoxPct, place, pointPct, pointPx, sameName, stageFigureSize, stageQuestion, stageView, unplace, wordBank,
} from './labelDiagramView.ts';
import { buildLabelDiagramDemos, figureRefOf } from './labelDiagramDemoSpecs.ts';
import type { FigureMetaLike } from './labelDiagramDemoSpecs.ts';

const root = new URL('../../../../', import.meta.url);
const json = <T>(p: string): T => JSON.parse(readFileSync(new URL(p, root), 'utf8')) as T;
const golden = json<LabelDiagramGen>('tests/fixtures/stage6/label-diagram.gen.json');
const provenance = json<Provenance>('tests/fixtures/provenance.fixture.json');
const figureMeta = json<FigureMetaLike>('data/figures/medlineplus-dna-structure-1.json');
const demos = buildLabelDiagramDemos(golden, figureMeta, provenance, {});
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
  // adenine: point y 317/1000 = 190.2 px inside its 181..199 px region → about halfway down.
  const adenine = views.find((v) => v.part.id === 'part-adenine');
  assert.ok(adenine !== undefined && Math.abs(adenine.pointDepth - (190.2 - 181) / 18) < 1e-9);
  assert.equal(views.find((v) => v.part.id === 'part-backbone')?.tag, 'above');
  const topEdge = partViews({ ...dna, regions: [{ partId: 'part-base-pairs', x1: 0, y1: 0, x2: 300, y2: 300, confidence: null }] });
  assert.equal(topEdge[0]?.tag, 'inside', 'an outline at the top edge keeps its tag inside');
  const noRegions = partViews({ ...dna, regions: [] });
  assert.ok(noRegions.every((v) => v.region === null));
});

test('the stage figure keeps the image aspect inside its box', () => {
  assert.deepEqual(stageFigureSize({ width: 600, height: 600 }, 620, 430), { width: 430, height: 430 });
  assert.deepEqual(stageFigureSize({ width: 1200, height: 600 }, 620, 430), { width: 620, height: 310 });
  assert.deepEqual(stageFigureSize({ width: 300, height: 600 }, 620, 430), { width: 215, height: 430 });
  assert.deepEqual(stageFigureSize({ width: 0, height: 0 }, 620, 430), { width: 430, height: 430 }, 'unknown size: square');
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
  const unlabelled = { ...dna, parts: dna.parts.map((p) => ({ ...p, labelX1: 0, labelY1: 0, labelX2: 0, labelY2: 0 })) };
  assert.equal(labelDiagramPresentationSteps(unlabelled), 6);
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
  const unlabelled = { ...dna, parts: dna.parts.map((p) => ({ ...p, labelX1: 0, labelY1: 0, labelX2: 0, labelY2: 0 })) };
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
  const text = readFileSync(new URL('data/sources/medlineplus-what-is-dna.txt', root), 'utf8');
  for (const d of demos) {
    for (const p of d.spec.parts) assert.ok(text.includes(p.quote), `${d.id}: ${p.quote}`);
    assert.equal(d.spec.figure.credit, figureMeta.credit);
    assert.equal(d.spec.figure.width, 600);
    assert.equal(d.spec.figureId, 'medlineplus-dna-structure-1');
  }
  assert.deepEqual(figureRefOf(figureMeta), {
    id: figureMeta.id, width: 600, height: 600, caption: figureMeta.caption, credit: figureMeta.credit, license: figureMeta.license, labelsInImage: true,
  });
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
