/// <reference types="node" />
// STAGE-8c Addendum A (Calvin 2026-11-02: "keep the box drawing to the models only... cleaner demo boxes"): the build
// glow draws SAM's region BOX (which sits tight on the drawing Muse located), never the traced outline. Outlines stay
// stored on the region; the 50% confidence rule is unchanged. The glow box is padded a little so it never cuts the drawing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { GLOW_PAD_PX, glowStyle, partViews, regionDrawing } from './labelDiagramView.ts';

const box = { left: 10, top: 20, width: 30, height: 40 };
const d = 'M 10 10 L 20 10 L 20 20 Z';

test('the build glow is always SAM’s box: a stored outline no longer changes what is drawn', () => {
  assert.deepEqual(regionDrawing({ region: box, outline: d, confidence: 0.93 }), { kind: 'box', box });
  assert.deepEqual(regionDrawing({ region: box, outline: null, confidence: 0.93 }), { kind: 'box', box });
  assert.deepEqual(regionDrawing({ region: box, outline: d, confidence: null }), { kind: 'box', box }, 'no score (older runs) still draws');
});

test('weak regions (< 50% sure) and missing regions still draw nothing, outline or not', () => {
  assert.equal(regionDrawing({ region: box, outline: d, confidence: 0.28 }), null);
  assert.equal(regionDrawing({ region: box, outline: null, confidence: 0.49 }), null);
  assert.equal(regionDrawing({ region: null, outline: d, confidence: 0.9 }), null);
});

test('the glow box is SAM’s box with a small padding on every side, so the glow never cuts the drawing', () => {
  assert.equal(GLOW_PAD_PX, 4);
  assert.deepEqual(glowStyle(box), { left: 'calc(10% - 4px)', top: 'calc(20% - 4px)', width: 'calc(30% + 8px)', height: 'calc(40% + 8px)' });
  assert.deepEqual(glowStyle({ left: 0, top: 0, width: 100, height: 100 }, 0), { left: 'calc(0% - 0px)', top: 'calc(0% - 0px)', width: 'calc(100% + 0px)', height: 'calc(100% + 0px)' });
});

// The water-cycle grounding probe (docs/evidence/muse-grounding-probe/result.json, rep 2): SAM's boxes after Muse's
// dedicated grounding call, 572 x 504 image px. All five are confident, so all five glow; the outline is ignored.
test('grounding probe boxes (water cycle rep 2): every confident part glows as its own box', () => {
  const W = 572; const H = 504;
  const regions = [
    { partId: 'condensation', x1: 224, y1: 107, x2: 324, y2: 149, confidence: 0.6171875 },
    { partId: 'precipitation', x1: 370, y1: 146, x2: 519, y2: 227, confidence: 0.76171875 },
    { partId: 'transpiration', x1: 34, y1: 214, x2: 96, y2: 331, confidence: 0.81640625, outline: 'M 34 214 L 96 214 L 96 331 Z' },
    { partId: 'evaporation', x1: 136, y1: 310, x2: 197, y2: 427, confidence: 0.765625 },
    { partId: 'runoff', x1: 322, y1: 332, x2: 351, y2: 362, confidence: 0.921875 },
  ];
  const part = (id: string) => ({ id, name: id, sourceId: 's', quote: 'q', x: 500, y: 500, labelX1: 0, labelY1: 0, labelX2: 10, labelY2: 10 });
  const views = partViews({ parts: regions.map((r) => part(r.partId)) as never, regions, figure: { width: W, height: H } as never });
  const drawn = views.map((v) => regionDrawing(v));
  assert.deepEqual(drawn.map((x) => x?.kind ?? null), ['box', 'box', 'box', 'box', 'box']);
  const t = drawn[2];
  assert.ok(t !== null && t !== undefined);
  assert.ok(Math.abs(t.box.left - (34 / W) * 100) < 1e-9 && Math.abs(t.box.width - (62 / W) * 100) < 1e-9, 'the box, not the outline');
});
