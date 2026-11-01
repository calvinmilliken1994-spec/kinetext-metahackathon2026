// Stage 8c slice S: maskToOutline on the REAL stored SAM masks (docs/evidence/sam-mask-probe and sam-prompt-probe).
// The mask is decoded with Meta's @meta-sam/parser; the checks never trust the helper's own geometry: the outline path
// is parsed back, bounds-checked against the SAM box, rasterised (even-odd, pixel centres) and compared with the decoded mask.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeMaskToRaster } from '@meta-sam/parser';
import { parseSamOutput } from './sam.ts';
import type { SamBox } from './sam.ts';
import { maskToOutline, OUTLINE_MAX_CHARS } from './sam-outline.ts';

const EVIDENCE = new URL('../../docs/evidence/', import.meta.url);
const read = (rel: string): SamBox[] => parseSamOutput(readFileSync(new URL(rel, EVIDENCE), 'utf8'));

const MASK_PROBE = read('sam-mask-probe/raw-output.txt'); // five parts of the NOAA water cycle, ids 1..5
const PROMPT_VARIANTS: Array<[string, SamBox]> = [
  'raw-wideBox.txt',
  'raw-boxAroundArrows.txt',
  'raw-fourPointsOnArrows.txt',
  'raw-onePointOnArrow.txt',
  'raw-wideBoxPlusPoint.txt',
].map((f): [string, SamBox] => [f, read(`sam-prompt-probe/${f}`)[0] as SamBox]);

const NAMES = ['evaporation', 'transpiration', 'condensation', 'precipitation', 'runoff'];
const ALL: Array<[string, SamBox]> = [
  ...MASK_PROBE.map((b, i): [string, SamBox] => [`mask-probe ${NAMES[i]} (c=${b.confidence?.toFixed(2)})`, b]),
  ...PROMPT_VARIANTS,
];

type Pt = [number, number];

function parsePath(path: string): Pt[][] {
  assert.match(path, /^M[-0-9. ]+(L[-0-9. ]+)*Z(M[-0-9. ]+(L[-0-9. ]+)*Z)*$/, 'path grammar: M x y L x y ... Z per ring');
  const rings: Pt[][] = [];
  for (const ringText of path.split('Z').filter((t) => t !== '')) {
    rings.push(
      ringText
        .split(/[ML]/)
        .filter((t) => t !== '')
        .map((t): Pt => {
          const [x, y] = t.split(' ').map(Number);
          return [x as number, y as number];
        }),
    );
  }
  return rings;
}

/** Even-odd fill of the path at every image pixel centre; returns a Set of "x,y" keys. */
function rasterise(rings: Pt[][], x1: number, y1: number, x2: number, y2: number): Set<string> {
  const on = new Set<string>();
  for (let y = y1; y <= y2; y++) {
    const cy = y + 0.5;
    for (let x = x1; x <= x2; x++) {
      const cx = x + 0.5;
      let inside = false;
      for (const ring of rings) {
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const [xi, yi] = ring[i] as Pt;
          const [xj, yj] = ring[j] as Pt;
          if (yi > cy !== yj > cy && cx < ((xj - xi) * (cy - yi)) / (yj - yi) + xi) {
            inside = !inside;
          }
        }
      }
      if (inside) {
        on.add(`${x},${y}`);
      }
    }
  }
  return on;
}

function maskPixels(b: SamBox): Set<string> {
  const mask = b.mask;
  assert.ok(mask !== undefined);
  const raster = decodeMaskToRaster(mask);
  const on = new Set<string>();
  for (let r = 0; r < mask.height; r++) {
    for (let c = 0; c < mask.width; c++) {
      if (raster[r * mask.width + c] === 1) {
        on.add(`${b.x1 + c},${b.y1 + r}`);
      }
    }
  }
  return on;
}

function iou(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const k of a) {
    if (b.has(k)) {
      inter += 1;
    }
  }
  return inter / (a.size + b.size - inter);
}

describe('maskToOutline on real SAM masks', (): void => {
  it('the mask-probe fixtures are the five stored parts (ids, boxes, confidences)', (): void => {
    assert.deepEqual(MASK_PROBE.map((b) => b.id), [1, 2, 3, 4, 5]);
    const runoff = MASK_PROBE[4] as SamBox;
    assert.deepEqual([runoff.x1, runoff.y1, runoff.x2, runoff.y2], [322, 332, 351, 362]);
    assert.ok(runoff.confidence !== null && Math.abs(runoff.confidence - 0.93) < 0.005);
  });

  for (const [name, b] of ALL) {
    describe(name, (): void => {
      const box = { x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2 };
      const path = maskToOutline(b.mask as NonNullable<SamBox['mask']>, box);

      it('is a non-empty path under the 6000-character limit', (): void => {
        assert.ok(path !== null);
        assert.ok(path.length > 0 && path.length <= OUTLINE_MAX_CHARS, `length ${path.length}`);
        parsePath(path);
      });

      it('lies inside the SAM box (image pixels, right/bottom edge = x2+1/y2+1) on a 0.5 px grid', (): void => {
        assert.ok(path !== null);
        for (const ring of parsePath(path)) {
          assert.ok(ring.length >= 3);
          for (const [x, y] of ring) {
            assert.ok(x >= box.x1 && x <= box.x2 + 1 && y >= box.y1 && y <= box.y2 + 1, `(${x},${y}) outside the box`);
            assert.equal(x * 2, Math.round(x * 2));
            assert.equal(y * 2, Math.round(y * 2));
          }
        }
      });

      it('covers the decoded mask: IoU of the filled path against the raster', (): void => {
        assert.ok(path !== null);
        const got = iou(rasterise(parsePath(path), b.x1, b.y1, b.x2, b.y2), maskPixels(b));
        // Even the scattered 0.28 evaporation region (51 pieces, cut to its 12 largest rings) clears this.
        const bar = 0.8;
        assert.ok(got > bar, `IoU ${got.toFixed(3)} (bar ${bar})`);
      });
    });
  }

  it('sample lengths and IoU (printed for the report)', (): void => {
    const lines = ALL.map(([name, b]) => {
      const p = maskToOutline(b.mask as NonNullable<SamBox['mask']>, b);
      const q = p === null ? 'n/a' : iou(rasterise(parsePath(p), b.x1, b.y1, b.x2, b.y2), maskPixels(b)).toFixed(3);
      return `${name}: ${p?.length ?? 'null'} chars, IoU ${q}`;
    });
    console.log(lines.join('\n'));
    assert.equal(lines.length, 10);
  });

  it('the runoff mask (id 5, box 322,332..351,362) traces the small arrow in a few hundred characters', (): void => {
    const b = MASK_PROBE[4] as SamBox;
    const path = maskToOutline(b.mask as NonNullable<SamBox['mask']>, b);
    assert.ok(path !== null);
    assert.equal(parsePath(path).length, 1, 'one ring');
    assert.ok(path.length < 700, `length ${path.length}`);
    const xs = parsePath(path)[0]?.map((p) => p[0]) as number[];
    const ys = parsePath(path)[0]?.map((p) => p[1]) as number[];
    assert.ok(Math.min(...xs) >= 322 && Math.max(...xs) <= 352 && Math.min(...ys) >= 332 && Math.max(...ys) <= 363);
  });

  it('is deterministic', (): void => {
    const b = MASK_PROBE[2] as SamBox;
    assert.equal(maskToOutline(b.mask!, b), maskToOutline(b.mask!, b));
  });

  it('a tight character limit drops the smallest rings first and returns null when even the largest ring does not fit', (): void => {
    const b = PROMPT_VARIANTS[2]?.[1] as SamBox; // fourPointsOnArrows: 9 pieces
    const full = maskToOutline(b.mask!, b, { maxChars: 6000 });
    assert.ok(full !== null);
    const fullRings = parsePath(full);
    assert.ok(fullRings.length >= 3);
    const ringTexts = full.split('Z').filter((t) => t !== '').map((t) => `${t}Z`);
    // Room for the first two rings only: the result is exactly those, in the same order (largest first).
    const limit = (ringTexts[0] as string).length + (ringTexts[1] as string).length + 3;
    const cut = maskToOutline(b.mask!, b, { maxChars: limit });
    assert.ok(cut !== null && cut.length <= limit);
    assert.equal(cut, (ringTexts[0] as string) + (ringTexts[1] as string));
    assert.ok(parsePath(cut).length < fullRings.length);
    // Rings come largest first.
    const areas = fullRings.map((ring) => ring.reduce((s, p, i) => {
      const q = ring[(i + 1) % ring.length] as Pt;
      return s + (p[0] * q[1] - q[0] * p[1]);
    }, 0) / 2).map(Math.abs);
    assert.deepEqual([...areas].sort((x, y) => y - x), areas);
    // The cap never exceeds the frozen 6000 even when asked for more.
    assert.equal(maskToOutline(b.mask!, b, { maxChars: 10 ** 9 }), full);
    assert.equal(maskToOutline(b.mask!, b, { maxChars: 40 }), null);
  });

  it('returns null when decoding throws or the mask does not belong to the box', (): void => {
    const b = MASK_PROBE[4] as SamBox;
    const mask = b.mask as NonNullable<SamBox['mask']>;
    const box = { x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2 };
    assert.equal(maskToOutline({ ...mask, payload: '~not a payload' }, box), null);
    assert.equal(maskToOutline({ ...mask, payload: 'no marker' }, box), null);
    assert.equal(maskToOutline({ ...mask, payload: '' }, box), null);
    assert.equal(maskToOutline({ ...mask, encoding: 'one_bit' }, box), null, 'payload marker disagrees with the declared encoding');
    assert.equal(maskToOutline({ ...mask, width: mask.width + 1 }, box), null, 'width does not match the box');
    assert.equal(maskToOutline({ ...mask, height: mask.height - 1 }, box), null, 'height does not match the box');
    assert.equal(maskToOutline(mask, { ...box, x2: box.x2 + 3 }), null, 'box does not match the mask');
    assert.equal(maskToOutline(mask, { x1: 5, y1: 5, x2: 2, y2: 9 }), null);
    assert.ok(maskToOutline(mask, box) !== null, 'the untouched pair still works');
  });

  it('offsets by the box origin: the same mask on a shifted box shifts every coordinate', (): void => {
    const b = MASK_PROBE[4] as SamBox;
    const a = maskToOutline(b.mask!, b) as string;
    const shifted = maskToOutline(b.mask!, { x1: b.x1 + 100, y1: b.y1 + 50, x2: b.x2 + 100, y2: b.y2 + 50 }) as string;
    const pa = parsePath(a).flat();
    const ps = parsePath(shifted).flat();
    assert.equal(pa.length, ps.length);
    pa.forEach(([x, y], i) => {
      assert.deepEqual(ps[i], [x + 100, y + 50]);
    });
  });
});
