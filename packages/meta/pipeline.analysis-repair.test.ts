import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadSource } from '../sources/index.ts';
import { validateAnalysis } from '../validation/validate.ts';
import { sourceAnalysisGenSchema } from '../contracts/schemas.ts';
import { GeneratedOutputError, repairAnalysis } from './pipeline.ts';
import type { CompleteRequest, MetaClient } from './client.ts';
import type { MetaReceipt, SourceAnalysis, SourceDocument, ValidationReport } from '../contracts/index.ts';

const source: SourceDocument = loadSource('nasa-grc-motion-of-free-falling-object');

const storedFile = JSON.parse(
  readFileSync(new URL('../../docs/evidence/stage-5b/evaluation/jobs/job-20261028165911-9b924273/analysis.json', import.meta.url), 'utf8'),
) as { analysis: SourceAnalysis; report: ValidationReport };

const storedAnalysis: SourceAnalysis = storedFile.analysis;
const LONG_ID = 'velocity-and-displacement-under-constant-acceleration';
const FIXED_ID = 'velocity-displacement-constant-accel';
const FIXED_MESSAGE = 'The model returned output that does not match the required structure.';

const fakeReceipt: MetaReceipt = {
  purpose: 'test-live',
  requestedModel: 'muse-spark-1.3',
  returnedModel: 'muse-spark-1.3',
  responseId: 'resp_fake_repair_1',
  usage: { promptTokens: 10, completionTokens: 20, reasoningTokens: 5, cachedTokens: 0 },
  latencyMs: 1,
  estCostUSD: 0.0001,
  finishReason: 'stop',
  attempts: 1,
};

function fakeClientFor(data: unknown, requests: CompleteRequest[]): MetaClient {
  return {
    async complete<U>(req: CompleteRequest): Promise<{ data: U; receipt: MetaReceipt }> {
      requests.push(req);
      return { data: data as U, receipt: fakeReceipt };
    },
  };
}

function correctedAnalysis(): SourceAnalysis {
  const c: SourceAnalysis = structuredClone(storedAnalysis);
  const target = c.concepts.find((cc) => cc.id === LONG_ID);
  assert.ok(target);
  target.id = FIXED_ID;
  return c;
}

test('stored free-fall analysis fails only analysis.concept-ids (53-char id)', () => {
  assert.equal(LONG_ID.length, 53);
  assert.ok(LONG_ID.length > 40);
  const bad = storedAnalysis.concepts.find((c) => c.id === LONG_ID);
  assert.ok(bad);
  assert.equal(bad.id.length, 53);
  const report: ValidationReport = validateAnalysis(storedAnalysis, [source]);
  const failing = report.checks.filter((c) => !c.passed);
  assert.equal(failing.length, 1);
  assert.equal(failing[0]?.id, 'analysis.concept-ids');
  assert.equal(report.publishable, false);
});

test('repairAnalysis fixes the concept id (publishable, revision 2, schema and tokens)', async () => {
  const prevReport: ValidationReport = validateAnalysis(storedAnalysis, [source]);
  const fixed: SourceAnalysis = correctedAnalysis();
  assert.equal(FIXED_ID.length <= 40, true);
  assert.match(FIXED_ID, /^[a-z0-9-]{1,40}$/);
  const requests: CompleteRequest[] = [];
  const out = await repairAnalysis(
    fakeClientFor(fixed, requests),
    source,
    { analysis: storedAnalysis, report: prevReport, attempt: 1 },
    'test-live',
  );
  assert.equal(out.report.publishable, true);
  assert.ok(out.report.checks.every((c) => c.passed));
  const unchanged = out.report.checks.find((c) => c.id === 'repair.analysis-unchanged');
  assert.ok(unchanged);
  assert.equal(unchanged.passed, true);
  assert.equal(out.report.revision, 2);
  assert.equal(out.receipt, fakeReceipt);
  assert.equal(requests.length, 1);
  const req: CompleteRequest = requests[0] as CompleteRequest;
  assert.equal(req.schemaName, 'source_analysis_repair');
  assert.equal(req.jsonSchema, sourceAnalysisGenSchema);
  assert.equal(req.maxOutputTokens, 6000);
  assert.equal(req.signal, undefined);
  assert.deepEqual(out.analysis, fixed);
});

test('repairAnalysis forwards maxOutputTokens and signal when given', async () => {
  const prevReport: ValidationReport = validateAnalysis(storedAnalysis, [source]);
  const fixed: SourceAnalysis = correctedAnalysis();
  const requests: CompleteRequest[] = [];
  const controller = new AbortController();
  const out = await repairAnalysis(
    fakeClientFor(fixed, requests),
    source,
    { analysis: storedAnalysis, report: prevReport, attempt: 1 },
    'demo',
    { maxOutputTokens: 1234, signal: controller.signal },
  );
  assert.equal(requests.length, 1);
  assert.equal((requests[0] as CompleteRequest).maxOutputTokens, 1234);
  assert.equal((requests[0] as CompleteRequest).signal, controller.signal);
  assert.equal(out.report.publishable, true);
});

test("declining repair passes validateAnalysis but fails repair.analysis-unchanged", async () => {
  const prevReport: ValidationReport = validateAnalysis(storedAnalysis, [source]);
  const declined = {
    supported: false,
    activity: 'none',
    unsupportedReason: 'The source teaches falling motion with constant acceleration but no listed activity fits its teaching.',
    concepts: [],
    objectives: [],
  } as unknown as SourceAnalysis;
  assert.equal(validateAnalysis(declined, [source]).publishable, true);
  const requests: CompleteRequest[] = [];
  const out = await repairAnalysis(
    fakeClientFor(declined, requests),
    source,
    { analysis: storedAnalysis, report: prevReport, attempt: 1 },
    'test-live',
  );
  const unchanged = out.report.checks.find((c) => c.id === 'repair.analysis-unchanged');
  assert.ok(unchanged);
  assert.equal(unchanged?.passed, false);
  assert.equal(out.report.publishable, false);
  assert.equal(unchanged?.path, '/activity');
});

test('field-scoped guard: fixing the affected id passes; changing an objective or another name fails', async () => {
  const prevReport: ValidationReport = validateAnalysis(storedAnalysis, [source]);
  const fixed: SourceAnalysis = correctedAnalysis();
  const changedObjectives: SourceAnalysis = structuredClone(fixed);
  changedObjectives.objectives[0] = 'SYNTH-MARKER-OBJ-7f3a learner explains velocity change.';
  assert.equal(validateAnalysis(changedObjectives, [source]).publishable, true);
  const requestsA: CompleteRequest[] = [];
  const outA = await repairAnalysis(
    fakeClientFor(changedObjectives, requestsA),
    source,
    { analysis: storedAnalysis, report: prevReport, attempt: 1 },
    'test-live',
  );
  const unchangedA = outA.report.checks.find((c) => c.id === 'repair.analysis-unchanged');
  assert.ok(unchangedA);
  assert.equal(unchangedA?.passed, false);
  assert.equal(unchangedA?.path, '/objectives/0');
  assert.equal(unchangedA?.affected, undefined);
  assert.equal(outA.report.publishable, false);
  const changedName: SourceAnalysis = structuredClone(fixed);
  changedName.concepts[0]!.name = 'SYNTH-MARKER-NAME-4b1c revised concept name.';
  assert.equal(validateAnalysis(changedName, [source]).publishable, true);
  const requestsC: CompleteRequest[] = [];
  const outC = await repairAnalysis(
    fakeClientFor(changedName, requestsC),
    source,
    { analysis: storedAnalysis, report: prevReport, attempt: 1 },
    'test-live',
  );
  const unchangedC = outC.report.checks.find((c) => c.id === 'repair.analysis-unchanged');
  assert.ok(unchangedC);
  assert.equal(unchangedC?.passed, false);
  assert.equal(unchangedC?.path, '/concepts/0/name');
  assert.equal(unchangedC?.affected, undefined);
  assert.equal(outC.report.publishable, false);
  const requestsB: CompleteRequest[] = [];
  const outB = await repairAnalysis(
    fakeClientFor(fixed, requestsB),
    source,
    { analysis: storedAnalysis, report: prevReport, attempt: 1 },
    'test-live',
  );
  const unchangedB = outB.report.checks.find((c) => c.id === 'repair.analysis-unchanged');
  assert.ok(unchangedB);
  assert.equal(unchangedB?.passed, true);
  assert.equal(outB.report.publishable, true);
});

test('analysis.invariants failure allows a decision change', async () => {
  const fixed: SourceAnalysis = correctedAnalysis();
  const prevInv: SourceAnalysis = structuredClone(fixed);
  prevInv.activity = 'none' as unknown as SourceAnalysis['activity'];
  const prevReport: ValidationReport = validateAnalysis(prevInv, [source]);
  const invCheck = prevReport.checks.find((c) => c.id === 'analysis.invariants');
  assert.ok(invCheck);
  assert.equal(invCheck?.passed, false);
  const requests: CompleteRequest[] = [];
  const out = await repairAnalysis(
    fakeClientFor(fixed, requests),
    source,
    { analysis: prevInv, report: prevReport, attempt: 1 },
    'test-live',
  );
  const unchanged = out.report.checks.find((c) => c.id === 'repair.analysis-unchanged');
  assert.ok(unchanged);
  assert.equal(unchanged?.passed, true);
  assert.equal(out.report.publishable, true);
});

test('malformed repaired output throws GeneratedOutputError with receipt', async () => {
  const prevReport: ValidationReport = validateAnalysis(storedAnalysis, [source]);
  const badOutputs: unknown[] = [
    [],
    'oops SYNTH-MARKER-BAD-1',
    { supported: true, activity: 'forces-1d-v1', unsupportedReason: '', objectives: ['x'] },
  ];
  for (const bad of badOutputs) {
    const requests: CompleteRequest[] = [];
    let err: unknown;
    try {
      await repairAnalysis(
        fakeClientFor(bad, requests),
        source,
        { analysis: storedAnalysis, report: prevReport, attempt: 1 },
        'test-live',
      );
    } catch (e) {
      err = e;
    }
    assert.ok(err instanceof GeneratedOutputError);
    const typed = err as GeneratedOutputError;
    assert.equal(typed.stage, 'analysis-repair');
    assert.equal(typed.code, 'OUTPUT_INVALID');
    assert.equal(typed.message, FIXED_MESSAGE);
    assert.equal(typed.receipt, fakeReceipt);
  }
});

test('guards throw before any model call', async () => {
  const failingReport: ValidationReport = validateAnalysis(storedAnalysis, [source]);
  assert.ok(failingReport.checks.some((c) => !c.passed));
  for (const attempt of [0, 3, 1.5]) {
    const requests: CompleteRequest[] = [];
    let err: unknown;
    try {
      await repairAnalysis(
        fakeClientFor(correctedAnalysis(), requests),
        source,
        { analysis: storedAnalysis, report: failingReport, attempt },
        'test-live',
      );
    } catch (e) {
      err = e;
    }
    assert.ok(err instanceof Error);
    assert.match((err as Error).message, /REPAIR_ATTEMPT_INVALID/);
    assert.equal(requests.length, 0);
  }
  const passingReport: ValidationReport = validateAnalysis(correctedAnalysis(), [source]);
  assert.ok(passingReport.checks.every((c) => c.passed));
  {
    const requests: CompleteRequest[] = [];
    let err: unknown;
    try {
      await repairAnalysis(
        fakeClientFor(correctedAnalysis(), requests),
        source,
        { analysis: correctedAnalysis(), report: passingReport, attempt: 1 },
        'test-live',
      );
    } catch (e) {
      err = e;
    }
    assert.ok(err instanceof Error);
    assert.match((err as Error).message, /NOTHING_TO_REPAIR/);
    assert.equal(requests.length, 0);
  }
  {
    const requests: CompleteRequest[] = [];
    let err: unknown;
    try {
      await repairAnalysis(
        fakeClientFor(correctedAnalysis(), requests),
        source,
        { analysis: storedAnalysis, report: { artifactId: 'source-analysis', revision: 1, checks: [], publishable: false }, attempt: 1 },
        'test-live',
      );
    } catch (e) {
      err = e;
    }
    assert.ok(err instanceof Error);
    assert.match((err as Error).message, /NOTHING_TO_REPAIR/);
    assert.equal(requests.length, 0);
  }
});

test('repair messages carry the finding and previous analysis inside the untrusted block', async () => {
  const prevReport: ValidationReport = validateAnalysis(storedAnalysis, [source]);
  const fixed: SourceAnalysis = correctedAnalysis();
  const requests: CompleteRequest[] = [];
  await repairAnalysis(
    fakeClientFor(fixed, requests),
    source,
    { analysis: storedAnalysis, report: prevReport, attempt: 1 },
    'test-live',
  );
  const user: string = (requests[0] as CompleteRequest).messages[1]?.content ?? '';
  assert.ok(user.includes('<untrusted-analysis-repair-data>'));
  assert.ok(user.includes('</untrusted-analysis-repair-data>'));
  const block: string = user.split('<untrusted-analysis-repair-data>')[1]?.split('</untrusted-analysis-repair-data>')[0] ?? '';
  assert.ok(block.includes('analysis.concept-ids'));
  const rawMessage: string = prevReport.checks.find((c) => c.id === 'analysis.concept-ids')?.message ?? '';
  assert.ok(rawMessage.length > 0);
  const escapedMessage: string = JSON.stringify(rawMessage).slice(1, -1).replace(/</g, '\\u003c');
  assert.ok(block.includes(escapedMessage));
  assert.ok(block.includes(LONG_ID));
});

test('attempt 2 with baseline compares against the original analysis (immutable revision 1)', async () => {
  const baselineReport: ValidationReport = validateAnalysis(storedAnalysis, [source]);
  const rev2: SourceAnalysis = correctedAnalysis();
  rev2.objectives[0] = 'SYNTH-OBJ-REV2-3f8a learner explains velocity change.';
  const rev2Reqs: CompleteRequest[] = [];
  const rev2Out = await repairAnalysis(
    fakeClientFor(rev2, rev2Reqs),
    source,
    { analysis: storedAnalysis, report: baselineReport, attempt: 1 },
    'test-live',
  );
  const rev2Report: ValidationReport = rev2Out.report;
  const unchanged2 = rev2Report.checks.find((c) => c.id === 'repair.analysis-unchanged');
  assert.ok(unchanged2);
  assert.equal(unchanged2.passed, false);
  assert.equal(unchanged2.path, '/objectives/0');
  const previous2 = {
    analysis: rev2,
    report: rev2Report,
    attempt: 2,
    baseline: { analysis: storedAnalysis, report: baselineReport },
  };
  const keepsChanged: SourceAnalysis = structuredClone(rev2);
  const reqKeep: CompleteRequest[] = [];
  const outKeep = await repairAnalysis(fakeClientFor(keepsChanged, reqKeep), source, previous2, 'test-live');
  const unchangedKeep = outKeep.report.checks.find((c) => c.id === 'repair.analysis-unchanged');
  assert.ok(unchangedKeep);
  assert.equal(unchangedKeep.passed, false);
  assert.equal(unchangedKeep.path, '/objectives/0');
  assert.equal(outKeep.report.publishable, false);
  assert.equal(outKeep.report.revision, 3);
  const restored: SourceAnalysis = correctedAnalysis();
  const reqRestore: CompleteRequest[] = [];
  const outRestore = await repairAnalysis(fakeClientFor(restored, reqRestore), source, previous2, 'test-live');
  const unchangedRestore = outRestore.report.checks.find((c) => c.id === 'repair.analysis-unchanged');
  assert.ok(unchangedRestore);
  assert.equal(unchangedRestore.passed, true);
  assert.equal(outRestore.report.publishable, true);
  assert.equal(outRestore.report.revision, 3);
  const user: string = (reqRestore[0] as CompleteRequest).messages[1]?.content ?? '';
  const block: string = user.split('<untrusted-analysis-repair-data>')[1]?.split('</untrusted-analysis-repair-data>')[0] ?? '';
  assert.ok(block.includes('originalAnalysis'));
  for (const obj of storedAnalysis.objectives) {
    const escaped: string = JSON.stringify(obj).slice(1, -1).replace(/</g, '\\u003c');
    assert.ok(block.includes(escaped));
  }
});

test('repair.analysis-unchanged failure never unlocks a group (no baseline)', async () => {
  const baseReport: ValidationReport = validateAnalysis(storedAnalysis, [source]);
  const prevReport: ValidationReport = {
    artifactId: 'source-analysis',
    revision: 2,
    checks: [
      ...baseReport.checks,
      {
        id: 'repair.analysis-unchanged',
        kind: 'semantic',
        passed: false,
        message: 'repair changed objectives without a finding naming them',
        path: '/objectives',
      },
    ],
    publishable: false,
  };
  const changed: SourceAnalysis = correctedAnalysis();
  changed.objectives[0] = 'SYNTH-OBJ-NOBASE-9c2d learner explains velocity change.';
  const requests: CompleteRequest[] = [];
  const out = await repairAnalysis(
    fakeClientFor(changed, requests),
    source,
    { analysis: storedAnalysis, report: prevReport, attempt: 1 },
    'test-live',
  );
  const unchanged = out.report.checks.find((c) => c.id === 'repair.analysis-unchanged');
  assert.ok(unchanged);
  assert.equal(unchanged.passed, false);
  assert.equal(unchanged.path, '/objectives/0');
  assert.equal(unchanged.affected, undefined);
  assert.equal(out.report.publishable, false);
});
