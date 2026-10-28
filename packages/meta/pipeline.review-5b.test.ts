import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadSource, sha256 } from '../sources/index.ts';
import { validateAnalysis, validateSpec, repairFindings } from '../validation/validate.ts';
import { assembleTimelineSpec, initialProvenance } from '../contracts/index.ts';
import { harborSourceDoc, makeHarborTimelineSpec } from '../validation/fixtures/timeline-specs.ts';
import { repairAnalysis, repairSpec } from './pipeline.ts';
import type { TimelineSourceAnalysis } from './pipeline.ts';
import { PROMPT_VERSION } from './prompts.ts';
import type { CompleteRequest, MetaClient } from './client.ts';
import type {
  MetaReceipt,
  SourceAnalysis,
  SourceDocument,
  TimelineActivitySpec,
  TimelineGeneratedSpec,
  ValidationCheck,
  ValidationReport,
} from '../contracts/index.ts';

const equationsSource: SourceDocument = loadSource('nasa-grc-equations-of-motion');
const freeFallSource: SourceDocument = loadSource('nasa-grc-motion-of-free-falling-object');

const recordedBase: SourceAnalysis = JSON.parse(
  readFileSync(new URL('../../tests/fixtures/nasa-analysis.recorded.json', import.meta.url), 'utf8'),
) as SourceAnalysis;

const fakeReceipt: MetaReceipt = {
  purpose: 'test-live',
  requestedModel: 'muse-spark-1.3',
  returnedModel: 'muse-spark-1.3',
  responseId: 'resp_review5b_fake_1',
  usage: { promptTokens: 10, completionTokens: 20, reasoningTokens: 5, cachedTokens: 0 },
  latencyMs: 1,
  estCostUSD: 0.0001,
  finishReason: 'stop',
  attempts: 1,
};

function fakeClientFor(data: unknown, seen?: CompleteRequest[]): MetaClient {
  return {
    async complete<U>(req: CompleteRequest): Promise<{ data: U; receipt: MetaReceipt }> {
      if (seen !== undefined) {
        seen.push(req);
      }
      return { data: data as unknown as U, receipt: fakeReceipt };
    },
  };
}

function unchangedOf(report: ValidationReport): ValidationCheck {
  const c = report.checks.find((x) => x.id === 'repair.analysis-unchanged');
  assert.ok(c, 'expected repair.analysis-unchanged check');
  return c;
}

function badIdBaseline(): SourceAnalysis {
  const b: SourceAnalysis = structuredClone(recordedBase);
  b.concepts[0]!.id = 'x'.repeat(41);
  return b;
}

function blockOf(req: CompleteRequest): string {
  const user: string = req.messages[1]?.content ?? '';
  return user.split('<untrusted-analysis-repair-data>')[1]?.split('</untrusted-analysis-repair-data>')[0] ?? '';
}

test('analysis-id-unlocks-entire-concepts: full rewrite with deletion is rejected', async () => {
  const baseline = badIdBaseline();
  const prevReport = validateAnalysis(baseline, [equationsSource]);
  assert.ok(!prevReport.publishable);
  const candidate: SourceAnalysis = structuredClone(baseline);
  candidate.concepts = [{ ...baseline.concepts[0]!, id: 'fixed', name: 'Gravity is caused by invisible dragons' }];
  const out = await repairAnalysis(
    fakeClientFor(candidate),
    equationsSource,
    { analysis: baseline, report: prevReport, attempt: 1 },
    'test-live',
  );
  const guard = unchangedOf(out.report);
  assert.equal(guard.passed, false);
  assert.equal(guard.affected, undefined);
  assert.equal(out.report.publishable, false);
});

test('analysis-id-unlocks-entire-concepts: deletion alone is rejected', async () => {
  const baseline = badIdBaseline();
  const prevReport = validateAnalysis(baseline, [equationsSource]);
  const candidate: SourceAnalysis = structuredClone(baseline);
  candidate.concepts = [{ ...baseline.concepts[0]!, id: 'fixed' }];
  const out = await repairAnalysis(
    fakeClientFor(candidate),
    equationsSource,
    { analysis: baseline, report: prevReport, attempt: 1 },
    'test-live',
  );
  const guard = unchangedOf(out.report);
  assert.equal(guard.passed, false);
  assert.equal(out.report.publishable, false);
});

test('analysis-id-unlocks-entire-concepts: name rewrite alone is rejected', async () => {
  const baseline = badIdBaseline();
  const prevReport = validateAnalysis(baseline, [equationsSource]);
  const candidate: SourceAnalysis = structuredClone(baseline);
  candidate.concepts[0] = { ...baseline.concepts[0]!, id: 'fixed', name: 'Gravity is caused by invisible dragons' };
  const out = await repairAnalysis(
    fakeClientFor(candidate),
    equationsSource,
    { analysis: baseline, report: prevReport, attempt: 1 },
    'test-live',
  );
  const guard = unchangedOf(out.report);
  assert.equal(guard.passed, false);
  assert.equal(guard.path, '/concepts/0/name');
  assert.equal(out.report.publishable, false);
});

test('analysis-id-decline-control stays rejected', async () => {
  const baseline = badIdBaseline();
  const prevReport = validateAnalysis(baseline, [equationsSource]);
  const candidate = {
    ...structuredClone(baseline),
    supported: false,
    activity: 'none',
    unsupportedReason: 'No suitable activity.',
  } as unknown as SourceAnalysis;
  const out = await repairAnalysis(
    fakeClientFor(candidate),
    equationsSource,
    { analysis: baseline, report: prevReport, attempt: 1 },
    'test-live',
  );
  assert.equal(unchangedOf(out.report).passed, false);
  assert.equal(out.report.publishable, false);
});

test('empty-concepts-decline-escape is rejected', async () => {
  const baseline: SourceAnalysis = { ...structuredClone(recordedBase), concepts: [], objectives: [] };
  baseline.supported = true;
  (baseline as { activity: unknown }).activity = 'forces-1d-v1';
  baseline.unsupportedReason = '';
  const prevReport = validateAnalysis(baseline, [equationsSource]);
  const failing = prevReport.checks.filter((c) => !c.passed);
  assert.equal(failing.length, 1);
  assert.equal(failing[0]?.id, 'analysis.invariants');
  const candidate = {
    supported: false,
    activity: 'none',
    unsupportedReason: 'No suitable activity.',
    concepts: [],
    objectives: [],
  } as unknown as SourceAnalysis;
  const out = await repairAnalysis(
    fakeClientFor(candidate),
    equationsSource,
    { analysis: baseline, report: prevReport, attempt: 1 },
    'test-live',
  );
  assert.equal(unchangedOf(out.report).passed, false);
  assert.equal(out.report.publishable, false);
});

test('empty lists fixed by adding entries is accepted', async () => {
  const baseline: SourceAnalysis = { ...structuredClone(recordedBase), concepts: [], objectives: [] };
  baseline.supported = true;
  (baseline as { activity: unknown }).activity = 'forces-1d-v1';
  baseline.unsupportedReason = '';
  const prevReport = validateAnalysis(baseline, [equationsSource]);
  assert.ok(!prevReport.publishable);
  const candidate: SourceAnalysis = structuredClone(baseline);
  candidate.concepts = [
    { id: 'added-concept', name: 'Added concept', evidence: [{ sourceId: equationsSource.id, quote: 'F = m * a' }] },
  ];
  candidate.objectives = ['Learn acceleration.'];
  const out = await repairAnalysis(
    fakeClientFor(candidate),
    equationsSource,
    { analysis: baseline, report: prevReport, attempt: 1 },
    'test-live',
  );
  assert.equal(unchangedOf(out.report).passed, true);
  assert.equal(out.report.publishable, true);
});

test('decline accepted when the baseline decision itself is inconsistent', async () => {
  const baseline: SourceAnalysis = structuredClone(recordedBase);
  baseline.supported = false;
  (baseline as { activity: unknown }).activity = 'forces-1d-v1';
  baseline.unsupportedReason = '';
  const prevReport = validateAnalysis(baseline, [equationsSource]);
  const inv = prevReport.checks.find((c) => c.id === 'analysis.invariants');
  assert.ok(inv && !inv.passed);
  assert.ok((inv.affected ?? []).includes('/supported'));
  assert.ok((inv.affected ?? []).includes('/activity'));
  const candidate: SourceAnalysis = structuredClone(baseline);
  candidate.activity = 'none' as unknown as SourceAnalysis['activity'];
  candidate.unsupportedReason = 'SYNTH-MARKER-DECLINE-8a2c no listed activity fits this source.';
  const out = await repairAnalysis(
    fakeClientFor(candidate),
    equationsSource,
    { analysis: baseline, report: prevReport, attempt: 1 },
    'test-live',
  );
  assert.equal(unchangedOf(out.report).passed, true);
  assert.equal(out.report.publishable, true);
});

test('multiple-policy-groups-cannot-fix is accepted', async () => {
  const baseline: SourceAnalysis = structuredClone(recordedBase);
  baseline.concepts[0]!.name = 'NASA concept';
  baseline.objectives[0] = 'According to NASA, learn acceleration.';
  const prevReport = validateAnalysis(baseline, [equationsSource]);
  const policy = prevReport.checks.find((c) => c.id === 'policy.no-publisher-attribution');
  assert.ok(policy && !policy.passed);
  const candidate: SourceAnalysis = structuredClone(baseline);
  candidate.concepts[0]!.name = 'Force and mass';
  candidate.objectives[0] = 'Learn acceleration.';
  const out = await repairAnalysis(
    fakeClientFor(candidate),
    equationsSource,
    { analysis: baseline, report: prevReport, attempt: 1 },
    'test-live',
  );
  assert.equal(unchangedOf(out.report).passed, true);
  assert.equal(out.report.publishable, true);
});

test('attempt 2 repeats the same rejection with the same path', async () => {
  const r1 = badIdBaseline();
  const r1Report = validateAnalysis(r1, [equationsSource]);
  const r2: SourceAnalysis = structuredClone(r1);
  r2.concepts = [{ ...r1.concepts[0]!, id: 'fixed', name: 'Gravity is caused by invisible dragons' }];
  const first = await repairAnalysis(
    fakeClientFor(r2),
    equationsSource,
    { analysis: r1, report: r1Report, attempt: 1 },
    'test-live',
  );
  const firstGuard = unchangedOf(first.report);
  assert.equal(firstGuard.passed, false);
  const previous2 = { analysis: r2, report: first.report, attempt: 2, baseline: { analysis: r1, report: r1Report } };
  const second = await repairAnalysis(fakeClientFor(structuredClone(r2)), equationsSource, previous2, 'test-live');
  const secondGuard = unchangedOf(second.report);
  assert.equal(secondGuard.passed, false);
  assert.equal(secondGuard.path, firstGuard.path);
  assert.equal(second.report.publishable, false);
});

test('tampered caller report does not widen authorization', async () => {
  const baseline = badIdBaseline();
  const realReport = validateAnalysis(baseline, [equationsSource]);
  assert.ok(!realReport.publishable);
  const tampered: ValidationReport = {
    artifactId: realReport.artifactId,
    revision: realReport.revision,
    publishable: false,
    checks: [
      { id: 'analysis.concept-ids', kind: 'semantic', passed: false, message: 'tampered', path: '/concepts', affected: ['/concepts', '/objectives', '/supported'] },
    ],
  };
  const candidate: SourceAnalysis = structuredClone(baseline);
  candidate.concepts = [{ ...baseline.concepts[0]!, id: 'fixed' }];
  const out = await repairAnalysis(
    fakeClientFor(candidate),
    equationsSource,
    { analysis: baseline, report: tampered, attempt: 1 },
    'test-live',
  );
  assert.equal(unchangedOf(out.report).passed, false);
  assert.equal(out.report.publishable, false);
});

test('quote finding unlocks that quote only', async () => {
  const baseline: SourceAnalysis = structuredClone(recordedBase);
  const originalQuote: string = baseline.concepts[1]!.evidence[0]!.quote;
  baseline.concepts[1]!.evidence[0]!.quote = 'SYNTH-MARKER-NOT-IN-SOURCE-5f1e unrelated invented sentence.';
  const prevReport = validateAnalysis(baseline, [equationsSource]);
  const q = prevReport.checks.find((c) => c.id === 'grounding.quotes');
  assert.ok(q && !q.passed);
  const fixedQuote: SourceAnalysis = structuredClone(baseline);
  fixedQuote.concepts[1]!.evidence[0]!.quote = originalQuote;
  const outOk = await repairAnalysis(
    fakeClientFor(fixedQuote),
    equationsSource,
    { analysis: baseline, report: prevReport, attempt: 1 },
    'test-live',
  );
  assert.equal(unchangedOf(outOk.report).passed, true);
  assert.equal(outOk.report.publishable, true);
  const fixedPlusName: SourceAnalysis = structuredClone(fixedQuote);
  fixedPlusName.concepts[1]!.name = 'SYNTH-MARKER-NAME-9d4e changed name.';
  const outBad = await repairAnalysis(
    fakeClientFor(fixedPlusName),
    equationsSource,
    { analysis: baseline, report: prevReport, attempt: 1 },
    'test-live',
  );
  assert.equal(unchangedOf(outBad.report).passed, false);
  assert.equal(outBad.report.publishable, false);
});

test('duplicate id fixed by renaming one is accepted', async () => {
  const baseline: SourceAnalysis = structuredClone(recordedBase);
  baseline.concepts[1]!.id = baseline.concepts[0]!.id;
  const prevReport = validateAnalysis(baseline, [equationsSource]);
  const dup = prevReport.checks.find((c) => c.id === 'analysis.concept-ids');
  assert.ok(dup && !dup.passed);
  const candidate: SourceAnalysis = structuredClone(baseline);
  candidate.concepts[1]!.id = 'renamed-unique-concept';
  const out = await repairAnalysis(
    fakeClientFor(candidate),
    equationsSource,
    { analysis: baseline, report: prevReport, attempt: 1 },
    'test-live',
  );
  assert.equal(unchangedOf(out.report).passed, true);
  assert.equal(out.report.publishable, true);
});

test('recorded job r1 to r2 id-only repair stays accepted', async () => {
  const r1File = JSON.parse(
    readFileSync(new URL('../../docs/evidence/stage-5b/evaluation-rerun-hard/jobs/job-20261028181732-c760fe12/analysis.r1.json', import.meta.url), 'utf8'),
  ) as { analysis: SourceAnalysis; report: ValidationReport };
  const r2File = JSON.parse(
    readFileSync(new URL('../../docs/evidence/stage-5b/evaluation-rerun-hard/jobs/job-20261028181732-c760fe12/analysis.r2.json', import.meta.url), 'utf8'),
  ) as { analysis: SourceAnalysis; report: ValidationReport };
  const r1: SourceAnalysis = r1File.analysis;
  const r2: SourceAnalysis = r2File.analysis;
  const r1Report = validateAnalysis(r1, [freeFallSource]);
  assert.ok(!r1Report.publishable);
  const out = await repairAnalysis(
    fakeClientFor(r2),
    freeFallSource,
    { analysis: r1, report: r1Report, attempt: 1 },
    'test-live',
  );
  assert.equal(unchangedOf(out.report).passed, true);
  assert.equal(out.report.publishable, true);
});

test('prompt carries authorizedPaths equal to the recomputed affected paths', async () => {
  const baseline = badIdBaseline();
  const prevReport = validateAnalysis(baseline, [equationsSource]);
  const candidate: SourceAnalysis = structuredClone(baseline);
  candidate.concepts[0]!.id = 'fixed';
  const seen: CompleteRequest[] = [];
  await repairAnalysis(fakeClientFor(candidate, seen), equationsSource, { analysis: baseline, report: prevReport, attempt: 1 }, 'test-live');
  assert.equal(seen.length, 1);
  const rawBlock: string = blockOf(seen[0] as CompleteRequest);
  assert.ok(rawBlock.includes('<untrusted-analysis-repair-data>') === false);
  assert.ok(rawBlock.includes('authorizedPaths'));
  const unescaped: string = rawBlock.replace(/\\u003c/g, '<').replace(/\\u003e/g, '>').replace(/\\u0026/g, '&');
  const payload = JSON.parse(unescaped) as { authorizedPaths?: unknown };
  assert.deepEqual(payload.authorizedPaths, ['/concepts/0/id']);
});

function toTimelineGenerated(spec: TimelineActivitySpec): TimelineGeneratedSpec {
  return {
    title: spec.title,
    learningObjectives: structuredClone(spec.learningObjectives),
    explanations: structuredClone(spec.explanations),
    simulation: {
      events: structuredClone(spec.simulation.events),
      scenario: structuredClone(spec.simulation.scenario),
    },
    behavioralTests: structuredClone(spec.behavioralTests),
    predictions: structuredClone(spec.predictions),
  };
}

function harborSourceWithExtra(): SourceDocument {
  const base = harborSourceDoc();
  const extra = '\nAn earlier office opened on January 1, 1888.';
  const text: string = `${base.text}${extra}`;
  return { ...base, text, sha256: sha256(text) };
}

function harborBaseline(source: SourceDocument): TimelineActivitySpec {
  const spec = makeHarborTimelineSpec();
  spec.sources[0]!.sha256 = source.sha256;
  spec.simulation.events[4]!.label = 'NASA says "s1"';
  return spec;
}

const timelineAnalysis: TimelineSourceAnalysis = {
  supported: true,
  activity: 'timeline-v1',
  unsupportedReason: '',
  concepts: [
    { id: 'harbor-sequence', name: 'Harbor sequence', evidence: [{ sourceId: harborSourceDoc().id, quote: 'placeholder quote for prompt use only' }] },
  ],
  objectives: ['Put the steps in order.'],
};

function assembleTimelineFromGen(
  gen: TimelineGeneratedSpec,
  source: SourceDocument,
  specId: string,
  runId: string,
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

test('timeline repair: collateral event change fails no-weakening; label-only fix passes', async () => {
  const source = harborSourceWithExtra();
  const baselineSpec = harborBaseline(source);
  const baselineReport = validateSpec(baselineSpec, [source]);
  const failing = baselineReport.checks.filter((c) => !c.passed);
  assert.equal(failing.length, 1);
  assert.equal(failing[0]?.id, 'policy.no-publisher-attribution');
  assert.deepEqual(failing[0]?.affected, ['/simulation/events/4/label']);
  const baselineGen = toTimelineGenerated(baselineSpec);
  const labelOnly: TimelineGeneratedSpec = structuredClone(baselineGen);
  labelOnly.simulation.events[4]!.label = 'Final report signed';
  const outOk = await repairSpec(
    fakeClientFor(labelOnly),
    source,
    timelineAnalysis,
    {
      generated: baselineGen,
      spec: baselineSpec,
      report: baselineReport,
      revision: 1,
      findingsHistory: [repairFindings(baselineReport, baselineSpec)],
    },
    { jobId: 'job-tl-1', specId: 'spec-tl-1' },
    'test-live',
    () => new Date('2026-01-01T00:00:00.000Z'),
  );
  assert.equal(outOk.report.publishable, true);
  const collateral: TimelineGeneratedSpec = structuredClone(baselineGen);
  collateral.simulation.events[4]!.label = 'Final report signed';
  collateral.simulation.events[0] = {
    ...collateral.simulation.events[0]!,
    label: 'Earlier office',
    year: 1888,
    month: 1,
    day: 1,
    evidence: [{ sourceId: source.id, quote: 'An earlier office opened on January 1, 1888.' }],
  };
  const outBad = await repairSpec(
    fakeClientFor(collateral),
    source,
    timelineAnalysis,
    {
      generated: baselineGen,
      spec: baselineSpec,
      report: baselineReport,
      revision: 1,
      findingsHistory: [repairFindings(baselineReport, baselineSpec)],
    },
    { jobId: 'job-tl-1', specId: 'spec-tl-1' },
    'test-live',
    () => new Date('2026-01-01T00:00:00.000Z'),
  );
  const weakening = outBad.report.checks.find((c) => c.id === 'repair.no-weakening');
  assert.ok(weakening);
  assert.equal(weakening.passed, false);
  assert.equal(outBad.report.publishable, false);
  void assembleTimelineFromGen;
});

test('timeline repair without baseline still authorizes from recomputed findings despite message-only caller report', async () => {
  const source = harborSourceWithExtra();
  const baselineSpec = harborBaseline(source);
  const realReport = validateSpec(baselineSpec, [source]);
  const messageOnly: ValidationReport = {
    ...realReport,
    checks: realReport.checks.map((c) => {
      const copy = { ...c } as ValidationCheck & { affected?: string[] };
      delete copy.affected;
      return copy as ValidationCheck;
    }),
  };
  assert.ok(messageOnly.checks.every((c) => c.affected === undefined));
  const baselineGen = toTimelineGenerated(baselineSpec);
  const labelOnly: TimelineGeneratedSpec = structuredClone(baselineGen);
  labelOnly.simulation.events[4]!.label = 'Final report signed';
  const outOk = await repairSpec(
    fakeClientFor(labelOnly),
    source,
    timelineAnalysis,
    {
      generated: baselineGen,
      spec: baselineSpec,
      report: messageOnly,
      revision: 1,
      findingsHistory: [repairFindings(messageOnly, baselineSpec)],
    },
    { jobId: 'job-tl-2', specId: 'spec-tl-2' },
    'test-live',
    () => new Date('2026-01-01T00:00:00.000Z'),
  );
  assert.equal(outOk.report.publishable, true);
  const collateral: TimelineGeneratedSpec = structuredClone(baselineGen);
  collateral.simulation.events[4]!.label = 'Final report signed';
  collateral.simulation.events[0] = {
    ...collateral.simulation.events[0]!,
    label: 'Earlier office',
    year: 1888,
    month: 1,
    day: 1,
    evidence: [{ sourceId: source.id, quote: 'An earlier office opened on January 1, 1888.' }],
  };
  const outBad = await repairSpec(
    fakeClientFor(collateral),
    source,
    timelineAnalysis,
    {
      generated: baselineGen,
      spec: baselineSpec,
      report: messageOnly,
      revision: 1,
      findingsHistory: [repairFindings(messageOnly, baselineSpec)],
    },
    { jobId: 'job-tl-2', specId: 'spec-tl-2' },
    'test-live',
    () => new Date('2026-01-01T00:00:00.000Z'),
  );
  assert.equal(outBad.report.publishable, false);
  const weakening = outBad.report.checks.find((c) => c.id === 'repair.no-weakening');
  assert.ok(weakening);
  assert.equal(weakening.passed, false);
});

test('baseline-shape: concepts not an array cannot compare safely', async () => {
  const baselineUnknown: unknown = { ...structuredClone(recordedBase), concepts: {} };
  const prevReport = validateAnalysis(baselineUnknown, [equationsSource]);
  assert.ok(!prevReport.publishable);
  const candidate: SourceAnalysis = structuredClone(recordedBase);
  const out = await repairAnalysis(
    fakeClientFor(candidate),
    equationsSource,
    { analysis: baselineUnknown, report: prevReport, attempt: 1 },
    'test-live',
  );
  const guard = unchangedOf(out.report);
  assert.equal(guard.passed, false);
  assert.ok(guard.message.includes('cannot compare safely'));
  assert.equal(out.report.publishable, false);
});

test('baseline-shape: concept without evidence array cannot compare safely', async () => {
  const baselineUnknown: unknown = structuredClone(recordedBase);
  const rec = baselineUnknown as unknown as Record<string, unknown>;
  const cons = rec.concepts as unknown as Record<string, unknown>[];
  cons[0]!.evidence = {};
  const prevReport = validateAnalysis(baselineUnknown, [equationsSource]);
  assert.ok(!prevReport.publishable);
  const candidate: SourceAnalysis = structuredClone(recordedBase);
  const out = await repairAnalysis(
    fakeClientFor(candidate),
    equationsSource,
    { analysis: baselineUnknown, report: prevReport, attempt: 1 },
    'test-live',
  );
  const guard = unchangedOf(out.report);
  assert.equal(guard.passed, false);
  assert.ok(guard.message.includes('cannot compare safely'));
  assert.equal(out.report.publishable, false);
});

test('evidence-list unlock: appending verbatim entry passes guard', async () => {
  const srcId: string = recordedBase.concepts[1]!.evidence[0]!.sourceId;
  const originalEntry0 = structuredClone(recordedBase.concepts[1]!.evidence[0]!);
  const baseline: SourceAnalysis = structuredClone(recordedBase);
  baseline.concepts[1]!.evidence = [{ sourceId: srcId, quote: 'ab' }];
  const prevReport = validateAnalysis(baseline, [equationsSource]);
  const q = prevReport.checks.find((c) => c.id === 'grounding.quotes');
  assert.ok(q && !q.passed);
  assert.deepStrictEqual(q.affected, ['/concepts/1/evidence/0/quote', '/concepts/1/evidence']);
  const candidate: SourceAnalysis = structuredClone(baseline);
  candidate.concepts[1]!.evidence = [{ sourceId: srcId, quote: 'ab' }, structuredClone(originalEntry0)];
  const out = await repairAnalysis(
    fakeClientFor(candidate),
    equationsSource,
    { analysis: baseline, report: prevReport, attempt: 1 },
    'test-live',
  );
  assert.equal(unchangedOf(out.report).passed, true);
});

test('evidence-list unlock: replacing short quote with verbatim quote is publishable', async () => {
  const srcId: string = recordedBase.concepts[1]!.evidence[0]!.sourceId;
  const originalEntry0 = structuredClone(recordedBase.concepts[1]!.evidence[0]!);
  const baseline: SourceAnalysis = structuredClone(recordedBase);
  baseline.concepts[1]!.evidence = [{ sourceId: srcId, quote: 'ab' }];
  const prevReport = validateAnalysis(baseline, [equationsSource]);
  const q = prevReport.checks.find((c) => c.id === 'grounding.quotes');
  assert.ok(q && !q.passed);
  assert.deepStrictEqual(q.affected, ['/concepts/1/evidence/0/quote', '/concepts/1/evidence']);
  const candidate: SourceAnalysis = structuredClone(baseline);
  candidate.concepts[1]!.evidence = [structuredClone(originalEntry0)];
  const out = await repairAnalysis(
    fakeClientFor(candidate),
    equationsSource,
    { analysis: baseline, report: prevReport, attempt: 1 },
    'test-live',
  );
  assert.equal(unchangedOf(out.report).passed, true);
  assert.equal(out.report.publishable, true);
});

test('evidence-list unlock: changing sourceId while appending is rejected', async () => {
  const srcId: string = recordedBase.concepts[1]!.evidence[0]!.sourceId;
  const originalEntry0 = structuredClone(recordedBase.concepts[1]!.evidence[0]!);
  const baseline: SourceAnalysis = structuredClone(recordedBase);
  baseline.concepts[1]!.evidence = [{ sourceId: srcId, quote: 'ab' }];
  const prevReport = validateAnalysis(baseline, [equationsSource]);
  const q = prevReport.checks.find((c) => c.id === 'grounding.quotes');
  assert.ok(q && !q.passed);
  assert.deepStrictEqual(q.affected, ['/concepts/1/evidence/0/quote', '/concepts/1/evidence']);
  const candidate: SourceAnalysis = structuredClone(baseline);
  candidate.concepts[1]!.evidence = [
    { sourceId: 'synth-missing-source-9f2a', quote: 'ab' },
    structuredClone(originalEntry0),
  ];
  const out = await repairAnalysis(
    fakeClientFor(candidate),
    equationsSource,
    { analysis: baseline, report: prevReport, attempt: 1 },
    'test-live',
  );
  const guard = unchangedOf(out.report);
  assert.equal(guard.passed, false);
  assert.equal(guard.path, '/concepts/1/evidence/0/sourceId');
  assert.equal(out.report.publishable, false);
});

test('evidence deletion without a list path is rejected', async () => {
  const baseline: SourceAnalysis = structuredClone(recordedBase);
  baseline.concepts[2]!.evidence[0]!.quote =
    'SYNTH-MARKER-NOT-IN-SOURCE-7c3d This invented sentence is long enough to count as evidence but appears nowhere in the source text.';
  const prevReport = validateAnalysis(baseline, [equationsSource]);
  const q = prevReport.checks.find((c) => c.id === 'grounding.quotes');
  assert.ok(q && !q.passed);
  assert.deepStrictEqual(q.affected, ['/concepts/2/evidence/0/quote']);
  const candidate: SourceAnalysis = structuredClone(baseline);
  candidate.concepts[2]!.evidence = [
    structuredClone(recordedBase.concepts[2]!.evidence[1]!),
    structuredClone(recordedBase.concepts[2]!.evidence[2]!),
  ];
  const out = await repairAnalysis(
    fakeClientFor(candidate),
    equationsSource,
    { analysis: baseline, report: prevReport, attempt: 1 },
    'test-live',
  );
  const guard = unchangedOf(out.report);
  assert.equal(guard.passed, false);
  assert.ok(typeof guard.path === 'string' && guard.path.startsWith('/concepts/2/evidence'));
  assert.equal(out.report.publishable, false);
});

test('reordering concepts after fixing id is rejected', async () => {
  const baseline = badIdBaseline();
  const prevReport = validateAnalysis(baseline, [equationsSource]);
  assert.ok(!prevReport.publishable);
  const candidate: SourceAnalysis = structuredClone(baseline);
  candidate.concepts[0]!.id = 'fixed-concept-id';
  const c1 = candidate.concepts[1]!;
  const c2 = candidate.concepts[2]!;
  candidate.concepts[1] = c2;
  candidate.concepts[2] = c1;
  const out = await repairAnalysis(
    fakeClientFor(candidate),
    equationsSource,
    { analysis: baseline, report: prevReport, attempt: 1 },
    'test-live',
  );
  const guard = unchangedOf(out.report);
  assert.equal(guard.passed, false);
  assert.ok(typeof guard.path === 'string' && guard.path.startsWith('/concepts'));
  assert.equal(out.report.publishable, false);
});

test('unsupportedReason-only unlock: clearing attribution is accepted', async () => {
  const baseline: SourceAnalysis = structuredClone(recordedBase);
  baseline.unsupportedReason = 'According to NASA, none.';
  const prevReport = validateAnalysis(baseline, [equationsSource]);
  const policy = prevReport.checks.find((c) => c.id === 'policy.no-publisher-attribution');
  assert.ok(policy && !policy.passed);
  assert.deepStrictEqual(policy.affected, ['/unsupportedReason']);
  const candidate: SourceAnalysis = structuredClone(baseline);
  candidate.unsupportedReason = '';
  const out = await repairAnalysis(
    fakeClientFor(candidate),
    equationsSource,
    { analysis: baseline, report: prevReport, attempt: 1 },
    'test-live',
  );
  assert.equal(unchangedOf(out.report).passed, true);
  assert.equal(out.report.publishable, true);
});

test('unsupportedReason-only unlock: decision change is rejected', async () => {
  const baseline: SourceAnalysis = structuredClone(recordedBase);
  baseline.unsupportedReason = 'According to NASA, none.';
  const prevReport = validateAnalysis(baseline, [equationsSource]);
  const policy = prevReport.checks.find((c) => c.id === 'policy.no-publisher-attribution');
  assert.ok(policy && !policy.passed);
  assert.deepStrictEqual(policy.affected, ['/unsupportedReason']);
  const candidate = {
    ...structuredClone(baseline),
    supported: false,
    activity: 'none',
    unsupportedReason: '',
  } as unknown as SourceAnalysis;
  const out = await repairAnalysis(
    fakeClientFor(candidate),
    equationsSource,
    { analysis: baseline, report: prevReport, attempt: 1 },
    'test-live',
  );
  const guard = unchangedOf(out.report);
  assert.equal(guard.passed, false);
  assert.ok(guard.path === '/supported' || guard.path === '/activity');
  assert.equal(out.report.publishable, false);
});

test('deleting a policy objective instead of fixing it is rejected', async () => {
  const baseline: SourceAnalysis = structuredClone(recordedBase);
  baseline.concepts[0]!.name = 'NASA concept';
  baseline.objectives[0] = 'According to NASA, learn acceleration.';
  const prevReport = validateAnalysis(baseline, [equationsSource]);
  const policy = prevReport.checks.find((c) => c.id === 'policy.no-publisher-attribution');
  assert.ok(policy && !policy.passed);
  const candidate: SourceAnalysis = structuredClone(baseline);
  candidate.concepts[0]!.name = 'Force and mass';
  candidate.objectives = [baseline.objectives[1]!];
  const out = await repairAnalysis(
    fakeClientFor(candidate),
    equationsSource,
    { analysis: baseline, report: prevReport, attempt: 1 },
    'test-live',
  );
  const guard = unchangedOf(out.report);
  assert.equal(guard.passed, false);
  assert.ok(typeof guard.path === 'string' && guard.path.startsWith('/objectives'));
  assert.equal(out.report.publishable, false);
});

test('adding a concept without a list path is rejected', async () => {
  const baseline = badIdBaseline();
  const prevReport = validateAnalysis(baseline, [equationsSource]);
  assert.ok(!prevReport.publishable);
  const candidate: SourceAnalysis = structuredClone(baseline);
  candidate.concepts[0]!.id = 'fixed-concept-id';
  candidate.concepts.push({
    id: 'extra-valid-concept',
    name: 'Extra concept',
    evidence: [{ sourceId: equationsSource.id, quote: 'F = m * a' }],
  });
  const out = await repairAnalysis(
    fakeClientFor(candidate),
    equationsSource,
    { analysis: baseline, report: prevReport, attempt: 1 },
    'test-live',
  );
  const guard = unchangedOf(out.report);
  assert.equal(guard.passed, false);
  assert.ok(guard.path === '/concepts' || guard.path === '/concepts/3');
  assert.equal(out.report.publishable, false);
});
