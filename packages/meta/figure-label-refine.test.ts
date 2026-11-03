// Teacher diagram (beta): figure-label-refine.ts snaps Muse's printed-label boxes onto the printed text using the image
// pixels. Synthetic images with "words" made of letter-like strokes pin the behaviour: an offset box moves onto its word
// and covers it; a box already on its word stays; boxes never jump onto drawn lines, bars or another label's word; a
// file that cannot be decoded leaves every box unchanged; text and group are kept.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { refineLabelBoxes, refineLabelBoxesInImage, snapLabelBoxes, unpaddedLineBox } from './figure-label-refine.ts';
import { figureLabelsToBoxes } from './figure-labels.ts';
import type { DecodedImage } from './png-decode.ts';

type RGB = [number, number, number];
interface Box { x1: number; y1: number; x2: number; y2: number; text?: string; group: number }

function canvas(width: number, height: number, bg: RGB = [255, 255, 255]): DecodedImage {
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) rgb.set(bg, i * 3);
  return { width, height, rgb };
}

function fill(img: DecodedImage, x1: number, y1: number, x2: number, y2: number, c: RGB): void {
  for (let y = Math.max(0, y1); y < Math.min(img.height, y2); y++) for (let x = Math.max(0, x1); x < Math.min(img.width, x2); x++) img.rgb.set(c, (y * img.width + x) * 3);
}

/**
 * A printed "word": `letters` glyphs of 9 x 14 px with 3 px spacing (n, o, h, e shapes in turn: several 2 px strokes
 * per row, like real lettering). Returns its ink bounding box.
 */
function word(img: DecodedImage, x: number, y: number, letters: number, c: RGB = [20, 20, 20]): Box {
  for (let i = 0; i < letters; i++) {
    const lx = x + i * 12;
    switch (i % 4) {
      case 0: // n
        fill(img, lx, y + 4, lx + 2, y + 14, c); fill(img, lx + 7, y + 4, lx + 9, y + 14, c); fill(img, lx, y + 4, lx + 9, y + 6, c);
        break;
      case 1: // o
        fill(img, lx, y + 4, lx + 9, y + 6, c); fill(img, lx, y + 12, lx + 9, y + 14, c); fill(img, lx, y + 4, lx + 2, y + 14, c); fill(img, lx + 7, y + 4, lx + 9, y + 14, c);
        break;
      case 2: // h (ascender)
        fill(img, lx, y, lx + 2, y + 14, c); fill(img, lx, y + 4, lx + 9, y + 6, c); fill(img, lx + 7, y + 4, lx + 9, y + 14, c);
        break;
      default: // e
        fill(img, lx, y + 4, lx + 9, y + 6, c); fill(img, lx, y + 8, lx + 9, y + 10, c); fill(img, lx, y + 12, lx + 9, y + 14, c); fill(img, lx, y + 4, lx + 2, y + 14, c);
    }
  }
  return { x1: x, y1: y, x2: x + (letters - 1) * 12 + 9, y2: y + 14, group: -1 };
}

/** The stored (padded) box of a Muse line box, exactly as figure-labels.ts pads it. */
function stored(x1: number, y1: number, x2: number, y2: number, group = 0, text: string | null = 'Label'): Box {
  const pad = Math.max(3, 0.3 * (y2 - y1));
  return { x1: Math.floor(x1 - pad), y1: Math.floor(y1 - pad), x2: Math.ceil(x2 + pad), y2: Math.ceil(y2 + pad), ...(text !== null ? { text } : {}), group };
}

const covers = (b: Box, ink: Box, margin = 1): boolean =>
  b.x1 <= ink.x1 - margin && b.y1 <= ink.y1 - margin && b.x2 >= ink.x2 + margin && b.y2 >= ink.y2 + margin;

function encodePng(img: DecodedImage): Uint8Array {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Uint8Array): number => {
    let c = ~0;
    for (const x of b) c = (crcTable[(c ^ x) & 0xff] as number) ^ (c >>> 8);
    return ~c >>> 0;
  };
  const chunk = (type: string, data: Uint8Array): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, c]);
  };
  const raw = Buffer.alloc(img.height * (1 + img.width * 3));
  for (let y = 0; y < img.height; y++) Buffer.from(img.rgb.subarray(y * img.width * 3, (y + 1) * img.width * 3)).copy(raw, y * (1 + img.width * 3) + 1);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.width, 0);
  ihdr.writeUInt32BE(img.height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array())]);
}

test('unpaddedLineBox undoes the figure-labels.ts padding (tall and short lines)', () => {
  for (const [y1, y2] of [[100, 120], [100, 108], [50, 90]] as const) {
    const r = figureLabelsToBoxes({ labels: [{ text: 'x', names_part: true, bbox: [{ x_min: 200, y_min: y1, x_max: 400, y_max: y2 }] }] }, 1000, 1000);
    const line = unpaddedLineBox(r!.boxes[0]!);
    assert.ok(Math.abs(line.x1 - 200) <= 1 && Math.abs(line.x2 - 400) <= 1, JSON.stringify(line));
    assert.ok(Math.abs(line.y1 - y1) <= 1 && Math.abs(line.y2 - y2) <= 1, JSON.stringify(line));
  }
});

test('a box shifted sideways off its word moves onto it and covers every letter, without ballooning', () => {
  for (const dx of [-35, -20, 20, 35]) {
    const img = canvas(420, 200);
    const ink = word(img, 140, 90, 9); // 105 x 14
    const box = stored(ink.x1 + dx, ink.y1 - 1, ink.x2 + dx, ink.y2 + 1, 3, 'Fuselage');
    const [r] = refineLabelBoxesInImage([box], img);
    assert.ok(covers(r!, ink), `dx ${dx}: ${JSON.stringify(r)} covers ${JSON.stringify(ink)}`);
    assert.equal(r!.text, 'Fuselage');
    assert.equal(r!.group, 3);
    // at most the line's own padding around the ink (30% of the line height, rounded outward) plus a pixel
    const slack = Math.ceil(0.3 * 16) + 2;
    assert.ok(r!.x1 >= ink.x1 - slack && r!.x2 <= ink.x2 + slack && r!.y1 >= ink.y1 - slack && r!.y2 <= ink.y2 + slack, `dx ${dx}: tight ${JSON.stringify(r)}`);
  }
});

test('a box that is a little low and short grows onto the whole word', () => {
  const img = canvas(420, 200);
  const ink = word(img, 100, 80, 12);
  // Muse's line: 10 px low (well under the word's top) and covering only the first two thirds of the word
  const box = stored(ink.x1 + 4, ink.y1 + 6, ink.x1 + 90, ink.y2 + 6);
  assert.ok(!covers(box, ink, 0), 'the stored box misses part of the word');
  const [r] = refineLabelBoxesInImage([box], img);
  assert.ok(covers(r!, ink), JSON.stringify(r));
});

test('a box already on its word stays (same place, still covering it)', () => {
  const img = canvas(420, 200);
  const ink = word(img, 140, 90, 9);
  const box = stored(ink.x1, ink.y1 - 1, ink.x2, ink.y2 + 1);
  const [r] = refineLabelBoxesInImage([box], img);
  assert.ok(covers(r!, ink));
  for (const k of ['x1', 'y1', 'x2', 'y2'] as const) assert.ok(Math.abs(r![k] - box[k]) <= 2, `${k}: ${r![k]} vs ${box[k]}`);
});

test('no jump onto drawing strokes: a long line, a diagonal leader line or a filled bar next to an empty box leave it unchanged', () => {
  const black: RGB = [0, 0, 0];
  const scenes: [string, (img: DecodedImage) => void][] = [
    ['horizontal line under the box', img => fill(img, 40, 116, 380, 118, black)],
    ['horizontal line through the box', img => fill(img, 40, 104, 380, 106, black)],
    ['vertical line beside the box', img => fill(img, 252, 30, 254, 190, black)],
    ['diagonal leader line', img => { for (let i = 0; i < 160; i++) fill(img, 120 + i, 40 + Math.floor(i / 2), 123 + i, 43 + Math.floor(i / 2), black); }],
    ['filled bar', img => fill(img, 190, 98, 300, 112, [200, 40, 40])],
    ['rectangle outline', img => { fill(img, 190, 96, 300, 98, black); fill(img, 190, 112, 300, 114, black); fill(img, 190, 96, 192, 114, black); fill(img, 298, 96, 300, 114, black); }],
  ];
  for (const [name, draw] of scenes) {
    const img = canvas(420, 200);
    draw(img);
    const box = stored(150, 98, 250, 112);
    const [r] = refineLabelBoxesInImage([box], img);
    assert.deepEqual(r, box, name);
  }
});

test('a word next to a long stroke: the box snaps onto the word, never stretched over the stroke', () => {
  const img = canvas(420, 200);
  const ink = word(img, 150, 90, 8);
  fill(img, 20, 110, 400, 112, [0, 0, 0]); // a rule 6 px under the word
  fill(img, 100, 60, 102, 180, [0, 0, 0]); // a vertical stroke left of it
  const box = stored(ink.x1 - 30, ink.y1, ink.x2 - 30, ink.y2);
  const [r] = refineLabelBoxesInImage([box], img);
  assert.ok(covers(r!, ink), JSON.stringify(r));
  assert.ok(r!.x1 > 102 && r!.x2 - r!.x1 < 140, `not stretched sideways: ${JSON.stringify(r)}`);
});

test('pale lettering on a coloured ground and dark lettering on a coloured shape are found (local background)', () => {
  const pale = canvas(420, 200, [190, 220, 235]);
  const paleInk = word(pale, 140, 90, 8, [250, 250, 250]);
  const [a] = refineLabelBoxesInImage([stored(paleInk.x1 + 30, paleInk.y1, paleInk.x2 + 30, paleInk.y2)], pale);
  assert.ok(covers(a!, paleInk), JSON.stringify(a));
  // a word printed on an orange blob that sits on a grey ground (the window's overall median is neither)
  const blob = canvas(420, 200, [150, 150, 150]);
  fill(blob, 110, 40, 330, 170, [250, 200, 40]);
  const blobInk = word(blob, 150, 95, 6);
  const [b] = refineLabelBoxesInImage([stored(blobInk.x1 + 25, blobInk.y1, blobInk.x2 + 25, blobInk.y2)], blob);
  assert.ok(covers(b!, blobInk), JSON.stringify(b));
});

test('two labels never share one printed word: the box that moved more stays where Muse put it', () => {
  const img = canvas(420, 200);
  const ink = word(img, 140, 90, 6);
  const onIt = stored(ink.x1, ink.y1, ink.x2, ink.y2, 0, 'Wing');
  const beside = stored(ink.x2 + 15, ink.y1, ink.x2 + 15 + (ink.x2 - ink.x1), ink.y2, 1, 'Flaps'); // empty space to the right
  const out = refineLabelBoxesInImage([onIt, beside], img);
  assert.ok(covers(out[0]!, ink));
  assert.deepEqual(out[1], beside, 'the second box does not move onto the first label');
});

test('several boxes: order, text and group kept; a line box without text stays without text', () => {
  const img = canvas(420, 240);
  const a = word(img, 40, 40, 6);
  const b = word(img, 220, 40, 5);
  const c = word(img, 40, 150, 8);
  const boxes = [stored(a.x1 + 20, a.y1, a.x2 + 20, a.y2, 0, 'Sugar'), stored(b.x1 - 15, b.y1, b.x2 - 15, b.y2, 1, 'Base'), stored(c.x1, c.y1 + 3, c.x2, c.y2 + 3, 1, null)];
  const out = refineLabelBoxesInImage(boxes, img);
  assert.deepEqual(out.map(o => [o.text, o.group]), [['Sugar', 0], ['Base', 1], [undefined, 1]]);
  assert.ok(!('text' in out[2]!));
  assert.ok(covers(out[0]!, a) && covers(out[1]!, b) && covers(out[2]!, c), JSON.stringify(out));
});

test('through the PNG bytes: refineLabelBoxes decodes and snaps; snapLabelBoxes says so and counts the moved boxes', () => {
  const img = canvas(300, 160);
  const ink = word(img, 100, 70, 8);
  const box = stored(ink.x1 - 25, ink.y1, ink.x2 - 25, ink.y2);
  const bytes = encodePng(img);
  const [r] = refineLabelBoxes([box], bytes, 300, 160);
  assert.ok(covers(r!, ink));
  const s = snapLabelBoxes([box, stored(10, 140, 40, 150)], bytes, 300, 160);
  assert.equal(s.decoded, true);
  assert.equal(s.moved, 1, 'the box with no lettering in reach is unchanged');
});

test('decode failure, or an image of another size, leaves every box unchanged', () => {
  const img = canvas(300, 160);
  const ink = word(img, 100, 70, 8);
  const boxes = [stored(ink.x1 - 25, ink.y1, ink.x2 - 25, ink.y2, 0, 'Wing'), stored(5, 5, 50, 15, 1, 'Title')];
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0]);
  for (const [bytes, w, h, name] of [
    [jpeg, 300, 160, 'JPEG bytes'],
    [new Uint8Array(), 300, 160, 'empty'],
    [encodePng(img).subarray(0, 60), 300, 160, 'truncated PNG'],
    [encodePng(img), 301, 160, 'another width'],
  ] as const) {
    assert.deepEqual(refineLabelBoxes(boxes, bytes, w, h), boxes, name);
    const s = snapLabelBoxes(boxes, bytes, w, h);
    assert.equal(s.decoded, false, name);
    assert.equal(s.moved, 0);
  }
  assert.deepEqual(refineLabelBoxes([], encodePng(img), 300, 160), []);
});

test('fast enough: a 1600 x 1600 PNG with 60 label boxes', () => {
  const img = canvas(1600, 1600, [235, 240, 250]);
  const boxes: Box[] = [];
  for (let i = 0; i < 60; i++) {
    const x = 60 + (i % 6) * 250, y = 40 + Math.floor(i / 6) * 150;
    const ink = word(img, x, y, 10);
    fill(img, x - 20, y + 30, x + 200, y + 33, [30, 30, 30]); // a rule under every label
    boxes.push(stored(ink.x1 + ((i % 5) - 2) * 12, ink.y1 + ((i % 3) - 1) * 3, ink.x2 + ((i % 5) - 2) * 12, ink.y2 + ((i % 3) - 1) * 3, i, `L${i}`));
  }
  const bytes = encodePng(img);
  const t0 = performance.now();
  const out = refineLabelBoxes(boxes, bytes, 1600, 1600);
  const ms = performance.now() - t0;
  assert.equal(out.length, 60);
  assert.ok(ms < 3000, `took ${ms.toFixed(0)} ms`); // measured well under 1 s; generous here so a busy machine never flakes
});
