// Teacher diagram (beta): the minimal PNG decoder behind the label-box snap (png-decode.ts). Tiny PNGs are built by hand
// here (zlib + CRC) so every supported colour type, every scanline filter, transparency and every refusal is pinned to
// known pixels: 8-bit colour types 0/2/3/4/6 decode to RGB on white; interlaced, 16-bit and malformed files give null.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { decodePng } from './png-decode.ts';

function crc32(bytes: Uint8Array): number {
  let c = ~0;
  for (const b of bytes) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Filter one scanline with the given PNG filter type (the encoder side of what the decoder undoes). */
function filterRow(f: number, row: Uint8Array, prev: Uint8Array | null, bpp: number): Uint8Array {
  const out = new Uint8Array(row.length);
  for (let i = 0; i < row.length; i++) {
    const a = i >= bpp ? (row[i - bpp] as number) : 0;
    const b = prev !== null ? (prev[i] as number) : 0;
    const c = prev !== null && i >= bpp ? (prev[i - bpp] as number) : 0;
    let pred = 0;
    if (f === 1) pred = a;
    else if (f === 2) pred = b;
    else if (f === 3) pred = (a + b) >> 1;
    else if (f === 4) {
      const p = a + b - c;
      const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
    }
    out[i] = ((row[i] as number) - pred) & 0xff;
  }
  return out;
}

interface PngSpec {
  width: number;
  height: number;
  colorType: number;
  bitDepth?: number;
  interlace?: number;
  /** Raw (unfiltered) samples, row-major. */
  samples: number[];
  /** Filter type per row (cycled); default 0. */
  filters?: number[];
  plte?: number[];
  trns?: number[];
  /** Split the compressed data over this many IDAT chunks. */
  idatParts?: number;
}

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function png(spec: PngSpec): Uint8Array {
  const bpp = CHANNELS[spec.colorType] as number;
  const stride = spec.width * bpp;
  const rows: Uint8Array[] = [];
  let prev: Uint8Array | null = null;
  for (let y = 0; y < spec.height; y++) {
    const row = Uint8Array.from(spec.samples.slice(y * stride, (y + 1) * stride));
    const f = spec.filters === undefined ? 0 : (spec.filters[y % spec.filters.length] as number);
    rows.push(Uint8Array.of(f), filterRow(f, row, prev, bpp));
    prev = row;
  }
  const z = deflateSync(Buffer.concat(rows));
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(spec.width, 0);
  ihdr.writeUInt32BE(spec.height, 4);
  ihdr[8] = spec.bitDepth ?? 8;
  ihdr[9] = spec.colorType;
  ihdr[12] = spec.interlace ?? 0;
  const parts = spec.idatParts ?? 1;
  const step = Math.ceil(z.length / parts);
  const idats: Buffer[] = [];
  for (let i = 0; i < parts; i++) idats.push(chunk('IDAT', z.subarray(i * step, Math.min(z.length, (i + 1) * step))));
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    ...(spec.plte !== undefined ? [chunk('PLTE', Uint8Array.from(spec.plte))] : []),
    ...(spec.trns !== undefined ? [chunk('tRNS', Uint8Array.from(spec.trns))] : []),
    ...idats,
    chunk('IEND', new Uint8Array()),
  ]);
}

const rgbOf = (img: { rgb: Uint8Array } | null): number[] => {
  assert.ok(img !== null, 'decoded');
  return [...img.rgb];
};

test('colour type 2 (RGB): exact pixels, row-major, 3 bytes per pixel', () => {
  const samples = [255, 0, 0, 0, 255, 0, 0, 0, 255, 10, 20, 30, 40, 50, 60, 70, 80, 90];
  const img = decodePng(png({ width: 3, height: 2, colorType: 2, samples }));
  assert.equal(img?.width, 3);
  assert.equal(img?.height, 2);
  assert.deepEqual(rgbOf(img), samples);
});

test('every scanline filter (None, Sub, Up, Average, Paeth) decodes to the same pixels, also split over several IDATs', () => {
  const W = 5, H = 5;
  const samples: number[] = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) samples.push((x * 53 + y * 17) & 255, (x * 7 + y * 91) & 255, (x * y * 29 + 200) & 255);
  for (const filters of [[0], [1], [2], [3], [4], [4, 3, 2, 1, 0], [2, 4, 1, 3, 4]]) {
    for (const idatParts of [1, 3]) {
      assert.deepEqual(rgbOf(decodePng(png({ width: W, height: H, colorType: 2, samples, filters, idatParts }))), samples, `filters ${filters} in ${idatParts} IDAT`);
    }
  }
  // RGBA with Paeth everywhere: bpp 4 changes which neighbour is "left"
  const rgba: number[] = [];
  for (let i = 0; i < W * H; i++) rgba.push((i * 37) & 255, (i * 11) & 255, (i * 3) & 255, 255);
  const want = rgba.filter((_, i) => i % 4 !== 3);
  assert.deepEqual(rgbOf(decodePng(png({ width: W, height: H, colorType: 6, samples: rgba, filters: [4, 1, 3] }))), want);
});

test('colour type 0 (grey) and 4 (grey + alpha, composited onto white)', () => {
  assert.deepEqual(rgbOf(decodePng(png({ width: 3, height: 1, colorType: 0, samples: [0, 128, 255] }))), [0, 0, 0, 128, 128, 128, 255, 255, 255]);
  // alpha 255 keeps the grey, alpha 0 is white, alpha 128 of black is about half grey
  const ga = decodePng(png({ width: 3, height: 1, colorType: 4, samples: [40, 255, 40, 0, 0, 128] }));
  assert.deepEqual(rgbOf(ga), [40, 40, 40, 255, 255, 255, 127, 127, 127]);
});

test('colour type 6 (RGBA): opaque pixels exact, transparent ones are white', () => {
  const img = decodePng(png({ width: 2, height: 1, colorType: 6, samples: [200, 10, 20, 255, 0, 0, 0, 0] }));
  assert.deepEqual(rgbOf(img), [200, 10, 20, 255, 255, 255]);
});

test('colour type 3 (palette): PLTE colours, tRNS alpha per index', () => {
  const plte = [255, 0, 0, 0, 255, 0, 0, 0, 255];
  assert.deepEqual(rgbOf(decodePng(png({ width: 3, height: 1, colorType: 3, samples: [2, 0, 1], plte }))), [0, 0, 255, 255, 0, 0, 0, 255, 0]);
  // index 1 fully transparent -> white; index 2 has no tRNS entry -> opaque
  assert.deepEqual(rgbOf(decodePng(png({ width: 3, height: 1, colorType: 3, samples: [0, 1, 2], plte, trns: [255, 0] }))), [255, 0, 0, 255, 255, 255, 0, 0, 255]);
});

test('refused (null): interlaced, 16-bit, 1-bit, unknown colour type, no PLTE for a palette, index outside the palette', () => {
  assert.equal(decodePng(png({ width: 2, height: 2, colorType: 2, interlace: 1, samples: new Array(12).fill(9) })), null);
  assert.equal(decodePng(png({ width: 1, height: 1, colorType: 2, bitDepth: 16, samples: [1, 2, 3] })), null);
  assert.equal(decodePng(png({ width: 1, height: 1, colorType: 0, bitDepth: 1, samples: [1] })), null);
  assert.equal(decodePng(png({ width: 1, height: 1, colorType: 5 as never, samples: [] })), null);
  assert.equal(decodePng(png({ width: 2, height: 1, colorType: 3, samples: [0, 1] })), null);
  assert.equal(decodePng(png({ width: 2, height: 1, colorType: 3, samples: [0, 7], plte: [1, 2, 3] })), null);
});

test('refused (null): not a PNG, a truncated file, an unknown filter byte, too little image data, no IDAT', () => {
  const good = png({ width: 2, height: 2, colorType: 2, samples: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] });
  assert.ok(decodePng(good) !== null);
  assert.equal(decodePng(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, ...good.subarray(4)])), null, 'JPEG magic');
  assert.equal(decodePng(good.subarray(0, good.length - 30)), null, 'truncated');
  assert.equal(decodePng(new Uint8Array()), null);
  // a filter byte of 7
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const head = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr)]);
  const end = chunk('IEND', new Uint8Array());
  assert.equal(decodePng(Buffer.concat([head, chunk('IDAT', deflateSync(Uint8Array.of(7, 1, 2, 3))), end])), null, 'filter 7');
  assert.equal(decodePng(Buffer.concat([head, chunk('IDAT', deflateSync(Uint8Array.of(0, 1))), end])), null, 'short data');
  assert.equal(decodePng(Buffer.concat([head, end])), null, 'no IDAT');
  assert.equal(decodePng(Buffer.concat([head, chunk('IDAT', Uint8Array.of(1, 2, 3, 4)), end])), null, 'not zlib');
});
