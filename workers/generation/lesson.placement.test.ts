// Stage 8c Addendum B (worker): the number of each part sits on the ink of SAM's confirmed mask and its area on Muse's
// grounding union. Everything runs on REAL data from the live probes: Muse's recorded grounding answers
// (docs/evidence/muse-grounding-probe/result.json) and SAM's recorded streams with real masks (raw-*.sam.txt) for the DNA
// figure, replayed through the real worker with a fake Muse client and a fake SAM fetch.
//   1. pure `placeLabelParts` / `restoreEchoedPlacement`;
//   2. worker: placed values are validated + persisted + published, genPositions recorded, event text, a low-confidence
//      part and a part Muse did not locate keep Muse's generation values;
//   3. repair: the comparator is not tripped by the worker's own placement (re-placed every revision), and a reply that
//      really edits a placed field is still judged by the comparator.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeMaskToRaster } from '@meta-sam/parser';
import { startJob } from './jobs.ts';
import type { JobStageEvent, JobSummary } from './jobs.ts';
import { placeLabelParts, restoreEchoedPlacement, boxesToRegions } from './lesson.ts';
import { parseSamOutput } from '../../packages/meta/sam.ts';
import type { SamBox } from '../../packages/meta/sam.ts';
import { groundingUnions } from '../../packages/meta/grounding.ts';
import type { GroundingBox } from '../../packages/meta/grounding.ts';
import type { CompleteRequest, MetaClient } from '../../packages/meta/client.ts';
import type { Ledger } from '../../packages/meta/ledger.ts';
import { loadFigure } from '../../packages/sources/figures.ts';
import type { MetaReceipt } from '../../packages/contracts/index.ts';
import type { LabelDiagramGen, LabelRegion, SourceAnalysisV2 } from '../../packages/contracts/kit.ts';

const DNA = 'medlineplus-what-is-dna';
const FIGURE_ID = 'medlineplus-dna-structure-1';
const EVIDENCE = new URL('../../docs/evidence/muse-grounding-probe/', import.meta.url);
const golden = JSON.parse(
  readFileSync(new URL('../../tests/fixtures/stage6/label-diagram.gen.json', import.meta.url), 'utf8'),
) as LabelDiagramGen;
const probe = JSON.parse(readFileSync(new URL('result.json', EVIDENCE), 'utf8')) as {
  results: { figure: string; rep: number; muse: unknown }[];
};
const figure = loadFigure(FIGURE_ID);
const W = figure.meta.width;
const H = figure.meta.height;
assert.equal(W, 600);
assert.equal(H, 600);
const N = golden.parts.length;
const NAMES = golden.parts.map(p => p.name);

/** Real recorded data for DNA repetition 1 / 2: Muse's grounding answer, SAM's raw stream and its parsed records. */
function recorded(rep: 1 | 2): { muse: unknown; raw: string; boxes: SamBox[]; unions: (GroundingBox | null)[] } {
  const muse = probe.results.find(r => r.figure === FIGURE_ID && r.rep === rep)!.muse;
  const raw = readFileSync(new URL(`raw-${FIGURE_ID}-${rep}.sam.txt`, EVIDENCE), 'utf8').trim();
  return { muse, raw, boxes: parseSamOutput(raw), unions: groundingUnions(muse, N, NAMES) };
}
const REC1 = recorded(1);
const REC2 = recorded(2);

function inkAt(box: SamBox, gridX: number, gridY: number): boolean {
  const m = box.mask!;
  const raster = decodeMaskToRaster({ encoding: m.encoding, payload: m.payload, width: m.width, height: m.height });
  const c = Math.floor((gridX * W) / 1000) - box.x1;
  const r = Math.floor((gridY * H) / 1000) - box.y1;
  return c >= 0 && r >= 0 && c < m.width && r < m.height && raster[r * m.width + c] === 1;
}
const boxOf = (rec: ReturnType<typeof recorded>, i: number): SamBox => rec.boxes.find(b => b.id === i + 1)!;

/* ------------------------------------------------------------------ */
/* 1. Pure helpers                                                      */
/* ------------------------------------------------------------------ */

function regionsOf(rec: ReturnType<typeof recorded>, gen: LabelDiagramGen = golden): LabelRegion[] {
  return boxesToRegions(
    rec.boxes,
    gen.parts,
    rec.unions.map(u => (u === null ? null : { x1: Math.round(u.x1 * 0.6), y1: Math.round(u.y1 * 0.6), x2: Math.round(u.x2 * 0.6), y2: Math.round(u.y2 * 0.6) })),
  );
}

test('placeLabelParts: confident, located parts take the ink point and Muse\'s union; genPositions keeps Muse\'s own values', () => {
  const before = structuredClone(golden);
  const { gen, genPositions } = placeLabelParts(golden, REC1.boxes, regionsOf(REC1), REC1.unions, W, H);
  assert.deepEqual(golden, before, 'the input gen is never mutated');
  assert.equal(genPositions.length, N, 'all six parts of the recorded run 1 are confident and located');
  gen.parts.forEach((p, i) => {
    const u = REC1.unions[i]!;
    assert.deepEqual([p.areaX1, p.areaY1, p.areaX2, p.areaY2], [u.x1, u.y1, u.x2, u.y2], `${p.name}: area = Muse's union`);
    assert.ok(inkAt(boxOf(REC1, i), p.x, p.y), `${p.name}: the number is on SAM's mask ink`);
    assert.ok(p.x >= u.x1 && p.x <= u.x2 && p.y >= u.y1 && p.y <= u.y2, `${p.name}: inside its area`);
    // everything else is untouched
    assert.equal(p.name, golden.parts[i]!.name);
    assert.equal(p.quote, golden.parts[i]!.quote);
    assert.deepEqual([p.labelX1, p.labelY1, p.labelX2, p.labelY2], [golden.parts[i]!.labelX1, golden.parts[i]!.labelY1, golden.parts[i]!.labelX2, golden.parts[i]!.labelY2]);
    const g = golden.parts[i]!;
    assert.deepEqual(genPositions[i], {
      partId: p.id,
      x: g.x,
      y: g.y,
      areaX1: g.areaX1,
      areaY1: g.areaY1,
      areaX2: g.areaX2,
      areaY2: g.areaY2,
    });
  });
  // one value worked by hand: Muse's guanine union in run 1 is the recorded bar (0..1000)
  const guanine = gen.parts[3]!;
  assert.deepEqual([guanine.areaX1, guanine.areaX2], [REC1.unions[3]!.x1, REC1.unions[3]!.x2]);
});

test('placeLabelParts: a low-confidence part, a part without ground, a part without a mask and a part Muse did not locate keep Muse\'s values', () => {
  const rec = REC2; // run 2: adenine 0.45 (weak)
  const regions = regionsOf(rec);
  const adenine = regions.find(r => r.partId === golden.parts[1]!.id)!;
  assert.ok((adenine.confidence ?? 1) < 0.5);
  const unions = [...rec.unions];
  // part 4 (cytosine): Muse located nothing; part 2 (thymine): region without ground; part 5: SAM record without a mask
  unions[4] = null;
  const regionsNoGround = regions.map(r => (r.partId === golden.parts[2]!.id ? (({ ground: _g, ...rest }) => rest)(r) : r));
  const boxes = rec.boxes.map(b => (b.id === 6 ? (({ mask: _m, ...rest }) => rest)(b) : b)) as SamBox[];
  const { gen, genPositions } = placeLabelParts(golden, boxes, regionsNoGround, unions, W, H);
  const placedIds = genPositions.map(p => p.partId);
  assert.deepEqual(placedIds, [golden.parts[0]!.id, golden.parts[3]!.id], 'only base pairs and guanine qualify');
  for (const i of [1, 2, 4, 5]) {
    assert.deepEqual(gen.parts[i], golden.parts[i], `${golden.parts[i]!.name} is unchanged`);
  }
  assert.notDeepEqual(gen.parts[0], golden.parts[0]);
});

test('placeLabelParts: a mask that does not belong to its box places nothing', () => {
  const boxes = REC1.boxes.map(b => ({ ...b, x2: b.x2 + 5 })) as SamBox[];
  const { gen, genPositions } = placeLabelParts(golden, boxes, regionsOf(REC1), REC1.unions, W, H);
  assert.equal(genPositions.length, 0);
  assert.deepEqual(gen, golden);
});

test('restoreEchoedPlacement: a reply that repeats the worker\'s placement is restored to the baseline; a real edit is left alone', () => {
  const r1 = placeLabelParts(golden, REC1.boxes, regionsOf(REC1), REC1.unions, W, H);
  const r2 = placeLabelParts(golden, REC2.boxes, regionsOf(REC2), REC2.unions, W, H);
  assert.notDeepEqual(r1.gen.parts[1], r2.gen.parts[1], 'the two revisions place adenine differently');
  const placed = new Set(r2.genPositions.map(p => p.partId));
  // Muse echoes the input (placed r2) and fixes nothing else: every echoed part goes back to the baseline (placed r1) values
  const echoed = restoreEchoedPlacement(r1.gen, structuredClone(r2.gen), r2.gen, placed);
  for (const id of placed) {
    const i = r1.gen.parts.findIndex(p => p.id === id);
    assert.deepEqual(echoed.parts[i], r1.gen.parts[i], `${id} restored`);
  }
  // an edited placed number is NOT restored (the comparator will judge it)
  const edited = structuredClone(r2.gen);
  edited.parts[0]!.x = edited.parts[0]!.x + 9;
  const out = restoreEchoedPlacement(r1.gen, edited, r2.gen, placed);
  assert.equal(out.parts[0]!.x, edited.parts[0]!.x);
  // a part that was not placed in the input revision is never restored
  const none = restoreEchoedPlacement(r1.gen, structuredClone(r2.gen), r2.gen, new Set());
  assert.deepEqual(none, r2.gen);
  // inputs are never mutated
  assert.notDeepEqual(echoed, r2.gen);
});

/* ------------------------------------------------------------------ */
/* 2. Worker                                                            */
/* ------------------------------------------------------------------ */

const dnaAnalysis = {
  analysisVersion: 2,
  subject: 'biology',
  usable: true,
  declineCode: '',
  declineSummary: '',
  pageCoverage: 'The page explains what DNA is, how its bases pair up and how DNA replicates when cells divide.',
  overview: {
    headline: 'DNA stores hereditary information as a code of four chemical bases.',
    keyPoints: [
      { id: 'base-pairs', point: 'Bases pair up in fixed combinations to form units called base pairs.', sourceId: DNA, quote: 'DNA bases pair up with each other, A with T and C with G, to form units called base pairs' },
      { id: 'double-helix', point: 'Two long strands of nucleotides form a spiral called a double helix.', sourceId: DNA, quote: 'Nucleotides are arranged in two long strands that form a spiral called a double helix' },
      { id: 'replication', point: 'DNA can replicate, or make copies of itself, when cells divide.', sourceId: DNA, quote: 'An important property of DNA is that it can replicate, or make copies of itself' },
    ],
    keyTerms: [
      { id: 'nucleotide', term: 'nucleotide', gloss: 'A unit made of one base, one sugar and one phosphate.', sourceId: DNA, quote: 'Together, a base, sugar, and phosphate are called a nucleotide' },
      { id: 'double-helix', term: 'double helix', gloss: 'The spiral shape formed by the two strands of DNA.', sourceId: DNA, quote: 'Nucleotides are arranged in two long strands that form a spiral called a double helix' },
      { id: 'mitochondrial-dna', term: 'mitochondrial DNA', gloss: 'The small amount of DNA found in the mitochondria.', sourceId: DNA, quote: 'a small amount of DNA can also be found in the mitochondria (where it is called mitochondrial DNA or mtDNA)' },
    ],
  },
  componentPlan: [
    {
      componentId: 'label-diagram-v1',
      pedagogicalReason: 'Students match the named parts of the DNA diagram to the page wording.',
      focusQuote: 'DNA is a double helix formed by base pairs attached to a sugar-phosphate backbone',
      focusSourceId: DNA,
    },
  ],
} as unknown as SourceAnalysisV2;

function receipt(id: string): MetaReceipt {
  return {
    purpose: 'test-live',
    requestedModel: 'muse-spark-1.3',
    returnedModel: 'muse-spark-1.3',
    responseId: id,
    usage: { promptTokens: 1200, completionTokens: 800, reasoningTokens: 300, cachedTokens: 0 },
    latencyMs: 42,
    estCostUSD: 0.01,
    finishReason: 'stop',
    attempts: 1,
  };
}

interface Script {
  /** Muse's label_diagram answer (revision 1). */
  gen: LabelDiagramGen;
  /** The nth label_grounding answer (1-based); undefined = an empty `objects`. */
  grounding: (n: number) => unknown;
  /** The nth label_diagram_repair answer (1-based) given the previous published gen artifacts read from disk. */
  repair?: (n: number, readGen: (revision: number) => LabelDiagramGen) => LabelDiagramGen;
  /** SAM's streamed text per call (1-based); '' = no records. */
  sam: (call: number) => string;
}

async function run(
  jobId: string,
  script: Script,
  maxRepairAttempts = 0,
): Promise<{
  summary: JobSummary;
  events: JobStageEvent[];
  seg: JobStageEvent[];
  art: (revision: number) => any;
  label: any;
  samPrompts: string[];
}> {
  const storageDir = mkdtempSync(join(tmpdir(), 's8c-place-'));
  const runDir = join(storageDir, 'runs', jobId);
  const readArtifact = (revision: number): any => JSON.parse(readFileSync(join(runDir, `label-diagram-v1.r${revision}.json`), 'utf8'));
  let groundingN = 0;
  let repairN = 0;
  const client = {
    complete: async <T,>(req: CompleteRequest): Promise<{ data: T; receipt: MetaReceipt }> => {
      let data: unknown;
      if (req.schemaName === 'label_grounding') {
        groundingN += 1;
        data = script.grounding(groundingN) ?? { objects: [] };
      } else if (req.schemaName === 'source_analysis_v2' || req.schemaName === 'source_analysis_v2_repair') data = dnaAnalysis;
      else if (req.schemaName === 'label_diagram') data = script.gen;
      else if (req.schemaName === 'label_diagram_repair') {
        repairN += 1;
        if (script.repair === undefined) throw new Error('FAKE_MISSING_RESPONSE:label_diagram_repair');
        data = script.repair(repairN, rev => readArtifact(rev).gen as LabelDiagramGen);
      } else throw new Error(`FAKE_MISSING_RESPONSE:${req.schemaName}`);
      return { data: structuredClone(data) as T, receipt: receipt(`${req.schemaName}-${groundingN}-${repairN}`) };
    },
  } as unknown as MetaClient;
  const samPrompts: string[] = [];
  const samFetch = (async (_url: unknown, init?: { body?: unknown }) => {
    const body = JSON.parse(String(init?.body)) as { input: { content: { text: string }[] }[] };
    samPrompts.push(body.input[0]!.content[0]!.text);
    const text = script.sam(samPrompts.length);
    const delta = text === '' ? '<0f>' : text.startsWith('<0f>') ? text : `<0f>${text}`;
    const sse =
      [
        `data: ${JSON.stringify({ type: 'response.output_text.delta', delta })}`,
        `data: ${JSON.stringify({ type: 'response.completed', usage: { images_processed: 1 } })}`,
      ].join('\n') + '\n';
    return { ok: true, status: 200, text: async (): Promise<string> => sse } as unknown as Response;
  }) as unknown as typeof fetch;
  const holds = new Map<string, number>();
  const ledger: Ledger = {
    capUSD: 150,
    reserve: (req): string => {
      const id = `res-${holds.size + 1}`;
      holds.set(id, req.estUSD);
      return id;
    },
    reconcile: (): void => {},
    committedUSD: () => 0,
    close: () => {},
  };
  const { done } = startJob(
    DNA,
    {
      client,
      storageDir,
      purpose: 'test-live',
      flow: 'lesson',
      newJobId: () => jobId,
      sam: { apiKey: 'synthetic-sam-test-key', ledger, fetch: samFetch },
      limits: { maxRepairAttempts },
    },
    () => {},
  );
  const summary = await done;
  const events = readFileSync(join(runDir, 'events.jsonl'), 'utf8')
    .split('\n')
    .filter(l => l.trim() !== '')
    .map(l => JSON.parse(l) as JobStageEvent);
  const lesson = JSON.parse(readFileSync(join(runDir, 'lesson.json'), 'utf8')) as { components: any[] };
  return {
    summary,
    events,
    seg: events.filter(e => e.stage === ('segment' as never) && e.status !== 'started'),
    art: readArtifact,
    label: lesson.components.find((c: any) => c.componentId === 'label-diagram-v1'),
    samPrompts,
  };
}

test('worker: placed values are what is validated, persisted and published; genPositions and the event text record it', async () => {
  const r = await run('lesson-place-ok', {
    gen: golden,
    grounding: () => REC1.muse,
    sam: () => REC1.raw,
  });
  assert.equal(r.summary.status, 'succeeded');
  const a = r.art(1);
  assert.equal(a.report.publishable, true, JSON.stringify(a.report.checks.filter((c: any) => !c.passed)));
  assert.equal(r.label.status, 'passed');
  // persisted gen, the spec built from it and the published lesson all carry the placed numbers and areas
  const lessonSpecParts = (r.label.spec ?? a.spec).parts as { id: string; x: number; y: number; areaX1: number }[];
  golden.parts.forEach((g, i) => {
    const u = REC1.unions[i]!;
    const p = a.gen.parts[i];
    assert.ok(inkAt(boxOf(REC1, i), p.x, p.y), `${g.name}: persisted number is on the mask ink`);
    assert.deepEqual([p.areaX1, p.areaY1, p.areaX2, p.areaY2], [u.x1, u.y1, u.x2, u.y2]);
    assert.deepEqual([a.spec.parts[i].x, a.spec.parts[i].y], [p.x, p.y], 'the published spec carries the placed point');
    assert.deepEqual([lessonSpecParts[i]!.x, lessonSpecParts[i]!.y], [p.x, p.y], 'so does the lesson');
    // Muse's own point stays when it was already on the ink (and off printed text); otherwise it was moved.
    if (!inkAt(boxOf(REC1, i), g.x, g.y)) {
      assert.notDeepEqual([p.x, p.y], [g.x, g.y], `${g.name}: a point off the ink was moved onto it`);
    }
  });
  // Muse's own generation values, for the placed parts only
  assert.deepEqual(
    a.genPositions,
    golden.parts.map(g => ({ partId: g.id, x: g.x, y: g.y, areaX1: g.areaX1, areaY1: g.areaY1, areaX2: g.areaX2, areaY2: g.areaY2 })),
  );
  // event text: located, then "sure", then "placed"
  assert.equal(r.seg.length, 1);
  assert.equal(
    r.seg[0]!.detail,
    'sam-3.1 returned 6 of 6 region(s); muse-spark-1.3 located 6 of 6 part(s) for SAM; sam-3.1 sure of 6 of 6 part(s); placed 6 number(s) on the located parts',
  );
});

test('worker: a low-confidence part keeps Muse\'s values; the event counts only the confident regions; order is located, sure, placed, retried', async () => {
  // Run 2 of the recorded probe: adenine was only 0.45 sure. The retry call finds nothing better (no records).
  const r = await run('lesson-place-weak', {
    gen: golden,
    grounding: () => REC2.muse,
    sam: call => (call === 1 ? REC2.raw : ''),
  });
  assert.equal(r.samPrompts.length, 2, 'first pass + the best-of retry for the weak part');
  const a = r.art(1);
  const adenine = a.gen.parts[1];
  assert.deepEqual(
    [adenine.x, adenine.y, adenine.areaX1, adenine.areaY1, adenine.areaX2, adenine.areaY2],
    [golden.parts[1]!.x, golden.parts[1]!.y, golden.parts[1]!.areaX1, golden.parts[1]!.areaY1, golden.parts[1]!.areaX2, golden.parts[1]!.areaY2],
    'adenine (0.45) is not placed',
  );
  assert.ok(!a.genPositions.some((p: any) => p.partId === golden.parts[1]!.id));
  assert.equal(a.genPositions.length, 5);
  for (const i of [0, 2, 3, 4, 5]) {
    assert.ok(inkAt(boxOf(REC2, i), a.gen.parts[i].x, a.gen.parts[i].y), `${golden.parts[i]!.name} placed on ink`);
  }
  assert.match(
    r.seg[0]!.detail ?? '',
    /^sam-3\.1 returned 6 of 6 region\(s\); muse-spark-1\.3 located 6 of 6 part\(s\) for SAM; sam-3\.1 sure of 5 of 6 part\(s\); placed 5 number\(s\) on the located parts; sam-3\.1 retried 1 weak part\(s\): .+$/,
  );
  // LD-11 still honestly fails for the weak part, so the component does not publish
  assert.ok(a.report.checks.some((c: any) => c.id === 'LD-11' && !c.passed));
  assert.equal(r.label.status, 'failed');
});

test('worker: when Muse located nothing there is no ground, nothing is placed, no genPositions and no "placed" text', async () => {
  const r = await run('lesson-place-noground', {
    gen: golden,
    grounding: () => ({ objects: [] }),
    sam: () => REC1.raw,
  });
  const a = r.art(1);
  assert.deepEqual(a.gen, golden, 'the persisted gen is Muse\'s generation, unchanged');
  assert.equal(a.genPositions, undefined);
  assert.match(r.seg[0]!.detail ?? '', /located 0 of 6 part\(s\) for SAM; sam-3\.1 sure of 6 of 6 part\(s\)$/);
  assert.ok(!(r.seg[0]!.detail ?? '').includes('placed'));
});

/* ------------------------------------------------------------------ */
/* 3. Repair                                                            */
/* ------------------------------------------------------------------ */

const BAD_QUOTE_1 = 'a phrase that does not occur anywhere on the page';
const BAD_QUOTE_2 = 'another phrase that is not on the page either';
function brokenGen(quote: string, base: LabelDiagramGen = golden): LabelDiagramGen {
  const g = structuredClone(base);
  g.parts[0]!.quote = quote;
  return g;
}

/**
 * Revision 1 fails LD-01 (bad quote). Repair 1 copies the PLACED revision it was shown and only changes the quote (still
 * wrong); repair 2 copies PLACED revision 2 and writes the right quote. Revisions 1 and 2 use DIFFERENT recorded SAM
 * runs, so the worker places adenine/thymine/base pairs differently on revision 2: without the echo rule the
 * comparator (which compares with the immutable revision 1) would reject a faithful copy of the shown revision.
 */
function copyScript(editPlaced?: (g: LabelDiagramGen) => void): Script {
  return {
    gen: brokenGen(BAD_QUOTE_1),
    grounding: n => (n === 2 ? REC2.muse : REC1.muse),
    sam: call => (call === 2 ? REC2.raw : call === 3 ? '' : REC1.raw),
    repair: (n, readGen) => {
      const shown = readGen(n); // the placed revision the repair model is shown
      const g = structuredClone(shown);
      g.parts[0]!.quote = n === 1 ? BAD_QUOTE_2 : golden.parts[0]!.quote;
      if (n === 2) editPlaced?.(g);
      return g;
    },
  };
}

test('repair: a faithful copy of the shown (placed) revision passes the comparator even though placement moved between revisions', async () => {
  const r = await run('lesson-place-repair', copyScript(), 2);
  const r1 = r.art(1);
  const r2 = r.art(2);
  const r3 = r.art(3);
  assert.notDeepEqual(
    [r1.gen.parts[2].x, r1.gen.parts[2].y],
    [r2.gen.parts[2].x, r2.gen.parts[2].y],
    'precondition: revision 2 placed thymine somewhere else than revision 1',
  );
  assert.equal(r1.report.publishable, false);
  assert.ok(r1.report.checks.some((c: any) => c.id === 'LD-01' && !c.passed));
  const cmp3 = r3.report.checks.find((c: any) => /repair|revision|compare/i.test(c.id) && c.id !== 'schema.gen');
  assert.ok(cmp3 === undefined || cmp3.passed, `the revision comparator passed: ${JSON.stringify(cmp3)}`);
  assert.equal(r3.report.publishable, true, JSON.stringify(r3.report.checks.filter((c: any) => !c.passed)));
  assert.equal(r.label.status, 'passed');
  assert.equal(r.label.revision, 3);
  // the published gen is the placed one on revision 3's own masks (run 1 again), with genPositions recorded per revision
  r3.gen.parts.forEach((p: any, i: number) => assert.ok(inkAt(boxOf(REC1, i), p.x, p.y), `${p.id} on revision 3's ink`));
  assert.equal(r1.genPositions.length, 6);
  assert.ok(r2.genPositions.length > 0);
  assert.equal(r3.genPositions.length, 6);
  // genPositions hold Muse's generation values: revision 1's are the golden ones; later revisions' are what Muse copied (the shown placed values)
  assert.equal(r1.genPositions[0].x, golden.parts[0]!.x);
});

test('repair: a reply that really edits a placed number is still judged by the comparator (the echo rule is not a free pass)', async () => {
  const r = await run(
    'lesson-place-repair-edit',
    copyScript(g => {
      g.parts[2]!.x = Math.min(1000, g.parts[2]!.x + 11); // moves thymine's placed number; not an authorised path
    }),
    2,
  );
  const r3 = r.art(3);
  assert.equal(r3.report.publishable, false);
  const failed = r3.report.checks.filter((c: any) => !c.passed);
  assert.ok(failed.some((c: any) => !/^LD-/.test(c.id)), `the comparator rejected the edit: ${JSON.stringify(failed.map((c: any) => c.id))}`);
  assert.equal(r.label.status, 'failed');
});
