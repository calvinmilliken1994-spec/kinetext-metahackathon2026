/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { normaliseJobDetail, buildLessonStream } from './lessonJob.ts';
import { replayBounds, replayRequest, replaySnapshot, replayStep, REPLAY_LABEL } from './replay.ts';
import { FIXTURE_JOB_ID, fixtureFinalWire } from './liveBuildFixtures.ts';

type Wire = Record<string, any>;
const snap = (s: number): Wire => replaySnapshot(fixtureFinalWire(), s * 1000) as Wire;

test('replayRequest reads ?replay=<jobId>&speed=N and clamps the speed', () => {
  assert.deepEqual(replayRequest(`?replay=${FIXTURE_JOB_ID}`), { jobId: FIXTURE_JOB_ID, speed: 1 });
  assert.deepEqual(replayRequest(`?replay=${FIXTURE_JOB_ID}&speed=4`), { jobId: FIXTURE_JOB_ID, speed: 4 });
  assert.equal(replayRequest(`?replay=${FIXTURE_JOB_ID}&speed=99`)?.speed, 16);
  assert.equal(replayRequest(`?replay=${FIXTURE_JOB_ID}&speed=0.01`)?.speed, 0.25);
  assert.equal(replayRequest(`?replay=${FIXTURE_JOB_ID}&speed=abc`)?.speed, 1);
  assert.equal(replayRequest('?replay='), null);
  assert.equal(replayRequest('?replay=../../etc'), null, 'only a job-id-shaped value');
  assert.equal(replayRequest('?job=x'), null);
});

test('the replay label never reads as live', () => {
  assert.match(REPLAY_LABEL, /^Replay of a recorded run/);
  assert.doesNotMatch(REPLAY_LABEL, /live/i);
});

test('replayBounds: job time runs from the first event to the last', () => {
  const b = replayBounds(fixtureFinalWire());
  assert.ok(b !== null);
  assert.equal(b.durationMs, 82860);
});

test('before the analysis lands: running, no analysis, no lesson, no overview', () => {
  const s = snap(10);
  assert.equal(s.summary.status, 'running');
  assert.equal(s.summary.finishedAt, undefined);
  assert.equal(s.events.length, 3);
  assert.equal(s.analysisV2, null);
  assert.deepEqual(s.analysisV2Revisions, []);
  assert.equal(s.lesson, null);
  assert.deepEqual(s.kitSpecs, {});
  const st = buildLessonStream(normaliseJobDetail(s));
  assert.equal(st.phase, 'analysing');
  assert.equal(st.overview, null);
});

test('at the overview event the analysis, plan and overview appear, nothing settled yet', () => {
  const s = snap(35);
  assert.equal(s.analysisV2Revisions.length, 1);
  assert.equal(s.analysisV2.overview.headline, 'Water moves between the ocean, the air and the land.');
  assert.deepEqual(s.lesson.components, []);
  assert.equal(s.summary.lesson.overviewReady, true);
  assert.equal(s.summary.lesson.componentsPlanned, 2);
  const st = buildLessonStream(normaliseJobDetail(s));
  assert.deepEqual(st.slots.map((x) => `${x.componentId}:${x.state}`), ['label-diagram-v1:building', 'sequence-v1:building']);
});

test('a part is served only once its last event has happened (never an unverified revision)', () => {
  const s = snap(75); // the sequence has passed; the label diagram is being repaired
  assert.deepEqual(s.lesson.components.map((c: Wire) => c.componentId), ['sequence-v1']);
  assert.deepEqual(Object.keys(s.kitSpecs), [`${FIXTURE_JOB_ID}:sequence-v1:r1`]);
  assert.deepEqual(Object.keys(s.componentReports), [`${FIXTURE_JOB_ID}:sequence-v1:r1`]);
  assert.deepEqual(s.componentRepairs, [], 'the repair record lands with its repair event');
  const st = buildLessonStream(normaliseJobDetail(s));
  assert.deepEqual(st.slots.map((x) => `${x.componentId}:${x.state}`), ['label-diagram-v1:repairing', 'sequence-v1:passed']);
  assert.equal(s.summary.status, 'running');
});

test('running cost is the sum of the recorded event costs so far', () => {
  const s = snap(62);
  assert.ok(Math.abs(s.summary.totalCostUSD - (0.04496025 + 0.0025 + 0.02845075)) < 1e-9);
});

test('after the last event the snapshot is the stored detail, unchanged', () => {
  const final = fixtureFinalWire();
  assert.deepEqual(replaySnapshot(final, 82860), final);
  assert.deepEqual(replaySnapshot(final, 1e9), final);
});

test('replayStep: the job time of the next event after t, or null at the end', () => {
  const final = fixtureFinalWire();
  assert.equal(replayStep(final, 0), 5);
  assert.equal(replayStep(final, 10_000), 34680);
  assert.equal(replayStep(final, 82860), null);
});

test('a malformed detail replays as itself rather than throwing', () => {
  assert.deepEqual(replaySnapshot({ summary: { status: 'succeeded' }, events: 'x' }, 5), { summary: { status: 'succeeded' }, events: 'x' });
  assert.equal(replayBounds({ events: [] }), null);
});
