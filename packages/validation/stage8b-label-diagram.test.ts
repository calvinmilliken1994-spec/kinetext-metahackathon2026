// Stage 8b V — label-diagram-v1 validator tests (LD-01..LD-09, frozen spec
// docs/specs/STAGE-8b-label-diagram.md). The golden quotes the REAL licensed MedlinePlus
// "What is DNA?" page and labels the page's OWN figure (medlineplus-dna-structure-1, 600x600,
// labelsInImage true) loaded through the hash-verifying figure loader. Regions are written in
// image pixels like SAM output: 40x40 boxes centred on each golden point. One negative per check.
// Run: node --test packages/validation/stage8b-label-diagram.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';

import { checkIdsFor } from '../contracts/kit.ts';
import type { LabelDiagramGen, LabelRegion } from '../contracts/kit.ts';
import type { SourceDocument, ValidationReport } from '../contracts/index.ts';
import type { FigureMeta } from '../sources/figures.ts';
import { listFigures, loadFigure } from '../sources/figures.ts';
import { loadSource } from '../sources/index.ts';
import { validateKitComponent } from './kit/index.ts';
import { validateLabelDiagram } from './kit/label-diagram.ts';
import { checkOf, expectFailures, failedIds, failureDetail, stage6Fixture } from './fixtures/stage6.ts';

const DNA_SOURCE = 'medlineplus-what-is-dna';
const DNA_FIGURE = 'medlineplus-dna-structure-1';

const dnaSource = (): SourceDocument => loadSource(DNA_SOURCE);
const golden = (): LabelDiagramGen => stage6Fixture<LabelDiagramGen>('label-diagram.gen.json');
/** The real figure meta, sha256-verified by the loader. */
const dnaFigure = (): FigureMeta => loadFigure(DNA_FIGURE).meta;

const LD_IDS = ['schema.gen', ...checkIdsFor('label-diagram-v1')];

/** SAM-shaped regions in image pixels: a 40x40 box centred on each part's converted point. */
function regionsFor(gen: LabelDiagramGen, meta: FigureMeta): LabelRegion[] {
  return partsOf(gen).map(p => {
    const px = (Number(p?.x) * meta.width) / 1000;
    const py = (Number(p?.y) * meta.height) / 1000;
    return {
      partId: String(p?.id),
      x1: Math.round(px) - 20,
      y1: Math.round(py) - 20,
      x2: Math.round(px) + 20,
      y2: Math.round(py) + 20,
      confidence: 0.95,
    };
  });
}

function partsOf(gen: LabelDiagramGen): LabelDiagramGen['parts'] {
  return Array.isArray(gen?.parts) ? gen.parts : [];
}

/** Validate through the real dispatcher, with the source's figure list and SAM-shaped regions. */
function validate(gen: LabelDiagramGen, opts: { regions?: LabelRegion[]; figures?: FigureMeta[]; sources?: SourceDocument[] } = {}) {
  return validateKitComponent('label-diagram-v1', gen, opts.sources ?? [dnaSource()], {
    ...(opts.regions !== undefined ? { labelRegions: opts.regions } : {}),
    ...(opts.figures !== undefined ? { figures: opts.figures } : {}),
  });
}

function withRegions(gen: LabelDiagramGen, meta: FigureMeta = dnaFigure()) {
  return { regions: regionsFor(gen, meta), figures: [meta] };
}

/* ------------------------------------------------------------------ */
/* Golden                                                              */
/* ------------------------------------------------------------------ */

test('golden DNA label-diagram passes every check with real regions and the real figure', () => {
  const gen = golden();
  const meta = dnaFigure();
  assert.equal(meta.width, 600);
  assert.equal(meta.height, 600);
  assert.equal(meta.labelsInImage, true);
  assert.ok(listFigures(DNA_SOURCE).some(f => f.id === DNA_FIGURE), 'the DNA figure belongs to the DNA page');
  const report = validate(gen, withRegions(gen, meta));
  assert.deepEqual(report.checks.map(c => c.id), LD_IDS);
  assert.equal(report.publishable, true, failureDetail(report));
  // A direct validator call (the worker's own entry point) agrees.
  const direct = validateLabelDiagram(gen, [dnaSource()], { regions: regionsFor(gen, meta), figures: [meta] });
  assert.equal(direct.publishable, true, failureDetail(direct));
});

/* ------------------------------------------------------------------ */
/* LD-01 quotes-verbatim                                               */
/* ------------------------------------------------------------------ */

test('LD-01: a fabricated part quote fails alone and names the quote field', () => {
  const gen = golden();
  gen.parts[0]!.quote = 'units called base pairs spiral upward';
  const report = expectFailures(validate(gen, withRegions(gen)), ['LD-01']);
  const affected = checkOf(report, 'LD-01').affected ?? [];
  assert.ok(affected.includes('/parts/0/quote'), affected.join(', '));
});

/* ------------------------------------------------------------------ */
/* LD-02 name-in-quote                                                 */
/* ------------------------------------------------------------------ */

test('LD-02: a name that is not a whole phrase of its own quote fails alone', () => {
  const gen = golden();
  gen.parts[2]!.name = 'nucleotide'; // a real page word, but not in the bases quote
  const report = expectFailures(validate(gen, withRegions(gen)), ['LD-02']);
  const affected = checkOf(report, 'LD-02').affected ?? [];
  assert.ok(affected.includes('/parts/2/name'), affected.join(', '));
  // A name that is only a fragment of a longer printed word fails the whole-phrase rule:
  const frag = golden();
  frag.parts[0]!.name = 'base pair'; // the quote prints "base pairs"
  assert.deepEqual(failedIds(validate(frag, withRegions(frag))), ['LD-02']);
});

/* ------------------------------------------------------------------ */
/* LD-03 figure-valid                                                  */
/* ------------------------------------------------------------------ */

test('LD-03: an unknown figureId fails, and missing figures fail closed', () => {
  const gen = golden();
  gen.figureId = 'noaa-hydrologic-cycle-1'; // a real library figure, but not this source's
  const report = validate(gen, { figures: [dnaFigure()] });
  assert.ok(failedIds(report).includes('LD-03'), failureDetail(report));
  assert.ok((checkOf(report, 'LD-03').affected ?? []).includes('/figureId'));
  // No figure list at all => LD-03 fails closed even for the golden figureId:
  const noFigures = validateLabelDiagram(golden(), [dnaSource()], {});
  assert.ok(failedIds(noFigures).includes('LD-03'), failureDetail(noFigures));
  // The exact co-failure set through the dispatcher without regions:
  const r2 = expectFailures(validate(gen, { figures: [dnaFigure()] }), ['LD-03', 'LD-06', 'LD-07']);
  assert.equal(checkOf(r2, 'LD-06').message, 'segmentation did not run');
});

/* ------------------------------------------------------------------ */
/* LD-04 points-valid                                                  */
/* ------------------------------------------------------------------ */

test('LD-04: a point inside any printed-label box fails alone', () => {
  const gen = golden();
  // Move the base-pairs point inside its OWN printed-label box (397,303)-(542,330):
  gen.parts[0]!.x = 450;
  gen.parts[0]!.y = 315;
  const report = expectFailures(validate(gen, withRegions(gen)), ['LD-04']);
  const affected = checkOf(report, 'LD-04').affected ?? [];
  assert.ok(affected.includes('/parts/0/x') && affected.includes('/parts/0/y'), affected.join(', '));
  // A point inside ANOTHER part's label box fails too (thymine point into the adenine box):
  const other = golden();
  other.parts[2]!.x = 650;
  other.parts[2]!.y = 360;
  assert.deepEqual(failedIds(validate(other, withRegions(other))), ['LD-04']);
});

test('LD-04: non-integer or out-of-range points fail (direct call past the Ajv gate)', () => {
  const meta = dnaFigure();
  const gen = golden();
  gen.parts[0]!.x = 1001;
  const r1 = validateLabelDiagram(gen, [dnaSource()], { regions: regionsFor(golden(), meta), figures: [meta] });
  assert.ok(failedIds(r1).includes('LD-04'), failureDetail(r1));
  const gen2 = golden();
  gen2.parts[1]!.y = 317.5;
  const r2 = validateLabelDiagram(gen2, [dnaSource()], { regions: regionsFor(golden(), meta), figures: [meta] });
  assert.ok(failedIds(r2).includes('LD-04'), failureDetail(r2));
  const gen3 = golden();
  gen3.parts[2]!.x = -1;
  const r3 = validateLabelDiagram(gen3, [dnaSource()], { regions: regionsFor(golden(), meta), figures: [meta] });
  assert.ok(failedIds(r3).includes('LD-04'), failureDetail(r3));
});

/* ------------------------------------------------------------------ */
/* LD-05 label-boxes-valid                                             */
/* ------------------------------------------------------------------ */

test('LD-05: a malformed label box fails alone and names its edges', () => {
  const gen = golden();
  gen.parts[1]!.labelX2 = gen.parts[1]!.labelX1; // x1 < x2 violated
  const report = expectFailures(validate(gen, withRegions(gen)), ['LD-05']);
  const affected = checkOf(report, 'LD-05').affected ?? [];
  assert.ok(affected.includes('/parts/1/labelX1'), affected.join(', '));
});

test('LD-05: overlapping label boxes fail alone', () => {
  const gen = golden();
  // Put the adenine box exactly on the thymine box:
  gen.parts[1]!.labelX1 = 762; gen.parts[1]!.labelY1 = 353;
  gen.parts[1]!.labelX2 = 873; gen.parts[1]!.labelY2 = 380;
  const report = expectFailures(validate(gen, withRegions(gen)), ['LD-05']);
  const affected = checkOf(report, 'LD-05').affected ?? [];
  assert.ok(affected.includes('/parts/1/labelX1') && affected.includes('/parts/2/labelX1'), affected.join(', '));
});

test('LD-05: labelsInImage true with fewer than 3 boxes fails alone', () => {
  const gen = golden();
  for (const i of [0, 1, 2, 3]) {
    gen.parts[i]!.labelX1 = 0; gen.parts[i]!.labelY1 = 0;
    gen.parts[i]!.labelX2 = 0; gen.parts[i]!.labelY2 = 0;
  }
  const report = expectFailures(validate(gen, withRegions(gen)), ['LD-05']);
  assert.match(checkOf(report, 'LD-05').message, /at least 3/);
});

/* ------------------------------------------------------------------ */
/* LD-06 regions-found                                                 */
/* ------------------------------------------------------------------ */

test('LD-06/LD-07: no regions option fails both with "segmentation did not run"', () => {
  const report = validate(golden(), { figures: [dnaFigure()] });
  assert.ok(failedIds(report).includes('LD-06') && failedIds(report).includes('LD-07'), failureDetail(report));
  assert.equal(checkOf(report, 'LD-06').message, 'segmentation did not run');
  assert.equal(checkOf(report, 'LD-07').message, 'segmentation did not run');
  assert.equal(report.publishable, false);
});

test('LD-06: a missing region fails alone', () => {
  const gen = golden();
  const meta = dnaFigure();
  const regions = regionsFor(gen, meta).slice(1); // no region for parts[0]
  const report = expectFailures(validate(gen, { regions, figures: [meta] }), ['LD-06']);
  const affected = checkOf(report, 'LD-06').affected ?? [];
  assert.ok(affected.includes('/parts/0/x') && affected.includes('/parts/0/y'), affected.join(', '));
});

test('LD-06: a point outside its region fails alone', () => {
  const gen = golden();
  const meta = dnaFigure();
  const regions = regionsFor(gen, meta);
  regions[0] = { ...regions[0]!, x1: regions[0]!.x1 + 200, x2: regions[0]!.x2 + 200 };
  const report = expectFailures(validate(gen, { regions, figures: [meta] }), ['LD-06']);
  assert.ok((checkOf(report, 'LD-06').affected ?? []).includes('/parts/0/x'));
});

test('LD-06: a region covering 70% of the image fails the area fraction alone', () => {
  const gen = golden();
  const meta = dnaFigure();
  const regions = regionsFor(gen, meta);
  regions[0] = { partId: regions[0]!.partId, x1: 0, y1: 0, x2: 600, y2: 420, confidence: 0.9 };
  const report = expectFailures(validate(gen, { regions, figures: [meta] }), ['LD-06']);
  assert.match(checkOf(report, 'LD-06').message, /0\.5|50%/);
});

test('LD-06: duplicate and stray regions fail closed', () => {
  const gen = golden();
  const meta = dnaFigure();
  const regions = regionsFor(gen, meta);
  const dup = [...regions, { ...regions[0]! }];
  assert.ok(failedIds(validate(gen, { regions: dup, figures: [meta] })).includes('LD-06'));
  const stray = [...regions, { partId: 'part-not-there', x1: 0, y1: 0, x2: 10, y2: 10, confidence: null }];
  assert.ok(failedIds(validate(gen, { regions: stray, figures: [meta] })).includes('LD-06'));
});

/* ------------------------------------------------------------------ */
/* LD-07 regions-distinct                                              */
/* ------------------------------------------------------------------ */

test('LD-07: two regions with IoU above the maximum fail alone', () => {
  const gen = golden();
  const meta = dnaFigure();
  const regions = regionsFor(gen, meta);
  // Two near-identical boxes that still contain their own points (IoU ~ 0.97 > 0.6):
  regions[1] = { ...regions[1]!, x1: 370, x2: 490 };
  regions[2] = { ...regions[2]!, x1: 372, x2: 492 };
  const report = expectFailures(validate(gen, { regions, figures: [meta] }), ['LD-07']);
  const affected = checkOf(report, 'LD-07').affected ?? [];
  assert.ok(affected.includes('/parts/1/x') && affected.includes('/parts/2/x'), affected.join(', '));
});

/* ------------------------------------------------------------------ */
/* LD-08 numbers-checkable                                             */
/* ------------------------------------------------------------------ */

test('LD-08: a title or hint number that is not on the page fails alone', () => {
  const gen = golden();
  gen.title = 'Label the 42 parts of the DNA diagram';
  const report = expectFailures(validate(gen, withRegions(gen)), ['LD-08']);
  assert.ok((checkOf(report, 'LD-08').affected ?? []).includes('/title'));
  const gen2 = golden();
  gen2.hint = 'Tap all 37 parts of the diagram.';
  const report2 = expectFailures(validate(gen2, withRegions(gen2)), ['LD-08']);
  assert.ok((checkOf(report2, 'LD-08').affected ?? []).includes('/hint'));
});

/* ------------------------------------------------------------------ */
/* LD-09 counts-valid                                                  */
/* ------------------------------------------------------------------ */

test('LD-09: too few parts fails alone on a figure without printed labels', () => {
  const meta = { ...dnaFigure(), labelsInImage: false };
  const gen = golden();
  gen.parts = gen.parts.slice(0, 2);
  const report = expectFailures(validate(gen, withRegions(gen, meta)), ['LD-09']);
  assert.ok((checkOf(report, 'LD-09').affected ?? []).includes('/parts'));
});

test('LD-09: too many parts fails alone', () => {
  const meta = dnaFigure();
  const gen = golden();
  const bases = 'four chemical bases: adenine (A), guanine (G), cytosine (C), and thymine (T)';
  const extra = [
    { id: 'part-chemical-bases', name: 'chemical bases', quote: bases, x: 100, y: 100 },
    { id: 'part-double-helix', name: 'double helix', quote: 'Nucleotides are arranged in two long strands that form a spiral called a double helix', x: 900, y: 900 },
    { id: 'part-nucleotide', name: 'nucleotide', quote: 'Together, a base, sugar, and phosphate are called a nucleotide', x: 100, y: 900 },
  ].map(e => ({ ...e, sourceId: DNA_SOURCE, labelX1: 0, labelY1: 0, labelX2: 0, labelY2: 0 }));
  gen.parts = [...gen.parts, ...extra];
  const report = expectFailures(validate(gen, withRegions(gen, meta)), ['LD-09']);
  assert.ok((checkOf(report, 'LD-09').affected ?? []).includes('/parts'));
});

test('LD-09: duplicate names (case-insensitive) fail alone and name both fields', () => {
  const gen = golden();
  gen.parts[3]!.name = 'Adenine'; // same word as parts[1], different case
  const report = expectFailures(validate(gen, withRegions(gen)), ['LD-09']);
  const affected = checkOf(report, 'LD-09').affected ?? [];
  assert.ok(affected.includes('/parts/1/name') && affected.includes('/parts/3/name'), affected.join(', '));
  // Duplicate ids fail too:
  const gen2 = golden();
  gen2.parts[2]!.id = gen2.parts[1]!.id;
  const report2 = validate(gen2, withRegions(gen2));
  assert.ok(failedIds(report2).includes('LD-09'), failureDetail(report2));
  assert.ok((checkOf(report2, 'LD-09').affected ?? []).includes('/parts/2/id'));
});

/* ------------------------------------------------------------------ */
/* Robustness: never throws on junk                                    */
/* ------------------------------------------------------------------ */

test('junk input degrades into failed checks and never throws', () => {
  const junk: unknown[] = [
    undefined,
    null,
    {},
    { schemaVersion: 'label-diagram-v1' },
    { schemaVersion: 'label-diagram-v1', title: 't', figureId: 'x', parts: 'nope', hint: 'h' },
    { schemaVersion: 'label-diagram-v1', title: 't', figureId: DNA_FIGURE, parts: [null, { id: 'a' }, 7], hint: 'h' },
  ];
  for (const g of junk) {
    let report: ValidationReport | undefined;
    assert.doesNotThrow(() => {
      report = validateLabelDiagram(g as LabelDiagramGen, [], {
        regions: [null, { partId: 5 }, { partId: 'a', x1: 'q', y1: null, x2: NaN, y2: Infinity, confidence: 'x' }] as unknown as LabelRegion[],
        figures: [null, { id: DNA_FIGURE }] as unknown as FigureMeta[],
      });
    });
    assert.deepEqual(report!.checks.map(c => c.id), LD_IDS);
    assert.equal(report!.publishable, false);
  }
  // Junk through the dispatcher as well (the Ajv gate short-circuits most shapes):
  for (const g of junk) {
    assert.doesNotThrow(() => validateKitComponent('label-diagram-v1', g, []));
  }
  // Golden gen with junk sources: LD-01 fails (no sources), nothing throws.
  const r = validateLabelDiagram(golden(), [] as SourceDocument[], {});
  assert.ok(failedIds(r).includes('LD-01'), failureDetail(r));
});

test('the revision option is passed through', () => {
  const gen = golden();
  const meta = dnaFigure();
  const report = validateLabelDiagram(gen, [dnaSource()], { revision: 2, regions: regionsFor(gen, meta), figures: [meta] });
  assert.equal(report.revision, 2);
  assert.equal(report.publishable, true, failureDetail(report));
});
