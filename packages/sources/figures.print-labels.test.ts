// Stage 8c slice S: lead-curated partLabelGroups and the printed-label list sent to Muse.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  loadFigure,
  loadFigureLabelBoxes,
  loadFigurePartLabelGroups,
  loadFigurePrintedLabels,
  printedLabelsOf,
} from './figures.ts';

function tempFigureDir(file: Record<string, unknown>, sha?: string): URL {
  const real = loadFigure('medlineplus-dna-structure-1').meta;
  const dir = mkdtempSync(join(process.env['TMPDIR'] ?? tmpdir(), 'figs8c-'));
  writeFileSync(join(dir, 'f-1.json'), JSON.stringify({ ...real, id: 'f-1' }));
  writeFileSync(
    join(dir, 'f-1.labels.json'),
    JSON.stringify({ figureId: 'f-1', imageSha256: sha ?? real.sha256, ...file }),
  );
  return pathToFileURL(dir + '/');
}
const B = (x1: number, text?: string, group?: number) => ({
  x1,
  y1: 10,
  x2: x1 + 30,
  y2: 30,
  ...(text !== undefined ? { text } : {}),
  ...(group !== undefined ? { group } : {}),
});

test('real NOAA water cycle: curated groups leave out Snowmelt Runoff (the page never mentions snowmelt)', () => {
  assert.deepEqual(loadFigurePartLabelGroups('noaa-hydrologic-cycle-1'), [1, 2, 3, 5, 6]);
  assert.deepEqual(loadFigurePrintedLabels('noaa-hydrologic-cycle-1'), [
    'Condensation',
    'Precipitation',
    'Transpiration',
    'Evaporation',
    'Surface Runoff',
  ]);
});

test('real DNA figure: multi-line label joined with a space, untexted line skipped', () => {
  assert.deepEqual(loadFigurePrintedLabels('medlineplus-dna-structure-1'), [
    'Base pairs',
    'Thymine',
    'Adenine',
    'Guanine',
    'Cytosine',
    'Sugar phosphate backbone',
  ]);
});

test('SAM figure candidates (2026-11-02): airplane and volcano curated labels are the page-named, SAM-sure parts only', () => {
  // Airplane: the red function lines share their part's group but carry no text, so each label reads as the part name.
  // 3 Nov (Calvin: a fuller published shelf): four large, separate shapes from the arrow-tip probe. The fin and the
  // flaps are out (the fin's outline spilled into the tail, flaps 0.35 to 0.61); the jet engine is in now that a
  // singular label matches the page's plural ("jet engines").
  assert.deepEqual(loadFigurePartLabelGroups('nasa-grc-airplane-parts-1'), [3, 5, 7, 11]);
  assert.deepEqual(loadFigurePrintedLabels('nasa-grc-airplane-parts-1'), [
    'Horizontal Stabilizer',
    'Wing',
    'Jet Engine',
    'Fuselage (Body)',
  ]);
  assert.equal(loadFigureLabelBoxes('nasa-grc-airplane-parts-1').length, 29);
  assert.equal(new Set(loadFigureLabelBoxes('nasa-grc-airplane-parts-1').map((b) => b.group)).size, 12);
  assert.deepEqual(loadFigurePartLabelGroups('usgs-volcano-hazards-1'), [1, 5, 11, 16, 28]);
  assert.deepEqual(loadFigurePrintedLabels('usgs-volcano-hazards-1'), [
    'Eruption Cloud',
    'Landslide',
    'Lava Dome',
    'Ground Water',
    'Magma',
  ]);
  assert.equal(loadFigureLabelBoxes('usgs-volcano-hazards-1').length, 33);
});

test('an uncurated figure has no partLabelGroups and no printed-label list; unknown ids too', () => {
  assert.equal(loadFigurePartLabelGroups('medlineplus-protein-production-1'), undefined);
  assert.deepEqual(loadFigurePrintedLabels('medlineplus-protein-production-1'), []);
  assert.equal(loadFigurePartLabelGroups('no-such-figure'), undefined);
  assert.equal(loadFigurePartLabelGroups('../etc'), undefined);
  assert.deepEqual(loadFigurePrintedLabels('../etc'), []);
});

test('loadFigureLabelBoxes behaviour is unchanged: same boxes, no partLabelGroups leak into them', () => {
  const boxes = loadFigureLabelBoxes('noaa-hydrologic-cycle-1');
  assert.equal(boxes.length, 8);
  for (const b of boxes) {
    assert.deepEqual(Object.keys(b).sort(), ['group', 'text', 'x1', 'x2', 'y1', 'y2'].filter((k) => k in b).sort());
    assert.ok(!('partLabelGroups' in b));
  }
});

test('temp figure: groups are sorted and de-duplicated; labels follow group order and skip other groups', () => {
  const dir = tempFigureDir({
    boxes: [B(10, 'Second', 2), B(50, 'Zero line', 0), B(90, 'One', 1), B(130, 'Ignored', 9), B(170, 'more', 2)],
    partLabelGroups: [2, 1, 2],
  });
  assert.deepEqual(loadFigurePartLabelGroups('f-1', dir), [1, 2]);
  assert.deepEqual(loadFigurePrintedLabels('f-1', dir), ['One', 'Second more']);
  assert.equal(loadFigureLabelBoxes('f-1', dir).length, 5);
});

test('malformed partLabelGroups means not curated; a stale image hash or bad box voids the whole file', () => {
  for (const bad of [[], [1, -2], [1.5], ['1'], 'x', null]) {
    const dir = tempFigureDir({ boxes: [B(10, 'A', 1)], partLabelGroups: bad });
    assert.equal(loadFigurePartLabelGroups('f-1', dir), undefined, JSON.stringify(bad));
    assert.deepEqual(loadFigureLabelBoxes('f-1', dir).length, 1);
  }
  const stale = tempFigureDir({ boxes: [B(10, 'A', 1)], partLabelGroups: [1] }, 'f'.repeat(64));
  assert.equal(loadFigurePartLabelGroups('f-1', stale), undefined);
  assert.deepEqual(loadFigurePrintedLabels('f-1', stale), []);
  const badBox = tempFigureDir({ boxes: [{ x1: 5, y1: 5, x2: 2, y2: 9, text: 'A', group: 1 }], partLabelGroups: [1] });
  assert.equal(loadFigurePartLabelGroups('f-1', badBox), undefined);
});

test('printedLabelsOf: whole figure when no filter; blank text and groupless boxes are skipped', () => {
  const boxes = [B(10, 'Lift', 1), B(50, '  Drag  ', 2), B(90, undefined, 2), B(130, 'floating'), B(170, ' ', 3), B(210, 'Weight', 4)];
  assert.deepEqual(printedLabelsOf(boxes), ['Lift', 'Drag', 'Weight']);
  assert.deepEqual(printedLabelsOf(boxes, [4, 1]), ['Lift', 'Weight']);
  assert.deepEqual(printedLabelsOf([], [1]), []);
});
