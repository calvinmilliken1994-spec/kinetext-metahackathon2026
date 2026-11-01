// STAGE-8c Addendum A dev fixture: SAM 3.1's region boxes from the Muse grounding probe
// (docs/evidence/muse-grounding-probe/result.json, water cycle rep 2: one dedicated Muse Spark 1.3 grounding call, then
// SAM prompted with the union of Muse's boxes plus 4% margin). Image pixels of noaa-hydrologic-cycle-1 (572 x 504),
// copied unchanged; ids 1..5 follow the probe's part order. Real model output from a probe, not a stored lesson run.
import type { LabelRegion } from '../../../../packages/contracts/kit.ts';

export const GROUNDING_PROBE_FIGURE = 'noaa-hydrologic-cycle-1';

export const GROUNDING_PROBE_WATER_REGIONS: readonly LabelRegion[] = [
  { partId: 'condensation', x1: 224, y1: 107, x2: 324, y2: 149, confidence: 0.6171875 },
  { partId: 'precipitation', x1: 370, y1: 146, x2: 519, y2: 227, confidence: 0.76171875 },
  { partId: 'transpiration', x1: 34, y1: 214, x2: 96, y2: 331, confidence: 0.81640625 },
  { partId: 'evaporation', x1: 136, y1: 310, x2: 197, y2: 427, confidence: 0.765625 },
  { partId: 'runoff', x1: 322, y1: 332, x2: 351, y2: 362, confidence: 0.921875 },
];
