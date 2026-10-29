// S6-W — premium engines inside a lesson (frozen contract): the worker adapts the v2 analysis
// into the v1 SourceAnalysis the premium generator needs, validates it with the v1
// validateAnalysis BEFORE any paid call, and only then runs the unchanged v1
// generateSpec/repairSpec path. A failing adaptation SKIPS the premium entry with a plain
// reason and spends nothing. Fake MetaClient + real licensed sources; no network, no credits.
//
// The declaration analysis/quiz below are hand-written TEST DATA quoting the public-domain
// nara-declaration-of-independence page (fixture-shaped, not model output); the timeline gen
// is the recorded Stage 5b fixture also used by jobs.timeline.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readJob, startJob } from './jobs.ts';
import type { JobStageEvent, JobSummary } from './jobs.ts';
import type { CompleteRequest, MetaClient } from '../../packages/meta/client.ts';
import type { MetaReceipt } from '../../packages/contracts/index.ts';
import type { LessonSpec, SourceAnalysisV2 } from '../../packages/contracts/kit.ts';

const DECL = 'nara-declaration-of-independence';
const JOB = 'lesson-premium-00000001';

const timelineGen = JSON.parse(
  readFileSync(new URL('../../tests/fixtures/timeline.declaration.gen.json', import.meta.url), 'utf8'),
);
const quizGen = JSON.parse(
  readFileSync(new URL('../../tests/fixtures/stage6/quiz-cards.gen.json', import.meta.url), 'utf8'),
);

const Q1 = 'The Continental Congress adopted the Declaration of Independence on July 4, 1776.';
const Q2 = 'Congress appointed on June 10 a committee of five to draft a statement of independence';
const Q3 = 'Jefferson drafted the statement between June 11 and 28';
const Q4 = 'with the actual writing delegated to Jefferson';

function declarationAnalysis(): SourceAnalysisV2 {
  return {
    analysisVersion: 2,
    subject: 'history',
    usable: true,
    declineCode: '',
    declineSummary: '',
    pageCoverage: 'The page traces the drafting, adoption, printing and signing of the Declaration of Independence.',
    overview: {
      headline: 'Adoption and signing of the Declaration were separate events.',
      keyPoints: [
        { id: 'adoption-date', point: 'Congress adopted the Declaration of Independence in July 1776.', sourceId: DECL, quote: Q1 },
        { id: 'committee-of-five', point: 'A committee of five was appointed to draft the statement.', sourceId: DECL, quote: Q2 },
        { id: 'jefferson-drafted', point: 'Jefferson drafted the statement between June 11 and 28.', sourceId: DECL, quote: Q3 },
      ],
      keyTerms: [
        { id: 'continental-congress', term: 'Continental Congress', gloss: 'The congress that adopted the declaration.', sourceId: DECL, quote: Q1 },
        { id: 'committee-of-five', term: 'committee of five', gloss: 'The five-member committee appointed to draft the statement.', sourceId: DECL, quote: Q2 },
        { id: 'jefferson', term: 'Jefferson', gloss: 'Jefferson did the actual writing.', sourceId: DECL, quote: Q4 },
      ],
    },
    componentPlan: [
      { componentId: 'timeline-v1', pedagogicalReason: 'Dated events from June through August suit an ordered timeline.', focusQuote: Q1, focusSourceId: DECL },
      { componentId: 'quiz-cards-v1', pedagogicalReason: 'Checks who drafted the statement and when it was adopted.', focusQuote: Q4, focusSourceId: DECL },
    ],
  };
}

/** Declaration-page quiz golden (hand-written test data; passes Q-01..Q-07 against the page). */
function declarationQuiz(): unknown {
  return {
    schemaVersion: 'quiz-cards-v1',
    title: 'Declaration drafting quiz',
    cards: [
      { id: 'adoption-date-card', stem: 'When did Congress adopt the Declaration of Independence?', options: ['July 4, 1776', 'June 10, 1776', 'August 2, 1776'], sourceId: DECL, quote: Q1, hint: '' },
      { id: 'committee-size-card', stem: 'How many members were on the committee appointed to draft the statement?', options: ['five', 'seven', 'twelve'], sourceId: DECL, quote: Q2, hint: '' },
      { id: 'writer-card', stem: 'Who did the actual writing of the statement?', options: ['Jefferson', 'Adams', 'Franklin'], sourceId: DECL, quote: Q4, hint: '' },
    ],
  };
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

interface FakeOpts {
  analysis?: unknown;
  kit?: Record<string, unknown>;
  activitySpec?: unknown;
}

function fakeClient(opts: FakeOpts): MetaClient & { calls: string[] } {
  const calls: string[] = [];
  let n = 0;
  return {
    calls,
    complete: async <T,>(req: CompleteRequest): Promise<{ data: T; receipt: MetaReceipt }> => {
      calls.push(req.schemaName);
      let data: unknown;
      if (req.schemaName === 'source_analysis_v2') {
        data = opts.analysis ?? declarationAnalysis();
      } else if (req.schemaName === 'activity_spec') {
        data = opts.activitySpec;
      } else {
        data = opts.kit?.[req.schemaName];
      }
      if (data === undefined) {
        throw new Error(`FAKE_MISSING_RESPONSE:${req.schemaName}`);
      }
      n += 1;
      return { data: structuredClone(data) as T, receipt: fakeReceipt(`${req.schemaName}-${n}`) };
    },
  };
}

function tempStorage(): string {
  return mkdtempSync(join(tmpdir(), 's6w-premium-'));
}

function readEvents(storageDir: string, jobId: string): JobStageEvent[] {
  return readFileSync(join(storageDir, 'runs', jobId, 'events.jsonl'), 'utf8')
    .split('\n')
    .filter(line => line.trim() !== '')
    .map(line => JSON.parse(line) as JobStageEvent);
}

test('lesson premium: timeline-v1 runs through the v1 adapter and publishes beside the overview and a kit quiz', async () => {
  const client = fakeClient({ kit: { quiz_cards: declarationQuiz() }, activitySpec: timelineGen });
  const storageDir = tempStorage();
  const { jobId, done } = startJob(
    DECL,
    { client, storageDir, purpose: 'test-live', flow: 'lesson', newJobId: () => JOB },
  );
  const summary: JobSummary = await done;

  assert.equal(summary.status, 'succeeded');
  assert.deepEqual(summary.lesson, {
    overviewReady: true, componentsPlanned: 2, componentsPublished: 2, componentsFailed: 0, partialPublish: false,
  });
  assert.equal(summary.engine, 'timeline-v1');
  const premiumSpecId = `${DECL}-${JOB}`.slice(0, 64);
  assert.equal(summary.specId, premiumSpecId);
  assert.equal(summary.publishable, true);
  assert.equal(summary.publishedRevision, 1);
  assert.equal(summary.revisions, 1);
  assert.deepEqual(summary.repairs, []);
  assert.equal(summary.totalCostUSD, 0.03, 'analysis + premium + quiz');
  assert.ok(client.calls.includes('activity_spec'), 'the unchanged v1 generateSpec ran');

  const runDir = join(storageDir, 'runs', jobId);
  assert.ok(existsSync(join(runDir, 'spec.r1.json')), 'the premium spec keeps the v1 file names');
  assert.ok(existsSync(join(runDir, 'report.r1.json')));
  assert.ok(existsSync(join(runDir, 'quiz-cards-v1.r1.json')));

  const lesson = JSON.parse(readFileSync(join(runDir, 'lesson.json'), 'utf8')) as LessonSpec;
  assert.deepEqual(
    lesson.components.map(c => [c.componentId, c.status, c.specId, c.revision]),
    [
      ['timeline-v1', 'passed', premiumSpecId, 1],
      ['quiz-cards-v1', 'passed', `${JOB}:quiz-cards-v1:r1`, 1],
    ],
  );
  assert.ok(lesson.overview !== null);

  // The premium activity is served through the EXISTING v1 detail fields, unchanged.
  const detail = readJob(storageDir, jobId);
  assert.ok(detail !== null);
  const spec = detail.spec as { id: string; simulation: { engine: string } };
  assert.equal(spec.id, premiumSpecId);
  assert.equal(spec.simulation.engine, 'timeline-v1');
  assert.equal((detail.report as { publishable: boolean }).publishable, true);
  assert.deepEqual(detail.revisions.map(r => r.revision), [1]);
  // kitSpecs holds the kit component only — the premium spec travels in `spec`.
  assert.deepEqual(Object.keys(detail.kitSpecs ?? {}), [`${JOB}:quiz-cards-v1:r1`]);

  const events = readEvents(storageDir, jobId);
  const timelineEvents = events.filter(e => e.componentId === 'timeline-v1');
  assert.deepEqual(
    timelineEvents.map(e => `${e.stage}:${e.status}`),
    ['component:started', 'component:succeeded'],
  );
  assert.equal(events[events.length - 1]?.stage, 'done');
});

test('lesson premium: an adapted analysis that fails v1 validation SKIPS the premium with a plain reason and no paid call', async () => {
  // The wedge: a key point mentioning NASA passes the v2 A-checks on this source (its
  // publisher tokens are the National Archives phrases) but fails the v1
  // policy.no-publisher-attribution on the adapted analysis.
  const analysis = declarationAnalysis();
  analysis.overview.keyPoints[2].point = 'NASA notes that Jefferson drafted the statement.';
  const client = fakeClient({ analysis, kit: { quiz_cards: declarationQuiz() } });
  const storageDir = tempStorage();
  const { jobId, done } = startJob(
    DECL,
    { client, storageDir, purpose: 'test-live', flow: 'lesson', newJobId: () => 'lesson-premium-skip01' },
  );
  const summary = await done;

  assert.equal(summary.status, 'succeeded', 'a skipped premium never fails the lesson');
  assert.ok(!client.calls.includes('activity_spec'), 'NO paid premium call after a failed adaptation');
  assert.deepEqual(client.calls.sort(), ['quiz_cards', 'source_analysis_v2']);
  assert.equal(summary.engine, null, 'no engine was attempted');
  assert.equal(summary.totalCostUSD, 0.02);
  assert.deepEqual(summary.lesson, {
    overviewReady: true, componentsPlanned: 2, componentsPublished: 1, componentsFailed: 1, partialPublish: true,
  });

  const lesson = JSON.parse(
    readFileSync(join(storageDir, 'runs', jobId, 'lesson.json'), 'utf8'),
  ) as LessonSpec;
  const premiumEntry = lesson.components.find(c => c.componentId === 'timeline-v1');
  assert.equal(premiumEntry?.status, 'skipped');
  assert.equal(premiumEntry?.revision, 0);
  assert.match(premiumEntry?.reason ?? '', /skipped/i);
  assert.match(premiumEntry?.reason ?? '', /policy\.no-publisher-attribution/);
  assert.ok(!existsSync(join(storageDir, 'runs', jobId, 'spec.r1.json')));

  const events = readEvents(storageDir, jobId);
  assert.ok(!events.some(e => e.componentId === 'timeline-v1'), 'a skipped premium emits no component events');

  const detail = readJob(storageDir, jobId);
  assert.ok(detail !== null);
  assert.equal(detail.spec, undefined);
});
