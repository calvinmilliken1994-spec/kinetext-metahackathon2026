// Stage 8c Addendum B: LD-06 gains the Muse-vs-SAM agreement criterion. For a region that carries `ground` (the union box
// Muse's grounding call gave, image pixels), SAM's box must lie inside that box widened by 25% of its width/height on
// each side; otherwise LD-06 fails with a message naming the part, and the affected paths are that part's x, y and four
// area fields. Regions without `ground` (stored runs, grounding failed) are judged as before.
// Run: node --test packages/validation/stage8c-label-agreement.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';

import type { LabelDiagramGen, LabelRegion } from '../contracts/kit.ts';
import type { SourceDocument } from '../contracts/index.ts';
import type { FigureMeta } from '../sources/figures.ts';
import { loadFigure } from '../sources/figures.ts';
import { loadSource } from '../sources/index.ts';
import { validateKitComponent } from './kit/index.ts';
import { checkOf, expectFailures, failureDetail, stage6Fixture } from './fixtures/stage6.ts';

const dnaSource = (): SourceDocument => loadSource('medlineplus-what-is-dna');
const dnaFigure = (): FigureMeta => loadFigure('medlineplus-dna-structure-1').meta; // 600 x 600
const golden = (): LabelDiagramGen => stage6Fixture<LabelDiagramGen>('label-diagram.gen.json');

/** SAM-shaped regions: a 40x40 box centred on each part's point, with Muse's grounding box (60x60 around it) as `ground`. */
function regionsWithGround(gen: LabelDiagramGen, meta: FigureMeta): LabelRegion[] {
  return gen.parts.map(p => {
    const px = Math.round((p.x * meta.width) / 1000);
    const py = Math.round((p.y * meta.height) / 1000);
    return {
      partId: p.id,
      x1: px - 20,
      y1: py - 20,
      x2: px + 20,
      y2: py + 20,
      confidence: 0.95,
      ground: { x1: px - 30, y1: py - 30, x2: px + 30, y2: py + 30 },
    };
  });
}

const validate = (gen: LabelDiagramGen, regions: LabelRegion[]) =>
  validateKitComponent('label-diagram-v1', gen, [dnaSource()], { labelRegions: regions, figures: [dnaFigure()] });

const areaPaths = (i: number): string[] => ['areaX1', 'areaY1', 'areaX2', 'areaY2'].map(f => `/parts/${i}/${f}`);

test('agreement: SAM boxes inside their grounding boxes pass LD-06', () => {
  const gen = golden();
  const report = validate(gen, regionsWithGround(gen, dnaFigure()));
  assert.equal(report.publishable, true, failureDetail(report));
});

test('agreement: the edge is 25% of the grounding box per side (inclusive); one pixel beyond fails', () => {
  const gen = golden();
  const regions = regionsWithGround(gen, dnaFigure());
  // part 1: ground is 60x60 -> 15 px margin per side. A SAM box reaching exactly 15 px past the right edge still agrees.
  const r = regions[1]!;
  r.x2 = r.ground!.x2 + 15;
  r.y1 = r.ground!.y1 - 15;
  assert.equal(checkOf(validate(gen, regions), 'LD-06').passed, true, 'exactly 25% beyond is inside');
  r.x2 = r.ground!.x2 + 16;
  const report = expectFailures(validate(gen, regions), ['LD-06']);
  assert.match(checkOf(report, 'LD-06').message, /parts\[1\]/);
});

test('agreement: a region that spilled outside what Muse located fails LD-06 alone, naming the part, with its x, y and area paths', () => {
  const gen = golden();
  const regions = regionsWithGround(gen, dnaFigure());
  const r = regions[3]!; // guanine
  r.x1 = r.ground!.x1 - 60; // SAM's region reaches far left of what Muse boxed
  const report = expectFailures(validate(gen, regions), ['LD-06']);
  const check = checkOf(report, 'LD-06');
  assert.match(check.message, /guanine/);
  assert.match(check.message, /Muse/);
  const affected = check.affected ?? [];
  for (const path of ['/parts/3/x', '/parts/3/y', ...areaPaths(3)]) {
    assert.ok(affected.includes(path), `${path} in ${affected.join(', ')}`);
  }
  assert.ok(!affected.some(a => a.startsWith('/parts/0/') || a.startsWith('/parts/4/')), 'only the offending part is named');
});

test('agreement: a region with no ground is judged as before (a spill is not checked)', () => {
  const gen = golden();
  const regions = regionsWithGround(gen, dnaFigure());
  const r = regions[3]!;
  delete r.ground;
  r.x1 -= 60; // would spill if there were a grounding box; the point (centre of the old box) is still inside
  const report = validate(gen, regions);
  assert.equal(checkOf(report, 'LD-06').passed, true, failureDetail(report));
});

test('agreement: a malformed ground box is ignored rather than failing', () => {
  const gen = golden();
  const regions = regionsWithGround(gen, dnaFigure());
  regions[2]!.ground = { x1: 50, y1: 50, x2: 50, y2: 60 }; // x1 == x2: not a box
  const report = validate(gen, regions);
  assert.equal(checkOf(report, 'LD-06').passed, true, failureDetail(report));
});

test('agreement: the point check still runs beside it (a point outside its region fails with the old message)', () => {
  const gen = golden();
  const regions = regionsWithGround(gen, dnaFigure());
  const r = regions[0]!;
  // move the region (and its ground) away from the point, keeping them in agreement with each other
  r.x1 += 200;
  r.x2 += 200;
  r.ground = { x1: r.ground!.x1 + 200, y1: r.ground!.y1, x2: r.ground!.x2 + 200, y2: r.ground!.y2 };
  const report = expectFailures(validate(gen, regions), ['LD-06']);
  assert.match(checkOf(report, 'LD-06').message, /lies outside its region/);
  assert.doesNotMatch(checkOf(report, 'LD-06').message, /Muse located/);
});

test('agreement: a thin part gets at least GROUND_AGREEMENT_MIN_MARGIN_PX (12 px) per side', () => {
  const gen = golden();
  const regions = regionsWithGround(gen, dnaFigure());
  const r = regions[1]!;
  // Water-cycle r2 runoff shape: a 35 px tall ground box (25% = 8.75 px) and SAM reaching 11 px above it.
  r.ground = { x1: r.ground!.x1, y1: r.ground!.y1, x2: r.ground!.x2, y2: r.ground!.y1 + 35 };
  r.y1 = r.ground.y1 - 11;
  r.y2 = r.ground.y2;
  r.x1 = r.ground.x1; r.x2 = r.ground.x2;
  assert.equal(checkOf(validate(gen, regions), 'LD-06').passed, true, '11 px is within the 12 px floor');
  r.y1 = r.ground.y1 - 13;
  expectFailures(validate(gen, regions), ['LD-06']);
});
