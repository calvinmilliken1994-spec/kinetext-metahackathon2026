import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { readFileSync } from 'node:fs';
import { loadSource } from '../sources/index.ts';
import type { ComponentPlanEntry, KitGenByComponent, SourceAnalysisV2 } from '../contracts/kit.ts';
import type { MetaReceipt, SourceDocument, ValidationCheck, ValidationReport } from '../contracts/index.ts';
import { GeneratedOutputError } from './pipeline.ts';
import { analyzeSourceV2, generateKitComponent, repairAnalysisV2, repairKitComponent, GeneratedOutputErrorV2 } from './pipeline-v2.ts';
import type { CompleteRequest, MetaClient } from './client.ts';

const FIXED_MESSAGE = 'The model returned output that does not match the required structure.';

const fakeReceipt: MetaReceipt = {
  purpose: 'test-live',
  requestedModel: 'muse-spark-1.3',
  returnedModel: 'muse-spark-1.3',
  responseId: 'resp_fake_v2_1',
  usage: { promptTokens: 10, completionTokens: 20, reasoningTokens: 5, cachedTokens: 0 },
  latencyMs: 1,
  estCostUSD: 0.0001,
  finishReason: 'stop',
  attempts: 1
};

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL('../../tests/fixtures/stage6/' + name, import.meta.url), 'utf8'));
}

function fakeClientFor(data: unknown, requests: CompleteRequest[]): MetaClient {
  return {
    async complete<U>(req: CompleteRequest): Promise<{ data: U; receipt: MetaReceipt }> {
      requests.push(req);
      return { data: data as U, receipt: fakeReceipt };
    }
  };
}

function payloadBetween(user: string, open: string, close: string): unknown {
  const inner = user.split(open)[1]?.split(close)[0] ?? '';
  return JSON.parse(inner) as unknown;
}

function testSource(): SourceDocument {
  return loadSource('nasa-grc-drag-equation');
}

function usableGolden(): SourceAnalysisV2 {
  return loadFixture('source-analysis-v2.usable.json') as SourceAnalysisV2;
}

function declinedGolden(): SourceAnalysisV2 {
  return loadFixture('source-analysis-v2.declined.json') as SourceAnalysisV2;
}

function quizGolden(): KitGenByComponent['quiz-cards-v1'] {
  return loadFixture('quiz-cards.gen.json') as KitGenByComponent['quiz-cards-v1'];
}

function sequenceGolden(): KitGenByComponent['sequence-v1'] {
  return loadFixture('sequence.gen.json') as KitGenByComponent['sequence-v1'];
}

function quizAnalysisWithPlan(): { analysis: SourceAnalysisV2; plan: ComponentPlanEntry & { componentId: 'quiz-cards-v1' } } {
  const usable = usableGolden();
  const golden = quizGolden();
  const firstQuote = (golden.cards[0] as unknown as { quote: string }).quote;
  const plan: ComponentPlanEntry & { componentId: 'quiz-cards-v1' } = {
    componentId: 'quiz-cards-v1',
    pedagogicalReason: 'Practise the key ideas of this page.',
    focusQuote: firstQuote,
    focusSourceId: 'nasa-grc-drag-equation'
  };
  const analysis: SourceAnalysisV2 = { ...usable, componentPlan: [plan] };
  return { analysis, plan };
}

function analysisRevPair(): { rev1: SourceAnalysisV2; rev2: SourceAnalysisV2 } {
  const rev1 = usableGolden();
  const rev2 = structuredClone(rev1);
  rev2.pageCoverage = rev1.pageCoverage + ' Revised.';
  return { rev1, rev2 };
}

function quizRevPair(): { rev1: KitGenByComponent['quiz-cards-v1']; rev2: KitGenByComponent['quiz-cards-v1'] } {
  const rev1 = quizGolden();
  const rev2 = structuredClone(rev1);
  (rev2.cards[2] as unknown as { stem: string }).stem = 'Which area is used in the drag equation here revised?';
  return { rev1, rev2 };
}

function failingAnalysisReport(): ValidationReport {
  return {
    artifactId: 'source-analysis-v2',
    revision: 1,
    checks: [{ id: 'A-05', kind: 'grounding', passed: false, message: 'bad', affected: ['/overview/headline'] }],
    publishable: false
  };
}

function failingQuizReport(): ValidationReport {
  return {
    artifactId: 'quiz-cards-v1',
    revision: 1,
    checks: [{ id: 'Q-01', kind: 'grounding', passed: false, message: 'bad', affected: ['/cards/0/quote'] }],
    publishable: false
  };
}

function checkModelError(err: unknown, v2Stage: 'analyze-v2' | 'component' | 'component-repair' | 'analysis-v2-repair', v1Stage: 'analyze' | 'specify' | 'repair' | 'analysis-repair'): void {
  assert.ok(err instanceof GeneratedOutputErrorV2);
  assert.ok(err instanceof GeneratedOutputError);
  assert.equal((err as GeneratedOutputError).code, 'OUTPUT_INVALID');
  assert.equal((err as Error).message, FIXED_MESSAGE);
  assert.equal((err as GeneratedOutputError).stage, v1Stage);
  assert.equal((err as GeneratedOutputErrorV2).v2Stage, v2Stage);
  assert.deepEqual((err as GeneratedOutputErrorV2).receipt, fakeReceipt);
}

test('analyzeSourceV2 validate throws after schema-valid output', async () => {
  const source = testSource();
  const usable = usableGolden();
  const requests: CompleteRequest[] = [];
  const validate = (_v: SourceAnalysisV2, _s: SourceDocument[]): ValidationReport => {
    throw new Error('SYNTH-VALIDATE-BOOM');
  };
  let err: unknown;
  try {
    await analyzeSourceV2(fakeClientFor(usable, requests), source, 'test-live', { validate });
  } catch (e) {
    err = e;
  }
  checkModelError(err, 'analyze-v2', 'analyze');
  assert.equal(requests.length, 1);
});

test('generateKitComponent validate throws after schema-valid output', async () => {
  const source = testSource();
  const golden = quizGolden();
  const setup = quizAnalysisWithPlan();
  const requests: CompleteRequest[] = [];
  const validate = (_v: KitGenByComponent['quiz-cards-v1'], _s: SourceDocument[]): ValidationReport => {
    throw new Error('SYNTH-VALIDATE-BOOM');
  };
  let err: unknown;
  try {
    await generateKitComponent(fakeClientFor(golden, requests), source, setup.analysis, setup.plan, 'test-live', { validate });
  } catch (e) {
    err = e;
  }
  checkModelError(err, 'component', 'specify');
  assert.equal(requests.length, 1);
});

test('repairAnalysisV2 candidate validate throws', async () => {
  const source = testSource();
  const pair = analysisRevPair();
  const baselineReport: ValidationReport = {
    artifactId: 'source-analysis-v2',
    revision: 1,
    checks: [{ id: 'A-05', kind: 'grounding', passed: false, message: 'bad', affected: ['/overview/keyPoints/0/point'] }],
    publishable: false
  };
  const validate = (value: SourceAnalysisV2, _s: SourceDocument[]): ValidationReport => {
    if (isDeepStrictEqual(value, pair.rev1)) {
      return baselineReport;
    }
    throw new Error('SYNTH-CANDIDATE-BOOM');
  };
  const prevReport = validate(structuredClone(pair.rev1), [source]);
  const requests: CompleteRequest[] = [];
  let err: unknown;
  try {
    await repairAnalysisV2(fakeClientFor(pair.rev2, requests), source, { analysis: pair.rev1, report: prevReport, attempt: 1 }, 'test-live', { validate });
  } catch (e) {
    err = e;
  }
  checkModelError(err, 'analysis-v2-repair', 'analysis-repair');
  assert.equal(requests.length, 1);
});

test('repairAnalysisV2 candidate missing checks array', async () => {
  const source = testSource();
  const pair = analysisRevPair();
  const baselineReport: ValidationReport = {
    artifactId: 'source-analysis-v2',
    revision: 1,
    checks: [{ id: 'A-05', kind: 'grounding', passed: false, message: 'bad', affected: ['/overview/headline'] }],
    publishable: false
  };
  const validate = (value: SourceAnalysisV2, _s: SourceDocument[]): ValidationReport => {
    if (isDeepStrictEqual(value, pair.rev1)) {
      return baselineReport;
    }
    return { artifactId: 'source-analysis-v2', revision: 1, publishable: false } as unknown as ValidationReport;
  };
  const prevReport = baselineReport;
  const requests: CompleteRequest[] = [];
  let err: unknown;
  try {
    await repairAnalysisV2(fakeClientFor(pair.rev2, requests), source, { analysis: pair.rev1, report: prevReport, attempt: 1 }, 'test-live', { validate });
  } catch (e) {
    err = e;
  }
  checkModelError(err, 'analysis-v2-repair', 'analysis-repair');
  assert.equal(requests.length, 1);
});

test('repairAnalysisV2 compare throws', async () => {
  const source = testSource();
  const pair = analysisRevPair();
  const validate = (_v: SourceAnalysisV2, _s: SourceDocument[]): ValidationReport => {
    return {
      artifactId: 'source-analysis-v2',
      revision: 1,
      checks: [{ id: 'A-03', kind: 'semantic', passed: true, message: 'ok' }],
      publishable: true
    };
  };
  const compare = (_b: SourceAnalysisV2, _c: SourceAnalysisV2, _s: SourceDocument[]): ValidationCheck => {
    throw new Error('SYNTH-COMPARE-BOOM');
  };
  const requests: CompleteRequest[] = [];
  let err: unknown;
  try {
    await repairAnalysisV2(fakeClientFor(pair.rev2, requests), source, { analysis: pair.rev1, report: failingAnalysisReport(), attempt: 1 }, 'test-live', { validate, compare });
  } catch (e) {
    err = e;
  }
  checkModelError(err, 'analysis-v2-repair', 'analysis-repair');
  assert.equal(requests.length, 1);
});

test('repairAnalysisV2 compare appended last controls publishable', async () => {
  const source = testSource();
  const pair = analysisRevPair();
  const validate = (_v: SourceAnalysisV2, _s: SourceDocument[]): ValidationReport => {
    return {
      artifactId: 'source-analysis-v2',
      revision: 1,
      checks: [{ id: 'A-03', kind: 'semantic', passed: true, message: 'ok' }],
      publishable: true
    };
  };
  const failingCompare = (_b: SourceAnalysisV2, _c: SourceAnalysisV2, _s: SourceDocument[]): ValidationCheck => {
    return { id: 'repair.no-weakening', kind: 'semantic', passed: false, message: 'weakened' };
  };
  const passingCompare = (_b: SourceAnalysisV2, _c: SourceAnalysisV2, _s: SourceDocument[]): ValidationCheck => {
    return { id: 'repair.no-weakening', kind: 'semantic', passed: true, message: 'same or better' };
  };
  {
    const requests: CompleteRequest[] = [];
    const out = await repairAnalysisV2(fakeClientFor(pair.rev2, requests), source, { analysis: pair.rev1, report: failingAnalysisReport(), attempt: 1 }, 'test-live', { validate, compare: failingCompare });
    assert.equal(requests.length, 1);
    assert.equal(out.report.checks.length, 2);
    assert.deepEqual(out.report.checks[out.report.checks.length - 1], { id: 'repair.no-weakening', kind: 'semantic', passed: false, message: 'weakened' });
    assert.equal(out.report.publishable, false);
  }
  {
    const requests: CompleteRequest[] = [];
    const out = await repairAnalysisV2(fakeClientFor(pair.rev2, requests), source, { analysis: pair.rev1, report: failingAnalysisReport(), attempt: 1 }, 'test-live', { validate, compare: passingCompare });
    assert.equal(requests.length, 1);
    assert.equal(out.report.checks.length, 2);
    assert.deepEqual(out.report.checks[out.report.checks.length - 1], { id: 'repair.no-weakening', kind: 'semantic', passed: true, message: 'same or better' });
    assert.equal(out.report.publishable, true);
  }
});

test('repairAnalysisV2 baseline validate throws gives empty authorizedPaths', async () => {
  const source = testSource();
  const pair = analysisRevPair();
  const validate = (value: SourceAnalysisV2, _s: SourceDocument[]): ValidationReport => {
    if (isDeepStrictEqual(value, pair.rev1)) {
      throw new Error('SYNTH-BASELINE-BOOM');
    }
    return {
      artifactId: 'source-analysis-v2',
      revision: 1,
      checks: [{ id: 'A-10', kind: 'semantic', passed: false, message: 'bad', affected: ['/overview/headline'] }],
      publishable: false
    };
  };
  const requests: CompleteRequest[] = [];
  const out = await repairAnalysisV2(fakeClientFor(pair.rev2, requests), source, { analysis: pair.rev1, report: failingAnalysisReport(), attempt: 1 }, 'test-live', { validate });
  assert.equal(requests.length, 1);
  assert.deepEqual(out.authorizedPaths, []);
  const req = requests[0] as CompleteRequest;
  const user = req.messages[1]?.content ?? '';
  const payload = payloadBetween(user, '<untrusted-analysis-repair-data>', '</untrusted-analysis-repair-data>') as Record<string, unknown>;
  assert.deepEqual(payload['authorizedPaths'], []);
});

test('repairAnalysisV2 baseline non-array checks gives empty authorizedPaths', async () => {
  const source = testSource();
  const pair = analysisRevPair();
  const validate = (value: SourceAnalysisV2, _s: SourceDocument[]): ValidationReport => {
    if (isDeepStrictEqual(value, pair.rev1)) {
      return { artifactId: 'source-analysis-v2', revision: 1, checks: 'nope', publishable: false } as unknown as ValidationReport;
    }
    return {
      artifactId: 'source-analysis-v2',
      revision: 1,
      checks: [{ id: 'A-10', kind: 'semantic', passed: false, message: 'bad', affected: ['/overview/headline'] }],
      publishable: false
    };
  };
  const requests: CompleteRequest[] = [];
  const out = await repairAnalysisV2(fakeClientFor(pair.rev2, requests), source, { analysis: pair.rev1, report: failingAnalysisReport(), attempt: 1 }, 'test-live', { validate });
  assert.equal(requests.length, 1);
  assert.deepEqual(out.authorizedPaths, []);
});

test('repairAnalysisV2 signal forwarded and absent', async () => {
  const source = testSource();
  const pair = analysisRevPair();
  const validate = (_v: SourceAnalysisV2, _s: SourceDocument[]): ValidationReport => {
    return {
      artifactId: 'source-analysis-v2',
      revision: 1,
      checks: [{ id: 'A-05', kind: 'grounding', passed: false, message: 'bad', affected: ['/overview/headline'] }],
      publishable: false
    };
  };
  {
    const requests: CompleteRequest[] = [];
    const controller = new AbortController();
    await repairAnalysisV2(fakeClientFor(pair.rev2, requests), source, { analysis: pair.rev1, report: failingAnalysisReport(), attempt: 1 }, 'test-live', { validate, signal: controller.signal });
    assert.equal(requests.length, 1);
    assert.strictEqual((requests[0] as CompleteRequest).signal, controller.signal);
  }
  {
    const requests: CompleteRequest[] = [];
    await repairAnalysisV2(fakeClientFor(pair.rev2, requests), source, { analysis: pair.rev1, report: failingAnalysisReport(), attempt: 1 }, 'test-live', { validate });
    assert.equal(requests.length, 1);
    assert.equal('signal' in (requests[0] as CompleteRequest), false);
  }
});

test('repairKitComponent candidate missing checks array', async () => {
  const source = testSource();
  const setup = quizAnalysisWithPlan();
  const pair = quizRevPair();
  const baselineReport: ValidationReport = {
    artifactId: 'quiz-cards-v1',
    revision: 1,
    checks: [{ id: 'Q-01', kind: 'grounding', passed: false, message: 'bad', affected: ['/cards/0/quote'] }],
    publishable: false
  };
  const validate = (value: KitGenByComponent['quiz-cards-v1'], _s: SourceDocument[]): ValidationReport => {
    if (isDeepStrictEqual(value, pair.rev1)) {
      return baselineReport;
    }
    return { artifactId: 'quiz-cards-v1', revision: 1, publishable: false } as unknown as ValidationReport;
  };
  const requests: CompleteRequest[] = [];
  let err: unknown;
  try {
    await repairKitComponent(fakeClientFor(pair.rev2, requests), source, setup.analysis, setup.plan, { gen: pair.rev1, report: baselineReport, attempt: 1 }, 'test-live', { validate });
  } catch (e) {
    err = e;
  }
  checkModelError(err, 'component-repair', 'repair');
  assert.equal(requests.length, 1);
});

test('repairKitComponent compare throws', async () => {
  const source = testSource();
  const setup = quizAnalysisWithPlan();
  const pair = quizRevPair();
  const validate = (_v: KitGenByComponent['quiz-cards-v1'], _s: SourceDocument[]): ValidationReport => {
    return {
      artifactId: 'quiz-cards-v1',
      revision: 1,
      checks: [{ id: 'Q-02', kind: 'grounding', passed: true, message: 'ok' }],
      publishable: true
    };
  };
  const compare = (_b: KitGenByComponent['quiz-cards-v1'], _c: KitGenByComponent['quiz-cards-v1'], _s: SourceDocument[]): ValidationCheck => {
    throw new Error('SYNTH-COMPARE-BOOM');
  };
  const requests: CompleteRequest[] = [];
  let err: unknown;
  try {
    await repairKitComponent(fakeClientFor(pair.rev2, requests), source, setup.analysis, setup.plan, { gen: pair.rev1, report: failingQuizReport(), attempt: 1 }, 'test-live', { validate, compare });
  } catch (e) {
    err = e;
  }
  checkModelError(err, 'component-repair', 'repair');
  assert.equal(requests.length, 1);
});

test('repairKitComponent baseline COMPONENT_MISMATCH with sequence golden', async () => {
  const source = testSource();
  const setup = quizAnalysisWithPlan();
  const quiz = quizGolden();
  const seq = sequenceGolden();
  const validate = (_v: never, _s: SourceDocument[]): ValidationReport => failingQuizReport();
  const requests: CompleteRequest[] = [];
  await assert.rejects(
    repairKitComponent(
      fakeClientFor(quiz, requests),
      source,
      setup.analysis,
      setup.plan,
      { gen: quiz as never, report: failingQuizReport(), attempt: 2, baseline: { gen: seq as unknown as never } },
      'test-live',
      { validate: validate as never }
    ),
    /COMPONENT_MISMATCH/
  );
  assert.equal(requests.length, 0);
});

test('repairKitComponent guard order and codes', async () => {
  const source = testSource();
  const setup = quizAnalysisWithPlan();
  const pair = quizRevPair();
  const validate = (_v: never, _s: SourceDocument[]): ValidationReport => failingQuizReport();
  {
    const requests: CompleteRequest[] = [];
    const declined = declinedGolden();
    await assert.rejects(
      repairKitComponent(fakeClientFor(pair.rev2, requests), source, declined, setup.plan, { gen: pair.rev1, report: failingQuizReport(), attempt: 1 }, 'test-live', { validate: validate as never }),
      /ANALYSIS_DECLINED/
    );
    assert.equal(requests.length, 0);
  }
  {
    const requests: CompleteRequest[] = [];
    const usable = usableGolden();
    const forcesPlan = {
      componentId: 'forces-1d-v1',
      pedagogicalReason: 'Practise the key ideas of this page.',
      focusQuote: 'drag D is equal to the drag coefficient Cd times the density rho',
      focusSourceId: 'nasa-grc-drag-equation'
    } as unknown as ComponentPlanEntry;
    const forcesAnalysis: SourceAnalysisV2 = { ...usable, componentPlan: [forcesPlan] };
    await assert.rejects(
      repairKitComponent(fakeClientFor(pair.rev2, requests), source, forcesAnalysis, forcesPlan as never, { gen: pair.rev1, report: failingQuizReport(), attempt: 1 } as never, 'test-live', { validate: validate as never }),
      /KIT_COMPONENT_REQUIRED/
    );
    assert.equal(requests.length, 0);
  }
  {
    const requests: CompleteRequest[] = [];
    const otherPlan: ComponentPlanEntry & { componentId: 'quiz-cards-v1' } = {
      componentId: 'quiz-cards-v1',
      pedagogicalReason: 'Practise the key ideas of this page.',
      focusQuote: 'SYNTH-NOT-IN-PLAN-QUOTE',
      focusSourceId: 'nasa-grc-drag-equation'
    };
    await assert.rejects(
      repairKitComponent(fakeClientFor(pair.rev2, requests), source, setup.analysis, otherPlan, { gen: pair.rev1, report: failingQuizReport(), attempt: 1 }, 'test-live', { validate: validate as never }),
      /PLAN_ENTRY_NOT_IN_ANALYSIS/
    );
    assert.equal(requests.length, 0);
  }
  {
    const requests: CompleteRequest[] = [];
    await assert.rejects(
      repairKitComponent(fakeClientFor(pair.rev2, requests), source, setup.analysis, setup.plan, { gen: pair.rev1, report: failingQuizReport(), attempt: 1 }, 'test-live', { validate: validate as never, maxOutputTokens: 24001 }),
      /MAX_OUTPUT_TOKENS_INVALID/
    );
    assert.equal(requests.length, 0);
  }
});

test('repairKitComponent signal forwarded and absent', async () => {
  const source = testSource();
  const setup = quizAnalysisWithPlan();
  const pair = quizRevPair();
  const validate = (_v: KitGenByComponent['quiz-cards-v1'], _s: SourceDocument[]): ValidationReport => {
    return {
      artifactId: 'quiz-cards-v1',
      revision: 1,
      checks: [{ id: 'Q-01', kind: 'grounding', passed: false, message: 'bad', affected: ['/cards/0/quote'] }],
      publishable: false
    };
  };
  {
    const requests: CompleteRequest[] = [];
    const controller = new AbortController();
    await repairKitComponent(fakeClientFor(pair.rev2, requests), source, setup.analysis, setup.plan, { gen: pair.rev1, report: failingQuizReport(), attempt: 1 }, 'test-live', { validate, signal: controller.signal });
    assert.equal(requests.length, 1);
    assert.strictEqual((requests[0] as CompleteRequest).signal, controller.signal);
  }
  {
    const requests: CompleteRequest[] = [];
    await repairKitComponent(fakeClientFor(pair.rev2, requests), source, setup.analysis, setup.plan, { gen: pair.rev1, report: failingQuizReport(), attempt: 1 }, 'test-live', { validate });
    assert.equal(requests.length, 1);
    assert.equal('signal' in (requests[0] as CompleteRequest), false);
  }
});

test('repairKitComponent duplicate affected paths deduped', async () => {
  const source = testSource();
  const setup = quizAnalysisWithPlan();
  const pair = quizRevPair();
  const dupReport: ValidationReport = {
    artifactId: 'quiz-cards-v1',
    revision: 1,
    checks: [
      { id: 'Q-01', kind: 'grounding', passed: false, message: 'bad', affected: ['/cards/1/quote', '', '/cards/1/quote', '/cards/0/quote'] },
      { id: 'Q-02', kind: 'grounding', passed: false, message: 'bad2', affected: ['/cards/1/quote', '/cards/2/stem'] }
    ],
    publishable: false
  };
  const validate = (value: KitGenByComponent['quiz-cards-v1'], _s: SourceDocument[]): ValidationReport => {
    if (isDeepStrictEqual(value, pair.rev1)) {
      return dupReport;
    }
    return {
      artifactId: 'quiz-cards-v1',
      revision: 1,
      checks: [{ id: 'Q-02', kind: 'grounding', passed: true, message: 'ok' }],
      publishable: true
    };
  };
  const requests: CompleteRequest[] = [];
  const out = await repairKitComponent(fakeClientFor(pair.rev2, requests), source, setup.analysis, setup.plan, { gen: pair.rev1, report: dupReport, attempt: 1 }, 'test-live', { validate });
  assert.equal(requests.length, 1);
  assert.deepEqual(out.authorizedPaths, ['/cards/1/quote', '/cards/0/quote', '/cards/2/stem']);
  const req = requests[0] as CompleteRequest;
  const user = req.messages[1]?.content ?? '';
  const payload = payloadBetween(user, '<untrusted-component-repair-data>', '</untrusted-component-repair-data>') as Record<string, unknown>;
  assert.deepEqual(payload['authorizedPaths'], ['/cards/1/quote', '/cards/0/quote', '/cards/2/stem']);
});

test('findings payload omits passing and exact keys without path', async () => {
  const source = testSource();
  const pair = analysisRevPair();
  const validate = (_v: SourceAnalysisV2, _s: SourceDocument[]): ValidationReport => {
    return {
      artifactId: 'source-analysis-v2',
      revision: 1,
      checks: [{ id: 'A-03', kind: 'semantic', passed: true, message: 'ok' }],
      publishable: true
    };
  };
  const prevReport: ValidationReport = {
    artifactId: 'source-analysis-v2',
    revision: 1,
    checks: [
      { id: 'A-03', kind: 'semantic', passed: true, message: 'ok' },
      { id: 'A-09', kind: 'semantic', passed: false, message: 'SYNTH-FAIL-NOPATH' }
    ],
    publishable: false
  };
  const requests: CompleteRequest[] = [];
  await repairAnalysisV2(fakeClientFor(pair.rev2, requests), source, { analysis: pair.rev1, report: prevReport, attempt: 1 }, 'test-live', { validate });
  assert.equal(requests.length, 1);
  const req = requests[0] as CompleteRequest;
  const user = req.messages[1]?.content ?? '';
  const payload = payloadBetween(user, '<untrusted-analysis-repair-data>', '</untrusted-analysis-repair-data>') as Record<string, unknown>;
  const findings = payload['findings'] as Array<Record<string, unknown>>;
  assert.equal(findings.length, 1);
  assert.deepEqual(findings[0], { id: 'A-09', kind: 'semantic', message: 'SYNTH-FAIL-NOPATH' });
  assert.deepEqual(Object.keys(findings[0] as Record<string, unknown>).sort(), ['id', 'kind', 'message']);
  assert.equal('path' in (findings[0] as Record<string, unknown>), false);
  assert.equal('affected' in (findings[0] as Record<string, unknown>), false);
});

test('GeneratedOutputErrorV2 direct construction for four stages', async () => {
  const stages = ['analyze-v2', 'component', 'component-repair', 'analysis-v2-repair'] as const;
  const expectedV1 = {
    'analyze-v2': 'analyze',
    'component': 'specify',
    'component-repair': 'repair',
    'analysis-v2-repair': 'analysis-repair'
  } as const;
  for (const s of stages) {
    const err = new GeneratedOutputErrorV2(s, fakeReceipt);
    assert.equal(err.name, 'GeneratedOutputError');
    assert.equal(err.message, FIXED_MESSAGE);
    assert.equal(err.code, 'OUTPUT_INVALID');
    assert.equal(err.stage, expectedV1[s]);
    assert.equal(err.v2Stage, s);
    assert.strictEqual(err.receipt, fakeReceipt);
    assert.ok(err instanceof GeneratedOutputError);
    assert.ok(err instanceof GeneratedOutputErrorV2);
  }
});
