// Teacher diagram (beta): a minimal PNG decoder (node:zlib only, no image library) so the worker can look at the pixels
// of a teacher figure and snap Muse's printed-label boxes onto the printed text (figure-label-refine.ts). The web app
// re-encodes every teacher image as an 8-bit PNG through a canvas, so only what such a file can be is supported:
// bit depth 8, colour types 0 (grey), 2 (RGB), 3 (palette, PLTE + optional tRNS), 4 (grey + alpha), 6 (RGBA), not
// interlaced. Anything else, and any malformed file, returns null (the caller then keeps its boxes as they are).
import { inflateSync } from 'node:zlib';

/** A decoded image: `rgb` holds 3 bytes per pixel, row-major, alpha already composited onto white. */
export interface DecodedImage {
  width: number;
  height: number;
  rgb: Uint8Array;
}

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
/** Bytes per pixel for each supported colour type at bit depth 8. */
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
/** Never inflate more than this many pixels (a 4096 x 4096 upload is the API's own limit). */
const MAX_PIXELS = 4096 * 4096;

function u32(b: Uint8Array, o: number): number {
  return ((b[o] as number) * 0x1000000 + (((b[o + 1] as number) << 16) | ((b[o + 2] as number) << 8) | (b[o + 3] as number))) >>> 0;
}

/** Undo the per-scanline filters (0 None, 1 Sub, 2 Up, 3 Average, 4 Paeth); null on an unknown filter type. */
function unfilter(raw: Uint8Array, width: number, height: number, bpp: number): Uint8Array | null {
  const stride = width * bpp;
  const out = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)] as number;
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    const up = dst - stride; // the previous row (absent on row 0: treated as zeros)
    const first = y === 0;
    switch (f) {
      case 0:
        out.set(raw.subarray(src, src + stride), dst);
        break;
      case 1:
        for (let i = 0; i < stride; i++) out[dst + i] = ((raw[src + i] as number) + (i >= bpp ? (out[dst + i - bpp] as number) : 0)) & 0xff;
        break;
      case 2:
        if (first) out.set(raw.subarray(src, src + stride), dst);
        else for (let i = 0; i < stride; i++) out[dst + i] = ((raw[src + i] as number) + (out[up + i] as number)) & 0xff;
        break;
      case 3:
        for (let i = 0; i < stride; i++) {
          const a = i >= bpp ? (out[dst + i - bpp] as number) : 0;
          const b = first ? 0 : (out[up + i] as number);
          out[dst + i] = ((raw[src + i] as number) + ((a + b) >> 1)) & 0xff;
        }
        break;
      case 4:
        // Paeth. Left of the first pixel a = c = 0 (the predictor is then b); on row 0 b = c = 0 (it is then a).
        for (let i = 0; i < stride; i++) {
          const a = i >= bpp ? (out[dst + i - bpp] as number) : 0;
          if (first || i < bpp) {
            out[dst + i] = ((raw[src + i] as number) + (first ? a : (out[up + i] as number))) & 0xff;
            continue;
          }
          const b = out[up + i] as number;
          const c = out[up + i - bpp] as number;
          const p = a + b - c;
          const pa = p > a ? p - a : a - p;
          const pb = p > b ? p - b : b - p;
          const pc = p > c ? p - c : c - p;
          out[dst + i] = ((raw[src + i] as number) + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
        }
        break;
      default:
        return null;
    }
  }
  return out;
}

/** Decode an 8-bit, non-interlaced PNG of colour type 0/2/3/4/6 into RGB on white; null for anything else. */
export function decodePng(bytes: Uint8Array): DecodedImage | null {
  try {
    if (bytes.length < 8 + 25 || SIGNATURE.some((v, i) => bytes[i] !== v)) return null;
    let o = 8;
    let width = 0, height = 0, colorType = -1;
    let palette: Uint8Array | null = null;
    let paletteAlpha: Uint8Array | null = null;
    let keyGrey = -1;
    let keyRgb: [number, number, number] | null = null;
    const idat: Uint8Array[] = [];
    let first = true;
    while (o + 8 <= bytes.length) {
      const len = u32(bytes, o);
      const type = String.fromCharCode(bytes[o + 4] as number, bytes[o + 5] as number, bytes[o + 6] as number, bytes[o + 7] as number);
      const data = o + 8;
      if (data + len + 4 > bytes.length) return null;
      const chunk = bytes.subarray(data, data + len);
      if (first) {
        // IHDR must come first: width, height, bit depth, colour type, compression, filter, interlace.
        if (type !== 'IHDR' || len !== 13) return null;
        width = u32(chunk, 0);
        height = u32(chunk, 4);
        colorType = chunk[9] as number;
        if (chunk[8] !== 8 || CHANNELS[colorType] === undefined || chunk[10] !== 0 || chunk[11] !== 0 || chunk[12] !== 0) return null;
        if (width === 0 || height === 0 || width * height > MAX_PIXELS) return null;
        first = false;
      } else if (type === 'PLTE') {
        if (len % 3 !== 0 || len === 0) return null;
        palette = chunk.slice();
      } else if (type === 'tRNS') {
        if (colorType === 3) paletteAlpha = chunk.slice();
        else if (colorType === 0 && len >= 2) keyGrey = ((chunk[0] as number) << 8) | (chunk[1] as number);
        else if (colorType === 2 && len >= 6) keyRgb = [((chunk[0] as number) << 8) | (chunk[1] as number), ((chunk[2] as number) << 8) | (chunk[3] as number), ((chunk[4] as number) << 8) | (chunk[5] as number)];
      } else if (type === 'IDAT') {
        idat.push(chunk);
      } else if (type === 'IEND') {
        break;
      }
      o = data + len + 4; // skip the CRC
    }
    if (first || idat.length === 0) return null;
    if (colorType === 3 && palette === null) return null;
    const bpp = CHANNELS[colorType] as number;
    const expected = height * (1 + width * bpp);
    const raw = new Uint8Array(inflateSync(Buffer.concat(idat), { maxOutputLength: expected }));
    if (raw.length !== expected) return null;
    const px = unfilter(raw, width, height, bpp);
    if (px === null) return null;
    const rgb = new Uint8Array(width * height * 3);
    const n = width * height;
    // Alpha composited onto white: a transparent background reads as the white page it is shown on.
    const put = (i: number, r: number, g: number, b: number, a: number): void => {
      const k = i * 3;
      if (a === 255) {
        rgb[k] = r; rgb[k + 1] = g; rgb[k + 2] = b;
      } else {
        const w = 255 * (255 - a);
        rgb[k] = Math.round((r * a + w) / 255);
        rgb[k + 1] = Math.round((g * a + w) / 255);
        rgb[k + 2] = Math.round((b * a + w) / 255);
      }
    };
    if (colorType === 2 && keyRgb === null) {
      rgb.set(px);
    } else if (colorType === 6) {
      for (let i = 0, s = 0, k = 0; i < n; i++, s += 4, k += 3) {
        const a = px[s + 3] as number;
        if (a === 255) {
          rgb[k] = px[s] as number; rgb[k + 1] = px[s + 1] as number; rgb[k + 2] = px[s + 2] as number;
        } else {
          put(i, px[s] as number, px[s + 1] as number, px[s + 2] as number, a);
        }
      }
    } else {
      for (let i = 0; i < n; i++) {
        const s = i * bpp;
        switch (colorType) {
          case 0: { const v = px[s] as number; put(i, v, v, v, v === keyGrey ? 0 : 255); break; }
          case 2: {
            const r = px[s] as number, g = px[s + 1] as number, b = px[s + 2] as number;
            put(i, r, g, b, keyRgb !== null && keyRgb[0] === r && keyRgb[1] === g && keyRgb[2] === b ? 0 : 255);
            break;
          }
          case 3: {
            const p = px[s] as number;
            const pal = palette as Uint8Array;
            if (p * 3 + 2 >= pal.length) return null; // index outside the palette: a broken file
            put(i, pal[p * 3] as number, pal[p * 3 + 1] as number, pal[p * 3 + 2] as number, paletteAlpha !== null && p < paletteAlpha.length ? (paletteAlpha[p] as number) : 255);
            break;
          }
          case 4: { const v = px[s] as number; put(i, v, v, v, px[s + 1] as number); break; }
          default: put(i, px[s] as number, px[s + 1] as number, px[s + 2] as number, px[s + 3] as number);
        }
      }
    }
    return { width, height, rgb };
  } catch {
    return null;
  }
}
