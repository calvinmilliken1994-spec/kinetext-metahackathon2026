// S6R-01 (worker wiring) — the overview is never published without its own checks.
//
// The lesson-flow analysis gate is validateLessonAnalysisGate (packages/validation, wave A3):
// validateAnalysisV2 (A-01..A-11) PLUS OV-01..OV-06 on a usable analysis, with the OV
// affected pointers prefixed '/overview' so they join the immutable revision-1 repair
// authority. An overview whose points/terms do not belong to their quotes (the reviewer's
// `overview-bypassed` probe: real drag quotes kept, unrelated point, invented term) must go
// through the existing analysis repair loop and must never be published unrepaired.
//
// Fake MetaClient only — no network, no credits, no .env access.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startJob } from './jobs.ts';
import type { JobStageEvent, JobSummary } from './jobs.ts';
import { validateLessonAnalysis } from './lesson.ts';
import { loadSource } from '../../packages/sources/index.ts';
import type { CompleteRequest, MetaClient } from '../../packages/meta/client.ts';
import type { MetaReceipt } from '../../packages/contracts/index.ts';
import type { LessonSpec, SourceAnalysisV2 } from '../../packages/contracts/kit.ts';

const FIX = '../../tests/fixtures/stage6/';
const usableAnalysis = JSON.parse(readFileSync(new URL(`${FIX}source-analysis-v2.usable.json`, import.meta.url), 'utf8')) as SourceAnalysisV2;
const quizGen = JSON.parse(readFileSync(new URL(`${FIX}quiz-cards.gen.json`, import.meta.url), 'utf8'));
const feGen = JSON.parse(readFileSync(new URL(`${FIX}formula-explorer.gen.json`, import.meta.url), 'utf8'));
const DRAG = 'nasa-grc-drag-equation';

/** Reviewer probe `overview-bypassed`: the real quotes stay, the words no longer belong to them. */
function mismatched(): SourceAnalysisV2 {
  const a = structuredClone(usableAnalysis);
  const p0 = a.overview.keyPoints[0];
  const t0 = a.overview.keyTerms[0];
  assert.ok(p0 !== undefined && t0 !== undefined);
  p0.point = 'Bananas become purple while mountains sing softly.';
  t0.term = 'teleportation';
  t0.gloss = 'Teleportation moves mountains between distant planets.';
  return a;
}

function fakeReceipt(responseId: string): MetaReceipt {
  return {
    purpose: 'test-live',
    requestedModel: 'muse-spark-1.3',
    returnedModel: 'muse-spark-1.3',
    responseId,
    usage: { promptTokens: 1200, completionTokens: 800, reasoningTokens: 300, cachedTokens: 0 },
    latencyMs: 42,
    estCostUSD: 0.01,
    finishReason: 'stop',
    attempts: 1,
  };
}

function queuedClient(queues: Record<string, unknown[]>): MetaClient & { calls: string[] } {
  const calls: string[] = [];
  const used: Record<string, number> = {};
  return {
    calls,
    complete: async <T,>(req: CompleteRequest): Promise<{ data: T; receipt: MetaReceipt }> => {
      const name = req.schemaName;
      calls.push(name);
      const q = queues[name];
      if (q === undefined || q.length === 0) {
        throw new Error(`FAKE_MISSING_RESPONSE:${name}`);
      }
      const i = used[name] ?? 0;
      used[name] = i + 1;
      return { data: structuredClone(q[Math.min(i, q.length - 1)]) as T, receipt: fakeReceipt(`${name}-${calls.length}`) };
    },
  };
}

function readEvents(storageDir: string, jobId: string): JobStageEvent[] {
  return readFileSync(join(storageDir, 'runs', jobId, 'events.jsonl'), 'utf8')
    .split('\n')
    .filter(line => line.trim() !== '')
    .map(line => JSON.parse(line) as JobStageEvent);
}

const failedIds = (r: { checks: { id: string; passed: boolean }[] }): string[] => r.checks.filter(c => !c.passed).map(c => c.id);

test('S6R-01: the lesson analysis gate runs the overview checks (OV-02/OV-06 catch the bypass validateAnalysisV2 alone misses)', () => {
  const source = loadSource(DRAG);
  const golden = validateLessonAnalysis(usableAnalysis, [source]);
  assert.deepEqual(failedIds(golden), [], 'the golden usable analysis passes the whole gate');
  assert.ok(golden.checks.some(c => c.id.startsWith('OV-')), 'OV checks are part of the lesson gate');
  const bad = validateLessonAnalysis(mismatched(), [source]);
  assert.equal(bad.publishable, false);
  assert.ok(failedIds(bad).includes('OV-02'), failedIds(bad).join());
  assert.ok(failedIds(bad).includes('OV-06'), failedIds(bad).join());
  for (const c of bad.checks.filter(x => !x.passed && x.id.startsWith('OV-'))) {
    for (const p of c.affected ?? []) {
      assert.ok(p.startsWith('/overview/'), `${c.id} pointer ${p} joins the analysis authority under /overview`);
    }
  }
});

test('S6R-01: an overview failing OV checks goes through the analysis repair loop; the repaired overview is the one published', async () => {
  const honest = mismatched();
  const p0 = honest.overview.keyPoints[0];
  const t0 = honest.overview.keyTerms[0];
  assert.ok(p0 !== undefined && t0 !== undefined);
  // Restore the original (gate-passing) wording of exactly the flagged fields.
  p0.point = (usableAnalysis.overview.keyPoints[0] as { point: string }).point;
  t0.term = (usableAnalysis.overview.keyTerms[0] as { term: string }).term;
  t0.gloss = (usableAnalysis.overview.keyTerms[0] as { gloss: string }).gloss;
  const client = queuedClient({
    source_analysis_v2: [mismatched()],
    source_analysis_v2_repair: [honest],
    formula_explorer: [feGen],
    quiz_cards: [quizGen],
  });
  const storageDir = mkdtempSync(join(tmpdir(), 's6r01-repair-'));
  const jobId = 's6r01-repair-0000001';
  const { done } = startJob(DRAG, { client, storageDir, purpose: 'test-live', flow: 'lesson', newJobId: () => jobId });
  const summary: JobSummary = await done;

  assert.equal(summary.status, 'succeeded');
  assert.equal(summary.analysisRepairs?.length, 1);
  const rec = summary.analysisRepairs?.[0];
  assert.ok(rec?.targeted.includes('OV-02') && rec.targeted.includes('OV-06'), rec?.targeted.join());
  assert.equal(rec?.passed, true);
  const lesson = JSON.parse(readFileSync(join(storageDir, 'runs', jobId, 'lesson.json'), 'utf8')) as LessonSpec;
  assert.equal(lesson.analysisRef, `${jobId}/analysis-v2.r2.json`);
  const published = JSON.stringify(lesson.overview);
  assert.ok(!published.includes('Bananas'), 'the unrepaired point is never published');
  assert.ok(!published.includes('teleportation'), 'the invented term is never published');
  // The overview event comes only after the repair succeeded.
  const events = readEvents(storageDir, jobId);
  const overviewAt = events.findIndex(e => e.stage === 'overview');
  const repairOkAt = events.findIndex(e => e.stage === 'repair' && e.target === 'analysis' && e.status === 'succeeded');
  assert.ok(repairOkAt >= 0 && overviewAt > repairOkAt);
});

test('S6R-01: an overview that stays wrong after every repair fails the lesson (ANALYSIS_INVALID) and is never published', async () => {
  const client = queuedClient({
    source_analysis_v2: [mismatched()],
    source_analysis_v2_repair: [mismatched()],
    formula_explorer: [feGen],
    quiz_cards: [quizGen],
  });
  const storageDir = mkdtempSync(join(tmpdir(), 's6r01-fail-'));
  const jobId = 's6r01-fail-000000001';
  const { done } = startJob(DRAG, { client, storageDir, purpose: 'test-live', flow: 'lesson', newJobId: () => jobId });
  const summary: JobSummary = await done;

  assert.equal(summary.status, 'failed');
  assert.equal(summary.error?.code, 'ANALYSIS_INVALID');
  assert.equal(summary.lesson?.overviewReady, false);
  assert.equal(summary.analysisRepairs?.length, 2, 'the bounded analysis repair loop ran (maxRepairAttempts 2)');
  assert.ok(!client.calls.includes('formula_explorer') && !client.calls.includes('quiz_cards'), 'no component call after an unpublishable overview');
  assert.equal(existsSync(join(storageDir, 'runs', jobId, 'lesson.json')), false, 'no lesson (and so no overview) was written');
  assert.equal(readEvents(storageDir, jobId).some(e => e.stage === 'overview'), false);
});
