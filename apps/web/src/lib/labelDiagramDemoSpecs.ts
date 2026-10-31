// Fixture label-diagram specs for the slice-U engine harness (?engine-demo=c) and tests. Pure: the golden gen JSON and
// the figure meta are passed in. The parts are the committed golden (tests/fixtures/stage6/label-diagram.gen.json); the
// regions are HAND-MADE boxes drawn around each point on the 600×600 NLM DNA figure, NOT SAM 3.1 output.

import { assembleKitSpec, attachLabelRegions, kitSpecId } from '../../../../packages/contracts/kit.ts';
import type { LabelDiagramGen, LabelDiagramSpec, LabelFigureRef, LabelRegion } from '../../../../packages/contracts/kit.ts';
import type { Provenance, SourceDocument } from '../../../../packages/contracts/index.ts';

export const DNA_SOURCE = 'medlineplus-what-is-dna';

/** The fields of a data/figures/<id>.json the view needs. */
export interface FigureMetaLike {
  id: string; width: number; height: number; caption: string; credit: string; license: string; labelsInImage: boolean;
}

export function figureRefOf(m: FigureMetaLike): LabelFigureRef {
  return { id: m.id, width: m.width, height: m.height, caption: m.caption, credit: m.credit, license: m.license, labelsInImage: m.labelsInImage };
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

export interface LabelDiagramDemo { id: string; tab: string; note: string; spec: LabelDiagramSpec; sourceId: string }

export function buildLabelDiagramDemos(golden: LabelDiagramGen, figure: FigureMetaLike, provenance: Provenance, sources: Record<string, SourceDocument>): LabelDiagramDemo[] {
  const doc = sources[DNA_SOURCE];
  const make = (gen: LabelDiagramGen, job: string, regions: LabelRegion[], seed: number): LabelDiagramSpec => {
    const spec = assembleKitSpec(gen, 'label-diagram-v1', { id: kitSpecId(job, 'label-diagram-v1', 1), sources: doc === undefined ? [] : [doc], provenance, seed });
    return attachLabelRegions(spec, figureRefOf(figure), regions);
  };
  // Layout check: no printed-label boxes and one part without a region (segmentation found nothing for it).
  const bare: LabelDiagramGen = { ...golden, title: 'DNA parts (layout check: no label boxes, one region missing)', parts: golden.parts.map((p) => ({ ...p, labelX1: 0, labelY1: 0, labelX2: 0, labelY2: 0 })) };
  return [
    { id: 'dna', tab: 'DNA (golden + hand-made regions)', note: 'Golden parts as committed; region boxes are hand-drawn around each point, not SAM output.', spec: make(golden, 'demo-label-dna', DNA_REGIONS, 11), sourceId: DNA_SOURCE },
    { id: 'bare', tab: 'No label boxes (layout check)', note: 'Synthetic variant: label boxes zeroed (the printed labels stay visible) and the backbone has no region.', spec: make(bare, 'demo-label-bare', DNA_REGIONS.filter((r) => r.partId !== 'part-backbone'), 13), sourceId: DNA_SOURCE },
  ];
}
