// Fixture label-diagram specs for the slice-U engine harness (?engine-demo=c) and tests. Pure: the golden gen JSON, the
// figure meta and the figures' stored label boxes (data/figures/<id>.labels.json) are passed in.
// - "dna": the committed golden (tests/fixtures/stage6/label-diagram.gen.json) with HAND-MADE region boxes around each
//   point on the 600×600 NLM DNA figure (NOT SAM output) and the figure's stored label boxes.
// - "dna-live" / "water-live": the parts Muse Spark 1.3 wrote and the regions SAM 3.1 returned in two stored live runs
//   (copied below from storage/runs/<job>/label-diagram-v1.r1.json), with the figure's stored label boxes added — what a
//   lesson made after the label-box fix carries. Those two runs were made before it, so their own specs have no boxes.
// - "bare": a synthetic layout check without any label boxes.

import { assembleKitSpec, attachLabelRegions, kitSpecId } from '../../../../packages/contracts/kit.ts';
import type { LabelDiagramGen, LabelDiagramSpec, LabelFigureRef, LabelRegion } from '../../../../packages/contracts/kit.ts';
import type { Provenance, SourceDocument } from '../../../../packages/contracts/index.ts';

export const DNA_SOURCE = 'medlineplus-what-is-dna';
export const WATER_SOURCE = 'noaa-jetstream-hydrologic-cycle';

/** The fields of a data/figures/<id>.json the view needs. */
export interface FigureMetaLike {
  id: string; width: number; height: number; caption: string; credit: string; license: string; labelsInImage: boolean;
}
/** A data/figures/<id>.labels.json: lead-verified boxes (image pixels) around every printed label. */
export interface FigureLabelsLike { figureId: string; width: number; height: number; boxes: { x1: number; y1: number; x2: number; y2: number }[] }

export function figureRefOf(m: FigureMetaLike, labels?: FigureLabelsLike): LabelFigureRef {
  const ref: LabelFigureRef = { id: m.id, width: m.width, height: m.height, caption: m.caption, credit: m.credit, license: m.license, labelsInImage: m.labelsInImage };
  if (labels !== undefined && labels.figureId === m.id) ref.labelBoxes = labels.boxes.map((b) => ({ x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2 }));
  return ref;
}

/** Hand-drawn pixel boxes on the 600×600 DNA figure, one around each golden part's point (plausible SAM-like output). */
export const DNA_REGIONS: LabelRegion[] = [
  { partId: 'part-base-pairs', x1: 112, y1: 276, x2: 232, y2: 293, confidence: 0.91 },
  { partId: 'part-adenine', x1: 346, y1: 181, x2: 435, y2: 199, confidence: 0.88 },
  { partId: 'part-thymine', x1: 435, y1: 181, x2: 526, y2: 199, confidence: 0.86 },
  { partId: 'part-guanine', x1: 346, y1: 278, x2: 439, y2: 297, confidence: 0.9 },
  { partId: 'part-cytosine', x1: 439, y1: 278, x2: 526, y2: 297, confidence: 0.87 },
  { partId: 'part-backbone', x1: 80, y1: 40, x2: 246, y2: 566, confidence: 0.79 },
];

type LivePart = LabelDiagramGen['parts'][number];
const livePart = (id: string, name: string, sourceId: string, quote: string, x: number, y: number, l: [number, number, number, number]): LivePart => ({
  id, name, sourceId, quote, x, y, labelX1: l[0], labelY1: l[1], labelX2: l[2], labelY2: l[3],
});

/** Live run job-20261031051459-6bf49d3d (Muse Spark 1.3 parts, SAM 3.1 regions), copied unchanged. */
export const LIVE_DNA_JOB = 'job-20261031051459-6bf49d3d';
export const LIVE_DNA_GEN: LabelDiagramGen = {
  schemaVersion: 'label-diagram-v1', title: 'Label parts of the DNA double helix', figureId: 'medlineplus-dna-structure-1',
  hint: 'Match each base to its partner and find the backbone that holds the rungs together.',
  parts: [
    livePart('base-pairs', 'Base pairs', DNA_SOURCE, 'DNA bases pair up with each other, A with T and C with G, to form units called base pairs.', 295, 472, [348, 292, 522, 328]),
    livePart('sugar-phosphate-backbone', 'Sugar-phosphate backbone', DNA_SOURCE, 'DNA is a double helix formed by base pairs attached to a sugar-phosphate backbone.', 398, 688, [465, 704, 730, 767]),
    livePart('adenine', 'Adenine', DNA_SOURCE, 'The information in DNA is stored as a code made up of four chemical bases: adenine (A), guanine (G), cytosine (C), and thymine (T).', 635, 332, [574, 357, 678, 385]),
    livePart('thymine', 'Thymine', DNA_SOURCE, 'stored as a code made up of four chemical bases: adenine (A), guanine (G), cytosine (C), and thymine (T).', 785, 332, [758, 357, 861, 385]),
    livePart('guanine', 'Guanine', DNA_SOURCE, 'as a code made up of four chemical bases: adenine (A), guanine (G), cytosine (C), and thymine (T).', 635, 527, [591, 553, 691, 581]),
    livePart('cytosine', 'Cytosine', DNA_SOURCE, 'made up of four chemical bases: adenine (A), guanine (G), cytosine (C), and thymine (T).', 795, 527, [769, 553, 874, 581]),
  ],
};
export const LIVE_DNA_REGIONS: LabelRegion[] = [
  { partId: 'base-pairs', x1: 114, y1: 277, x2: 229, y2: 288, confidence: 0.875 },
  { partId: 'sugar-phosphate-backbone', x1: 222, y1: 411, x2: 302, y2: 417, confidence: 0.55078125 },
  { partId: 'adenine', x1: 347, y1: 181, x2: 524, y2: 199, confidence: 0.92578125 },
  { partId: 'thymine', x1: 347, y1: 196, x2: 515, y2: 199, confidence: 0.875 },
  { partId: 'guanine', x1: 357, y1: 306, x2: 423, y2: 321, confidence: 0.73828125 },
  { partId: 'cytosine', x1: 457, y1: 307, x2: 526, y2: 323, confidence: 0.796875 },
];

/** Live run job-20261031051634-7731ba24 (Muse Spark 1.3 parts, SAM 3.1 regions), copied unchanged. */
export const LIVE_WATER_JOB = 'job-20261031051634-7731ba24';
export const LIVE_WATER_GEN: LabelDiagramGen = {
  schemaVersion: 'label-diagram-v1', title: 'Label the water cycle', figureId: 'noaa-hydrologic-cycle-1',
  hint: 'Place each water cycle name on the part of the diagram where that process happens',
  parts: [
    livePart('evaporation', 'Evaporation', WATER_SOURCE, 'Evaporation is the change of state in a substance from a liquid to a gas.', 295, 710, [196, 585, 392, 616]),
    livePart('transpiration', 'Transpiration', WATER_SOURCE, 'Transpiration is the evaporation of water from plants through stomata.', 115, 570, [11, 440, 233, 473]),
    livePart('condensation', 'Condensation', WATER_SOURCE, 'Condensation is the process whereby water vapor is changed into a liquid state.', 505, 255, [292, 112, 570, 147]),
    livePart('clouds', 'clouds', WATER_SOURCE, 'In the atmosphere, condensation may appear as clouds or dew.', 775, 220, [0, 0, 0, 0]),
    livePart('precipitation', 'Precipitation', WATER_SOURCE, 'Precipitation can be in the form of rain, hail, snow, or sleet.', 740, 320, [696, 353, 910, 390]),
    livePart('runoff', 'Runoff', WATER_SOURCE, 'Runoff occurs when there is excessive precipitation and the ground is saturated (cannot absorb any more water).', 460, 825, [692, 672, 812, 708]),
  ],
};
export const LIVE_WATER_REGIONS: LabelRegion[] = [
  { partId: 'evaporation', x1: 163, y1: 323, x2: 171, y2: 426, confidence: 0.8046875 },
  { partId: 'transpiration', x1: 61, y1: 227, x2: 69, y2: 331, confidence: 0.828125 },
  { partId: 'condensation', x1: 251, y1: 84, x2: 324, y2: 146, confidence: 0.84765625 },
  { partId: 'clouds', x1: 400, y1: 95, x2: 473, y2: 148, confidence: 0.9375 },
  { partId: 'precipitation', x1: 375, y1: 147, x2: 520, y2: 239, confidence: 0.53515625 },
  { partId: 'runoff', x1: 119, y1: 342, x2: 462, y2: 482, confidence: 0.80859375 },
];

export interface LabelDiagramDemo { id: string; tab: string; note: string; spec: LabelDiagramSpec; sourceId: string }

/** A figure's meta file and its stored label boxes. */
export interface DemoFigure { meta: FigureMetaLike; labels: FigureLabelsLike }

export function buildLabelDiagramDemos(
  golden: LabelDiagramGen, dnaFigure: DemoFigure, provenance: Provenance, sources: Record<string, SourceDocument>, waterFigure?: DemoFigure,
): LabelDiagramDemo[] {
  const make = (gen: LabelDiagramGen, job: string, sourceId: string, figure: LabelFigureRef, regions: LabelRegion[], seed: number): LabelDiagramSpec => {
    const doc = sources[sourceId];
    const spec = assembleKitSpec(gen, 'label-diagram-v1', { id: kitSpecId(job, 'label-diagram-v1', 1), sources: doc === undefined ? [] : [doc], provenance, seed });
    return attachLabelRegions(spec, figure, regions);
  };
  const dnaRef = figureRefOf(dnaFigure.meta, dnaFigure.labels);
  // Layout check: no printed-label boxes at all (neither stored nor Muse's) and one part without a region.
  const bare: LabelDiagramGen = { ...golden, title: 'DNA parts (layout check: no label boxes, one region missing)', parts: golden.parts.map((p) => ({ ...p, labelX1: 0, labelY1: 0, labelX2: 0, labelY2: 0 })) };
  const out: LabelDiagramDemo[] = [
    { id: 'dna', tab: 'DNA (golden + hand-made regions)', note: 'Golden parts as committed; region boxes are hand-drawn around each point, not SAM output. Covers: the figure’s stored label boxes.', spec: make(golden, 'demo-label-dna', DNA_SOURCE, dnaRef, DNA_REGIONS, 11), sourceId: DNA_SOURCE },
    { id: 'dna-live', tab: 'DNA (live run parts)', note: `Parts and SAM 3.1 regions copied from stored live run ${LIVE_DNA_JOB}; covers from the figure’s stored label boxes, which that run predates.`, spec: make(LIVE_DNA_GEN, 'demo-label-dna-live', DNA_SOURCE, dnaRef, LIVE_DNA_REGIONS, 17), sourceId: DNA_SOURCE },
  ];
  if (waterFigure !== undefined) {
    out.push({ id: 'water-live', tab: 'Water cycle (live run parts)', note: `Parts and SAM 3.1 regions copied from stored live run ${LIVE_WATER_JOB}; covers from the figure’s stored label boxes, which that run predates.`, spec: make(LIVE_WATER_GEN, 'demo-label-water-live', WATER_SOURCE, figureRefOf(waterFigure.meta, waterFigure.labels), LIVE_WATER_REGIONS, 19), sourceId: WATER_SOURCE });
  }
  out.push({ id: 'bare', tab: 'No label boxes (layout check)', note: 'Synthetic variant: no label boxes at all (the printed labels stay visible) and the backbone has no region.', spec: make(bare, 'demo-label-bare', DNA_SOURCE, figureRefOf(dnaFigure.meta), DNA_REGIONS.filter((r) => r.partId !== 'part-backbone'), 13), sourceId: DNA_SOURCE });
  return out;
}
