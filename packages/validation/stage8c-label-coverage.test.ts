// Stage 8c V — LD-04 area boxes, LD-10 labels-covered, LD-11 regions-confident
// (frozen spec docs/specs/STAGE-8c-label-coverage-and-outlines.md). Real licensed sources and real figures: the
// MedlinePlus "What is DNA?" page with its 600x600 figure (golden gen, six parts, six printed labels) and the NOAA
// JetStream water-cycle page with its figure, whose label "Snowmelt Runoff"/"Surface Runoff" the page never prints.
// Printed labels and partLabelGroups come from data/figures/<id>.labels.json, exactly as the lesson worker attaches
// them. Run: node --test packages/validation/stage8c-label-coverage.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { KIT_LIMITS } from '../contracts/kit.ts';
import type { LabelDiagramGen, LabelPartGen, LabelRegion } from '../contracts/kit.ts';
import type { SourceDocument } from '../contracts/index.ts';
import type { FigureMeta } from '../sources/figures.ts';
import { FIGURES_DIR, loadFigure, loadFigureLabelBoxes } from '../sources/figures.ts';
import { loadSource } from '../sources/index.ts';
import { compareKitRevisions, validateKitComponent } from './kit/index.ts';
import { validateLabelDiagram, normaliseCoverageText, pageWordingOfLabel } from './kit/label-diagram.ts';
import { NOT_RETROACTIVE_CHECK_IDS, retroactiveFailedIds } from './not-retroactive.ts';
import { checkOf, clone, expectFailures, failedIds, failureDetail, stage6Fixture } from './fixtures/stage6.ts';

const DNA_SOURCE = 'medlineplus-what-is-dna';
const DNA_FIGURE = 'medlineplus-dna-structure-1';
const WATER_SOURCE = 'noaa-jetstream-hydrologic-cycle';
const WATER_FIGURE = 'noaa-hydrologic-cycle-1';

const golden = (): LabelDiagramGen => stage6Fixture<LabelDiagramGen>('label-diagram.gen.json');
const MIN_CONF = KIT_LIMITS.labelDiagram.minRegionConfidence;

/** A figure as the worker attaches it: stored printed-label boxes (text, group) and the lead-curated partLabelGroups. */
function figureWithGroups(id: string, mutate: (f: FigureMeta & { partLabelGroups?: number[] }) => void = () => {}): FigureMeta & { partLabelGroups?: number[] } {
  const raw = JSON.parse(readFileSync(new URL(`${id}.labels.json`, FIGURES_DIR), 'utf8')) as { partLabelGroups?: number[] };
  const f: FigureMeta & { partLabelGroups?: number[] } = {
    ...loadFigure(id).meta,
    labelBoxes: loadFigureLabelBoxes(id),
    ...(raw.partLabelGroups !== undefined ? { partLabelGroups: raw.partLabelGroups } : {}),
  };
  mutate(f);
  return f;
}

function regionsFor(gen: LabelDiagramGen, meta: FigureMeta, confidence: number | null = 0.95): LabelRegion[] {
  return gen.parts.map(p => {
    const px = (Number(p.x) * meta.width) / 1000;
    const py = (Number(p.y) * meta.height) / 1000;
    return { partId: p.id, x1: Math.round(px) - 20, y1: Math.round(py) - 20, x2: Math.round(px) + 20, y2: Math.round(py) + 20, confidence };
  });
}

function validate(gen: LabelDiagramGen, figure: FigureMeta, regions: LabelRegion[] = regionsFor(gen, figure), sources: SourceDocument[] = [loadSource(DNA_SOURCE)]) {
  return validateKitComponent('label-diagram-v1', gen, sources, { figures: [figure], labelRegions: regions });
}

const withoutPart = (gen: LabelDiagramGen, id: string): LabelDiagramGen => ({ ...gen, parts: gen.parts.filter(p => p.id !== id) });

/* ------------------------------------------------------------------ */
/* LD-04 area boxes                                                    */
/* ------------------------------------------------------------------ */

test('the stored golden has areas that hold their points and passes every check with real figure data', () => {
  const gen = golden();
  const fig = figureWithGroups(DNA_FIGURE);
  assert.deepEqual(fig.partLabelGroups, [1, 2, 3, 4, 5, 6], 'the lead curated all six DNA labels as parts');
  const report = validate(gen, fig);
  assert.equal(report.publishable, true, failureDetail(report));
});

test('LD-04: a part with no area field at all skips the area check (older specs)', () => {
  const gen = golden();
  for (const p of gen.parts) { delete p.areaX1; delete p.areaY1; delete p.areaX2; delete p.areaY2; }
  const report = validateLabelDiagram(gen, [loadSource(DNA_SOURCE)], { figures: [figureWithGroups(DNA_FIGURE)], regions: regionsFor(gen, loadFigure(DNA_FIGURE).meta) });
  assert.equal(checkOf(report, 'LD-04').passed, true, failureDetail(report));
  assert.equal(report.publishable, true, failureDetail(report));
});

test('LD-04: a part point outside its own area box fails alone and names the area and point paths', () => {
  const gen = golden();
  // base pairs point is (310, 470): move the area box off it.
  gen.parts[0]!.areaX1 = 600; gen.parts[0]!.areaX2 = 700; gen.parts[0]!.areaY1 = 600; gen.parts[0]!.areaY2 = 700;
  const report = expectFailures(validate(gen, figureWithGroups(DNA_FIGURE)), ['LD-04']);
  const affected = checkOf(report, 'LD-04').affected ?? [];
  for (const path of ['/parts/0/x', '/parts/0/y', '/parts/0/areaX1', '/parts/0/areaY1', '/parts/0/areaX2', '/parts/0/areaY2']) {
    assert.ok(affected.includes(path), `${path} in ${affected.join(', ')}`);
  }
  assert.ok(!affected.some(a => a.startsWith('/parts/1/')), 'only the offending part is named');
});

test('LD-04: the point on the area edge is inside (inclusive)', () => {
  const gen = golden();
  const p = gen.parts[0]!;
  p.areaX1 = p.x; p.areaY1 = p.y; p.areaX2 = p.x + 40; p.areaY2 = p.y + 40;
  const report = validate(gen, figureWithGroups(DNA_FIGURE));
  assert.equal(checkOf(report, 'LD-04').passed, true, failureDetail(report));
});

test('LD-04: a degenerate, out-of-range, non-integer or partial area fails (direct call past the Ajv gate)', () => {
  const meta = figureWithGroups(DNA_FIGURE);
  const cases: [string, (p: LabelPartGen) => void][] = [
    ['x1 equals x2', p => { p.areaX2 = p.areaX1!; }],
    ['y1 above y2', p => { p.areaY1 = p.areaY2! + 1; }],
    ['edge above 1000', p => { p.areaX2 = 1001; }],
    ['negative edge', p => { p.areaX1 = -1; }],
    ['non-integer edge', p => { p.areaY1 = 420.5; }],
    ['only one edge given', p => { delete p.areaX2; delete p.areaY1; delete p.areaY2; }],
  ];
  for (const [what, mutate] of cases) {
    const gen = golden();
    mutate(gen.parts[0]!);
    const report = validateLabelDiagram(gen, [loadSource(DNA_SOURCE)], { figures: [meta], regions: regionsFor(golden(), meta) });
    assert.equal(checkOf(report, 'LD-04').passed, false, `${what}: ${failureDetail(report)}`);
    assert.ok((checkOf(report, 'LD-04').affected ?? []).includes('/parts/0/areaX1'), what);
  }
});

test('LD-04: through the dispatcher a gen missing area edges fails the schema gate (new generations need areas)', () => {
  const gen = golden();
  delete gen.parts[0]!.areaX1;
  const report = validate(gen, figureWithGroups(DNA_FIGURE));
  assert.equal(checkOf(report, 'schema.gen').passed, false);
  // ...but a STORED part (re-checked with storedWithoutAreas) is not failed on the schema for lacking them:
  const stored = clone(golden());
  for (const p of stored.parts) { delete p.areaX1; delete p.areaY1; delete p.areaX2; delete p.areaY2; }
  const fig = figureWithGroups(DNA_FIGURE);
  const storedReport = validateKitComponent('label-diagram-v1', stored, [loadSource(DNA_SOURCE)], { figures: [fig], labelRegions: regionsFor(stored, fig), storedWithoutAreas: true });
  assert.equal(checkOf(storedReport, 'schema.gen').passed, true, failureDetail(storedReport));
  // storedWithoutAreas never excuses another schema problem:
  const broken = clone(stored);
  (broken.parts[0] as unknown as { x: unknown }).x = 'left';
  const brokenReport = validateKitComponent('label-diagram-v1', broken, [loadSource(DNA_SOURCE)], { figures: [fig], labelRegions: regionsFor(stored, fig), storedWithoutAreas: true });
  assert.equal(checkOf(brokenReport, 'schema.gen').passed, false);
});

/* ------------------------------------------------------------------ */
/* LD-10 labels-covered                                                */
/* ------------------------------------------------------------------ */

test('LD-10: the page says "sugar-phosphate backbone", the label "Sugar phosphate backbone": they match after normalising', () => {
  const text = loadSource(DNA_SOURCE).text;
  assert.ok(/sugar-phosphate backbone/i.test(text), 'the page hyphenates the phrase');
  assert.equal(normaliseCoverageText('Sugar phosphate backbone'), normaliseCoverageText('sugar-phosphate  backbone'));
  assert.equal(normaliseCoverageText('  Snowmelt-Runoff, (Spring)!  '), 'snowmelt runoff spring');
});

test('LD-10: a part for every named printed label passes; dropping one fails alone and names the label', () => {
  const fig = figureWithGroups(DNA_FIGURE);
  const gen = withoutPart(golden(), 'part-backbone');
  const report = expectFailures(validate(gen, fig), ['LD-10']);
  const check = checkOf(report, 'LD-10');
  assert.match(check.message, /"Sugar phosphate backbone"/);
  assert.doesNotMatch(check.message, /Adenine|Thymine/);
  assert.deepEqual(check.affected, ['/parts'], 'an array path so a repair may ADD parts');
  // ...and dropping base pairs names that one instead:
  const gen2 = withoutPart(golden(), 'part-base-pairs');
  const r2 = validate(gen2, fig);
  assert.deepEqual(failedIds(r2), ['LD-10'], failureDetail(r2));
  assert.match(checkOf(r2, 'LD-10').message, /"Base pairs"/);
});

test('LD-10: several missing labels are all named', () => {
  const fig = figureWithGroups(DNA_FIGURE);
  const gen = withoutPart(withoutPart(golden(), 'part-backbone'), 'part-guanine');
  const report = validate(gen, fig);
  assert.deepEqual(failedIds(report), ['LD-10'], failureDetail(report));
  assert.match(checkOf(report, 'LD-10').message, /"Guanine"/);
  assert.match(checkOf(report, 'LD-10').message, /"Sugar phosphate backbone"/);
});

test('LD-10: a label the page never names, wholly or by its last word, is not required', () => {
  // "Base wobble": neither the whole label nor its last word is on the page; "Zorbulation" is not on the page at all.
  // (A label whose last word IS on the page, such as "Base pair", counts: see pageWordingOfLabel.)
  const fig = figureWithGroups(DNA_FIGURE, f => {
    f.labelBoxes = [
      ...(f.labelBoxes ?? []),
      { x1: 10, y1: 10, x2: 90, y2: 30, text: 'Base wobble', group: 7 },
      { x1: 10, y1: 560, x2: 120, y2: 590, text: 'Zorbulation', group: 8 },
    ];
    f.partLabelGroups = [1, 2, 3, 4, 5, 6, 7, 8];
  });
  const report = validate(golden(), fig);
  assert.equal(checkOf(report, 'LD-10').passed, true, failureDetail(report));
  assert.equal(report.publishable, true, failureDetail(report));
});

test('LD-10: skipped without partLabelGroups, or when the stored boxes carry no printed text', () => {
  const dropped = withoutPart(golden(), 'part-backbone');
  const noGroups = figureWithGroups(DNA_FIGURE, f => { delete f.partLabelGroups; });
  assert.equal(checkOf(validate(dropped, noGroups), 'LD-10').passed, true);
  const noText = figureWithGroups(DNA_FIGURE, f => { f.labelBoxes = (f.labelBoxes ?? []).map(({ x1, y1, x2, y2, group }) => ({ x1, y1, x2, y2, ...(group !== undefined ? { group } : {}) })); });
  assert.equal(checkOf(validate(dropped, noText), 'LD-10').passed, true);
  const bare = loadFigure(DNA_FIGURE).meta; // no labelBoxes at all
  assert.equal(checkOf(validate(dropped, bare), 'LD-10').passed, true);
});

test('LD-10: a part without a printed-label box claims nothing', () => {
  const fig = figureWithGroups(DNA_FIGURE);
  const gen = golden();
  const backbone = gen.parts.find(p => p.id === 'part-backbone')!;
  backbone.labelX1 = 0; backbone.labelY1 = 0; backbone.labelX2 = 0; backbone.labelY2 = 0;
  const report = validate(gen, fig);
  assert.ok(failedIds(report).includes('LD-10'), failureDetail(report));
  assert.match(checkOf(report, 'LD-10').message, /"Sugar phosphate backbone"/);
});

test('LD-10: a part can claim a label by overlap even when its box only partly covers the printed word', () => {
  const fig = figureWithGroups(DNA_FIGURE);
  const gen = golden();
  const backbone = gen.parts.find(p => p.id === 'part-backbone')!;
  // Printed label is (304,401)-(448,441) px = (507,668)-(747,735) on the 0..1000 grid; cover only its left half.
  backbone.labelX1 = 500; backbone.labelX2 = 620;
  assert.equal(checkOf(validate(gen, fig), 'LD-10').passed, true);
});

test('LD-10: at the maximum part count an unclaimed label is not a failure', () => {
  const fig = figureWithGroups(DNA_FIGURE);
  const gen = withoutPart(golden(), 'part-backbone');
  const bases = 'four chemical bases: adenine (A), guanine (G), cytosine (C), and thymine (T)';
  const extra = [
    { id: 'part-chemical-bases', name: 'chemical bases', quote: bases, x: 100, y: 100 },
    { id: 'part-double-helix', name: 'double helix', quote: 'Nucleotides are arranged in two long strands that form a spiral called a double helix', x: 900, y: 900 },
    { id: 'part-nucleotide', name: 'nucleotide', quote: 'Together, a base, sugar, and phosphate are called a nucleotide', x: 100, y: 900 },
  ].map(e => ({
    ...e, sourceId: DNA_SOURCE, labelX1: 0, labelY1: 0, labelX2: 0, labelY2: 0,
    areaX1: e.x - 50, areaY1: e.y - 50, areaX2: e.x + 50, areaY2: e.y + 50,
  }));
  gen.parts = [...gen.parts, ...extra];
  assert.equal(gen.parts.length, KIT_LIMITS.labelDiagram.parts.max);
  const report = validate(gen, fig);
  assert.equal(checkOf(report, 'LD-10').passed, true, failureDetail(report));
  assert.match(checkOf(report, 'LD-10').message, /maximum/);
  assert.equal(report.publishable, true, failureDetail(report));
});

/** The water-cycle figure with parts built from its stored printed-label boxes (LD-10 reads label boxes only). */
function waterParts(names: string[]): LabelPartGen[] {
  const fig = figureWithGroups(WATER_FIGURE);
  const boxOf = (text: string) => fig.labelBoxes!.filter(b => b.group === fig.labelBoxes!.find(x => x.text === text)!.group);
  return names.map((name, i) => {
    const printed = name === 'Runoff' ? 'Surface Runoff' : name;
    const boxes = boxOf(printed);
    const x1 = Math.min(...boxes.map(b => b.x1)); const y1 = Math.min(...boxes.map(b => b.y1));
    const x2 = Math.max(...boxes.map(b => b.x2)); const y2 = Math.max(...boxes.map(b => b.y2));
    return {
      id: `part-${i}`, name, sourceId: WATER_SOURCE, quote: name, x: 500, y: 500,
      labelX1: Math.floor((x1 * 1000) / fig.width), labelY1: Math.floor((y1 * 1000) / fig.height),
      labelX2: Math.ceil((x2 * 1000) / fig.width), labelY2: Math.ceil((y2 * 1000) / fig.height),
    };
  });
}
const waterGen = (names: string[]): LabelDiagramGen => ({ schemaVersion: 'label-diagram-v1', title: 'Water cycle', figureId: WATER_FIGURE, parts: waterParts(names), hint: 'Tap each part.' });
const waterLd10 = (names: string[], groups?: number[]) => checkOf(validateLabelDiagram(waterGen(names), [loadSource(WATER_SOURCE)], { figures: [figureWithGroups(WATER_FIGURE, f => { if (groups) f.partLabelGroups = groups; })] }), 'LD-10');

test('pageWordingOfLabel: the whole label, else the last word of a longer label, as the page words it', () => {
  assert.equal(pageWordingOfLabel('Surface Runoff', ['Runoff occurs when the ground is saturated.']), 'runoff');
  assert.equal(pageWordingOfLabel('Sugar phosphate backbone', ['a sugar-phosphate backbone']), 'sugar phosphate backbone');
  assert.equal(pageWordingOfLabel('Evaporation', ['no such word']), null);
  assert.equal(pageWordingOfLabel('Run', ['Runoff occurs.']), null, 'a word prefix is not a word');
  assert.equal(pageWordingOfLabel('Surface Runoff', ['Runoffs']), null);
  assert.equal(pageWordingOfLabel('  ', ['anything']), null);
});

test('LD-10 water cycle: the curated five are required, "Surface Runoff" through the page word "runoff"; Snowmelt Runoff is not curated', () => {
  const text = loadSource(WATER_SOURCE).text;
  assert.ok(!/snowmelt/i.test(text), 'the page never mentions snowmelt');
  const five = waterLd10(['Condensation', 'Precipitation', 'Transpiration', 'Evaporation', 'Runoff']);
  assert.equal(five.passed, true, five.message);
  const noRunoff = waterLd10(['Condensation', 'Precipitation', 'Transpiration', 'Evaporation']);
  assert.equal(noRunoff.passed, false, 'the main runoff needs a part');
  assert.match(noRunoff.message, /"Surface Runoff"/);
  assert.doesNotMatch(noRunoff.message, /Snowmelt/);
});

test('LD-10 water cycle: a printed label left out of the curated groups is never required, nor named when missing', () => {
  const text = loadSource(WATER_SOURCE).text;
  for (const named of ['Condensation', 'Precipitation', 'Transpiration', 'Evaporation']) {
    assert.ok(new RegExp(`\\b${named}\\b`, 'i').test(text), `${named} is on the page`);
  }
  assert.ok(!/snowmelt runoff/i.test(text) && !/surface runoff/i.test(text), 'the page prints neither runoff phrase');
  const curatedFour = [1, 2, 3, 5];
  const four = waterLd10(['Condensation', 'Precipitation', 'Transpiration', 'Evaporation'], curatedFour);
  assert.equal(four.passed, true, four.message);
  const withRunoff = waterLd10(['Condensation', 'Precipitation', 'Transpiration', 'Evaporation', 'Runoff'], curatedFour);
  assert.equal(withRunoff.passed, true, withRunoff.message);
  const missing = waterLd10(['Condensation', 'Precipitation', 'Runoff'], curatedFour);
  assert.equal(missing.passed, false);
  assert.match(missing.message, /"Transpiration"/);
  assert.match(missing.message, /"Evaporation"/);
  assert.doesNotMatch(missing.message, /Runoff/);
});

/* ------------------------------------------------------------------ */
/* LD-11 regions-confident                                             */
/* ------------------------------------------------------------------ */

test('LD-11: a weak region fails alone with the part, SAM\'s confidence to 2 decimals and the fix', () => {
  const gen = golden();
  const fig = figureWithGroups(DNA_FIGURE);
  const regions = regionsFor(gen, fig);
  regions[3] = { ...regions[3]!, confidence: 0.2849 };
  const report = expectFailures(validate(gen, fig, regions), ['LD-11']);
  const check = checkOf(report, 'LD-11');
  assert.match(check.message, /Guanine/i);
  assert.match(check.message, /0\.28/);
  assert.doesNotMatch(check.message, /0\.2849/);
  assert.match(check.message, /move the point onto the drawn part and put the area box around all of its drawn pieces/);
  const affected = check.affected ?? [];
  for (const path of ['/parts/3/x', '/parts/3/y', '/parts/3/areaX1', '/parts/3/areaY1', '/parts/3/areaX2', '/parts/3/areaY2']) {
    assert.ok(affected.includes(path), `${path} in ${affected.join(', ')}`);
  }
  assert.equal(affected.length, 6, 'no other part is named');
});

test('LD-11: the threshold is inclusive, a null confidence is ignored, several weak parts are all named', () => {
  const gen = golden();
  const fig = figureWithGroups(DNA_FIGURE);
  const regions = regionsFor(gen, fig);
  regions[0] = { ...regions[0]!, confidence: MIN_CONF };
  regions[1] = { ...regions[1]!, confidence: null };
  assert.equal(checkOf(validate(gen, fig, regions), 'LD-11').passed, true);
  regions[0] = { ...regions[0]!, confidence: MIN_CONF - 0.01 };
  regions[2] = { ...regions[2]!, confidence: 0.1 };
  const check = checkOf(validate(gen, fig, regions), 'LD-11');
  assert.equal(check.passed, false);
  assert.ok((check.affected ?? []).includes('/parts/0/x') && (check.affected ?? []).includes('/parts/2/areaY2'));
  assert.match(check.message, /0\.49/);
  assert.match(check.message, /0\.10/);
});

test('LD-11: without the regions option it fails with the exact "segmentation did not run" and no repair path', () => {
  const report = validateKitComponent('label-diagram-v1', golden(), [loadSource(DNA_SOURCE)], { figures: [figureWithGroups(DNA_FIGURE)] });
  const check = checkOf(report, 'LD-11');
  assert.equal(check.passed, false);
  assert.equal(check.message, 'segmentation did not run');
  assert.equal(check.affected, undefined, 'a system fault grants no repair permission');
});

/* ------------------------------------------------------------------ */
/* Not retroactive                                                     */
/* ------------------------------------------------------------------ */

test('LD-10 and LD-11 are the not-retroactive ids, and retroactiveFailedIds drops exactly them', () => {
  assert.deepEqual([...NOT_RETROACTIVE_CHECK_IDS].sort(), ['LD-10', 'LD-11']);
  const checks = [
    { id: 'LD-04', passed: false }, { id: 'LD-10', passed: false }, { id: 'LD-11', passed: false }, { id: 'LD-02', passed: true },
  ];
  assert.deepEqual(retroactiveFailedIds(checks), ['LD-04']);
});

/* ------------------------------------------------------------------ */
/* Repair guard: the new affected paths authorise exactly the honest fix */
/* ------------------------------------------------------------------ */

test('repair guard: adding the missing part (LD-10 affects /parts) passes; rewriting a passing part alongside it does not', () => {
  const fig = figureWithGroups(DNA_FIGURE);
  const sources = [loadSource(DNA_SOURCE)];
  const base = withoutPart(golden(), 'part-backbone');
  const ctx = { sources, figures: [fig], labelRegions: regionsFor(base, fig) };
  assert.deepEqual(failedIds(validate(base, fig)), ['LD-10']);
  const fixed = clone(golden()); // the golden holds the backbone part again, appended in its original place
  const ok = compareKitRevisions('label-diagram-v1', base, { ...fixed, parts: [...base.parts, golden().parts.find(p => p.id === 'part-backbone')!] }, ctx);
  assert.equal(ok.passed, true, ok.message);
  const sneaky = { ...fixed, parts: [...base.parts, golden().parts.find(p => p.id === 'part-backbone')!] };
  sneaky.parts = sneaky.parts.map((p, i) => (i === 1 ? { ...p, x: p.x + 5 } : p));
  const bad = compareKitRevisions('label-diagram-v1', base, sneaky, ctx);
  assert.equal(bad.passed, false, 'a passing part\'s point stays frozen');
  // Only an append is licensed: a removal (or a reorder) of parts is still rejected, as is exceeding the maximum.
  const removed = compareKitRevisions('label-diagram-v1', base, { ...fixed, parts: base.parts.slice(0, 3) }, ctx);
  assert.equal(removed.passed, false, 'the model never removes parts');
  // LD-10 licenses the append only while it fails: a baseline with every label covered grants no list change.
  const covered = golden();
  const coveredCtx = { sources, figures: [fig], labelRegions: regionsFor(covered, fig) };
  const extra = { ...clone(covered.parts[5]!), id: 'part-extra', name: 'extra' };
  assert.equal(compareKitRevisions('label-diagram-v1', covered, { ...covered, parts: [...covered.parts, extra] }, coveredCtx).passed, false);
});

test('repair guard: a weak region (LD-11) unlocks that part\'s point and area only', () => {
  const fig = figureWithGroups(DNA_FIGURE);
  const sources = [loadSource(DNA_SOURCE)];
  const base = golden();
  const regions = regionsFor(base, fig);
  regions[3] = { ...regions[3]!, confidence: 0.28 };
  assert.deepEqual(failedIds(validate(base, fig, regions)), ['LD-11']);
  const ctx = { sources, figures: [fig], labelRegions: regions };
  const fixed = clone(base);
  fixed.parts[3]!.x += 6; fixed.parts[3]!.areaX2! += 10; fixed.parts[3]!.areaY1! -= 10;
  const ok = compareKitRevisions('label-diagram-v1', base, fixed, ctx);
  assert.equal(ok.passed, true, ok.message);
  const sneaky = clone(fixed);
  sneaky.parts[2]!.areaX2! += 10; // another part's area was fine
  assert.equal(compareKitRevisions('label-diagram-v1', base, sneaky, ctx).passed, false);
  const renamed = clone(fixed);
  renamed.parts[3]!.name = 'Guanin'; // a name is not part of the LD-11 permission
  assert.equal(compareKitRevisions('label-diagram-v1', base, renamed, ctx).passed, false);
});
