// Calvin 2026-11-02: SAM's weak regions drew boxes over the wrong area (water cycle "evaporation" at 0.28 took in the
// lake and the trees). A region is drawn only when SAM was at least 50% sure of it; unknown confidence (older runs) draws.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MIN_REGION_CONFIDENCE, regionToDraw } from './labelDiagramView.ts';

const box = { left: 1, top: 2, width: 3, height: 4 };

test('a region is drawn only when SAM was at least 50% sure of it', () => {
  assert.equal(MIN_REGION_CONFIDENCE, 0.5);
  assert.equal(regionToDraw({ region: box, confidence: 0.28 }), null);
  assert.equal(regionToDraw({ region: box, confidence: 0.49 }), null);
  assert.equal(regionToDraw({ region: box, confidence: 0.5 }), box);
  assert.equal(regionToDraw({ region: box, confidence: 0.93 }), box);
});

test('no region, or a region without a confidence (older runs), keeps its stored behaviour', () => {
  assert.equal(regionToDraw({ region: null, confidence: 0.9 }), null);
  assert.equal(regionToDraw({ region: box, confidence: null }), box);
});
