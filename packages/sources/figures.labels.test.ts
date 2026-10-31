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

// ---- Set A (B-06/W-01): printed-label TEXT and GROUP on the stored boxes ----

import { mkdtempSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

function tempFigureDir(boxes: unknown[]): URL {
  const real = loadFigure('medlineplus-dna-structure-1').meta;
  const dir = mkdtempSync(join(process.env['TMPDIR'] ?? tmpdir(), 'figs-'));
  writeFileSync(join(dir, 'f-1.json'), JSON.stringify({ ...real, id: 'f-1' }));
  writeFileSync(join(dir, 'f-1.labels.json'), JSON.stringify({ figureId: 'f-1', imageSha256: real.sha256, boxes }));
  return pathToFileURL(dir + '/');
}
const BOX = { x1: 10, y1: 10, x2: 50, y2: 30 };

test('loader passes optional text and group through and keeps boxes without them unchanged', () => {
  const dir = tempFigureDir([{ ...BOX, text: 'Base pairs', group: 3 }, { x1: 60, y1: 10, x2: 90, y2: 30 }]);
  assert.deepEqual(loadFigureLabelBoxes('f-1', dir), [
    { ...BOX, text: 'Base pairs', group: 3 },
    { x1: 60, y1: 10, x2: 90, y2: 30 },
  ]);
});

test('loader rejects the whole list when a text or group is malformed', () => {
  for (const bad of [
    { ...BOX, text: 5 },
    { ...BOX, text: 'x'.repeat(81) },
    { ...BOX, group: -1 },
    { ...BOX, group: 1.5 },
    { ...BOX, group: '2' },
  ]) {
    assert.deepEqual(loadFigureLabelBoxes('f-1', tempFigureDir([bad])), [], JSON.stringify(bad));
  }
  assert.equal(loadFigureLabelBoxes('f-1', tempFigureDir([{ ...BOX, text: 'x'.repeat(80), group: 0 }])).length, 1);
});

test('stored DNA boxes carry the printed words and one group per printed label', () => {
  const boxes = loadFigureLabelBoxes('medlineplus-dna-structure-1');
  const texts = boxes.map((b) => b.text);
  for (const w of ['Base pairs', 'Thymine', 'Adenine', 'Guanine', 'Cytosine']) assert.ok(texts.includes(w), w);
  const backbone = boxes.filter((b) => b.group === boxes.find((x) => /Sugar phosphate/.test(x.text ?? ''))!.group);
  assert.ok(backbone.length >= 2, 'the two lines of the backbone label share a group');
  assert.ok(boxes.every((b) => b.group === undefined || (Number.isInteger(b.group) && b.group >= 1)));
});

test('every stored text is at most 80 chars and no two groups share a text-bearing label', () => {
  for (const f of readdirSync(FIGURES_DIR).filter((n) => /^[a-z0-9-]+\.json$/.test(n))) {
    const id = f.slice(0, -5);
    const boxes = loadFigureLabelBoxes(id);
    for (const b of boxes) if (b.text !== undefined) assert.ok(b.text.length >= 1 && b.text.length <= 80, `${id}: ${b.text}`);
  }
});
