// Stage 8b V — label-diagram-v1 validation (LD-01..LD-09, frozen spec
// docs/specs/STAGE-8b-label-diagram.md). Muse Spark (vision) reads the page's OWN figure and
// writes lesson DATA: every part is named with the page's words, grounded in a verbatim page-TEXT
// quote, given a point on the part itself (normalised 0..1000) and a box around the part's printed
// label; SAM 3.1 returns one region box per part in image pixels (opts.regions) and the figure
// library supplies the source's figure list (opts.figures). These checks tie every value to the
// page and to the segmentation:
//   LD-01 every part quote verbatim (shared collectQuoteFailures convention: an unresolvable
//         sourceId unlocks sourceId AND quote, any other quote problem unlocks the quote only);
//   LD-02 each part name is a WHOLE PHRASE of its own quote, case-insensitive (shared
//         phraseOccursWhole rule, so "base pair" never passes on a printed "base pairs");
//   LD-03 the figureId is one of the source's figures; no figure list given fails closed;
//   LD-04 points are integers in 0..1000 and each lies OUTSIDE every printed-label box (a point
//         inside ANY label box — its own or another part's — fails: points go on the part itself);
//   LD-05 label boxes are the all-zero sentinel (no printed label) or well-formed integers with
//         x1 < x2, y1 < y2 inside 0..1000, pairwise non-overlapping; when the resolved figure has
//         labelsInImage true, at least 3 parts must carry a box (the view must cover the printed
//         names). An UNRESOLVED figureId skips only the labelsInImage clause — LD-03 owns it;
//   LD-06 segmentation found exactly one region per part (no duplicate, no stray), the part's
//         point converted to image pixels (x*width/1000, y*height/1000 with the figure's stored
//         dimensions) lies inside its region, and region area / image area lies within
//         [minRegionAreaFraction, maxRegionAreaFraction]. Without the regions option LD-06 and
//         LD-07 fail with the exact message 'segmentation did not run' (spec §Checks); an empty
//         regions list means segmentation ran and found nothing, and fails per part instead;
//   LD-07 the pairwise IoU of the regions is at most maxRegionOverlapIoU;
//   LD-08 the shared N-01 numbers-checkable rule over the AI-written title and hint;
//   LD-09 parts count within KIT_LIMITS.labelDiagram.parts, distinct part ids and distinct part
//         names (case-insensitive).
// schema.gen owns the non-quote structural shape (title, part id pattern, name length) like the
// other kit components; the publisher/plain-text sweep merges into it (kit/policy.ts).
// Failing checks carry validator-owned `affected` JSON pointers into the GEN (the artifact a
// repair revises), e.g. /parts/2/name, /parts/0/x, /parts/1/labelX1, /figureId, /title, /hint,
// /parts. Regions and figures are SYSTEM data a repair cannot edit, so region failures point at
// the gen fields segmentation consumed (the part's point) or selected (the figureId); failures
// that no gen change can fix ('segmentation did not run', stray regions) carry no affected path
// and therefore grant no repair permission — they end in deterministic failure, fail closed.
// Every id is always emitted, in frozen order, and no check throws (guarded()).

import type { SourceDocument, ValidationCheck, ValidationReport } from '../../contracts/index.ts';
import { KIT_LIMITS } from '../../contracts/kit.ts';
import type { LabelDiagramGen, LabelPartGen, LabelRegion } from '../../contracts/kit.ts';
import type { FigureMeta } from '../../sources/figures.ts';
import { guarded, QUOTE_MESSAGE_LIMIT } from '../validate.ts';
import {
  buildReport,
  buildSourceIndex,
  collectQuoteFailures,
  duplicateOccurrences,
  idProblems,
  lengthProblems,
  normalizeWhitespace,
  numbersCheckProblems,
  truncate,
} from './shared.ts';
import type { EntryQuote } from './shared.ts';
import { phraseOccursWhole } from './threshold.ts';

const L = KIT_LIMITS.labelDiagram;

export interface LabelDiagramValidateOptions { revision?: number; regions?: readonly LabelRegion[]; figures?: readonly FigureMeta[] }

function partsOf(gen: LabelDiagramGen): LabelPartGen[] {
  return Array.isArray(gen?.parts) ? gen.parts : [];
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** The exact 'segmentation did not run' failure the frozen spec pins for a missing regions option. */
const SEGMENTATION_DID_NOT_RUN = 'segmentation did not run';

interface LabelBox { x1: number; y1: number; x2: number; y2: number }

interface PartBox {
  /** True when the four edges are not all the 0 sentinel (the part claims a printed label). */
  hasBox: boolean;
  /** The edges, when all four are finite numbers (null for junk shapes; LD-05 flags those). */
  box: LabelBox | null;
  /** True when the box holds integers with 0 <= x1 < x2 <= coordMax and 0 <= y1 < y2 <= coordMax. */
  wellFormed: boolean;
}

function partBoxOf(part: LabelPartGen | undefined): PartBox {
  const edges: unknown[] = [part?.labelX1, part?.labelY1, part?.labelX2, part?.labelY2];
  if (edges.every(e => e === 0)) return { hasBox: false, box: null, wellFormed: false };
  if (!edges.every(isFiniteNumber)) return { hasBox: true, box: null, wellFormed: false };
  const [x1, y1, x2, y2] = edges as number[];
  const wellFormed =
    Number.isInteger(x1) && Number.isInteger(y1) && Number.isInteger(x2) && Number.isInteger(y2) &&
    x1 >= 0 && y1 >= 0 && x2 <= L.coordMax && y2 <= L.coordMax && x1 < x2 && y1 < y2;
  return { hasBox: true, box: { x1, y1, x2, y2 }, wellFormed };
}

/** True when the point (px, py) lies inside the box, edges inclusive. */
function boxContains(box: LabelBox, px: number, py: number): boolean {
  return box.x1 <= px && px <= box.x2 && box.y1 <= py && py <= box.y2;
}

function boxText(b: LabelBox): string {
  return `(${b.x1},${b.y1})-(${b.x2},${b.y2})`;
}

/** Intersection-over-union of two pixel boxes; 0 when either box has no positive area. */
export function regionIoU(a: LabelBox, b: LabelBox): number {
  const iw = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1);
  const ih = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1);
  if (iw <= 0 || ih <= 0) return 0;
  const inter = iw * ih;
  const areaA = (a.x2 - a.x1) * (a.y2 - a.y1);
  const areaB = (b.x2 - b.x1) * (b.y2 - b.y1);
  const union = areaA + areaB - inter;
  return union > 0 ? inter / union : 0;
}

export function labelDiagramStructuralProblems(gen: LabelDiagramGen): { problems: string[]; affected: string[] } {
  const problems: string[] = [];
  const affected: string[] = [];
  const push = (p: string[], ptr: string): void => { if (p.length > 0) { problems.push(...p); affected.push(ptr); } };
  if (typeof gen?.title !== 'string' || gen.title === '') { problems.push('title must be a non-empty string'); affected.push('/title'); }
  partsOf(gen).forEach((p, i) => {
    push(idProblems(`parts[${i}].id`, p?.id), `/parts/${i}/id`);
    push(lengthProblems(`parts[${i}].name`, p?.name, L.name.min, L.name.max), `/parts/${i}/name`);
  });
  return { problems, affected };
}

export function validateLabelDiagram(gen: LabelDiagramGen, sources: SourceDocument[], opts: LabelDiagramValidateOptions = {}): ValidationReport {
  // Defensive: a direct call with junk degrades into failed checks, never a throw.
  const g = (typeof gen === 'object' && gen !== null ? gen : {}) as LabelDiagramGen;
  const idx = buildSourceIndex(Array.isArray(sources) ? sources : []);
  const all = idx.allTexts();
  const structural = labelDiagramStructuralProblems(g);
  const parts = partsOf(g);

  // The source's figure list (system data). Membership is decided by id; entries without a
  // string id are ignored for lookup but never crash the walk.
  const figureList: FigureMeta[] = Array.isArray(opts.figures)
    ? opts.figures.filter((f): f is FigureMeta => typeof f === 'object' && f !== null && typeof (f as FigureMeta).id === 'string')
    : [];
  const figureIds = figureList.map(f => f.id);
  const figureId = typeof g.figureId === 'string' ? g.figureId : null;
  const figure = figureId !== null ? figureList.find(f => f.id === figureId) ?? null : null;
  const figureDimsUsable = figure !== null && isFiniteNumber(figure.width) && isFiniteNumber(figure.height) && figure.width > 0 && figure.height > 0;

  // SAM regions (system data, image pixels). A missing option means segmentation never ran; an
  // empty list means it ran and found nothing (LD-06 then fails per part).
  const regionsGiven = Array.isArray(opts.regions);
  const regions: LabelRegion[] = regionsGiven ? (opts.regions as LabelRegion[]) : [];
  const regionEntries = regions
    .map((r, k) => ({ r, k }))
    .filter(({ r }) => typeof r === 'object' && r !== null && typeof (r as LabelRegion).partId === 'string');
  const regionsByPartId = new Map<string, { r: LabelRegion; k: number }[]>();
  for (const entry of regionEntries) {
    const key = (entry.r as LabelRegion).partId;
    const list = regionsByPartId.get(key) ?? [];
    list.push(entry);
    regionsByPartId.set(key, list);
  }
  const partIndexOfId = new Map<string, number>();
  parts.forEach((p, i) => {
    const id = typeof p?.id === 'string' ? p.id : String(p?.id);
    if (!partIndexOfId.has(id)) partIndexOfId.set(id, i);
  });
  const nameOf = (i: number): string => (typeof parts[i]?.name === 'string' && parts[i]!.name !== '' ? `"${parts[i]!.name}"` : `parts[${i}]`);

  const checks: ValidationCheck[] = [
    structural.problems.length === 0
      ? { id: 'schema.gen', kind: 'schema', passed: true, message: 'every label-diagram title, part id and part name shape is within the frozen limits' }
      : { id: 'schema.gen', kind: 'schema', passed: false, message: `label-diagram gen failed the structural limits: ${structural.problems.join('; ')}`, path: structural.affected[0], affected: structural.affected },

    guarded('LD-01', 'grounding', () => {
      const entries: EntryQuote[] = parts.map((p, i) => ({
        quote: p?.quote,
        sourceId: p?.sourceId,
        quotePtr: `/parts/${i}/quote`,
        sourceIdPtr: `/parts/${i}/sourceId`,
        label: `parts[${i}].quote`,
      }));
      const { problems, affected, grounded } = collectQuoteFailures(entries, idx);
      return problems.length === 0
        ? { passed: true, message: `all ${grounded} part quote(s) appear verbatim in their cited source after whitespace normalisation (quotes-verbatim)` }
        : { passed: false, message: `${problems.join('; ')} (expected verbatim quotes of 1-${KIT_LIMITS.common.quote.max} characters copied from the cited source)`, path: affected[0], affected };
    }),

    guarded('LD-02', 'grounding', () => {
      const problems: string[] = [];
      const affected: string[] = [];
      parts.forEach((p, i) => {
        if (phraseOccursWhole(p?.quote, p?.name)) return;
        problems.push(`parts[${i}]: the name ${JSON.stringify(p?.name)} does not occur as a whole phrase in its quote "${truncate(String(p?.quote ?? ''), QUOTE_MESSAGE_LIMIT)}" (expected the page's own complete wording for the part, case-insensitive)`);
        affected.push(`/parts/${i}/name`, `/parts/${i}/quote`);
      });
      return problems.length === 0
        ? { passed: true, message: `every one of the ${parts.length} part name(s) occurs as a whole phrase in its own quote, case-insensitive (name-in-quote)` }
        : { passed: false, message: problems.join('; '), path: affected[0], affected };
    }),

    guarded('LD-03', 'semantic', () => {
      if (figureIds.length === 0) {
        return {
          passed: false,
          message: `figureId ${JSON.stringify(g.figureId)} cannot be verified: ${opts.figures !== undefined ? 'the provided figure list is empty' : 'no figure list was provided'} for this source (expected one of the figures the library lists for the page) (figure-valid)`,
          path: '/figureId',
          affected: ['/figureId'],
        };
      }
      if (figureId === null || !figureIds.includes(figureId)) {
        return {
          passed: false,
          message: `figureId ${JSON.stringify(g.figureId)} is not one of this source's figures (${figureIds.join(', ')}); expected a figure the library lists for the page (figure-valid)`,
          path: '/figureId',
          affected: ['/figureId'],
        };
      }
      return { passed: true, message: `figureId "${figureId}" is one of the source's ${figureIds.length} library figure(s) (figure-valid)` };
    }),

    guarded('LD-04', 'semantic', () => {
      const problems: string[] = [];
      const affected: string[] = [];
      const boxes = parts.map(partBoxOf);
      parts.forEach((p, i) => {
        for (const axis of ['x', 'y'] as const) {
          const v: unknown = p?.[axis];
          if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > L.coordMax) {
            problems.push(`parts[${i}].${axis} is ${JSON.stringify(v)}, expected an integer 0..${L.coordMax} (a point on the part itself, normalised to the 0-1000 grid)`);
            affected.push(`/parts/${i}/${axis}`);
          }
        }
        if (!Number.isInteger(p?.x) || !Number.isInteger(p?.y)) return;
        const px = p.x as number;
        const py = p.y as number;
        boxes.forEach((b, j) => {
          if (b.box === null) return; // junk edges: LD-05 owns them and they cannot contain a point meaningfully
          if (!b.hasBox) return;
          if (boxContains(b.box, px, py)) {
            problems.push(`parts[${i}]: the point (${px}, ${py}) lies inside the printed-label box ${boxText(b.box)} of parts[${j}]; the point must sit on the part itself, never on a printed label`);
            affected.push(`/parts/${i}/x`, `/parts/${i}/y`);
          }
        });
      });
      return problems.length === 0
        ? { passed: true, message: `all ${parts.length} part point(s) are integers within 0..${L.coordMax} and none lies inside any printed-label box (points-valid)` }
        : { passed: false, message: problems.join('; '), path: affected[0], affected };
    }),

    guarded('LD-05', 'semantic', () => {
      const problems: string[] = [];
      const affected: string[] = [];
      const edgesOf = (i: number): string[] => [`/parts/${i}/labelX1`, `/parts/${i}/labelY1`, `/parts/${i}/labelX2`, `/parts/${i}/labelY2`];
      const boxes = parts.map(partBoxOf);
      let boxed = 0;
      boxes.forEach((b, i) => {
        if (!b.hasBox) return;
        boxed++;
        if (!b.wellFormed) {
          problems.push(`parts[${i}]: the label box (${JSON.stringify(parts[i]?.labelX1)},${JSON.stringify(parts[i]?.labelY1)})-(${JSON.stringify(parts[i]?.labelX2)},${JSON.stringify(parts[i]?.labelY2)}) is not well-formed: expected the all-zero sentinel (no printed label) or integer edges with x1 < x2, y1 < y2 inside 0..${L.coordMax}`);
          affected.push(...edgesOf(i));
        }
      });
      boxes.forEach((a, i) => {
        const ab = a.box;
        if (!a.wellFormed || ab === null) return;
        boxes.forEach((b, j) => {
          const bb = b.box;
          if (j <= i || !b.wellFormed || bb === null) return;
          const overlapX = Math.min(ab.x2, bb.x2) - Math.max(ab.x1, bb.x1);
          const overlapY = Math.min(ab.y2, bb.y2) - Math.max(ab.y1, bb.y1);
          if (overlapX > 0 && overlapY > 0) {
            problems.push(`the label boxes of parts[${i}] ${boxText(ab)} and parts[${j}] ${boxText(bb)} overlap; printed labels are disjoint — expected pairwise non-overlapping boxes`);
            affected.push(...edgesOf(i), ...edgesOf(j));
          }
        });
      });
      if (figure !== null && figure.labelsInImage === true && boxed < 3) {
        problems.push(`the figure "${figureId}" prints part names inside the image (labelsInImage) but only ${boxed} of ${parts.length} parts carry a label box; expected at least 3 so the view can cover the printed names`);
        boxes.forEach((b, i) => { if (!b.hasBox) affected.push(...edgesOf(i)); });
      }
      return problems.length === 0
        ? {
            passed: true,
            message: `every label box is the all-zero sentinel or well-formed inside 0..${L.coordMax}, no two boxes overlap, and ${boxed} part(s) carry a box${figure !== null && figure.labelsInImage === true ? ' (the figure prints its labels; at least 3 required)' : ''} (label-boxes-valid)`,
          }
        : { passed: false, message: problems.join('; '), path: affected[0], affected };
    }),

    guarded('LD-06', 'behavioral', () => {
      if (!regionsGiven) {
        return { passed: false, message: SEGMENTATION_DID_NOT_RUN };
      }
      if (!figureDimsUsable) {
        return {
          passed: false,
          message: `the figure meta for ${JSON.stringify(g.figureId)} is not in the provided figure list or carries no usable width/height, so part points cannot be converted to image pixels (regions-found)`,
          path: '/figureId',
          affected: ['/figureId'],
        };
      }
      const width = (figure as FigureMeta).width;
      const height = (figure as FigureMeta).height;
      const imageArea = width * height;
      const problems: string[] = [];
      const affected: string[] = [];
      const matchedRegionKeys = new Set<number>();
      // Junk region entries (no string partId) can never match a part; flag them as stray below.
      const junkRegionCount = regions.length - regionEntries.length;
      parts.forEach((p, i) => {
        const id = typeof p?.id === 'string' ? p.id : String(p?.id);
        const matches = regionsByPartId.get(id) ?? [];
        matches.forEach(m => matchedRegionKeys.add(m.k));
        if (matches.length !== 1) {
          problems.push(matches.length === 0
            ? `segmentation returned no region for parts[${i}] (${nameOf(i)}); expected exactly one region per part`
            : `segmentation returned ${matches.length} regions for parts[${i}] (${nameOf(i)}); expected exactly one region per part`);
          affected.push(`/parts/${i}/x`, `/parts/${i}/y`);
          return;
        }
        const r = matches[0]!.r;
        const edges: unknown[] = [r.x1, r.y1, r.x2, r.y2];
        if (!edges.every(isFiniteNumber)) {
          problems.push(`the region for parts[${i}] (${nameOf(i)}) has unusable coordinates (${edges.map(e => JSON.stringify(e)).join(', ')}); expected four finite pixel values`);
          affected.push(`/parts/${i}/x`, `/parts/${i}/y`);
          return;
        }
        const [rx1, ry1, rx2, ry2] = edges as number[];
        if (!isFiniteNumber(p?.x) || !isFiniteNumber(p?.y)) {
          problems.push(`the point of parts[${i}] (${nameOf(i)}) is not a usable number, so it cannot be converted to image pixels and matched against its region`);
          affected.push(`/parts/${i}/x`, `/parts/${i}/y`);
          return;
        }
        const px = (p.x * width) / L.coordMax;
        const py = (p.y * height) / L.coordMax;
        const tol = L.pointToleranceFraction * Math.max(width, height);
        if (!(rx1 - tol <= px && px <= rx2 + tol && ry1 - tol <= py && py <= ry2 + tol)) {
          problems.push(`the point of parts[${i}] (${nameOf(i)}) at image pixel (${Math.round(px * 10) / 10}, ${Math.round(py * 10) / 10}) lies outside its region (${rx1},${ry1})-(${rx2},${ry2}) by more than ${Math.round(tol * 10) / 10} px; expected the region to contain the point`);
          affected.push(`/parts/${i}/x`, `/parts/${i}/y`);
        }
        const fraction = ((rx2 - rx1) * (ry2 - ry1)) / imageArea;
        if (!(fraction >= L.minRegionAreaFraction && fraction <= L.maxRegionAreaFraction)) {
          problems.push(`the region for parts[${i}] (${nameOf(i)}) covers ${(fraction * 100).toFixed(2)}% of the image; expected between ${(L.minRegionAreaFraction * 100).toFixed(2)}% and ${(L.maxRegionAreaFraction * 100).toFixed(0)}% (area fraction ${fraction.toFixed(5)} within ${L.minRegionAreaFraction}..${L.maxRegionAreaFraction})`);
          affected.push(`/parts/${i}/x`, `/parts/${i}/y`);
        }
      });
      regionEntries.forEach(({ r, k }) => {
        if (matchedRegionKeys.has(k)) return;
        if (!partIndexOfId.has(r.partId)) {
          problems.push(`segmentation returned a region for partId "${r.partId}", which is not a part of this gen; expected exactly one region per part and no stray regions`);
        }
      });
      if (junkRegionCount > 0) {
        problems.push(`segmentation returned ${junkRegionCount} region entr(ies) without a usable partId; expected exactly one region per part and no stray regions`);
      }
      return problems.length === 0
        ? { passed: true, message: `segmentation found exactly one region for each of the ${parts.length} parts, every region contains its part's point at image pixels, and every region covers between ${(L.minRegionAreaFraction * 100).toFixed(2)}% and ${(L.maxRegionAreaFraction * 100).toFixed(0)}% of the image (regions-found)` }
        : { passed: false, message: problems.join('; '), path: affected[0], affected };
    }),

    guarded('LD-07', 'behavioral', () => {
      if (!regionsGiven) {
        return { passed: false, message: SEGMENTATION_DID_NOT_RUN };
      }
      const problems: string[] = [];
      const affected: string[] = [];
      const usable = regionEntries
        .map(({ r }) => r)
        .filter((r): r is LabelRegion & { x1: number; y1: number; x2: number; y2: number } =>
          isFiniteNumber(r.x1) && isFiniteNumber(r.y1) && isFiniteNumber(r.x2) && isFiniteNumber(r.y2) &&
          (r.x2 - r.x1) * (r.y2 - r.y1) > 0);
      let maxIoU = 0;
      usable.forEach((a, i) => {
        usable.forEach((b, j) => {
          if (j <= i) return;
          const iou = regionIoU(a, b);
          if (iou > maxIoU) maxIoU = iou;
          if (iou > L.maxRegionOverlapIoU) {
            const ia = partIndexOfId.get(a.partId);
            const ib = partIndexOfId.get(b.partId);
            const labelA = ia !== undefined ? `parts[${ia}] (${nameOf(ia)})` : `partId "${a.partId}"`;
            const labelB = ib !== undefined ? `parts[${ib}] (${nameOf(ib)})` : `partId "${b.partId}"`;
            problems.push(`the regions of ${labelA} and ${labelB} overlap with IoU ${iou.toFixed(2)}, expected at most ${L.maxRegionOverlapIoU} (distinct parts need distinct segments)`);
            if (ia !== undefined) affected.push(`/parts/${ia}/x`, `/parts/${ia}/y`);
            if (ib !== undefined) affected.push(`/parts/${ib}/x`, `/parts/${ib}/y`);
          }
        });
      });
      const pairs = (usable.length * (usable.length - 1)) / 2;
      return problems.length === 0
        ? { passed: true, message: `all ${pairs} region pair(s) are distinct: the largest pairwise IoU is ${maxIoU.toFixed(2)}, at most ${L.maxRegionOverlapIoU} (regions-distinct)` }
        : { passed: false, message: problems.join('; '), path: affected[0], affected };
    }),

    guarded('LD-08', 'grounding', () => {
      const problems: string[] = [];
      const affected: string[] = [];
      const check = (label: string, text: unknown, ptr: string): void => {
        const p = numbersCheckProblems(label, text, all);
        if (p.length > 0) { problems.push(...p); affected.push(ptr); }
      };
      check('title', g.title, '/title');
      check('hint', g.hint, '/hint');
      return problems.length === 0
        ? { passed: true, message: 'every number in the AI-written title and hint appears on the page (N-01); part names are bound to their quotes by LD-02 (numbers-checkable)' }
        : { passed: false, message: problems.join('; '), path: affected[0], affected };
    }),

    guarded('LD-09', 'semantic', () => {
      const problems: string[] = [];
      const affected: string[] = [];
      if (parts.length < L.parts.min || parts.length > L.parts.max) {
        problems.push(`parts has ${parts.length} entries, expected ${L.parts.min}-${L.parts.max}`);
        affected.push('/parts');
      }
      const names = parts.map(p => normalizeWhitespace(String(p?.name ?? '')).toLowerCase());
      const nameDups = duplicateOccurrences(names);
      parts.forEach((p, i) => {
        if (nameDups.has(names[i] as string)) {
          problems.push(`parts[${i}].name ${JSON.stringify(p?.name)} occurs more than once (expected distinct names, case-insensitive)`);
          affected.push(`/parts/${i}/name`);
        }
      });
      const ids = parts.map(p => String(p?.id));
      const idDups = duplicateOccurrences(ids);
      parts.forEach((p, i) => {
        if (idDups.has(ids[i] as string)) {
          problems.push(`part id "${ids[i]}" occurs more than once (expected unique ids)`);
          affected.push(`/parts/${i}/id`);
        }
      });
      return problems.length === 0
        ? { passed: true, message: `${parts.length} parts (within ${L.parts.min}-${L.parts.max}) with distinct ids and distinct names (counts-valid)` }
        : { passed: false, message: problems.join('; '), path: affected[0], affected };
    }),
  ];

  return buildReport('label-diagram-v1', checks, opts.revision ?? 1);
}
