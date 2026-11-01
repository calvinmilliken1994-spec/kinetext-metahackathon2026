// Stage 8c Addendum B, REPLAY of the real live round 3 (docs/evidence/stage-8c/live/results-r3.jsonl). Revision 1 of the
// water-cycle and DNA label diagrams failed only on the number position Muse's generation call wrote (water cycle: LD-06,
// the runoff point 15 px left of the stream; DNA: LD-04 + LD-06, the guanine and cytosine points on the printed words).
// The test applies the worker's placement to those recorded gens + regions and validates them with the real validator, the
// real figure (stored printed-label boxes included) and the real page text.
//
// The recorded runs kept each region's traced OUTLINE but not its raw mask, so the mask is rebuilt by filling the outline
// (even-odd, at pixel centres). The outline was simplified at 1 px, so this ink differs from SAM's mask by about a pixel
// along its edges; the live-probe masks themselves are exercised in packages/meta/sam-mask.test.ts and
// workers/generation/lesson.placement.test.ts. The fixture is a copy of the two r1 artifacts (storage/ is gitignored).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { placeLabelPartsOnInk, printedTextAvoider } from '../workers/generation/lesson.ts';
import type { PartInk } from '../workers/generation/lesson.ts';
import { listFigures, loadFigureLabelBoxes, loadFigurePartLabelGroups } from '../packages/sources/figures.ts';
import type { FigureMeta } from '../packages/sources/figures.ts';
import { loadSource } from '../packages/sources/index.ts';
import { validateKitComponent } from '../packages/validation/kit/index.ts';
import type { GroundingBox } from '../packages/meta/grounding.ts';
import type { LabelDiagramGen, LabelRegion } from '../packages/contracts/kit.ts';

interface ReplayJob {
  jobId: string;
  sourceId: string;
  figureId: string;
  recordedFailedChecks: string[];
  gen: LabelDiagramGen;
  regions: LabelRegion[];
  groundingUnions: { partId: string; ground: GroundingBox | null }[];
}
const fixture = JSON.parse(readFileSync(new URL('./fixtures/stage8c/round3-replay.json', import.meta.url), 'utf8')) as {
  jobs: { water: ReplayJob; dna: ReplayJob };
};

type Pt = [number, number];
function ringsOf(path: string): Pt[][] {
  return [...path.matchAll(/M([^MZ]*)Z/g)].map(m =>
    (m[1] as string).split('L').map((t): Pt => {
      const [x, y] = t.trim().split(' ').map(Number);
      return [x as number, y as number];
    }),
  );
}
/** Fills the outline (even-odd, pixel centres) into the region's box-local raster. */
function rasterOfOutline(region: LabelRegion): PartInk {
  const width = region.x2 - region.x1 + 1;
  const height = region.y2 - region.y1 + 1;
  const rings = ringsOf(region.outline as string);
  const data = new Uint8Array(width * height);
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const cx = region.x1 + c + 0.5;
      const cy = region.y1 + r + 0.5;
      let inside = false;
      for (const ring of rings) {
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const [xi, yi] = ring[i] as Pt;
          const [xj, yj] = ring[j] as Pt;
          if (yi > cy !== yj > cy && cx < ((xj - xi) * (cy - yi)) / (yj - yi) + xi) inside = !inside;
        }
      }
      data[r * width + c] = inside ? 1 : 0;
    }
  }
  return { raster: { width, height, data }, origin: { x1: region.x1, y1: region.y1 } };
}

function figureFor(job: ReplayJob): FigureMeta {
  const meta = listFigures(job.sourceId).find(f => f.id === job.figureId) as FigureMeta;
  const partLabelGroups = loadFigurePartLabelGroups(meta.id);
  return { ...meta, labelBoxes: loadFigureLabelBoxes(meta.id), ...(partLabelGroups !== undefined ? { partLabelGroups } : {}) };
}
function validate(job: ReplayJob, gen: LabelDiagramGen) {
  return validateKitComponent('label-diagram-v1', gen, [loadSource(job.sourceId)], {
    revision: 1,
    labelRegions: job.regions,
    figures: [figureFor(job)],
  });
}
const failedIds = (r: { checks: { id: string; passed: boolean }[] }): string[] => r.checks.filter(c => !c.passed).map(c => c.id);

function place(job: ReplayJob) {
  const meta = figureFor(job);
  const unions = job.gen.parts.map(p => job.groundingUnions.find(u => u.partId === p.id)?.ground ?? null);
  const rasters = job.gen.parts.map((p): PartInk | null => {
    const region = job.regions.find(r => r.partId === p.id);
    return region?.outline === undefined ? null : rasterOfOutline(region);
  });
  return placeLabelPartsOnInk(job.gen, rasters, job.regions, unions, meta.width, meta.height, printedTextAvoider(meta, job.gen));
}

for (const key of ['water', 'dna'] as const) {
  const job = fixture.jobs[key];

  test(`replay round 3 ${key}: the recorded revision 1 fails exactly the recorded checks under today's validator`, () => {
    const before = validate(job, job.gen);
    assert.deepEqual(failedIds(before), job.recordedFailedChecks);
    for (const r of job.regions) assert.ok(r.ground !== undefined && r.outline !== undefined && (r.confidence ?? 0) >= 0.5, `${r.partId}: located, confident, traced`);
  });

  test(`replay round 3 ${key}: after placement revision 1 is checked on every check and publishable`, () => {
    const placed = place(job);
    assert.equal(placed.genPositions.length, job.gen.parts.length, 'every part is located and confident, so every number is placed');
    const after = validate(job, placed.gen);
    assert.deepEqual(failedIds(after), [], after.checks.filter(c => !c.passed).map(c => `${c.id}: ${c.message}`).join('\n'));
    assert.equal(after.publishable, true);
    // the six fields are the only thing placement touched
    placed.gen.parts.forEach((p, i) => {
      const g = job.gen.parts[i]!;
      assert.deepEqual({ ...p, x: 0, y: 0, areaX1: 0, areaY1: 0, areaX2: 0, areaY2: 0 }, { ...g, x: 0, y: 0, areaX1: 0, areaY1: 0, areaX2: 0, areaY2: 0 });
    });
  });
}

test('replay round 3 water cycle: the runoff number moved from 15 px left of the stream onto it', () => {
  const job = fixture.jobs.water;
  const runoff = job.gen.parts.findIndex(p => p.id === 'runoff');
  const placed = place(job);
  const meta = figureFor(job);
  const region = job.regions[runoff] as LabelRegion;
  const px = (placed.gen.parts[runoff]!.x * meta.width) / 1000;
  const py = (placed.gen.parts[runoff]!.y * meta.height) / 1000;
  const oldPx = (job.gen.parts[runoff]!.x * meta.width) / 1000;
  assert.ok(oldPx < region.x1 - 11, `recorded: the point (${oldPx.toFixed(0)} px) was left of the region (${region.x1}..${region.x2})`);
  assert.ok(px >= region.x1 && px <= region.x2 && py >= region.y1 && py <= region.y2, `placed (${px.toFixed(1)}, ${py.toFixed(1)}) is inside the region`);
});

test('replay round 3 DNA: guanine and cytosine left the printed words and sit on their colour bars', () => {
  const job = fixture.jobs.dna;
  const meta = figureFor(job);
  const printed = meta.labelBoxes ?? [];
  const placed = place(job);
  for (const id of ['guanine', 'cytosine']) {
    const i = job.gen.parts.findIndex(p => p.id === id);
    const was = job.gen.parts[i]!;
    const now = placed.gen.parts[i]!;
    const onWord = (x: number, y: number): boolean => {
      const ix = (x * meta.width) / 1000;
      const iy = (y * meta.height) / 1000;
      return printed.some(s => s.x1 <= ix && ix < s.x2 && s.y1 <= iy && iy < s.y2);
    };
    assert.equal(onWord(was.x, was.y), true, `${id}: Muse's recorded point was on a printed word`);
    assert.equal(onWord(now.x, now.y), false, `${id}: the placed point is not`);
    const region = job.regions[i] as LabelRegion;
    const px = (now.x * meta.width) / 1000;
    const py = (now.y * meta.height) / 1000;
    assert.ok(px >= region.x1 && px <= region.x2 + 1 && py >= region.y1 && py <= region.y2 + 1, `${id}: inside its bar's region`);
  }
});

test('replay round 3 water cycle: without the printed-text rule precipitation would land on its own printed word (why the rule exists)', () => {
  // Muse's own point is kept only when it is already right, so start from a gen whose precipitation point is off its ink.
  // SAM's precipitation mask (0.69) covers the rain AND the printed word "Precipitation"; the ink nearest its centroid is a letter.
  const job = fixture.jobs.water;
  const meta = figureFor(job);
  const unions = job.gen.parts.map(p => job.groundingUnions.find(u => u.partId === p.id)?.ground ?? null);
  const rasters = job.gen.parts.map((p): PartInk | null => {
    const region = job.regions.find(r => r.partId === p.id);
    return region?.outline === undefined ? null : rasterOfOutline(region);
  });
  const offInk = structuredClone(job.gen);
  offInk.parts[1]!.x = 0;
  offInk.parts[1]!.y = 0;
  const naive = placeLabelPartsOnInk(offInk, rasters, job.regions, unions, meta.width, meta.height);
  const report = validate(job, naive.gen);
  assert.deepEqual(failedIds(report), ['LD-04']);
  assert.match(report.checks.find(c => c.id === 'LD-04')!.message, /parts\[1\].*printed word/);
});
