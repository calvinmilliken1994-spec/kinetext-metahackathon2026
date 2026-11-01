// Stage 8b — label-diagram-v1 in the lesson flow: FAKE MetaClient + FAKE SAM fetch + FAKE
// ledger, the real licence-checked DNA figure (data/figures), the real library source
// (medlineplus-what-is-dna) and the golden label-diagram gen fixture. Covers: figures to the
// Muse analysis call and A-08 validation, the figure image on generation AND repair calls,
// one SAM 3.1 segmentation per revision with ledger reserve/reconcile mirrored through the
// job's ONE cost accumulator, regions into validation and the published spec, SAM 500 as a
// COMPONENT-level failure (partial publish, charge recorded), missing SAM deps as INTERNAL,
// a missing SAM box gating publication through LD-06, and Spark Open (Modal) jobs getting
// the same figures and images through the Modal client (SAM stays on the Meta API ledger). No network, no credits, no .env access.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startJob } from './jobs.ts';
import type { JobStageEvent, JobSummary } from './jobs.ts';
import {
  boxesToRegions,
  FIGURE_UNAVAILABLE_REASON,
  samObjectsFor,
  SEGMENTATION_FAILED_REASON,
  validateLessonAnalysis,
} from './lesson.ts';
import type { SamSegmentDeps } from './lesson.ts';
import type { ChatMessage, CompleteRequest, MetaClient } from '../../packages/meta/client.ts';
import type { Ledger } from '../../packages/meta/ledger.ts';
import { loadSource } from '../../packages/sources/index.ts';
import { loadFigure } from '../../packages/sources/figures.ts';
import type { MetaReceipt } from '../../packages/contracts/index.ts';
import type { LabelDiagramGen, SourceAnalysisV2 } from '../../packages/contracts/kit.ts';
import { maskToOutline } from '../../packages/meta/sam-outline.ts';
import { parseSamOutput } from '../../packages/meta/sam.ts';

const DNA = 'medlineplus-what-is-dna';
const FIGURE_ID = 'medlineplus-dna-structure-1';
const goldenLabelGen = JSON.parse(
  readFileSync(new URL('../../tests/fixtures/stage6/label-diagram.gen.json', import.meta.url), 'utf8'),
) as LabelDiagramGen;
const figure = loadFigure(FIGURE_ID); // sha256-verified real bytes
const FIG_W = figure.meta.width; // 600
const FIG_H = figure.meta.height; // 600

/* ------------------------------------------------------------------ */
/* Fixtures (grounded in the real DNA page; verified publishable)       */
/* ------------------------------------------------------------------ */

const dnaAnalysis: SourceAnalysisV2 = {
  analysisVersion: 2,
  subject: 'biology',
  usable: true,
  declineCode: '',
  declineSummary: '',
  pageCoverage: 'The page explains what DNA is, how its bases pair up and how DNA replicates when cells divide.',
  overview: {
    headline: 'DNA stores hereditary information as a code of four chemical bases.',
    keyPoints: [
      {
        id: 'base-pairs',
        point: 'Bases pair up in fixed combinations to form units called base pairs.',
        sourceId: DNA,
        quote: 'DNA bases pair up with each other, A with T and C with G, to form units called base pairs',
      },
      {
        id: 'double-helix',
        point: 'Two long strands of nucleotides form a spiral called a double helix.',
        sourceId: DNA,
        quote: 'Nucleotides are arranged in two long strands that form a spiral called a double helix',
      },
      {
        id: 'replication',
        point: 'DNA can replicate, or make copies of itself, when cells divide.',
        sourceId: DNA,
        quote: 'An important property of DNA is that it can replicate, or make copies of itself',
      },
    ],
    keyTerms: [
      {
        id: 'nucleotide',
        term: 'nucleotide',
        gloss: 'A unit made of one base, one sugar and one phosphate.',
        sourceId: DNA,
        quote: 'Together, a base, sugar, and phosphate are called a nucleotide',
      },
      {
        id: 'double-helix',
        term: 'double helix',
        gloss: 'The spiral shape formed by the two strands of DNA.',
        sourceId: DNA,
        quote: 'Nucleotides are arranged in two long strands that form a spiral called a double helix',
      },
      {
        id: 'mitochondrial-dna',
        term: 'mitochondrial DNA',
        gloss: 'The small amount of DNA found in the mitochondria.',
        sourceId: DNA,
        quote: 'a small amount of DNA can also be found in the mitochondria (where it is called mitochondrial DNA or mtDNA)',
      },
    ],
  },
  componentPlan: [
    {
      componentId: 'label-diagram-v1',
      pedagogicalReason: 'Students match the named parts of the DNA diagram to the page wording.',
      focusQuote: 'DNA is a double helix formed by base pairs attached to a sugar-phosphate backbone',
      focusSourceId: DNA,
    },
    {
      componentId: 'quiz-cards-v1',
      pedagogicalReason: 'A quick quiz checks base pairing and the double helix structure.',
      focusQuote: 'DNA bases pair up with each other, A with T and C with G',
      focusSourceId: DNA,
    },
  ],
} as unknown as SourceAnalysisV2;

/** The same analysis without the label-diagram plan (a plan that leaves the diagram out). */
const dnaAnalysisNoLabel: SourceAnalysisV2 = structuredClone(dnaAnalysis);
dnaAnalysisNoLabel.componentPlan = dnaAnalysisNoLabel.componentPlan.filter(
  e => e.componentId !== 'label-diagram-v1',
);

const dnaQuizGen = {
  schemaVersion: 'quiz-cards-v1',
  title: 'DNA structure quiz',
  cards: [
    {
      id: 'base-pairs-card',
      stem: 'Which units do paired DNA bases form?',
      options: ['base pairs', 'chromosomes', 'ribosomes'],
      sourceId: DNA,
      quote: 'to form units called base pairs',
      hint: 'The pairing builds repeating units.',
    },
    {
      id: 'double-helix-card',
      stem: 'What spiral shape do the two DNA strands form?',
      options: ['double helix', 'base pair', 'cell membrane'],
      sourceId: DNA,
      quote: 'Nucleotides are arranged in two long strands that form a spiral called a double helix',
      hint: 'The name describes the spiral.',
    },
    {
      id: 'hereditary-material-card',
      stem: 'What kind of material is DNA in humans and almost all other organisms?',
      options: ['hereditary material', 'muscle tissue', 'bone marrow'],
      sourceId: DNA,
      quote: 'DNA, or deoxyribonucleic acid, is the hereditary material in humans and almost all other organisms',
      hint: 'It passes traits to new cells.',
    },
  ],
};

/** A revision whose first part quote is not on the page (LD-01/LD-02 must fail). */
function brokenQuoteLabelGen(): LabelDiagramGen {
  const gen = structuredClone(goldenLabelGen);
  gen.parts[0].quote = 'a phrase that does not occur anywhere on the page';
  return gen;
}

/** A revision whose last part point moved slightly (the LD-06 repair target of test 6). */
function shiftedPointLabelGen(): LabelDiagramGen {
  const gen = structuredClone(goldenLabelGen);
  gen.parts[5].x = 360;
  return gen;
}

/* ------------------------------------------------------------------ */
/* Fakes                                                                */
/* ------------------------------------------------------------------ */

function fakeReceipt(responseId: string, estCostUSD = 0.01): MetaReceipt {
  return {
    purpose: 'test-live',
    requestedModel: 'muse-spark-1.3',
    returnedModel: 'muse-spark-1.3',
    responseId,
    usage: { promptTokens: 1200, completionTokens: 800, reasoningTokens: 300, cachedTokens: 0 },
    latencyMs: 42,
    estCostUSD,
    finishReason: 'stop',
    attempts: 1,
  };
}

interface CapturedRequest {
  schemaName: string;
  messages: ChatMessage[];
}

interface LessonFake extends MetaClient {
  calls: string[];
  requests: CapturedRequest[];
  provider?: 'meta-api' | 'modal';
  providerModel?: string;
  model?: 'muse-spark-1.3' | 'muse-spark-open';
}

function fakeClient(opts: {
  analysis: unknown;
  analysisRepair?: unknown;
  kit: Record<string, unknown>;
  kitRepair?: Record<string, unknown>;
  provider?: 'modal';
}): LessonFake {
  const calls: string[] = [];
  const requests: CapturedRequest[] = [];
  let n = 0;
  const client: LessonFake = {
    calls,
    requests,
    ...(opts.provider === 'modal'
      ? {
          provider: 'modal' as const,
          model: 'muse-spark-open' as const,
          providerModel: 'meta-models/Muse-Spark-Open-816B-A42B',
        }
      : {}),
    complete: async <T,>(req: CompleteRequest): Promise<{ data: T; receipt: MetaReceipt }> => {
      calls.push(req.schemaName);
      requests.push({ schemaName: req.schemaName, messages: structuredClone(req.messages) });
      let data: unknown;
      if (req.schemaName === 'source_analysis_v2') {
        data = opts.analysis;
      } else if (req.schemaName === 'source_analysis_v2_repair') {
        data = opts.analysisRepair ?? opts.analysis;
      } else if (req.schemaName === 'label_grounding') {
        // Stage 8c Addendum A: every label revision makes one Muse grounding call before SAM. These tests are about
        // other things: Muse locates nothing, so SAM keeps getting the generation areas (a normal paid 0.01 call).
        data = { objects: [] };
      } else if (req.schemaName.endsWith('_repair')) {
        data = opts.kitRepair?.[req.schemaName];
      } else {
        data = opts.kit[req.schemaName];
      }
      if (data === undefined) {
        throw new Error(`FAKE_MISSING_RESPONSE:${req.schemaName}`);
      }
      n += 1;
      return { data: structuredClone(data) as T, receipt: fakeReceipt(`${req.schemaName}-${n}`) };
    },
  };
  return client;
}

function fakeLedger(): { ledger: Ledger; reserveCalls: Record<string, unknown>[]; reconcileCalls: Record<string, unknown>[] } {
  const reserveCalls: Record<string, unknown>[] = [];
  const reconcileCalls: Record<string, unknown>[] = [];
  let n = 0;
  const ledger: Ledger = {
    capUSD: 150,
    reserve: (req): string => {
      reserveCalls.push({ ...req });
      n += 1;
      return `sam-res-${n}`;
    },
    reconcile: (reservationId, actual): void => {
      reconcileCalls.push({ reservationId, ...actual });
    },
    committedUSD: () => 0,
    close: () => {},
  };
  return { ledger, reserveCalls, reconcileCalls };
}

interface SamBoxSpec {
  id: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  confidence?: number;
  /** Raw `data=` value of the mask token (`H,W,~payload`); defaults to an unreadable placeholder. */
  maskData?: string;
}

/** The SAM SSE stream shape parseSamStream/parseSamOutput expect (box token + mask token). */
function samSseBody(boxes: SamBoxSpec[], imagesProcessed = 1): string {
  const line =
    '<0f>' +
    boxes
      .map(b => {
        const c = b.confidence !== undefined ? `;c=${b.confidence}` : '';
        return (
          `${b.id}<|box;x1=${b.x1};y1=${b.y1};x2=${b.x2};y2=${b.y2};w=${FIG_W};h=${FIG_H}${c}|>` +
          `<|mask;x=0;y=0${c};data=${b.maskData ?? '27,60,~!!!!M!0c[0o9'}|>`
        );
      })
      .join(',');
  return (
    [
      `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: line })}`,
      `data: ${JSON.stringify({ type: 'response.completed', usage: { images_processed: imagesProcessed } })}`,
    ].join('\n') + '\n'
  );
}

function fakeSamFetch(respond: (body: Record<string, unknown>) => { status: number; body?: string }): {
  impl: typeof fetch;
  calls: { url: string; body: Record<string, unknown> }[];
} {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const impl = (async (url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push({ url: String(url), body });
    const r = respond(body);
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      text: async (): Promise<string> => r.body ?? '',
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

/**
 * The SAM boxes for a gen: a 100x100 box centred on each part's point converted EXACTLY like
 * the worker does (round(x*size/1000), clamped) — every LD-06/LD-07 rule then holds (point
 * inside, area fraction ~0.028, pairwise IoU <= 0.06). `skipIds` leaves parts absent, which
 * LD-06 must catch. One box (id 3) carries no confidence → the region's confidence is null.
 */
function samBoxesFor(gen: LabelDiagramGen, skipIds: number[] = []): SamBoxSpec[] {
  return gen.parts
    .map((p, i) => {
      const px = Math.min(FIG_W - 1, Math.max(0, Math.round((p.x * FIG_W) / 1000)));
      const py = Math.min(FIG_H - 1, Math.max(0, Math.round((p.y * FIG_H) / 1000)));
      return {
        id: i + 1,
        x1: Math.max(0, px - 50),
        y1: Math.max(0, py - 50),
        x2: Math.min(FIG_W - 1, px + 50),
        y2: Math.min(FIG_H - 1, py + 50),
        ...(i + 1 === 3 ? {} : { confidence: 0.9 }),
      };
    })
    .filter(b => !skipIds.includes(b.id));
}

function expectedRegions(gen: LabelDiagramGen, boxes: SamBoxSpec[]): unknown[] {
  return boxesToRegions(
    boxes.map(b => ({
      id: b.id,
      x1: b.x1,
      y1: b.y1,
      x2: b.x2,
      y2: b.y2,
      confidence: b.confidence ?? null,
    })),
    gen.parts,
  );
}

/* ------------------------------------------------------------------ */
/* Harness                                                              */
/* ------------------------------------------------------------------ */

type Ev = JobStageEvent;

function startLabelLesson(
  client: LessonFake,
  opts: {
    sam?: SamSegmentDeps | null;
    jobId?: string;
    maxRepairAttempts?: number;
  } = {},
): { storageDir: string; jobId: string; done: Promise<JobSummary>; seen: Ev[] } {
  const storageDir = mkdtempSync(join(tmpdir(), 's8b-label-'));
  const seen: Ev[] = [];
  const { jobId, done } = startJob(
    DNA,
    {
      client,
      storageDir,
      purpose: 'test-live',
      flow: 'lesson',
      newJobId: () => opts.jobId ?? 'lesson-label-00000001',
      ...(opts.sam !== undefined && opts.sam !== null ? { sam: opts.sam } : {}),
      ...(opts.maxRepairAttempts !== undefined
        ? { limits: { maxRepairAttempts: opts.maxRepairAttempts } }
        : {}),
    },
    e => seen.push(e as Ev),
  );
  return { storageDir, jobId, done, seen };
}

function readEvents(storageDir: string, jobId: string): Ev[] {
  return readFileSync(join(storageDir, 'runs', jobId, 'events.jsonl'), 'utf8')
    .split('\n')
    .filter(line => line.trim() !== '')
    .map(line => JSON.parse(line) as Ev);
}

function readRunFile(storageDir: string, jobId: string, name: string): any {
  return JSON.parse(readFileSync(join(storageDir, 'runs', jobId, name), 'utf8'));
}

const ev = (e: Ev): string => `${e.stage}:${e.status}`;

function imagesOf(requests: CapturedRequest[], schemaName: string): string[] {
  const req = requests.find(r => r.schemaName === schemaName);
  assert.ok(req !== undefined, `a ${schemaName} request was made`);
  return req.messages.flatMap(m => (Array.isArray(m.images) ? m.images.map(i => i.url) : []));
}

/* ------------------------------------------------------------------ */
/* Happy path: figures to analysis, image to generation, SAM to spec    */
/* ------------------------------------------------------------------ */

test('label-diagram: figures reach the analysis call, the image reaches generation, SAM regions reach validation and the published spec', async () => {
  const boxes = samBoxesFor(goldenLabelGen);
  const sam = fakeSamFetch(() => ({ status: 200, body: samSseBody(boxes, 1) }));
  const { ledger, reserveCalls, reconcileCalls } = fakeLedger();
  const client = fakeClient({
    analysis: dnaAnalysis,
    kit: { label_diagram: goldenLabelGen, quiz_cards: dnaQuizGen },
  });
  const { storageDir, jobId, done } = startLabelLesson(client, {
    sam: { apiKey: 'LLM_SYNTHTESTKEY0001', ledger, fetch: sam.impl },
  });
  const summary = await done;

  assert.equal(summary.status, 'succeeded');
  assert.equal(summary.error, undefined);
  assert.deepEqual(summary.lesson, {
    overviewReady: true,
    componentsPlanned: 2,
    componentsPublished: 2,
    componentsFailed: 0,
    partialPublish: false,
  });
  assert.deepEqual(summary.componentRepairs, []);

  // --- flow step 1: the analysis message lists the figure (id — caption — labelsInImage) ---
  const analysisReq = client.requests.find(r => r.schemaName === 'source_analysis_v2');
  assert.ok(analysisReq !== undefined);
  const analysisUser = analysisReq.messages.filter(m => m.role === 'user').map(m => m.content).join('\n');
  assert.ok(analysisUser.includes(FIGURE_ID), 'the analysis message lists the figure id');
  assert.ok(analysisUser.includes('DNA is a double helix formed by base pairs'), 'the caption travels with it');
  assert.ok(analysisUser.includes('labelsInImage: true'), 'labelsInImage travels with it');
  // no images on the analysis call (vision is for the component generation only)
  assert.deepEqual(imagesOf(client.requests, 'source_analysis_v2'), []);

  // --- flow step 2: the generation call carries EXACTLY one image — the figure's own bytes ---
  const genImages = imagesOf(client.requests, 'label_diagram');
  assert.equal(genImages.length, 1);
  const expectedB64 = Buffer.from(figure.bytes).toString('base64');
  assert.equal(genImages[0], `data:${figure.meta.mime};base64,${expectedB64}`);
  // the sibling component never sees an image
  assert.deepEqual(imagesOf(client.requests, 'quiz_cards'), []);

  // --- flow step 3: ONE SAM request per revision, point prompts in image pixels ---
  assert.equal(sam.calls.length, 1);
  const samBody = sam.calls[0].body;
  assert.equal(sam.calls[0].url, 'https://api.meta.ai/v1/responses');
  assert.equal(samBody['model'], 'sam-3.1');
  assert.equal(samBody['stream'], true);
  assert.deepEqual(samBody['metadata'], { include_confidence: 'true' });
  // Documented Responses shape (dev.meta.ai/docs/sam/segmenting; lead fix after the first live run's HTTP 400s).
  assert.equal(samBody['input_text'], undefined);
  assert.equal(samBody['image'], undefined);
  const content = ((samBody['input'] as Array<Record<string, unknown>>)[0]!['content']) as Array<Record<string, unknown>>;
  assert.equal(content[1]!['type'], 'input_image');
  assert.equal(content[1]!['image_url'], `data:image/jpeg;base64,${expectedB64}`, 'SAM receives the exact stored bytes');
  void FIG_W; void FIG_H;
  // Stage 8c: the golden parts carry area boxes, so SAM gets a BOX per part (no point), object id i+1.
  // parts[0] area (230, 420, 340, 530) on the 600x600 figure → x1=138 y1=252 x2=204 y2=318.
  assert.equal(content[0]!['type'], 'input_text');
  const inputText = String(content[0]!['text']);
  assert.ok(inputText.startsWith('<0f>1<|box;x1=138;y1=252;x2=204;y2=318;w=600;h=600|>,2<|box;'), `box prompt: ${inputText.slice(0, 90)}`);
  assert.equal(inputText.split('<|box;').length - 1, 6, 'one box per part, ids 1..n');
  assert.equal(inputText.split('<|point;').length - 1, 0, 'a part with an area is prompted by its box only');

  // --- money: ledger reserve/reconcile mirrored through the ONE cost accumulator ---
  assert.equal(reserveCalls.length, 1);
  assert.deepEqual(reserveCalls[0], {
    purpose: 'test-live',
    model: 'sam-3.1',
    estUSD: 0.0025,
    provider: 'meta-api',
  });
  assert.equal(reconcileCalls.length, 1);
  assert.equal(reconcileCalls[0]?.['costUSD'], 0.0025);
  assert.equal(reconcileCalls[0]?.['note'], 'usage');
  // 3 model calls (analysis + label + quiz) + 1 grounding call (Stage 8c Addendum A) at 0.01 + one SAM image at 0.0025
  assert.equal(summary.totalCostUSD, 0.0425);
  assert.equal(summary.reservedUnknownUSD, 0);

  // --- events: the segment stage records status, latency, imagesProcessed and cost ---
  const events = readEvents(storageDir, jobId);
  assert.deepEqual(events.filter(e => e.stage === 'segment').map(ev), ['segment:started', 'segment:succeeded']);
  const segOk = events.find(e => e.stage === 'segment' && e.status === 'succeeded') as Ev;
  assert.equal(segOk.componentId, 'label-diagram-v1');
  assert.equal(segOk.revision, 1);
  assert.equal(segOk.imagesProcessed, 1);
  assert.equal(segOk.estCostUSD, 0.0125, 'the segment event carries the grounding call (0.01) plus the SAM image (0.0025)');
  assert.equal(typeof segOk.latencyMs, 'number');
  assert.match(String(segOk.detail), /^sam-3\.1 returned 6 of 6 region\(s\); muse-spark-1\.3 located 0 of 6 part\(s\) for SAM; sam-3\.1 sure of 5 of 6 part\(s\)$/);

  // --- flow steps 4/5: regions in validation, in the revision artifact and in the spec ---
  const rec = readRunFile(storageDir, jobId, 'label-diagram-v1.r1.json');
  const expRegions = expectedRegions(goldenLabelGen, boxes);
  assert.deepEqual(rec.regions, expRegions, 'the revision artifact stores the SAM regions');
  assert.equal((rec.regions as any[]).length, 6);
  assert.equal(rec.regions[0].partId, goldenLabelGen.parts[0].id);
  assert.deepEqual(
    [rec.regions[0].x1, rec.regions[0].y1, rec.regions[0].x2, rec.regions[0].y2],
    [120, 235, 220, 335],
    'box for part 1 sits at the converted point (170, 285)',
  );
  assert.equal(rec.regions[2].confidence, null, 'a box without c maps to confidence null');
  assert.equal(rec.regions[1].confidence, 0.9);
  assert.equal(rec.report.publishable, true, 'the LD checks ran WITH the regions and passed');
  assert.ok(rec.report.checks.some((c: any) => c.id === 'LD-06' && c.passed));
  assert.ok(rec.report.checks.some((c: any) => c.id === 'LD-07' && c.passed));
  // the published spec = gen body + system fields figure/regions
  assert.equal(rec.spec.componentId, 'label-diagram-v1');
  assert.equal(rec.spec.id, `${jobId}:label-diagram-v1:r1`);
  assert.equal(rec.spec.figureId, FIGURE_ID);
  const { labelBoxes: storedBoxes, partLabelGroups, ...figureRest } = rec.spec.figure;
  assert.equal(storedBoxes.length, 7, 'the lead-verified printed-label boxes travel with the figure');
  assert.deepEqual(partLabelGroups, [1, 2, 3, 4, 5, 6], 'the lead-curated part label groups travel with the figure');
  assert.deepEqual(figureRest, {
    id: FIGURE_ID,
    width: FIG_W,
    height: FIG_H,
    caption: figure.meta.caption,
    credit: figure.meta.credit,
    license: figure.meta.license,
    labelsInImage: true,
  });
  assert.deepEqual(rec.spec.regions, expRegions);
  assert.equal(rec.spec.parts.length, 6);
  assert.equal(rec.spec.hint, goldenLabelGen.hint);

  // the lesson detail serves the spec (with figure + regions) under its spec id
  const lesson = readRunFile(storageDir, jobId, 'lesson.json');
  assert.deepEqual(
    lesson.components.map((c: any) => [c.componentId, c.status, c.revision]),
    [
      ['label-diagram-v1', 'passed', 1],
      ['quiz-cards-v1', 'passed', 1],
    ],
  );
});

/* ------------------------------------------------------------------ */
/* SAM 500: component-level failure, partial publish, charge recorded   */
/* ------------------------------------------------------------------ */

test('label-diagram: a SAM HTTP 500 fails ONLY the component, the lesson still publishes the rest, and the uncertain charge is recorded', async () => {
  const sam = fakeSamFetch(() => ({ status: 500, body: 'Internal Server Error' }));
  const { ledger, reserveCalls, reconcileCalls } = fakeLedger();
  const client = fakeClient({
    analysis: dnaAnalysis,
    kit: { label_diagram: goldenLabelGen, quiz_cards: dnaQuizGen },
    kitRepair: { label_diagram_repair: goldenLabelGen },
  });
  const { storageDir, jobId, done } = startLabelLesson(client, {
    sam: { apiKey: 'LLM_SYNTHTESTKEY0001', ledger, fetch: sam.impl },
  });
  const summary = await done;

  // the lesson itself succeeds (overview + the quiz publish) — a SAM error is never lesson-fatal
  assert.equal(summary.status, 'succeeded');
  assert.equal(summary.error, undefined);
  assert.deepEqual(summary.lesson, {
    overviewReady: true,
    componentsPlanned: 2,
    componentsPublished: 1,
    componentsFailed: 1,
    partialPublish: true,
  });
  const lesson = readRunFile(storageDir, jobId, 'lesson.json');
  const labelEntry = lesson.components.find((c: any) => c.componentId === 'label-diagram-v1');
  assert.equal(labelEntry.status, 'failed');
  assert.equal(labelEntry.reason, SEGMENTATION_FAILED_REASON);
  assert.equal(labelEntry.revision, 1);
  assert.equal(
    lesson.components.find((c: any) => c.componentId === 'quiz-cards-v1').status,
    'passed',
  );

  // the repair loop is NOT entered: a dead SAM endpoint must not burn paid Muse calls
  assert.equal(sam.calls.length, 1);
  assert.ok(!client.calls.includes('label_diagram_repair'), 'no repair call after a segmentation failure');

  // money: the 5xx reservation reconciled as uncertain → charged AND unknown, in the summary
  assert.equal(reserveCalls.length, 1);
  assert.equal(reconcileCalls.length, 1);
  assert.equal(reconcileCalls[0]?.['costUSD'], 0.0025);
  assert.equal(reconcileCalls[0]?.['note'], 'uncertain outcome');
  assert.equal(summary.totalCostUSD, 0.0425); // 3 model calls + the grounding call + the uncertain SAM charge
  assert.equal(summary.reservedUnknownUSD, 0.0025);

  // events: the fixed code, never provider text
  const events = readEvents(storageDir, jobId);
  const segFail = events.find(e => e.stage === 'segment' && e.status === 'failed') as Ev;
  assert.ok(segFail !== undefined);
  assert.equal(segFail.detail, 'SAM_HTTP_500');
  assert.equal(segFail.componentId, 'label-diagram-v1');
  assert.equal(segFail.estCostUSD, 0.0125, 'the failed segment event carries the grounding call (0.01) plus the uncertain SAM charge');
  const compFail = events.find(
    e => e.stage === 'component' && e.status === 'failed' && e.componentId === 'label-diagram-v1',
  ) as Ev;
  assert.equal(compFail.detail, 'segmentation failed: SAM_HTTP_500');
  assert.ok(!String(compFail.detail).includes('Internal Server Error'), 'provider text never reaches events');

  // the stored revision says honestly that segmentation did not run
  const rec = readRunFile(storageDir, jobId, 'label-diagram-v1.r1.json');
  assert.equal(rec.regions, undefined, 'no regions were stored for a failed segmentation');
  const ld06 = rec.report.checks.find((c: any) => c.id === 'LD-06');
  assert.equal(ld06.passed, false);
  assert.equal(ld06.message, 'segmentation did not run');
  assert.equal(rec.report.publishable, false);
});

/* ------------------------------------------------------------------ */
/* Repair: the repair call carries the image and segmentation RE-RUNS   */
/* ------------------------------------------------------------------ */

test('label-diagram: repair carries the same image, segmentation re-runs on the repaired revision and its own regions publish it', async () => {
  const broken = brokenQuoteLabelGen();
  const boxesBroken = samBoxesFor(broken); // same points as the golden gen
  const boxesGolden = samBoxesFor(goldenLabelGen);
  let samCalls = 0;
  const sam = fakeSamFetch(() => {
    samCalls += 1;
    return { status: 200, body: samSseBody(samCalls === 1 ? boxesBroken : boxesGolden, 1) };
  });
  const { ledger, reconcileCalls } = fakeLedger();
  const client = fakeClient({
    analysis: dnaAnalysis,
    kit: { label_diagram: broken, quiz_cards: dnaQuizGen },
    kitRepair: { label_diagram_repair: goldenLabelGen },
  });
  const { storageDir, jobId, done } = startLabelLesson(client, {
    sam: { apiKey: 'LLM_SYNTHTESTKEY0001', ledger, fetch: sam.impl },
    maxRepairAttempts: 1,
  });
  const summary = await done;

  assert.equal(summary.status, 'succeeded');
  assert.equal(samCalls, 2, 'segmentation ran once per revision');
  assert.equal(reconcileCalls.length, 2);
  // 4 model calls (analysis, label gen, label repair, quiz) + 2 grounding calls (one per revision) + 2 SAM images
  assert.equal(summary.totalCostUSD, 0.065);

  // the repair call carries the SAME figure image
  const repairImages = imagesOf(client.requests, 'label_diagram_repair');
  assert.equal(repairImages.length, 1);
  assert.equal(repairImages[0], `data:${figure.meta.mime};base64,${Buffer.from(figure.bytes).toString('base64')}`);

  const events = readEvents(storageDir, jobId);
  const timeline = events
    .filter(e => ['segment', 'repair', 'component'].includes(e.stage))
    .map(e => `${ev(e)}${e.revision !== undefined ? `:r${e.revision}` : ''}${e.target ? `:${e.target}` : ''}`);
  for (const expected of [
    'segment:started:r1',
    'segment:succeeded:r1',
    'component:failed:r1',
    'repair:started:r2:component',
    'segment:started:r2',
    'segment:succeeded:r2',
    'repair:succeeded:r2:component',
    'component:succeeded:r2',
  ]) {
    assert.ok(timeline.includes(expected), `timeline has ${expected}: ${timeline.join(' | ')}`);
  }

  // r1 failed LD-01 (fabricated quote), r2 passed with ITS OWN regions
  const r1 = readRunFile(storageDir, jobId, 'label-diagram-v1.r1.json');
  assert.equal(r1.report.publishable, false);
  assert.ok(r1.report.checks.some((c: any) => c.id === 'LD-01' && !c.passed));
  assert.equal(r1.regions.length, 6, 'r1 stored its own regions');
  const r2 = readRunFile(storageDir, jobId, 'label-diagram-v1.r2.json');
  assert.equal(r2.report.publishable, true);
  assert.deepEqual(r2.regions, expectedRegions(goldenLabelGen, boxesGolden));
  assert.deepEqual(r2.spec.regions, r2.regions);
  assert.equal(r2.spec.figure.id, FIGURE_ID);
  // the repair comparator's check survived the regions merge
  assert.ok(r2.report.checks.some((c: any) => c.id === 'repair.no-weakening' && c.passed));

  const repairs = summary.componentRepairs ?? [];
  assert.equal(repairs.length, 1);
  assert.equal(repairs[0]?.componentId, 'label-diagram-v1');
  assert.equal(repairs[0]?.attempt, 1);
  assert.equal(repairs[0]?.revision, 2);
  assert.ok((repairs[0]?.targeted ?? []).includes('LD-01'));
  assert.ok((repairs[0]?.fixed ?? []).includes('LD-01'));
  assert.equal(repairs[0]?.passed, true);
  assert.equal(repairs[0]?.afterInjectedFault, false);

  const lesson = readRunFile(storageDir, jobId, 'lesson.json');
  assert.deepEqual(
    lesson.components.map((c: any) => [c.componentId, c.status, c.revision]),
    [
      ['label-diagram-v1', 'passed', 2],
      ['quiz-cards-v1', 'passed', 1],
    ],
  );
});

/* ------------------------------------------------------------------ */
/* A missing SAM box gates publication through LD-06                    */
/* ------------------------------------------------------------------ */

test('label-diagram: when SAM cannot find one part, LD-06 gates the component out even after a repair', async () => {
  // SAM never returns the box for part 6 (id 6) — LD-06 must fail on both revisions.
  const sam = fakeSamFetch(() => ({ status: 200, body: samSseBody(samBoxesFor(goldenLabelGen, [6]), 1) }));
  const { ledger } = fakeLedger();
  const client = fakeClient({
    analysis: dnaAnalysis,
    kit: { label_diagram: goldenLabelGen, quiz_cards: dnaQuizGen },
    kitRepair: { label_diagram_repair: shiftedPointLabelGen() },
  });
  const { storageDir, jobId, done } = startLabelLesson(client, {
    sam: { apiKey: 'LLM_SYNTHTESTKEY0001', ledger, fetch: sam.impl },
    maxRepairAttempts: 1,
  });
  const summary = await done;

  assert.equal(summary.status, 'succeeded', 'the lesson still publishes the overview and the quiz');
  assert.equal(sam.calls.length, 4, 'segmentation re-ran on the repaired revision; each revision also paid one best-of retry for the missing region');
  const lesson = readRunFile(storageDir, jobId, 'lesson.json');
  const labelEntry = lesson.components.find((c: any) => c.componentId === 'label-diagram-v1');
  assert.equal(labelEntry.status, 'failed');
  assert.equal(labelEntry.revision, 2);
  assert.match(labelEntry.reason, /^LD-06/, 'the honest failing check names the reason');

  const events = readEvents(storageDir, jobId);
  const segOks = events.filter(e => e.stage === 'segment' && e.status === 'succeeded');
  assert.equal(segOks.length, 2);
  assert.match(String(segOks[0]?.detail), /returned 5 of 6 region\(s\)/);
  assert.match(String(segOks[0]?.detail), /retried 1 weak part\(s\): part-backbone missing -> missing$/, 'the retry found nothing either, and says so');

  const r1 = readRunFile(storageDir, jobId, 'label-diagram-v1.r1.json');
  assert.equal(r1.regions.length, 5);
  assert.ok(r1.report.checks.some((c: any) => c.id === 'LD-06' && !c.passed));
  const r2 = readRunFile(storageDir, jobId, 'label-diagram-v1.r2.json');
  assert.equal(r2.regions.length, 5);
  assert.equal(r2.report.publishable, false);
  const repairs = summary.componentRepairs ?? [];
  assert.equal(repairs.length, 1);
  assert.deepEqual(repairs[0]?.targeted, ['LD-06']);
  assert.equal(repairs[0]?.passed, false);
  // 4 model calls + 2 grounding calls + 4 SAM images (2 revisions x (first pass + the best-of retry for the missing region))
  assert.equal(summary.totalCostUSD, 0.07);
  assert.equal(summary.lesson?.componentsPublished, 1);
  assert.equal(summary.lesson?.partialPublish, true);
});

test('label-diagram (lead, live run 3): a repair that returns the same gen stops the loop; the published figure carries the stored label boxes', async () => {
  const sam = fakeSamFetch(() => ({ status: 200, body: samSseBody(samBoxesFor(goldenLabelGen, [6]), 1) }));
  const { ledger } = fakeLedger();
  const client = fakeClient({
    analysis: dnaAnalysis,
    kit: { label_diagram: goldenLabelGen, quiz_cards: dnaQuizGen },
    kitRepair: { label_diagram_repair: goldenLabelGen },
  });
  const { storageDir, jobId, done } = startLabelLesson(client, {
    sam: { apiKey: 'LLM_SYNTHKEY0001', ledger, fetch: sam.impl },
    maxRepairAttempts: 2,
  });
  const summary = await done;
  assert.equal(summary.status, 'succeeded');
  assert.equal((summary.componentRepairs ?? []).length, 1, 'no second paid repair after an unchanged revision');
  assert.equal(sam.calls.length, 4, 'two revisions, each with a first pass and one retry for the missing part 6');
});

test('label-diagram (lead): the published spec figure carries the lead-verified label boxes', async () => {
  const sam = fakeSamFetch(() => ({ status: 200, body: samSseBody(samBoxesFor(goldenLabelGen, []), 1) }));
  const { ledger } = fakeLedger();
  const client = fakeClient({ analysis: dnaAnalysis, kit: { label_diagram: goldenLabelGen, quiz_cards: dnaQuizGen } });
  const { storageDir, jobId, done } = startLabelLesson(client, { sam: { apiKey: 'LLM_SYNTHKEY0001', ledger, fetch: sam.impl } });
  await done;
  const lesson = readRunFile(storageDir, jobId, 'lesson.json');
  const labelEntry = lesson.components.find((c: any) => c.componentId === 'label-diagram-v1');
  assert.equal(labelEntry.status, 'passed');
  const rec = readRunFile(storageDir, jobId, 'label-diagram-v1.r1.json');
  const boxes = rec.spec.figure.labelBoxes;
  assert.ok(Array.isArray(boxes) && boxes.length === 7, `stored DNA label boxes: ${JSON.stringify(boxes)?.slice(0, 80)}`);
});

/* ------------------------------------------------------------------ */
/* Missing SAM configuration: INTERNAL, component-level                 */
/* ------------------------------------------------------------------ */

test('label-diagram: a job without SAM deps fails only that component with the fixed INTERNAL detail', async () => {
  const client = fakeClient({
    analysis: dnaAnalysis,
    kit: { label_diagram: goldenLabelGen, quiz_cards: dnaQuizGen },
  });
  const { storageDir, jobId, done } = startLabelLesson(client, { sam: null });
  const summary = await done;

  assert.equal(summary.status, 'succeeded');
  assert.equal(summary.lesson?.partialPublish, true);
  const lesson = readRunFile(storageDir, jobId, 'lesson.json');
  const labelEntry = lesson.components.find((c: any) => c.componentId === 'label-diagram-v1');
  assert.equal(labelEntry.status, 'failed');
  assert.equal(labelEntry.reason, SEGMENTATION_FAILED_REASON);
  const events = readEvents(storageDir, jobId);
  const segFail = events.find(e => e.stage === 'segment' && e.status === 'failed') as Ev;
  assert.equal(segFail.detail, 'INTERNAL');
  // only the 3 model calls were charged
  assert.equal(summary.totalCostUSD, 0.03);
  assert.equal(summary.reservedUnknownUSD, 0);
});

/* ------------------------------------------------------------------ */
/* Spark Open (Modal): the same figures, images through the Modal client (Stage 8d) */
/* ------------------------------------------------------------------ */

test('label-diagram: a Spark Open (Modal) job gets the figure; its generation and grounding calls carry the image through the Modal client; SAM spend is meta-api', async () => {
  const boxes = samBoxesFor(goldenLabelGen);
  const sam = fakeSamFetch(() => ({ status: 200, body: samSseBody(boxes, 1) }));
  const { ledger, reserveCalls, reconcileCalls } = fakeLedger();
  // the analysis plans the diagram because the job's figure list reached it
  const client = fakeClient({
    analysis: dnaAnalysis,
    kit: { label_diagram: goldenLabelGen, quiz_cards: dnaQuizGen },
    provider: 'modal',
  });
  const { storageDir, jobId, done } = startLabelLesson(client, {
    sam: { apiKey: 'LLM_SYNTHTESTKEY0001', ledger, fetch: sam.impl },
  });
  const summary = await done;

  assert.equal(summary.status, 'succeeded');
  assert.equal(summary.error, undefined);
  assert.equal(summary.provider, 'modal');
  assert.equal(summary.model, 'muse-spark-open');
  assert.equal(summary.lesson?.componentsPublished, 2, 'the label diagram and the quiz both publish on Spark Open');
  assert.equal(summary.lesson?.componentsFailed, 0);

  // the analysis message (sent through the Modal client) lists the figure, without an image
  const analysisReq = client.requests.find(r => r.schemaName === 'source_analysis_v2');
  assert.ok(analysisReq !== undefined);
  const analysisUser = analysisReq.messages.filter(m => m.role === 'user').map(m => m.content).join('\n');
  assert.ok(analysisUser.includes('<untrusted-figures>'), 'the analysis message carries the figure list');
  assert.ok(analysisUser.includes(FIGURE_ID), 'the analysis message lists the figure id');
  assert.deepEqual(imagesOf(client.requests, 'source_analysis_v2'), []);

  // generation AND grounding calls carry exactly the figure's own bytes, through the SAME (Modal) client
  const expectedUrl = `data:${figure.meta.mime};base64,${Buffer.from(figure.bytes).toString('base64')}`;
  assert.deepEqual(imagesOf(client.requests, 'label_diagram'), [expectedUrl]);
  assert.deepEqual(imagesOf(client.requests, 'label_grounding'), [expectedUrl]);
  assert.deepEqual(imagesOf(client.requests, 'quiz_cards'), [], 'the sibling component never sees an image');
  assert.ok(client.calls.includes('label_grounding'), 'grounding ran on the Modal client');

  // SAM stays on the Meta API with its own deps: one request, to api.meta.ai, ledger provider meta-api
  assert.equal(sam.calls.length, 1);
  assert.equal(sam.calls[0].url, 'https://api.meta.ai/v1/responses');
  assert.equal(sam.calls[0].body['model'], 'sam-3.1');
  assert.deepEqual(reserveCalls, [{ purpose: 'test-live', model: 'sam-3.1', estUSD: 0.0025, provider: 'meta-api' }]);
  assert.equal(reconcileCalls.length, 1);
  assert.equal(reconcileCalls[0]?.['costUSD'], 0.0025);
  // 3 model calls + grounding at 0.01 each + one SAM image
  assert.equal(summary.totalCostUSD, 0.0425);
  assert.equal(summary.reservedUnknownUSD, 0);

  // the event names the model that located the parts: Spark Open here, never Spark 1.3
  const events = readEvents(storageDir, jobId);
  assert.deepEqual(events.filter(e => e.stage === 'segment').map(ev), ['segment:started', 'segment:succeeded']);
  const segOk = events.find(e => e.stage === 'segment' && e.status === 'succeeded') as Ev;
  assert.match(String(segOk.detail), /^sam-3\.1 returned 6 of 6 region\(s\); muse-spark-open located 0 of 6 part\(s\) for SAM; sam-3\.1 sure of 5 of 6 part\(s\)$/);
  assert.ok(!String(segOk.detail).includes('muse-spark-1.3'));
  const rec = readRunFile(storageDir, jobId, 'label-diagram-v1.r1.json');
  assert.equal(rec.report.publishable, true);
  assert.equal(rec.spec.figureId, FIGURE_ID);

  // a plan without any figure list still fails A-08 honestly (the pure validator is unchanged)
  const report = validateLessonAnalysis(dnaAnalysis, [loadSource(DNA)]);
  const a08 = report.checks.find(c => c.id === 'A-08');
  assert.ok(a08 !== undefined && !a08.passed, 'A-08 fails a label-diagram plan without a figure list');
  assert.equal(report.publishable, false);
});

/* ------------------------------------------------------------------ */
/* Unit: the box → region mapping                                       */
/* ------------------------------------------------------------------ */

test('boxesToRegions maps object id i to parts[i-1], keeps part order, ignores stray ids and keeps null confidence', () => {
  const parts = [
    { id: 'p-one' },
    { id: 'p-two' },
    { id: 'p-three' },
  ] as unknown as LabelDiagramGen['parts'];
  const regions = boxesToRegions(
    [
      { id: 9, x1: 1, y1: 1, x2: 2, y2: 2, confidence: 0.5 }, // stray: ignored
      { id: 2, x1: 20, y1: 21, x2: 22, y2: 23, confidence: null },
      { id: 1, x1: 10, y1: 11, x2: 12, y2: 13, confidence: 0.9 },
    ],
    parts,
  );
  assert.deepEqual(regions, [
    { partId: 'p-one', x1: 10, y1: 11, x2: 12, y2: 13, confidence: 0.9 },
    { partId: 'p-two', x1: 20, y1: 21, x2: 22, y2: 23, confidence: null },
    // part three has no box → absent (LD-06 owns the failure)
  ]);
});

test('label-diagram: an unreadable figure store entry would fail the component before any paid call', () => {
  // The FIGURE_UNAVAILABLE path is defensive (A-08 gates stray plans first); pin its reason
  // constant so the UI sentence stays stable.
  assert.equal(typeof FIGURE_UNAVAILABLE_REASON, 'string');
  assert.match(FIGURE_UNAVAILABLE_REASON, /left out/);
});

/* ------------------------------------------------------------------ */
/* Stage 8c slice S: box prompts, outlines, printed labels              */
/* ------------------------------------------------------------------ */

const partWith = (over: Record<string, number | undefined>): LabelDiagramGen['parts'][number] =>
  ({ ...structuredClone(goldenLabelGen.parts[0]), ...over }) as LabelDiagramGen['parts'][number];

test('samObjectsFor: area fields (0..1000) become a pixel BOX with no point; no area means the point', () => {
  const objs = samObjectsFor(
    [
      partWith({ areaX1: 230, areaY1: 420, areaX2: 340, areaY2: 530 }),
      partWith({ areaX1: undefined, areaY1: undefined, areaX2: undefined, areaY2: undefined, x: 283, y: 475 }),
    ],
    600,
    600,
  );
  assert.deepEqual(objs, [
    { id: 1, box: { x1: 138, y1: 252, x2: 204, y2: 318 } },
    { id: 2, points: [{ x: 170, y: 285 }] },
  ]);
});

test('samObjectsFor: clamps into the image (1000 is the last pixel), keeps x2 > x1, and falls back to the point otherwise', () => {
  const objs = samObjectsFor(
    [
      partWith({ areaX1: 900, areaY1: 800, areaX2: 1000, areaY2: 1000 }), // right/bottom edge
      partWith({ areaX1: -50, areaY1: -10, areaX2: 1200, areaY2: 1300 }), // overshoots both ways
      partWith({ areaX1: 500, areaY1: 100, areaX2: 500, areaY2: 300 }), // zero width -> point
      partWith({ areaX1: 700, areaY1: 100, areaX2: 300, areaY2: 300 }), // reversed -> point
      partWith({ areaX1: 100, areaY1: 100, areaX2: 300, areaY2: undefined }), // one field missing -> point
      partWith({ areaX1: Number.NaN, areaY1: 100, areaX2: 300, areaY2: 300 }), // not a number -> point
      partWith({ areaX1: 999.9, areaY1: 100, areaX2: 1000, areaY2: 300 }), // collapses to one pixel column -> point
    ],
    600,
    600,
  );
  assert.deepEqual(objs[0], { id: 1, box: { x1: 540, y1: 480, x2: 599, y2: 599 } });
  assert.deepEqual(objs[1], { id: 2, box: { x1: 0, y1: 0, x2: 599, y2: 599 } });
  for (const [i, o] of objs.slice(2).entries()) {
    assert.equal(o.box, undefined, `object ${i + 3} has no box`);
    assert.equal(o.points?.length, 1, `object ${i + 3} uses its point`);
  }
});

test('label-diagram: a part whose area is empty (all zero, schema-valid) is still prompted by its point; a mixed gen mixes boxes and points in one request', async () => {
  // The gen schema requires the four area fields, so "no area" reaches the worker as an empty 0,0,0,0 box.
  const noAreas = structuredClone(goldenLabelGen);
  for (const p of noAreas.parts) {
    Object.assign(p, { areaX1: 0, areaY1: 0, areaX2: 0, areaY2: 0 });
  }
  const mixed = structuredClone(goldenLabelGen);
  Object.assign(mixed.parts[1] as object, { areaX1: 0, areaY1: 0, areaX2: 0, areaY2: 0 });
  const prompts: string[] = [];
  for (const gen of [noAreas, mixed]) {
    const sam = fakeSamFetch(() => ({ status: 200, body: samSseBody(samBoxesFor(gen), 1) }));
    const { ledger } = fakeLedger();
    const client = fakeClient({ analysis: dnaAnalysis, kit: { label_diagram: gen, quiz_cards: dnaQuizGen } });
    const { done } = startLabelLesson(client, { sam: { apiKey: 'LLM_S...01', ledger, fetch: sam.impl }, maxRepairAttempts: 0 });
    await done;
    assert.equal(sam.calls.length, 1);
    const content = (sam.calls[0]!.body['input'] as Array<Record<string, unknown>>)[0]!['content'] as Array<Record<string, unknown>>;
    prompts.push(String(content[0]!['text']));
  }
  assert.ok(prompts[0]!.startsWith('<0f>1<|point;x=170;y=285;w=600;h=600|>,2<|point;'), prompts[0]);
  assert.equal(prompts[0]!.split('<|box;').length - 1, 0);
  assert.equal(prompts[0]!.split('<|point;').length - 1, 6);
  assert.ok(prompts[1]!.startsWith('<0f>1<|box;x1=138;y1=252;x2=204;y2=318;w=600;h=600|>,2<|point;'), prompts[1]);
  assert.equal(prompts[1]!.split('<|box;').length - 1, 5);
  assert.equal(prompts[1]!.split('<|point;').length - 1, 1);
});

// The REAL runoff mask (docs/evidence/sam-mask-probe, box 322,332..351,362) rides a fake SAM stream through the worker.
const runoffBox = parseSamOutput(
  readFileSync(new URL('../../docs/evidence/sam-mask-probe/raw-output.txt', import.meta.url), 'utf8'),
).find(b => b.id === 5)!;

test('boxesToRegions: a region gains the outline traced from its mask; a missing or unreadable mask omits the key', () => {
  const parts = [{ id: 'p-one' }, { id: 'p-two' }, { id: 'p-three' }] as unknown as LabelDiagramGen['parts'];
  const regions = boxesToRegions(
    [
      { ...runoffBox, id: 1 },
      { id: 2, x1: 5, y1: 5, x2: 10, y2: 10, confidence: 0.7 }, // no mask at all
      { id: 3, x1: 5, y1: 5, x2: 10, y2: 10, confidence: 0.7, mask: { encoding: 'lossless', payload: '~garbage', width: 6, height: 6 } },
    ],
    parts,
  );
  const expected = maskToOutline(runoffBox.mask!, runoffBox);
  assert.ok(expected !== null && expected.length <= 6000);
  assert.deepEqual(regions[0], {
    partId: 'p-one',
    x1: 322,
    y1: 332,
    x2: 351,
    y2: 362,
    confidence: runoffBox.confidence,
    outline: expected,
  });
  assert.deepEqual(regions[1], { partId: 'p-two', x1: 5, y1: 5, x2: 10, y2: 10, confidence: 0.7 });
  assert.ok(!('outline' in (regions[1] as object)));
  assert.ok(!('outline' in (regions[2] as object)), 'undecodable mask: no outline key (never null, never empty)');
});

test('label-diagram: SAM masks become region outlines in the stored revision and the published spec', async () => {
  // Part 1 gets the real runoff mask (its box is the mask box); the rest keep the unreadable placeholder mask.
  const boxes = samBoxesFor(goldenLabelGen).map(b =>
    b.id === 1
      ? {
          ...b,
          x1: runoffBox.x1,
          y1: runoffBox.y1,
          x2: runoffBox.x2,
          y2: runoffBox.y2,
          confidence: 0.9,
          maskData: `${runoffBox.mask!.height},${runoffBox.mask!.width},${runoffBox.mask!.payload}`,
        }
      : b,
  );
  const sam = fakeSamFetch(() => ({ status: 200, body: samSseBody(boxes, 1) }));
  const { ledger } = fakeLedger();
  const client = fakeClient({ analysis: dnaAnalysis, kit: { label_diagram: goldenLabelGen, quiz_cards: dnaQuizGen } });
  const { storageDir, jobId, done } = startLabelLesson(client, { sam: { apiKey: 'LLM_S...01', ledger, fetch: sam.impl }, maxRepairAttempts: 0 });
  await done;
  const rec = readRunFile(storageDir, jobId, 'label-diagram-v1.r1.json');
  const expected = maskToOutline(runoffBox.mask!, runoffBox);
  assert.ok(expected !== null);
  assert.equal(rec.regions.length, 6);
  assert.equal(rec.regions[0].outline, expected);
  assert.equal(rec.regions[0].confidence, 0.9);
  for (const r of rec.regions.slice(1)) {
    assert.ok(!('outline' in r), 'placeholder masks give no outline');
  }
  assert.deepEqual(rec.spec.regions, rec.regions, 'the published spec carries the outline too');
  assert.ok(rec.spec.regions[0].outline.length <= 6000);
});

test('label-diagram: generation AND repair messages list the figure printed labels; the spec figure carries partLabelGroups', async () => {
  const broken = brokenQuoteLabelGen();
  let samCalls = 0;
  const sam = fakeSamFetch(() => {
    samCalls += 1;
    return { status: 200, body: samSseBody(samBoxesFor(goldenLabelGen), 1) };
  });
  const { ledger } = fakeLedger();
  const client = fakeClient({
    analysis: dnaAnalysis,
    kit: { label_diagram: broken, quiz_cards: dnaQuizGen },
    kitRepair: { label_diagram_repair: goldenLabelGen },
  });
  const { storageDir, jobId, done } = startLabelLesson(client, {
    sam: { apiKey: 'LLM_S...01', ledger, fetch: sam.impl },
    maxRepairAttempts: 1,
  });
  await done;
  assert.equal(samCalls, 2);
  const textOf = (schema: string): string => {
    const req = client.requests.find(r => r.schemaName === schema);
    assert.ok(req !== undefined, `a ${schema} request was made`);
    return req.messages.map(m => (typeof m.content === 'string' ? m.content : '')).join('\n');
  };
  const listed = '"Base pairs"; "Thymine"; "Adenine"; "Guanine"; "Cytosine"; "Sugar phosphate backbone"';
  assert.ok(textOf('label_diagram').includes(listed), 'the generation message lists the printed labels in group order');
  assert.ok(textOf('label_diagram_repair').includes(listed), 'the repair message lists them too');
  assert.ok(!textOf('quiz_cards').includes('Sugar phosphate backbone'), 'sibling components never see them');
  const r2 = readRunFile(storageDir, jobId, 'label-diagram-v1.r2.json');
  assert.deepEqual(r2.spec.figure.partLabelGroups, [1, 2, 3, 4, 5, 6]);
});
