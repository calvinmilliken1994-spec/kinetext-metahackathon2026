// B-07 / B-08 (stage 7-8 backend review): SAM 3.1 billing fails closed and a failed SAM
// reconcile never loses the outstanding reservation from the job summary. FAKE MetaClient +
// FAKE SAM fetch + a MODEL spending ledger with real hold semantics (a hold counts at its
// reserved amount until a reconcile succeeds). Every case asserts the job's totalCostUSD and
// reservedUnknownUSD EXACTLY against that ledger, in the summary and in job.json. The real
// licence-checked DNA figure and the golden label-diagram gen are reused from the label
// worker tests. No network, no credits, no .env access.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startJob } from './jobs.ts';
import type { JobStageEvent, JobSummary } from './jobs.ts';
import { roundCost } from './job-support.ts';
import type { SamSegmentDeps } from './lesson.ts';
import type { ChatMessage, CompleteRequest, MetaClient } from '../../packages/meta/client.ts';
import type { Ledger } from '../../packages/meta/ledger.ts';
import { loadFigure } from '../../packages/sources/figures.ts';
import type { MetaReceipt } from '../../packages/contracts/index.ts';
import type { LabelDiagramGen, SourceAnalysisV2 } from '../../packages/contracts/kit.ts';


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
interface SamBoxSpec {
  id: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  confidence?: number;
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
          `<|mask;x=0;y=0${c};data=27,60,~!!!!M!0c[0o9|>`
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

/* ------------------------------------------------------------------ */
/* Ledger model: real hold semantics (a hold counts at its reserved     */
/* amount until a reconcile succeeds, then at the reconciled amount)    */
/* ------------------------------------------------------------------ */

interface ModelLedger {
  ledger: Ledger;
  reserves: number;
  reconcileAttempts: Array<{ costUSD: number; note: string | undefined }>;
  /** What the spending ledger holds for SAM: reconciled amount, else the reserved hold. */
  committed(): number;
  /** Holds never successfully reconciled (their amount is an unresolved liability). */
  outstanding(): number;
}

function modelLedger(failReconcile: boolean): ModelLedger {
  const holds = new Map<string, { est: number; actual?: number }>();
  const state: ModelLedger = {
    reserves: 0,
    reconcileAttempts: [],
    committed: () => [...holds.values()].reduce((sum, h) => sum + (h.actual ?? h.est), 0),
    outstanding: () => [...holds.values()].reduce((sum, h) => sum + (h.actual === undefined ? h.est : 0), 0),
    ledger: {
      capUSD: 150,
      reserve: (req): string => {
        state.reserves += 1;
        const id = `sam-res-${state.reserves}`;
        holds.set(id, { est: req.estUSD });
        return id;
      },
      reconcile: (reservationId, actual): void => {
        state.reconcileAttempts.push({ costUSD: actual.costUSD, note: actual.note });
        if (failReconcile) {
          throw new Error('DISK_FULL');
        }
        const hold = holds.get(reservationId);
        assert.ok(hold !== undefined);
        hold.actual = actual.costUSD;
      },
      committedUSD: () => 0,
      close: () => {},
    },
  };
  return state;
}

function samStream(events: unknown[]): string {
  return events.map(e => `data: ${JSON.stringify(e)}`).join('\n') + '\n';
}

function samDelta(): unknown {
  const boxes = samBoxesFor(goldenLabelGen);
  const first = samSseBody(boxes).split('\n')[0] as string;
  return JSON.parse(first.slice('data: '.length)) as unknown;
}

interface Case {
  summary: JobSummary;
  jobFile: JobSummary;
  ledger: ModelLedger;
  client: LessonFake;
  segFail: Ev | undefined;
  labelStatus: string | undefined;
  samCalls: number;
}

async function runCase(
  respond: () => { status: number; body?: string },
  failReconcile: boolean,
  jobId: string,
): Promise<Case> {
  const sam = fakeSamFetch(respond);
  const ledger = modelLedger(failReconcile);
  const client = fakeClient({
    analysis: dnaAnalysis,
    kit: { label_diagram: goldenLabelGen, quiz_cards: dnaQuizGen },
    kitRepair: { label_diagram_repair: goldenLabelGen },
  });
  const { storageDir, done } = startLabelLesson(client, {
    sam: { apiKey: 'test-sam-token', ledger: ledger.ledger, fetch: sam.impl },
    jobId,
  });
  const summary = await done;
  const events = readEvents(storageDir, jobId);
  const lesson = readRunFile(storageDir, jobId, 'lesson.json');
  const label = lesson.components.find((c: any) => c.componentId === 'label-diagram-v1');
  return {
    summary,
    jobFile: readRunFile(storageDir, jobId, 'job.json') as JobSummary,
    ledger,
    client,
    segFail: events.find(e => e.stage === 'segment' && e.status === 'failed'),
    labelStatus: label?.status,
    samCalls: sam.calls.length,
  };
}

/** The job summary must equal the ledger exactly: Muse receipts (0.01 each) + SAM committed. */
function assertMatchesLedger(c: Case, unknownUSD: number): void {
  const expectedTotal = roundCost(c.client.calls.length * 0.01 + c.ledger.committed());
  assert.equal(c.summary.totalCostUSD, expectedTotal, 'totalCostUSD equals receipts + the SAM amount the ledger holds');
  assert.equal(c.summary.reservedUnknownUSD, unknownUSD, 'reservedUnknownUSD is the unresolved SAM liability, exactly once');
  assert.equal(c.jobFile.totalCostUSD, c.summary.totalCostUSD, 'job.json persisted the same total');
  assert.equal(c.jobFile.reservedUnknownUSD, c.summary.reservedUnknownUSD, 'job.json persisted the same unknown');
}

function assertSegmentationFailedPartially(c: Case, detail: string): void {
  assert.equal(c.summary.status, 'succeeded', 'a SAM failure is component-level, never lesson-fatal');
  assert.equal(c.labelStatus, 'failed');
  assert.ok(c.segFail !== undefined);
  assert.equal(c.segFail.detail, detail);
  assert.equal(c.samCalls <= 1, true);
  assert.ok(!c.client.calls.includes('label_diagram_repair'), 'no paid repair after a segmentation failure');
}

/* ------------------------------------------------------------------ */
/* B-08: reconcile fails after a successful reservation                 */
/* ------------------------------------------------------------------ */

test('B-08: SAM HTTP 400 + failed reconcile keeps the $0.0025 hold as unknown liability, exactly once', async () => {
  const c = await runCase(() => ({ status: 400, body: 'provider says no' }), true, 'lesson-sam-b08-400');
  assertSegmentationFailedPartially(c, 'LEDGER_ERROR');
  assert.equal(c.ledger.outstanding(), 0.0025, 'the real ledger still holds the reservation');
  assert.equal(c.ledger.reconcileAttempts.length, 1);
  assertMatchesLedger(c, 0.0025);
  assert.equal(c.segFail?.estCostUSD, 0.0025);
});

test('B-08: SAM HTTP 500 + failed reconcile: unknown recorded AND included in totalCostUSD', async () => {
  const c = await runCase(() => ({ status: 500, body: 'Internal Server Error' }), true, 'lesson-sam-b08-500');
  assertSegmentationFailedPartially(c, 'LEDGER_ERROR');
  assert.equal(c.ledger.outstanding(), 0.0025);
  assertMatchesLedger(c, 0.0025);
  assert.equal(c.summary.totalCostUSD, 0.0325);
});

test('controls: HTTP 400 and 500 with a working ledger still match it exactly', async () => {
  const c400 = await runCase(() => ({ status: 400, body: 'x' }), false, 'lesson-sam-ctl-400');
  assertSegmentationFailedPartially(c400, 'SAM_HTTP_400');
  assert.equal(c400.ledger.committed(), 0, 'a rejected request is a known zero');
  assertMatchesLedger(c400, 0);
  const c500 = await runCase(() => ({ status: 500, body: 'x' }), false, 'lesson-sam-ctl-500');
  assertSegmentationFailedPartially(c500, 'SAM_HTTP_500');
  assertMatchesLedger(c500, 0.0025);
  assert.equal(c500.summary.totalCostUSD, 0.0325);
});

/* ------------------------------------------------------------------ */
/* B-07 through the worker: fixed codes, conservative accounting        */
/* ------------------------------------------------------------------ */

test('B-07: an explicit response.failed stream fails the segmentation, charged AND unknown', async () => {
  const c = await runCase(
    () => ({
      status: 200,
      body: samStream([samDelta(), { type: 'response.failed', response: { error: { message: 'PROVIDER-SECRET' } } }]),
    }),
    false,
    'lesson-sam-stream-failed',
  );
  assertSegmentationFailedPartially(c, 'SAM_STREAM_FAILED');
  assertMatchesLedger(c, 0.0025);
  assert.equal(c.ledger.committed(), 0.0025);
  assert.ok(!JSON.stringify(c.segFail).includes('PROVIDER-SECRET'));
});

test('B-07: a stream with no completion event fails, charged AND unknown', async () => {
  const c = await runCase(() => ({ status: 200, body: samStream([samDelta()]) }), false, 'lesson-sam-incomplete');
  assertSegmentationFailedPartially(c, 'SAM_STREAM_INCOMPLETE');
  assertMatchesLedger(c, 0.0025);
});

test('B-07: fractional usage is never floored to a known zero', async () => {
  const c = await runCase(
    () => ({
      status: 200,
      body: samStream([samDelta(), { type: 'response.completed', usage: { images_processed: 0.9 } }]),
    }),
    false,
    'lesson-sam-fractional',
  );
  assertSegmentationFailedPartially(c, 'SAM_USAGE_INVALID');
  assert.equal(c.ledger.committed(), 0.0025);
  assertMatchesLedger(c, 0.0025);
});

test('B-07: usage 2 on one image records the actual $0.005, flags it and fails the segmentation', async () => {
  const c = await runCase(
    () => ({
      status: 200,
      body: samStream([samDelta(), { type: 'response.completed', usage: { images_processed: 2 } }]),
    }),
    false,
    'lesson-sam-over',
  );
  assertSegmentationFailedPartially(c, 'SAM_USAGE_EXCEEDED');
  assert.equal(c.ledger.committed(), 0.005);
  assertMatchesLedger(c, 0);
  assert.equal(c.segFail?.estCostUSD, 0.005);
});

test('B-07/B-08: stream failure + failed reconcile accounts the hold once (no double count)', async () => {
  const c = await runCase(
    () => ({ status: 200, body: samStream([samDelta(), { type: 'response.failed' }]) }),
    true,
    'lesson-sam-stream-ledger',
  );
  assertSegmentationFailedPartially(c, 'LEDGER_ERROR');
  assert.equal(c.ledger.outstanding(), 0.0025);
  assertMatchesLedger(c, 0.0025);
});

test('B-07/B-08: a successful SAM call still matches the ledger with no unknown', async () => {
  const c = await runCase(
    () => ({ status: 200, body: samSseBody(samBoxesFor(goldenLabelGen)) }),
    false,
    'lesson-sam-success',
  );
  assert.equal(c.summary.status, 'succeeded');
  assert.equal(c.segFail, undefined);
  assert.equal(c.ledger.committed(), 0.0025);
  assertMatchesLedger(c, 0);
});
