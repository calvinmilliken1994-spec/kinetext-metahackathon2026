// Teacher diagram (beta), docs/specs/TEACHER-FIGURE.md section 3 (worker): when a lesson job carries a figureId, ONE
// Muse call reads the diagram's printed labels before the analysis call (stage 'labels'), the result is stored as
// `<id>.labels.json` beside the figure and reused by later jobs, and the figure then runs through the unchanged
// label-diagram flow (Muse grounding, SAM 3.1, LD checks) exactly like a library figure. Failures (unloadable figure,
// MetaError, invalid shape, zero labels) account the charge and build the lesson without the figure.
// FAKE Muse client + FAKE SAM fetch; the real DNA figure bytes stored as a teacher upload in a temp dir.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readJob, startJob } from './jobs.ts';
import type { JobStageEvent, JobSummary } from './jobs.ts';
import { roundCost } from './job-support.ts';
import { MetaError } from '../../packages/meta/client.ts';
import type { ChatMessage, CompleteRequest, MetaClient } from '../../packages/meta/client.ts';
import { buildFigureLabelsPrompt, FIGURE_LABELS_SCHEMA, figureLabelsToBoxes } from '../../packages/meta/figure-labels.ts';
import { capPartLabelGroups, placeTeacherLabelBoxes, TEACHER_FIGURE_PART_LABELS_MAX } from './lesson.ts';
import type { Ledger } from '../../packages/meta/ledger.ts';
import { loadFigure } from '../../packages/sources/figures.ts';
import { loadSource, loadUserSourceMeta, saveUserSource, userFiguresDirOf, userSourcesDirOf } from '../../packages/sources/index.ts';
import { saveUserFigure } from '../../packages/sources/user-figures.ts';
import { normalizeUserText } from '../../packages/contracts/index.ts';
import type { MetaReceipt } from '../../packages/contracts/index.ts';
import type { LabelDiagramGen, LabelPartGen } from '../../packages/contracts/kit.ts';
import { recheckLesson } from '../../apps/api/recheck.ts';

const DNA = 'medlineplus-what-is-dna';
const LIB_FIGURE = 'medlineplus-dna-structure-1';
const libFigure = loadFigure(LIB_FIGURE);
const W = libFigure.meta.width; // 600
const H = libFigure.meta.height; // 600
const IMAGE_URL = `data:image/jpeg;base64,${Buffer.from(libFigure.bytes).toString('base64')}`;
const MUSE_COST = 0.01;
const GROUNDING_COST = 0.02;
const LABELS_COST = 0.03;
const SAM_KEY = 'synthetic-sam-test-key';

const goldenLabelGen = JSON.parse(
  readFileSync(new URL('../../tests/fixtures/stage6/label-diagram.gen.json', import.meta.url), 'utf8'),
) as LabelDiagramGen;
const libLabels = JSON.parse(
  readFileSync(new URL(`../../data/figures/${LIB_FIGURE}.labels.json`, import.meta.url), 'utf8'),
) as { boxes: { x1: number; y1: number; x2: number; y2: number; text?: string; group: number }[] };

/** The DNA analysis of lesson.grounding.test.ts: one label-diagram-v1 plan entry. */
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
};

/** Replace every library id in a fixture with the teacher run's ids (source and figure). */
function retarget<T>(value: T, sourceId: string, figureId: string): T {
  return JSON.parse(JSON.stringify(value).split(LIB_FIGURE).join(figureId).split(DNA).join(sourceId)) as T;
}

/**
 * Muse's printed-label answer for the DNA figure: the library's lead-verified boxes, shrunk by the worker's 30% pad
 * so the stored boxes land back on (about) the same pixels. One label per library group, text on its first line.
 */
function dnaLabelsAnswer(): { labels: { text: string; names_part: boolean; bbox: { x_min: number; y_min: number; x_max: number; y_max: number }[] }[] } {
  const groups = new Map<number, typeof libLabels.boxes>();
  for (const b of libLabels.boxes) groups.set(b.group, [...(groups.get(b.group) ?? []), b]);
  const grid = (px: number, size: number): number => Math.round((px * 1000) / size);
  return {
    labels: [...groups.values()].map(lines => ({
      text: lines.find(l => l.text !== undefined)!.text!,
      names_part: true,
      bbox: lines.map(l => {
        const h = (l.y2 - l.y1) / 1.6;
        const pad = Math.max(3, 0.3 * h);
        return {
          x_min: grid(l.x1 + pad, W),
          y_min: grid(l.y1 + pad, H),
          x_max: grid(l.x2 - pad, W),
          y_max: grid(l.y2 - pad, H),
        };
      }),
    })),
  };
}

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

type Reply = { data: unknown } | { error: unknown };

interface Captured {
  order: string[];
  requests: (CompleteRequest & { messages: ChatMessage[] })[];
}

const areaOf = (p: LabelPartGen) => ({ x_min: p.areaX1!, y_min: p.areaY1!, x_max: p.areaX2!, y_max: p.areaY2! });

function fakeMuse(captured: Captured, opts: { analysis: unknown; gen: LabelDiagramGen; labels: () => Reply }): MetaClient & { calls: string[] } {
  const calls: string[] = [];
  let n = 0;
  return {
    calls,
    complete: async <T,>(req: CompleteRequest): Promise<{ data: T; receipt: MetaReceipt }> => {
      calls.push(req.schemaName);
      captured.order.push(`muse:${req.schemaName}`);
      captured.requests.push(structuredClone({ ...req, signal: undefined }) as never);
      n += 1;
      if (req.schemaName === 'figure_labels') {
        const reply = opts.labels();
        if ('error' in reply) throw reply.error;
        return { data: structuredClone(reply.data) as T, receipt: receipt(`labels-${n}`, LABELS_COST) };
      }
      if (req.schemaName === 'label_grounding') {
        const data = { objects: opts.gen.parts.map((p, i) => ({ object_name: `part ${i}`, bbox: [areaOf(p)] })) };
        return { data: data as T, receipt: receipt(`grounding-${n}`, GROUNDING_COST) };
      }
      let data: unknown;
      if (req.schemaName === 'source_analysis_v2' || req.schemaName === 'source_analysis_v2_repair') data = opts.analysis;
      else if (req.schemaName === 'label_diagram') data = opts.gen;
      if (data === undefined) throw new Error(`FAKE_MISSING_RESPONSE:${req.schemaName}`);
      return { data: structuredClone(data) as T, receipt: receipt(`${req.schemaName}-${n}`) };
    },
  } as MetaClient & { calls: string[] };
}

function modelLedger(): { ledger: Ledger; committed(): number } {
  const holds = new Map<string, { est: number; actual?: number }>();
  let reserves = 0;
  return {
    committed: () => [...holds.values()].reduce((s, h) => s + (h.actual ?? h.est), 0),
    ledger: {
      capUSD: 150,
      reserve: (req): string => {
        reserves += 1;
        const id = `sam-res-${reserves}`;
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
}

/** SAM fake: each object answered with its own prompt box at confidence 0.9 (lesson.grounding.test.ts recipe). */
function samFake(captured: Captured): typeof fetch {
  return (async (_url: unknown, init?: { body?: unknown }) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    const prompt = (body['input'] as any)[0].content[0].text as string;
    const lines: string[] = [];
    for (const m of prompt.matchAll(/(?:^<0f>|,)(\d+)<\|(box|point);([^|]*)\|>/g)) {
      const kv = Object.fromEntries((m[3] as string).split(';').map(s => s.split('=') as [string, string])) as Record<string, string>;
      const b =
        m[2] === 'box'
          ? { x1: Number(kv['x1']), y1: Number(kv['y1']), x2: Number(kv['x2']), y2: Number(kv['y2']) }
          : { x1: Math.max(0, Number(kv['x']) - 50), y1: Math.max(0, Number(kv['y']) - 50), x2: Math.min(W - 1, Number(kv['x']) + 50), y2: Math.min(H - 1, Number(kv['y']) + 50) };
      lines.push(`${m[1]}<|box;x1=${b.x1};y1=${b.y1};x2=${b.x2};y2=${b.y2};w=${W};h=${H};c=0.9|><|mask;x=0;y=0;c=0.9;data=27,60,~!!!!M!0c[0o9|>`);
    }
    const text =
      [
        `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: `<0f>${lines.join(',')}` })}`,
        `data: ${JSON.stringify({ type: 'response.completed', usage: { images_processed: 1 } })}`,
      ].join('\n') + '\n';
    captured.order.push('sam');
    return { ok: true, status: 200, text: async (): Promise<string> => text } as unknown as Response;
  }) as unknown as typeof fetch;
}

interface Store {
  storageDir: string;
  sourceId: string;
  figureId: string;
  figuresDir: string;
}

/** The same DNA figure as a lossless PNG (the eval copy of the library JPEG's pixels): what every web upload is. */
const DNA_PNG = readFileSync(new URL('../../docs/evidence/figure-labels-eval/png/medlineplus-dna-structure-1.png', import.meta.url));

/** A temp storage dir holding the DNA page as a teacher source and the DNA figure (JPEG, or its PNG copy) as its diagram. */
function teacherStore(asPng = false): Store {
  const storageDir = mkdtempSync(join(tmpdir(), 'tf-worker-'));
  const text = normalizeUserText(loadSource(DNA).text);
  const { id: sourceId } = saveUserSource(
    { title: 'What is DNA (teacher copy)', text, license: 'public-domain', attribution: 'U.S. National Library of Medicine', rightsConfirmed: true },
    userSourcesDirOf(storageDir),
  );
  const figuresDir = userFiguresDirOf(storageDir);
  const { figureId } = saveUserFigure(
    asPng
      ? { mime: 'image/png', bytes: DNA_PNG, width: W, height: H, caption: 'DNA structure' }
      : { mime: 'image/jpeg', bytes: libFigure.bytes, width: W, height: H, caption: 'DNA structure' },
    loadUserSourceMeta(sourceId, userSourcesDirOf(storageDir)),
    figuresDir,
  );
  return { storageDir, sourceId, figureId, figuresDir };
}

interface Run {
  summary: JobSummary;
  jobFile: JobSummary;
  events: JobStageEvent[];
  labels: JobStageEvent[];
  captured: Captured;
  client: MetaClient & { calls: string[] };
  ledger: ReturnType<typeof modelLedger>;
  label: any;
  r1: any;
  record: any;
}

async function run(
  store: { storageDir: string },
  sourceId: string,
  jobId: string,
  opts: { figureId?: string; labels?: () => Reply; analysis?: unknown; gen?: LabelDiagramGen },
): Promise<Run> {
  const captured: Captured = { order: [], requests: [] };
  const ledger = modelLedger();
  const client = fakeMuse(captured, {
    analysis: opts.analysis ?? dnaAnalysis,
    gen: opts.gen ?? goldenLabelGen,
    labels: opts.labels ?? ((): Reply => ({ data: dnaLabelsAnswer() })),
  });
  const { done } = startJob(
    sourceId,
    {
      client,
      storageDir: store.storageDir,
      purpose: 'test-live',
      flow: 'lesson',
      newJobId: () => jobId,
      now: () => new Date('2026-11-03T09:00:00Z'),
      sam: { apiKey: SAM_KEY, ledger: ledger.ledger, fetch: samFake(captured) },
      limits: { maxRepairAttempts: 0 },
      ...(opts.figureId !== undefined ? { figureId: opts.figureId } : {}),
    },
    () => {},
  );
  const summary = await done;
  const runDir = join(store.storageDir, 'runs', jobId);
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
    events,
    labels: events.filter(e => e.stage === ('labels' as never)),
    captured,
    client,
    ledger,
    label: read('lesson.json')?.components?.find((c: any) => c.componentId === 'label-diagram-v1'),
    r1: read('label-diagram-v1.r1.json'),
    record: read('figure-labels.json'),
  };
}

const analysisRequest = (r: Run) => r.captured.requests.find(q => q.schemaName === 'source_analysis_v2')!;
const analysisText = (r: Run): string => analysisRequest(r).messages.map(m => m.content).join('\n');
const SENT_LIBRARY = /Figures \(untrusted data/;

/* ------------------------------------------------------------------ */
/* Success, end to end                                                   */
/* ------------------------------------------------------------------ */

test('teacher figure: ONE figure_labels call before the analysis, labels.json written, then the label-diagram flow runs like a library figure', async () => {
  const store = teacherStore();
  const { sourceId, figureId, figuresDir } = store;
  const r = await run(store, sourceId, 'tf-ok', { figureId, analysis: retarget(dnaAnalysis, sourceId, figureId), gen: retarget(goldenLabelGen, sourceId, figureId) });

  // the summary records the figure from the first write
  assert.equal(r.summary.figureId, figureId);
  assert.equal(r.jobFile.figureId, figureId);
  assert.equal(r.summary.sourceKind, 'user');

  // the request: schema, cap, the fixed prompt and the exact stored bytes as a data URL
  const reqs = r.captured.requests.filter(q => q.schemaName === 'figure_labels');
  assert.equal(reqs.length, 1);
  const q = reqs[0]!;
  assert.equal(q.purpose, 'test-live');
  assert.equal(q.maxOutputTokens, 16000);
  assert.deepEqual(q.jsonSchema, FIGURE_LABELS_SCHEMA);
  assert.equal(q.messages.length, 1);
  assert.equal(q.messages[0]!.role, 'user');
  assert.equal(q.messages[0]!.content, buildFigureLabelsPrompt());
  assert.deepEqual(q.messages[0]!.images, [{ url: IMAGE_URL }]);

  // order: labels first, then the unchanged flow (analysis, generation, grounding, SAM)
  assert.deepEqual(r.captured.order, ['muse:figure_labels', 'muse:source_analysis_v2', 'muse:label_diagram', 'muse:label_grounding', 'sam']);
  const stages = r.events.map(e => `${e.stage}:${e.status}`);
  assert.deepEqual(stages.slice(0, 5), ['ingest:started', 'ingest:succeeded', 'labels:started', 'labels:succeeded', 'analyze:started']);

  // the events: started names the figure; succeeded carries the Muse receipt fields and the detail text
  const [started, succeeded] = r.labels;
  assert.equal(started!.status, 'started');
  assert.equal((started as any).figureId, figureId);
  assert.equal(succeeded!.status, 'succeeded');
  assert.equal(succeeded!.detail, 'Muse read 6 printed labels (6 name parts)');
  assert.equal(succeeded!.estCostUSD, LABELS_COST);
  assert.equal(succeeded!.latencyMs, 42);
  assert.equal(succeeded!.responseId, 'labels-1');
  assert.equal(succeeded!.model, 'muse-spark-1.3');

  // labels.json beside the figure, in the readLabelsFile shape
  const file = JSON.parse(readFileSync(join(figuresDir, `${figureId}.labels.json`), 'utf8'));
  assert.deepEqual(Object.keys(file), ['figureId', 'imageSha256', 'width', 'height', 'method', 'boxes', 'partLabelGroups']);
  assert.equal(file.figureId, figureId);
  assert.equal(file.imageSha256, libFigure.meta.sha256);
  assert.equal(file.width, W);
  assert.equal(file.height, H);
  assert.equal(file.method, 'Muse Spark printed-label reading (muse-spark-1.3, tf-ok, 2026-11-03); beta, not checked by a person; boxes as Muse placed them (JPEG, not snapped)');
  assert.equal(file.boxes.length, 7, 'six labels, the backbone on two lines');
  assert.deepEqual(file.partLabelGroups, [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(file.boxes.filter((b: any) => b.text !== undefined).map((b: any) => b.text), ['Base pairs', 'Thymine', 'Adenine', 'Guanine', 'Cytosine', 'Sugar phosphate backbone']);
  // the shrink-then-pad round trip lands within 2 px of the library's lead-verified boxes
  file.boxes.forEach((b: any, i: number) => {
    const l = libLabels.boxes[i]!;
    for (const k of ['x1', 'y1', 'x2', 'y2'] as const) assert.ok(Math.abs(b[k] - l[k]) <= 2, `box ${i} ${k}: ${b[k]} vs ${l[k]}`);
  });
  assert.equal(r.record.ok, true);
  assert.equal(r.record.labels, 6);
  assert.equal(r.record.partLabels, 6);
  assert.equal(r.record.boxPlacement, 'jpeg-not-snapped', 'a JPEG upload is never snapped');
  assert.equal(r.record.boxesMoved, 0);

  // the analysis lists the teacher figure; the generation call carries its image and the page-named printed labels
  assert.match(analysisText(r), new RegExp(`- ${figureId} — DNA structure — labelsInImage: true`));
  const gen = r.captured.requests.find(x => x.schemaName === 'label_diagram')!;
  assert.deepEqual(gen.messages.flatMap(m => m.images ?? []), [{ url: IMAGE_URL }]);
  assert.match(gen.messages.map(m => m.content).join('\n'), /Sugar phosphate backbone/);

  // the published part: the same outcome as the library figure, with the teacher figure's ref
  assert.equal(r.label.status, 'passed', JSON.stringify(r.r1?.report?.checks?.filter((c: any) => !c.passed)));
  assert.equal(r.r1.spec.figure.id, figureId);
  assert.equal(r.r1.spec.figure.provided, 'teacher');
  assert.equal(r.r1.spec.figure.credit, 'U.S. National Library of Medicine');
  assert.deepEqual(r.r1.spec.figure.labelBoxes, file.boxes);
  assert.deepEqual(r.r1.spec.figure.partLabelGroups, [0, 1, 2, 3, 4, 5]);
  assert.equal(r.r1.regions.length, goldenLabelGen.parts.length);

  // money: every Muse receipt (labels at its own price) plus SAM, once
  const others = r.client.calls.filter(c => c !== 'figure_labels' && c !== 'label_grounding').length;
  assert.equal(r.summary.totalCostUSD, roundCost(others * MUSE_COST + GROUNDING_COST + LABELS_COST + r.ledger.committed()));
  assert.equal(r.jobFile.totalCostUSD, r.summary.totalCostUSD);

  // the library run of the same page: identical outcome, no labels stage, no figure_labels call
  const lib = await run({ storageDir: mkdtempSync(join(tmpdir(), 'tf-lib-')) }, DNA, 'tf-lib', {});
  assert.equal(lib.labels.length, 0);
  assert.ok(!lib.client.calls.includes('figure_labels'));
  assert.ok(!('figureId' in lib.summary));
  assert.equal(lib.label.status, r.label.status);
  assert.deepEqual(lib.r1.regions.map((x: any) => [x.partId, x.x1, x.y1, x.x2, x.y2]), r.r1.regions.map((x: any) => [x.partId, x.x1, x.y1, x.x2, x.y2]));
  assert.equal(lib.r1.report.checks.length, r.r1.report.checks.length);
  assert.ok(!('provided' in lib.r1.spec.figure), 'library refs carry no provided key');

  // serve time: today's recheck resolves the uf- figure from the user dir and keeps the part checked
  const job = readJob(store.storageDir, 'tf-ok')!;
  recheckLesson(store.storageDir, job as never, { userSourcesDir: userSourcesDirOf(store.storageDir), userFiguresDir: figuresDir });
  const served = (job.lesson as any).components.find((c: any) => c.componentId === 'label-diagram-v1');
  assert.equal(served.recheck?.publishable, true, JSON.stringify(served.recheck));
});

test('teacher figure: a second job reuses labels.json (no call, "Printed labels read earlier", no cost)', async () => {
  const store = teacherStore();
  const { sourceId, figureId } = store;
  const analysis = retarget(dnaAnalysis, sourceId, figureId);
  const gen = retarget(goldenLabelGen, sourceId, figureId);
  const first = await run(store, sourceId, 'tf-first', { figureId, analysis, gen });
  assert.equal(first.client.calls.filter(c => c === 'figure_labels').length, 1);
  const second = await run(store, sourceId, 'tf-second', {
    figureId,
    analysis,
    gen,
    labels: () => {
      throw new Error('the labels call must not be made again');
    },
  });
  assert.ok(!second.client.calls.includes('figure_labels'));
  assert.deepEqual(second.labels.map(e => e.status), ['started', 'succeeded']);
  const ok = second.labels[1]!;
  assert.equal(ok.detail, 'Printed labels read earlier');
  assert.ok(!('estCostUSD' in ok) && !('responseId' in ok), 'no cost on a reuse');
  assert.equal(second.label.status, 'passed');
  assert.match(analysisText(second), new RegExp(figureId));
  // labels.json still names the FIRST job (nothing rewritten)
  const file = JSON.parse(readFileSync(join(store.figuresDir, `${figureId}.labels.json`), 'utf8'));
  assert.match(file.method, /tf-first/);
});

/* ------------------------------------------------------------------ */
/* Failures: accounted, the lesson is built without the figure           */
/* ------------------------------------------------------------------ */

const FAILED_READ = 'Muse could not read the diagram\'s labels, so the lesson was built without it.';

async function failing(labels: () => Reply, jobId: string): Promise<{ r: Run; store: Store }> {
  const store = teacherStore();
  const r = await run(store, store.sourceId, jobId, {
    figureId: store.figureId,
    labels,
    analysis: retarget(dnaAnalysis, store.sourceId, store.figureId),
    gen: retarget(goldenLabelGen, store.sourceId, store.figureId),
  });
  return { r, store };
}

function assertBuiltWithout(r: Run, store: Store): void {
  assert.ok(!existsSync(join(store.figuresDir, `${store.figureId}.labels.json`)), 'no labels.json written');
  assert.ok(r.client.calls.includes('source_analysis_v2'), 'the job continued to the analysis');
  assert.doesNotMatch(analysisText(r), SENT_LIBRARY, 'no figure listed for the analysis');
  assert.ok(!r.client.calls.includes('label_diagram'), 'no label diagram without a figure');
  assert.equal(r.summary.figureId, store.figureId, 'the summary still records the requested figure');
}

test('teacher figure: a MetaError from the labels call is accounted, labels failed, the lesson goes on without the figure', async () => {
  const { r, store } = await failing(
    () => ({ error: new MetaError('SERVER_ERROR', undefined, { status: 503, chargedUSD: 0.04, reservedUnknownUSD: 0.04, costBasis: 'reservation' }) }),
    'tf-meta-error',
  );
  assert.deepEqual(r.labels.map(e => e.status), ['started', 'failed']);
  assert.equal(r.labels[1]!.detail, FAILED_READ);
  assert.equal(r.labels[1]!.estCostUSD, 0.04);
  assertBuiltWithout(r, store);
  const others = r.client.calls.filter(c => c !== 'figure_labels').length;
  assert.equal(r.summary.totalCostUSD, roundCost(0.04 + others * MUSE_COST));
  assert.equal(r.summary.reservedUnknownUSD, 0.04);
  assert.deepEqual(r.record, { ok: false, figureId: store.figureId, code: 'SERVER_ERROR', chargedUSD: 0.04, unknownUSD: 0.04 });
});

test('teacher figure: an answer of the wrong shape is paid for, labels failed, no figure', async () => {
  const { r, store } = await failing(() => ({ data: { objects: [] } }), 'tf-bad-shape');
  assert.deepEqual(r.labels.map(e => e.status), ['started', 'failed']);
  assert.equal(r.labels[1]!.detail, FAILED_READ);
  assert.equal(r.labels[1]!.estCostUSD, LABELS_COST);
  assert.equal(r.labels[1]!.responseId, 'labels-1');
  assertBuiltWithout(r, store);
  const others = r.client.calls.filter(c => c !== 'figure_labels').length;
  assert.equal(r.summary.totalCostUSD, roundCost(LABELS_COST + others * MUSE_COST));
  assert.equal(r.record.code, 'OUTPUT_INVALID');
});

test('teacher figure: zero usable labels is a failure too (accounted, no figure)', async () => {
  for (const [jobId, data] of [['tf-zero', { labels: [] }], ['tf-empty-text', { labels: [{ text: '  ', names_part: true, bbox: [{ x_min: 1, y_min: 1, x_max: 9, y_max: 9 }] }] }]] as const) {
    const { r, store } = await failing(() => ({ data }), jobId);
    assert.deepEqual(r.labels.map(e => e.status), ['started', 'failed'], jobId);
    assert.equal(r.labels[1]!.detail, FAILED_READ);
    assertBuiltWithout(r, store);
    const others = r.client.calls.filter(c => c !== 'figure_labels').length;
    assert.equal(r.summary.totalCostUSD, roundCost(LABELS_COST + others * MUSE_COST));
    assert.equal(r.record.code, 'NO_LABELS');
  }
});

test('teacher figure: an unloadable figure (tampered bytes) makes no call and builds the lesson without it', async () => {
  const store = teacherStore();
  writeFileSync(join(store.figuresDir, `${store.figureId}.jpg`), Buffer.from('tampered'));
  const r = await run(store, store.sourceId, 'tf-tampered', { figureId: store.figureId, analysis: retarget(dnaAnalysis, store.sourceId, store.figureId) });
  assert.deepEqual(r.labels.map(e => e.status), ['started', 'failed']);
  assert.equal(r.labels[1]!.detail, 'The diagram could not be loaded, so the lesson was built without it.');
  assert.ok(!('estCostUSD' in r.labels[1]!));
  assert.ok(!r.client.calls.includes('figure_labels'));
  assertBuiltWithout(r, store);
});

test('teacher figure: the worker boundary refuses a malformed figureId and a figureId on a library source', () => {
  const storageDir = mkdtempSync(join(tmpdir(), 'tf-boundary-'));
  const client = { complete: async () => { throw new Error('never'); } } as unknown as MetaClient;
  assert.throws(() => startJob('user-0123456789ab', { client, storageDir, purpose: 'test-live', flow: 'lesson', figureId: 'not-a-figure' }), /FIGURE_ID_INVALID/);
  assert.throws(() => startJob(DNA, { client, storageDir, purpose: 'test-live', flow: 'lesson', figureId: 'uf-0123456789ab' }), /FIGURE_ID_INVALID/);
});

/* ------------------------------------------------------------------ */
/* PNG uploads: Muse's boxes snapped onto the printed text; part cap      */
/* ------------------------------------------------------------------ */

/** Share of a library box's pixels inside the union of the stored boxes (the eval's coverage measure). */
function coverage(b: { x1: number; y1: number; x2: number; y2: number }, boxes: { x1: number; y1: number; x2: number; y2: number }[]): number {
  let n = 0, inside = 0;
  for (let y = b.y1; y < b.y2; y++) {
    for (let x = b.x1; x < b.x2; x++) {
      n++;
      if (boxes.some(m => m.x1 <= x && x < m.x2 && m.y1 <= y && y < m.y2)) inside++;
    }
  }
  return n === 0 ? 1 : inside / n;
}

/** dnaLabelsAnswer with every line box moved by (dx, dy) grid units, the way Muse sometimes misplaces boxes. */
function shiftedDnaAnswer(dx: number, dy: number): ReturnType<typeof dnaLabelsAnswer> {
  const a = dnaLabelsAnswer();
  for (const l of a.labels) {
    for (const b of l.bbox) {
      b.x_min += dx;
      b.x_max += dx;
      b.y_min += dy;
      b.y_max += dy;
    }
  }
  return a;
}

test('teacher figure (PNG): Muse boxes shifted off the words are snapped back onto the printed text before labels.json is written', async () => {
  const store = teacherStore(true);
  const { sourceId, figureId, figuresDir } = store;
  // about 35 px right and 6 px down on the 600 px image: the stored covers would miss the start of every word
  const answer = shiftedDnaAnswer(58, 10);
  const r = await run(store, sourceId, 'tf-png', {
    figureId,
    labels: () => ({ data: answer }),
    analysis: retarget(dnaAnalysis, sourceId, figureId),
    gen: retarget(goldenLabelGen, sourceId, figureId),
  });
  assert.equal(r.labels[1]!.status, 'succeeded');
  const file = JSON.parse(readFileSync(join(figuresDir, `${figureId}.labels.json`), 'utf8'));
  assert.equal(
    file.method,
    'Muse Spark printed-label reading (muse-spark-1.3, tf-png, 2026-11-03); beta, not checked by a person; boxes snapped to the printed text',
  );
  assert.equal(file.boxes.length, 7);
  assert.deepEqual(
    file.boxes.map((b: any) => b.text ?? null),
    ['Base pairs', 'Thymine', 'Adenine', 'Guanine', 'Cytosine', 'Sugar phosphate backbone', null],
    'text and order kept',
  );
  // the single-line labels: missed before the snap, fully covered after it
  const unsnapped = figureLabelsToBoxes(answer, W, H)!.boxes;
  const singles = libLabels.boxes.filter(b => b.text !== undefined && b.text !== 'Sugar phosphate backbone');
  assert.equal(singles.length, 5);
  for (const b of singles) {
    assert.ok(coverage(b, unsnapped) < 0.98, `${b.text} is missed before the snap`);
    assert.ok(coverage(b, file.boxes) >= 0.98, `${b.text} covered after the snap: ${coverage(b, file.boxes).toFixed(3)}`);
  }
  assert.equal(r.record.boxPlacement, 'snapped');
  assert.ok(r.record.boxesMoved >= 5, String(r.record.boxesMoved));
  // the job reads the stored (snapped) boxes back for the rest of the flow
  if (r.r1 !== undefined) assert.deepEqual(r.r1.spec.figure.labelBoxes, file.boxes);
});

test('placeTeacherLabelBoxes: PNG snapped; a JPEG, an undecodable PNG or a size mismatch keep the boxes as read', () => {
  const boxes = [{ x1: 1, y1: 2, x2: 30, y2: 20, text: 'Wing', group: 0 }];
  assert.deepEqual(placeTeacherLabelBoxes(boxes, 'image/jpeg', libFigure.bytes, W, H), { boxes, placement: 'jpeg-not-snapped', moved: 0 });
  assert.deepEqual(placeTeacherLabelBoxes(boxes, 'image/png', new Uint8Array([1, 2, 3]), W, H), { boxes, placement: 'png-not-decodable', moved: 0 });
  assert.deepEqual(placeTeacherLabelBoxes(boxes, 'image/png', DNA_PNG, W + 1, H), { boxes, placement: 'png-not-decodable', moved: 0 });
  assert.equal(placeTeacherLabelBoxes(boxes, 'image/png', DNA_PNG, W, H).placement, 'snapped');
});

test('capPartLabelGroups: at most 6, page-named labels first (Muse order), then the rest in Muse order, ascending', () => {
  const boxes = ['Gizmo', 'Wing', 'Thing', 'Jet Engine', 'Flaps', 'Rudder', 'Widget', 'Fuselage', 'Spoiler', 'Tail'].map((text, group) => ({ text, group }));
  const page = ['The wing and the fuselage carry the jet engines; the rudder and the flaps steer. A spoiler dumps lift.'];
  // page names: Wing(1), Jet Engine(3, plural), Flaps(4), Rudder(5), Fuselage(7), Spoiler(8) -> exactly six
  assert.deepEqual(capPartLabelGroups(boxes, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], page), [1, 3, 4, 5, 7, 8]);
  // fewer page-named than 6: filled from the others in Muse order
  assert.deepEqual(capPartLabelGroups(boxes, [0, 1, 2, 6, 9, 3, 4], ['wing only']), [0, 1, 2, 3, 4, 6]);
  // 6 or fewer: all kept; a line box without text is ignored for the text; duplicates collapse
  assert.deepEqual(capPartLabelGroups([...boxes, { group: 1 }], [9, 1, 1, 0], page), [0, 1, 9]);
  assert.deepEqual(capPartLabelGroups(boxes, [], page), []);
  // "Surface Runoff" on a page that only says "runoff" counts as page-named (pageWordingOfLabel's last-word rule)
  assert.deepEqual(
    capPartLabelGroups([{ text: 'A', group: 0 }, { text: 'Surface Runoff', group: 1 }], [0, 1], ['rain becomes runoff'], 1),
    [1],
  );
  assert.equal(TEACHER_FIGURE_PART_LABELS_MAX, 6);
});

test('teacher figure: at most 6 part labels are stored, the ones the page names first', async () => {
  const store = teacherStore(true);
  const { sourceId, figureId, figuresDir } = store;
  // Muse marks 9 labels as part names: three the page never mentions come FIRST in its list, then the six DNA labels
  const answer = dnaLabelsAnswer();
  const extra = ['Zorblax', 'Quindle', 'Frabnitz'].map((text, i) => ({
    text,
    names_part: true,
    bbox: [{ x_min: 20, y_min: 20 + i * 40, x_max: 140, y_max: 45 + i * 40 }],
  }));
  answer.labels = [...extra, ...answer.labels];
  const r = await run(store, sourceId, 'tf-cap', {
    figureId,
    labels: () => ({ data: answer }),
    analysis: retarget(dnaAnalysis, sourceId, figureId),
    gen: retarget(goldenLabelGen, sourceId, figureId),
  });
  const file = JSON.parse(readFileSync(join(figuresDir, `${figureId}.labels.json`), 'utf8'));
  assert.deepEqual(file.partLabelGroups, [3, 4, 5, 6, 7, 8], 'the six page-named DNA labels, not the three unnamed labels listed first');
  assert.equal(r.record.nameParts, 9, 'what Muse said');
  assert.equal(r.record.partLabels, 6, 'what was kept');
  assert.equal(r.labels[1]!.detail, 'Muse read 9 printed labels (9 name parts)');
});
