// Stage 8c Addendum B: where a part's number goes. The helper picks the ink pixel of SAM's mask nearest the mask's centroid
// and returns it on the 0..1000 grid. Real masks (docs/evidence/sam-prompt-probe, muse-grounding-probe) prove it: the five
// evaporation arrows have a centroid BETWEEN the arrows, so the number must land on an arrow, not between them; the DNA
// guanine bar must give a point on the bar, never on the printed word below it. Every assertion decodes the mask with the
// library itself, independent of the helper's own geometry.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeMaskToRaster } from '@meta-sam/parser';
import { parseSamOutput } from './sam.ts';
import type { SamBox } from './sam.ts';
import { loadFigure, loadFigureLabelBoxes } from '../sources/figures.ts';
import { maskToRaster, placeOnInk, placeOnMask } from './sam-mask.ts';
import type { InkRaster } from './sam-mask.ts';

const EVIDENCE = new URL('../../docs/evidence/', import.meta.url);
const read = (rel: string): SamBox[] => parseSamOutput(readFileSync(new URL(rel, EVIDENCE), 'utf8'));

const WATER = loadFigure('noaa-hydrologic-cycle-1').meta; // 572 x 504
const DNA = loadFigure('medlineplus-dna-structure-1').meta; // 600 x 600

const evaporation = read('sam-prompt-probe/raw-wideBox.txt')[0] as SamBox; // all five arrows, conf 0.74
const dna = read('muse-grounding-probe/raw-medlineplus-dna-structure-1-1.sam.txt');
const guanine = dna.find(b => b.id === 4) as SamBox;
const cytosine = dna.find(b => b.id === 5) as SamBox;
const backbone = dna.find(b => b.id === 6) as SamBox;

interface Dims {
  width: number;
  height: number;
}
function inkAt(box: SamBox, imageX: number, imageY: number): boolean {
  const mask = box.mask!;
  const raster = decodeMaskToRaster({ encoding: mask.encoding, payload: mask.payload, width: mask.width, height: mask.height });
  const c = Math.floor(imageX) - box.x1;
  const r = Math.floor(imageY) - box.y1;
  return c >= 0 && r >= 0 && c < mask.width && r < mask.height && raster[r * mask.width + c] === 1;
}
function centroidOf(box: SamBox): { x: number; y: number; nearestInk: number } {
  const mask = box.mask!;
  const raster = decodeMaskToRaster({ encoding: mask.encoding, payload: mask.payload, width: mask.width, height: mask.height });
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let r = 0; r < mask.height; r++) {
    for (let c = 0; c < mask.width; c++) {
      if (raster[r * mask.width + c] === 1) {
        sx += box.x1 + c + 0.5;
        sy += box.y1 + r + 0.5;
        n++;
      }
    }
  }
  const cx = sx / n;
  const cy = sy / n;
  let best = Infinity;
  for (let r = 0; r < mask.height; r++) {
    for (let c = 0; c < mask.width; c++) {
      if (raster[r * mask.width + c] === 1) {
        best = Math.min(best, Math.hypot(box.x1 + c + 0.5 - cx, box.y1 + r + 0.5 - cy));
      }
    }
  }
  return { x: cx, y: cy, nearestInk: best };
}

describe('placeOnMask on real SAM masks', () => {
  it('evaporation arrows (five and four pieces): the number lands on an arrow, nearest ink to the centroid', () => {
    // The four-arrow mask is a real case whose centroid is BETWEEN the pieces: a raw centroid would put the number on land.
    const four = read('sam-prompt-probe/raw-boxAroundArrows.txt')[0] as SamBox;
    const c4 = centroidOf(four);
    assert.equal(inkAt(four, c4.x, c4.y), false, 'the centroid of the four arrows is not ink');
    assert.ok(c4.nearestInk > 0.5, `the centroid is off the ink (${c4.nearestInk.toFixed(1)} px from the centroid to ink)`);
    const p4 = placeOnMask(four.mask!, four, { imageWidth: WATER.width, imageHeight: WATER.height });
    assert.ok(p4 !== null);
    assert.ok(inkAt(four, (p4.x * WATER.width) / 1000, (p4.y * WATER.height) / 1000), 'the 0..1000 point is on an arrow');
    assert.ok(Math.hypot(p4.px + 0.5 - c4.x, p4.py + 0.5 - c4.y) <= c4.nearestInk + 2);

    const c = centroidOf(evaporation);
    const placed = placeOnMask(evaporation.mask!, evaporation, { imageWidth: WATER.width, imageHeight: WATER.height });
    assert.ok(placed !== null);
    // the grid point converts back to a pixel that is ink (what LD-06 and the view will use)
    assert.ok(inkAt(evaporation, (placed.x * WATER.width) / 1000, (placed.y * WATER.height) / 1000), 'the 0..1000 point is on an arrow');
    // and the ink pixel chosen is (nearly) the nearest one to the centroid, not just any ink
    const dist = Math.hypot(placed.px + 0.5 - c.x, placed.py + 0.5 - c.y);
    assert.ok(dist <= c.nearestInk + 2, `chosen ink ${dist.toFixed(1)} px from the centroid, nearest ink is ${c.nearestInk.toFixed(1)} px`);
    // inside the mask's box
    assert.ok(placed.px >= evaporation.x1 && placed.px <= evaporation.x2 && placed.py >= evaporation.y1 && placed.py <= evaporation.y2);
  });

  it('DNA guanine and cytosine: the point is on the colour bar, away from every stored printed word', () => {
    const printed = loadFigureLabelBoxes(DNA.id);
    assert.ok(printed.length > 0, 'the figure stores its printed-label boxes');
    for (const [name, box] of [
      ['guanine', guanine],
      ['cytosine', cytosine],
    ] as const) {
      const placed = placeOnMask(box.mask!, box, { imageWidth: DNA.width, imageHeight: DNA.height });
      assert.ok(placed !== null, name);
      const ix = (placed.x * DNA.width) / 1000;
      const iy = (placed.y * DNA.height) / 1000;
      assert.ok(inkAt(box, ix, iy), `${name}: the point is on the bar`);
      assert.ok(ix >= box.x1 && ix <= box.x2 + 1 && iy >= box.y1 && iy <= box.y2 + 1, `${name}: inside the bar's box`);
      assert.ok(!printed.some(s => s.x1 <= ix && ix < s.x2 && s.y1 <= iy && iy < s.y2), `${name}: not on a printed word (the LD-04 rule)`);
    }
  });

  it('a multi-piece backbone mask still gives a point on ink', () => {
    const placed = placeOnMask(backbone.mask!, backbone, { imageWidth: DNA.width, imageHeight: DNA.height });
    assert.ok(placed !== null);
    assert.ok(inkAt(backbone, (placed.x * DNA.width) / 1000, (placed.y * DNA.height) / 1000));
  });

  it('prefers a candidate inside the required area when the nearest ink is outside it', () => {
    // Area = the left half of the guanine bar in 0..1000 units; the centroid is mid-bar, near the area's right edge.
    const x1 = Math.round((guanine.x1 * 1000) / DNA.width);
    const x2 = Math.round(((guanine.x1 + guanine.x2) / 2 / DNA.width) * 1000) - 5;
    const within = { x1, y1: 0, x2, y2: 1000 };
    const placed = placeOnMask(guanine.mask!, guanine, { imageWidth: DNA.width, imageHeight: DNA.height, within });
    assert.ok(placed !== null);
    assert.ok(placed.x >= within.x1 && placed.x <= within.x2, `x ${placed.x} within ${within.x1}..${within.x2}`);
    assert.ok(inkAt(guanine, (placed.x * DNA.width) / 1000, (placed.y * DNA.height) / 1000));
  });

  it('is deterministic', () => {
    const a = placeOnMask(evaporation.mask!, evaporation, { imageWidth: WATER.width, imageHeight: WATER.height });
    const b = placeOnMask(evaporation.mask!, evaporation, { imageWidth: WATER.width, imageHeight: WATER.height });
    assert.deepEqual(a, b);
  });

  it('returns null for a mask that is not the box\'s size, a corrupt payload or a wrong marker', () => {
    const dims: Dims = { width: WATER.width, height: WATER.height };
    assert.equal(placeOnMask(evaporation.mask!, { ...evaporation, x2: evaporation.x2 + 3 }, { imageWidth: dims.width, imageHeight: dims.height }), null);
    assert.equal(placeOnMask({ ...evaporation.mask!, payload: '~not a payload' }, evaporation, { imageWidth: dims.width, imageHeight: dims.height }), null);
    assert.equal(placeOnMask({ ...evaporation.mask!, payload: `!${evaporation.mask!.payload.slice(1)}` }, evaporation, { imageWidth: dims.width, imageHeight: dims.height }), null);
    assert.equal(maskToRaster({ ...evaporation.mask!, payload: '' }, evaporation), null);
  });
});

describe('placeOnInk on synthetic rasters', () => {
  /** A raster from rows of '#'/'.' */
  const raster = (rows: string[]): InkRaster => ({
    width: rows[0]!.length,
    height: rows.length,
    data: Uint8Array.from(rows.join('').split('').map(ch => (ch === '#' ? 1 : 0))),
  });
  const at = { x1: 0, y1: 0 };

  it('keep: Muse\'s own point stays when it is already on the ink, inside the area and off printed text', () => {
    // A ring 10x10 px image: Muse put the number on the ring's bottom edge (grid 250, 450 -> pixel 2, 4).
    const r = raster(['#####', '#...#', '#...#', '#...#', '#####']);
    const kept = placeOnInk(r, at, { imageWidth: 10, imageHeight: 10, keep: { x: 250, y: 450 } });
    assert.ok(kept !== null);
    assert.deepEqual([kept.x, kept.y], [250, 450], 'unchanged: Muse was right');
    // Muse's point in the hole (not ink): placed on the ring as before.
    const moved = placeOnInk(r, at, { imageWidth: 10, imageHeight: 10, keep: { x: 250, y: 250 } });
    assert.deepEqual([moved!.px, moved!.py], [2, 0]);
    // On ink but on printed text, or outside the area: moved.
    const onText = placeOnInk(r, at, { imageWidth: 10, imageHeight: 10, keep: { x: 250, y: 450 }, avoid: (x, y) => y >= 400 });
    assert.notDeepEqual([onText!.x, onText!.y], [250, 450]);
    const outside = placeOnInk(r, at, { imageWidth: 10, imageHeight: 10, keep: { x: 250, y: 450 }, within: { x1: 0, y1: 0, x2: 1000, y2: 300 } });
    assert.notDeepEqual([outside!.x, outside!.y], [250, 450]);
  });

  it('no ink gives null', () => {
    assert.equal(placeOnInk(raster(['...', '...']), at, { imageWidth: 1000, imageHeight: 1000 }), null);
  });

  it('a ring: the centroid is a hole, the point is the nearest ring pixel (ties break to the top-left)', () => {
    const r = raster(['#####', '#...#', '#...#', '#...#', '#####']);
    const p = placeOnInk(r, at, { imageWidth: 10, imageHeight: 10 });
    assert.ok(p !== null);
    // centre (2.5, 2.5); nearest ink are the four edge midpoints at 2.0 px; the topmost-then-leftmost is (2, 0)
    assert.deepEqual([p.px, p.py], [2, 0]);
    assert.deepEqual([p.x, p.y], [250, 50]); // (2 + 0.5) / 10 * 1000, (0 + 0.5) / 10 * 1000
  });

  it('offsets by the box origin and converts pixel centres to the grid', () => {
    const r = raster(['#']);
    const p = placeOnInk(r, { x1: 99, y1: 49 }, { imageWidth: 200, imageHeight: 100 });
    assert.ok(p !== null);
    assert.deepEqual([p.px, p.py], [99, 49]);
    // centre (99.5, 49.5) -> 99.5/200*1000 = 497.5 -> 498 ; 49.5/100*1000 = 495
    assert.deepEqual([p.x, p.y], [498, 495]);
  });

  it('two separate pieces: the centroid is the empty gap, the point is on one piece', () => {
    const r = raster(['#.......#', '#.......#', '#.......#']);
    const p = placeOnInk(r, at, { imageWidth: 9, imageHeight: 3 });
    assert.ok(p !== null);
    assert.equal(r.data[p.py * 9 + p.px], 1);
    assert.ok(p.px === 0 || p.px === 8, 'on a piece, not in the gap at x = 4');
    assert.deepEqual([p.px, p.py], [0, 1], 'nearest to the centroid (4.5, 1.5); the left piece wins the tie and its middle row is nearest');
  });

  it('keeps the number off printed text: the nearest ink is a letter, the next nearest ink off the text wins', () => {
    // A 9x5 blob whose middle three columns are "printed text"; the centroid (4.5, 2.5) and its nearest ink are on the text.
    const r = raster(['#########', '#########', '#########', '#########', '#########']);
    const onText = (x: number): boolean => x >= 300 && x <= 600; // grid x of the middle columns on a 9 px wide image
    const plain = placeOnInk(r, at, { imageWidth: 9, imageHeight: 5 });
    assert.ok(plain !== null && onText(plain.x), 'without the rule the number is on the text');
    const p = placeOnInk(r, at, { imageWidth: 9, imageHeight: 5, avoid: x => onText(x) });
    assert.ok(p !== null);
    assert.ok(!onText(p.x), `x ${p.x} is off the text`);
    assert.equal(r.data[p.py * 9 + p.px], 1);
    // when the whole mask is text the nearest ink is still returned (the check then fails honestly)
    const all = placeOnInk(r, at, { imageWidth: 9, imageHeight: 5, avoid: () => true });
    assert.deepEqual(all, plain);
  });

  it('skips an ink pixel whose grid point would round onto empty pixels', () => {
    // 10 px wide image: one grid unit is 0.01 px, but a 2 px tall image gives 500 px per unit vertically.
    const r = raster(['#.', '.#']);
    const p = placeOnInk(r, at, { imageWidth: 2, imageHeight: 2 });
    assert.ok(p !== null);
    const px = Math.floor((p.x * 2) / 1000);
    const py = Math.floor((p.y * 2) / 1000);
    assert.equal(r.data[py * 2 + px], 1, 'the grid point maps back onto ink');
  });
});
