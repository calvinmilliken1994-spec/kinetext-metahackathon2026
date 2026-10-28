// Stage 5 TASK-015 worker tests — bounded Muse repair loop, labelled demo-fault
// injection and teacher ('user') sources. All against FAKE MetaClients and real
// fixtures/validators. No network, no credits, no .env access.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readJob, startJob } from './jobs.ts';
import type { JobSummary } from './jobs.ts';
import { MetaError } from '../../packages/meta/client.ts';
import type { CompleteRequest, MetaClient } from '../../packages/meta/client.ts';
import { liftSourceDoc, makeLiftSpec } from '../../packages/validation/fixtures/engine-specs.ts';
import { saveUserSource, userSourceId } from '../../packages/sources/index.ts';
import type {
  ActivitySpec,
  GeneratedSpec,
  MetaReceipt,
  SourceAnalysis,
  StageEvent,
} from '../../packages/contracts/index.ts';

const analysisFixture = JSON.parse(
  readFileSync(new URL('../../tests/fixtures/nasa-analysis.recorded.json', import.meta.url), 'utf8'),
) as SourceAnalysis;
const genFixture = JSON.parse(
  readFileSync(new URL('../../tests/fixtures/nasa-gen.recorded.json', import.meta.url), 'utf8'),
) as GeneratedSpec;

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

interface StagedOptions {
  analysis?: unknown;
  rev1?: unknown;
  /** One payload per 'activity_spec_repair' call (shifted); falls back to genFixture. */
  repairs?: unknown[];
  /** Repair calls never resolve; they reject with DEADLINE_EXCEEDED when the job signal aborts. */
  repairHangsOnAbort?: boolean;
}

/** Fake client dispatching on schemaName: source_analysis / activity_spec / activity_spec_repair. */
function stagedClient(opts: StagedOptions = {}): {
  client: MetaClient;
  calls: { schema: string; maxOutputTokens: number; hasSignal: boolean }[];
  repairCount: () => number;
} {
  const calls: { schema: string; maxOutputTokens: number; hasSignal: boolean }[] = [];
  let repairCalls = 0;
  const client: MetaClient = {
    complete: <T>(req: CompleteRequest): Promise<{ data: T; receipt: MetaReceipt }> => {
      calls.push({
        schema: req.schemaName,
        maxOutputTokens: req.maxOutputTokens,
        hasSignal: req.signal !== undefined,
      });
      if (req.schemaName === 'source_analysis') {
        return Promise.resolve({
          data: (opts.analysis ?? analysisFixture) as T,
          receipt: fakeReceipt('fake-analysis-1'),
        });
      }
      if (req.schemaName === 'activity_spec') {
        return Promise.resolve({ data: (opts.rev1 ?? genFixture) as T, receipt: fakeReceipt('fake-gen-1') });
      }
      // activity_spec_repair
      if (opts.repairHangsOnAbort === true) {
        return new Promise<{ data: T; receipt: MetaReceipt }>((_resolve, reject) => {
          const signal = req.signal;
          if (signal === undefined) {
            reject(new Error('NO_SIGNAL_PASSED'));
            return;
          }
          const onAbort = (): void => {
            reject(new MetaError('DEADLINE_EXCEEDED', undefined, { chargedUSD: 0, costBasis: 'usage' }));
          };
          if (signal.aborted) {
            onAbort();
            return;
          }
          signal.addEventListener('abort', onAbort, { once: true });
        });
      }
      repairCalls += 1;
      const data: unknown = opts.repairs !== undefined && opts.repairs.length > 0 ? opts.repairs.shift() : genFixture;
      return Promise.resolve({ data: data as T, receipt: fakeReceipt(`fake-repair-${repairCalls}`) });
    },
  };
  return { client, calls, repairCount: (): number => repairCalls };
}

function tempStorage(): string {
  return mkdtempSync(join(tmpdir(), 'task015-jobs-'));
}

function readEvents(storageDir: string, jobId: string): StageEvent[] {
  return readFileSync(join(storageDir, 'runs', jobId, 'events.jsonl'), 'utf8')
    .split('\n')
    .filter(line => line.trim() !== '')
    .map(line => JSON.parse(line) as StageEvent);
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

/** genFixture with a wrong first behavioral-test answer → 'behavior.tests' fails. */
function wrongFirstAnswer(): GeneratedSpec {
  const bad = structuredClone(genFixture) as GeneratedSpec & { behavioralTests: Record<string, unknown>[] };
  bad.behavioralTests[0]['expectedAccelerationMps2'] = 99;
  return bad as unknown as GeneratedSpec;
}

/** Wrong answer AND a corrupted quote → two distinct failing check ids. */
function wrongAnswerAndQuote(): GeneratedSpec {
  const bad = structuredClone(wrongFirstAnswer()) as GeneratedSpec & {
    explanations: { evidence: { quote: string }[] }[];
  };
  bad.explanations[0].evidence[0].quote = 'this sentence appears in no licensed source whatsoever';
  return bad as unknown as GeneratedSpec;
}

/** Wrong answer kept, but the first test's tolerance widened 0.001 → 0.005 (a weakening "repair"). */
function widenedToleranceStillWrong(): GeneratedSpec {
  const bad = structuredClone(wrongFirstAnswer()) as GeneratedSpec & {
    behavioralTests: Record<string, unknown>[];
  };
  bad.behavioralTests[0]['tolerance'] = 0.005;
  return bad as unknown as GeneratedSpec;
}

/* ------------------------------------------------------------------ */
/* Repair loop                                                          */
/* ------------------------------------------------------------------ */

test('repair loop: failing revision 1 is repaired by revision 2 and published (Stage 5)', async () => {
  const storageDir = tempStorage();
  const { client, calls, repairCount } = stagedClient({ rev1: wrongFirstAnswer(), repairs: [genFixture] });
  const { jobId, done } = startJob('nasa-grc-equations-of-motion', {
    client,
    storageDir,
    purpose: 'test-live',
  });
  const summary: JobSummary = await done;

  assert.equal(summary.status, 'succeeded');
  assert.equal(summary.publishable, true);
  assert.equal(summary.publishedRevision, 2, 'the repaired revision is published');
  assert.equal(summary.bestRevision, undefined);
  assert.equal(summary.engine, 'forces-1d-v1');
  assert.equal(summary.revisions, 2);
  assert.equal(summary.sourceKind, 'library');
  assert.equal(summary.demoFault, undefined);
  assert.equal(summary.totalCostUSD, 0.03, 'analysis + spec + one repair receipt');
  assert.equal(summary.reservedUnknownUSD, 0);
  assert.equal(repairCount(), 1, 'the loop stops at the first publishable revision');

  assert.equal(summary.repairs.length, 1);
  const record = summary.repairs[0];
  assert.ok(record !== undefined);
  assert.deepEqual(record, {
    revision: 2,
    repairOf: 1,
    targeted: ['behavior.tests'],
    fixed: ['behavior.tests'],
    remaining: [],
    publishable: true,
    afterInjectedFault: false,
  });

  // The published revision's report drives the check counts (15 engine checks + repair.no-weakening).
  const runDir = join(storageDir, 'runs', jobId);
  const report2 = readJson(join(runDir, 'report.r2.json')) as { checks: { passed: boolean }[]; publishable: boolean };
  assert.equal(report2.publishable, true);
  assert.equal(summary.checksPassed, report2.checks.length);
  assert.equal(summary.checksTotal, report2.checks.length);
  assert.ok(report2.checks.length >= 16, 'the repair report includes repair.no-weakening');

  // Every revision is persisted atomically, with repair provenance on r2.
  for (const f of ['spec.r1.json', 'report.r1.json', 'spec.r2.json', 'report.r2.json']) {
    assert.ok(existsSync(join(runDir, f)), `${f} should exist`);
  }
  for (const f of readdirSync(runDir)) {
    assert.ok(!f.includes('.tmp'), `no temp artifact may remain: ${f}`);
  }
  const spec2 = readJson(join(runDir, 'spec.r2.json')) as { provenance: { revision: number; repairOf: number | null } };
  assert.equal(spec2.provenance.revision, 2);
  assert.equal(spec2.provenance.repairOf, 1);

  // Events: revision-carrying validate events plus the repair pair.
  const events = readEvents(storageDir, jobId);
  assert.deepEqual(
    events.map(e => `${e.stage}:${e.status}`),
    [
      'ingest:started',
      'ingest:succeeded',
      'analyze:started',
      'analyze:succeeded',
      'specify:started',
      'specify:succeeded',
      'validate:started',
      'validate:failed',
      'repair:started',
      'repair:succeeded',
      'validate:started',
      'validate:succeeded',
      'done:succeeded',
    ],
  );
  const validateFailed = events.find(e => e.stage === 'validate' && e.status === 'failed');
  assert.equal(validateFailed?.revision, 1);
  assert.match(validateFailed?.detail ?? '', /^VALIDATION_FAILED; failed checks: behavior\.tests$/);
  const repairStarted = events.find(e => e.stage === 'repair' && e.status === 'started');
  assert.equal(repairStarted?.revision, 2, 'the repair event names the revision being produced');
  assert.equal(repairStarted?.detail, 'targeted checks: behavior.tests');
  const repairOk = events.find(e => e.stage === 'repair' && e.status === 'succeeded');
  assert.equal(repairOk?.revision, 2);
  assert.equal(repairOk?.responseId, 'fake-repair-1');
  assert.equal(repairOk?.estCostUSD, 0.01);
  const validateOk2 = events.filter(e => e.stage === 'validate' && e.status === 'succeeded').at(-1);
  assert.equal(validateOk2?.revision, 2);
  const doneOk = events.at(-1);
  assert.equal(doneOk?.stage, 'done');
  assert.equal(doneOk?.detail, 'publishable after repair (revision 2)');

  // R-11: the repair call shares the job deadline signal and uses the spec output cap.
  const repairCall = calls.find(c => c.schema === 'activity_spec_repair');
  assert.ok(repairCall !== undefined);
  assert.equal(repairCall.hasSignal, true);
  assert.equal(repairCall.maxOutputTokens, 8000);

  // readJob exposes every revision plus compatibility fields pointing at the published one.
  const full = readJob(storageDir, jobId);
  assert.ok(full !== null);
  assert.equal(full.revisions.length, 2);
  assert.deepEqual(
    full.revisions.map(r => r.revision),
    [1, 2],
  );
  assert.deepEqual(full.spec, readJson(join(runDir, 'spec.r2.json')), 'spec = published revision');
  assert.deepEqual(full.report, readJson(join(runDir, 'report.r2.json')), 'report = published revision');
});

test('repair loop: a client that keeps failing exhausts maxRepairAttempts, then VALIDATION_FAILED with bestRevision', async () => {
  const storageDir = tempStorage();
  // r2/r3 fail TWO checks (behavior.tests + grounding.quotes) while r1 fails one → best is r1.
  const { client, repairCount } = stagedClient({
    rev1: wrongFirstAnswer(),
    repairs: [wrongAnswerAndQuote(), wrongAnswerAndQuote()],
  });
  const { jobId, done } = startJob('nasa-grc-equations-of-motion', { client, storageDir, purpose: 'test-live' });
  const summary = await done;

  assert.equal(summary.status, 'failed');
  assert.deepEqual(summary.error, { code: 'VALIDATION_FAILED', message: 'generated spec failed validation' });
  assert.equal(summary.publishable, undefined);
  assert.equal(summary.publishedRevision, undefined);
  assert.equal(repairCount(), 2, 'exactly maxRepairAttempts (default 2) repair calls');
  assert.equal(summary.revisions, 3);
  assert.equal(summary.bestRevision, 1, 'the revision with the fewest failing checks wins');
  assert.equal(summary.repairs.length, 2);
  assert.equal(summary.repairs[0]?.publishable, false);
  assert.equal(summary.repairs[1]?.publishable, false);
  assert.deepEqual(summary.repairs[1]?.targeted, ['grounding.quotes', 'behavior.tests']);
  assert.equal(summary.totalCostUSD, 0.04, 'analysis + spec + two repair receipts');

  const runDir = join(storageDir, 'runs', jobId);
  for (const f of ['spec.r1.json', 'spec.r2.json', 'spec.r3.json', 'report.r3.json']) {
    assert.ok(existsSync(join(runDir, f)), `${f} should exist`);
  }
  // checksPassed/checksTotal describe the BEST revision (r1: only behavior.tests fails).
  const report1 = readJson(join(runDir, 'report.r1.json')) as { checks: { passed: boolean }[] };
  assert.equal(summary.checksTotal, report1.checks.length);
  assert.equal(summary.checksPassed, report1.checks.filter(c => c.passed).length);

  const events = readEvents(storageDir, jobId);
  assert.ok(!events.some(e => e.stage === 'done'), 'a failed job emits no done event');
  const last = events.at(-1);
  assert.equal(last?.stage, 'validate');
  assert.equal(last?.status, 'failed');
  assert.equal(last?.revision, 3);
  assert.equal(readJob(storageDir, jobId)?.summary.status, 'failed');
  // Compatibility fields point at the best revision.
  const full = readJob(storageDir, jobId);
  assert.ok(full !== null);
  assert.deepEqual(full.spec, readJson(join(runDir, 'spec.r1.json')), 'spec = best revision');
});

test('repair loop: a weakening repair fails repair.no-weakening and is not publishable', async () => {
  const storageDir = tempStorage();
  // r2 "repairs" by widening the failing test's tolerance (still wrong) → no-weakening fails;
  // r3 is the honest fix.
  const { client } = stagedClient({
    rev1: wrongFirstAnswer(),
    repairs: [widenedToleranceStillWrong(), genFixture],
  });
  const { jobId, done } = startJob('nasa-grc-equations-of-motion', { client, storageDir, purpose: 'test-live' });
  const summary = await done;

  assert.equal(summary.status, 'succeeded');
  assert.equal(summary.publishedRevision, 3);
  assert.equal(summary.revisions, 3);
  assert.equal(summary.repairs.length, 2);

  const weakening = summary.repairs[0];
  assert.ok(weakening !== undefined);
  assert.equal(weakening.revision, 2);
  assert.equal(weakening.publishable, false);
  assert.deepEqual(weakening.targeted, ['behavior.tests']);
  assert.deepEqual(weakening.fixed, [], 'widening the tolerance fixed nothing');
  assert.deepEqual(weakening.remaining, ['behavior.tests', 'repair.no-weakening']);

  const honest = summary.repairs[1];
  assert.ok(honest !== undefined);
  assert.equal(honest.revision, 3);
  assert.equal(honest.publishable, true);
  assert.deepEqual(honest.targeted, ['behavior.tests', 'repair.no-weakening']);
  assert.deepEqual(honest.fixed, ['behavior.tests', 'repair.no-weakening']);
  assert.deepEqual(honest.remaining, []);

  const report2 = readJson(join(storageDir, 'runs', jobId, 'report.r2.json')) as {
    checks: { id: string; passed: boolean; message: string }[];
  };
  const noWeakening = report2.checks.find(c => c.id === 'repair.no-weakening');
  assert.ok(noWeakening !== undefined, 'the r2 report carries the no-weakening check');
  assert.equal(noWeakening.passed, false);
  assert.match(noWeakening.message, /tolerance increased/);
});

test('repair loop: GeneratedOutputError on repair accounts the receipt, records the failed repair and stops', async () => {
  const storageDir = tempStorage();
  // An empty object fails the forces gen schema → repairSpec throws GeneratedOutputError('repair').
  const { client, repairCount } = stagedClient({ rev1: wrongFirstAnswer(), repairs: [{}] });
  const { jobId, done } = startJob('nasa-grc-equations-of-motion', { client, storageDir, purpose: 'test-live' });
  const summary = await done;

  assert.equal(summary.status, 'failed');
  assert.deepEqual(summary.error, { code: 'VALIDATION_FAILED', message: 'generated spec failed validation' });
  assert.equal(summary.totalCostUSD, 0.03, 'the completed-but-invalid repair call is billed exactly once');
  assert.equal(summary.reservedUnknownUSD, 0);
  assert.equal(repairCount(), 1, 'no second repair after an invalid repair output');
  assert.equal(summary.revisions, 1, 'the invalid repair produced no revision');
  assert.deepEqual(summary.repairs, [], 'a failed repair attempt records no RepairRecord');
  assert.equal(summary.bestRevision, 1);
  assert.ok(!existsSync(join(storageDir, 'runs', jobId, 'spec.r2.json')));

  const events = readEvents(storageDir, jobId);
  const repairFailed = events.find(e => e.stage === 'repair' && e.status === 'failed');
  assert.ok(repairFailed !== undefined, 'a failed repair event exists');
  assert.equal(repairFailed?.revision, 2);
  assert.equal(repairFailed?.detail, 'OUTPUT_INVALID');
  assert.equal(repairFailed?.responseId, 'fake-repair-1');
  assert.equal(repairFailed?.estCostUSD, 0.01, 'the failed repair event carries its receipt charge');
  assert.ok(!events.some(e => e.stage === 'done'));
  const last = events.at(-1);
  assert.equal(last?.stage, 'repair');
  assert.equal(last?.status, 'failed');
  assert.equal(last?.revision, 2, 'the failed repair is the terminal event');
});

test('repair loop: the job deadline aborts a hanging repair with DEADLINE_EXCEEDED (R-11)', async () => {
  const storageDir = tempStorage();
  const { client } = stagedClient({ rev1: wrongFirstAnswer(), repairHangsOnAbort: true });
  const { jobId, done } = startJob('nasa-grc-equations-of-motion', {
    client,
    storageDir,
    purpose: 'test-live',
    limits: { maxJobWallTimeMs: 40 },
  });
  const summary = await done;

  assert.equal(summary.status, 'failed');
  assert.deepEqual(summary.error, { code: 'DEADLINE_EXCEEDED', message: 'job deadline exceeded' });
  const events = readEvents(storageDir, jobId);
  assert.ok(events.some(e => e.stage === 'repair' && e.status === 'started'), 'the repair started');
  const repairFailed = events.find(e => e.stage === 'repair' && e.status === 'failed');
  assert.ok(repairFailed !== undefined, 'the repair failed on the shared deadline');
  assert.equal(repairFailed?.detail, 'DEADLINE_EXCEEDED');
  assert.ok(!existsSync(join(storageDir, 'runs', jobId, 'spec.r2.json')));
});

test('repair loop: JobLimits.maxRepairAttempts bounds the loop (1 attempt; 0 disables repairs)', async () => {
  const one = tempStorage();
  const c1 = stagedClient({ rev1: wrongFirstAnswer(), repairs: [wrongAnswerAndQuote(), genFixture] });
  const s1 = await startJob('nasa-grc-equations-of-motion', {
    client: c1.client,
    storageDir: one,
    purpose: 'test-live',
    limits: { maxRepairAttempts: 1 },
  }).done;
  assert.equal(s1.status, 'failed');
  assert.equal(s1.error?.code, 'VALIDATION_FAILED');
  assert.equal(c1.repairCount(), 1, 'only one repair with maxRepairAttempts=1');
  assert.equal(s1.revisions, 2);
  assert.equal(s1.repairs.length, 1);

  const zero = tempStorage();
  const c0 = stagedClient({ rev1: wrongFirstAnswer(), repairs: [genFixture] });
  const s0 = await startJob('nasa-grc-equations-of-motion', {
    client: c0.client,
    storageDir: zero,
    purpose: 'test-live',
    limits: { maxRepairAttempts: 0 },
  }).done;
  assert.equal(s0.status, 'failed');
  assert.equal(s0.error?.code, 'VALIDATION_FAILED');
  assert.equal(c0.repairCount(), 0, 'maxRepairAttempts=0 performs no repair call at all');
  assert.equal(s0.revisions, 1);
  assert.deepEqual(s0.repairs, []);
  assert.equal(s0.bestRevision, 1);
});

/* ------------------------------------------------------------------ */
/* Labelled demo faults                                                 */
/* ------------------------------------------------------------------ */

test('demo fault wrong-answer: injected into revision 1 before validation, labelled, then repaired', async () => {
  const storageDir = tempStorage();
  const { client } = stagedClient({ repairs: [genFixture] });
  const { jobId, done } = startJob('nasa-grc-equations-of-motion', {
    client,
    storageDir,
    purpose: 'demo',
    demoFault: 'wrong-answer',
    newJobId: () => 'job-20260101000000-abcd1234',
  });
  const summary = await done;

  assert.equal(summary.status, 'succeeded');
  assert.equal(summary.publishedRevision, 2);
  assert.deepEqual(summary.demoFault, {
    kind: 'wrong-answer',
    path: 'behavioralTests[0].expectedAccelerationMps2',
    original: 5,
    injected: 7.5, // S5-04: original + max(1, 0.5*|original|, 10*maxTolerance(engine, computed))
    revision: 1,
    effective: true,
  });
  assert.equal(summary.repairs.length, 1);
  assert.equal(summary.repairs[0]?.afterInjectedFault, true, 'decision 17: labelled as after an injected fault');

  const runDir = join(storageDir, 'runs', jobId);
  const spec1 = readJson(join(runDir, 'spec.r1.json')) as {
    behavioralTests: { expectedAccelerationMps2: number }[];
    provenance: { revision: number };
  };
  assert.equal(spec1.behavioralTests[0]?.expectedAccelerationMps2, 7.5, 'spec.r1.json reflects the fault');
  assert.equal(spec1.provenance.revision, 1, 'the injected revision stays revision 1');
  const spec2 = readJson(join(runDir, 'spec.r2.json')) as { behavioralTests: { expectedAccelerationMps2: number }[] };
  assert.equal(spec2.behavioralTests[0]?.expectedAccelerationMps2, 5, 'the repair restores the honest value');

  const events = readEvents(storageDir, jobId);
  const inject = events.find(e => e.stage === 'inject');
  assert.ok(inject !== undefined, 'an inject event exists');
  assert.equal(inject.status, 'succeeded');
  assert.equal(inject.revision, 1);
  assert.equal(
    inject.detail,
    'demo fault injected by the system: wrong-answer at behavioralTests[0].expectedAccelerationMps2',
  );
  const injectIdx = events.indexOf(inject);
  const specifyIdx = events.findIndex(e => e.stage === 'specify' && e.status === 'succeeded');
  const validateIdx = events.findIndex(e => e.stage === 'validate' && e.status === 'started');
  assert.ok(specifyIdx < injectIdx && injectIdx < validateIdx, 'injection happens after specify, before validation');

  // The shared recorded fixture is never mutated by demo faults.
  const firstTest = (genFixture as unknown as { behavioralTests: Record<string, unknown>[] }).behavioralTests[0];
  assert.equal(firstTest?.['expectedAccelerationMps2'], 5, 'the on-disk fixture object stays untouched');
});

test('demo fault fabricated-quote: nonce from the job id, verified absent from the source, caught and repaired', async () => {
  const storageDir = tempStorage();
  const { client } = stagedClient({ repairs: [genFixture] });
  const { jobId, done } = startJob('nasa-grc-equations-of-motion', {
    client,
    storageDir,
    purpose: 'demo',
    demoFault: 'fabricated-quote',
  });
  const summary = await done;

  assert.equal(summary.status, 'succeeded');
  assert.equal(summary.publishedRevision, 2);
  const fault = summary.demoFault;
  assert.ok(fault !== undefined);
  assert.equal(fault.kind, 'fabricated-quote');
  assert.equal(fault.path, 'explanations[0].evidence[0].quote');
  assert.equal(fault.revision, 1);
  assert.equal(fault.original, 'F = m * a');
  assert.equal(fault.effective, true, 'S5-04: the intended grounding.quotes check failed on revision 1');
  const injected = String(fault.injected);
  const nonceMatch = /^Muse confirmed this result in a controlled laboratory trial \(ref ([0-9a-f]{8})\)\.$/.exec(
    injected,
  );
  assert.ok(nonceMatch !== null, `injected quote has the fixed sentence with an 8-hex nonce: ${injected}`);
  assert.equal(nonceMatch[1], jobId.slice(-8), 'the nonce comes from the job id');

  // Decision 18: the fabricated sentence must not occur in the real source text.
  const sourceText = readFileSync(
    new URL('../../data/sources/nasa-grc-equations-of-motion.txt', import.meta.url),
    'utf8',
  );
  assert.ok(!sourceText.includes(injected));

  const spec1 = readJson(join(storageDir, 'runs', jobId, 'spec.r1.json')) as {
    explanations: { evidence: { quote: string }[] }[];
  };
  assert.equal(spec1.explanations[0]?.evidence[0]?.quote, injected, 'spec.r1.json carries the fabricated quote');
  assert.deepEqual(summary.repairs[0]?.targeted, ['grounding.quotes']);
  assert.equal(summary.repairs[0]?.afterInjectedFault, true);
  assert.equal(summary.repairs[0]?.publishable, true);

  const inject = readEvents(storageDir, jobId).find(e => e.stage === 'inject');
  assert.equal(
    inject?.detail,
    'demo fault injected by the system: fabricated-quote at explanations[0].evidence[0].quote',
  );
});

/* ------------------------------------------------------------------ */
/* A second engine: lift-equation-v1 via the fixture specs              */
/* ------------------------------------------------------------------ */

function toGen(full: ActivitySpec): GeneratedSpec {
  const sim = full.simulation as unknown as Record<string, unknown>;
  const genSim: Record<string, unknown> = {};
  for (const key of Object.keys(sim)) {
    if (key === 'engine' || key === 'equation') {
      continue;
    }
    const v: unknown = sim[key];
    if (
      typeof v === 'object' &&
      v !== null &&
      'min' in (v as Record<string, unknown>) &&
      'max' in (v as Record<string, unknown>) &&
      'default' in (v as Record<string, unknown>)
    ) {
      const r = v as Record<string, unknown>;
      genSim[key] = { min: r.min, max: r.max, default: r.default };
    } else {
      genSim[key] = structuredClone(v);
    }
  }
  return {
    title: full.title,
    learningObjectives: [...full.learningObjectives],
    explanations: structuredClone(full.explanations),
    simulation: genSim,
    behavioralTests: structuredClone(full.behavioralTests),
    predictions: structuredClone(full.predictions),
  } as unknown as GeneratedSpec;
}

/** A temp library dir holding the CC0 lift fixture source (real files, hash-consistent). */
function writeLiftSourceDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'task015-liftsrc-'));
  const doc = liftSourceDoc();
  writeFileSync(join(dir, 'fixture-lift-source.txt'), doc.text);
  writeFileSync(
    join(dir, 'fixture-lift-source.json'),
    JSON.stringify(
      {
        id: doc.id,
        title: doc.title,
        locator: doc.locator,
        license: doc.license,
        attribution: doc.attribution,
        sha256: doc.sha256,
        textFile: 'fixture-lift-source.txt',
        retrievedAt: '2026-10-28T00:00:00.000Z',
        transcription: 'verbatim',
        purpose: 'test-fixture',
      },
      null,
      2,
    ),
  );
  return dir;
}

const liftAnalysis: SourceAnalysis = {
  supported: true,
  activity: 'lift-equation-v1',
  unsupportedReason: '',
  concepts: [
    {
      id: 'lift-equation',
      name: 'The lift equation',
      evidence: [
        {
          sourceId: 'fixture-lift-source',
          quote: 'lift equals the lift coefficient times the air density times half the velocity squared times the wing area',
        },
      ],
    },
  ],
  objectives: ['Predict lift from coefficient, density, speed and wing area.'],
};

test('demo fault wrong-answer on lift-equation-v1: injected, caught and repaired (second engine)', async () => {
  const storageDir = tempStorage();
  const sourcesDir = writeLiftSourceDir();
  const liftGen = toGen(makeLiftSpec());
  const { client } = stagedClient({ analysis: liftAnalysis, rev1: liftGen, repairs: [toGen(makeLiftSpec())] });
  const { jobId, done } = startJob('fixture-lift-source', {
    client,
    storageDir,
    sourcesDir: pathToFileURL(`${sourcesDir}/`),
    purpose: 'demo',
    demoFault: 'wrong-answer',
  });
  const summary = await done;

  assert.equal(summary.status, 'succeeded');
  assert.equal(summary.engine, 'lift-equation-v1');
  assert.equal(summary.publishedRevision, 2);
  assert.deepEqual(summary.demoFault, {
    kind: 'wrong-answer',
    path: 'behavioralTests[0].expectedLiftN',
    original: 12250,
    injected: 18375, // S5-04: 12250 + max(1, 6125, 10*maxTolerance(lift, 12250) = 612.5)
    revision: 1,
    effective: true,
  });
  assert.equal(summary.repairs[0]?.afterInjectedFault, true);
  assert.deepEqual(summary.repairs[0]?.targeted, ['behavior.tests']);

  const spec1 = readJson(join(storageDir, 'runs', jobId, 'spec.r1.json')) as {
    simulation: { engine: string };
    behavioralTests: { expectedLiftN: number }[];
  };
  assert.equal(spec1.simulation.engine, 'lift-equation-v1');
  assert.equal(spec1.behavioralTests[0]?.expectedLiftN, 18375);
  const inject = readEvents(storageDir, jobId).find(e => e.stage === 'inject');
  assert.equal(
    inject?.detail,
    'demo fault injected by the system: wrong-answer at behavioralTests[0].expectedLiftN',
  );
});

test('lift engine without a demo fault: failing revision 1 is repaired to a publishable revision 2', async () => {
  const storageDir = tempStorage();
  const sourcesDir = writeLiftSourceDir();
  const badLift = toGen(makeLiftSpec()) as GeneratedSpec & { behavioralTests: Record<string, unknown>[] };
  badLift.behavioralTests[0]['expectedLiftN'] = 999999;
  const { client } = stagedClient({
    analysis: liftAnalysis,
    rev1: badLift,
    repairs: [toGen(makeLiftSpec())],
  });
  const { jobId, done } = startJob('fixture-lift-source', {
    client,
    storageDir,
    sourcesDir: pathToFileURL(`${sourcesDir}/`),
    purpose: 'test-live',
  });
  const summary = await done;
  assert.equal(summary.status, 'succeeded');
  assert.equal(summary.engine, 'lift-equation-v1');
  assert.equal(summary.publishedRevision, 2);
  assert.equal(summary.demoFault, undefined);
  assert.equal(summary.repairs[0]?.afterInjectedFault, false);
  const spec2 = readJson(join(storageDir, 'runs', jobId, 'spec.r2.json')) as {
    behavioralTests: { expectedLiftN: number }[];
    provenance: { revision: number; repairOf: number | null };
  };
  assert.equal(spec2.behavioralTests[0]?.expectedLiftN, 12250);
  assert.equal(spec2.provenance.revision, 2);
  assert.equal(spec2.provenance.repairOf, 1);
});

/* ------------------------------------------------------------------ */
/* Teacher ('user') sources in the worker                               */
/* ------------------------------------------------------------------ */

const USER_TEXT = [
  "Runway physics: a teacher's own notes for a straight, level model-aircraft run.",
  'The core relation is F = m * a and, solved for the acceleration, a = F / m.',
  'The force (F) will be the difference between the opposing forces (thrust minus drag).',
  'However, if the forces become unbalanced, the aircraft will move in the direction of the greater force.',
  'For a constant force and constant mass, the acceleration remains constant.',
  'Velocity then grows linearly with time: V = a * t + Vo.',
  'Students predict the acceleration for a given mass and net force, then compare with the simulation.',
].join('\n');

function userGenFor(sourceId: string): GeneratedSpec {
  const gen = structuredClone(genFixture) as GeneratedSpec & {
    explanations: { evidence: { sourceId: string }[] }[];
  };
  for (const explanation of gen.explanations) {
    for (const ev of explanation.evidence) {
      ev.sourceId = sourceId;
    }
  }
  return gen as unknown as GeneratedSpec;
}

function userAnalysisFor(sourceId: string): SourceAnalysis {
  return {
    supported: true,
    activity: 'forces-1d-v1',
    unsupportedReason: '',
    concepts: [
      {
        id: 'constant-acceleration',
        name: 'Constant acceleration under a constant net force',
        evidence: [
          {
            sourceId,
            quote: 'For a constant force and constant mass, the acceleration remains constant.',
          },
        ],
      },
    ],
    objectives: ['Calculate acceleration from a constant net force and mass in one dimension.'],
  };
}

test('user source: a teacher-pasted source runs the full pipeline with sourceKind user', async () => {
  const storageDir = tempStorage();
  const id = userSourceId(USER_TEXT);
  assert.match(id, /^user-[0-9a-f]{12}$/);
  const saved = saveUserSource(
    {
      title: 'Runway physics notes',
      text: USER_TEXT,
      license: 'own-work',
      attribution: 'Written by the teacher for this class.',
      rightsConfirmed: true,
    },
    join(storageDir, 'user-sources'),
  );
  assert.equal(saved.id, id);
  assert.equal(saved.created, true);

  const { client } = stagedClient({ analysis: userAnalysisFor(id), rev1: userGenFor(id) });
  const { jobId, done } = startJob(id, { client, storageDir, purpose: 'test-live' });
  const summary = await done;

  assert.equal(summary.status, 'succeeded');
  assert.equal(summary.sourceKind, 'user');
  assert.equal(summary.engine, 'forces-1d-v1');
  assert.equal(summary.publishable, true);
  assert.equal(summary.publishedRevision, 1);
  assert.equal(summary.revisions, 1);
  const spec1 = readJson(join(storageDir, 'runs', jobId, 'spec.r1.json')) as { sources: { id: string }[] };
  assert.equal(spec1.sources[0]?.id, id, 'the spec cites the teacher source');
});

test('user source: a tampered stored text fails ingest with SOURCE_UNAVAILABLE', async () => {
  const storageDir = tempStorage();
  const id = userSourceId(USER_TEXT);
  saveUserSource(
    {
      title: 'Runway physics notes',
      text: USER_TEXT,
      license: 'own-work',
      attribution: 'Written by the teacher for this class.',
      rightsConfirmed: true,
    },
    join(storageDir, 'user-sources'),
  );
  const textPath = join(storageDir, 'user-sources', `${id}.txt`);
  writeFileSync(textPath, `${readFileSync(textPath, 'utf8')}\ntampered after the fact`);

  const { client } = stagedClient({ analysis: userAnalysisFor(id), rev1: userGenFor(id) });
  const { done } = startJob(id, { client, storageDir, purpose: 'test-live' });
  const summary = await done;
  assert.equal(summary.status, 'failed');
  assert.deepEqual(summary.error, { code: 'SOURCE_UNAVAILABLE', message: 'source unavailable' });
  assert.equal(summary.sourceKind, 'user');
  assert.equal(summary.totalCostUSD, 0, 'no model call happens for an unverifiable source');
});

test('startJob rejects an unknown demoFault synchronously', () => {
  const storageDir = tempStorage();
  assert.throws(
    () =>
      startJob('nasa-grc-equations-of-motion', {
        client: stagedClient().client,
        storageDir,
        purpose: 'demo',
        demoFault: 'totally-made-up' as 'wrong-answer',
      }),
    /DEMO_FAULT_INVALID/,
  );
});
