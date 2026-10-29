// S6-W — lesson-flow worker tests: fake MetaClient + the hand-written Stage 6 goldens
// (tests/fixtures/stage6) + the real licensed library sources. No network, no credits,
// no .env access. Covers: happy path on the drag golden, decline, unrepairable analysis
// (overview failure = the only lesson-level failure), component failed→repaired, component
// pruned, component unrepairable → partial publish, OUTPUT_INVALID as a component-level
// failure, provider MetaError as a fatal failure, and concurrency 2 with plan-order events.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listJobs, readJob, startJob } from './jobs.ts';
import type { JobStageEvent, JobSummary } from './jobs.ts';
import { MetaError } from '../../packages/meta/client.ts';
import type { CompleteRequest, MetaClient } from '../../packages/meta/client.ts';
import { STAGE6_PROMPT_VERSION } from '../../packages/meta/prompts-v2.ts';
import type { MetaReceipt, StageEvent, ValidationReport } from '../../packages/contracts/index.ts';
import type { LessonSpec, SourceAnalysisV2 } from '../../packages/contracts/kit.ts';

const FIX = '../../tests/fixtures/stage6/';
const usableAnalysis = JSON.parse(
  readFileSync(new URL(`${FIX}source-analysis-v2.usable.json`, import.meta.url), 'utf8'),
) as SourceAnalysisV2;
const declinedAnalysis = JSON.parse(
  readFileSync(new URL(`${FIX}source-analysis-v2.declined.json`, import.meta.url), 'utf8'),
) as SourceAnalysisV2;
const quizGen = JSON.parse(readFileSync(new URL(`${FIX}quiz-cards.gen.json`, import.meta.url), 'utf8'));
const feGen = JSON.parse(readFileSync(new URL(`${FIX}formula-explorer.gen.json`, import.meta.url), 'utf8'));
const cmGen = JSON.parse(readFileSync(new URL(`${FIX}concept-map.gen.json`, import.meta.url), 'utf8'));

const DRAG = 'nasa-grc-drag-equation';
const GLOSSARY = 'nrc-glossary-half-life';
const JOB = 'lesson-test-00000001';

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

interface FakeOpts {
  analysis?: unknown;
  analysisRepair?: unknown;
  /** KIT_SCHEMA_NAMES value → gen (quiz_cards, formula_explorer, concept_map, ...). */
  kit?: Record<string, unknown>;
  /** KIT_REPAIR_SCHEMA_NAMES value → gen (quiz_cards_repair, ...). */
  kitRepair?: Record<string, unknown>;
  /** v1 premium generation schema. */
  activitySpec?: unknown;
  throwOn?: Record<string, unknown>;
  delayMs?: Record<string, number>;
}

interface LessonFake extends MetaClient {
  calls: string[];
}

function fakeLessonClient(
  opts: FakeOpts = {},
  hooks: { onStart?(name: string): void; onEnd?(name: string): void } = {},
): LessonFake {
  const calls: string[] = [];
  let n = 0;
  return {
    calls,
    complete: async <T,>(req: CompleteRequest): Promise<{ data: T; receipt: MetaReceipt }> => {
      const name = req.schemaName;
      calls.push(name);
      hooks.onStart?.(name);
      const delay = opts.delayMs?.[name];
      if (delay !== undefined) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }
      try {
        const err = opts.throwOn?.[name];
        if (err !== undefined) {
          throw err;
        }
        let data: unknown;
        if (name === 'source_analysis_v2') {
          data = opts.analysis ?? usableAnalysis;
        } else if (name === 'source_analysis_v2_repair') {
          data = opts.analysisRepair ?? opts.analysis ?? usableAnalysis;
        } else if (name === 'activity_spec') {
          data = opts.activitySpec;
        } else if (name.endsWith('_repair')) {
          data = opts.kitRepair?.[name];
        } else {
          data = opts.kit?.[name];
        }
        if (data === undefined) {
          throw new Error(`FAKE_MISSING_RESPONSE:${name}`);
        }
        n += 1;
        return { data: structuredClone(data) as T, receipt: fakeReceipt(`${name}-${n}`) };
      } finally {
        hooks.onEnd?.(name);
      }
    },
  };
}

function tempStorage(): string {
  return mkdtempSync(join(tmpdir(), 's6w-lesson-'));
}

type Ev = JobStageEvent;

function readEvents(storageDir: string, jobId: string): Ev[] {
  return readFileSync(join(storageDir, 'runs', jobId, 'events.jsonl'), 'utf8')
    .split('\n')
    .filter(line => line.trim() !== '')
    .map(line => JSON.parse(line) as Ev);
}

const ev = (e: Ev): string => `${e.stage}:${e.status}`;

function readRunFile(storageDir: string, jobId: string, name: string): any {
  return JSON.parse(readFileSync(join(storageDir, 'runs', jobId, name), 'utf8'));
}

function startLesson(
  sourceId: string,
  opts: FakeOpts,
  extra: { demoFault?: 'wrong-answer' | 'fabricated-quote'; jobId?: string; hooks?: Parameters<typeof fakeLessonClient>[1]; maxRepairAttempts?: number } = {},
): { storageDir: string; jobId: string; done: Promise<JobSummary>; client: LessonFake; seen: Ev[] } {
  const client = fakeLessonClient(opts, extra.hooks);
  const storageDir = tempStorage();
  const seen: Ev[] = [];
  const { jobId, done } = startJob(
    sourceId,
    {
      client,
      storageDir,
      purpose: 'test-live',
      flow: 'lesson',
      newJobId: () => extra.jobId ?? JOB,
      ...(extra.demoFault !== undefined ? { demoFault: extra.demoFault } : {}),
      ...(extra.maxRepairAttempts !== undefined
        ? { limits: { maxRepairAttempts: extra.maxRepairAttempts } }
        : {}),
    },
    e => seen.push(e as Ev),
  );
  return { storageDir, jobId, done, client, seen };
}

/* ------------------------------------------------------------------ */
/* Happy path on the drag golden                                        */
/* ------------------------------------------------------------------ */

test('lesson: the drag golden publishes overview + both planned components (concurrency 2, plan order)', async () => {
  const { storageDir, jobId, done, client, seen } = startLesson(DRAG, {
    analysis: usableAnalysis,
    kit: { formula_explorer: feGen, quiz_cards: quizGen },
  });
  const summary = await done;

  assert.equal(summary.status, 'succeeded');
  assert.equal(summary.flow, 'lesson');
  assert.equal(summary.error, undefined);
  assert.deepEqual(summary.lesson, {
    overviewReady: true,
    componentsPlanned: 2,
    componentsPublished: 2,
    componentsFailed: 0,
    partialPublish: false,
  });
  // analysis + 2 component calls, each 0.01 through the single accumulator.
  assert.equal(summary.totalCostUSD, 0.03);
  assert.equal(summary.reservedUnknownUSD, 0);
  assert.equal(summary.engine, null);
  assert.deepEqual(client.calls.sort(), ['formula_explorer', 'quiz_cards', 'source_analysis_v2']);

  // Storage per the frozen contract.
  const runDir = join(storageDir, 'runs', jobId);
  for (const f of ['job.json', 'events.jsonl', 'analysis-v2.r1.json', 'lesson.json', 'formula-explorer-v1.r1.json', 'quiz-cards-v1.r1.json']) {
    assert.ok(existsSync(join(runDir, f)), `${f} should exist`);
  }
  const lesson = readRunFile(storageDir, jobId, 'lesson.json') as LessonSpec;
  assert.equal(lesson.jobId, jobId);
  assert.equal(lesson.analysisRef, `${jobId}/analysis-v2.r1.json`);
  assert.ok(lesson.overview !== null);
  assert.equal(lesson.overview?.componentId, 'overview-v1');
  assert.equal(lesson.overview?.id, `${jobId}:overview-v1:r1`);
  assert.equal(lesson.overview?.title, usableAnalysis.overview.headline);
  assert.equal(lesson.overview?.provenance.revision, 1);
  assert.equal(lesson.overview?.provenance.repairOf, null);
  assert.equal(lesson.overview?.provenance.runId, jobId);
  // Unpinned (S6-W fix): compare against the imported constant — packages/meta bumps
  // STAGE6_PROMPT_VERSION in parallel and this assertion must not pin the literal.
  assert.equal(lesson.overview?.provenance.promptVersion, STAGE6_PROMPT_VERSION);
  assert.ok(Number.isSafeInteger(lesson.overview?.seed));
  assert.equal(lesson.overview?.sources[0]?.id, DRAG);
  assert.ok(!('text' in (lesson.overview?.sources[0] ?? {})), 'source text never lands in the spec');
  // Plan order preserved.
  assert.deepEqual(
    lesson.components.map(c => [c.componentId, c.status, c.revision, c.reason]),
    [
      ['formula-explorer-v1', 'passed', 1, ''],
      ['quiz-cards-v1', 'passed', 1, ''],
    ],
  );
  assert.equal(lesson.components[0]?.specId, `${jobId}:formula-explorer-v1:r1`);

  // Events per the frozen contract.
  const events = readEvents(storageDir, jobId);
  assert.deepEqual(seen, events, 'onEvent receives exactly what is persisted');
  assert.deepEqual(events.slice(0, 5).map(ev), [
    'ingest:started', 'ingest:succeeded', 'analyze:started', 'analyze:succeeded', 'overview:succeeded',
  ]);
  // S6R-01: the lesson gate = schema + A-01..A-11 + OV-01..OV-06 on a usable analysis (18 checks).
  assert.match(events[3]?.detail ?? '', /^usable; checks 18\/18 passed$/);
  assert.match(events[4]?.detail ?? '', /^overview ready: 3 key points, 3 key terms$/);
  // Both components start (concurrency 2) before the lesson finishes; plan order at start.
  const starts = events.filter(e => e.stage === 'component' && e.status === 'started');
  assert.deepEqual(starts.map(e => e.componentId), ['formula-explorer-v1', 'quiz-cards-v1']);
  assert.deepEqual(starts.map(e => e.revision), [1, 1]);
  const successes = events.filter(e => e.stage === 'component' && e.status === 'succeeded');
  assert.equal(successes.length, 2);
  assert.equal(events[events.length - 1]?.stage, 'done');
  assert.match(events[events.length - 1]?.detail ?? '', /lesson published: overview \+ 2\/2 components/);
  assert.deepEqual(events.map(e => e.seq), events.map((_, i) => i), 'seq is contiguous from 0');
  for (const e of events) {
    assert.equal(e.model, 'muse-spark-1.3', 'every event carries the job model identity');
  }

  // job.json persists the lesson progress for the list view.
  const jobJson = readRunFile(storageDir, jobId, 'job.json') as JobSummary;
  assert.equal(jobJson.flow, 'lesson');
  assert.equal(jobJson.lesson?.overviewReady, true);

  // Detail per the frozen contract.
  const detail = readJob(storageDir, jobId);
  assert.ok(detail !== null);
  assert.deepEqual(detail.analysisV2, usableAnalysis);
  assert.equal((detail.analysisV2Report as ValidationReport).publishable, true);
  assert.equal((detail.analysisV2Report as ValidationReport).artifactId, `${jobId}:analysis`);
  assert.deepEqual(detail.analysisV2Revisions?.map(r => r.revision), [1]);
  assert.ok(detail.lesson !== null);
  assert.deepEqual(Object.keys(detail.kitSpecs ?? {}).sort(), [
    `${jobId}:formula-explorer-v1:r1`,
    `${jobId}:quiz-cards-v1:r1`,
  ]);
  assert.equal(detail.kitSpecs?.[`${jobId}:quiz-cards-v1:r1`]?.componentId, 'quiz-cards-v1');
  assert.deepEqual(Object.keys(detail.componentReports ?? {}).sort(), [
    `${jobId}:formula-explorer-v1:r1`,
    `${jobId}:quiz-cards-v1:r1`,
  ]);
  assert.equal(detail.componentReports?.[`${jobId}:quiz-cards-v1:r1`]?.publishable, true);
  assert.deepEqual(detail.componentRepairs, []);
  // The stored kit spec carries the gen body + system fields.
  const quizSpec = readRunFile(storageDir, jobId, 'quiz-cards-v1.r1.json');
  assert.equal(quizSpec.spec.cards.length, 3);
  assert.equal(quizSpec.report.publishable, true);
  assert.equal(quizSpec.gen.schemaVersion, 'quiz-cards-v1');

  // List summaries include flow + lesson.
  const listed = listJobs(storageDir);
  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.flow, 'lesson');
  assert.equal(listed[0]?.lesson?.componentsPublished, 2);
});

/* ------------------------------------------------------------------ */
/* Decline                                                              */
/* ------------------------------------------------------------------ */

test('lesson: a declined page ends unsupported with coverage, no overview and no component calls', async () => {
  const { storageDir, jobId, done, client } = startLesson(GLOSSARY, { analysis: declinedAnalysis });
  const summary = await done;
  assert.equal(summary.status, 'unsupported');
  assert.equal(summary.flow, 'lesson');
  assert.deepEqual(summary.lesson, {
    overviewReady: false, componentsPlanned: 0, componentsPublished: 0, componentsFailed: 0, partialPublish: false,
  });
  assert.equal(summary.totalCostUSD, 0.01, 'only the analysis call was paid');
  assert.deepEqual(client.calls, ['source_analysis_v2']);

  const lesson = readRunFile(storageDir, jobId, 'lesson.json') as LessonSpec;
  assert.equal(lesson.overview, null);
  assert.deepEqual(lesson.components, []);

  const events = readEvents(storageDir, jobId);
  assert.deepEqual(events.map(ev), [
    'ingest:started', 'ingest:succeeded', 'analyze:started', 'analyze:succeeded', 'done:succeeded',
  ]);
  assert.match(events[3]?.detail ?? '', /^declined: too-short; checks 12\/12 passed$/);
  assert.equal(events[4]?.detail, 'declined: too-short');

  const detail = readJob(storageDir, jobId);
  assert.ok(detail !== null);
  assert.deepEqual(detail.analysisV2, declinedAnalysis, 'a publishable decline is served as the analysis of record');
  assert.equal((detail.lesson as LessonSpec).overview, null);
  assert.deepEqual(detail.kitSpecs, {});
  assert.deepEqual(detail.componentReports, {});
});

/* ------------------------------------------------------------------ */
/* Overview/analysis failure — the only lesson-level failure            */
/* ------------------------------------------------------------------ */

test('lesson: an analysis that never repairs fails the job ANALYSIS_INVALID with every receipt accounted', async () => {
  const broken = structuredClone(usableAnalysis);
  broken.overview.keyPoints[0].quote = 'a quote that is not on the page';
  const { storageDir, jobId, done, client } = startLesson(DRAG, {
    analysis: broken,
    analysisRepair: broken, // the "repair" never fixes it
    kit: { formula_explorer: feGen, quiz_cards: quizGen },
  });
  const summary = await done;
  assert.equal(summary.status, 'failed');
  assert.deepEqual(summary.error, { code: 'ANALYSIS_INVALID', message: 'analysis failed validation' });
  assert.equal(summary.totalCostUSD, 0.03, 'analysis + 2 repair calls, all accounted');
  assert.equal(summary.analysisRepairs?.length, 2);
  assert.equal(summary.analysisRepairs?.[0]?.passed, false);
  assert.ok(summary.analysisRepairs?.[0]?.targeted.includes('A-05'));
  assert.deepEqual(client.calls, [
    'source_analysis_v2', 'source_analysis_v2_repair', 'source_analysis_v2_repair',
  ]);

  const events = readEvents(storageDir, jobId);
  assert.deepEqual(events.map(ev), [
    'ingest:started', 'ingest:succeeded',
    'analyze:started', 'analyze:succeeded',
    'repair:started', 'repair:succeeded',
    'repair:started', 'repair:succeeded',
    'analyze:failed',
  ]);
  const repairs = events.filter(e => e.stage === 'repair');
  assert.ok(repairs.every(e => e.target === 'analysis'));
  assert.deepEqual(repairs.map(e => e.revision), [2, 2, 3, 3]);

  for (const f of ['analysis-v2.r1.json', 'analysis-v2.r2.json', 'analysis-v2.r3.json']) {
    assert.ok(existsSync(join(storageDir, 'runs', jobId, f)), `${f} should exist`);
  }
  assert.ok(!existsSync(join(storageDir, 'runs', jobId, 'lesson.json')), 'no lesson without a publishable analysis');

  const detail = readJob(storageDir, jobId);
  assert.ok(detail !== null);
  assert.equal(detail.analysisV2, null, 'an unrepairable analysis is never served as the record');
  assert.equal((detail.analysisV2Report as ValidationReport).publishable, false);
  assert.deepEqual(detail.analysisV2Revisions?.map(r => r.revision), [1, 2, 3]);
  assert.equal(detail.lesson, null);
  assert.deepEqual(detail.kitSpecs, {});
});

test('lesson: an analysis repair call that dies with a MetaError fails the job with its fixed code', async () => {
  const broken = structuredClone(usableAnalysis);
  broken.overview.keyPoints[0].quote = 'a quote that is not on the page';
  const { storageDir, jobId, done } = startLesson(DRAG, {
    analysis: broken,
    throwOn: { source_analysis_v2_repair: new MetaError('RATE_LIMITED') },
  });
  const summary = await done;
  assert.equal(summary.status, 'failed');
  assert.deepEqual(summary.error, { code: 'RATE_LIMITED', message: 'rate limited' });
  const events = readEvents(storageDir, jobId);
  const last = events[events.length - 1];
  assert.equal(last?.stage, 'repair');
  assert.equal(last?.status, 'failed');
  assert.equal(last?.target, 'analysis');
  assert.equal(last?.revision, 2);
});

/* ------------------------------------------------------------------ */
/* Component failed → repaired                                          */
/* ------------------------------------------------------------------ */

test('lesson: a component whose quote check fails is repaired to revision 2 and published', async () => {
  const brokenQuiz = structuredClone(quizGen);
  brokenQuiz.cards[1].quote = 'This sentence never appears on the page at all.';
  const { storageDir, jobId, done, client } = startLesson(DRAG, {
    kit: { formula_explorer: feGen, quiz_cards: brokenQuiz },
    kitRepair: { quiz_cards_repair: quizGen },
  });
  const summary = await done;
  assert.equal(summary.status, 'succeeded');
  assert.equal(summary.totalCostUSD, 0.04, 'analysis + 2 components + 1 repair');
  assert.deepEqual(summary.lesson, {
    overviewReady: true, componentsPlanned: 2, componentsPublished: 2, componentsFailed: 0, partialPublish: false,
  });
  assert.deepEqual(summary.componentRepairs, [
    {
      componentId: 'quiz-cards-v1',
      attempt: 1,
      revision: 2,
      targeted: ['Q-01', 'Q-02', 'Q-05'],
      fixed: ['Q-01', 'Q-02', 'Q-05'],
      remaining: [],
      passed: true,
      afterInjectedFault: false, // S6R-11: no demo fault was injected
    },
  ]);
  assert.ok(client.calls.includes('quiz_cards_repair'));

  const lesson = readRunFile(storageDir, jobId, 'lesson.json') as LessonSpec;
  const quizEntry = lesson.components.find(c => c.componentId === 'quiz-cards-v1');
  assert.deepEqual(
    { status: quizEntry?.status, revision: quizEntry?.revision, specId: quizEntry?.specId, reason: quizEntry?.reason },
    { status: 'passed', revision: 2, specId: `${jobId}:quiz-cards-v1:r2`, reason: '' },
  );

  const events = readEvents(storageDir, jobId);
  const quizEvents = events.filter(e => e.componentId === 'quiz-cards-v1');
  assert.deepEqual(quizEvents.map(e => `${ev(e)}${e.stage === 'repair' ? `(${e.target})` : ''}`), [
    'component:started', 'component:failed', 'repair:started(component)', 'repair:succeeded(component)', 'component:succeeded',
  ]);
  assert.deepEqual(quizEvents.map(e => e.revision), [1, 1, 2, 2, 2]);
  assert.match(quizEvents[1]?.detail ?? '', /failed checks: Q-01, Q-02, Q-05/);

  // Both revisions persisted; the r1 file keeps the failing gen + report.
  const r1 = readRunFile(storageDir, jobId, 'quiz-cards-v1.r1.json');
  assert.equal(r1.gen.cards[1].quote, 'This sentence never appears on the page at all.');
  assert.equal(r1.report.publishable, false);
  const r2 = readRunFile(storageDir, jobId, 'quiz-cards-v1.r2.json');
  assert.equal(r2.report.publishable, true);
  assert.equal(r2.spec.id, `${jobId}:quiz-cards-v1:r2`);
  assert.equal(r2.spec.provenance.revision, 2);
  assert.equal(r2.spec.provenance.repairOf, 1);

  const detail = readJob(storageDir, jobId);
  assert.ok(detail !== null);
  assert.deepEqual(Object.keys(detail.kitSpecs ?? {}).sort(), [
    `${jobId}:formula-explorer-v1:r1`, `${jobId}:quiz-cards-v1:r2`,
  ]);
  assert.deepEqual(Object.keys(detail.componentReports ?? {}).sort(), [
    `${jobId}:formula-explorer-v1:r1`, `${jobId}:quiz-cards-v1:r2`,
  ], 'componentReports keys the LATEST revision per component');
  assert.equal(detail.componentReports?.[`${jobId}:quiz-cards-v1:r2`]?.revision, 2);
  assert.deepEqual(detail.componentRepairs?.map(r => [r.componentId, r.revision, r.passed]), [['quiz-cards-v1', 2, true]]);
});

/* ------------------------------------------------------------------ */
/* Component pruned                                                     */
/* ------------------------------------------------------------------ */

test('lesson: an unverifiable card is pruned by the system while the minimum remains — passed with a dropped-items note, no repair call', async () => {
  const quiz4 = structuredClone(quizGen);
  quiz4.cards.push({
    id: 'bad-card',
    stem: 'Which of these appears in a sentence the page never prints?',
    options: ['drag coefficient', 'nothing one', 'nothing two'],
    sourceId: DRAG,
    quote: 'This sentence never appears on the page at all.',
    hint: '',
  });
  const { storageDir, jobId, done, client } = startLesson(DRAG, {
    kit: { formula_explorer: feGen, quiz_cards: quiz4 },
  });
  const summary = await done;
  assert.equal(summary.status, 'succeeded');
  assert.equal(summary.totalCostUSD, 0.03, 'no repair call was paid');
  assert.ok(!client.calls.some(c => c.endsWith('_repair')), 'the prune saved the component without a model call');
  assert.deepEqual(summary.componentRepairs, []);

  const lesson = readRunFile(storageDir, jobId, 'lesson.json') as LessonSpec;
  const quizEntry = lesson.components.find(c => c.componentId === 'quiz-cards-v1');
  assert.equal(quizEntry?.status, 'passed');
  assert.equal(quizEntry?.revision, 1);
  assert.match(quizEntry?.reason ?? '', /1 card was left out/);
  assert.match(quizEntry?.reason ?? '', /bad-card \(Q-01, Q-02, Q-05\)/);

  const stored = readRunFile(storageDir, jobId, 'quiz-cards-v1.r1.json');
  assert.equal(stored.gen.cards.length, 3);
  assert.ok(!stored.gen.cards.some((c: { id: string }) => c.id === 'bad-card'));
  assert.equal(stored.pruned, true);
  assert.equal(stored.dropped.length, 1);
  assert.equal(stored.report.publishable, true);

  const detail = readJob(storageDir, jobId);
  assert.ok(detail !== null);
  const spec = detail.kitSpecs?.[`${jobId}:quiz-cards-v1:r1`] as { cards: unknown[] } | undefined;
  assert.equal(spec?.cards.length, 3, 'only the verified cards are ever served');
});

/* ------------------------------------------------------------------ */
/* Component unrepairable → partial publish                             */
/* ------------------------------------------------------------------ */

test('lesson: an unrepairable component fails alone — the rest still publishes (partial publish)', async () => {
  const brokenFe = structuredClone(feGen);
  brokenFe.expression = `(${feGen.expression}) + 1`;
  const { storageDir, jobId, done, client } = startLesson(DRAG, {
    kit: { formula_explorer: brokenFe, quiz_cards: quizGen },
    kitRepair: { formula_explorer_repair: brokenFe }, // the "repair" never fixes it
  });
  const summary = await done;
  assert.equal(summary.status, 'succeeded', 'overview + a passed component = succeeded');
  assert.deepEqual(summary.lesson, {
    overviewReady: true, componentsPlanned: 2, componentsPublished: 1, componentsFailed: 1, partialPublish: true,
  });
  assert.equal(summary.totalCostUSD, 0.05, 'analysis + 2 components + 2 failed repairs');
  assert.equal(summary.componentRepairs?.length, 2);
  assert.deepEqual(summary.componentRepairs?.map(r => [r.attempt, r.revision, r.passed]), [[1, 2, false], [2, 3, false]]);
  assert.ok(summary.componentRepairs?.[0]?.remaining.includes('FE-08'));

  const lesson = readRunFile(storageDir, jobId, 'lesson.json') as LessonSpec;
  const feEntry = lesson.components.find(c => c.componentId === 'formula-explorer-v1');
  assert.equal(feEntry?.status, 'failed');
  assert.equal(feEntry?.revision, 3);
  assert.match(feEntry?.reason ?? '', /^FE-08: /);

  const events = readEvents(storageDir, jobId);
  assert.match(events[events.length - 1]?.detail ?? '', /partial publish/);
  const feFailed = events.filter(e => e.componentId === 'formula-explorer-v1' && e.stage === 'component' && e.status === 'failed');
  assert.deepEqual(feFailed.map(e => e.revision), [1, 2, 3]);

  const detail = readJob(storageDir, jobId);
  assert.ok(detail !== null);
  assert.deepEqual(Object.keys(detail.kitSpecs ?? {}), [`${jobId}:quiz-cards-v1:r1`], 'failed specs are NEVER served');
  assert.deepEqual(Object.keys(detail.componentReports ?? {}).sort(), [
    `${jobId}:formula-explorer-v1:r3`, `${jobId}:quiz-cards-v1:r1`,
  ]);
  assert.equal(detail.componentReports?.[`${jobId}:formula-explorer-v1:r3`]?.publishable, false);
  void client;
});

/* ------------------------------------------------------------------ */
/* OUTPUT_INVALID is component-level; MetaError is fatal                */
/* ------------------------------------------------------------------ */

test('lesson: schema-invalid component output fails that component only (receipt accounted), the lesson still publishes', async () => {
  const { storageDir, jobId, done } = startLesson(DRAG, {
    kit: { formula_explorer: { schemaVersion: 'formula-explorer-v1' }, quiz_cards: quizGen },
  });
  const summary = await done;
  assert.equal(summary.status, 'succeeded');
  assert.equal(summary.totalCostUSD, 0.03, 'the billed-but-invalid generation call is accounted (F-01)');
  assert.equal(summary.lesson?.componentsPublished, 1);
  assert.equal(summary.lesson?.componentsFailed, 1);
  assert.equal(summary.lesson?.partialPublish, true);

  const lesson = readRunFile(storageDir, jobId, 'lesson.json') as LessonSpec;
  const feEntry = lesson.components.find(c => c.componentId === 'formula-explorer-v1');
  assert.equal(feEntry?.status, 'failed');
  assert.equal(feEntry?.reason, 'The model returned output that does not match the required structure.');
  assert.equal(feEntry?.revision, 1);

  const events = readEvents(storageDir, jobId);
  const feFailed = events.find(e => e.componentId === 'formula-explorer-v1' && e.status === 'failed');
  assert.equal(feFailed?.stage, 'component');
  assert.equal(feFailed?.detail, 'OUTPUT_INVALID');
  assert.equal(feFailed?.estCostUSD, 0.01, 'the failure event carries the accounted receipt');
});

test('lesson: a provider MetaError during a component call fails the whole job with its fixed code', async () => {
  const { storageDir, jobId, done } = startLesson(DRAG, {
    kit: { formula_explorer: feGen },
    throwOn: { quiz_cards: new MetaError('BUDGET_EXCEEDED') },
  });
  const summary = await done;
  assert.equal(summary.status, 'failed');
  assert.deepEqual(summary.error, { code: 'BUDGET_EXCEEDED', message: 'budget exceeded' });
  // analysis + fe + the (unbilled) budget refusal — all accounted through the accumulator.
  assert.equal(summary.totalCostUSD, 0.02);
  const events = readEvents(storageDir, jobId);
  const last = events[events.length - 1];
  assert.equal(last?.stage, 'component');
  assert.equal(last?.status, 'failed');
  assert.equal(last?.componentId, 'quiz-cards-v1');
  assert.equal(last?.detail, 'BUDGET_EXCEEDED');
});

/* ------------------------------------------------------------------ */
/* Concurrency 2, plan-order events                                     */
/* ------------------------------------------------------------------ */

test('lesson: three components run in plan order at most 2 concurrently; the third starts only when a slot frees', async () => {
  const analysis3 = structuredClone(usableAnalysis);
  analysis3.componentPlan = [
    ...usableAnalysis.componentPlan,
    {
      componentId: 'concept-map-v1',
      pedagogicalReason: 'Shows how the drag factors connect as a map.',
      focusQuote: usableAnalysis.overview.keyTerms[1].quote,
      focusSourceId: DRAG,
    },
  ];
  let active = 0;
  let peak = 0;
  const order: string[] = [];
  const { storageDir, jobId, done } = startLesson(
    DRAG,
    {
      analysis: analysis3,
      kit: { formula_explorer: feGen, quiz_cards: quizGen, concept_map: cmGen },
      delayMs: { formula_explorer: 80, quiz_cards: 5, concept_map: 5 },
    },
    {
      jobId: 'lesson-concurrency-01',
      hooks: {
        onStart: name => {
          active += 1;
          peak = Math.max(peak, active);
          order.push(`start:${name}`);
        },
        onEnd: () => {
          active -= 1;
        },
      },
    },
  );
  const summary = await done;
  assert.equal(summary.status, 'succeeded');
  assert.equal(summary.lesson?.componentsPublished, 3);
  assert.ok(peak <= 2, `peak concurrency was ${peak}, expected <= 2`);
  assert.equal(peak, 2, 'the pool actually uses both slots');
  assert.deepEqual(order, [
    'start:source_analysis_v2',
    'start:formula_explorer',
    'start:quiz_cards',
    'start:concept_map',
  ], 'plan order; concept_map waits for a free slot');

  const events = readEvents(storageDir, jobId);
  const starts = events.filter(e => e.stage === 'component' && e.status === 'started');
  assert.deepEqual(starts.map(e => e.componentId), ['formula-explorer-v1', 'quiz-cards-v1', 'concept-map-v1']);
  const quizDone = events.findIndex(e => e.componentId === 'quiz-cards-v1' && e.stage === 'component' && e.status === 'succeeded');
  const cmStart = events.findIndex(e => e.componentId === 'concept-map-v1' && e.stage === 'component' && e.status === 'started');
  assert.ok(quizDone >= 0 && cmStart > quizDone, 'the third component starts after the fast one finished');
  const lesson = readRunFile(storageDir, jobId, 'lesson.json') as LessonSpec;
  assert.deepEqual(lesson.components.map(c => c.componentId), ['formula-explorer-v1', 'quiz-cards-v1', 'concept-map-v1']);
  void jobId;
});

/* ------------------------------------------------------------------ */
/* v1 activity flow unchanged through the same worker entry             */
/* ------------------------------------------------------------------ */

test('flow default: startJob without flow keeps the v1 activity pipeline', async () => {
  const genFixture = JSON.parse(
    readFileSync(new URL('../../tests/fixtures/nasa-gen.recorded.json', import.meta.url), 'utf8'),
  );
  const analysisFixture = JSON.parse(
    readFileSync(new URL('../../tests/fixtures/nasa-analysis.recorded.json', import.meta.url), 'utf8'),
  );
  const client: MetaClient = {
    complete: async <T,>(req: CompleteRequest): Promise<{ data: T; receipt: MetaReceipt }> => {
      const data = req.schemaName === 'source_analysis' ? analysisFixture : genFixture;
      return { data: structuredClone(data) as T, receipt: fakeReceipt('v1-call') };
    },
  };
  const storageDir = tempStorage();
  const { jobId, done } = startJob('nasa-grc-equations-of-motion', {
    client,
    storageDir,
    purpose: 'test-live',
    newJobId: () => 'activity-default-01',
  });
  const summary = await done;
  assert.equal(summary.status, 'succeeded');
  assert.equal(summary.flow, 'activity');
  assert.equal(summary.lesson, undefined);
  assert.equal(summary.specId, `nasa-grc-equations-of-motion-${jobId}`.slice(0, 64));
  const detail = readJob(storageDir, jobId);
  assert.ok(detail !== null);
  assert.equal(detail.analysisV2, undefined, 'no lesson fields on an activity job');
  assert.equal(detail.lesson, undefined);
  assert.equal(detail.kitSpecs, undefined);
  assert.ok(detail.spec !== undefined);
});
