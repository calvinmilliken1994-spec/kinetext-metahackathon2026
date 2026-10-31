import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { loadSource } from '../sources/index.ts';
import { kitGenSchemaFor, sourceAnalysisV2GenSchema } from '../contracts/schemas.ts';
import { KIT_GEN_COMPONENT_IDS } from '../contracts/kit.ts';
import type { ComponentPlanEntry, KitGenByComponent, KitGenComponentId, SourceAnalysisV2 } from '../contracts/kit.ts';
import type { MetaReceipt, RepairFinding, SourceDocument, ValidationCheck, ValidationReport } from '../contracts/index.ts';
import {
  ANALYSIS_V2_REPAIR_SCHEMA_NAME,
  ANALYSIS_V2_SCHEMA_NAME,
  KIT_REPAIR_SCHEMA_NAMES,
  KIT_SCHEMA_NAMES,
  buildAnalysisV2Messages,
  buildKitComponentMessages
} from './prompts-v2.ts';
import { GeneratedOutputError, analyzeSource } from './pipeline.ts';
import {
  ANALYSIS_V2_MAX_OUTPUT_TOKENS,
  KIT_CALL_MAX_OUTPUT_TOKENS,
  GeneratedOutputErrorV2,
  analyzeSourceV2,
  generateKitComponent,
  repairAnalysisV2,
  repairKitComponent
} from './pipeline-v2.ts';
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
  return JSON.parse(readFileSync(new URL(`../../tests/fixtures/stage6/${name}`, import.meta.url), 'utf8'));
}

function fakeClientFor(data: unknown, requests: CompleteRequest[]): MetaClient {
  return {
    async complete<U>(req: CompleteRequest): Promise<{ data: U; receipt: MetaReceipt }> {
      requests.push(req);
      return { data: data as U, receipt: fakeReceipt };
    }
  };
}

function queuedClient(queue: unknown[], requests: CompleteRequest[]): MetaClient {
  let i = 0;
  return {
    async complete<U>(req: CompleteRequest): Promise<{ data: U; receipt: MetaReceipt }> {
      requests.push(req);
      const data = queue[Math.min(i, queue.length - 1)] as U;
      i += 1;
      return { data, receipt: fakeReceipt };
    }
  };
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    if (Array.isArray(value)) {
      for (const entry of value as unknown[]) {
        deepFreeze(entry);
      }
    } else {
      for (const key of Object.keys(value as Record<string, unknown>)) {
        deepFreeze((value as Record<string, unknown>)[key]);
      }
    }
    Object.freeze(value);
  }
  return value;
}

function balanceSourceDoc(): SourceDocument {
  const text = readFileSync(new URL('../../tests/fixtures/stage6/balance.synthetic-source.txt', import.meta.url), 'utf8');
  return {
    id: 'synthetic-balance',
    title: 'Synthetic balance source',
    locator: 'tests/fixtures/stage6/balance.synthetic-source.txt',
    license: 'project-authored synthetic',
    attribution: 'Project-authored synthetic text',
    sha256: createHash('sha256').update(text, 'utf8').digest('hex'),
    text
  };
}

function firstQuoteFor(componentId: KitGenComponentId, gen: unknown): string {
  const g = gen as Record<string, unknown>;
  if (typeof g['quote'] === 'string' && (g['quote'] as string).length > 0) {
    return g['quote'] as string;
  }
  for (const key of ['cards', 'steps', 'items', 'links', 'cells', 'stages', 'rungs', 'columns'] as const) {
    const arr = g[key] as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(arr) && typeof arr[0]?.['quote'] === 'string') {
      return arr[0]?.['quote'] as string;
    }
  }
  const rows = g['rows'] as Array<{ values?: Array<Record<string, unknown>> }> | undefined;
  if (Array.isArray(rows) && typeof rows[0]?.values?.[0]?.['quote'] === 'string') {
    return rows[0]?.values?.[0]?.['quote'] as string;
  }
  throw new Error(`no quote for ${componentId}`);
}

function sourceForComponent(componentId: KitGenComponentId): SourceDocument {
  if (componentId === 'sequence-v1') return loadSource('nara-constitution');
  if (componentId === 'sort-groups-v1') return loadSource('nij-heterozygosity');
  if (componentId === 'compare-table-v1') return loadSource('nasa-grc-earth-atmosphere-equation-english');
  if (componentId === 'balance-equation-v1') return balanceSourceDoc();
  if (componentId === 'algorithm-trace-v1') return loadSource('nist-dads-binary-search');
  if (componentId === 'log-ladder-v1') return loadSource('usgs-earthquake-magnitude-energy-intensity');
  if (componentId === 'threshold-v1') return loadSource('nara-constitutional-amendment-process');
  if (componentId === 'data-table-v1') return loadSource('nasa-nssdc-planetary-fact-sheet-metric');
  return loadSource('nasa-grc-drag-equation');
}

function fixtureFor(componentId: KitGenComponentId): unknown {
  if (componentId === 'quiz-cards-v1') return loadFixture('quiz-cards.gen.json');
  if (componentId === 'sequence-v1') return loadFixture('sequence.gen.json');
  if (componentId === 'sort-groups-v1') return loadFixture('sort-groups.gen.json');
  if (componentId === 'concept-map-v1') return loadFixture('concept-map.gen.json');
  if (componentId === 'algorithm-trace-v1') return loadFixture('algorithm-trace.gen.json');
  if (componentId === 'log-ladder-v1') return loadFixture('log-ladder.gen.json');
  if (componentId === 'threshold-v1') return loadFixture('threshold.gen.json');
  if (componentId === 'data-table-v1') return loadFixture('data-table.gen.json');
  if (componentId === 'compare-table-v1') return loadFixture('compare-table.gen.json');
  if (componentId === 'formula-explorer-v1') return loadFixture('formula-explorer.gen.json');
  return loadFixture('balance-equation.gen.json');
}

function sourceIdFor(componentId: KitGenComponentId): string {
  if (componentId === 'sequence-v1') return 'nara-constitution';
  if (componentId === 'sort-groups-v1') return 'nij-heterozygosity';
  if (componentId === 'compare-table-v1') return 'nasa-grc-earth-atmosphere-equation-english';
  if (componentId === 'balance-equation-v1') return 'synthetic-balance';
  if (componentId === 'algorithm-trace-v1') return 'nist-dads-binary-search';
  if (componentId === 'log-ladder-v1') return 'usgs-earthquake-magnitude-energy-intensity';
  if (componentId === 'threshold-v1') return 'nara-constitutional-amendment-process';
  if (componentId === 'data-table-v1') return 'nasa-nssdc-planetary-fact-sheet-metric';
  return 'nasa-grc-drag-equation';
}

function planEntryFor(componentId: KitGenComponentId, golden: unknown, usable: SourceAnalysisV2): ComponentPlanEntry & { componentId: KitGenComponentId } {
  void usable;
  return {
    componentId,
    pedagogicalReason: 'Practise the key ideas of this page.',
    focusQuote: firstQuoteFor(componentId, golden),
    focusSourceId: sourceIdFor(componentId)
  };
}

function analysisFor(componentId: KitGenComponentId, golden: unknown): SourceAnalysisV2 {
  const usable = loadFixture('source-analysis-v2.usable.json') as SourceAnalysisV2;
  const entry = planEntryFor(componentId, golden, usable);
  if (componentId === 'balance-equation-v1') {
    return { ...usable, subject: 'chemistry', componentPlan: [entry] };
  }
  return { ...usable, componentPlan: [entry] };
}

function payloadBetween(user: string, open: string, close: string): unknown {
  const inner = user.split(open)[1]?.split(close)[0] ?? '';
  return JSON.parse(inner) as unknown;
}

test('analyzeSourceV2 happy path usable and declined', async () => {
  assert.equal(ANALYSIS_V2_MAX_OUTPUT_TOKENS, 32000);
  const usable = loadFixture('source-analysis-v2.usable.json') as SourceAnalysisV2;
  const declined = loadFixture('source-analysis-v2.declined.json') as SourceAnalysisV2;
  const source = loadSource('nasa-grc-drag-equation');
  for (const golden of [usable, declined]) {
    const requests: CompleteRequest[] = [];
    const out = await analyzeSourceV2(fakeClientFor(golden, requests), source, 'test-live');
    assert.equal(requests.length, 1);
    const req = requests[0] as CompleteRequest;
    assert.equal(req.schemaName, 'source_analysis_v2');
    assert.equal(req.schemaName, ANALYSIS_V2_SCHEMA_NAME);
    assert.equal(req.jsonSchema === sourceAnalysisV2GenSchema, true);
    assert.equal(req.maxOutputTokens, 32000);
    assert.deepEqual(req.messages, buildAnalysisV2Messages(source));
    assert.equal(req.purpose, 'test-live');
    assert.equal('signal' in req, false);
    assert.deepEqual(out.analysis, golden);
    assert.equal('report' in out, false);
    assert.deepEqual(out.receipt, fakeReceipt);
  }
  {
    const requests: CompleteRequest[] = [];
    const controller = new AbortController();
    const out = await analyzeSourceV2(fakeClientFor(usable, requests), source, 'demo', { signal: controller.signal });
    assert.equal((requests[0] as CompleteRequest).signal, controller.signal);
    assert.equal((requests[0] as CompleteRequest).purpose, 'demo');
    assert.deepEqual(out.analysis, usable);
  }
  {
    const requests: CompleteRequest[] = [];
    const validatorReport: ValidationReport = {
      artifactId: 'source-analysis-v2',
      revision: 1,
      checks: [{ id: 'A-03', kind: 'semantic', passed: true, message: 'ok' }],
      publishable: true
    };
    const out = await analyzeSourceV2(fakeClientFor(usable, requests), source, 'test-live', {
      validate: (value: SourceAnalysisV2, _sources: SourceDocument[]): ValidationReport => {
        (value as unknown as Record<string, unknown>)['subject'] = 'MUTATED';
        return validatorReport;
      }
    });
    assert.deepEqual(out.analysis, usable);
    assert.deepEqual(out.report, validatorReport);
  }
});

test('maxOutputTokens guards', async () => {
  const usable = loadFixture('source-analysis-v2.usable.json') as SourceAnalysisV2;
  const source = loadSource('nasa-grc-drag-equation');
  {
    const requests: CompleteRequest[] = [];
    const out = await analyzeSourceV2(fakeClientFor(usable, requests), source, 'test-live', { maxOutputTokens: 8000 });
    assert.equal((requests[0] as CompleteRequest).maxOutputTokens, 8000);
    assert.deepEqual(out.analysis, usable);
  }
  for (const bad of [32001, 0, 1.5]) {
    const requests: CompleteRequest[] = [];
    await assert.rejects(
      analyzeSourceV2(fakeClientFor(usable, requests), source, 'test-live', { maxOutputTokens: bad }),
      /MAX_OUTPUT_TOKENS_INVALID/
    );
    assert.equal(requests.length, 0);
  }
  const quizGolden = loadFixture('quiz-cards.gen.json');
  const analysis = analysisFor('quiz-cards-v1', quizGolden);
  const plan = planEntryFor('quiz-cards-v1', quizGolden, analysis);
  for (const bad of [24001, 0, 2.5]) {
    const requests: CompleteRequest[] = [];
    await assert.rejects(
      generateKitComponent(fakeClientFor(quizGolden, requests), source, analysis, plan, 'test-live', { maxOutputTokens: bad }),
      /MAX_OUTPUT_TOKENS_INVALID/
    );
    assert.equal(requests.length, 0);
  }
  {
    const failing: ValidationReport = {
      artifactId: 'quiz-cards-v1',
      revision: 1,
      checks: [{ id: 'Q-01', kind: 'grounding', passed: false, message: 'bad', affected: ['/cards/0/quote'] }],
      publishable: false
    };
    const validate = (_v: unknown, _s: SourceDocument[]): ValidationReport => failing;
    const prev = { gen: quizGolden as KitGenByComponent['quiz-cards-v1'], report: failing, attempt: 1 };
    const requests: CompleteRequest[] = [];
    await assert.rejects(
      repairKitComponent(
        fakeClientFor(quizGolden, requests),
        source,
        analysis,
        plan,
        prev,
        'test-live',
        { maxOutputTokens: 24001, validate: validate as never }
      ),
      /MAX_OUTPUT_TOKENS_INVALID/
    );
    assert.equal(requests.length, 0);
  }
});

test('raised output caps: cap accepted, cap+1 rejected before client call', async () => {
  assert.equal(ANALYSIS_V2_MAX_OUTPUT_TOKENS, 32000);
  assert.equal(KIT_CALL_MAX_OUTPUT_TOKENS, 24000);
  const usable = loadFixture('source-analysis-v2.usable.json') as SourceAnalysisV2;
  const source = loadSource('nasa-grc-drag-equation');
  {
    const requests: CompleteRequest[] = [];
    const out = await analyzeSourceV2(fakeClientFor(usable, requests), source, 'test-live', { maxOutputTokens: 32000 });
    assert.equal((requests[0] as CompleteRequest).maxOutputTokens, 32000);
    assert.deepEqual(out.analysis, usable);
  }
  {
    const requests: CompleteRequest[] = [];
    await assert.rejects(
      analyzeSourceV2(fakeClientFor(usable, requests), source, 'test-live', { maxOutputTokens: 32001 }),
      /MAX_OUTPUT_TOKENS_INVALID/
    );
    assert.equal(requests.length, 0);
  }
  const quizGolden = loadFixture('quiz-cards.gen.json');
  const analysis = analysisFor('quiz-cards-v1', quizGolden);
  const plan = planEntryFor('quiz-cards-v1', quizGolden, analysis);
  {
    const requests: CompleteRequest[] = [];
    const out = await generateKitComponent(fakeClientFor(quizGolden, requests), source, analysis, plan as never, 'test-live', { maxOutputTokens: 24000 });
    assert.equal((requests[0] as CompleteRequest).maxOutputTokens, 24000);
    assert.deepEqual(out.gen, quizGolden);
  }
  {
    const requests: CompleteRequest[] = [];
    await assert.rejects(
      generateKitComponent(fakeClientFor(quizGolden, requests), source, analysis, plan as never, 'test-live', { maxOutputTokens: 24001 }),
      /MAX_OUTPUT_TOKENS_INVALID/
    );
    assert.equal(requests.length, 0);
  }
  {
    const failing: ValidationReport = {
      artifactId: 'quiz-cards-v1',
      revision: 1,
      checks: [{ id: 'Q-01', kind: 'grounding', passed: false, message: 'bad', affected: ['/cards/0/quote'] }],
      publishable: false
    };
    const validate = (_v: unknown, _s: SourceDocument[]): ValidationReport => failing;
    const prev = { gen: quizGolden as KitGenByComponent['quiz-cards-v1'], report: failing, attempt: 1 };
    const okRequests: CompleteRequest[] = [];
    const out = await repairKitComponent(
      fakeClientFor(quizGolden, okRequests),
      source,
      analysis,
      plan as never,
      prev,
      'test-live',
      { maxOutputTokens: 24000, validate: validate as never }
    );
    assert.equal((okRequests[0] as CompleteRequest).maxOutputTokens, 24000);
    assert.equal(out.report.revision, 2);
    const badRequests: CompleteRequest[] = [];
    await assert.rejects(
      repairKitComponent(
        fakeClientFor(quizGolden, badRequests),
        source,
        analysis,
        plan as never,
        prev,
        'test-live',
        { maxOutputTokens: 24001, validate: validate as never }
      ),
      /MAX_OUTPUT_TOKENS_INVALID/
    );
    assert.equal(badRequests.length, 0);
  }
  {
    const failingAnalysis: ValidationReport = {
      artifactId: 'source-analysis-v2',
      revision: 1,
      checks: [{ id: 'A-05', kind: 'grounding', passed: false, message: 'bad', affected: ['/overview/headline'] }],
      publishable: false
    };
    const validate = (_v: unknown, _s: SourceDocument[]): ValidationReport => failingAnalysis;
    const prev = { analysis: usable, report: failingAnalysis, attempt: 1 };
    const okRequests: CompleteRequest[] = [];
    const out = await repairAnalysisV2(
      fakeClientFor(usable, okRequests),
      source,
      prev,
      'test-live',
      { maxOutputTokens: 24000, validate: validate as never }
    );
    assert.equal((okRequests[0] as CompleteRequest).maxOutputTokens, 24000);
    assert.equal(out.report.revision, 2);
    const badRequests: CompleteRequest[] = [];
    await assert.rejects(
      repairAnalysisV2(
        fakeClientFor(usable, badRequests),
        source,
        prev,
        'test-live',
        { maxOutputTokens: 24001, validate: validate as never }
      ),
      /MAX_OUTPUT_TOKENS_INVALID/
    );
    assert.equal(badRequests.length, 0);
  }
});

test('malformed output for every function', async () => {
  const usable = loadFixture('source-analysis-v2.usable.json') as SourceAnalysisV2;
  const source = loadSource('nasa-grc-drag-equation');
  const quizGolden = loadFixture('quiz-cards.gen.json');
  const quizAnalysis = analysisFor('quiz-cards-v1', quizGolden);
  const quizPlan = planEntryFor('quiz-cards-v1', quizGolden, quizAnalysis);
  const sequenceGolden = loadFixture('sequence.gen.json');
  const withoutKeyAnalysis = { ...usable } as Record<string, unknown>;
  delete withoutKeyAnalysis['subject'];
  const extraKeyAnalysis = { ...(usable as unknown as Record<string, unknown>), extraKeyForTest: 1 };
  const analysisBads: unknown[] = [withoutKeyAnalysis, extraKeyAnalysis, [], null, 'oops'];
  for (const bad of analysisBads) {
    const requests: CompleteRequest[] = [];
    let err: unknown;
    try {
      await analyzeSourceV2(fakeClientFor(bad, requests), source, 'test-live');
    } catch (e) {
      err = e;
    }
    assert.ok(err instanceof GeneratedOutputError);
    assert.ok(err instanceof GeneratedOutputErrorV2);
    assert.equal((err as GeneratedOutputError).code, 'OUTPUT_INVALID');
    assert.equal((err as Error).message, FIXED_MESSAGE);
    assert.equal((err as GeneratedOutputError).stage, 'analyze');
    assert.equal((err as GeneratedOutputErrorV2).v2Stage, 'analyze-v2');
    assert.deepEqual((err as GeneratedOutputErrorV2).receipt, fakeReceipt);
  }
  const quizWithout = { ...(quizGolden as Record<string, unknown>) } as Record<string, unknown>;
  delete quizWithout['cards'];
  const quizExtra = { ...(quizGolden as Record<string, unknown>), extraKeyForTest: 1 };
  const componentBads: unknown[] = [quizWithout, quizExtra, [], null, 'oops', sequenceGolden];
  for (const bad of componentBads) {
    const requests: CompleteRequest[] = [];
    let err: unknown;
    try {
      await generateKitComponent(fakeClientFor(bad, requests), source, quizAnalysis, quizPlan, 'test-live');
    } catch (e) {
      err = e;
    }
    assert.ok(err instanceof GeneratedOutputError);
    assert.ok(err instanceof GeneratedOutputErrorV2);
    assert.equal((err as GeneratedOutputError).code, 'OUTPUT_INVALID');
    assert.equal((err as Error).message, FIXED_MESSAGE);
    assert.equal((err as GeneratedOutputError).stage, 'specify');
    assert.equal((err as GeneratedOutputErrorV2).v2Stage, 'component');
    assert.deepEqual((err as GeneratedOutputErrorV2).receipt, fakeReceipt);
  }
  const failingQuiz: ValidationReport = {
    artifactId: 'quiz-cards-v1',
    revision: 1,
    checks: [{ id: 'Q-01', kind: 'grounding', passed: false, message: 'bad', affected: ['/cards/0/quote'] }],
    publishable: false
  };
  const quizValidate = (_v: never, _s: SourceDocument[]): ValidationReport => failingQuiz;
  for (const bad of componentBads) {
    const requests: CompleteRequest[] = [];
    let err: unknown;
    try {
      await repairKitComponent(
        fakeClientFor(bad, requests),
        source,
        quizAnalysis,
        quizPlan,
        { gen: quizGolden as never, report: failingQuiz, attempt: 1 },
        'test-live',
        { validate: quizValidate as never }
      );
    } catch (e) {
      err = e;
    }
    assert.ok(err instanceof GeneratedOutputErrorV2);
    assert.equal((err as GeneratedOutputErrorV2).v2Stage, 'component-repair');
    assert.equal((err as GeneratedOutputError).stage, 'repair');
    assert.deepEqual((err as GeneratedOutputErrorV2).receipt, fakeReceipt);
  }
  const failingAnalysis: ValidationReport = {
    artifactId: 'source-analysis-v2',
    revision: 1,
    checks: [{ id: 'A-05', kind: 'grounding', passed: false, message: 'bad', affected: ['/overview/headline'] }],
    publishable: false
  };
  const analysisValidate = (_v: never, _s: SourceDocument[]): ValidationReport => failingAnalysis;
  for (const bad of analysisBads) {
    const requests: CompleteRequest[] = [];
    let err: unknown;
    try {
      await repairAnalysisV2(
        fakeClientFor(bad, requests),
        source,
        { analysis: usable, report: failingAnalysis, attempt: 1 },
        'test-live',
        { validate: analysisValidate as never }
      );
    } catch (e) {
      err = e;
    }
    assert.ok(err instanceof GeneratedOutputErrorV2);
    assert.equal((err as GeneratedOutputErrorV2).v2Stage, 'analysis-v2-repair');
    assert.equal((err as GeneratedOutputError).stage, 'analysis-repair');
    assert.deepEqual((err as GeneratedOutputErrorV2).receipt, fakeReceipt);
  }
});

test('generateKitComponent for every component', async () => {
  const usable = loadFixture('source-analysis-v2.usable.json') as SourceAnalysisV2;
  // label-diagram-v1 needs the figure image; covered by pipeline-v2.label.test.ts (Stage 8b).
  for (const c of KIT_GEN_COMPONENT_IDS.filter((id) => id !== 'label-diagram-v1')) {
    const golden = fixtureFor(c);
    const src = sourceForComponent(c);
    const analysis = analysisFor(c, golden);
    const plan = planEntryFor(c, golden, usable);
    const requests: CompleteRequest[] = [];
    const out = await generateKitComponent(
      fakeClientFor(golden, requests),
      src,
      analysis,
      plan as never,
      'test-live'
    );
    assert.equal(requests.length, 1);
    const req = requests[0] as CompleteRequest;
    assert.equal(req.schemaName, KIT_SCHEMA_NAMES[c]);
    assert.equal(req.jsonSchema === kitGenSchemaFor(c), true);
    assert.equal(req.maxOutputTokens, 24000);
    assert.deepEqual(req.messages, buildKitComponentMessages(src, analysis, plan));
    assert.deepEqual(out.gen, golden);
    assert.equal('report' in out, false);
  }
  const source = loadSource('nasa-grc-drag-equation');
  const quizGolden = loadFixture('quiz-cards.gen.json');
  const quizAnalysis = analysisFor('quiz-cards-v1', quizGolden);
  const quizPlan = planEntryFor('quiz-cards-v1', quizGolden, usable);
  const declined = loadFixture('source-analysis-v2.declined.json') as SourceAnalysisV2;
  {
    const requests: CompleteRequest[] = [];
    await assert.rejects(generateKitComponent(fakeClientFor(quizGolden, requests), source, declined, quizPlan as never, 'test-live'), /ANALYSIS_DECLINED/);
    assert.equal(requests.length, 0);
  }
  for (const bad of ['forces-1d-v1', 'timeline-v1'] as const) {
    const badPlan = { ...quizPlan, componentId: bad } as unknown as ComponentPlanEntry & { componentId: never };
    const requests: CompleteRequest[] = [];
    await assert.rejects(generateKitComponent(fakeClientFor(quizGolden, requests), source, quizAnalysis, badPlan, 'test-live'), /KIT_COMPONENT_REQUIRED/);
    assert.equal(requests.length, 0);
  }
  {
    const otherPlan: ComponentPlanEntry & { componentId: 'quiz-cards-v1' } = {
      componentId: 'quiz-cards-v1',
      pedagogicalReason: 'Practise the key ideas of this page.',
      focusQuote: 'SYNTH-NOT-IN-PLAN-QUOTE',
      focusSourceId: 'nasa-grc-drag-equation'
    };
    const requests: CompleteRequest[] = [];
    await assert.rejects(generateKitComponent(fakeClientFor(quizGolden, requests), source, quizAnalysis, otherPlan, 'test-live'), /PLAN_ENTRY_NOT_IN_ANALYSIS/);
    assert.equal(requests.length, 0);
  }
});

test('repairKitComponent baseline immutability and guards', async () => {
  const source = loadSource('nasa-grc-drag-equation');
  const usable = loadFixture('source-analysis-v2.usable.json') as SourceAnalysisV2;
  const quizGolden = loadFixture('quiz-cards.gen.json') as KitGenByComponent['quiz-cards-v1'];
  const analysis = analysisFor('quiz-cards-v1', quizGolden);
  const plan = planEntryFor('quiz-cards-v1', quizGolden, usable) as ComponentPlanEntry & { componentId: 'quiz-cards-v1' };
  const rev1 = deepFreeze(structuredClone(quizGolden));
  const rev1Snapshot = JSON.stringify(rev1);
  const rev2 = structuredClone(rev1) as KitGenByComponent['quiz-cards-v1'];
  (rev2.cards[2] as { stem: string }).stem = 'Which area is used in the drag equation here revised?';
  function quizValidator(value: KitGenByComponent['quiz-cards-v1'], _sources: SourceDocument[]): ValidationReport {
    if (isDeepStrictEqual(value, rev1)) {
      return {
        artifactId: 'quiz-cards-v1',
        revision: 1,
        checks: [
          { id: 'Q-01', kind: 'grounding', passed: false, message: 'quote must be verbatim', path: '/cards/1/quote', affected: ['/cards/1/quote'] },
          { id: 'Q-02', kind: 'grounding', passed: true, message: 'ok' }
        ],
        publishable: false
      };
    }
    return {
      artifactId: 'quiz-cards-v1',
      revision: 1,
      checks: [
        { id: 'Q-04', kind: 'semantic', passed: false, message: 'stem leaks answer', path: '/cards/2/stem', affected: ['/cards/2/stem'] },
        { id: 'Q-02', kind: 'grounding', passed: true, message: 'ok' }
      ],
      publishable: false
    };
  }
  {
    const requests: CompleteRequest[] = [];
    const prevReport = quizValidator(structuredClone(rev1), [source]);
    const out = await repairKitComponent(
      fakeClientFor(rev2, requests),
      source,
      analysis,
      plan,
      { gen: rev1, report: prevReport, attempt: 1 },
      'test-live',
      { validate: quizValidator }
    );
    assert.equal(requests.length, 1);
    const req = requests[0] as CompleteRequest;
    assert.equal(req.schemaName, KIT_REPAIR_SCHEMA_NAMES['quiz-cards-v1']);
    assert.equal(req.maxOutputTokens, 24000);
    const user = req.messages[1]?.content ?? '';
    const payload = payloadBetween(user, '<untrusted-component-repair-data>', '</untrusted-component-repair-data>') as Record<string, unknown>;
    assert.deepEqual(payload['originalSpec'], rev1);
    assert.deepEqual(payload['authorizedPaths'], ['/cards/1/quote']);
    assert.equal(out.report.revision, 2);
    assert.deepEqual(out.authorizedPaths, ['/cards/1/quote']);
  }
  {
    const requests: CompleteRequest[] = [];
    const prevReport = quizValidator(structuredClone(rev2), [source]);
    const out = await repairKitComponent(
      fakeClientFor(rev2, requests),
      source,
      analysis,
      plan,
      { gen: rev2, report: prevReport, attempt: 2, baseline: { gen: rev1 } },
      'test-live',
      { validate: quizValidator }
    );
    const req = requests[0] as CompleteRequest;
    const user = req.messages[1]?.content ?? '';
    const payload = payloadBetween(user, '<untrusted-component-repair-data>', '</untrusted-component-repair-data>') as Record<string, unknown>;
    assert.deepEqual(payload['originalSpec'], rev1);
    assert.deepEqual(payload['previousSpec'], rev2);
    assert.ok(JSON.stringify(payload['originalSpec']) !== JSON.stringify(rev2));
    assert.deepEqual(payload['authorizedPaths'], ['/cards/1/quote']);
    const findings = payload['findings'] as RepairFinding[];
    assert.ok(findings.some((f) => f.id === 'Q-04'));
    assert.equal(out.report.revision, 3);
    assert.deepEqual(out.authorizedPaths, ['/cards/1/quote']);
  }
  assert.equal(JSON.stringify(rev1), rev1Snapshot);
  assert.ok(Object.isFrozen(rev1));
  {
    const beforeRev1 = JSON.stringify(rev1);
    const beforeRev2 = JSON.stringify(rev2);
    const beforeAnalysis = JSON.stringify(analysis);
    const beforePlan = JSON.stringify(plan);
    const mutating = (value: KitGenByComponent['quiz-cards-v1'], _sources: SourceDocument[]): ValidationReport => {
      (value as unknown as Record<string, unknown>)['title'] = 'MUTATED';
      const cards = (value as unknown as { cards: Array<Record<string, unknown>> }).cards;
      if (Array.isArray(cards) && cards[0] !== undefined) {
        cards[0]['stem'] = 'MUTATED';
      }
      return {
        artifactId: 'quiz-cards-v1',
        revision: 1,
        checks: [{ id: 'Q-01', kind: 'grounding', passed: false, message: 'bad', affected: ['/cards/0/quote'] }],
        publishable: false
      };
    };
    const requests: CompleteRequest[] = [];
    await repairKitComponent(
      fakeClientFor(rev2, requests),
      source,
      analysis,
      plan,
      { gen: rev1, report: mutating(structuredClone(rev1), [source]), attempt: 1 },
      'test-live',
      { validate: mutating }
    );
    assert.equal(JSON.stringify(rev1), beforeRev1);
    assert.equal(JSON.stringify(rev2), beforeRev2);
    assert.equal(JSON.stringify(analysis), beforeAnalysis);
    assert.equal(JSON.stringify(plan), beforePlan);
  }
  for (const attempt of [0, 3, 1.5]) {
    const requests: CompleteRequest[] = [];
    await assert.rejects(
      repairKitComponent(
        fakeClientFor(rev2, requests),
        source,
        analysis,
        plan,
        { gen: rev1, report: quizValidator(structuredClone(rev1), [source]), attempt },
        'test-live',
        { validate: quizValidator }
      ),
      /REPAIR_ATTEMPT_INVALID/
    );
    assert.equal(requests.length, 0);
  }
  {
    const requests: CompleteRequest[] = [];
    await assert.rejects(
      repairKitComponent(
        fakeClientFor(rev2, requests),
        source,
        analysis,
        plan,
        { gen: rev2, report: quizValidator(structuredClone(rev2), [source]), attempt: 2 },
        'test-live',
        { validate: quizValidator }
      ),
      /REPAIR_BASELINE_REQUIRED/
    );
    assert.equal(requests.length, 0);
  }
  {
    const passing: ValidationReport = {
      artifactId: 'quiz-cards-v1',
      revision: 1,
      checks: [{ id: 'Q-01', kind: 'grounding', passed: true, message: 'ok' }],
      publishable: true
    };
    const requests: CompleteRequest[] = [];
    await assert.rejects(
      repairKitComponent(fakeClientFor(rev2, requests), source, analysis, plan, { gen: rev1, report: passing, attempt: 1 }, 'test-live', {
        validate: (_v: KitGenByComponent['quiz-cards-v1'], _s: SourceDocument[]): ValidationReport => passing
      }),
      /NOTHING_TO_REPAIR/
    );
    assert.equal(requests.length, 0);
  }
  {
    const sequenceGolden = loadFixture('sequence.gen.json') as KitGenByComponent['sequence-v1'];
    const requests: CompleteRequest[] = [];
    const prevReport = quizValidator(structuredClone(rev1), [source]);
    await assert.rejects(
      repairKitComponent(
        fakeClientFor(rev2, requests),
        source,
        analysis,
        plan,
        { gen: sequenceGolden as unknown as KitGenByComponent['quiz-cards-v1'], report: prevReport, attempt: 1 },
        'test-live',
        { validate: quizValidator }
      ),
      /COMPONENT_MISMATCH/
    );
    assert.equal(requests.length, 0);
  }
  {
    const throwingBaseline = (value: KitGenByComponent['quiz-cards-v1'], _sources: SourceDocument[]): ValidationReport => {
      if (isDeepStrictEqual(value, rev1)) {
        throw new Error('SYNTH-BASELINE-BOOM');
      }
      return {
        artifactId: 'quiz-cards-v1',
        revision: 1,
        checks: [{ id: 'Q-04', kind: 'semantic', passed: false, message: 'bad', affected: ['/cards/2/stem'] }],
        publishable: false
      };
    };
    const requests: CompleteRequest[] = [];
    const prevReport = throwingBaseline(structuredClone(rev2), [source]);
    const out = await repairKitComponent(
      fakeClientFor(rev2, requests),
      source,
      analysis,
      plan,
      { gen: rev2, report: prevReport, attempt: 2, baseline: { gen: rev1 } },
      'test-live',
      { validate: throwingBaseline }
    );
    assert.equal(requests.length, 1);
    assert.deepEqual(out.authorizedPaths, []);
    const user = (requests[0] as CompleteRequest).messages[1]?.content ?? '';
    const payload = payloadBetween(user, '<untrusted-component-repair-data>', '</untrusted-component-repair-data>') as Record<string, unknown>;
    assert.deepEqual(payload['authorizedPaths'], []);
  }
  {
    const repairPrefixed = (_value: KitGenByComponent['quiz-cards-v1'], _sources: SourceDocument[]): ValidationReport => ({
      artifactId: 'quiz-cards-v1',
      revision: 1,
      checks: [
        { id: 'repair.no-weakening', kind: 'semantic', passed: false, message: 'weak', affected: ['/cards/0/stem'] },
        { id: 'Q-01', kind: 'grounding', passed: false, message: 'bad', affected: ['/cards/1/quote'] }
      ],
      publishable: false
    });
    const requests: CompleteRequest[] = [];
    const prevReport: ValidationReport = {
      artifactId: 'quiz-cards-v1',
      revision: 1,
      checks: [{ id: 'Q-01', kind: 'grounding', passed: false, message: 'bad', affected: ['/cards/1/quote'] }],
      publishable: false
    };
    const out = await repairKitComponent(
      fakeClientFor(rev2, requests),
      source,
      analysis,
      plan,
      { gen: rev1, report: prevReport, attempt: 1 },
      'test-live',
      { validate: repairPrefixed }
    );
    assert.deepEqual(out.authorizedPaths, ['/cards/1/quote']);
  }
  {
    const baseFail: ValidationReport = {
      artifactId: 'quiz-cards-v1',
      revision: 1,
      checks: [{ id: 'Q-02', kind: 'grounding', passed: true, message: 'ok' }],
      publishable: true
    };
    const validateOk = (_v: KitGenByComponent['quiz-cards-v1'], _s: SourceDocument[]): ValidationReport => baseFail;
    const failingCompare = (_b: KitGenByComponent['quiz-cards-v1'], _c: KitGenByComponent['quiz-cards-v1'], _s: SourceDocument[]): ValidationCheck => ({
      id: 'repair.no-weakening',
      kind: 'semantic',
      passed: false,
      message: 'weakened'
    });
    const requests: CompleteRequest[] = [];
    const prevReport = quizValidator(structuredClone(rev1), [source]);
    const out = await repairKitComponent(
      fakeClientFor(rev2, requests),
      source,
      analysis,
      plan,
      { gen: rev1, report: prevReport, attempt: 1 },
      'test-live',
      { validate: validateOk, compare: failingCompare }
    );
    assert.ok(out.report.checks.some((c) => c.id === 'repair.no-weakening'));
    assert.equal(out.report.publishable, false);
  }
  {
    const baseFail: ValidationReport = {
      artifactId: 'quiz-cards-v1',
      revision: 1,
      checks: [{ id: 'Q-02', kind: 'grounding', passed: true, message: 'ok' }],
      publishable: true
    };
    const validateOk = (_v: KitGenByComponent['quiz-cards-v1'], _s: SourceDocument[]): ValidationReport => baseFail;
    const passingCompare = (_b: KitGenByComponent['quiz-cards-v1'], _c: KitGenByComponent['quiz-cards-v1'], _s: SourceDocument[]): ValidationCheck => ({
      id: 'repair.no-weakening',
      kind: 'semantic',
      passed: true,
      message: 'same or better'
    });
    const requests: CompleteRequest[] = [];
    const prevReport = quizValidator(structuredClone(rev1), [source]);
    const out = await repairKitComponent(
      fakeClientFor(rev2, requests),
      source,
      analysis,
      plan,
      { gen: rev1, report: prevReport, attempt: 1 },
      'test-live',
      { validate: validateOk, compare: passingCompare }
    );
    assert.equal(out.report.publishable, true);
  }
  {
    const throwingAfter = (_v: KitGenByComponent['quiz-cards-v1'], _s: SourceDocument[]): ValidationReport => {
      throw new Error('SYNTH-AFTER-BOOM');
    };
    const requests: CompleteRequest[] = [];
    const prevReport = quizValidator(structuredClone(rev1), [source]);
    let err: unknown;
    try {
      await repairKitComponent(
        fakeClientFor(rev2, requests),
        source,
        analysis,
        plan,
        { gen: rev1, report: prevReport, attempt: 1 },
        'test-live',
        { validate: throwingAfter }
      );
    } catch (e) {
      err = e;
    }
    assert.ok(err instanceof GeneratedOutputErrorV2);
    assert.equal((err as GeneratedOutputErrorV2).v2Stage, 'component-repair');
    assert.deepEqual((err as GeneratedOutputErrorV2).receipt, fakeReceipt);
    assert.equal(requests.length, 1);
  }
});

test('repairAnalysisV2 core set', async () => {
  const source = loadSource('nasa-grc-drag-equation');
  const usable = loadFixture('source-analysis-v2.usable.json') as SourceAnalysisV2;
  const usableSnapshot = JSON.stringify(usable);
  const rev1 = structuredClone(usable);
  const rev2 = structuredClone(usable);
  rev2.pageCoverage = 'The page teaches the drag equation and which factors change drag revised.';
  function analysisValidator(value: SourceAnalysisV2, _sources: SourceDocument[]): ValidationReport {
    if (isDeepStrictEqual(value, rev1)) {
      return {
        artifactId: 'source-analysis-v2',
        revision: 1,
        checks: [
          { id: 'A-05', kind: 'grounding', passed: false, message: 'point quote must be verbatim', path: '/overview/keyPoints/0/point', affected: ['/overview/keyPoints/0/point'] },
          { id: 'A-03', kind: 'semantic', passed: true, message: 'ok' }
        ],
        publishable: false
      };
    }
    return {
      artifactId: 'source-analysis-v2',
      revision: 1,
      checks: [
        { id: 'A-10', kind: 'semantic', passed: false, message: 'number not checkable', path: '/overview/headline', affected: ['/overview/headline'] },
        { id: 'A-03', kind: 'semantic', passed: true, message: 'ok' }
      ],
      publishable: false
    };
  }
  {
    const requests: CompleteRequest[] = [];
    const prevReport = analysisValidator(structuredClone(rev1), [source]);
    const out = await repairAnalysisV2(
      fakeClientFor(rev2, requests),
      source,
      { analysis: rev1, report: prevReport, attempt: 1 },
      'test-live',
      { validate: analysisValidator }
    );
    const req = requests[0] as CompleteRequest;
    assert.equal(req.schemaName, 'source_analysis_v2_repair');
    assert.equal(req.schemaName, ANALYSIS_V2_REPAIR_SCHEMA_NAME);
    assert.equal(req.maxOutputTokens, 24000);
    const user = req.messages[1]?.content ?? '';
    const payload = payloadBetween(user, '<untrusted-analysis-repair-data>', '</untrusted-analysis-repair-data>') as Record<string, unknown>;
    assert.deepEqual(payload['authorizedPaths'], ['/overview/keyPoints/0/point']);
    assert.deepEqual(out.authorizedPaths, ['/overview/keyPoints/0/point']);
    assert.equal(out.report.revision, 2);
  }
  {
    const requests: CompleteRequest[] = [];
    const prevReport = analysisValidator(structuredClone(rev2), [source]);
    const out = await repairAnalysisV2(
      fakeClientFor(rev2, requests),
      source,
      { analysis: rev2, report: prevReport, attempt: 2, baseline: { analysis: rev1 } },
      'test-live',
      { validate: analysisValidator }
    );
    const req = requests[0] as CompleteRequest;
    const user = req.messages[1]?.content ?? '';
    const payload = payloadBetween(user, '<untrusted-analysis-repair-data>', '</untrusted-analysis-repair-data>') as Record<string, unknown>;
    assert.deepEqual(payload['originalAnalysis'], rev1);
    assert.deepEqual(payload['previousAnalysis'], rev2);
    assert.deepEqual(payload['authorizedPaths'], ['/overview/keyPoints/0/point']);
    const findings = payload['findings'] as RepairFinding[];
    assert.ok(findings.some((f) => f.id === 'A-10'));
    assert.deepEqual(out.authorizedPaths, ['/overview/keyPoints/0/point']);
    assert.equal(out.report.revision, 3);
  }
  assert.equal(JSON.stringify(usable), usableSnapshot);
  for (const attempt of [0, 3, 1.5]) {
    const requests: CompleteRequest[] = [];
    await assert.rejects(
      repairAnalysisV2(
        fakeClientFor(rev2, requests),
        source,
        { analysis: rev1, report: analysisValidator(structuredClone(rev1), [source]), attempt },
        'test-live',
        { validate: analysisValidator }
      ),
      /REPAIR_ATTEMPT_INVALID/
    );
    assert.equal(requests.length, 0);
  }
  {
    const requests: CompleteRequest[] = [];
    await assert.rejects(
      repairAnalysisV2(
        fakeClientFor(rev2, requests),
        source,
        { analysis: rev2, report: analysisValidator(structuredClone(rev2), [source]), attempt: 2 },
        'test-live',
        { validate: analysisValidator }
      ),
      /REPAIR_BASELINE_REQUIRED/
    );
    assert.equal(requests.length, 0);
  }
  {
    const passing: ValidationReport = {
      artifactId: 'source-analysis-v2',
      revision: 1,
      checks: [{ id: 'A-03', kind: 'semantic', passed: true, message: 'ok' }],
      publishable: true
    };
    const requests: CompleteRequest[] = [];
    await assert.rejects(
      repairAnalysisV2(fakeClientFor(rev2, requests), source, { analysis: rev1, report: passing, attempt: 1 }, 'test-live', {
        validate: (_v: SourceAnalysisV2, _s: SourceDocument[]): ValidationReport => passing
      }),
      /NOTHING_TO_REPAIR/
    );
    assert.equal(requests.length, 0);
  }
  {
    const bad = { ...(usable as unknown as Record<string, unknown>), extraKeyForTest: 1 };
    const requests: CompleteRequest[] = [];
    let err: unknown;
    try {
      await repairAnalysisV2(
        fakeClientFor(bad, requests),
        source,
        { analysis: rev1, report: analysisValidator(structuredClone(rev1), [source]), attempt: 1 },
        'test-live',
        { validate: analysisValidator }
      );
    } catch (e) {
      err = e;
    }
    assert.ok(err instanceof GeneratedOutputErrorV2);
    assert.equal((err as GeneratedOutputErrorV2).v2Stage, 'analysis-v2-repair');
    assert.equal((err as GeneratedOutputError).stage, 'analysis-repair');
    assert.deepEqual((err as GeneratedOutputErrorV2).receipt, fakeReceipt);
  }
});

test('findings copy only allowed keys', async () => {
  const source = loadSource('nasa-grc-drag-equation');
  const usable = loadFixture('source-analysis-v2.usable.json') as SourceAnalysisV2;
  const quizGolden = loadFixture('quiz-cards.gen.json') as KitGenByComponent['quiz-cards-v1'];
  const analysis = analysisFor('quiz-cards-v1', quizGolden);
  const plan = planEntryFor('quiz-cards-v1', quizGolden, usable) as ComponentPlanEntry & { componentId: 'quiz-cards-v1' };
  const extraCheck = {
    id: 'Q-01',
    kind: 'grounding',
    passed: false,
    message: 'bad quote',
    path: '/cards/0/quote',
    affected: ['/cards/0/quote'],
    expected: 123,
    computed: 456,
    tolerance: 0.1,
    extraLeak: 'SYNTH-SECRET'
  } as unknown as ValidationCheck;
  const prevReport: ValidationReport = {
    artifactId: 'quiz-cards-v1',
    revision: 1,
    checks: [extraCheck],
    publishable: false
  };
  const validate = (_v: KitGenByComponent['quiz-cards-v1'], _s: SourceDocument[]): ValidationReport => ({
    artifactId: 'quiz-cards-v1',
    revision: 1,
    checks: [{ id: 'Q-01', kind: 'grounding', passed: false, message: 'bad', affected: ['/cards/0/quote'] }],
    publishable: false
  });
  const requests: CompleteRequest[] = [];
  await repairKitComponent(fakeClientFor(quizGolden, requests), source, analysis, plan, { gen: quizGolden, report: prevReport, attempt: 1 }, 'test-live', {
    validate
  });
  const user = (requests[0] as CompleteRequest).messages[1]?.content ?? '';
  const payload = payloadBetween(user, '<untrusted-component-repair-data>', '</untrusted-component-repair-data>') as Record<string, unknown>;
  const findings = payload['findings'] as Array<Record<string, unknown>>;
  assert.equal(findings.length, 1);
  assert.deepEqual(Object.keys(findings[0] as Record<string, unknown>).sort(), ['affected', 'id', 'kind', 'message', 'path']);
});

test('v1 untouched', async () => {
  const source = loadSource('nasa-grc-drag-equation');
  const requests: CompleteRequest[] = [];
  const fake = queuedClient(
    [{ supported: false, activity: 'none', unsupportedReason: 'stub', concepts: [], objectives: [] }],
    requests
  );
  try {
    await analyzeSource(fake, source, 'test-live');
  } catch {
    // No further v1 assertions; the v1 suites cover the rest.
  }
  assert.equal(requests.length, 1);
  assert.equal((requests[0] as CompleteRequest).schemaName, 'source_analysis');
  assert.equal((requests[0] as CompleteRequest).maxOutputTokens, 6000);
});
