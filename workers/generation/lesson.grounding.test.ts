// Stage 8c Addendum A (worker): ONE dedicated Muse Spark grounding call per label-diagram revision, BEFORE the SAM
// call. Its per-part union boxes (+4% margin, pixels) become SAM's box prompts, and the pixel union is stored as
// LabelRegion.ground. The call goes through the job's own MetaClient and is accounted exactly once (success,
// truncated output, HTTP error, bad JSON); any grounding failure falls back to the generation areas and never fails
// the component. FAKE Muse client + FAKE SAM fetch + a MODEL ledger; the real DNA figure and golden label gen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startJob } from './jobs.ts';
import type { JobStageEvent, JobSummary } from './jobs.ts';
import { roundCost } from './job-support.ts';
import { boxesToRegions, samObjectsFor, samRetryObjectsFor } from './lesson.ts';
import { buildObjectsPrompt } from '../../packages/meta/sam.ts';
import type { SamBox, SamObject } from '../../packages/meta/sam.ts';
import { MetaError } from '../../packages/meta/client.ts';
import type { CompleteRequest, ChatMessage, MetaClient } from '../../packages/meta/client.ts';
import {
  GROUNDING_SCHEMA,
  buildGroundingPrompt,
  groundingPixelBox,
  groundingPromptBox,
} from '../../packages/meta/grounding.ts';
import type { Ledger } from '../../packages/meta/ledger.ts';
import { loadFigure } from '../../packages/sources/figures.ts';
import type { MetaReceipt } from '../../packages/contracts/index.ts';
import type { LabelDiagramGen, LabelPartGen, SourceAnalysisV2 } from '../../packages/contracts/kit.ts';

const DNA = 'medlineplus-what-is-dna';
const FIGURE_ID = 'medlineplus-dna-structure-1';
const goldenLabelGen = JSON.parse(
  readFileSync(new URL('../../tests/fixtures/stage6/label-diagram.gen.json', import.meta.url), 'utf8'),
) as LabelDiagramGen;
const probe = JSON.parse(
  readFileSync(new URL('../../docs/evidence/muse-grounding-probe/result.json', import.meta.url), 'utf8'),
) as { results: { figure: string; prompt: string }[] };
const figure = loadFigure(FIGURE_ID);
const W = figure.meta.width; // 600
const H = figure.meta.height; // 600
assert.equal(W, 600);
assert.equal(H, 600);
const SAM_KEY = 'synthetic-sam-test-key';
const IMAGE_URL = `data:${figure.meta.mime};base64,${Buffer.from(figure.bytes).toString('base64')}`;
const N = goldenLabelGen.parts.length; // 6
const GROUNDING_COST = 0.02;
const MUSE_COST = 0.01;

/* ------------------------------------------------------------------ */
/* Fixtures                                                             */
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

/** A revision whose first part quote is not on the page (LD-01 fails -> one repair). */
function brokenQuoteLabelGen(): LabelDiagramGen {
  const gen = structuredClone(goldenLabelGen);
  gen.parts[0]!.quote = 'a phrase that does not occur anywhere on the page';
  return gen;
}

interface Box4 {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
const areaOf = (p: LabelPartGen): Box4 => ({ x1: p.areaX1!, y1: p.areaY1!, x2: p.areaX2!, y2: p.areaY2! });

/** Muse's grounding answer for a part: its box split in two pieces whose union is exactly `u` (0..1000). */
function pieces(u: Box4): { x_min: number; y_min: number; x_max: number; y_max: number }[] {
  const mid = Math.floor((u.y1 + u.y2) / 2);
  return [
    { x_min: u.x1, y_min: u.y1, x_max: u.x2, y_max: mid },
    { x_min: u.x1, y_min: mid, x_max: u.x2, y_max: u.y2 },
  ];
}
/** A grounding answer: one entry per part, in order; `null` = Muse omitted that object's boxes. */
function groundingAnswer(unions: (Box4 | null)[]): { objects: { object_name: string; bbox: unknown[] }[] } {
  return { objects: unions.map((u, i) => ({ object_name: `part ${i}`, bbox: u === null ? [] : pieces(u) })) };
}
/** Muse's union = the golden area of every part (so SAM boxes keep passing LD-06/LD-07/LD-11). */
const goldenUnions = (): Box4[] => goldenLabelGen.parts.map(areaOf);

function receipt(id: string, estCostUSD = MUSE_COST): MetaReceipt {
  return {
    purpose: 'test-live',
    requestedModel: 'muse-spark-1.3',
    returnedModel: 'muse-spark-1.3',
    responseId: id,
    usage: { promptTokens: 1200, completionTokens: 800, reasoningTokens: 300, cachedTokens: 0 },
    latencyMs: 42,
    estCostUSD,
    finishReason: 'stop',
    attempts: 1,
  };
}

type GroundingReply = { data: unknown } | { error: unknown };

interface Captured {
  order: string[]; // 'muse:<schemaName>' and 'sam' in call order, shared with the SAM fake
  requests: (CompleteRequest & { messages: ChatMessage[] })[];
}

function fakeMuse(
  captured: Captured,
  opts: { analysis: unknown; gen: LabelDiagramGen; repair?: LabelDiagramGen; grounding: (n: number) => GroundingReply; modal?: boolean },
): MetaClient & { calls: string[] } {
  const calls: string[] = [];
  let groundingN = 0;
  let n = 0;
  return {
    calls,
    // Stage 8d: a Spark Open job is a client that declares the Modal provider and the open model.
    ...(opts.modal === true
      ? { provider: 'modal' as const, model: 'muse-spark-open' as const, providerModel: 'meta-models/Muse-Spark-Open-816B-A42B' }
      : {}),
    complete: async <T,>(req: CompleteRequest): Promise<{ data: T; receipt: MetaReceipt }> => {
      calls.push(req.schemaName);
      captured.order.push(`muse:${req.schemaName}`);
      captured.requests.push(structuredClone({ ...req, signal: undefined }) as never);
      if (req.schemaName === 'label_grounding') {
        groundingN += 1;
        const reply = opts.grounding(groundingN);
        if ('error' in reply) {
          throw reply.error;
        }
        n += 1;
        return { data: structuredClone(reply.data) as T, receipt: receipt(`grounding-${n}`, GROUNDING_COST) };
      }
      let data: unknown;
      if (req.schemaName === 'source_analysis_v2' || req.schemaName === 'source_analysis_v2_repair') data = opts.analysis;
      else if (req.schemaName === 'label_diagram') data = opts.gen;
      else if (req.schemaName === 'label_diagram_repair') data = opts.repair;
      if (data === undefined) throw new Error(`FAKE_MISSING_RESPONSE:${req.schemaName}`);
      n += 1;
      return { data: structuredClone(data) as T, receipt: receipt(`${req.schemaName}-${n}`) };
    },
  } as MetaClient & { calls: string[] };
}

interface ModelLedger {
  ledger: Ledger;
  reserves: number;
  committed(): number;
}
function modelLedger(): ModelLedger {
  const holds = new Map<string, { est: number; actual?: number }>();
  const state: ModelLedger = {
    reserves: 0,
    committed: () => [...holds.values()].reduce((s, h) => s + (h.actual ?? h.est), 0),
    ledger: {
      capUSD: 150,
      reserve: (req): string => {
        state.reserves += 1;
        const id = `sam-res-${state.reserves}`;
        holds.set(id, { est: req.estUSD });
        return id;
      },
      reconcile: (reservationId, actual): void => {
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

/** Each SAM object answered with its own prompt box (a point gets a 100 px box around it); confidence per call. */
function samResponder(captured: Captured, conf: (callNo: number, id: number) => number | undefined): {
  impl: typeof fetch;
  prompts: string[];
  bodies: Record<string, unknown>[];
} {
  const prompts: string[] = [];
  const bodies: Record<string, unknown>[] = [];
  const impl = (async (_url: unknown, init?: { body?: unknown }) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    bodies.push(body);
    const prompt = (body['input'] as any)[0].content[0].text as string;
    prompts.push(prompt);
    const callNo = prompts.length;
    const lines: string[] = [];
    for (const m of prompt.matchAll(/(?:^<0f>|,)(\d+)<\|(box|point);([^|]*)\|>/g)) {
      const id = Number(m[1]);
      const c = conf(callNo, id);
      if (c === undefined) continue;
      const kv = Object.fromEntries(
        (m[3] as string).split(';').map(s => s.split('=') as [string, string]),
      ) as Record<string, string>;
      const b =
        m[2] === 'box'
          ? { x1: Number(kv['x1']), y1: Number(kv['y1']), x2: Number(kv['x2']), y2: Number(kv['y2']) }
          : {
              x1: Math.max(0, Number(kv['x']) - 50),
              y1: Math.max(0, Number(kv['y']) - 50),
              x2: Math.min(W - 1, Number(kv['x']) + 50),
              y2: Math.min(H - 1, Number(kv['y']) + 50),
            };
      lines.push(
        `${id}<|box;x1=${b.x1};y1=${b.y1};x2=${b.x2};y2=${b.y2};w=${W};h=${H};c=${c}|>` +
          `<|mask;x=0;y=0;c=${c};data=27,60,~!!!!M!0c[0o9|>`,
      );
    }
    const text =
      [
        `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: `<0f>${lines.join(',')}` })}`,
        `data: ${JSON.stringify({ type: 'response.completed', usage: { images_processed: 1 } })}`,
      ].join('\n') + '\n';
    captured.order.push('sam');
    return { ok: true, status: 200, text: async (): Promise<string> => text } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, prompts, bodies };
}

interface Run {
  summary: JobSummary;
  jobFile: JobSummary;
  ledger: ModelLedger;
  client: MetaClient & { calls: string[] };
  captured: Captured;
  sam: ReturnType<typeof samResponder>;
  events: JobStageEvent[];
  seg: JobStageEvent[];
  r1: any;
  r2: any;
  label: any;
}

async function run(
  jobId: string,
  opts: {
    grounding: (n: number) => GroundingReply;
    gen?: LabelDiagramGen;
    repair?: LabelDiagramGen;
    maxRepairAttempts?: number;
    conf?: (callNo: number, id: number) => number | undefined;
    modal?: boolean;
  },
): Promise<Run> {
  const captured: Captured = { order: [], requests: [] };
  const sam = samResponder(captured, opts.conf ?? (() => 0.9));
  const ledger = modelLedger();
  const client = fakeMuse(captured, {
    analysis: dnaAnalysis,
    gen: opts.gen ?? goldenLabelGen,
    ...(opts.repair !== undefined ? { repair: opts.repair } : {}),
    grounding: opts.grounding,
    ...(opts.modal === true ? { modal: true } : {}),
  });
  const storageDir = mkdtempSync(join(tmpdir(), 's8c-ground-'));
  const { done } = startJob(
    DNA,
    {
      client,
      storageDir,
      purpose: 'test-live',
      flow: 'lesson',
      newJobId: () => jobId,
      sam: { apiKey: SAM_KEY, ledger: ledger.ledger, fetch: sam.impl },
      limits: { maxRepairAttempts: opts.maxRepairAttempts ?? 0 },
    },
    () => {},
  );
  const summary = await done;
  const runDir = join(storageDir, 'runs', jobId);
  const read = (name: string): any => {
    try {
      return JSON.parse(readFileSync(join(runDir, name), 'utf8'));
    } catch {
      return undefined;
    }
  };
  const events = readFileSync(join(runDir, 'events.jsonl'), 'utf8')
    .split('\n')
    .filter(l => l.trim() !== '')
    .map(l => JSON.parse(l) as JobStageEvent);
  return {
    summary,
    jobFile: read('job.json'),
    ledger,
    client,
    captured,
    sam,
    events,
    seg: events.filter(e => e.stage === ('segment' as never)),
    r1: read('label-diagram-v1.r1.json'),
    r2: read('label-diagram-v1.r2.json'),
    label: read('lesson.json').components.find((c: any) => c.componentId === 'label-diagram-v1'),
  };
}

const groundingRequests = (r: Run) => r.captured.requests.filter(q => q.schemaName === 'label_grounding');
/** Job cost = every Muse receipt (grounding ones at their own price) + the charge a failed grounding call settled + SAM. */
function assertAccounted(r: Run, groundingCharged: number, unknownUSD: number, groundingReceipts: number): void {
  const others = r.client.calls.filter(c => c !== 'label_grounding').length;
  const expected = roundCost(others * MUSE_COST + groundingReceipts * GROUNDING_COST + groundingCharged + r.ledger.committed());
  assert.equal(r.summary.totalCostUSD, expected, 'totalCostUSD = receipts + grounding charge + SAM ledger amount, each once');
  assert.equal(r.summary.reservedUnknownUSD, unknownUSD, 'reservedUnknownUSD');
  assert.equal(r.jobFile.totalCostUSD, r.summary.totalCostUSD, 'job.json persisted the same total');
  assert.equal(r.jobFile.reservedUnknownUSD, r.summary.reservedUnknownUSD, 'job.json persisted the same unknown');
}

/** The prompt objects SAM should get when Muse's union is the golden area of every part. */
function expectedGroundedObjects(unions: (Box4 | null)[], gen = goldenLabelGen): SamObject[] {
  return gen.parts.map((p, i): SamObject => {
    const u = unions[i] ?? null;
    const box = u === null ? null : groundingPromptBox(u, W, H);
    return box !== null ? { id: i + 1, box } : { ...samObjectsFor([p], W, H)[0]!, id: i + 1 };
  });
}

/* ------------------------------------------------------------------ */
/* Success: request shape, SAM prompt, stored ground, events, accounting */
/* ------------------------------------------------------------------ */

test('grounding: one label_grounding request with the exact prompt and the generation call\'s image; SAM gets the union +4% boxes', async () => {
  const r = await run('lesson-ground-ok', { grounding: () => ({ data: groundingAnswer(goldenUnions()) }) });
  const reqs = groundingRequests(r);
  assert.equal(reqs.length, 1, 'ONE grounding call for the one revision');
  const q = reqs[0]!;
  assert.equal(q.schemaName, 'label_grounding');
  assert.equal(q.purpose, 'test-live');
  assert.equal(q.maxOutputTokens, 16000);
  assert.deepEqual(q.jsonSchema, GROUNDING_SCHEMA);
  assert.equal(q.messages.length, 1);
  const m = q.messages[0]!;
  assert.equal(m.role, 'user');
  // exactly the documented prompt with the golden parts' names and the printed labels their label boxes claim
  assert.equal(m.content, buildGroundingPrompt(goldenLabelGen.parts.map((p, i) => ({ name: p.name, printed: ['Base pairs', 'Adenine', 'Thymine', 'Guanine', 'Cytosine', 'Sugar phosphate backbone'][i]! }))));
  assert.equal(m.content, probe.results.find(x => x.figure === FIGURE_ID)!.prompt, 'identical to the live probe\'s DNA prompt');
  assert.ok(m.content.includes(`"the drawn sugar-phosphate backbone that the printed label 'Sugar phosphate backbone' points to"`));
  // the SAME image as the generation call
  assert.deepEqual(m.images, [{ url: IMAGE_URL }]);
  const gen = r.captured.requests.find(x => x.schemaName === 'label_diagram')!;
  assert.deepEqual(gen.messages.flatMap(x => x.images ?? []), [{ url: IMAGE_URL }]);

  // SAM prompt: union + 4% margin as boxes, in part order; one literal value worked by hand (adenine 600,270-700,340)
  assert.equal(r.sam.prompts.length, 1);
  const objects = expectedGroundedObjects(goldenUnions());
  assert.equal(r.sam.prompts[0], buildObjectsPrompt(objects, W, H));
  assert.ok(r.sam.prompts[0]!.includes('2<|box;x1=358;y1=160;x2=422;y2=206;w=600;h=600|>'), r.sam.prompts[0]);
  assert.ok(!r.sam.prompts[0]!.includes('point;'), 'every part was prompted by its grounded box');

  // grounding came BEFORE SAM, after the generation call
  assert.deepEqual(r.captured.order.filter(x => x !== 'muse:source_analysis_v2'), ['muse:label_diagram', 'muse:label_grounding', 'sam']);

  // regions carry the pixel union (without margin); the spec carries them too
  const regions = r.r1.regions as any[];
  assert.equal(regions.length, N);
  goldenUnions().forEach((u, i) => {
    assert.deepEqual(regions[i].ground, groundingPixelBox(u, W, H), `ground of ${regions[i].partId}`);
  });
  assert.deepEqual(regions[1].ground, { x1: 360, y1: 162, x2: 420, y2: 204 });
  assert.deepEqual(r.r1.spec.regions, r.r1.regions);

  // the persisted grounding record (the call's receipt, located count, the 0..1000 unions)
  assert.equal(r.r1.grounding.ok, true);
  assert.equal(r.r1.grounding.located, N);
  assert.equal(r.r1.grounding.of, N);
  assert.equal(r.r1.grounding.receipt.responseId, 'grounding-3');
  assert.equal(r.r1.grounding.receipt.estCostUSD, GROUNDING_COST);
  assert.deepEqual(r.r1.grounding.parts[1], { partId: 'part-adenine', ground: { x1: 600, y1: 270, x2: 700, y2: 340 } });

  // events: segment started unchanged; segment succeeded appends the grounding note; cost = grounding + SAM
  const started = r.seg.find(e => e.status === 'started');
  assert.equal(started?.detail, 'sam-3.1 point segmentation of 6 part(s)');
  const done = r.seg.filter(e => e.status !== 'started');
  assert.equal(done.length, 1);
  assert.equal(done[0]!.status, 'succeeded');
  assert.equal(done[0]!.detail, 'sam-3.1 returned 6 of 6 region(s); muse-spark-1.3 located 6 of 6 part(s) for SAM; sam-3.1 sure of 6 of 6 part(s)');
  assert.match(done[0]!.detail ?? '', /returned (\d+) of (\d+) region/, 'the web parser still matches');
  assert.equal(done[0]!.estCostUSD, roundCost(GROUNDING_COST + 0.0025));
  assert.equal((done[0] as any).imagesProcessed, 1, 'imagesProcessed stays SAM-only');
  assert.equal(r.label.status, 'passed');

  assertAccounted(r, 0, 0, 1);
  assert.equal(r.summary.totalCostUSD, roundCost(2 * MUSE_COST + GROUNDING_COST + 0.0025), 'analysis + label gen + grounding + one SAM image');
});

test('grounding: every revision gets its own call, made before that revision\'s SAM call (repair path)', async () => {
  const r = await run('lesson-ground-repair', {
    gen: brokenQuoteLabelGen(),
    repair: goldenLabelGen,
    maxRepairAttempts: 1,
    grounding: () => ({ data: groundingAnswer(goldenUnions()) }),
  });
  assert.equal(r.summary.status, 'succeeded');
  assert.deepEqual(r.captured.order.filter(x => x !== 'muse:source_analysis_v2'), [
    'muse:label_diagram',
    'muse:label_grounding',
    'sam',
    'muse:label_diagram_repair',
    'muse:label_grounding',
    'sam',
  ]);
  // the repaired revision's grounding request names the repaired gen's parts and carries the same image
  assert.equal(groundingRequests(r).length, 2);
  for (const q of groundingRequests(r)) assert.deepEqual(q.messages[0]!.images, [{ url: IMAGE_URL }]);
  const segDone = r.seg.filter(e => e.status === 'succeeded');
  assert.equal(segDone.length, 2);
  for (const e of segDone) assert.match(e.detail ?? '', /; muse-spark-1\.3 located 6 of 6 part\(s\) for SAM; sam-3\.1 sure of 6 of 6 part\(s\)$/);
  assert.equal((r.r2.regions as any[]).length, N);
  assert.ok((r.r2.regions as any[]).every(x => x.ground !== undefined));
  assert.equal(r.label.status, 'passed');
  assert.equal(r.label.revision, 2);
  assertAccounted(r, 0, 0, 2);
});

test('grounding: a part Muse did not box (or boxed with malformed boxes) falls back to its gen area; located counts the rest', async () => {
  const unions: (Box4 | null)[] = goldenUnions();
  unions[1] = null; // adenine omitted
  const answer = groundingAnswer(unions);
  // thymine: only malformed boxes -> ignored -> falls back
  answer.objects[2]!.bbox = [
    { x_min: 5.5, y_min: 1, x_max: 9, y_max: 9 },
    { x_min: 30, y_min: 30, x_max: 25, y_max: 40 },
    { x_min: 0, y_min: 0, x_max: 1001, y_max: 10 },
  ];
  unions[2] = null;
  const r = await run('lesson-ground-partial', { grounding: () => ({ data: answer }) });
  assert.equal(r.sam.prompts[0], buildObjectsPrompt(expectedGroundedObjects(unions), W, H));
  // the two fallback parts use their golden area exactly as before the grounding call existed
  assert.ok(r.sam.prompts[0]!.includes('2<|box;x1=360;y1=162;x2=420;y2=204;'), 'adenine: gen area (no margin)');
  const regions = r.r1.regions as any[];
  assert.equal(regions[1].ground, undefined);
  assert.equal(regions[2].ground, undefined);
  assert.ok(regions[0].ground !== undefined && regions[3].ground !== undefined);
  assert.equal(r.r1.grounding.located, 4);
  assert.equal(r.r1.grounding.parts[1].ground, null);
  const done = r.seg.find(e => e.status === 'succeeded');
  assert.equal(done?.detail, 'sam-3.1 returned 6 of 6 region(s); muse-spark-1.3 located 4 of 6 part(s) for SAM; sam-3.1 sure of 6 of 6 part(s)');
  assertAccounted(r, 0, 0, 1);
});

test('grounding: Muse boxing nothing at all is "located 0 of N", the gen areas are used, the call is still paid once', async () => {
  const r = await run('lesson-ground-none', { grounding: () => ({ data: { objects: [] } }) });
  assert.equal(r.sam.prompts[0], buildObjectsPrompt(samObjectsFor(goldenLabelGen.parts, W, H), W, H), 'identical to the pre-grounding behaviour');
  assert.ok((r.r1.regions as any[]).every(x => x.ground === undefined));
  const done = r.seg.find(e => e.status === 'succeeded');
  assert.equal(done?.detail, 'sam-3.1 returned 6 of 6 region(s); muse-spark-1.3 located 0 of 6 part(s) for SAM; sam-3.1 sure of 6 of 6 part(s)');
  assertAccounted(r, 0, 0, 1);
});

/* ------------------------------------------------------------------ */
/* Failure: accounted once, gen areas used, the component completes     */
/* ------------------------------------------------------------------ */

const genAreaPrompt = buildObjectsPrompt(samObjectsFor(goldenLabelGen.parts, W, H), W, H);
const usageReceipt = (cost: number, basis: 'usage' | 'reservation' = 'usage'): MetaReceipt => ({
  ...receipt('grounding-failed', cost),
  costBasis: basis,
});

interface FailCase {
  name: string;
  error: () => unknown;
  code: string;
  charged: number;
  unknown: number;
  data?: unknown;
}
const FAILS: FailCase[] = [
  {
    name: 'OUTPUT_TRUNCATED (settled and billed, receipt attached)',
    error: () =>
      new MetaError('OUTPUT_TRUNCATED', undefined, {
        chargedUSD: 0.07,
        reservedUnknownUSD: 0,
        costBasis: 'usage',
        receipt: usageReceipt(0.07),
      }),
    code: 'OUTPUT_TRUNCATED',
    charged: 0.07,
    unknown: 0,
  },
  {
    name: 'HTTP error with an uncertain outcome (SERVER_ERROR charged at the reservation)',
    error: () =>
      new MetaError('SERVER_ERROR', undefined, { status: 503, chargedUSD: 0.4, reservedUnknownUSD: 0.4, costBasis: 'reservation' }),
    code: 'SERVER_ERROR',
    charged: 0.4,
    unknown: 0.4,
  },
  {
    name: 'invalid JSON (OUTPUT_NOT_JSON, billed)',
    error: () => new MetaError('OUTPUT_NOT_JSON', undefined, { chargedUSD: 0.05, reservedUnknownUSD: 0, costBasis: 'usage' }),
    code: 'OUTPUT_NOT_JSON',
    charged: 0.05,
    unknown: 0,
  },
  {
    name: 'HTTP 400 rejected before billing (BAD_REQUEST, nothing charged)',
    error: () => new MetaError('BAD_REQUEST', undefined, { status: 400, chargedUSD: 0, reservedUnknownUSD: 0, costBasis: 'usage' }),
    code: 'BAD_REQUEST',
    charged: 0,
    unknown: 0,
  },
  {
    name: 'an unexpected non-Meta error (INTERNAL, no money known)',
    error: () => new Error('boom: provider text must never reach events'),
    code: 'INTERNAL',
    charged: 0,
    unknown: 0,
  },
];

for (const c of FAILS) {
  test(`grounding failure (${c.name}): charge accounted once, gen areas used, no ground, the component still completes`, async () => {
    const r = await run(`lesson-ground-fail-${c.code.toLowerCase()}-${c.charged}`, { grounding: () => ({ error: c.error() }) });
    assert.equal(r.sam.prompts.length, 1, 'SAM still ran, once');
    assert.equal(r.sam.prompts[0], genAreaPrompt, 'SAM got the generation areas, exactly as before the grounding call existed');
    assert.ok((r.r1.regions as any[]).every(x => x.ground === undefined), 'no ground on any region');
    assert.equal(r.summary.status, 'succeeded');
    assert.equal(r.label.status, 'passed', 'a failed grounding call never fails the component');
    assert.ok(!r.seg.some(e => e.status === 'failed'), 'no segment failure');
    const done = r.seg.find(e => e.status === 'succeeded');
    assert.equal(done?.detail, `sam-3.1 returned 6 of 6 region(s); muse-spark-1.3 grounding failed (${c.code}); used the generation areas; sam-3.1 sure of 6 of 6 part(s)`);
    assert.ok(!JSON.stringify(r.events).includes('provider text'), 'raw error text never reaches events');
    assert.equal(done?.estCostUSD, roundCost(c.charged + 0.0025), 'the event carries the grounding charge plus the SAM image');
    // the stored record says honestly that it failed, with the charge
    assert.equal(r.r1.grounding.ok, false);
    assert.equal(r.r1.grounding.code, c.code);
    assert.equal(r.r1.grounding.chargedUSD, c.charged);
    assert.equal(groundingRequests(r).length, 1, 'no retry of the grounding call');
    assertAccounted(r, c.charged, c.unknown, 0);
  });
}

test('grounding failure: well-formed JSON without an objects array is an OUTPUT_INVALID failure; the paid receipt is accounted once', async () => {
  const r = await run('lesson-ground-badshape', { grounding: () => ({ data: { nothing: true } }) });
  assert.equal(r.sam.prompts[0], genAreaPrompt);
  const done = r.seg.find(e => e.status === 'succeeded');
  assert.equal(done?.detail, 'sam-3.1 returned 6 of 6 region(s); muse-spark-1.3 grounding failed (OUTPUT_INVALID); used the generation areas; sam-3.1 sure of 6 of 6 part(s)');
  assert.equal(r.label.status, 'passed');
  assertAccounted(r, 0, 0, 1);
  assert.equal(r.r1.grounding.chargedUSD, GROUNDING_COST);
});

test('grounding failure on the repaired revision does not affect revision 1 and is accounted once there', async () => {
  const r = await run('lesson-ground-fail-r2', {
    gen: brokenQuoteLabelGen(),
    repair: goldenLabelGen,
    maxRepairAttempts: 1,
    grounding: n => (n === 1 ? { data: groundingAnswer(goldenUnions()) } : { error: new MetaError('OUTPUT_TRUNCATED', undefined, { chargedUSD: 0.07, reservedUnknownUSD: 0, costBasis: 'usage' }) }),
  });
  const done = r.seg.filter(e => e.status === 'succeeded');
  assert.match(done[0]!.detail ?? '', /located 6 of 6 part\(s\) for SAM; sam-3\.1 sure of 6 of 6 part\(s\)$/);
  assert.match(done[1]!.detail ?? '', /grounding failed \(OUTPUT_TRUNCATED\); used the generation areas; sam-3\.1 sure of 6 of 6 part\(s\)$/);
  assert.ok((r.r1.regions as any[]).every(x => x.ground !== undefined));
  assert.ok((r.r2.regions as any[]).every(x => x.ground === undefined));
  assert.equal(r.label.status, 'passed');
  assertAccounted(r, 0.07, 0, 1);
});

/* ------------------------------------------------------------------ */
/* SAM interplay                                                         */
/* ------------------------------------------------------------------ */

test('best-of retry: its widened E variant widens the box the first pass ACTUALLY used (the grounded one)', async () => {
  // thymine (part index 2) is weak on the first pass; the retry's E variant must be the grounded box widened by 20%.
  const unions = goldenUnions();
  const r = await run('lesson-ground-retry', {
    grounding: () => ({ data: groundingAnswer(unions) }),
    conf: (callNo, id) => (callNo === 1 ? (id === 3 ? 0.4 : 0.9) : 0.8),
  });
  assert.equal(r.sam.prompts.length, 2);
  const used = groundingPromptBox(unions[2]!, W, H)!; // what the first pass sent for thymine
  const clamp = (v: number, hi: number): number => Math.max(0, Math.min(hi, Math.round(v)));
  const dx = (used.x2 - used.x1) * 0.2;
  const dy = (used.y2 - used.y1) * 0.2;
  const wide = { x1: clamp(used.x1 - dx, W - 1), y1: clamp(used.y1 - dy, H - 1), x2: clamp(used.x2 + dx, W - 1), y2: clamp(used.y2 + dy, H - 1) };
  const genArea = samObjectsFor([goldenLabelGen.parts[2]!], W, H)[0]!.box!;
  assert.notDeepEqual(wide, genArea, 'the test distinguishes the grounded box from the gen area');
  const pointPx = { x: Math.round((goldenLabelGen.parts[2]!.x * W) / 1000), y: Math.round((goldenLabelGen.parts[2]!.y * H) / 1000) };
  assert.equal(
    r.sam.prompts[1],
    buildObjectsPrompt([{ id: 102, points: [pointPx] }, { id: 202, box: wide }], W, H),
  );
  const done = r.seg.find(e => e.status === 'succeeded');
  assert.equal(done?.detail, 'sam-3.1 returned 6 of 6 region(s); muse-spark-1.3 located 6 of 6 part(s) for SAM; sam-3.1 sure of 6 of 6 part(s); sam-3.1 retried 1 weak part(s): part-thymine 0.40 -> 0.80');
  // the region kept (the E variant) still stores Muse's union as ground
  const thy = (r.r1.regions as any[])[2];
  assert.deepEqual(thy.ground, groundingPixelBox(unions[2]!, W, H));
  assert.equal(thy.confidence, 0.8);
  assertAccounted(r, 0, 0, 1);
});

test('SAM failing after a good grounding call: the component fails on segmentation, the grounding charge is already accounted once', async () => {
  const captured: Captured = { order: [], requests: [] };
  const ledger = modelLedger();
  const client = fakeMuse(captured, { analysis: dnaAnalysis, gen: goldenLabelGen, grounding: () => ({ data: groundingAnswer(goldenUnions()) }) });
  const failing = (async () => ({ ok: false, status: 500, text: async (): Promise<string> => 'x' }) as unknown as Response) as unknown as typeof fetch;
  const storageDir = mkdtempSync(join(tmpdir(), 's8c-ground-'));
  const { done } = startJob(
    DNA,
    {
      client,
      storageDir,
      purpose: 'test-live',
      flow: 'lesson',
      newJobId: () => 'lesson-ground-samfail',
      sam: { apiKey: SAM_KEY, ledger: ledger.ledger, fetch: failing },
      limits: { maxRepairAttempts: 2 },
    },
    () => {},
  );
  const summary = await done;
  const events = readFileSync(join(storageDir, 'runs', 'lesson-ground-samfail', 'events.jsonl'), 'utf8')
    .split('\n')
    .filter(l => l.trim() !== '')
    .map(l => JSON.parse(l) as JobStageEvent);
  const segFail = events.find(e => e.stage === ('segment' as never) && e.status === 'failed');
  assert.equal(segFail?.detail, 'SAM_HTTP_500');
  assert.equal(segFail?.estCostUSD, roundCost(GROUNDING_COST + 0.0025), 'the failed segment event carries both charges');
  assert.equal(client.calls.filter(c => c === 'label_grounding').length, 1);
  assert.ok(!client.calls.includes('label_diagram_repair'), 'no repair after a segmentation failure');
  assert.equal(summary.totalCostUSD, roundCost(2 * MUSE_COST + GROUNDING_COST + ledger.committed()));
  assert.equal(summary.reservedUnknownUSD, 0.0025, 'the 5xx SAM image is the only unknown amount');
});

test('no grounding call when the segmentation cannot start (SAM not configured): nothing is spent on it', async () => {
  const captured: Captured = { order: [], requests: [] };
  const client = fakeMuse(captured, { analysis: dnaAnalysis, gen: goldenLabelGen, grounding: () => ({ data: groundingAnswer(goldenUnions()) }) });
  const storageDir = mkdtempSync(join(tmpdir(), 's8c-ground-'));
  const { done } = startJob(
    DNA,
    { client, storageDir, purpose: 'test-live', flow: 'lesson', newJobId: () => 'lesson-ground-nosam', limits: { maxRepairAttempts: 0 } },
    () => {},
  );
  await done;
  assert.ok(!client.calls.includes('label_grounding'));
});

/* ------------------------------------------------------------------ */
/* Pure helpers                                                          */
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

test('samObjectsFor: a grounded box wins over the gen area; a null entry keeps the gen area, then the point', () => {
  const noArea = part({ id: 'n', x: 100, y: 100, areaX1: undefined, areaY1: undefined, areaX2: undefined, areaY2: undefined });
  const parts = [part({}), part({ id: 'q' }), noArea, noArea];
  const grounded = { x1: 10, y1: 20, x2: 30, y2: 40 };
  assert.deepEqual(samObjectsFor(parts, W, H, [grounded, null, grounded, null]), [
    { id: 1, box: grounded },
    { id: 2, box: { x1: 240, y1: 240, x2: 360, y2: 360 } },
    { id: 3, box: grounded },
    { id: 4, points: [{ x: 60, y: 60 }] },
  ]);
  // unchanged without grounding
  assert.deepEqual(samObjectsFor(parts, W, H), samObjectsFor(parts, W, H, []));
});

test('samRetryObjectsFor: widens the grounded first-pass box; a part with only a grounded box (no gen area) now has an E to try', () => {
  const noArea = part({ areaX1: undefined, areaY1: undefined, areaX2: undefined, areaY2: undefined });
  const grounded = { x1: 100, y1: 100, x2: 200, y2: 140 };
  const plan = samRetryObjectsFor([noArea], [0], W, H, [grounded]);
  assert.deepEqual(plan.retried, [0]);
  assert.deepEqual(plan.objects, [
    { id: 100, points: [{ x: 300, y: 300 }] },
    { id: 200, box: { x1: 80, y1: 92, x2: 220, y2: 148 } },
  ]);
  assert.deepEqual(samRetryObjectsFor([noArea], [0], W, H), { objects: [], retried: [] }, 'without grounding nothing changes');
});

test('boxesToRegions: ground is attached per part when given, never invented', () => {
  const parts = [part({ id: 'a' }), part({ id: 'b' })];
  const boxes: SamBox[] = [
    { id: 1, x1: 1, y1: 1, x2: 2, y2: 2, confidence: 0.9 },
    { id: 2, x1: 3, y1: 3, x2: 4, y2: 4, confidence: 0.9 },
  ];
  const g = { x1: 0, y1: 0, x2: 5, y2: 5 };
  const withGround = boxesToRegions(boxes, parts, [g, null]);
  assert.deepEqual(withGround[0]!.ground, g);
  assert.equal('ground' in withGround[1]!, false);
  assert.equal(boxesToRegions(boxes, parts).some(x => 'ground' in x), false);
});

/* ------------------------------------------------------------------ */
/* Stage 8d: the grounding text names the model that located the parts   */
/* ------------------------------------------------------------------ */

test('8d: a Spark Open (Modal) job says muse-spark-open located K of N part(s); Spark 1.3 keeps muse-spark-1.3', async () => {
  const open = await run('lesson-ground-open-ok', { modal: true, grounding: () => ({ data: groundingAnswer(goldenUnions()) }) });
  assert.equal(open.summary.provider, 'modal');
  assert.equal(open.summary.model, 'muse-spark-open');
  assert.equal(open.label.status, 'passed', 'the diagram is built on a Modal job');
  const doneOpen = open.seg.find(e => e.status === 'succeeded');
  assert.equal(doneOpen?.detail, 'sam-3.1 returned 6 of 6 region(s); muse-spark-open located 6 of 6 part(s) for SAM; sam-3.1 sure of 6 of 6 part(s)');
  assert.ok(!String(doneOpen?.detail).includes('muse-spark-1.3'), 'never names Spark 1.3 on an open-weights job');
  // the dedicated grounding call goes through the job's own (Modal) client, with the figure image
  const reqs = groundingRequests(open);
  assert.equal(reqs.length, 1);
  assert.deepEqual(reqs[0]!.messages[0]!.images, [{ url: IMAGE_URL }]);

  const meta = await run('lesson-ground-meta-ok', { grounding: () => ({ data: groundingAnswer(goldenUnions()) }) });
  const doneMeta = meta.seg.find(e => e.status === 'succeeded');
  assert.match(doneMeta?.detail ?? '', /; muse-spark-1\.3 located 6 of 6 part\(s\) for SAM; /);
});

test('8d: a Spark Open grounding failure reads "muse-spark-open grounding failed (CODE); used the generation areas"', async () => {
  const r = await run('lesson-ground-open-fail', {
    modal: true,
    grounding: () => ({ error: new MetaError('TIMEOUT', undefined, { chargedUSD: 0.1, reservedUnknownUSD: 0.1, costBasis: 'reservation' }) }),
  });
  assert.equal(r.label.status, 'passed', 'a failed grounding call never fails the component');
  const done = r.seg.find(e => e.status === 'succeeded');
  assert.equal(done?.detail, 'sam-3.1 returned 6 of 6 region(s); muse-spark-open grounding failed (TIMEOUT); used the generation areas; sam-3.1 sure of 6 of 6 part(s)');
});
