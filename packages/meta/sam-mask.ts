// Stage 8c Addendum B: where a part's number goes. SAM's mask says which pixels ARE the part; the number sits on one of them.
//
// The point is the mask's INK pixel nearest the mask's centroid (all pieces together). For a part drawn as several pieces
// (five evaporation arrows) the centroid lies between the pieces, so a raw centroid would put the number on empty land;
// the nearest ink pixel puts it on one arrow. The mask is a box-local raster (see sam-outline.ts): row r, column c is the
// image pixel (box.x1 + c, box.y1 + r), the unit square [x, x+1) x [y, y+1); its centre is at +0.5.
//
// The result is on the frozen 0..1000 grid (x, y integers) because that is what the gen stores and the checks read. One
// grid unit can be wider than a pixel (572 px wide: 0.57 px per unit), so a candidate whose rounded grid point maps back
// onto an EMPTY pixel is skipped for the next nearest ink pixel; and when an `within` area (0..1000, edges inclusive) is
// given, a candidate inside it is preferred, so the placed number also passes "the point lies inside its own area".
// A SAM mask can include printed words that sit on or beside the drawing (the water cycle's rain mask covers the word
// "Precipitation"); `avoid(x, y)` (grid point, true = on printed text) keeps the number off them, the rule LD-04 enforces.
// Preference, best first, among candidates in nearest-to-the-centroid order:
//   round-trips onto ink AND off printed text AND inside the area
//   > round-trips AND off printed text > round-trips AND inside the area > round-trips > the nearest ink pixel.
// Ties break to the top-most, then left-most pixel, so the result is deterministic. Pure; never throws.
import { decodeMaskToRaster } from '@meta-sam/parser';
import type { SamMask } from './sam.ts';

/** The frozen normalised grid the gen's coordinates use. */
export const PLACEMENT_GRID = 1000;

/** A row-major 0/1 raster. */
export interface InkRaster {
  width: number;
  height: number;
  data: ArrayLike<number>;
}

export interface MaskOrigin {
  /** Image pixel of the raster's top-left cell (the SAM record's box x1, y1). */
  x1: number;
  y1: number;
}

export interface MaskBox extends MaskOrigin {
  x2: number;
  y2: number;
}

export interface InkPlacementOptions {
  imageWidth: number;
  imageHeight: number;
  /** Optional area on the 0..1000 grid (edges inclusive) the point should also lie inside. */
  within?: { x1: number; y1: number; x2: number; y2: number };
  /** Optional: true when the grid point (integers 0..1000) lies on printed text, which the number must stay off. */
  avoid?: (x: number, y: number) => boolean;
  /** Optional: Muse's own point (0..1000). It is kept unchanged when it already lies on this ink, inside the area and
   * off printed text, so the system only moves a number Muse placed wrongly. */
  keep?: { x: number; y: number };
}

export interface InkPlacement {
  /** The point on the 0..1000 grid (integers). */
  x: number;
  y: number;
  /** The ink pixel chosen, in image pixels (its top-left corner; the point is its centre). */
  px: number;
  py: number;
}

/** Decodes a SAM mask into a box-local 0/1 raster; null when it does not belong to the box or cannot be decoded. */
export function maskToRaster(mask: SamMask, box: MaskBox): InkRaster | null {
  try {
    if (![box.x1, box.y1, box.x2, box.y2].every(Number.isInteger)) return null;
    if (mask.width !== box.x2 - box.x1 + 1 || mask.height !== box.y2 - box.y1 + 1 || mask.width < 1 || mask.height < 1) return null;
    // The payload keeps its marker (`~` lossless, `!` one_bit); a marker that disagrees with the encoding is a corrupt record.
    const marker: string = mask.payload.charAt(0);
    if ((mask.encoding === 'lossless' && marker !== '~') || (mask.encoding === 'one_bit' && marker !== '!')) return null;
    const data = decodeMaskToRaster({ encoding: mask.encoding, payload: mask.payload, width: mask.width, height: mask.height });
    if (data.length !== mask.width * mask.height) return null;
    return { width: mask.width, height: mask.height, data };
  } catch {
    return null;
  }
}

const clampUnit = (v: number): number => Math.max(0, Math.min(PLACEMENT_GRID, Math.round(v)));

/** The ink pixel nearest the raster's centroid on the 0..1000 grid; null when the raster has no ink or the image size is unusable. */
export function placeOnInk(raster: InkRaster, origin: MaskOrigin, options: InkPlacementOptions): InkPlacement | null {
  const { imageWidth, imageHeight, within, avoid } = options;
  if (!(Number.isFinite(imageWidth) && imageWidth > 0 && Number.isFinite(imageHeight) && imageHeight > 0)) return null;
  const { width, height, data } = raster;
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      if (data[r * width + c] === 1) {
        sx += c + 0.5;
        sy += r + 0.5;
        n++;
      }
    }
  }
  if (n === 0) return null;
  const cx = sx / n;
  const cy = sy / n;
  const ink: Array<{ r: number; c: number; d: number }> = [];
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      if (data[r * width + c] === 1) ink.push({ r, c, d: (c + 0.5 - cx) ** 2 + (r + 0.5 - cy) ** 2 });
    }
  }
  // Row-major scan order already is top-most then left-most; a stable sort on distance keeps that for ties.
  ink.sort((a, b) => a.d - b.d);

  const toPlacement = (p: { r: number; c: number }): InkPlacement => {
    const px = origin.x1 + p.c;
    const py = origin.y1 + p.r;
    return {
      x: clampUnit(((px + 0.5) / imageWidth) * PLACEMENT_GRID),
      y: clampUnit(((py + 0.5) / imageHeight) * PLACEMENT_GRID),
      px,
      py,
    };
  };
  /** True when the grid point maps back (as the checks and the view do: x * width / 1000) onto an ink pixel of this raster. */
  const roundTripsOntoInk = (pl: InkPlacement): boolean => {
    const c = Math.floor((pl.x * imageWidth) / PLACEMENT_GRID) - origin.x1;
    const r = Math.floor((pl.y * imageHeight) / PLACEMENT_GRID) - origin.y1;
    return c >= 0 && r >= 0 && c < width && r < height && data[r * width + c] === 1;
  };
  const insideArea = (pl: InkPlacement): boolean =>
    within === undefined || (within.x1 <= pl.x && pl.x <= within.x2 && within.y1 <= pl.y && pl.y <= within.y2);

  const keep = options.keep;
  if (keep !== undefined && Number.isInteger(keep.x) && Number.isInteger(keep.y)) {
    const own: InkPlacement = {
      x: keep.x,
      y: keep.y,
      px: Math.floor((keep.x * imageWidth) / PLACEMENT_GRID),
      py: Math.floor((keep.y * imageHeight) / PLACEMENT_GRID),
    };
    if (roundTripsOntoInk(own) && insideArea(own) && (avoid === undefined || !avoid(own.x, own.y))) return own;
  }

  // Tier 0 (all three) is returned at once; otherwise the first candidate of the best tier seen wins.
  const tiers: Array<InkPlacement | null> = [null, null, null]; // off text only, inside area only, round-trip only
  for (const candidate of ink) {
    const pl = toPlacement(candidate);
    if (!roundTripsOntoInk(pl)) continue;
    const offText = avoid === undefined || !avoid(pl.x, pl.y);
    const inArea = insideArea(pl);
    if (offText && inArea) return pl;
    if (offText) tiers[0] ??= pl;
    else if (inArea) tiers[1] ??= pl;
    else tiers[2] ??= pl;
  }
  return tiers[0] ?? tiers[1] ?? tiers[2] ?? toPlacement(ink[0] as { r: number; c: number });
}

/** `maskToRaster` then `placeOnInk`: null when the mask is unusable or has no ink. */
export function placeOnMask(mask: SamMask, box: MaskBox, options: InkPlacementOptions): InkPlacement | null {
  const raster = maskToRaster(mask, box);
  return raster === null ? null : placeOnInk(raster, box, options);
}
