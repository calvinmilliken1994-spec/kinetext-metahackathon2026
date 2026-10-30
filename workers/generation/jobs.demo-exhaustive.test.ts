// S5B-05 (Stage 5b review, Wave C) — demo-fault assembly must be EXHAUSTIVE across
// the whole activity catalogue: both fault kinds, end-to-end, on all seven numeric
// engines and timeline, against FAKE MetaClients and recorded/fixture generations.
// Reviewer evidence: demo faults on compound-interest-v1 and half-life-v1 crashed
// with failed/INTERNAL (ENGINE_REQUIRED from a partial assembleForActivity switch)
// AFTER two billed calls; the same switch missed hardy-weinberg-v1.
// No network, no credits, no .env access.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startJob } from './jobs.ts';
import type { JobSummary } from './jobs.ts';
import type { CompleteRequest, MetaClient } from '../../packages/meta/client.ts';
import { genSchemaFor } from '../../packages/contracts/schemas.ts';
import { ACTIVITY_IDS, ENGINES, isSequenceEngineId } from '../../packages/contracts/index.ts';
import type { ActivityId, DemoFault, MetaReceipt, StageEvent } from '../../packages/contracts/index.ts';

function readJsonAt(url: URL): Record<string, any> {
  return JSON.parse(readFileSync(url, 'utf8')) as Record<string, any>;
}

/** Project a full ActivitySpec onto its gen schema shape (the reviewer probe's method). */
function projectToGen(value: any, schema: any): any {
  if (schema.type === 'object' && schema.properties) {
    return Object.fromEntries(
      Object.entries(schema.properties)
        .filter(([k]) => k in value)
        .map(([k, v]) => [k, projectToGen(value[k], v)]),
    );
  }
  if (schema.type === 'array') {
    return (value as any[]).map(v => projectToGen(v, schema.items));
  }
  return value;
}

interface MatrixEntry {
  activity: ActivityId;
  sourceId: string;
  analysis: Record<string, unknown>;
  gen: Record<string, unknown>;
}

function evidenceJob(relDir: string): { analysis: Record<string, unknown>; spec: Record<string, unknown> } {
  const dir = new URL(`../../docs/evidence/${relDir}/`, import.meta.url);
  return {
    analysis: readJsonAt(new URL('analysis.json', dir)).analysis,
    spec: openOnFirstCase(readJsonAt(new URL('spec.r1.json', dir))),
  };
}

/**
 * Recorded runs predate prompt v10 and semantic.opening-case (Stage 7): some open their sliders on
 * a different scenario than their first prediction. This matrix needs a CLEAN baseline to prove the
 * injected fault is what fails, so it applies only the v10 requirement — each slider default set to
 * predictions[0]'s value (inside the range, which semantic.predictions-in-range already guarantees).
 * Nothing else in the recorded output changes; the evidence files on disk are untouched.
 */
function openOnFirstCase(spec: Record<string, any>): Record<string, any> {
  const first = Array.isArray(spec.predictions) ? spec.predictions[0] : undefined;
  if (first === undefined || typeof spec.simulation !== 'object' || spec.simulation === null) return spec;
  const simulation: Record<string, any> = { ...spec.simulation };
  for (const [key, range] of Object.entries(simulation)) {
    if (typeof range === 'object' && range !== null && typeof range.default === 'number' && typeof first[key] === 'number') {
      simulation[key] = { ...range, default: first[key] };
    }
  }
  return { ...spec, simulation };
}

function genOf(activity: ActivityId, spec: Record<string, unknown>): Record<string, unknown> {
  return isSequenceEngineId(activity)
    ? spec
    : projectToGen(spec, genSchemaFor(activity));
}

/**
 * One entry per catalogue activity, each from a RECORDED published run (evidence jobs /
 * recorded fixtures) so the generated spec is real, validated model output — never
 * hand-invented numbers. hardy-weinberg uses tests/fixtures/hardy-weinberg.recorded.json
 * (copied verbatim from live test-run job-20261028092706-cf14542b).
 */
function buildMatrix(): MatrixEntry[] {
  const entries: MatrixEntry[] = [];
  const forces = {
    analysis: readJsonAt(new URL('../../tests/fixtures/nasa-analysis.recorded.json', import.meta.url)),
    gen: readJsonAt(new URL('../../tests/fixtures/nasa-gen.recorded.json', import.meta.url)),
  };
  entries.push({ activity: 'forces-1d-v1', sourceId: 'nasa-grc-equations-of-motion', ...forces });

  const hw = readJsonAt(new URL('../../tests/fixtures/hardy-weinberg.recorded.json', import.meta.url));
  entries.push({
    activity: 'hardy-weinberg-v1',
    sourceId: 'nij-hardy-weinberg-principle',
    analysis: hw.analysis,
    gen: genOf('hardy-weinberg-v1', hw.spec),
  });

  const timelineGen = readJsonAt(new URL('../../tests/fixtures/timeline.declaration.gen.json', import.meta.url));
  entries.push({
    activity: 'timeline-v1',
    sourceId: 'nara-declaration-of-independence',
    analysis: readJsonAt(new URL('../../tests/fixtures/timeline.declaration.analysis.json', import.meta.url)),
    gen: timelineGen,
  });

  for (const [activity, relDir] of [
    ['projectile-v1', 'stage-5/live/job-20261027181108-895b5df2'],
    ['lift-equation-v1', 'stage-5b/evaluation-rerun-hard/jobs/job-20261028181829-4f827600'],
    ['speed-of-sound-v1', 'stage-5/live/job-20261027181147-6a7bcbf3'],
    ['compound-interest-v1', 'stage-5b/evaluation/jobs/job-20261028170220-c936ea20'],
    ['half-life-v1', 'stage-5b/evaluation/jobs/job-20261028170518-13335c0a'],
  ] as const) {
    const job = evidenceJob(relDir);
    entries.push({
      activity,
      sourceId: (job.spec.sources as { id: string }[])[0].id,
      analysis: job.analysis,
      gen: genOf(activity, job.spec),
    });
  }
  return entries;
}

const MATRIX = buildMatrix();

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

/** Fake client: analysis fixture, then the recorded CLEAN gen for spec and repair calls. */
function stagedClient(entry: MatrixEntry): { client: MetaClient; calls: string[] } {
  const calls: string[] = [];
  const client: MetaClient = {
    complete: <T>(req: CompleteRequest): Promise<{ data: T; receipt: MetaReceipt }> => {
      calls.push(req.schemaName);
      if (req.schemaName === 'source_analysis') {
        return Promise.resolve({ data: structuredClone(entry.analysis) as T, receipt: fakeReceipt('fake-analysis-1') });
      }
      // activity_spec AND activity_spec_repair: the repair candidate is the clean
      // recorded generation, which fixes exactly the injected system-made fault.
      return Promise.resolve({ data: structuredClone(entry.gen) as T, receipt: fakeReceipt(`fake-${calls.length}`) });
    },
  };
  return { client, calls };
}

function tempStorage(): string {
  return mkdtempSync(join(tmpdir(), 's5b05-demo-'));
}

function readEvents(storageDir: string, jobId: string): StageEvent[] {
  return readFileSync(join(storageDir, 'runs', jobId, 'events.jsonl'), 'utf8')
    .split('\n')
    .filter(line => line.trim() !== '')
    .map(line => JSON.parse(line) as StageEvent);
}

function intendedCheckOf(kind: DemoFault, activity: ActivityId): string {
  if (kind === 'wrong-answer') {
    return isSequenceEngineId(activity) ? 'timeline.case-order' : 'behavior.tests';
  }
  return 'grounding.quotes';
}

function expectedPathOf(kind: DemoFault, activity: ActivityId): string {
  if (kind === 'wrong-answer') {
    return isSequenceEngineId(activity)
      ? 'behavioralTests[0]'
      : `behavioralTests[0].${ENGINES[activity].output.key}`;
  }
  return isSequenceEngineId(activity)
    ? 'simulation.events[0].evidence[0].quote'
    : 'explanations[0].evidence[0].quote';
}

async function runFault(entry: MatrixEntry, kind: DemoFault): Promise<{ summary: JobSummary; jobId: string; storageDir: string; calls: string[] }> {
  const storageDir = tempStorage();
  const { client, calls } = stagedClient(entry);
  const { jobId, done } = startJob(entry.sourceId, {
    client,
    storageDir,
    purpose: 'demo',
    demoFault: kind,
  });
  const summary = await done;
  return { summary, jobId, storageDir, calls };
}

/* ------------------------------------------------------------------ */

test('S5B-05: the demo-fault matrix covers the ENTIRE activity catalogue', () => {
  // Runtime companion to the compile-time never-check in assembleForActivity:
  // a new ActivityId without a matrix entry fails here immediately.
  assert.deepEqual(
    MATRIX.map(m => m.activity).sort(),
    [...ACTIVITY_IDS].sort(),
    'every catalogue activity has a demo-fault matrix entry',
  );
});

for (const kind of ['wrong-answer', 'fabricated-quote'] as const) {
  test(`S5B-05: demo fault '${kind}' is caught, labelled system-made, repaired and costed on every activity`, async () => {
    for (const entry of MATRIX) {
      const label = `${kind}/${entry.activity}`;
      const genBefore = structuredClone(entry.gen);
      const { summary, jobId, storageDir, calls } = await runFault(entry, kind);

      // The reviewer's symptom: failed/INTERNAL (ENGINE_REQUIRED) after two billed calls.
      assert.equal(summary.status, 'succeeded', `${label}: job succeeds (was failed/INTERNAL on the new engines)`);
      assert.equal(summary.error, undefined, label);
      assert.equal(summary.engine, entry.activity, label);
      assert.deepEqual(calls, ['source_analysis', 'activity_spec', 'activity_spec_repair'], `${label}: exactly three fake calls`);

      // Fault record: effective (S5-04), revision 1, correct path.
      const fault = summary.demoFault;
      assert.ok(fault !== undefined, `${label}: demoFault recorded`);
      assert.equal(fault.kind, kind, label);
      assert.equal(fault.revision, 1, label);
      assert.equal(fault.effective, true, `${label}: the intended check ${intendedCheckOf(kind, entry.activity)} failed on r1`);
      assert.equal(fault.path, expectedPathOf(kind, entry.activity), label);

      // Repair record: targeted the intended check, fixed it, labelled system-made (decision 17).
      assert.equal(summary.publishedRevision, 2, label);
      assert.equal(summary.revisions, 2, label);
      assert.equal(summary.repairs.length, 1, label);
      const repair = summary.repairs[0];
      assert.ok(repair !== undefined, label);
      assert.ok(repair.targeted.includes(intendedCheckOf(kind, entry.activity)), `${label}: targeted ${repair.targeted}`);
      assert.ok(repair.fixed.includes(intendedCheckOf(kind, entry.activity)), `${label}: fixed ${repair.fixed}`);
      assert.equal(repair.publishable, true, label);
      assert.equal(repair.afterInjectedFault, true, `${label}: never counts in quality metrics`);

      // Cost preserved: analysis + spec + repair receipts, nothing unknown.
      assert.equal(summary.totalCostUSD, 0.03, `${label}: all three billed receipts kept`);
      assert.equal(summary.reservedUnknownUSD, 0, label);

      // The inject event carries the system-made label.
      const events = readEvents(storageDir, jobId);
      const inject = events.find(e => e.stage === 'inject');
      assert.ok(inject !== undefined, `${label}: inject event exists`);
      assert.equal(inject.status, 'succeeded', label);
      assert.equal(inject.revision, 1, label);
      assert.ok(
        String(inject.detail).startsWith('demo fault injected by the system:'),
        `${label}: system-made label, got "${inject.detail}"`,
      );

      // spec.r1.json reflects the fault; the clean fixture object was never mutated.
      const spec1 = JSON.parse(readFileSync(join(storageDir, 'runs', jobId, 'spec.r1.json'), 'utf8')) as Record<string, any>;
      if (kind === 'fabricated-quote') {
        assert.equal(
          isSequenceEngineId(entry.activity)
            ? spec1.simulation.events[0].evidence[0].quote
            : spec1.explanations[0].evidence[0].quote,
          fault.injected,
          `${label}: the faulty revision is persisted`,
        );
      } else if (!isSequenceEngineId(entry.activity)) {
        const outputKey = ENGINES[entry.activity].output.key;
        assert.equal(spec1.behavioralTests[0][outputKey], fault.injected, label);
      }

      // The shared fixture objects are never mutated by demo faults (the fault hits a clone).
      assert.deepEqual(entry.gen, genBefore, `${label}: the recorded fixture is untouched`);
    }
  });
}
