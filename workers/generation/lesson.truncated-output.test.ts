// S6-W fix — keep the cut-off text of OUTPUT_TRUNCATED calls privately.
// Live evidence (docs/evidence/stage-6/evaluation-lesson-open): 6 parts were lost to
// OUTPUT_TRUNCATED and we could not see why because the cut-off text was discarded. The
// client (packages/meta, in parallel) attaches the partial text as a duck-typed string
// property `partialOutput` on the MetaError. The worker writes it — and ONLY it — to
// `storage/runs/<jobId>/<componentId>.r<N>.truncated.txt` (analysis calls:
// `analysis-v2.r<N>.truncated.txt`), UTF-8, as-is, capped at 200,000 chars. It never
// reaches events, job.json, API responses, logs or error messages.
//
// Fake MetaClient only — no network, no credits, no .env access. Synthetic marker text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listJobs, readJob, startJob } from './jobs.ts';
import type { JobSummary } from './jobs.ts';
import { MetaError } from '../../packages/meta/client.ts';
import type { CompleteRequest, MetaClient } from '../../packages/meta/client.ts';
import type { MetaReceipt, StageEvent } from '../../packages/contracts/index.ts';
import type { SourceAnalysisV2 } from '../../packages/contracts/kit.ts';

const FIX = '../../tests/fixtures/stage6/';
const usableAnalysis = JSON.parse(
  readFileSync(new URL(`${FIX}source-analysis-v2.usable.json`, import.meta.url), 'utf8'),
) as SourceAnalysisV2;
const quizGen = JSON.parse(readFileSync(new URL(`${FIX}quiz-cards.gen.json`, import.meta.url), 'utf8'));
const feGen = JSON.parse(readFileSync(new URL(`${FIX}formula-explorer.gen.json`, import.meta.url), 'utf8'));

const DRAG = 'nasa-grc-drag-equation';
const JOB = 'lesson-trunc-00000001';
/** Synthetic cut-off text; asserts prove it stays inside the private .truncated.txt file. */
const PARTIAL = 'SYNTH-PARTIAL-OUTPUT {"schemaVersion": "formula-explorer-v1", "title": "Drag cut off mid-sen';

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

/** What the real client throws after a paid, settled truncated call — with the partial text
 *  attached exactly like packages/meta does: a NON-ENUMERABLE `partialOutput` string. */
function truncatedError(responseId: string, partialOutput?: string): MetaError {
  const err = new MetaError('OUTPUT_TRUNCATED', undefined, {
    receipt: fakeReceipt(responseId),
    chargedUSD: 0.01,
    reservedUnknownUSD: 0,
    costBasis: 'usage',
  });
  if (partialOutput !== undefined) {
    Object.defineProperty(err, 'partialOutput', {
      value: partialOutput,
      enumerable: false,
      writable: true,
      configurable: true,
    });
  }
  return err;
}

interface FakeOpts {
  analysis?: unknown;
  kit?: Record<string, unknown>;
  throwOn?: Record<string, unknown>;
}

function fakeLessonClient(opts: FakeOpts = {}): MetaClient & { calls: string[] } {
  const calls: string[] = [];
  let n = 0;
  return {
    calls,
    complete: async <T,>(req: CompleteRequest): Promise<{ data: T; receipt: MetaReceipt }> => {
      const name = req.schemaName;
      calls.push(name);
      const err = opts.throwOn?.[name];
      if (err !== undefined) {
        throw err;
      }
      let data: unknown;
      if (name === 'source_analysis_v2') {
        data = opts.analysis ?? usableAnalysis;
      } else if (name === 'source_analysis_v2_repair') {
        data = opts.analysis ?? usableAnalysis;
      } else {
        data = opts.kit?.[name];
      }
      if (data === undefined) {
        throw new Error(`FAKE_MISSING_RESPONSE:${name}`);
      }
      n += 1;
      return { data: structuredClone(data) as T, receipt: fakeReceipt(`${name}-${n}`) };
    },
  };
}

function startLesson(opts: FakeOpts): {
  storageDir: string;
  jobId: string;
  done: Promise<JobSummary>;
  seen: StageEvent[];
} {
  const client = fakeLessonClient(opts);
  const storageDir = mkdtempSync(join(tmpdir(), 's6w-trunc-'));
  const seen: StageEvent[] = [];
  const { jobId, done } = startJob(
    DRAG,
    { client, storageDir, purpose: 'test-live', flow: 'lesson', newJobId: () => JOB },
    e => seen.push(e),
  );
  return { storageDir, jobId, done, seen };
}

/** Assert the partial text appears ONLY in the named private file, nowhere public. */
function assertPrivate(storageDir: string, jobId: string, fileName: string, expected: string): void {
  const runDir = join(storageDir, 'runs', jobId);
  assert.equal(readFileSync(join(runDir, fileName), 'utf8'), expected, `${fileName} holds the cut-off text as-is`);
  assert.ok(!readFileSync(join(runDir, 'events.jsonl'), 'utf8').includes(expected), 'never in events');
  assert.ok(!readFileSync(join(runDir, 'job.json'), 'utf8').includes(expected), 'never in job.json');
  const detail = readJob(storageDir, jobId);
  assert.ok(detail !== null);
  assert.ok(!JSON.stringify(detail).includes(expected), 'never in the API job detail');
  const list = listJobs(storageDir);
  assert.ok(!JSON.stringify(list).includes(expected), 'never in the API job list');
  // No run file other than the private one may carry the text.
  for (const f of readdirSync(runDir)) {
    if (f === fileName || f === 'events.jsonl' || f === 'job.json') {
      continue;
    }
    const raw = readFileSync(join(runDir, f), 'utf8');
    assert.ok(!raw.includes(expected), `partial text leaked into ${f}`);
  }
}

test('truncated-output: a truncated component GENERATION call saves <componentId>.r1.truncated.txt privately', async () => {
  const { storageDir, jobId, done } = startLesson({
    kit: { quiz_cards: quizGen },
    throwOn: { formula_explorer: truncatedError('fe-trunc-gen', PARTIAL) },
  });
  const summary = await done;
  assert.equal(summary.status, 'succeeded', 'a truncated component never fails the lesson');
  assert.equal(summary.lesson?.componentsFailed, 1);
  assertPrivate(storageDir, jobId, 'formula-explorer-v1.r1.truncated.txt', PARTIAL);
});

test('truncated-output: a truncated component REPAIR call saves <componentId>.r2.truncated.txt privately', async () => {
  const brokenFe = structuredClone(feGen) as { expression: string };
  brokenFe.expression = `(${feGen.expression as string}) + 1`; // fails FE-08 → repair runs
  const { storageDir, jobId, done } = startLesson({
    kit: { formula_explorer: brokenFe, quiz_cards: quizGen },
    throwOn: { formula_explorer_repair: truncatedError('fe-trunc-repair', PARTIAL) },
  });
  const summary = await done;
  assert.equal(summary.status, 'succeeded');
  assert.equal(summary.componentRepairs?.[0]?.passed, false);
  assertPrivate(storageDir, jobId, 'formula-explorer-v1.r2.truncated.txt', PARTIAL);
});

test('truncated-output: a truncated ANALYSIS call saves analysis-v2.r1.truncated.txt privately', async () => {
  const { storageDir, jobId, done } = startLesson({
    throwOn: { source_analysis_v2: truncatedError('analysis-trunc', PARTIAL) },
  });
  const summary = await done;
  assert.equal(summary.status, 'failed');
  assert.deepEqual(summary.error, { code: 'OUTPUT_TRUNCATED', message: 'output truncated' });
  assertPrivate(storageDir, jobId, 'analysis-v2.r1.truncated.txt', PARTIAL);
});

test('truncated-output: a truncated ANALYSIS REPAIR call saves analysis-v2.r2.truncated.txt privately', async () => {
  const broken = structuredClone(usableAnalysis);
  broken.overview.keyPoints[0].quote = 'a quote that is not on the page'; // forces the repair loop
  const { storageDir, jobId, done } = startLesson({
    analysis: broken,
    throwOn: { source_analysis_v2_repair: truncatedError('analysis-repair-trunc', PARTIAL) },
  });
  const summary = await done;
  assert.equal(summary.status, 'failed');
  assertPrivate(storageDir, jobId, 'analysis-v2.r2.truncated.txt', PARTIAL);
});

test('truncated-output: the saved text is capped at 200,000 characters', async () => {
  const huge = `${PARTIAL}${'x'.repeat(250_000)}`;
  const { storageDir, jobId, done } = startLesson({
    kit: { quiz_cards: quizGen },
    throwOn: { formula_explorer: truncatedError('fe-trunc-huge', huge) },
  });
  await done;
  const saved = readFileSync(join(storageDir, 'runs', jobId, 'formula-explorer-v1.r1.truncated.txt'), 'utf8');
  assert.equal(saved.length, 200_000);
  assert.equal(saved, huge.slice(0, 200_000));
});

test('truncated-output: no partialOutput property → no file, everything else unchanged', async () => {
  const { storageDir, jobId, done } = startLesson({
    kit: { quiz_cards: quizGen },
    throwOn: { formula_explorer: truncatedError('fe-trunc-bare') },
  });
  const summary = await done;
  assert.equal(summary.status, 'succeeded');
  assert.equal(summary.lesson?.componentsFailed, 1);
  const runDir = join(storageDir, 'runs', jobId);
  assert.ok(!existsSync(join(runDir, 'formula-explorer-v1.r1.truncated.txt')));
  assert.ok(!readdirSync(runDir).some(f => f.endsWith('.truncated.txt')));
});
