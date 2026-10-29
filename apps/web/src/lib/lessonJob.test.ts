/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { STAGE6_CHECK_IDS, checkIdsFor } from '../../../../packages/contracts/kit.ts';
import type { JobDetail } from '../api.ts';
import {
  buildLessonRepairs, buildLessonSteps, buildLessonStream, createJobBody, diffAnalysisV2, isLessonJob, lessonCheckName, lessonRenderMode,
  lessonRunTags, lessonStatusLabel, normaliseJobDetail, overviewFromAnalysis, parseJobSummary, parseLessonData, parseLessonProgress,
  stage6CheckName, lessonAnalysisSteps, lessonAnalysisOverall, lessonCheckSections, lessonRepairSummary,
} from './lessonJob.ts';
import { LESSON_SCENARIOS, legacyWire, lessonWire, premiumWire } from './lessonJobFixtures.ts';
import type { LessonScenario } from './lessonJobFixtures.ts';
import { buildAnalysisRepairSteps } from './analysisRepairs.ts';
import { lessonCards, lessonItems } from './lesson.ts';

const detail = (s: LessonScenario): JobDetail => normaliseJobDetail(lessonWire(s));
const stream = (s: LessonScenario) => buildLessonStream(detail(s));
const states = (s: LessonScenario): string[] => stream(s).slots.map((x) => `${x.componentId}:${x.state}`);

// ---- parsing ---------------------------------------------------------------------------------------------------

test('a recorded pre-Stage-6 job has no lesson data and keeps its fields', () => {
  const d = normaliseJobDetail(legacyWire());
  assert.equal(isLessonJob(d), false);
  assert.equal(d.lessonData, undefined);
  assert.equal(d.summary.status, 'unsupported');
  assert.equal(d.events.length, 1);
  assert.equal(lessonRenderMode(d), 'v1');
});

test('every fixture scenario parses to lesson data', () => {
  for (const s of LESSON_SCENARIOS) {
    const d = detail(s);
    assert.equal(isLessonJob(d), true, s);
    assert.notEqual(d.lessonData, undefined, s);
  }
});

test('a complete lesson detail parses analysis, lesson, specs, reports and repairs', () => {
  const data = detail('complete').lessonData;
  assert.ok(data);
  assert.equal(data.analysis?.usable, true);
  assert.equal(data.lesson?.components.length, 3);
  assert.deepEqual(data.lesson?.components.map((c) => c.status), ['passed', 'passed', 'passed']);
  assert.equal(Object.keys(data.kitSpecs).length, 3);
  assert.equal(Object.keys(data.componentReports).length, 3);
  assert.deepEqual(data.componentRepairs, []);
  assert.equal(data.analysisRevisions.length, 1);
});

test('garbage in the lesson fields becomes safe defaults, never a throw', () => {
  const raw = {
    summary: { jobId: 'j', sourceId: 's', status: 'running', purpose: 'demo', createdAt: 'x', totalCostUSD: 0, flow: 'lesson' },
    events: 'nope', analysisV2: { analysisVersion: 1 }, analysisV2Revisions: [5, { revision: 'a' }, { revision: 2 }], lesson: 5,
    kitSpecs: [1, 2], componentReports: 'x', componentRepairs: [{ componentId: 3 }, null, 'x'],
  };
  const d = normaliseJobDetail(raw);
  const data = d.lessonData;
  assert.ok(data);
  assert.equal(data.analysis, null);
  assert.equal(data.lesson, null);
  assert.deepEqual(data.kitSpecs, {});
  assert.deepEqual(data.componentReports, {});
  assert.deepEqual(data.componentRepairs, []);
  assert.deepEqual(d.events, []);
  assert.deepEqual(data.analysisRevisions.map((r) => r.revision), [2]);
  assert.equal(lessonRenderMode(d), 'working');
});

test('lesson entries with unknown components or statuses are dropped; specs for another component are dropped', () => {
  const w = lessonWire('complete');
  const lesson = w.lesson as { components: Array<Record<string, unknown>> };
  lesson.components.push({ componentId: 'mystery-v9', specId: 'x', status: 'passed', reason: '', revision: 1 });
  lesson.components.push({ componentId: 'sequence-v1', specId: 'y', status: 'weird', reason: '', revision: 1 });
  const specs = w.kitSpecs as Record<string, Record<string, unknown>>;
  specs.bogus = { id: 'bogus', componentId: 'not-a-component' };
  const data = normaliseJobDetail(w).lessonData;
  assert.deepEqual(data?.lesson?.components.map((c) => c.componentId), ['formula-explorer-v1', 'quiz-cards-v1', 'concept-map-v1']);
  assert.equal(Object.keys(data?.kitSpecs ?? {}).length, 3);
});

test('flow "activity" is never a lesson job, and unknown flow values are dropped', () => {
  const w = { ...legacyWire(), summary: { ...(legacyWire().summary as object), flow: 'activity' }, lesson: { overview: null, components: [] } };
  assert.equal(isLessonJob(normaliseJobDetail(w)), false);
  assert.equal(parseJobSummary({ ...(legacyWire().summary as object), flow: 'bogus' }).flow, undefined);
  assert.equal(parseJobSummary({ ...(legacyWire().summary as object), flow: 'lesson' }).flow, 'lesson');
  // lesson fields without a flow still mean a lesson job (older records written mid-rollout)
  assert.equal(isLessonJob(normaliseJobDetail({ ...legacyWire(), analysisV2: null, lesson: null })), true);
});

test('lesson progress is coerced to safe counts', () => {
  assert.equal(parseLessonProgress('x'), null);
  assert.deepEqual(parseLessonProgress({ overviewReady: 1, componentsPlanned: -2, componentsPublished: 2.7, componentsFailed: 'a', partialPublish: true }),
    { overviewReady: false, componentsPlanned: 0, componentsPublished: 2, componentsFailed: 0, partialPublish: true });
  assert.deepEqual(parseLessonProgress({ overviewReady: true, componentsPlanned: 3, componentsPublished: 3, componentsFailed: 0, partialPublish: false })?.componentsPlanned, 3);
  assert.deepEqual(parseJobSummary({ jobId: 'a', status: 'running', flow: 'lesson', lesson: { overviewReady: true, componentsPlanned: 2 } }).lesson?.overviewReady, true);
  assert.equal(parseLessonData({ summary: {} }), null);
});

test('the submit body always names the flow, lesson by default', () => {
  assert.deepEqual(createJobBody('src-1'), { sourceId: 'src-1', flow: 'lesson' });
  assert.deepEqual(createJobBody('src-1', 'fabricated-quote', 'muse-spark-open', 'activity'), { sourceId: 'src-1', flow: 'activity', demoFault: 'fabricated-quote', model: 'muse-spark-open' });
});

// ---- the streaming state --------------------------------------------------------------------------------------

test('before the overview arrives nothing is shown and no component is listed', () => {
  for (const s of ['analysing', 'analysed'] as const) {
    const st = stream(s);
    assert.equal(st.phase, 'analysing', s);
    assert.equal(st.overview, null, s);
    assert.deepEqual(st.slots, [], s);
  }
  assert.equal(lessonRenderMode(detail('analysing')), 'working');
  assert.equal(lessonRenderMode(detail('analysed')), 'working');
});

test('the overview shows as soon as the overview event arrives, built from the analysis if lesson.json is not stored yet', () => {
  const st = stream('overview-ready');
  assert.equal(st.phase, 'overview-ready');
  assert.ok(st.overview);
  assert.equal(st.overview.headline, detail('overview-ready').lessonData?.analysis?.overview.headline);
  assert.deepEqual(states('overview-ready'), ['formula-explorer-v1:queued', 'quiz-cards-v1:queued', 'concept-map-v1:queued']);
  assert.equal(lessonRenderMode(detail('overview-ready')), 'lesson');
});

test('component events drive the placeholders, then components fill in as they pass', () => {
  assert.deepEqual(states('building'), ['formula-explorer-v1:building', 'quiz-cards-v1:building', 'concept-map-v1:queued']);
  assert.equal(stream('building').phase, 'building');
  assert.deepEqual(states('one-done'), ['formula-explorer-v1:passed', 'quiz-cards-v1:building', 'concept-map-v1:building']);
  assert.deepEqual(states('two-done'), ['formula-explorer-v1:passed', 'quiz-cards-v1:passed', 'concept-map-v1:building']);
  assert.deepEqual(states('complete'), ['formula-explorer-v1:passed', 'quiz-cards-v1:passed', 'concept-map-v1:passed']);
  assert.equal(stream('complete').phase, 'complete');
  assert.deepEqual(stream('complete').pending, []);
  assert.deepEqual(stream('one-done').pending.map((p) => p.componentId), ['quiz-cards-v1', 'concept-map-v1']);
});

test('placeholders say what is happening in plain words', () => {
  const b = stream('building').pending;
  assert.equal(b[0]?.message, 'Muse is building this…');
  assert.match(b[2]?.message ?? '', /waiting|turn/i);
  assert.equal(b[0]?.label, 'Formula explorer');
});

test('a component that failed a check and is being repaired shows a repairing placeholder', () => {
  const w = lessonWire('building');
  const ev = w.events as Array<Record<string, unknown>>;
  const base = { jobId: 'job-lesson-building', model: 'muse-spark-1.3', at: '2026-10-29T10:00:30.000Z' };
  ev.push({ ...base, seq: 90, stage: 'component', status: 'failed', componentId: 'quiz-cards-v1', revision: 1 });
  ev.push({ ...base, seq: 91, stage: 'repair', status: 'started', target: 'component', componentId: 'quiz-cards-v1', revision: 2 });
  const st = buildLessonStream(normaliseJobDetail(w));
  const quiz = st.slots.find((x) => x.componentId === 'quiz-cards-v1');
  assert.equal(quiz?.state, 'repairing');
  assert.match(quiz?.message ?? '', /repair/i);
});

test('a passed entry whose spec is not stored yet stays a placeholder while the job runs', () => {
  const w = lessonWire('one-done');
  w.kitSpecs = {};
  const st = buildLessonStream(normaliseJobDetail(w));
  assert.equal(st.slots[0]?.state, 'building');
});

test('a finished lesson never leaves placeholders: a planned component with no entry is not built', () => {
  const w = lessonWire('complete');
  (w.lesson as { components: unknown[] }).components.pop();
  const st = buildLessonStream(normaliseJobDetail(w));
  assert.equal(st.slots[2]?.state, 'skipped');
  assert.deepEqual(st.pending, []);
});

test('partial publish: failed components show only their message, dropped items keep a note', () => {
  assert.deepEqual(states('partial'), ['formula-explorer-v1:failed', 'quiz-cards-v1:passed', 'concept-map-v1:passed']);
  const st = stream('partial');
  assert.equal(st.phase, 'complete');
  assert.match(st.lesson.components[2]?.reason ?? '', /left out/);
});

test('declined and failed lessons', () => {
  const dec = stream('declined');
  assert.equal(dec.phase, 'declined');
  assert.equal(dec.overview, null);
  assert.equal(lessonRenderMode(detail('declined')), 'lesson');
  assert.equal(stream('failed').phase, 'failed');
  assert.equal(lessonRenderMode(detail('failed')), 'outcome');
  // declined status but the analysis is missing: fall back to the plain outcome view
  const w = lessonWire('declined');
  w.analysisV2 = null;
  assert.equal(lessonRenderMode(normaliseJobDetail(w)), 'outcome');
});

test('the premium activity inside a lesson is mounted from the v1 spec field', async () => {
  const d = normaliseJobDetail(await premiumWire());
  assert.equal(lessonRenderMode(d), 'lesson');
  const st = buildLessonStream(d);
  assert.equal(st.slots[0]?.componentId, 'timeline-v1');
  assert.equal(st.slots[0]?.state, 'passed');
  // without the v1 spec the premium component cannot be shown yet
  const noSpec = { ...(await premiumWire()) };
  delete noSpec.spec;
  assert.equal(buildLessonStream(normaliseJobDetail({ ...noSpec, summary: { ...(noSpec.summary as object), status: 'running' } })).slots[0]?.state, 'building');
});

test('overviewFromAnalysis copies the analysis overview and refuses a declined analysis', () => {
  const a = detail('overview-ready').lessonData?.analysis;
  assert.ok(a);
  const ov = overviewFromAnalysis(a, 'job-x');
  assert.equal(ov?.componentId, 'overview-v1');
  assert.equal(ov?.keyPoints.length, a.overview.keyPoints.length);
  assert.equal(overviewFromAnalysis({ ...a, usable: false }, 'job-x'), null);
});

// ---- the steps ------------------------------------------------------------------------------------------------

const labels = (s: LessonScenario): string[] => buildLessonSteps(detail(s)).map((x) => x.label);
const stepOf = (s: LessonScenario, label: string) => {
  const step = buildLessonSteps(detail(s)).find((x) => x.label === label);
  assert.ok(step, `${s}: no step ${label}`);
  return step;
};

test('a complete lesson has the five kinds of step in order', () => {
  assert.deepEqual(labels('complete'), ['Analyse page', 'Overview ready', 'Formula explorer', 'Quiz cards', 'Concept map', 'Published']);
  const steps = buildLessonSteps(detail('complete'));
  assert.ok(steps.every((x) => x.status === 'succeeded'));
  assert.equal(steps[5]?.detail, '3 of 3 components');
  assert.equal(steps[2]?.outcome, 'passed');
  assert.ok((steps[0]?.costUSD ?? 0) > 0);
  assert.equal(steps[0]?.model, 'muse-spark-1.3');
  assert.equal(steps[1]?.model, null);
});

test('steps while the lesson is being built', () => {
  assert.deepEqual(buildLessonSteps(detail('analysing')).map((x) => `${x.label}:${x.status}`), ['Analyse page:running', 'Overview ready:pending', 'Published:pending']);
  assert.deepEqual(buildLessonSteps(detail('building')).map((x) => `${x.label}:${x.status}`),
    ['Analyse page:succeeded', 'Overview ready:succeeded', 'Formula explorer:running', 'Quiz cards:running', 'Concept map:pending', 'Published:pending']);
  assert.deepEqual(buildLessonSteps(detail('overview-ready')).map((x) => `${x.label}:${x.status}`),
    ['Analyse page:succeeded', 'Overview ready:succeeded', 'Formula explorer:pending', 'Quiz cards:pending', 'Concept map:pending', 'Published:pending']);
});

test('component steps say passed, repaired, dropped items or could not be verified', () => {
  const partial = buildLessonSteps(detail('partial'));
  const get = (label: string) => partial.find((x) => x.label === label);
  assert.equal(get('Formula explorer')?.status, 'failed');
  assert.equal(get('Formula explorer')?.outcome, 'unverified');
  assert.match(get('Formula explorer')?.detail ?? '', /could not be checked with our calculator/);
  assert.equal(get('Quiz cards')?.outcome, 'passed');
  assert.equal(get('Concept map')?.outcome, 'dropped');
  assert.match(get('Concept map')?.detail ?? '', /left out/);
  assert.equal(get('Published')?.detail, '2 of 3 components, 1 left out');
  assert.equal(stepOf('repaired', 'Quiz cards').outcome, 'repaired');
  assert.match(stepOf('repaired', 'Quiz cards').detail, /repaired by Muse/i);
});

test('an analysis repair adds its own step, labelled natural', () => {
  const l = labels('repaired');
  assert.deepEqual(l.slice(0, 3), ['Analyse page', 'Repair analysis · attempt 1', 'Overview ready']);
  const rep = stepOf('repaired', 'Repair analysis · attempt 1');
  assert.equal(rep.status, 'succeeded');
  assert.ok(rep.tags.some((t) => t.text.includes('Natural repair')));
});

test('a system-made demo fault is labelled on the component step', () => {
  const quiz = stepOf('system-fault', 'Quiz cards');
  assert.equal(quiz.outcome, 'repaired');
  assert.ok(quiz.tags.some((t) => t.tone === 'fault' && /system-made/i.test(t.text)));
  assert.match(quiz.detail, /system-made fault/i);
});

test('declined and failed lessons: no invented rows', () => {
  assert.deepEqual(buildLessonSteps(detail('declined')).map((x) => `${x.label}:${x.status}`), ['Analyse page:succeeded', 'No lesson built:skipped']);
  assert.deepEqual(buildLessonSteps(detail('failed')).map((x) => `${x.label}:${x.status}`), ['Analyse page:failed']);
});

test('step times and costs come only from the events that exist', () => {
  const s = stepOf('complete', 'Formula explorer');
  assert.equal(s.durationMs, 8500);
  assert.ok(Math.abs((s.costUSD ?? 0) - 0.0211) < 1e-9);
  assert.equal(stepOf('overview-ready', 'Formula explorer').costUSD, null);
});

// ---- repair cards ---------------------------------------------------------------------------------------------

test('a natural component repair is labelled natural, with readable check names', () => {
  const cards = buildLessonRepairs(detail('repaired'));
  assert.equal(cards.length, 1);
  const c = cards[0];
  assert.equal(c?.componentId, 'quiz-cards-v1');
  assert.equal(c?.origin, 'natural');
  assert.equal(c?.badge.text, 'Natural repair (Muse’s own mistake)');
  assert.deepEqual(c?.targeted.map((t) => t.id), ['Q-02']);
  assert.equal(c?.targeted[0]?.name, 'The right answer is supported by the quote');
  assert.equal(c?.state, 'passed');
  assert.deepEqual(c?.remaining, []);
});

test('a repair after an injected demo fault is labelled system-made', () => {
  const c = buildLessonRepairs(detail('system-fault'))[0];
  assert.equal(c?.origin, 'system');
  assert.equal(c?.badge.text, 'System-made fault, repaired by Muse');
  assert.equal(c?.badge.tone, 'fault');
  assert.equal(c?.targeted[0]?.name, 'Each card’s quote appears word for word on the page');
});

test('a repair that did not fix the problem says so and keeps the checker message', () => {
  const c = buildLessonRepairs(detail('partial'))[0];
  assert.equal(c?.state, 'still-failing');
  assert.equal(c?.origin, 'natural');
  assert.equal(c?.badge.tone, 'bad');
  assert.deepEqual(c?.remaining.map((r) => r.id), ['FE-08']);
  assert.match(c?.remaining[0]?.message ?? '', /FE-08/);
  assert.match(c?.outcome ?? '', /Not repaired/);
});

test('no repairs, no cards; a fault with no matching component stays natural', () => {
  assert.deepEqual(buildLessonRepairs(detail('complete')), []);
  const w = lessonWire('repaired');
  assert.equal(buildLessonRepairs(normaliseJobDetail(w))[0]?.origin, 'natural');
});

test('component repair cards carry the repair call cost and model', () => {
  const c = buildLessonRepairs(detail('repaired'))[0];
  assert.ok(Math.abs((c?.costUSD ?? 0) - 0.0149) < 1e-9);
  assert.equal(c?.model, 'muse-spark-1.3');
});

// ---- analysis repairs for v2 ----------------------------------------------------------------------------------

test('a v2 analysis repair is diffed in words', () => {
  const revs = detail('repaired').lessonData?.analysisRevisions ?? [];
  const changes = diffAnalysisV2(revs[0]?.analysis, revs[1]?.analysis);
  assert.ok(changes.length >= 1);
  assert.equal(changes[0]?.kind, 'point-quote');
  assert.match(changes[0]?.before ?? '', /not on the page/);
  assert.deepEqual(diffAnalysisV2(null, revs[1]?.analysis), []);
  assert.deepEqual(diffAnalysisV2(revs[1]?.analysis, revs[1]?.analysis), []);
});

test('the existing analysis repair steps work for v2 analyses with readable names', () => {
  const d = detail('repaired');
  const steps = buildAnalysisRepairSteps({
    revisions: d.lessonData?.analysisRevisions ?? [], events: d.events, nameOf: lessonCheckName, diff: diffAnalysisV2,
  });
  assert.equal(steps.length, 1);
  assert.equal(steps[0]?.state, 'passed');
  assert.equal(steps[0]?.failedBefore[0]?.id, 'A-05');
  assert.equal(steps[0]?.failedBefore[0]?.name, 'Overview quotes appear word for word on the page');
  assert.ok((steps[0]?.changes.length ?? 0) >= 1);
});

// ---- readable check names -------------------------------------------------------------------------------------

test('every Stage 6 check id has a plain-words name that is not the contract slug', () => {
  for (const id of STAGE6_CHECK_IDS) {
    const name = stage6CheckName(id);
    assert.ok(name !== null && name.length >= 8 && name.length <= 80, id);
    assert.ok(!/^[a-z0-9-]+$/.test(name), `${id}: "${name}" looks like a slug`);
    assert.ok(!name.includes(id), id);
  }
  for (const target of ['analysis', 'overview-v1', 'quiz-cards-v1', 'sequence-v1', 'sort-groups-v1', 'concept-map-v1', 'compare-table-v1', 'formula-explorer-v1', 'balance-equation-v1'] as const) {
    const names = checkIdsFor(target).map((id) => stage6CheckName(id));
    assert.equal(new Set(names).size, names.length, `${target}: duplicate names`);
  }
});

test('retired checks are named as retired; unknown ids have no name', () => {
  assert.match(stage6CheckName('A-02') ?? '', /retired/i);
  assert.match(stage6CheckName('BAL-06') ?? '', /retired/i);
  assert.equal(stage6CheckName('Z-99'), null);
  assert.equal(stage6CheckName('toString'), null);
  assert.equal(lessonCheckName('FE-08'), 'The expression matches the formula printed on the page');
  assert.equal(lessonCheckName('timeline.date-grounded'), 'Every date is stated in its quote');
  assert.equal(lessonCheckName('grounding.quotes'), 'Every quote appears in the source text');
  assert.equal(lessonCheckName('nope'), null);
});

// ---- run list -------------------------------------------------------------------------------------------------

test('run-list tags and status for lesson jobs', () => {
  const sum = (s: LessonScenario) => detail(s).summary;
  assert.deepEqual(lessonRunTags(sum('complete')).map((t) => t.text), ['Lesson · 3 components']);
  assert.deepEqual(lessonRunTags(sum('partial')).map((t) => t.text), ['Lesson · 2 components', 'Some parts left out']);
  assert.deepEqual(lessonRunTags(sum('building')).map((t) => t.text), ['Lesson · 3 components']);
  assert.deepEqual(lessonRunTags(sum('declined')).map((t) => t.text), ['Lesson']);
  assert.deepEqual(lessonRunTags(normaliseJobDetail(legacyWire()).summary), []);
  assert.deepEqual(lessonRunTags({ ...sum('complete'), flow: 'activity' }), []);
  const one = { ...sum('complete'), lesson: { overviewReady: true, componentsPlanned: 1, componentsPublished: 1, componentsFailed: 0, partialPublish: false } };
  assert.deepEqual(lessonRunTags(one).map((t) => t.text), ['Lesson · 1 component']);
  assert.equal(lessonStatusLabel(sum('complete'))?.text, 'Lesson ready');
  assert.equal(lessonStatusLabel(sum('partial'))?.text, 'Some parts left out');
  assert.equal(lessonStatusLabel(sum('declined'))?.text, 'Page declined');
  assert.equal(lessonStatusLabel(sum('building')), null);
  assert.equal(lessonStatusLabel(normaliseJobDetail(legacyWire()).summary), null);
});

// ---- the lesson body in plan order ------------------------------------------------------------------------------

test('settled cards and placeholders interleave in plan order', () => {
  const d = detail('one-done');
  const st = buildLessonStream(d);
  const cards = lessonCards(st.lesson, d.lessonData?.kitSpecs ?? {}, false);
  const items = lessonItems(cards, st.pending, st.order);
  assert.deepEqual(items.map((i) => `${i.kind}:${i.kind === 'card' ? i.card.componentId : i.slot.componentId}`),
    ['card:formula-explorer-v1', 'pending:quiz-cards-v1', 'pending:concept-map-v1']);
  // the second component finishing first does not reorder the lesson
  const d2 = detail('two-done');
  const st2 = buildLessonStream(d2);
  const items2 = lessonItems(lessonCards(st2.lesson, d2.lessonData?.kitSpecs ?? {}, false), st2.pending, st2.order);
  assert.deepEqual(items2.map((i) => i.kind), ['card', 'card', 'pending']);
});

test('a stored card the plan does not name is kept after the planned ones', () => {
  const d = detail('complete');
  const st = buildLessonStream(d);
  const cards = lessonCards(st.lesson, d.lessonData?.kitSpecs ?? {}, false);
  const items = lessonItems(cards, [], ['quiz-cards-v1']);
  assert.deepEqual(items.map((i) => (i.kind === 'card' ? i.card.componentId : '')), ['quiz-cards-v1', 'formula-explorer-v1', 'concept-map-v1']);
});

// ---- repair summary and the quiet checks list -------------------------------------------------------------------

test('analysis repair state for a lesson comes from the analysis revisions and events', () => {
  assert.deepEqual(lessonAnalysisOverall(lessonAnalysisSteps(detail('complete'))), { state: 'none', attempts: 0 });
  assert.deepEqual(lessonAnalysisOverall(lessonAnalysisSteps(detail('repaired'))), { state: 'passed', attempts: 1 });
  assert.equal(lessonAnalysisSteps(detail('repaired'))[0]?.failedBefore[0]?.name, 'Overview quotes appear word for word on the page');
});

test('the repair summary is natural, system-made, or failed, and absent when nothing was repaired', () => {
  assert.equal(lessonRepairSummary(detail('complete')), null);
  assert.deepEqual(lessonRepairSummary(detail('repaired')), { text: 'Repaired 1 analysis issue and 1 component issue', tone: 'natural' });
  assert.deepEqual(lessonRepairSummary(detail('system-fault')), { text: 'Repaired 1 component issue (the fault was system-made)', tone: 'fault' });
  assert.deepEqual(lessonRepairSummary(detail('partial')), { text: 'Component repair did not pass (1 attempt)', tone: 'bad' });
});

test('the quiet checks list has one section per checked part, analysis first, with readable names', () => {
  const sections = lessonCheckSections(detail('complete'));
  assert.deepEqual(sections.map((x) => x.label), ['Page analysis', 'Formula explorer', 'Quiz cards', 'Concept map']);
  for (const sec of sections) {
    assert.equal(sec.passed, sec.total);
    assert.ok(sec.total > 0);
    assert.ok(sec.checks.every((c) => c.name !== c.id));
  }
  assert.equal(sections[2]?.total, checkIdsFor('quiz-cards-v1').length);
  const partial = lessonCheckSections(detail('partial'));
  const formula = partial.find((x) => x.label === 'Formula explorer');
  assert.ok(formula && formula.passed < formula.total);
  assert.equal(formula.checks.find((c) => c.id === 'FE-08')?.passed, false);
  assert.deepEqual(lessonCheckSections(detail('analysing')), []);
});
