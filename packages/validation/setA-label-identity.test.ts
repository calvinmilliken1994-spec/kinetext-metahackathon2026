// Set A (reviews B-06 / W-01): a part's NAME must be the printed word in the slot its label box sits on.
// The figure library stores, per figure, the printed-label boxes with their TEXT (and a GROUP for the
// lines of one printed label). LD-02 (name-in-quote) binds each part name to that stored text; before this,
// swapping "Adenine" and "Thymine" kept every LD check green. Figures whose boxes carry no text keep the old
// behaviour. Run: node --test packages/validation/setA-label-identity.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';

import type { LabelDiagramGen, LabelRegion } from '../contracts/kit.ts';
import type { SourceDocument } from '../contracts/index.ts';
import type { FigureMeta } from '../sources/figures.ts';
import { loadFigure, loadFigureLabelBoxes } from '../sources/figures.ts';
import { loadSource } from '../sources/index.ts';
import { validateKitComponent } from './kit/index.ts';
import { nameMatchesPrinted, normalisePrintedLabel, printedLabelProblems } from './kit/label-identity.ts';
import { checkOf, failedIds, failureDetail, stage6Fixture } from './fixtures/stage6.ts';

const DNA_SOURCE = 'medlineplus-what-is-dna';
const DNA_FIGURE = 'medlineplus-dna-structure-1';
const sources = (): SourceDocument[] => [loadSource(DNA_SOURCE)];
const golden = (): LabelDiagramGen => stage6Fixture<LabelDiagramGen>('label-diagram.gen.json');
/** The real figure with the real stored boxes (text + group), as the lesson worker attaches them. */
const withText = (): FigureMeta => ({ ...loadFigure(DNA_FIGURE).meta, labelBoxes: loadFigureLabelBoxes(DNA_FIGURE) });
const withoutText = (): FigureMeta => ({
  ...loadFigure(DNA_FIGURE).meta,
  labelBoxes: loadFigureLabelBoxes(DNA_FIGURE).map(({ x1, y1, x2, y2 }) => ({ x1, y1, x2, y2 })),
});
const noBoxes = (): FigureMeta => loadFigure(DNA_FIGURE).meta;

function regionsFor(gen: LabelDiagramGen, meta: FigureMeta): LabelRegion[] {
  return gen.parts.map(p => {
    const px = (p.x * meta.width) / 1000;
    const py = (p.y * meta.height) / 1000;
    return { partId: p.id, x1: Math.round(px) - 20, y1: Math.round(py) - 20, x2: Math.round(px) + 20, y2: Math.round(py) + 20, confidence: 0.95 };
  });
}
function validate(gen: LabelDiagramGen, figure: FigureMeta) {
  return validateKitComponent('label-diagram-v1', gen, sources(), { figures: [figure], labelRegions: regionsFor(gen, figure) });
}
const partIndex = (gen: LabelDiagramGen, id: string): number => gen.parts.findIndex(p => p.id === id);

test('the stored golden passes every check when the figure boxes carry their printed text', () => {
  const report = validate(golden(), withText());
  assert.equal(report.publishable, true, failureDetail(report));
});

test('normalisation: case, whitespace, hyphen/space and a simple plural s are ignored; other words are not', () => {
  assert.equal(normalisePrintedLabel('Base  pairs'), normalisePrintedLabel('base-pair'));
  assert.equal(normalisePrintedLabel('Sugar phosphate backbone'), normalisePrintedLabel('sugar-phosphate backbone'));
  assert.notEqual(normalisePrintedLabel('Adenine'), normalisePrintedLabel('Thymine'));
  assert.notEqual(normalisePrintedLabel('Sugar phosphate'), normalisePrintedLabel('Sugar phosphate backbone'));
});

test('B-06/W-01: swapping Adenine and Thymine (names only) is rejected by LD-02 and names part, printed word and fix', () => {
  const gen = golden();
  const a = partIndex(gen, 'part-adenine');
  const t = partIndex(gen, 'part-thymine');
  [gen.parts[a]!.name, gen.parts[t]!.name] = [gen.parts[t]!.name, gen.parts[a]!.name];
  const report = validate(gen, withText());
  assert.deepEqual(failedIds(report), ['LD-02'], failureDetail(report));
  const c = checkOf(report, 'LD-02');
  assert.match(c.message, /thymine/i);
  assert.match(c.message, /Adenine/);
  assert.match(c.message, /printed/i);
  const affected = c.affected ?? [];
  assert.ok(affected.includes(`/parts/${a}/name`) && affected.includes(`/parts/${t}/name`), affected.join(', '));
  // a repair may also move the box, so the box edges are authorised too:
  assert.ok(affected.includes(`/parts/${a}/labelX1`), affected.join(', '));
});

test('the same swap on a figure without stored text keeps the old behaviour (rule not applicable)', () => {
  for (const figure of [withoutText(), noBoxes()]) {
    const gen = golden();
    const a = partIndex(gen, 'part-adenine');
    const t = partIndex(gen, 'part-thymine');
    [gen.parts[a]!.name, gen.parts[t]!.name] = [gen.parts[t]!.name, gen.parts[a]!.name];
    const report = validate(gen, figure);
    assert.equal(report.checks.find(c => c.id === 'LD-02')!.passed, true, failureDetail(report));
  }
});

test('a name must be the printed label or a contiguous part of it: reordered or foreign words fail, the full group text passes', () => {
  const ok = golden();
  assert.equal(validate(ok, withText()).checks.find(c => c.id === 'LD-02')!.passed, true);
  // "sugar-phosphate" (a contiguous part of "Sugar phosphate backbone") is the page's own word for it: passes
  const part = golden();
  const b = partIndex(part, 'part-backbone');
  part.parts[b]!.name = 'sugar-phosphate';
  part.parts[b]!.quote = 'DNA is a double helix formed by base pairs attached to a sugar-phosphate backbone';
  assert.equal(validate(part, withText()).checks.find(c => c.id === 'LD-02')!.passed, true);
  assert.ok(nameMatchesPrinted('Runoff', 'Surface Runoff'));
  assert.ok(!nameMatchesPrinted('sugar backbone', 'Sugar phosphate backbone'));
  assert.ok(!nameMatchesPrinted('Backbone sugar', 'Sugar phosphate backbone'));
  assert.ok(!nameMatchesPrinted('Surface Runoff water', 'Surface Runoff'));
});

test('stored lessons put the label box a few pixels off the word: the nearest printed label within reach is the slot', () => {
  const gen = golden();
  const i = partIndex(gen, 'part-guanine');
  const p = gen.parts[i]!;
  // Stored Guanine label is px (354,304)-(427,324); this box is px (355,332)-(415,349), 8 px below it (a real stored lesson).
  [p.labelX1, p.labelY1, p.labelX2, p.labelY2] = [592, 553, 692, 582];
  assert.deepEqual(printedLabelProblems(gen.parts, withText()).problems, []);
  // the same off-box with the Cytosine name is a swap, still caught
  gen.parts[i]!.name = 'cytosine';
  const bad = printedLabelProblems(gen.parts, withText());
  assert.equal(bad.problems.length >= 1, true);
  assert.match(bad.problems[0]!, /Guanine/);
});

test('two parts whose boxes sit on the two lines of ONE printed label cannot both claim it', () => {
  const gen = golden();
  const b = partIndex(gen, 'part-backbone');
  const other = partIndex(gen, 'part-base-pairs');
  // Stored backbone label spans px (304,401)-(448,441); put each part on a different line of it.
  const p = gen.parts[b]!;
  [p.labelX1, p.labelY1, p.labelX2, p.labelY2] = [508, 672, 745, 697];
  const q = gen.parts[other]!;
  [q.labelX1, q.labelY1, q.labelX2, q.labelY2] = [508, 703, 745, 733];
  const report = validate(gen, withText());
  const c = checkOf(report, 'LD-02');
  assert.equal(c.passed, false, failureDetail(report));
  assert.match(c.message, /already|one printed label|same printed label/i);
});

test('a label box that covers no printed label of the figure fails with a plain message', () => {
  const gen = golden();
  const i = partIndex(gen, 'part-adenine');
  const p = gen.parts[i]!;
  [p.labelX1, p.labelY1, p.labelX2, p.labelY2] = [30, 30, 150, 60]; // empty corner of the figure
  const report = validate(gen, withText());
  const c = checkOf(report, 'LD-02');
  assert.equal(c.passed, false, failureDetail(report));
  assert.match(c.message, /no printed label|not on a printed/i);
  assert.ok((c.affected ?? []).includes(`/parts/${i}/labelX1`));
});

test('a part without a label box (all-zero sentinel) is not bound by the printed-label rule', () => {
  const gen = golden();
  const i = partIndex(gen, 'part-guanine');
  const p = gen.parts[i]!;
  [p.labelX1, p.labelY1, p.labelX2, p.labelY2] = [0, 0, 0, 0];
  const report = validate(gen, withText());
  assert.equal(report.checks.find(c => c.id === 'LD-02')!.passed, true, failureDetail(report));
});

test('a box over only text-less printed boxes is skipped (nothing to compare)', () => {
  const figure: FigureMeta = { ...loadFigure(DNA_FIGURE).meta, labelBoxes: [
    { x1: 100, y1: 100, x2: 200, y2: 130 }, // no text
    { x1: 300, y1: 300, x2: 400, y2: 330, text: 'Elsewhere', group: 1 },
  ] };
  const gen = golden();
  const p = gen.parts[0]!;
  [p.labelX1, p.labelY1, p.labelX2, p.labelY2] = [170, 170, 330, 215]; // px (102,102)-(198,129): on the text-less box only
  const problems = printedLabelProblems(gen.parts, figure);
  assert.deepEqual(problems.problems.filter((m: string) => m.includes('parts[0]')), []);
});

test('printedLabelProblems reports nothing for the stored golden and is silent without figure text', () => {
  assert.deepEqual(printedLabelProblems(golden().parts, withText()).problems, []);
  assert.deepEqual(printedLabelProblems(golden().parts, withoutText()).problems, []);
  assert.deepEqual(printedLabelProblems(golden().parts, noBoxes()).problems, []);
});
