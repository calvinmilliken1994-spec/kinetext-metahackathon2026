// Teacher diagram (beta): snap Muse's printed-label boxes onto the printed text, using the image's own pixels.
//
// Muse Spark reads a teacher figure's printed labels and returns line boxes on a 0..1000 grid (figure-labels.ts). The
// boxes become the COVERS that hide the answer labels in Label the diagram, so a cover that misses part of a word gives
// the answer away. Measured on the 10 library figures (docs/evidence/figure-labels-eval), Muse's boxes are usually on
// the word but sometimes shifted by 20-45 px or a little short. This step is deterministic and makes no call:
//
//   1. undo the conversion padding to get Muse's line box (its size is kept for the search);
//   2. "lettering ink" in a search window: pixels that differ from their LOCAL background (a 3 x 3 block median of
//      line-sized tiles) by more than half the contrast found in Muse's own box (24..80); of the connected ink pieces
//      only letter-like ones are kept (no taller than 1.8 lines; not long and thin; not wide and solid; a wide piece
//      must cross at least 2.5 strokes per row), so drawn lines, arrows, edges, bars and filled shapes drop out;
//   3. move the box to the shift (about +/-60% of its width, at most 60 px; +/-50% of its height) holding the most
//      stroke starts (lettering is many narrow strokes per row), minus the ink its top and bottom edges cut through,
//      ties going to the smallest shift;
//   4. the line's own lettering (pieces centred on the placed box's rows) sets the final extent: trimmed to the first
//      and last inked column inside the box, grown sideways across letter/word gaps (at most 0.4 line heights) up to
//      max(40% of the width, 2 line heights), rows grown or trimmed to the inked run (at most 30% of the height beyond);
//   5. pad again with the figure-labels.ts rule (30% of the line height, at least 3 px; the line height is the taller
//      of the inked rows and Muse's line), rounded outward and clamped;
//   6. two labels never share their printed text: boxes settle from the least moved to the most moved, and a box that
//      lands mostly on a settled one is searched again without that lettering, or stays where Muse put it.
//
// Any failure (not a decodable 8-bit PNG, a size mismatch, no lettering in reach, a fragment narrower than 40% of
// Muse's box or shorter than 40% of its height) keeps that box exactly as it was.
import { FIGURE_LABEL_PAD_FRACTION, FIGURE_LABEL_PAD_MIN_PX, type ReadLabelBox } from './figure-labels.ts';
import { decodePng, type DecodedImage } from './png-decode.ts';

/** Horizontal search: this fraction of the line box width each way ... */
const SEARCH_X_FRACTION = 0.6;
/** ... capped at this many pixels. */
const SEARCH_X_MAX_PX = 60;
/** Vertical search: this fraction of the line height each way. */
const SEARCH_Y_FRACTION = 0.5;
/** Growth per side after the shift: sideways max(this fraction of the width, GROW_X_LINES line heights) ... */
const GROW_X_FRACTION = 0.4;
const GROW_X_LINES = 2;
/** ... and up/down this fraction of the line height. */
const GROW_Y_FRACTION = 0.3;
/** Growth sideways crosses gaps up to this fraction of the line height (letter and word spacing). */
const GAP_FRACTION = 0.4;
/** A row belongs to the line while its ink is at least this share of the line's inkiest row. */
const ROW_SHARE = 0.02;
/** The lettering found must span at least this share of Muse's line box width and height, else the box is kept. */
const MIN_KEEP = 0.4;
/** Two snapped boxes collide when they share at least this share of the smaller one. */
const COLLIDE_SHARE = 0.5;
/** Ink threshold: this share of the line box's strong (90th percentile) contrast, kept between INK_MIN and INK_MAX. */
const INK_SHARE = 0.5;
const INK_MIN = 24;
const INK_MAX = 80;
/** Lettering pieces are at most this many line heights tall. */
const PIECE_MAX_LINES = 1.8;
/** A piece wider than this many line heights must cross at least MIN_RUNS_PER_ROW strokes per row to be lettering. */
const WIDE_PIECE_LINES = 1.5;
const MIN_RUNS_PER_ROW = 2.5;

interface Rect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** The line box Muse gave, recovered from a padded box (pad = 30% of the line height, at least 3 px). */
export function unpaddedLineBox(b: Rect): Rect {
  const H = b.y2 - b.y1;
  const k = 1 + 2 * FIGURE_LABEL_PAD_FRACTION;
  // pad = max(3, 0.3 h) and H = h + 2 pad, so h = H / 1.6 when 0.3 h >= 3, else H - 6.
  const h = FIGURE_LABEL_PAD_FRACTION * (H / k) >= FIGURE_LABEL_PAD_MIN_PX ? H / k : H - 2 * FIGURE_LABEL_PAD_MIN_PX;
  const pad = Math.max(0, (H - h) / 2);
  const x1 = b.x1 + pad;
  const x2 = b.x2 - pad;
  if (x2 - x1 < 1 || h < 1) return { x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2 };
  return { x1: Math.round(x1), y1: Math.round(b.y1 + pad), x2: Math.round(x2), y2: Math.round(b.y2 - pad) };
}

/** The figure-labels.ts padding: 30% of the line height (at least 3 px) on every side, outward, clamped. */
function padded(r: Rect, lineH: number, width: number, height: number): Rect {
  const pad = Math.max(FIGURE_LABEL_PAD_MIN_PX, FIGURE_LABEL_PAD_FRACTION * lineH);
  return {
    x1: Math.max(0, Math.floor(r.x1 - pad)),
    y1: Math.max(0, Math.floor(r.y1 - pad)),
    x2: Math.min(width, Math.ceil(r.x2 + pad)),
    y2: Math.min(height, Math.ceil(r.y2 + pad)),
  };
}

/** Median of a short list (sorted in place). */
function median(values: number[]): number {
  values.sort((p, q) => p - q);
  return values[(values.length - 1) >> 1] as number;
}

/**
 * The local background colour of every tile (tile x tile pixels) of a window: the median colour of each tile, then
 * per channel the median over the tile and its (up to 8) neighbours. Lettering covers well under half of such a 3 x 3
 * block, so the block median is the ground the letters are printed on, also where a label sits on a coloured shape
 * beside a different ground. 3 bytes per tile, row-major, `cols` tiles per row.
 */
function tileBackground(img: DecodedImage, win: Rect, tile: number): { bg: Uint8Array; cols: number } {
  const cols = Math.ceil((win.x2 - win.x1) / tile);
  const rows = Math.ceil((win.y2 - win.y1) / tile);
  const own = new Uint8Array(cols * rows * 3);
  const hist = new Uint32Array(256 * 3);
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      hist.fill(0);
      const x1 = win.x1 + tx * tile, x2 = Math.min(win.x2, x1 + tile);
      const y1 = win.y1 + ty * tile, y2 = Math.min(win.y2, y1 + tile);
      for (let y = y1; y < y2; y++) {
        let k = (y * img.width + x1) * 3;
        for (let x = x1; x < x2; x++, k += 3) {
          hist[img.rgb[k] as number]! += 1;
          hist[256 + (img.rgb[k + 1] as number)]! += 1;
          hist[512 + (img.rgb[k + 2] as number)]! += 1;
        }
      }
      const half = ((x2 - x1) * (y2 - y1)) / 2;
      for (let c = 0; c < 3; c++) {
        let acc = 0, v = 0;
        for (; v < 255; v++) {
          acc += hist[c * 256 + v] as number;
          if (acc >= half) break;
        }
        own[(ty * cols + tx) * 3 + c] = v;
      }
    }
  }
  const bg = new Uint8Array(cols * rows * 3);
  const vals: number[] = [];
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      for (let c = 0; c < 3; c++) {
        vals.length = 0;
        for (let ny = Math.max(0, ty - 1); ny <= Math.min(rows - 1, ty + 1); ny++) {
          for (let nx = Math.max(0, tx - 1); nx <= Math.min(cols - 1, tx + 1); nx++) vals.push(own[(ny * cols + nx) * 3 + c] as number);
        }
        bg[(ty * cols + tx) * 3 + c] = median(vals);
      }
    }
  }
  return { bg, cols };
}

interface Lettering {
  /** 1 = lettering ink. */
  mask: Uint8Array;
  /** Per pixel: the index of its lettering piece, or -1. */
  piece: Int32Array;
  /** Per piece: minX, minY, maxX, maxY (inclusive, window coordinates). */
  boxes: number[];
}

/**
 * Lettering ink of a window. A pixel is ink when one colour channel differs from its local background (tileBackground)
 * by at least the threshold: half the contrast of the strongest tenth of the pixels in Muse's own line box (`probe`,
 * window coordinates), kept within INK_MIN..INK_MAX, so pale lettering on a pale ground still counts while a busy
 * picture does not flood the mask. Of the connected ink pieces (4-connected) only those that can be letters (or joined
 * letters) of a line `lineH` tall are kept: not taller than 1.8 lines (vertical strokes, pictures), not long and thin
 * (wider than 3 lines and under a third of a line tall: rules, leader lines), not wide and solid (wider than 2 lines
 * and over 85% filled: bars, bands), and a piece wider than 1.5 lines must cross at least 2.5 strokes per row (a
 * diagonal line, an edge, an outline or a filled shape crosses one or two).
 */
function letteringMask(img: DecodedImage, win: Rect, lineH: number, probe: Rect): Lettering {
  const W = win.x2 - win.x1;
  const H = win.y2 - win.y1;
  const tile = Math.max(4, Math.round(lineH));
  const { bg, cols } = tileBackground(img, win, tile);
  const mask = new Uint8Array(W * H);
  const tileCol = new Int32Array(W);
  for (let x = 0; x < W; x++) tileCol[x] = Math.floor(x / tile) * 3;
  const rgb = img.rgb;
  for (let y = 0; y < H; y++) {
    let k = ((win.y1 + y) * img.width + win.x1) * 3;
    const tileRow = Math.floor(y / tile) * cols * 3;
    const row = y * W;
    for (let x = 0; x < W; x++, k += 3) {
      const t = tileRow + (tileCol[x] as number);
      const dr = (rgb[k] as number) - (bg[t] as number);
      const dg = (rgb[k + 1] as number) - (bg[t + 1] as number);
      const db = (rgb[k + 2] as number) - (bg[t + 2] as number);
      let d = dr < 0 ? -dr : dr;
      if (dg > d) d = dg; else if (-dg > d) d = -dg;
      if (db > d) d = db; else if (-db > d) d = -db;
      mask[row + x] = d;
    }
  }
  const hist = new Uint32Array(256);
  let n = 0;
  for (let y = Math.max(0, probe.y1); y < Math.min(H, probe.y2); y++) {
    for (let x = Math.max(0, probe.x1); x < Math.min(W, probe.x2); x++, n++) hist[mask[y * W + x] as number]! += 1;
  }
  let p90 = 255;
  for (let v = 0, acc = 0; v < 256; v++) {
    acc += hist[v] as number;
    if (acc >= 0.9 * n) {
      p90 = v;
      break;
    }
  }
  const threshold = Math.min(INK_MAX, Math.max(INK_MIN, Math.round(INK_SHARE * p90)));
  for (let i = 0; i < mask.length; i++) mask[i] = (mask[i] as number) >= threshold ? 1 : 0;
  // Connected pieces by an explicit stack. Marks: 1 unvisited ink, 2 the piece being collected, 3 kept, 4 dropped.
  const stack = new Int32Array(W * H);
  const members = new Int32Array(W * H);
  const piece = new Int32Array(W * H).fill(-1);
  const boxes: number[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (mask[start] !== 1) continue;
    let top = 0, count = 0;
    stack[top++] = start;
    mask[start] = 2;
    let minX = W, maxX = -1, minY = H, maxY = -1;
    while (top > 0) {
      const p = stack[--top] as number;
      members[count++] = p;
      const y = (p / W) | 0;
      const x = p - y * W;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x > 0 && mask[p - 1] === 1) { mask[p - 1] = 2; stack[top++] = p - 1; }
      if (x < W - 1 && mask[p + 1] === 1) { mask[p + 1] = 2; stack[top++] = p + 1; }
      if (y > 0 && mask[p - W] === 1) { mask[p - W] = 2; stack[top++] = p - W; }
      if (y < H - 1 && mask[p + W] === 1) { mask[p + W] = 2; stack[top++] = p + W; }
    }
    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;
    let letterLike =
      bh <= PIECE_MAX_LINES * lineH && !(bw > 3 * lineH && bh < lineH / 3) && !(bw > 2 * lineH && count > 0.85 * bw * bh);
    if (letterLike && bw > WIDE_PIECE_LINES * lineH) {
      let runs = 0;
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) if (mask[y * W + x] === 2 && (x === minX || mask[y * W + x - 1] !== 2)) runs++;
      }
      if (runs / bh < MIN_RUNS_PER_ROW) letterLike = false;
    }
    const id = letterLike ? boxes.length / 4 : -1;
    if (letterLike) boxes.push(minX, minY, maxX, maxY);
    const mark = letterLike ? 3 : 4;
    for (let m = 0; m < count; m++) {
      const p = members[m] as number;
      mask[p] = mark;
      piece[p] = id;
    }
  }
  for (let i = 0; i < mask.length; i++) mask[i] = mask[i] === 3 ? 1 : 0;
  return { mask, piece, boxes };
}

/** Sum of a summed-area table ((W+1) x (H+1)) over [x1,x2) x [y1,y2). */
function sumRect(S: Int32Array, W: number, x1: number, y1: number, x2: number, y2: number): number {
  const w = W + 1;
  return (S[y2 * w + x2] as number) - (S[y1 * w + x2] as number) - (S[y2 * w + x1] as number) + (S[y1 * w + x1] as number);
}

/** One padded box snapped onto its lettering (ignoring lettering inside `claimed`), or null to keep it as it is. */
function refineOne(img: DecodedImage, box: Rect, claimed: readonly Rect[] = []): Rect | null {
  const line = unpaddedLineBox(box);
  const w = line.x2 - line.x1;
  const h = line.y2 - line.y1;
  if (w < 2 || h < 2) return null;
  const rx = Math.min(SEARCH_X_MAX_PX, Math.round(SEARCH_X_FRACTION * w));
  const ry = Math.round(SEARCH_Y_FRACTION * h);
  const gx = Math.ceil(Math.max(GROW_X_FRACTION * w, GROW_X_LINES * h));
  const gy = Math.ceil(GROW_Y_FRACTION * h);
  const win: Rect = {
    x1: Math.max(0, line.x1 - rx - gx - 1),
    y1: Math.max(0, line.y1 - ry - gy - 1),
    x2: Math.min(img.width, line.x2 + rx + gx + 1),
    y2: Math.min(img.height, line.y2 + ry + gy + 1),
  };
  const W = win.x2 - win.x1;
  const H = win.y2 - win.y1;
  if (W < w || H < h) return null;
  // Muse's line box in window coordinates.
  const bx = line.x1 - win.x1;
  const by = line.y1 - win.y1;
  const { mask, piece, boxes } = letteringMask(img, win, h, { x1: bx, y1: by, x2: bx + w, y2: by + h });
  // Lettering another label's box already holds is not this label's.
  for (const c of claimed) {
    for (let y = Math.max(0, c.y1 - win.y1); y < Math.min(H, c.y2 - win.y1); y++) {
      for (let x = Math.max(0, c.x1 - win.x1); x < Math.min(W, c.x2 - win.x1); x++) {
        mask[y * W + x] = 0;
        piece[y * W + x] = -1;
      }
    }
  }
  // Stroke starts (ink whose left neighbour is not ink): lettering is a dense row of narrow strokes, about two per
  // letter on every row through it, so placements are scored by stroke starts rather than by raw ink. Edge cuts (ink
  // directly below ink): a placement whose top or bottom edge cuts through ink (letters cut in half, or a drawing the
  // box runs into) pays one per cut column, so the box settles where its lettering is whole.
  const T = new Int32Array((W + 1) * (H + 1));
  const C = new Int32Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let rowT = 0, rowC = 0;
    const r = y * W, o = (y + 1) * (W + 1) + 1, u = y * (W + 1) + 1;
    for (let x = 0; x < W; x++) {
      const i = r + x;
      if (mask[i] === 1) {
        if (x === 0 || mask[i - 1] === 0) rowT++;
        if (y > 0 && mask[i - W] === 1) rowC++;
      }
      T[o + x] = (T[u + x] as number) + rowT;
      C[o + x] = (C[u + x] as number) + rowC;
    }
  }
  let best = -Infinity, bestStrokes = 0, bestDx = 0, bestDy = 0, bestCost = Infinity;
  for (let dy = -ry; dy <= ry; dy++) {
    const y1 = by + dy, y2 = y1 + h;
    if (y1 < 0 || y2 > H) continue;
    for (let dx = -rx; dx <= rx; dx++) {
      const x1 = bx + dx, x2 = x1 + w;
      if (x1 < 0 || x2 > W) continue;
      const strokes = sumRect(T, W, x1, y1, x2, y2);
      const cut = (y1 > 0 ? sumRect(C, W, x1, y1, x2, y1 + 1) : 0) + (y2 < H ? sumRect(C, W, x1, y2, x2, y2 + 1) : 0);
      const score = strokes - cut;
      const cost = Math.abs(dx) + Math.abs(dy);
      if (score > best || (score === best && cost < bestCost)) {
        best = score;
        bestStrokes = strokes;
        bestDx = dx;
        bestDy = dy;
        bestCost = cost;
      }
    }
  }
  if (bestStrokes <= 0) return null;
  const x1 = bx + bestDx, x2 = x1 + w, y1 = by + bestDy, y2 = y1 + h;
  // The lettering of THIS line: pieces whose middle lies on the placed box's rows.
  const bandY1 = Math.max(0, y1 - gy), bandY2 = Math.min(H, y2 + gy);
  const onLine = new Uint8Array(boxes.length / 4);
  for (let k = 0; k < onLine.length; k++) {
    const centre = ((boxes[k * 4 + 1] as number) + (boxes[k * 4 + 3] as number) + 1) / 2;
    if (centre >= y1 && centre <= y2) onLine[k] = 1;
  }
  const L = new Int32Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let row = 0;
    const r = y * W, o = (y + 1) * (W + 1) + 1, u = y * (W + 1) + 1;
    for (let x = 0; x < W; x++) {
      const k = piece[r + x] as number;
      if (k >= 0 && onLine[k] === 1) row++;
      L[o + x] = (L[u + x] as number) + row;
    }
  }
  // Columns: the first to the last inked column inside the box, then outward across letter and word gaps no wider
  // than GAP_FRACTION of the line height, at most `gx` columns beyond the box on either side.
  const colInk = (x: number): number => sumRect(L, W, x, bandY1, x + 1, bandY2);
  let cx1 = -1, cx2 = -1;
  for (let x = x1; x < x2; x++) {
    if (colInk(x) > 0) {
      if (cx1 < 0) cx1 = x;
      cx2 = x + 1;
    }
  }
  if (cx1 < 0) return null;
  // The two sides share one budget of 2 gx (a box that sits at one end of its word grows further at the other end).
  const gap = Math.max(2, Math.round(GAP_FRACTION * h));
  const growRight = (limit: number): void => {
    for (let x = cx2, last = cx2 - 1; x < Math.min(W, limit) && x - last <= gap; x++) {
      if (colInk(x) > 0) { last = x; cx2 = x + 1; }
    }
  };
  const growLeft = (limit: number): void => {
    for (let x = cx1 - 1, last = cx1; x >= Math.max(0, limit) && last - x <= gap; x--) {
      if (colInk(x) > 0) { last = x; cx1 = x; }
    }
  };
  growLeft(x1 - gx);
  growRight(x2 + 2 * gx - Math.max(0, x1 - cx1));
  growLeft(x1 - (2 * gx - Math.max(0, cx2 - x2)));
  // Rows: the run of rows around the inkiest one (over those columns) whose ink stays above a small share of it,
  // at most `gy` rows beyond the placed box.
  const rowInk = (y: number): number => sumRect(L, W, cx1, y, cx2, y + 1);
  let peakY = y1, peak = 0;
  for (let y = y1; y < y2; y++) {
    const r = rowInk(y);
    if (r > peak) { peak = r; peakY = y; }
  }
  const rowMin = Math.max(1, ROW_SHARE * peak);
  let ty1 = peakY, ty2 = peakY + 1;
  while (ty1 > bandY1 && rowInk(ty1 - 1) >= rowMin) ty1--;
  while (ty2 < bandY2 && rowInk(ty2) >= rowMin) ty2++;
  const th = ty2 - ty1;
  if (th < MIN_KEEP * h || cx2 - cx1 < MIN_KEEP * w) return null; // a fragment, not the line Muse read
  // Pad by the taller of the inked rows and Muse's own line: thresholded ink misses the soft edges of the letters.
  return padded({ x1: cx1 + win.x1, y1: ty1 + win.y1, x2: cx2 + win.x1, y2: ty2 + win.y1 }, Math.max(th, h), img.width, img.height);
}

/** True when two boxes share at least COLLIDE_SHARE of the smaller one. */
function collides(a: Rect, b: Rect): boolean {
  const iw = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1);
  const ih = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1);
  if (iw <= 0 || ih <= 0) return false;
  const smaller = Math.min((a.x2 - a.x1) * (a.y2 - a.y1), (b.x2 - b.x1) * (b.y2 - b.y1));
  return iw * ih >= COLLIDE_SHARE * smaller;
}

function tryRefine(img: DecodedImage, box: Rect, claimed: readonly Rect[] = []): Rect | null {
  try {
    return refineOne(img, box, claimed);
  } catch {
    return null;
  }
}

/** refineLabelBoxes on an already decoded image. */
export function refineLabelBoxesInImage<T extends ReadLabelBox>(boxes: readonly T[], img: DecodedImage): T[] {
  const first = boxes.map(b => tryRefine(img, b));
  // Two labels never share their printed text. Boxes settle from the least moved to the most moved; a box that lands
  // mostly on a settled box is searched again with the settled lettering taken out, and stays where Muse put it when
  // that still collides or finds nothing.
  const moved = (i: number): number => {
    const r = first[i];
    const b = boxes[i] as T;
    return r === null || r === undefined ? 0 : Math.abs(r.x1 + r.x2 - b.x1 - b.x2) + Math.abs(r.y1 + r.y2 - b.y1 - b.y2);
  };
  const order = boxes.map((_, i) => i).sort((p, q) => moved(p) - moved(q) || p - q);
  const settled: Rect[] = [];
  const out: T[] = boxes.map(b => ({ ...b }));
  for (const i of order) {
    const b = boxes[i] as T;
    let r = first[i] ?? null;
    if (r !== null && settled.some(c => collides(r as Rect, c))) {
      r = tryRefine(img, b, settled);
      if (r !== null && settled.some(c => collides(r as Rect, c))) r = null;
    }
    if (r !== null) {
      out[i] = { ...b, x1: r.x1, y1: r.y1, x2: r.x2, y2: r.y2 };
      settled.push(r);
    }
  }
  return out;
}

/**
 * Snap every printed-label box (the padded pixel boxes of figureLabelsToBoxes) onto the printed text of a PNG image.
 * Same boxes back, same order, `text` and `group` kept, only the edges may change. When the PNG cannot be decoded
 * (or is not `width` x `height`) every box comes back unchanged; so does any box with no lettering in reach.
 */
export function refineLabelBoxes<T extends ReadLabelBox>(boxes: readonly T[], png: Uint8Array, width: number, height: number): T[] {
  return snapLabelBoxes(boxes, png, width, height).boxes;
}

/**
 * refineLabelBoxes plus what happened, for the worker's `method` line: `decoded` is false when the PNG could not be
 * decoded (or is not `width` x `height`), and then every box is unchanged; `moved` counts the boxes whose edges changed.
 */
export function snapLabelBoxes<T extends ReadLabelBox>(
  boxes: readonly T[],
  png: Uint8Array,
  width: number,
  height: number,
): { boxes: T[]; decoded: boolean; moved: number } {
  const img = decodePng(png);
  if (img === null || img.width !== width || img.height !== height) return { boxes: boxes.map(b => ({ ...b })), decoded: false, moved: 0 };
  const out = refineLabelBoxesInImage(boxes, img);
  const moved = out.filter((b, i) => {
    const o = boxes[i] as T;
    return b.x1 !== o.x1 || b.y1 !== o.y1 || b.x2 !== o.x2 || b.y2 !== o.y2;
  }).length;
  return { boxes: out, decoded: true, moved };
}
