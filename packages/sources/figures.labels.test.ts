// Stage 8b (lead): stored printed-label boxes per figure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { FIGURES_DIR, listFigures, loadFigure, loadFigureLabelBoxes } from './figures.ts';

test('every figure with printed labels has verified label boxes inside the image', () => {
  const ids = readdirSync(FIGURES_DIR).filter((f) => /^[a-z0-9-]+\.json$/.test(f)).map((f) => f.slice(0, -5));
  assert.ok(ids.length >= 8);
  for (const id of ids) {
    const { meta } = loadFigure(id);
    const boxes = loadFigureLabelBoxes(id);
    if (meta.labelsInImage) assert.ok(boxes.length >= 3, `${id} has ${boxes.length} label boxes`);
    for (const b of boxes) {
      assert.ok(b.x1 >= 0 && b.y1 >= 0 && b.x2 <= meta.width && b.y2 <= meta.height && b.x1 < b.x2 && b.y1 < b.y2, id);
    }
  }
});

test('DNA figure: the six printed part labels are covered and the credit line is not', () => {
  const boxes = loadFigureLabelBoxes('medlineplus-dna-structure-1');
  const covers = (x: number, y: number): boolean => boxes.some((b) => b.x1 <= x && x < b.x2 && b.y1 <= y && y < b.y2);
  // Centres of the printed words, measured on the 600x600 image (OCR word boxes).
  for (const [x, y] of [[282, 191], [390, 220], [491, 221], [391, 314], [492, 315], [375, 412], [345, 430], [440, 412]] as const) {
    assert.ok(covers(x, y), `printed label at (${x},${y}) is covered`);
  }
  assert.equal(covers(130, 584), false, 'credit line stays visible');
});

test('labels sidecars are not listed as figures; unknown or malformed ids give []', () => {
  assert.ok(listFigures('medlineplus-what-is-dna').every((f) => !f.id.includes('.')));
  assert.deepEqual(loadFigureLabelBoxes('no-such-figure'), []);
  assert.deepEqual(loadFigureLabelBoxes('../etc'), []);
});
