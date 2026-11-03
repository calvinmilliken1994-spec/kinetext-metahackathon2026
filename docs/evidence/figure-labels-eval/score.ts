// Scores the saved Muse label readings (raw/<id>.json) against each library figure's lead-verified OCR boxes.
// Offline, no calls. For every OCR box with text: the fraction of its pixels inside the union of the converted Muse
// boxes. "Part" = the box belongs to a curated partLabelGroups group (the labels that can become hidden answers).
// Run: node docs/evidence/figure-labels-eval/score.ts [--refine]   (refine = the ink-snap step, when it exists)
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { figureLabelsToBoxes } from '../../../packages/meta/figure-labels.ts';

const ROOT = new URL('../../../', import.meta.url);
const RAW = new URL('docs/evidence/figure-labels-eval/raw/', ROOT);
const FIG = new URL('data/figures/', ROOT);
type Box = { x1: number; y1: number; x2: number; y2: number; text?: string; group?: number };

const refine = process.argv.includes('--refine');
let refineFn: ((boxes: Box[], png: Uint8Array, w: number, h: number) => Box[]) | null = null;
if (refine) {
  const m = await import('../../../packages/meta/figure-label-refine.ts');
  refineFn = m.refineLabelBoxes;
}

function coverage(b: Box, muse: Box[]): number {
  let tot = 0, inn = 0;
  for (let x = b.x1; x < b.x2; x++) for (let y = b.y1; y < b.y2; y++) {
    tot++;
    if (muse.some(m => m.x1 <= x && x < m.x2 && m.y1 <= y && y < m.y2)) inn++;
  }
  return tot === 0 ? 1 : inn / tot;
}

const area = (b: Box): number => Math.max(0, b.x2 - b.x1) * Math.max(0, b.y2 - b.y1);
const inter = (a: Box, b: Box): number =>
  Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1)) * Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));

const rows: Record<string, unknown>[] = [];
const dump: Record<string, Box[]> = {};
let allParts = 0, okParts = 0, allBoxes = 0, okBoxes = 0;
// Size: for every truth text box, the box (Muse's or refined) overlapping it most; area ratio = that box / the truth box.
let ratioSum = 0, ratioN = 0, partRatioSum = 0, partRatioN = 0;
// Duplicates: pairs of boxes of DIFFERENT labels that share at least half of the smaller box (two covers on one text).
let duplicatesTotal = 0;
// Cross-label overlaps: a box whose own label is the truth group it overlaps most, and that also covers at least 10%
// of a truth box of ANOTHER group (it would hide part of a different label). `anyCross` counts any shared pixel.
let crossTotal = 0, anyCrossTotal = 0;
for (const f of readdirSync(RAW).filter(f => f.endsWith('.json')).sort()) {
  const raw = JSON.parse(readFileSync(new URL(f, RAW), 'utf8'));
  const truth = JSON.parse(readFileSync(new URL(`${raw.id}.labels.json`, FIG), 'utf8'));
  const meta = JSON.parse(readFileSync(new URL(`${raw.id}.json`, FIG), 'utf8'));
  const read = figureLabelsToBoxes(raw.data, raw.width, raw.height);
  let boxes: Box[] = read === null ? [] : read.boxes;
  // The web app re-encodes every teacher image to PNG, so the refine step only ever sees PNG: the library JPEGs are
  // scored through lossless PNG copies of the same pixels (png/<id>.png, made with PIL for this eval only).
  if (refineFn !== null) boxes = refineFn(boxes, readFileSync(new URL(`docs/evidence/figure-labels-eval/png/${raw.id}.png`, ROOT)), raw.width, raw.height);
  const partGroups = new Set<number>(truth.partLabelGroups ?? []);
  const misses: string[] = [];
  let p = 0, pOk = 0, n = 0, nOk = 0;
  for (const b of truth.boxes as Box[]) {
    if (b.text === undefined) continue;
    const c = coverage(b, boxes);
    const isPart = b.group !== undefined && partGroups.has(b.group);
    n++; if (c >= 0.98) nOk++;
    if (isPart) { p++; if (c >= 0.98) pOk++; }
    if (c < 0.98) misses.push(`${isPart ? 'PART ' : ''}${b.text} ${(c * 100).toFixed(0)}%`);
  }
  allParts += p; okParts += pOk; allBoxes += n; okBoxes += nOk;
  let fRatio = 0, fRatioN = 0;
  for (const b of truth.boxes as Box[]) {
    if (b.text === undefined) continue;
    let best: Box | null = null, bestI = 0;
    for (const m of boxes) { const i = inter(b, m); if (i > bestI) { bestI = i; best = m; } }
    if (best !== null && area(b) > 0) {
      fRatio += area(best) / area(b); fRatioN++;
      if (b.group !== undefined && partGroups.has(b.group)) { partRatioSum += area(best) / area(b); partRatioN++; }
    }
  }
  ratioSum += fRatio; ratioN += fRatioN;
  const cross: string[] = [];
  let anyCross = 0;
  for (const m of boxes) {
    let own: number | undefined, ownI = 0;
    for (const b of truth.boxes as Box[]) { const i = inter(b, m); if (i > ownI) { ownI = i; own = b.group; } }
    if (own === undefined) continue;
    const others = (truth.boxes as Box[]).filter(b => b.group !== own);
    if (others.some(b => inter(b, m) > 0)) anyCross++;
    const hit = others.find(b => area(b) > 0 && inter(b, m) >= 0.1 * area(b));
    if (hit !== undefined) cross.push(`${m.text ?? '(line)'} -> ${(truth.boxes as Box[]).find(t => t.group === hit.group && t.text !== undefined)?.text ?? hit.group}`);
  }
  crossTotal += cross.length; anyCrossTotal += anyCross;
  let duplicates = 0;
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i] as Box, c = boxes[j] as Box;
    if (a.group !== c.group && inter(a, c) >= 0.5 * Math.min(area(a), area(c))) duplicates++;
  }
  duplicatesTotal += duplicates;
  if (process.env['FL_DUMP'] !== undefined) dump[raw.id] = boxes;
  rows.push({
    id: raw.id, mime: meta.mime, museLabels: read?.labels ?? 0, partBoxesCovered: `${pOk}/${p}`, allBoxesCovered: `${nOk}/${n}`,
    meanAreaRatio: fRatioN === 0 ? null : Number((fRatio / fRatioN).toFixed(2)), crossLabelOverlaps: cross, anyPixelCrossOverlaps: anyCross, duplicateBoxes: duplicates, misses,
  });
  console.log(`${raw.id.padEnd(38)} part boxes ${pOk}/${p}  all ${nOk}/${n}  area x${fRatioN === 0 ? '-' : (fRatio / fRatioN).toFixed(2)}  cross ${cross.length}  ${misses.filter(m => m.startsWith('PART')).join(' | ')}`);
}
const meanAreaRatio = Number((ratioSum / Math.max(1, ratioN)).toFixed(2));
const partAreaRatio = Number((partRatioSum / Math.max(1, partRatioN)).toFixed(2));
console.log(`TOTAL part boxes fully covered ${okParts}/${allParts}; all text boxes ${okBoxes}/${allBoxes}; mean box/truth area x${meanAreaRatio} (${ratioN} matched; part boxes x${partAreaRatio}); cross-label overlaps ${crossTotal} (any pixel ${anyCrossTotal}); duplicate boxes ${duplicatesTotal}`);
if (process.env['FL_DUMP'] !== undefined) writeFileSync(process.env['FL_DUMP'], JSON.stringify(dump));
writeFileSync(new URL(`docs/evidence/figure-labels-eval/score${refine ? '-refined' : ''}.json`, ROOT), JSON.stringify({ refine, okParts, allParts, okBoxes, allBoxes, meanAreaRatio, matchedBoxes: ratioN, partAreaRatio, crossLabelOverlaps: crossTotal, anyPixelCrossOverlaps: anyCrossTotal, duplicateBoxes: duplicatesTotal, rows }, null, 2) + '\n');
