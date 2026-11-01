// Stage 8c round 2 (B): SAM best-of retry. After a label-diagram revision's first SAM call, every part whose
// region is missing or below KIT_LIMITS.labelDiagram.minRegionConfidence gets ONE extra request (same image) with
// two variants: (P) its point alone (object id 100+i) and (E) its area box widened by 20% per side, clamped
// (object id 200+i). Each weak part keeps the most confident of first pass / P / E (ties: the first pass), re-keyed
// to the part, with the outline of its own mask. FAKE Muse client + FAKE SAM fetch + a MODEL ledger with real hold
// semantics; the real DNA figure and golden label gen; no network, no credits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startJob } from './jobs.ts';
import type { JobStageEvent, JobSummary } from './jobs.ts';
import { roundCost } from './job-support.ts';
import { pickBestRegions, samObjectsFor, samRetryObjectsFor } from './lesson.ts';
import { buildObjectsPrompt } from '../../packages/meta/sam.ts';
import type { SamBox } from '../../packages/meta/sam.ts';
import type { ChatMessage, CompleteRequest, MetaClient } from '../../packages/meta/client.ts';
import type { Ledger } from '../../packages/meta/ledger.ts';
import { loadFigure } from '../../packages/sources/figures.ts';
import type { MetaReceipt } from '../../packages/contracts/index.ts';
import type { LabelDiagramGen, LabelPartGen, SourceAnalysisV2 } from '../../packages/contracts/kit.ts';

const DNA = 'medlineplus-what-is-dna';
const FIGURE_ID = 'medlineplus-dna-structure-1';
const goldenLabelGen = JSON.parse(
  readFileSync(new URL('../../tests/fixtures/stage6/label-diagram.gen.json', import.meta.url), 'utf8'),
) as LabelDiagramGen;
const figure = loadFigure(FIGURE_ID);
const W = figure.meta.width; // 600
const H = figure.meta.height; // 600
assert.equal(W, 600);
assert.equal(H, 600);
const SAM_KEY = 'synthetic-sam-test-key';

/* ------------------------------------------------------------------ */
/* Pure helpers                                                         */
/* ------------------------------------------------------------------ */

const part = (over: Partial<LabelPartGen>): LabelPartGen =>
  ({
    id: 'p',
    name: 'P',
    sourceId: 's',
    quote: 'q',
    x: 500,
    y: 500,
    labelX1: 0,
    labelY1: 0,
    labelX2: 0,
    labelY2: 0,
    areaX1: 400,
    areaY1: 400,
    areaX2: 600,
    areaY2: 600,
    ...over,
  }) as LabelPartGen;
const box = (id: number, confidence: number | null, x1 = 10, y1 = 10, x2 = 50, y2 = 50): SamBox => ({ id, x1, y1, x2, y2, confidence });

test('samRetryObjectsFor: P is the point alone (id 100+i), E is the area widened by 20% per side (id 200+i)', () => {
  const parts = [part({}), part({ id: 'q', x: 800, y: 317, areaX1: 750, areaY1: 270, areaX2: 850, areaY2: 340 })];
  const plan = samRetryObjectsFor(parts, [1], W, H);
  assert.deepEqual(plan.retried, [1]);
  assert.deepEqual(plan.objects, [
    { id: 101, points: [{ x: 480, y: 190 }] },
    { id: 201, box: { x1: 438, y1: 154, x2: 522, y2: 212 } },
  ]);
  assert.equal(
    buildObjectsPrompt(plan.objects, W, H),
    '<0f>101<|point;x=480;y=190;w=600;h=600|>,201<|box;x1=438;y1=154;x2=522;y2=212;w=600;h=600|>',
  );
});

test('samRetryObjectsFor: the widened box is clamped to the image; a full-image area adds no E', () => {
  const edge = part({ areaX1: 0, areaY1: 10, areaX2: 100, areaY2: 1000, x: 50, y: 500 });
  const plan = samRetryObjectsFor([edge], [0], W, H);
  const e = plan.objects.find(o => o.id === 200);
  // area px: x 0..60, y 6..599 (1000 clamps to the last pixel); +-20% clamped into 0..599
  assert.deepEqual(e?.box, { x1: 0, y1: 0, x2: 72, y2: 599 });
  const whole = part({ areaX1: 0, areaY1: 0, areaX2: 1000, areaY2: 1000 });
  const planWhole = samRetryObjectsFor([whole], [0], W, H);
  assert.deepEqual(planWhole.objects.map(o => o.id), [100], 'widening a full-image box changes nothing: only P is sent');
});

test('samRetryObjectsFor: a part without a usable area has nothing new to try (its first pass WAS the point)', () => {
  const noArea = part({ areaX1: undefined, areaY1: undefined, areaX2: undefined, areaY2: undefined });
  const degenerate = part({ areaX1: 300, areaX2: 300 });
  const plan = samRetryObjectsFor([noArea, degenerate, part({})], [0, 1, 2], W, H);
  assert.deepEqual(plan.retried, [2]);
  assert.deepEqual(plan.objects.map(o => o.id), [102, 202]);
  assert.deepEqual(samRetryObjectsFor([noArea], [0], W, H), { objects: [], retried: [] });
});

test('samRetryObjectsFor: at most 8 weak parts (16 objects, SAM maximum), in part order', () => {
  const parts = Array.from({ length: 10 }, (_, i) => part({ id: `p${i}` }));
  const plan = samRetryObjectsFor(parts, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], W, H);
  assert.deepEqual(plan.retried, [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(plan.objects.length, 16);
  assert.deepEqual(new Set(plan.objects.map(o => o.id)).size, 16, 'ids never clash');
  assert.ok(plan.objects.every(o => o.id >= 100 && o.id <= 207));
  buildObjectsPrompt(plan.objects, W, H); // within the 16-object limit
});

test('pickBestRegions: highest confidence wins per weak part, ties keep the first pass, then P before E; strong parts untouched', () => {
  const parts = [part({ id: 'a' }), part({ id: 'b' }), part({ id: 'c' }), part({ id: 'd' }), part({ id: 'e' })];
  const first: SamBox[] = [box(1, 0.9, 1, 1, 2, 2), box(2, 0.4, 3, 3, 4, 4), box(3, 0.45, 5, 5, 6, 6), /* part d missing */ box(5, 0.3, 7, 7, 8, 8)];
  const retry: SamBox[] = [
    box(101, 0.7, 11, 11, 12, 12), box(201, 0.8, 13, 13, 14, 14), // b: E wins
    box(102, 0.45, 15, 15, 16, 16), box(202, 0.2, 17, 17, 18, 18), // c: tie with first pass -> first pass kept
    box(103, 0.6, 19, 19, 20, 20), box(203, 0.6, 21, 21, 22, 22), // d: missing -> tie P/E -> P
    box(104, 0.3, 23, 23, 24, 24), // e: E not sent/returned; P not better
    box(999, 0.99, 0, 0, 1, 1), // stray id is ignored
  ];
  const { boxes, changes } = pickBestRegions(first, retry, parts, [1, 2, 3, 4]);
  const byId = new Map(boxes.map(b => [b.id, b]));
  assert.deepEqual(byId.get(1), first[0], 'a was strong and is not touched');
  assert.deepEqual(byId.get(2), { ...retry[1], id: 2 }, 'b re-keyed from E (201)');
  assert.deepEqual(byId.get(3), first[2], 'c keeps the first pass on a tie');
  assert.deepEqual(byId.get(4), { ...retry[4], id: 4 }, 'd gets P (tie, P before E) when the first pass is missing');
  assert.deepEqual(byId.get(5), first[3], 'e keeps the first pass');
  assert.equal(boxes.length, 5);
  assert.deepEqual(boxes.map(b => b.id), [1, 2, 3, 4, 5], 'sorted by id, nothing re-keyed onto a stray id');
  assert.deepEqual(changes, ['b 0.40 -> 0.80', 'c 0.45 -> 0.45', 'd missing -> 0.60', 'e 0.30 -> 0.30']);
});

test('pickBestRegions: a variant keeps its own mask; an unscored variant is ignored; nothing usable stays missing', () => {
  const parts = [part({ id: 'a' }), part({ id: 'b' })];
  const mask = { encoding: 'lossless' as const, payload: '~abc', width: 3, height: 3 };
  const first: SamBox[] = [box(1, 0.3)];
  const retry: SamBox[] = [{ ...box(100, 0.6, 20, 20, 22, 22), mask }, box(201, null)];
  const { boxes, changes } = pickBestRegions(first, retry, parts, [0, 1]);
  assert.deepEqual(boxes.find(b => b.id === 1)?.mask, mask);
  assert.equal(boxes.find(b => b.id === 2), undefined);
  assert.deepEqual(changes, ['a 0.30 -> 0.60', 'b missing -> missing']);
});

test('pickBestRegions with Muse\'s grounding boxes: a variant that spills outside where Muse located the part never wins', () => {
  // Live Spark Open water cycle (job-20261101211438-87fa1e93 r1): runoff first pass 0.27; the point-alone variant came
  // back 0.74 but covered the whole landscape (120,340)-(462,482) against Muse's (290,326)-(325,359); LD-06 failed.
  const parts = [part({ id: 'runoff' })];
  const first: SamBox[] = [box(1, 0.27, 293, 337, 325, 378)];
  const retry: SamBox[] = [box(100, 0.74, 120, 340, 462, 482), box(200, 0.55, 288, 330, 330, 368)]; // 368 <= 359 + 12
  const grounds = [{ x1: 290, y1: 326, x2: 325, y2: 359 }];
  const { boxes, changes } = pickBestRegions(first, retry, parts, [0], grounds);
  assert.deepEqual(boxes[0], { ...retry[1], id: 1 }, 'the widened-box variant agrees with Muse and wins; the landscape does not');
  assert.deepEqual(changes, ['runoff 0.27 -> 0.55']);
  // Nothing agrees: the first pass stays (LD-11 then judges it honestly).
  const none = pickBestRegions(first, [box(100, 0.74, 120, 340, 462, 482)], parts, [0], grounds);
  assert.deepEqual(none.boxes[0], first[0]);
  // Without grounding boxes (older path) the rule is unchanged.
  const old = pickBestRegions(first, retry, parts, [0]);
  assert.deepEqual(old.boxes[0], { ...retry[0], id: 1 });
});

/* ------------------------------------------------------------------ */
/* Worker: fixtures                                                     */
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

function fakeClient(): MetaClient & { calls: string[] } {
  const calls: string[] = [];
  let n = 0;
  return {
    calls,
    complete: async <T,>(req: CompleteRequest): Promise<{ data: T; receipt: MetaReceipt }> => {
      calls.push(req.schemaName);
      let data: unknown;
      if (req.schemaName === 'source_analysis_v2' || req.schemaName === 'source_analysis_v2_repair') {
        data = dnaAnalysis;
      } else if (req.schemaName === 'label_diagram' || req.schemaName === 'label_diagram_repair') {
        data = goldenLabelGen;
      } else if (req.schemaName === 'label_grounding') {
        // Stage 8c Addendum A: one Muse grounding call per revision, before SAM. Here Muse locates nothing, so SAM
        // keeps getting the generation areas these tests were written against (a normal paid 0.01 call).
        data = { objects: [] };
      }
      if (data === undefined) {
        throw new Error(`FAKE_MISSING_RESPONSE:${req.schemaName}`);
      }
      n += 1;
      return { data: structuredClone(data) as T, receipt: receipt(`${req.schemaName}-${n}`) };
    },
  } as MetaClient & { calls: string[] };
}

/** Ledger model with real hold semantics; `failReconcileFrom` makes the Nth and later reconciles throw. */
interface ModelLedger {
  ledger: Ledger;
  reserves: number;
  committed(): number;
  outstanding(): number;
}
function modelLedger(failReconcileFrom = Number.POSITIVE_INFINITY): ModelLedger {
  const holds = new Map<string, { est: number; actual?: number }>();
  let attempts = 0;
  const state: ModelLedger = {
    reserves: 0,
    committed: () => [...holds.values()].reduce((s, h) => s + (h.actual ?? h.est), 0),
    outstanding: () => [...holds.values()].reduce((s, h) => s + (h.actual === undefined ? h.est : 0), 0),
    ledger: {
      capUSD: 150,
      reserve: (req): string => {
        state.reserves += 1;
        const id = `sam-res-${state.reserves}`;
        holds.set(id, { est: req.estUSD });
        return id;
      },
      reconcile: (reservationId, actual): void => {
        attempts += 1;
        if (attempts >= failReconcileFrom) {
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

/** Part index (0-based) of each golden part, its point in px, for boxes that hug the point. */
const goldenPoint = (i: number): { px: number; py: number } => {
  const p = goldenLabelGen.parts[i] as LabelPartGen;
  return { px: Math.round((p.x * W) / 1000), py: Math.round((p.y * H) / 1000) };
};
/** A SAM box around part i's point with the given half-size (so a different half-size = a different region). */
function aroundPart(i: number, half: number): { x1: number; y1: number; x2: number; y2: number } {
  const { px, py } = goldenPoint(i);
  return { x1: Math.max(0, px - half), y1: Math.max(0, py - half), x2: Math.min(W - 1, px + half), y2: Math.min(H - 1, py + half) };
}

interface SamAnswer {
  conf?: number; // absent = SAM returns no object for this id
  half: number;
}
/** The SSE body for a map object-id -> answer (ids in the order given). */
function sseFor(answers: Map<number, SamAnswer & { partIndex: number }>, imagesProcessed = 1): string {
  const line =
    '<0f>' +
    [...answers.entries()]
      .filter(([, a]) => a.conf !== undefined)
      .map(([id, a]) => {
        const b = aroundPart(a.partIndex, a.half);
        const c = `;c=${a.conf}`;
        return (
          `${id}<|box;x1=${b.x1};y1=${b.y1};x2=${b.x2};y2=${b.y2};w=${W};h=${H}${c}|>` +
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

/** The object ids named in a SAM prompt, in order. */
function promptIds(prompt: string): number[] {
  return [...prompt.matchAll(/(?:^<0f>|,)(\d+)<\|/g)].map(m => Number(m[1]));
}

interface SamScript {
  /** first call: part index -> confidence (absent = no object); everything else 0.9 */
  first: Record<number, number | null>;
  /** retry call: variant object id -> confidence */
  retry: Record<number, number>;
  /** what the second request does instead of answering */
  retryStatus?: number;
}

interface Run {
  summary: JobSummary;
  jobFile: JobSummary;
  ledger: ModelLedger;
  client: MetaClient & { calls: string[] };
  samPrompts: string[];
  samBodies: Record<string, unknown>[];
  segEvents: JobStageEvent[];
  r1: any;
  label: any;
}

async function run(script: SamScript, jobId: string, opts: { failReconcileFrom?: number } = {}): Promise<Run> {
  const samPrompts: string[] = [];
  const samBodies: Record<string, unknown>[] = [];
  let callNo = 0;
  const impl = (async (_url: unknown, init?: { body?: unknown }) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    samBodies.push(body);
    const prompt = ((body['input'] as any)[0].content[0].text as string);
    samPrompts.push(prompt);
    callNo += 1;
    const ids = promptIds(prompt);
    let status = 200;
    let text = '';
    if (callNo === 1) {
      const answers = new Map<number, SamAnswer & { partIndex: number }>();
      for (const id of ids) {
        const i = id - 1;
        const given = script.first[i];
        answers.set(id, { partIndex: i, half: 50, ...(given === null ? {} : { conf: given ?? 0.9 }) });
      }
      text = sseFor(answers);
    } else if (script.retryStatus !== undefined) {
      status = script.retryStatus;
      text = 'provider says no';
    } else {
      const answers = new Map<number, SamAnswer & { partIndex: number }>();
      for (const id of ids) {
        const i = id % 100;
        const conf = script.retry[id];
        // P (100+i) hugs the point tightly, E (200+i) is wider: the two are distinguishable by geometry
        answers.set(id, { partIndex: i, half: id >= 200 ? 55 : 45, ...(conf !== undefined ? { conf } : {}) });
      }
      text = sseFor(answers);
    }
    return { ok: status >= 200 && status < 300, status, text: async (): Promise<string> => text } as unknown as Response;
  }) as unknown as typeof fetch;
  const ledger = modelLedger(opts.failReconcileFrom);
  const client = fakeClient();
  const storageDir = mkdtempSync(join(tmpdir(), 's8c-r2-retry-'));
  const seen: JobStageEvent[] = [];
  const { done } = startJob(
    DNA,
    {
      client,
      storageDir,
      purpose: 'test-live',
      flow: 'lesson',
      newJobId: () => jobId,
      sam: { apiKey: SAM_KEY, ledger: ledger.ledger, fetch: impl },
      limits: { maxRepairAttempts: 0 },
    },
    e => seen.push(e as JobStageEvent),
  );
  const summary = await done;
  const runDir = join(storageDir, 'runs', jobId);
  const lesson = JSON.parse(readFileSync(join(runDir, 'lesson.json'), 'utf8'));
  return {
    summary,
    jobFile: JSON.parse(readFileSync(join(runDir, 'job.json'), 'utf8')) as JobSummary,
    ledger,
    client,
    samPrompts,
    samBodies,
    segEvents: readFileSync(join(runDir, 'events.jsonl'), 'utf8')
      .split('\n')
      .filter(l => l.trim() !== '')
      .map(l => JSON.parse(l) as JobStageEvent)
      .filter(e => e.stage === ('segment' as never)),
    r1: JSON.parse(readFileSync(join(runDir, 'label-diagram-v1.r1.json'), 'utf8')),
    label: lesson.components.find((c: any) => c.componentId === 'label-diagram-v1'),
  };
}

function regionOf(r: Run, partId: string): any {
  return (r.r1.regions as any[]).find(x => x.partId === partId);
}

/** Job cost = Muse receipts (0.01 each) + what the SAM ledger holds, exactly. */
function assertMatchesLedger(r: Run, unknownUSD: number): void {
  assert.equal(r.summary.totalCostUSD, roundCost(r.client.calls.length * 0.01 + r.ledger.committed()), 'totalCostUSD = receipts + SAM ledger amount');
  assert.equal(r.summary.reservedUnknownUSD, unknownUSD, 'reservedUnknownUSD is the unresolved SAM liability, once');
  assert.equal(r.jobFile.totalCostUSD, r.summary.totalCostUSD, 'job.json persisted the same total');
  assert.equal(r.jobFile.reservedUnknownUSD, r.summary.reservedUnknownUSD, 'job.json persisted the same unknown');
}

// golden parts: 0 base-pairs, 1 adenine, 2 thymine, 3 guanine, 4 cytosine, 5 backbone
const THYMINE = 'part-thymine';
const CYTOSINE = 'part-cytosine';

/* ------------------------------------------------------------------ */
/* Worker: behaviour                                                    */
/* ------------------------------------------------------------------ */

test('retry: one extra request, exact prompt, best region kept per weak part, both calls accounted once', async () => {
  const r = await run(
    {
      first: { 2: 0.4, 4: null },
      // thymine: E (202) beats P (102); cytosine: nothing at first, P and E tie -> P (104)
      retry: { 102: 0.55, 202: 0.81, 104: 0.7, 204: 0.7 },
    },
    'lesson-s8c-retry-ok',
  );
  assert.equal(r.samPrompts.length, 2, 'ONE extra request, no more');
  assert.equal(
    r.samPrompts[1],
    '<0f>102<|point;x=480;y=190;w=600;h=600|>,202<|box;x1=438;y1=154;x2=522;y2=212;w=600;h=600|>,' +
      '104<|point;x=480;y=287;w=600;h=600|>,204<|box;x1=438;y1=250;x2=522;y2=308;w=600;h=600|>',
  );
  // the same image travels with both requests
  const imageOf = (b: Record<string, unknown>): unknown => (b['input'] as any)[0].content[1];
  assert.deepEqual(imageOf(r.samBodies[1] as Record<string, unknown>), imageOf(r.samBodies[0] as Record<string, unknown>));
  assert.equal(r.samBodies[1]?.['model'], 'sam-3.1');

  const thy = regionOf(r, THYMINE);
  assert.equal(thy.confidence, 0.81);
  const e = aroundPart(2, 55);
  assert.deepEqual([thy.x1, thy.y1, thy.x2, thy.y2], [e.x1, e.y1, e.x2, e.y2], 'the E region, keyed to the thymine part');
  const cyt = regionOf(r, CYTOSINE);
  assert.equal(cyt.confidence, 0.7);
  const p = aroundPart(4, 45);
  assert.deepEqual([cyt.x1, cyt.y1, cyt.x2, cyt.y2], [p.x1, p.y1, p.x2, p.y2], 'the P region (tie P/E), keyed to the cytosine part');
  assert.ok(typeof thy.outline === 'string' || thy.outline === undefined);
  // untouched strong parts keep their first-pass boxes
  const base = regionOf(r, 'part-base-pairs');
  const b = aroundPart(0, 50);
  assert.deepEqual([base.x1, base.y1, base.x2, base.y2, base.confidence], [b.x1, b.y1, b.x2, b.y2, 0.9]);
  assert.equal((r.r1.regions as any[]).length, 6);

  // the retried regions are what the component is validated on: LD-11 passes now, the component publishes
  const ld11 = (r.r1.report.checks as any[]).find(c => c.id === 'LD-11');
  assert.equal(ld11.passed, true);
  assert.equal(r.label.status, 'passed');

  // events: the existing strings stay, the retry detail is appended to the succeeded event
  const started = r.segEvents.find(e2 => e2.status === 'started');
  assert.equal(started?.detail, 'sam-3.1 point segmentation of 6 part(s)');
  const done = r.segEvents.filter(e2 => e2.status !== 'started');
  assert.equal(done.length, 1, 'still one terminal segment event per revision');
  assert.equal(done[0]?.status, 'succeeded');
  assert.equal(
    done[0]?.detail,
    'sam-3.1 returned 6 of 6 region(s); muse-spark-1.3 located 0 of 6 part(s) for SAM; sam-3.1 sure of 6 of 6 part(s); sam-3.1 retried 2 weak part(s): part-thymine 0.40 -> 0.81, part-cytosine missing -> 0.70',
  );
  assert.match(done[0]?.detail ?? '', /returned (\d+) of (\d+) region/, 'the web parser still matches');
  assert.equal((done[0] as any).imagesProcessed, 2);
  assert.equal((done[0] as any).estCostUSD, 0.015, 'the grounding call (0.01) + two SAM images (0.005)');

  // accounting: two reservations, two reconciles, 2 x 0.0025, nothing unknown
  assert.equal(r.ledger.reserves, 2);
  assert.equal(r.ledger.committed(), 0.005);
  assert.equal(r.ledger.outstanding(), 0);
  assertMatchesLedger(r, 0);
});

test('retry: nothing weak means no extra call and no extra cost; the event text is unchanged', async () => {
  const r = await run({ first: {}, retry: {} }, 'lesson-s8c-retry-none');
  assert.equal(r.samPrompts.length, 1);
  assert.equal(r.ledger.reserves, 1);
  assert.equal(r.ledger.committed(), 0.0025);
  const done = r.segEvents.find(e => e.status === 'succeeded');
  assert.equal(done?.detail, 'sam-3.1 returned 6 of 6 region(s); muse-spark-1.3 located 0 of 6 part(s) for SAM; sam-3.1 sure of 6 of 6 part(s)');
  assert.equal((done as any).estCostUSD, 0.0125, 'the grounding call (0.01) + one SAM image (0.0025)');
  assert.equal((done as any).imagesProcessed, 1);
  assert.equal(r.label.status, 'passed');
  assertMatchesLedger(r, 0);
});

test('retry: a region without a confidence is not weak (LD-11 only judges scored regions)', async () => {
  // confidence omitted for part 2 by a first pass that returns boxes with no `c=` token
  const samPrompts: string[] = [];
  const impl = (async (_u: unknown, init?: { body?: unknown }) => {
    const body = JSON.parse(String(init?.body));
    samPrompts.push(body.input[0].content[0].text);
    const line =
      '<0f>' +
      goldenLabelGen.parts
        .map((_p, i) => {
          const b = aroundPart(i, 50);
          return `${i + 1}<|box;x1=${b.x1};y1=${b.y1};x2=${b.x2};y2=${b.y2};w=${W};h=${H}|><|mask;x=0;y=0;data=27,60,~!!!!M!0c[0o9|>`;
        })
        .join(',');
    const text =
      [
        `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: line })}`,
        `data: ${JSON.stringify({ type: 'response.completed', usage: { images_processed: 1 } })}`,
      ].join('\n') + '\n';
    return { ok: true, status: 200, text: async (): Promise<string> => text } as unknown as Response;
  }) as unknown as typeof fetch;
  const ledger = modelLedger();
  const storageDir = mkdtempSync(join(tmpdir(), 's8c-r2-retry-'));
  const { done } = startJob(
    DNA,
    {
      client: fakeClient(),
      storageDir,
      purpose: 'test-live',
      flow: 'lesson',
      newJobId: () => 'lesson-s8c-retry-unscored',
      sam: { apiKey: SAM_KEY, ledger: ledger.ledger, fetch: impl },
      limits: { maxRepairAttempts: 0 },
    },
    () => {},
  );
  await done;
  assert.equal(samPrompts.length, 1);
  assert.equal(ledger.reserves, 1);
});

test('retry: when the variants are no better, the first pass is kept, honestly reported, and both calls are paid', async () => {
  const r = await run({ first: { 2: 0.4 }, retry: { 102: 0.4, 202: 0.3 } }, 'lesson-s8c-retry-nobetter');
  assert.equal(r.samPrompts.length, 2);
  const thy = regionOf(r, THYMINE);
  assert.equal(thy.confidence, 0.4, 'a tie keeps the first pass');
  const first = aroundPart(2, 50);
  assert.deepEqual([thy.x1, thy.y1, thy.x2, thy.y2], [first.x1, first.y1, first.x2, first.y2]);
  const done = r.segEvents.find(e => e.status === 'succeeded');
  assert.equal(done?.detail, 'sam-3.1 returned 6 of 6 region(s); muse-spark-1.3 located 0 of 6 part(s) for SAM; sam-3.1 sure of 5 of 6 part(s); sam-3.1 retried 1 weak part(s): part-thymine 0.40 -> 0.40');
  assert.equal(r.ledger.committed(), 0.005);
  // still weak: LD-11 fails, no repair (maxRepairAttempts 0): the component does not publish
  assert.equal((r.r1.report.checks as any[]).find(c => c.id === 'LD-11').passed, false);
  assert.equal(r.label.status, 'failed');
  assertMatchesLedger(r, 0);
});

test('retry failure: HTTP 500 on the extra call keeps the first-pass regions, accounts its charge once, and does not fail the component for it', async () => {
  const r = await run({ first: { 2: 0.4 }, retry: {}, retryStatus: 500 }, 'lesson-s8c-retry-500');
  assert.equal(r.samPrompts.length, 2);
  assert.equal(r.summary.status, 'succeeded');
  assert.equal((r.r1.regions as any[]).length, 6, 'the first-pass regions are persisted');
  assert.equal(regionOf(r, THYMINE).confidence, 0.4);
  assert.ok(!r.segEvents.some(e => e.status === 'failed'), 'the retry failing is not a segmentation failure');
  const done = r.segEvents.find(e => e.status === 'succeeded');
  assert.equal(done?.detail, 'sam-3.1 returned 6 of 6 region(s); muse-spark-1.3 located 0 of 6 part(s) for SAM; sam-3.1 sure of 5 of 6 part(s); sam-3.1 retry of 1 weak part(s) failed (SAM_HTTP_500); kept the first pass');
  assert.equal((done as any).estCostUSD, 0.015, 'all three calls are charged on the event: grounding + both SAM images');
  // a 5xx is an uncertain outcome: charged AND unknown, exactly once
  assert.equal(r.ledger.committed(), 0.005);
  assertMatchesLedger(r, 0.0025);
});

test('retry failure: HTTP 400 is a known zero (rejected), first pass kept', async () => {
  const r = await run({ first: { 2: 0.4 }, retry: {}, retryStatus: 400 }, 'lesson-s8c-retry-400');
  assert.equal(r.samPrompts.length, 2);
  assert.equal(regionOf(r, THYMINE).confidence, 0.4);
  assert.equal(r.ledger.committed(), 0.0025);
  const done = r.segEvents.find(e => e.status === 'succeeded');
  assert.equal(done?.detail, 'sam-3.1 returned 6 of 6 region(s); muse-spark-1.3 located 0 of 6 part(s) for SAM; sam-3.1 sure of 5 of 6 part(s); sam-3.1 retry of 1 weak part(s) failed (SAM_HTTP_400); kept the first pass');
  assert.equal((done as any).estCostUSD, 0.0125, 'grounding + the one accepted SAM image');
  assertMatchesLedger(r, 0);
});

test('retry failure: a failed reconcile of the extra call keeps its hold as unknown liability, exactly once', async () => {
  // reconcile #1 (first call) works; #2 (the retry) throws -> the real ledger keeps the 0.0025 hold
  const r = await run({ first: { 2: 0.4 }, retry: { 102: 0.9, 202: 0.9 } }, 'lesson-s8c-retry-ledger', { failReconcileFrom: 2 });
  assert.equal(r.samPrompts.length, 2);
  assert.equal(regionOf(r, THYMINE).confidence, 0.4, 'a retry whose settlement failed is not used');
  assert.equal(r.ledger.outstanding(), 0.0025);
  const done = r.segEvents.find(e => e.status === 'succeeded');
  assert.equal(done?.detail, 'sam-3.1 returned 6 of 6 region(s); muse-spark-1.3 located 0 of 6 part(s) for SAM; sam-3.1 sure of 5 of 6 part(s); sam-3.1 retry of 1 weak part(s) failed (LEDGER_ERROR); kept the first pass');
  assertMatchesLedger(r, 0.0025);
});

test('retry: the first call failing is unchanged (component fails, no retry, no repair)', async () => {
  const samPrompts: string[] = [];
  const impl = (async (_u: unknown, init?: { body?: unknown }) => {
    samPrompts.push(JSON.parse(String(init?.body)).input[0].content[0].text);
    return { ok: false, status: 500, text: async (): Promise<string> => 'x' } as unknown as Response;
  }) as unknown as typeof fetch;
  const ledger = modelLedger();
  const storageDir = mkdtempSync(join(tmpdir(), 's8c-r2-retry-'));
  const { done } = startJob(
    DNA,
    {
      client: fakeClient(),
      storageDir,
      purpose: 'test-live',
      flow: 'lesson',
      newJobId: () => 'lesson-s8c-retry-first-fails',
      sam: { apiKey: SAM_KEY, ledger: ledger.ledger, fetch: impl },
      limits: { maxRepairAttempts: 2 },
    },
    () => {},
  );
  const summary = await done;
  assert.equal(samPrompts.length, 1);
  assert.equal(summary.status, 'succeeded');
  assert.equal(ledger.committed(), 0.0025);
});

test('samObjectsFor is unchanged by the retry work (first pass: area box, point fallback)', () => {
  const objs = samObjectsFor(goldenLabelGen.parts, W, H);
  assert.equal(objs.length, 6);
  assert.deepEqual(objs[2], { id: 3, box: { x1: 450, y1: 162, x2: 510, y2: 204 } });
});
