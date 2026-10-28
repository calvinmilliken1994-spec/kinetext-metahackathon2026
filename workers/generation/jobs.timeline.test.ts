// TASK-023a — timeline-v1 worker integration tests: the same stage machine, events,
// ledger accounting, immutable-baseline repair loop and labelled demo faults as the
// numeric engines, against FAKE MetaClients and the real Declaration source + fixtures.
// No network, no credits, no .env access.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer as createNetServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { readJob, startJob } from './jobs.ts';
import type { JobSummary } from './jobs.ts';
import { createMetaClient } from '../../packages/meta/client.ts';
import type { CompleteRequest, MetaClient } from '../../packages/meta/client.ts';
import { openLedger } from '../../packages/meta/ledger.ts';
import type { Ledger } from '../../packages/meta/ledger.ts';
import type {
  MetaReceipt,
  SourceAnalysis,
  StageEvent,
  TimelineGeneratedSpec,
} from '../../packages/contracts/index.ts';

const SOURCE_ID = 'nara-declaration-of-independence';

const analysisFixture = JSON.parse(
  readFileSync(new URL('../../tests/fixtures/timeline.declaration.analysis.json', import.meta.url), 'utf8'),
) as SourceAnalysis;
const genFixture = JSON.parse(
  readFileSync(new URL('../../tests/fixtures/timeline.declaration.gen.json', import.meta.url), 'utf8'),
) as TimelineGeneratedSpec;

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
  /** One payload per 'activity_spec_repair' call (shifted); falls back to a clean clone. */
  repairs?: unknown[];
}

/** Fake client dispatching on schemaName, mirroring jobs.stage5.test.ts's stagedClient. */
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
          data: (opts.analysis ?? structuredClone(analysisFixture)) as T,
          receipt: fakeReceipt('fake-analysis-1'),
        });
      }
      if (req.schemaName === 'activity_spec') {
        return Promise.resolve({
          data: (opts.rev1 ?? structuredClone(genFixture)) as T,
          receipt: fakeReceipt('fake-gen-1'),
        });
      }
      repairCalls += 1;
      const data: unknown =
        opts.repairs !== undefined && opts.repairs.length > 0 ? opts.repairs.shift() : structuredClone(genFixture);
      return Promise.resolve({ data: data as T, receipt: fakeReceipt(`fake-repair-${repairCalls}`) });
    },
  };
  return { client, calls, repairCount: (): number => repairCalls };
}

function tempStorage(): string {
  return mkdtempSync(join(tmpdir(), 'task023a-timeline-'));
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

/** Revision 1 whose first event states a year (1775) that neither its quote nor the title states. */
function ungroundedYearGen(): TimelineGeneratedSpec {
  const bad = structuredClone(genFixture);
  const e1 = bad.simulation.events[0];
  assert.ok(e1 !== undefined);
  e1.year = 1775;
  return bad;
}

/**
 * An honest fix of the failing e1 PLUS a rewrite of e3, whose date passed grounding on the
 * baseline (day 4 → 3 with a different quote) — the timeline weakening the comparator must reject.
 */
function weakeningRegroundGen(): TimelineGeneratedSpec {
  const next = structuredClone(genFixture);
  const e3 = next.simulation.events[2];
  assert.ok(e3 !== undefined);
  e3.day = 3;
  const quote = e3.evidence[0];
  assert.ok(quote !== undefined);
  quote.quote = 'The congressional revision process took all of July 3rd and most of July 4th';
  return next;
}

/* ------------------------------------------------------------------ */
/* (a) publishable on revision 1                                        */
/* ------------------------------------------------------------------ */

test('timeline: a clean generated timeline publishes on revision 1 with engine timeline-v1', async () => {
  const storageDir = tempStorage();
  const { client, calls, repairCount } = stagedClient({});
  const { jobId, done } = startJob(SOURCE_ID, { client, storageDir, purpose: 'test-live' });
  const summary: JobSummary = await done;

  assert.equal(summary.status, 'succeeded');
  assert.equal(summary.publishable, true);
  assert.equal(summary.publishedRevision, 1);
  assert.equal(summary.engine, 'timeline-v1');
  assert.equal(summary.revisions, 1);
  assert.deepEqual(summary.repairs, []);
  assert.equal(summary.demoFault, undefined);
  assert.equal(summary.sourceKind, 'library');
  assert.equal(summary.totalCostUSD, 0.02, 'analysis + spec receipts, exactly like a numeric job');
  assert.equal(summary.reservedUnknownUSD, 0);
  assert.equal(repairCount(), 0, 'a publishable revision 1 triggers no repair call');
  assert.equal(summary.checksPassed, 11, 'the timeline report carries 11 checks');
  assert.equal(summary.checksTotal, 11);
  assert.equal(summary.checksPassed, summary.checksTotal);

  const runDir = join(storageDir, 'runs', jobId);
  const spec1 = readJson(join(runDir, 'spec.r1.json')) as {
    schemaVersion: string;
    id: string;
    sources: { id: string; text?: unknown }[];
    simulation: { engine: string; equation?: unknown; events: { id: string }[] };
    behavioralTests: unknown[];
    predictions: unknown[];
    execution: Record<string, unknown>;
    provenance: { revision: number; repairOf: number | null; promptVersion: string };
  };
  assert.equal(spec1.schemaVersion, '0.3.0');
  assert.equal(spec1.id, `${SOURCE_ID}-${jobId}`.slice(0, 64));
  assert.equal(spec1.simulation.engine, 'timeline-v1');
  assert.equal(spec1.simulation.equation, undefined, 'a sequence-engine spec carries no equation');
  assert.equal(spec1.simulation.events.length, 6);
  assert.equal(spec1.behavioralTests.length, 4);
  assert.equal(spec1.predictions.length, 2);
  assert.equal(spec1.sources[0]?.id, SOURCE_ID);
  assert.equal(spec1.sources[0]?.text, undefined, 'source text never enters the spec');
  assert.deepEqual(spec1.execution, {
    maxWallTimeMs: 2000,
    maxRepairAttempts: 2,
    network: false,
    generatedCodeAllowed: false,
  });
  assert.equal(spec1.provenance.revision, 1);
  assert.equal(spec1.provenance.repairOf, null);

  const report1 = readJson(join(runDir, 'report.r1.json')) as {
    checks: { id: string; passed: boolean }[];
    publishable: boolean;
  };
  assert.equal(report1.publishable, true);
  assert.deepEqual(
    report1.checks.map(c => c.id),
    [
      'schema.full',
      'timeline.unique-ids',
      'timeline.approximate-date',
      'timeline.date-grounded',
      'timeline.distinct-dates',
      'timeline.case-order',
      'refs.sources',
      'refs.sha256',
      'grounding.quotes',
      'policy.no-publisher-attribution',
      'scope.prose-unverified',
    ],
  );
  assert.ok(report1.checks.every(c => c.passed));
  assert.ok(!existsSync(join(runDir, 'spec.r2.json')));
  for (const f of readdirSync(runDir)) {
    assert.ok(!f.includes('.tmp'), `no temp artifact may remain: ${f}`);
  }

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
      'validate:succeeded',
      'done:succeeded',
    ],
  );
  const analyzeOk = events.find(e => e.stage === 'analyze' && e.status === 'succeeded');
  assert.match(analyzeOk?.detail ?? '', /^supported; checks \d+\/\d+ passed$/);
  const specifyOk = events.find(e => e.stage === 'specify' && e.status === 'succeeded');
  assert.equal(specifyOk?.detail, `spec ${spec1.id}`);
  assert.equal(specifyOk?.estCostUSD, 0.01);
  assert.equal(events.at(-1)?.detail, 'publishable');

  // The analysis fixture (supported, timeline-v1) is what the job records.
  const analysisFile = readJson(join(runDir, 'analysis.json')) as { analysis: { activity: string } };
  assert.equal(analysisFile.analysis.activity, 'timeline-v1');

  // The spec/repair calls carry the job deadline signal and the configured output caps (R-11).
  assert.deepEqual(
    calls.map(c => `${c.schema}:${c.maxOutputTokens}:${c.hasSignal}`),
    ['source_analysis:6000:true', 'activity_spec:8000:true'],
  );

  // readJob serves the timeline job unchanged in shape.
  const full = readJob(storageDir, jobId);
  assert.ok(full !== null);
  assert.equal(full.summary.engine, 'timeline-v1');
  assert.deepEqual(
    full.revisions.map(r => r.revision),
    [1],
  );
  assert.deepEqual(full.spec, readJson(join(runDir, 'spec.r1.json')));
  assert.deepEqual(full.report, readJson(join(runDir, 'report.r1.json')));
});

/* ------------------------------------------------------------------ */
/* (b) natural repair path                                              */
/* ------------------------------------------------------------------ */

test('timeline: an event year the quote does not state fails timeline.date-grounded and is repaired to revision 2', async () => {
  const storageDir = tempStorage();
  const { client, calls, repairCount } = stagedClient({ rev1: ungroundedYearGen(), repairs: [structuredClone(genFixture)] });
  const { jobId, done } = startJob(SOURCE_ID, { client, storageDir, purpose: 'test-live' });
  const summary = await done;

  assert.equal(summary.status, 'succeeded');
  assert.equal(summary.publishable, true);
  assert.equal(summary.publishedRevision, 2);
  assert.equal(summary.engine, 'timeline-v1');
  assert.equal(summary.revisions, 2);
  assert.equal(summary.demoFault, undefined);
  assert.equal(repairCount(), 1);
  assert.equal(summary.totalCostUSD, 0.03, 'analysis + spec + one repair receipt');
  assert.equal(summary.reservedUnknownUSD, 0);
  assert.deepEqual(summary.repairs, [
    {
      revision: 2,
      repairOf: 1,
      targeted: ['timeline.date-grounded'],
      fixed: ['timeline.date-grounded'],
      remaining: [],
      publishable: true,
      afterInjectedFault: false,
    },
  ]);

  const runDir = join(storageDir, 'runs', jobId);
  const report1 = readJson(join(runDir, 'report.r1.json')) as {
    checks: { id: string; passed: boolean; path?: string }[];
    publishable: boolean;
  };
  assert.equal(report1.publishable, false);
  const failed1 = report1.checks.filter(c => !c.passed);
  assert.equal(failed1.length, 1);
  assert.equal(failed1[0]?.id, 'timeline.date-grounded');
  assert.equal(failed1[0]?.path, '/simulation/events/0', 'the finding names the offending event');

  const report2 = readJson(join(runDir, 'report.r2.json')) as {
    checks: { id: string; passed: boolean }[];
    publishable: boolean;
  };
  assert.equal(report2.publishable, true);
  assert.equal(report2.checks.length, 12, 'the repair report adds repair.no-weakening');
  assert.ok(report2.checks.some(c => c.id === 'repair.no-weakening' && c.passed));

  const spec1 = readJson(join(runDir, 'spec.r1.json')) as { simulation: { events: { year: number }[] } };
  assert.equal(spec1.simulation.events[0]?.year, 1775, 'spec.r1.json persists the failing revision as generated');
  const spec2 = readJson(join(runDir, 'spec.r2.json')) as {
    simulation: { engine: string; events: { year: number }[] };
    provenance: { revision: number; repairOf: number | null };
  };
  assert.equal(spec2.simulation.engine, 'timeline-v1');
  assert.equal(spec2.simulation.events[0]?.year, 1776, 'the repair re-grounds the event with the stated year');
  assert.equal(spec2.provenance.revision, 2);
  assert.equal(spec2.provenance.repairOf, 1);

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
  assert.equal(validateFailed?.detail, 'VALIDATION_FAILED; failed checks: timeline.date-grounded');
  const repairStarted = events.find(e => e.stage === 'repair' && e.status === 'started');
  assert.equal(repairStarted?.revision, 2);
  assert.equal(repairStarted?.detail, 'targeted checks: timeline.date-grounded');
  const repairOk = events.find(e => e.stage === 'repair' && e.status === 'succeeded');
  assert.equal(repairOk?.responseId, 'fake-repair-1');
  assert.equal(repairOk?.estCostUSD, 0.01);
  assert.equal(events.at(-1)?.detail, 'publishable after repair (revision 2)');

  // R-11 parity: the repair call shares the job deadline signal and the spec output cap.
  const repairCall = calls.find(c => c.schema === 'activity_spec_repair');
  assert.ok(repairCall !== undefined);
  assert.equal(repairCall.hasSignal, true);
  assert.equal(repairCall.maxOutputTokens, 8000);
});

/* ------------------------------------------------------------------ */
/* (c) repair.no-weakening rejects rewriting a passing event's date     */
/* ------------------------------------------------------------------ */

test('timeline: a repair that changes a passing event date fails repair.no-weakening against the immutable baseline', async () => {
  const storageDir = tempStorage();
  const { client, repairCount } = stagedClient({
    rev1: ungroundedYearGen(),
    repairs: [weakeningRegroundGen(), structuredClone(genFixture)],
  });
  const { jobId, done } = startJob(SOURCE_ID, { client, storageDir, purpose: 'test-live' });
  const summary = await done;

  assert.equal(summary.status, 'succeeded');
  assert.equal(summary.publishedRevision, 3, 'the honest third revision publishes');
  assert.equal(summary.revisions, 3);
  assert.equal(repairCount(), 2);
  assert.equal(summary.totalCostUSD, 0.04, 'analysis + spec + two repair receipts');
  assert.equal(summary.repairs.length, 2);

  const weakening = summary.repairs[0];
  assert.ok(weakening !== undefined);
  assert.equal(weakening.revision, 2);
  assert.equal(weakening.publishable, false);
  assert.deepEqual(weakening.targeted, ['timeline.date-grounded']);
  assert.deepEqual(weakening.fixed, ['timeline.date-grounded'], 'the failing event was honestly re-grounded');
  assert.deepEqual(weakening.remaining, ['repair.no-weakening']);
  assert.equal(weakening.afterInjectedFault, false);

  const honest = summary.repairs[1];
  assert.ok(honest !== undefined);
  assert.equal(honest.revision, 3);
  assert.equal(honest.repairOf, 2);
  assert.equal(honest.publishable, true);
  assert.deepEqual(honest.targeted, ['repair.no-weakening']);
  assert.deepEqual(honest.fixed, ['repair.no-weakening']);
  assert.deepEqual(honest.remaining, []);

  const report2 = readJson(join(storageDir, 'runs', jobId, 'report.r2.json')) as {
    checks: { id: string; passed: boolean; message: string }[];
    publishable: boolean;
  };
  assert.equal(report2.publishable, false);
  assert.equal(report2.checks.filter(c => !c.passed).length, 1, 'only the no-weakening check fails on r2');
  const noWeakening = report2.checks.find(c => c.id === 'repair.no-weakening');
  assert.ok(noWeakening !== undefined);
  assert.equal(noWeakening.passed, false);
  assert.match(noWeakening.message, /event "e3" changed \(day 4 -> 3, evidence quotes changed\)/);
  assert.match(noWeakening.message, /passed on the baseline/);

  // The r3 comparison ran against the IMMUTABLE revision-1 baseline: the clean event dates
  // (identical to r1's passing events) pass again even though r2 had rewritten e3.
  const spec3 = readJson(join(storageDir, 'runs', jobId, 'spec.r3.json')) as {
    simulation: { events: { day: number }[] };
    provenance: { revision: number; repairOf: number | null };
  };
  assert.equal(spec3.simulation.events[2]?.day, 4, 'the published revision keeps the baseline e3 date');
  assert.equal(spec3.provenance.revision, 3);
  assert.equal(spec3.provenance.repairOf, 2);
});

/* ------------------------------------------------------------------ */
/* (d) labelled system-made demo faults                                 */
/* ------------------------------------------------------------------ */

test('timeline demo fault wrong-answer: the swapped ordering answer is caught by timeline.case-order and repaired', async () => {
  const storageDir = tempStorage();
  const { client } = stagedClient({ repairs: [structuredClone(genFixture)] });
  const { jobId, done } = startJob(SOURCE_ID, {
    client,
    storageDir,
    purpose: 'demo',
    demoFault: 'wrong-answer',
  });
  const summary = await done;

  assert.equal(summary.status, 'succeeded');
  assert.equal(summary.engine, 'timeline-v1');
  assert.equal(summary.publishedRevision, 2);
  assert.deepEqual(summary.demoFault, {
    kind: 'wrong-answer',
    path: 'behavioralTests[0]',
    original: 'e1 -> e3',
    injected: 'e3 -> e1',
    revision: 1,
    effective: true,
  });
  assert.equal(summary.repairs.length, 1);
  assert.deepEqual(summary.repairs[0]?.targeted, ['timeline.case-order']);
  assert.deepEqual(summary.repairs[0]?.fixed, ['timeline.case-order']);
  assert.equal(summary.repairs[0]?.publishable, true);
  assert.equal(summary.repairs[0]?.afterInjectedFault, true, 'decision 17: never counts in quality metrics');

  const runDir = join(storageDir, 'runs', jobId);
  const spec1 = readJson(join(runDir, 'spec.r1.json')) as {
    behavioralTests: { name: string; earlierEventId: string; laterEventId: string }[];
    provenance: { revision: number };
  };
  assert.equal(spec1.behavioralTests[0]?.name, 'committee-before-adoption');
  assert.equal(spec1.behavioralTests[0]?.earlierEventId, 'e3', 'spec.r1.json reflects the swapped pair');
  assert.equal(spec1.behavioralTests[0]?.laterEventId, 'e1');
  assert.equal(spec1.provenance.revision, 1, 'the injected revision stays revision 1');
  const spec2 = readJson(join(runDir, 'spec.r2.json')) as {
    behavioralTests: { earlierEventId: string; laterEventId: string }[];
  };
  assert.equal(spec2.behavioralTests[0]?.earlierEventId, 'e1', 'the repair restores the honest ordering');
  assert.equal(spec2.behavioralTests[0]?.laterEventId, 'e3');

  const events = readEvents(storageDir, jobId);
  const inject = events.find(e => e.stage === 'inject');
  assert.ok(inject !== undefined, 'an inject event exists');
  assert.equal(inject.status, 'succeeded');
  assert.equal(inject.revision, 1);
  assert.equal(inject.detail, 'demo fault injected by the system: wrong-answer at behavioralTests[0]');
  const injectIdx = events.indexOf(inject);
  const specifyIdx = events.findIndex(e => e.stage === 'specify' && e.status === 'succeeded');
  const validateIdx = events.findIndex(e => e.stage === 'validate' && e.status === 'started');
  assert.ok(specifyIdx < injectIdx && injectIdx < validateIdx, 'injection happens after specify, before validation');

  // The shared fixture object is never mutated by demo faults (the fault hits a clone).
  assert.equal(genFixture.behavioralTests[0]?.earlierEventId, 'e1');
  assert.equal(genFixture.behavioralTests[0]?.laterEventId, 'e3');
});

test('timeline demo fault fabricated-quote: the replaced event quote is caught by grounding.quotes and repaired', async () => {
  const storageDir = tempStorage();
  const { client } = stagedClient({ repairs: [structuredClone(genFixture)] });
  const { jobId, done } = startJob(SOURCE_ID, {
    client,
    storageDir,
    purpose: 'demo',
    demoFault: 'fabricated-quote',
    newJobId: () => 'job-20260101000000-abcd1234',
  });
  const summary = await done;

  assert.equal(summary.status, 'succeeded');
  assert.equal(summary.publishedRevision, 2);
  const fault = summary.demoFault;
  assert.ok(fault !== undefined);
  assert.equal(fault.kind, 'fabricated-quote');
  assert.equal(fault.path, 'simulation.events[0].evidence[0].quote');
  assert.equal(fault.revision, 1);
  assert.equal(
    fault.original,
    'Congress appointed on June 10 a committee of five to draft a statement of independence for the colonies',
  );
  assert.equal(fault.effective, true, 'S5-04: the intended grounding.quotes check failed on revision 1');
  assert.equal(
    fault.injected,
    'Muse confirmed this result in a controlled laboratory trial (ref abcd1234).',
    'the fabricated sentence carries the nonce derived from the job id',
  );

  // Decision 18: the fabricated sentence must not occur in the real source text.
  const sourceText = readFileSync(new URL(`../../data/sources/${SOURCE_ID}.txt`, import.meta.url), 'utf8');
  assert.ok(!sourceText.includes(String(fault.injected)));

  assert.deepEqual(summary.repairs[0]?.targeted, ['timeline.date-grounded', 'grounding.quotes']);
  assert.deepEqual(summary.repairs[0]?.fixed, ['timeline.date-grounded', 'grounding.quotes']);
  assert.deepEqual(summary.repairs[0]?.remaining, []);
  assert.equal(summary.repairs[0]?.publishable, true);
  assert.equal(summary.repairs[0]?.afterInjectedFault, true);

  const spec1 = readJson(join(storageDir, 'runs', jobId, 'spec.r1.json')) as {
    simulation: { events: { evidence: { quote: string }[] }[] };
  };
  assert.equal(spec1.simulation.events[0]?.evidence[0]?.quote, String(fault.injected));
  const spec2 = readJson(join(storageDir, 'runs', jobId, 'spec.r2.json')) as {
    simulation: { events: { evidence: { quote: string }[] }[] };
  };
  assert.equal(spec2.simulation.events[0]?.evidence[0]?.quote, String(fault.original), 'the repair restores the verbatim quote');

  const inject = readEvents(storageDir, jobId).find(e => e.stage === 'inject');
  assert.equal(
    inject?.detail,
    'demo fault injected by the system: fabricated-quote at simulation.events[0].evidence[0].quote',
  );
});

/* ------------------------------------------------------------------ */
/* (f) ledger/cost accounting identical to numeric jobs                 */
/* ------------------------------------------------------------------ */

const LIMITS = JSON.parse(
  readFileSync(new URL('../../config/resource-limits.json', import.meta.url), 'utf8'),
) as { maxInputTokens: number };
const FAKE_KEY = 'synt…ial'; // never a real credential
const MODEL = 'muse-spark-1.3';
/** Reviewer P3 valid usage: $0.0000975 per call at muse-spark-1.3 prices. */
const USAGE_SMALL = { prompt_tokens: 10, completion_tokens: 20 };
const USAGE_COST_SMALL = 0.0000975;

function envelope(id: string, content: string, usage: unknown): Record<string, unknown> {
  return {
    id,
    model: MODEL,
    choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }],
    usage,
  };
}

function freeLockPort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const probe = createNetServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (address === null || typeof address !== 'object') {
        probe.close();
        reject(new Error('NO_PORT'));
        return;
      }
      const port: number = (address as AddressInfo).port;
      probe.close(() => resolve(port));
    });
  });
}

test('timeline ledger accounting: real client + ledger, job total equals committed spend across three billed calls', async () => {
  const storageDir = tempStorage();
  const lockPort = await freeLockPort();
  const ledger: Ledger = await openLedger({
    path: join(storageDir, 'ledger.jsonl'),
    capUSD: 10,
    lockPort,
  });
  try {
    const responses: unknown[] = [
      envelope('resp-analysis-t', JSON.stringify(analysisFixture), USAGE_SMALL),
      envelope('resp-spec-t', JSON.stringify(ungroundedYearGen()), USAGE_SMALL),
      envelope('resp-repair-t', JSON.stringify(genFixture), USAGE_SMALL),
    ];
    const fetchImpl: typeof fetch = async () => {
      const next = responses.shift();
      assert.ok(next !== undefined, 'exactly three provider calls: analysis, spec, one repair');
      return new Response(JSON.stringify(next), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const client: MetaClient = createMetaClient({
      apiKey: FAKE_KEY,
      ledger,
      allowLive: true,
      maxInputTokens: LIMITS.maxInputTokens,
      fetchImpl,
      sleep: async () => {},
    });
    const { jobId, done } = startJob(SOURCE_ID, { client, storageDir, purpose: 'test-live' });
    const summary: JobSummary = await done;

    assert.equal(summary.status, 'succeeded');
    assert.equal(summary.engine, 'timeline-v1');
    assert.equal(summary.publishedRevision, 2);
    assert.equal(summary.revisions, 2);
    const committedUSD = ledger.committedUSD();
    assert.ok(
      Math.abs(summary.totalCostUSD - committedUSD) <= 1e-6,
      `job total ${summary.totalCostUSD} equals ledger committed ${committedUSD}`,
    );
    assert.ok(
      Math.abs(committedUSD - 3 * USAGE_COST_SMALL) <= 1e-9,
      `three billed calls at the small-usage price, committed ${committedUSD}`,
    );
    assert.equal(summary.reservedUnknownUSD, 0, 'every call reconciled from usage');

    // Receipt fields ride the stage events exactly like numeric jobs.
    const events = readEvents(storageDir, jobId);
    for (const stage of ['analyze', 'specify', 'repair'] as const) {
      const ev = events.find(e => e.stage === stage && e.status === 'succeeded');
      assert.ok(ev !== undefined, `${stage} succeeded event exists`);
      assert.ok(
        ev !== undefined && Math.abs((ev.estCostUSD ?? Number.NaN) - USAGE_COST_SMALL) <= 1e-9,
        `${stage} event carries its receipt cost`,
      );
      assert.equal(ev?.model, MODEL);
    }
  } finally {
    ledger.close();
  }
});
