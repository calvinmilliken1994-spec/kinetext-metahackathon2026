import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateSpec, repairSpec, GeneratedOutputError } from './pipeline.ts';
import type { TimelineSourceAnalysis } from './pipeline.ts';
import { PROMPT_VERSION } from './prompts.ts';
import type { CompleteRequest, MetaClient } from './client.ts';
import type {
  ForcesActivitySpec,
  ForcesGeneratedSpec,
  GeneratedSpec,
  MetaReceipt,
  RepairFinding,
  SourceAnalysis,
  SourceDocument,
  TimelineActivitySpec,
  TimelineGeneratedSpec,
  ValidationReport,
} from '../contracts/index.ts';
import { assembleTimelineSpec, initialProvenance } from '../contracts/index.ts';
import { timelineGenSchema } from '../contracts/schemas.ts';
import { compareRevisions, repairFindings, validateSpec } from '../validation/validate.ts';
import { loadSource } from '../sources/index.ts';

const source: SourceDocument = loadSource('nara-declaration-of-independence');

const fixtureGen: TimelineGeneratedSpec = JSON.parse(
  readFileSync(new URL('../../tests/fixtures/timeline.declaration.gen.json', import.meta.url), 'utf8'),
) as TimelineGeneratedSpec;

const sourceDocForces: SourceDocument = JSON.parse(
  readFileSync(new URL('../../tests/fixtures/source-doc.json', import.meta.url), 'utf8'),
) as SourceDocument;

const analysisForces: SourceAnalysis = JSON.parse(
  readFileSync(new URL('../../tests/fixtures/analysis.forces.json', import.meta.url), 'utf8'),
) as SourceAnalysis;

const genForces: GeneratedSpec = JSON.parse(
  readFileSync(new URL('../../tests/fixtures/gen.forces.json', import.meta.url), 'utf8'),
) as GeneratedSpec;

const fakeReceipt: MetaReceipt = {
  purpose: 'test-live',
  requestedModel: 'muse-spark-1.3',
  returnedModel: 'muse-spark-1.3',
  responseId: 'resp_timeline_fake_1',
  usage: { promptTokens: 10, completionTokens: 20, reasoningTokens: 5, cachedTokens: 0 },
  latencyMs: 1,
  estCostUSD: 0.0001,
  finishReason: 'stop',
  attempts: 1,
};

const FIXED_MESSAGE = 'The model returned output that does not match the required structure.';

const analysisTimeline: TimelineSourceAnalysis = {
  supported: true,
  activity: 'timeline-v1',
  unsupportedReason: '',
  concepts: [
    {
      id: 'declaration-sequence',
      name: 'Declaration sequence',
      evidence: [{ sourceId: source.id, quote: 'placeholder quote for prompt use only' }],
    },
  ],
  objectives: ['Put the steps in order.'],
};

function fakeClientFor<T>(data: unknown, seen?: CompleteRequest[]): MetaClient {
  return {
    async complete<U>(req: CompleteRequest): Promise<{ data: U; receipt: MetaReceipt }> {
      if (seen !== undefined) {
        seen.push(req);
      } else {
        void req;
      }
      return { data: data as unknown as U, receipt: fakeReceipt };
    },
  };
}

function assembleTimeline(
  gen: TimelineGeneratedSpec,
  specId = 'spec-timeline-1',
  runId = 'job-timeline-1',
): TimelineActivitySpec {
  return assembleTimelineSpec(gen, {
    id: specId,
    sources: [source],
    provenance: initialProvenance({
      provider: 'meta',
      requestedModel: fakeReceipt.requestedModel,
      returnedModel: fakeReceipt.returnedModel,
      responseId: fakeReceipt.responseId,
      runId,
      promptVersion: PROMPT_VERSION,
      generatedAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
    }),
  });
}

test('generateSpec timeline happy path uses timeline schema, prompt and provenance', async () => {
  const seen: CompleteRequest[] = [];
  const fake: MetaClient = fakeClientFor<TimelineGeneratedSpec>(fixtureGen, seen);
  const fixed: Date = new Date('2026-01-01T00:00:00.000Z');
  const result = await generateSpec(
    fake,
    source,
    analysisTimeline,
    { jobId: 'job-1', specId: 'spec-1' },
    'test-live',
    () => fixed,
  );
  assert.equal(result.report.publishable, true);
  for (const c of result.report.checks) {
    assert.equal(c.passed, true);
  }
  assert.equal(seen.length, 1);
  const req0 = seen[0];
  assert.ok(req0 !== undefined);
  assert.equal(req0.schemaName, 'activity_spec');
  assert.ok(req0.jsonSchema === timelineGenSchema);
  assert.equal(req0.maxOutputTokens, 8000);
  const system = req0.messages[0];
  assert.ok(system !== undefined);
  assert.equal(system.role, 'system');
  assert.ok(system.content.includes('timeline-v1'));
  assert.equal(result.spec.simulation.engine, 'timeline-v1');
  assert.equal(result.spec.sources.length, 1);
  const src0 = result.spec.sources[0];
  assert.ok(src0 !== undefined);
  assert.ok(!('text' in (src0 as unknown as Record<string, unknown>)));
  assert.equal(result.spec.provenance.revision, 1);
  assert.equal(result.spec.provenance.repairOf, null);
  assert.equal(result.spec.provenance.promptVersion, PROMPT_VERSION);
  assert.ok(result.receipt === fakeReceipt);
  assert.ok(result.generated === (fixtureGen as unknown as TimelineGeneratedSpec));
});

test('generateSpec rejects schema-invalid timeline output with GeneratedOutputError stage specify', async () => {
  const numericShaped: unknown = structuredClone(genForces);
  const cases: unknown[] = [null, {}, { title: 'x' }, numericShaped];
  for (const bad of cases) {
    const fake: MetaClient = fakeClientFor<unknown>(bad);
    let caught: unknown;
    try {
      await generateSpec(
        fake,
        source,
        analysisTimeline,
        { jobId: 'job-1', specId: 'spec-1' },
        'demo',
        () => new Date('2026-01-01T00:00:00.000Z'),
      );
      assert.fail('expected GeneratedOutputError');
    } catch (err: unknown) {
      caught = err;
    }
    assert.ok(caught instanceof GeneratedOutputError);
    const outErr = caught as GeneratedOutputError;
    assert.equal(outErr.code, 'OUTPUT_INVALID');
    assert.equal(outErr.stage, 'specify');
    assert.ok(outErr.receipt === fakeReceipt);
  }
});

test('generateSpec and repairSpec guards fire before any model call', async () => {
  const noneAnalysis = {
    supported: false,
    activity: 'none',
    unsupportedReason: 'No activity fits.',
    concepts: [],
    objectives: [],
  } as unknown as SourceAnalysis;
  const unknownAnalysis = {
    supported: true,
    activity: 'drag-v9',
    unsupportedReason: '',
    concepts: [],
    objectives: [],
  } as unknown as SourceAnalysis;
  for (const bad of [noneAnalysis, unknownAnalysis]) {
    const seen: CompleteRequest[] = [];
    const fake: MetaClient = fakeClientFor<unknown>(fixtureGen, seen);
    await assert.rejects(
      () =>
        generateSpec(fake, source, bad, { jobId: 'job-1', specId: 'spec-1' }, 'demo', () => new Date()),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.equal((err as Error).message, 'ENGINE_REQUIRED');
        assert.ok(!(err instanceof GeneratedOutputError));
        return true;
      },
    );
    assert.equal(seen.length, 0);
  }

  const timelineSpec = assembleTimeline(fixtureGen);
  const timelineReport: ValidationReport = validateSpec(timelineSpec, [source]);
  const timelineGen = fixtureGen;
  for (const bad of [noneAnalysis, unknownAnalysis]) {
    const seen: CompleteRequest[] = [];
    const fake: MetaClient = fakeClientFor<unknown>(fixtureGen, seen);
    const previous = {
      generated: timelineGen,
      spec: timelineSpec,
      report: timelineReport,
      revision: 1,
      findingsHistory: [[]] as RepairFinding[][],
    };
    await assert.rejects(
      () =>
        repairSpec(
          fake,
          source,
          bad,
          previous as unknown as {
            generated: GeneratedSpec;
            spec: ForcesActivitySpec;
            report: ValidationReport;
            revision: number;
            findingsHistory: RepairFinding[][];
          },
          { jobId: 'job-1', specId: 'spec-1' },
          'demo',
          () => new Date(),
        ),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.equal((err as Error).message, 'ENGINE_REQUIRED');
        return true;
      },
    );
    assert.equal(seen.length, 0);
  }
});

test('repairSpec ENGINE_MISMATCH across forces and timeline in either direction', async () => {
  const forcesInit = await generateSpec(
    fakeClientFor<GeneratedSpec>(genForces),
    sourceDocForces,
    analysisForces,
    { jobId: 'job-1', specId: 'spec-1' },
    'demo',
    () => new Date('2026-01-01T00:00:00.000Z'),
  );
  const timelineSpec = assembleTimeline(fixtureGen);
  const timelineReport: ValidationReport = validateSpec(timelineSpec, [source]);
  {
    const seen: CompleteRequest[] = [];
    const fake: MetaClient = fakeClientFor<unknown>(fixtureGen, seen);
    const previousForces = {
      generated: genForces,
      spec: forcesInit.spec,
      report: forcesInit.report,
      revision: 1,
      findingsHistory: [[]] as RepairFinding[][],
    };
    await assert.rejects(
      () =>
        repairSpec(
          fake,
          sourceDocForces,
          analysisTimeline,
          previousForces as unknown as {
            generated: TimelineGeneratedSpec;
            spec: TimelineActivitySpec;
            report: ValidationReport;
            revision: number;
            findingsHistory: RepairFinding[][];
          },
          { jobId: 'job-1', specId: 'spec-1' },
          'demo',
        ),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok((err as Error).message.startsWith('ENGINE_MISMATCH'));
        assert.ok((err as Error).message.includes('timeline-v1'));
        return true;
      },
    );
    assert.equal(seen.length, 0);
  }
  {
    const seen: CompleteRequest[] = [];
    const fake: MetaClient = fakeClientFor<unknown>(genForces, seen);
    const previousTimeline = {
      generated: fixtureGen,
      spec: timelineSpec,
      report: timelineReport,
      revision: 1,
      findingsHistory: [[]] as RepairFinding[][],
    };
    const forcesAnalysis = analysisForces;
    await assert.rejects(
      () =>
        repairSpec(
          fake,
          source,
          forcesAnalysis,
          previousTimeline as unknown as {
            generated: GeneratedSpec;
            spec: NonNullable<unknown> & { simulation: { engine: string } };
            report: ValidationReport;
            revision: number;
            findingsHistory: RepairFinding[][];
          } as unknown as {
            generated: GeneratedSpec;
            spec: import('../contracts/index.ts').ForcesActivitySpec;
            report: ValidationReport;
            revision: number;
            findingsHistory: RepairFinding[][];
          },
          { jobId: 'job-1', specId: 'spec-1' },
          'demo',
        ),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok((err as Error).message.startsWith('ENGINE_MISMATCH'));
        return true;
      },
    );
    assert.equal(seen.length, 0);
  }
});

test('repairSpec timeline path fixes an ungrounded year', async () => {
  const brokenGen = structuredClone(fixtureGen) as TimelineGeneratedSpec;
  const e3 = brokenGen.simulation.events.find((e) => e.id === 'e3');
  assert.ok(e3 !== undefined);
  e3.year = 1775;
  const spec1 = assembleTimeline(brokenGen, 'spec-1');
  const report1: ValidationReport = validateSpec(spec1, [source]);
  const dateGrounded = report1.checks.find((c) => c.id === 'timeline.date-grounded');
  assert.ok(dateGrounded !== undefined);
  assert.equal(dateGrounded.passed, false);
  assert.equal(report1.publishable, false);
  const findings = repairFindings(report1, spec1);
  assert.ok(findings.length > 0);

  const seen: CompleteRequest[] = [];
  const fake: MetaClient = fakeClientFor<TimelineGeneratedSpec>(fixtureGen, seen);
  const fixed: Date = new Date('2026-02-01T00:00:00.000Z');
  const previous = {
    generated: brokenGen,
    spec: spec1,
    report: report1,
    revision: 1,
    findingsHistory: [findings],
  };
  const repaired = await repairSpec(
    fake,
    source,
    analysisTimeline,
    previous,
    { jobId: 'job-1', specId: 'spec-1' },
    'test-live',
    () => fixed,
  );
  assert.equal(seen.length, 1);
  const req0 = seen[0];
  assert.ok(req0 !== undefined);
  assert.equal(req0.schemaName, 'activity_spec_repair');
  assert.ok(req0.jsonSchema === timelineGenSchema);
  assert.equal(repaired.report.publishable, true);
  const weakening = repaired.report.checks.find((c) => c.id === 'repair.no-weakening');
  assert.ok(weakening !== undefined);
  assert.equal(weakening.passed, true);
  assert.equal(repaired.spec.simulation.engine, 'timeline-v1');
  assert.equal(repaired.spec.provenance.revision, 2);
  assert.equal(repaired.spec.provenance.repairOf, 1);
  assert.equal(repaired.spec.provenance.promptVersion, PROMPT_VERSION);
  const user = req0.messages[1];
  assert.ok(user !== undefined);
  assert.equal(user.role, 'user');
  const parts = user.content.split('<untrusted-repair-data>');
  assert.equal(parts.length, 2);
  const inner = (parts[1] as string).split('</untrusted-repair-data>')[0] as string;
  assert.ok(inner.includes(fixtureGen.title.slice(0, 10)));
  assert.ok(inner.includes('timeline.date-grounded'));
});

test('repairSpec passes source and baseline findings to compareRevisions', async () => {
  const paraphrase = 'The Continental Congress adopted the Declaration on July 4, 1776.';
  const baselineGen = structuredClone(fixtureGen) as TimelineGeneratedSpec;
  const e3base = baselineGen.simulation.events.find((e) => e.id === 'e3');
  assert.ok(e3base !== undefined);
  assert.equal(e3base.evidence.length, 1);
  const q0 = e3base.evidence[0];
  assert.ok(q0 !== undefined);
  q0.quote = paraphrase;
  const baselineSpec = assembleTimeline(baselineGen, 'spec-base');
  const baselineReport: ValidationReport = validateSpec(baselineSpec, [source]);
  const quotesCheck = baselineReport.checks.find((c) => c.id === 'grounding.quotes');
  assert.ok(quotesCheck !== undefined);
  assert.equal(quotesCheck.passed, false);
  const failedIds: string[] = baselineReport.checks.filter((c) => !c.passed).map((c) => c.id);
  assert.ok(failedIds.includes('grounding.quotes'));
  const findings: RepairFinding[] = repairFindings(baselineReport, baselineSpec);

  const seen: CompleteRequest[] = [];
  const fake: MetaClient = fakeClientFor<TimelineGeneratedSpec>(fixtureGen, seen);
  const previous = {
    generated: baselineGen,
    spec: baselineSpec,
    report: baselineReport,
    revision: 1,
    findingsHistory: [findings],
  };
  const repaired = await repairSpec(
    fake,
    source,
    analysisTimeline,
    previous,
    { jobId: 'job-1', specId: 'spec-base' },
    'demo',
    () => new Date('2026-01-01T00:00:00.000Z'),
  );
  const weakening = repaired.report.checks.find((c) => c.id === 'repair.no-weakening');
  assert.ok(weakening !== undefined);
  const expectedWith = compareRevisions(baselineSpec, repaired.spec, failedIds, {
    sources: [source],
    findings,
  });
  assert.deepEqual(weakening, expectedWith);
  assert.equal(weakening.passed, true);
  const expectedWithout = compareRevisions(baselineSpec, repaired.spec, failedIds);
  assert.notDeepEqual(expectedWith, expectedWithout);
  assert.equal(expectedWithout.passed, false);
});

test('repairSpec with explicit baseline compares against revision 1, not the previous revision', async () => {
  const baselineSpec = assembleTimeline(fixtureGen, 'spec-base');
  const baselineReport: ValidationReport = validateSpec(baselineSpec, [source]);
  assert.equal(baselineReport.publishable, true);
  const baselineFailedIds: string[] = baselineReport.checks
    .filter((c) => !c.passed)
    .map((c) => c.id);

  const removedGen = structuredClone(fixtureGen) as TimelineGeneratedSpec;
  removedGen.simulation.events = removedGen.simulation.events.filter((e) => e.id !== 'e3');
  const previousSpec = assembleTimeline(removedGen, 'spec-prev');
  const previousReport: ValidationReport = validateSpec(previousSpec, [source]);

  const seen: CompleteRequest[] = [];
  const fake: MetaClient = fakeClientFor<TimelineGeneratedSpec>(removedGen, seen);
  const previous = {
    generated: removedGen,
    spec: previousSpec,
    report: previousReport,
    revision: 2,
    findingsHistory: [[], []] as RepairFinding[][],
    baseline: { spec: baselineSpec, failedIds: baselineFailedIds },
  };
  const repaired = await repairSpec(
    fake,
    source,
    analysisTimeline,
    previous,
    { jobId: 'job-1', specId: 'spec-base' },
    'demo',
    () => new Date('2026-01-01T00:00:00.000Z'),
  );
  const weakening = repaired.report.checks.find((c) => c.id === 'repair.no-weakening');
  assert.ok(weakening !== undefined);
  const baselineFindings = repairFindings(validateSpec(baselineSpec, [source]), baselineSpec);
  const expectedBaseline = compareRevisions(baselineSpec, repaired.spec, baselineFailedIds, {
    sources: [source],
    findings: baselineFindings,
  });
  assert.deepEqual(weakening, expectedBaseline);
  assert.equal(weakening.passed, false);
  const previousFailedIds: string[] = previousReport.checks
    .filter((c) => !c.passed)
    .map((c) => c.id);
  const expectedPrevious = compareRevisions(previousSpec, repaired.spec, previousFailedIds);
  assert.equal(expectedPrevious.passed, true);
});

test('numeric repair no-weakening is unchanged by the timeline context argument', async () => {
  const baselineGen = structuredClone(genForces as ForcesGeneratedSpec);
  for (const t of baselineGen.behavioralTests) {
    t.tolerance = 0.001;
  }
  for (const p of baselineGen.predictions) {
    p.tolerance = 0.001;
  }
  const baselineInit = await generateSpec(
    fakeClientFor<GeneratedSpec>(baselineGen),
    sourceDocForces,
    analysisForces,
    { jobId: 'job-base', specId: 'spec-base' },
    'demo',
    () => new Date('2026-01-01T00:00:00.000Z'),
  );
  assert.equal(baselineInit.report.publishable, true);
  const weakenedGen = structuredClone(baselineGen);
  const firstTest = weakenedGen.behavioralTests[0];
  assert.ok(firstTest !== undefined);
  firstTest.tolerance = 0.01;
  const weakenedInit = await generateSpec(
    fakeClientFor<GeneratedSpec>(weakenedGen),
    sourceDocForces,
    analysisForces,
    { jobId: 'job-weak', specId: 'spec-weak' },
    'demo',
    () => new Date('2026-01-01T00:00:00.000Z'),
  );
  const failedIds: string[] = baselineInit.report.checks
    .filter((c) => !c.passed)
    .map((c) => c.id);
  const previous = {
    generated: weakenedGen as unknown as GeneratedSpec,
    spec: weakenedInit.spec,
    report: weakenedInit.report,
    revision: 2,
    findingsHistory: [[], []] as RepairFinding[][],
  };
  const repaired = await repairSpec(
    fakeClientFor<GeneratedSpec>(weakenedGen),
    sourceDocForces,
    analysisForces,
    previous,
    { jobId: 'job-1', specId: 'spec-1' },
    'demo',
    () => new Date('2026-01-01T00:00:00.000Z'),
  );
  const weakening = repaired.report.checks.find((c) => c.id === 'repair.no-weakening');
  assert.ok(weakening !== undefined);
  const expected = compareRevisions(baselineInit.spec, weakenedInit.spec, failedIds);
  void expected;
  const expectedAgainstRepaired = compareRevisions(
    weakenedInit.spec,
    repaired.spec,
    previous.report.checks.filter((c) => !c.passed).map((c) => c.id),
  );
  assert.deepEqual(weakening, expectedAgainstRepaired);
  const withContext = compareRevisions(
    weakenedInit.spec,
    repaired.spec,
    previous.report.checks.filter((c) => !c.passed).map((c) => c.id),
    { sources: [sourceDocForces], findings: repairFindings(previous.report, previous.spec) },
  );
  assert.deepEqual(withContext, expectedAgainstRepaired);
});

test('repairSpec timeline path rejects schema-invalid model output with GeneratedOutputError stage repair', async () => {
  const timelineSpec = assembleTimeline(fixtureGen);
  const timelineReport: ValidationReport = validateSpec(timelineSpec, [source]);
  const previous = {
    generated: fixtureGen,
    spec: timelineSpec,
    report: timelineReport,
    revision: 1,
    findingsHistory: [[]] as RepairFinding[][],
  };
  const numericShaped: unknown = structuredClone(genForces);
  const missingEventsHolder = structuredClone(fixtureGen) as unknown as {
    simulation: Record<string, unknown> & { events?: unknown };
  };
  delete missingEventsHolder.simulation.events;
  const missingEvents: unknown = missingEventsHolder;
  const cases: unknown[] = [null, {}, numericShaped, missingEvents];
  for (const bad of cases) {
    const fake: MetaClient = fakeClientFor<unknown>(bad);
    let caught: unknown;
    try {
      await repairSpec(
        fake,
        source,
        analysisTimeline,
        previous,
        { jobId: 'job-1', specId: 'spec-1' },
        'demo',
        () => new Date('2026-01-01T00:00:00.000Z'),
      );
      assert.fail('expected GeneratedOutputError');
    } catch (err: unknown) {
      caught = err;
    }
    assert.ok(caught instanceof GeneratedOutputError);
    const outErr = caught as GeneratedOutputError;
    assert.equal(outErr.code, 'OUTPUT_INVALID');
    assert.equal(outErr.stage, 'repair');
    assert.equal(outErr.message, FIXED_MESSAGE);
    assert.equal(outErr.name, 'GeneratedOutputError');
    assert.ok(outErr.receipt === fakeReceipt);
  }
});

test('timeline generateSpec sends maxOutputTokens 8000 by default, honours override and forwards signal', async () => {
  const seen: CompleteRequest[] = [];
  const fake: MetaClient = {
    async complete<T>(req: CompleteRequest): Promise<{ data: T; receipt: MetaReceipt }> {
      seen.push(req);
      return { data: fixtureGen as unknown as T, receipt: fakeReceipt };
    },
  };
  await generateSpec(fake, source, analysisTimeline, { jobId: 'job-1', specId: 'spec-1' }, 'demo');
  const req0 = seen[0];
  assert.ok(req0 !== undefined);
  assert.equal(req0.maxOutputTokens, 8000);
  assert.ok(!('signal' in req0));
  await generateSpec(
    fake,
    source,
    analysisTimeline,
    { jobId: 'job-1', specId: 'spec-1' },
    'demo',
    () => new Date('2026-01-01T00:00:00.000Z'),
    { maxOutputTokens: 4321 },
  );
  const req1 = seen[1];
  assert.ok(req1 !== undefined);
  assert.equal(req1.maxOutputTokens, 4321);
  const controller = new AbortController();
  await generateSpec(
    fake,
    source,
    analysisTimeline,
    { jobId: 'job-1', specId: 'spec-1' },
    'demo',
    () => new Date('2026-01-01T00:00:00.000Z'),
    { signal: controller.signal },
  );
  const req2 = seen[2];
  assert.ok(req2 !== undefined);
  assert.equal(req2.maxOutputTokens, 8000);
  assert.ok(req2.signal === controller.signal);
});

test('timeline repairSpec sends maxOutputTokens 8000 by default, honours override and forwards signal', async () => {
  const timelineSpec = assembleTimeline(fixtureGen);
  const timelineReport: ValidationReport = validateSpec(timelineSpec, [source]);
  const previous = {
    generated: fixtureGen,
    spec: timelineSpec,
    report: timelineReport,
    revision: 1,
    findingsHistory: [[]] as RepairFinding[][],
  };
  const seen: CompleteRequest[] = [];
  const fake: MetaClient = {
    async complete<T>(req: CompleteRequest): Promise<{ data: T; receipt: MetaReceipt }> {
      seen.push(req);
      return { data: fixtureGen as unknown as T, receipt: fakeReceipt };
    },
  };
  await repairSpec(fake, source, analysisTimeline, previous, { jobId: 'job-1', specId: 'spec-1' }, 'demo');
  const req0 = seen[0];
  assert.ok(req0 !== undefined);
  assert.equal(req0.schemaName, 'activity_spec_repair');
  assert.equal(req0.maxOutputTokens, 8000);
  assert.ok(!('signal' in req0));
  await repairSpec(
    fake,
    source,
    analysisTimeline,
    previous,
    { jobId: 'job-1', specId: 'spec-1' },
    'demo',
    () => new Date('2026-01-01T00:00:00.000Z'),
    { maxOutputTokens: 5555 },
  );
  const req1 = seen[1];
  assert.ok(req1 !== undefined);
  assert.equal(req1.maxOutputTokens, 5555);
  const controller = new AbortController();
  await repairSpec(
    fake,
    source,
    analysisTimeline,
    previous,
    { jobId: 'job-1', specId: 'spec-1' },
    'demo',
    () => new Date('2026-01-01T00:00:00.000Z'),
    { signal: controller.signal },
  );
  const req2 = seen[2];
  assert.ok(req2 !== undefined);
  assert.equal(req2.maxOutputTokens, 8000);
  assert.ok(req2.signal === controller.signal);
});
