// Stage 8b (lead): the repair guard recomputes the revision-1 authority with the same figure list and
// revision-1 SAM regions the model's report used, so honest label-diagram repairs are not rejected.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compareKitRevisions, validateKitComponent } from './kit/index.ts';
import { loadSource } from '../sources/index.ts';
import { loadFigure, loadFigureLabelBoxes } from '../sources/figures.ts';
import type { LabelDiagramGen, LabelRegion } from '../contracts/kit.ts';

const golden = JSON.parse(readFileSync(fileURLToPath(new URL('../../tests/fixtures/stage6/label-diagram.gen.json', import.meta.url)), 'utf8')) as LabelDiagramGen;
const sources = [loadSource('medlineplus-what-is-dna')];
const figure = loadFigure('medlineplus-dna-structure-1').meta;
const W = figure.width, H = figure.height;
const regionsAt = (gen: LabelDiagramGen): LabelRegion[] => gen.parts.map((p) => {
  const cx = Math.round((p.x * W) / 1000), cy = Math.round((p.y * H) / 1000);
  return { partId: p.id, x1: cx - 20, y1: cy - 20, x2: cx + 20, y2: cy + 20, confidence: 0.9 };
});

test('golden passes with figures and regions (sanity)', () => {
  const r = validateKitComponent('label-diagram-v1', golden, sources, { figures: [figure], labelRegions: regionsAt(golden) });
  assert.equal(r.publishable, true, JSON.stringify(r.checks.filter((c) => !c.passed)));
});

test('a point-moving repair of a genuine LD-06 failure passes the guard when context carries figures + revision-1 regions', () => {
  const regions = regionsAt(golden);
  const bad = structuredClone(golden);
  // Revision 1 put part 0's point outside its SAM region.
  bad.parts[0]!.x = Math.min(1000, golden.parts[0]!.x + 150);
  const r1 = validateKitComponent('label-diagram-v1', bad, sources, { figures: [figure], labelRegions: regions });
  assert.ok(r1.checks.some((c) => c.id === 'LD-06' && !c.passed));
  const fixed = structuredClone(bad);
  fixed.parts[0]!.x = golden.parts[0]!.x;
  const withCtx = compareKitRevisions('label-diagram-v1', bad, fixed, { sources, figures: [figure], labelRegions: regions });
  assert.equal(withCtx.passed, true, withCtx.message);
});

test('without the figure list the recomputed authority must not unlock /figureId on a valid baseline', () => {
  const next = structuredClone(golden);
  next.figureId = 'noaa-hydrologic-cycle-1';
  const r = compareKitRevisions('label-diagram-v1', golden, next, { sources, figures: [figure], labelRegions: regionsAt(golden) });
  assert.equal(r.passed, false);
});

test('LD-06 tolerates a point a few pixels outside a thin region (live water-cycle arrow) but not a far one', () => {
  const regions = regionsAt(golden);
  const near = structuredClone(regions);
  // Region 2 px wide of the point's left side: the point sits ~5 px outside, within 2% of 600 px = 12 px.
  const p0 = golden.parts[0]!;
  const cx = Math.round((p0.x * W) / 1000), cy = Math.round((p0.y * H) / 1000);
  near[0] = { ...near[0]!, x1: cx + 5, x2: cx + 15, y1: cy - 40, y2: cy + 40 };
  const ok = validateKitComponent('label-diagram-v1', golden, sources, { figures: [figure], labelRegions: near });
  assert.ok(ok.checks.some((c) => c.id === 'LD-06' && c.passed));
  const far = structuredClone(regions);
  far[0] = { ...far[0]!, x1: cx + 30, x2: cx + 60, y1: cy - 40, y2: cy + 40 };
  const bad = validateKitComponent('label-diagram-v1', golden, sources, { figures: [figure], labelRegions: far });
  assert.ok(bad.checks.some((c) => c.id === 'LD-06' && !c.passed));
});

test('LD-04 rejects a point on a printed word of the figure using the stored label boxes (live: DNA Guanine point on the word)', () => {
  const withBoxes = { ...figure, labelBoxes: loadFigureLabelBoxes(figure.id) };
  const onWord = structuredClone(golden);
  // 'Adenine' is printed at image pixels (357..423, 213..227) on the 600x600 figure -> normalised (650, 367).
  onWord.parts[2]!.x = 650; onWord.parts[2]!.y = 367;
  const r = validateKitComponent('label-diagram-v1', onWord, sources, { figures: [withBoxes], labelRegions: regionsAt(onWord) });
  const ld04 = r.checks.find((c) => c.id === 'LD-04')!;
  assert.equal(ld04.passed, false);
  assert.match(ld04.message, /printed word/);
  const ok = validateKitComponent('label-diagram-v1', golden, sources, { figures: [withBoxes], labelRegions: regionsAt(golden) });
  assert.ok(ok.checks.find((c) => c.id === 'LD-04')!.passed, 'the golden points are all off printed words');
});
