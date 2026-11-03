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

const rows: Record<string, unknown>[] = [];
let allParts = 0, okParts = 0, allBoxes = 0, okBoxes = 0;
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
  rows.push({ id: raw.id, mime: meta.mime, museLabels: read?.labels ?? 0, partBoxesCovered: `${pOk}/${p}`, allBoxesCovered: `${nOk}/${n}`, misses });
  console.log(`${raw.id.padEnd(38)} part boxes ${pOk}/${p}  all ${nOk}/${n}  ${misses.filter(m => m.startsWith('PART')).join(' | ')}`);
}
console.log(`TOTAL part boxes fully covered ${okParts}/${allParts}; all text boxes ${okBoxes}/${allBoxes}`);
writeFileSync(new URL(`docs/evidence/figure-labels-eval/score${refine ? '-refined' : ''}.json`, ROOT), JSON.stringify({ refine, okParts, allParts, okBoxes, allBoxes, rows }, null, 2) + '\n');
