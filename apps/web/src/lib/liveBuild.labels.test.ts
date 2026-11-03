/// <reference types="node" />
// docs/specs/TEACHER-FIGURE.md: a job built with a teacher's diagram starts with one Muse call that reads the diagram's
// printed labels (stage 'labels', before the analysis). The build strip names it "Reading the diagram's labels" with its
// own timer, counts it as a Muse call with its cost, and the steps list shows it with model, time and cost. A failed
// read says the lesson was built without the diagram. The Demo beats name it when a recorded run has it. The job request
// carries the figure id; the lesson credits the teacher.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLessonSteps, createJobBody, normaliseJobDetail } from './lessonJob.ts';
import { closingBeat, liveStrip, partBuilds, progressFacts } from './liveBuild.ts';
import { beatCard, beatLights, buildBeats } from './demoBeats.ts';
import { replaySnapshot } from './replay.ts';
import { figureCredit } from './presentation.ts';
import { fixtureFinalWire, FIXTURE_START_MS } from './liveBuildFixtures.ts';
import { TEACHER_FIGURE_CREDIT } from './teacherFigure.ts';
import type { JobDetail } from '../api.ts';

type Wire = { events: Array<Record<string, unknown>>; summary: Record<string, unknown> } & Record<string, unknown>;

const FIG = 'uf-0123456789ab';
const SHIFT_S = 7; // the labels call takes ~6.1 s; every later event moves by 7 s
const LABELS_START = 0.01;
const LABELS_END = 6.12;
const READ = 'Muse read 9 printed labels (5 name parts)';
const FAILED = "Muse could not read the diagram's labels, so the lesson was built without it.";

/** The fixture run with the labels call first (as the worker emits it), succeeded or failed. */
function labelsWire(status: 'succeeded' | 'failed' = 'succeeded'): Wire {
  const wire = fixtureFinalWire() as Wire;
  const iso = (s: number): string => new Date(FIXTURE_START_MS + Math.round(s * 1000)).toISOString();
  const base = { jobId: wire.summary.jobId, model: 'muse-spark-1.3' };
  const [ingest0, ingest1, ...rest] = wire.events;
  const labels = [
    { ...base, stage: 'labels', status: 'started', at: iso(LABELS_START) },
    {
      ...base, stage: 'labels', status, at: iso(LABELS_END), latencyMs: 6100, estCostUSD: 0.0121, responseId: 'resp-labels-1',
      detail: status === 'succeeded' ? READ : FAILED,
    },
  ];
  const shifted = rest.map((e) => ({ ...e, at: new Date(Date.parse(e.at as string) + SHIFT_S * 1000).toISOString() }));
  wire.events = [ingest0!, ingest1!, ...labels, ...shifted].map((e, seq) => ({ ...e, seq }));
  wire.summary = { ...wire.summary, figureId: FIG, finishedAt: iso(82.87 + SHIFT_S) };
  // the label diagram is built on the teacher's figure
  const specs = wire.kitSpecs as Record<string, Record<string, unknown>>;
  for (const k of Object.keys(specs)) {
    if (specs[k]!.componentId === 'label-diagram-v1') {
      specs[k] = { ...specs[k], figureId: FIG, figure: { id: FIG, width: 1200, height: 800, caption: 'Diagram provided by the teacher', credit: 'Ms Rivera', license: 'CC BY 4.0', labelsInImage: true, labelBoxes: [] }, regions: [] };
    }
  }
  return wire;
}

/** A RUNNING job as the live poll serves it at job time `s`. */
function liveAt(wire: Wire, s: number): JobDetail {
  const events = wire.events.filter((e) => Date.parse(e.at as string) - FIXTURE_START_MS <= s * 1000);
  return normaliseJobDetail({ ...wire, events, summary: { ...wire.summary, status: 'running' } });
}

// ---- the strip ---------------------------------------------------------------------------------------------------------

test('while Muse reads the diagram the strip names that call, as Muse, with its own start time', () => {
  const s = liveStrip(liveAt(labelsWire(), 3));
  assert.deepEqual(s.ops.map((o) => [o.key, o.actor, o.text]), [['labels', 'muse', 'Reading the diagram’s labels']]);
  assert.equal(s.ops[0]!.startMs, 10);
  assert.equal(s.museCalls, 0);
  assert.equal(s.labels, 'reading');
});

test('once the labels are read the call counts as a Muse call with its cost, and the page reading follows', () => {
  const s = liveStrip(liveAt(labelsWire(), 10));
  assert.deepEqual(s.ops.map((o) => o.key), ['analyze']);
  assert.equal(s.museCalls, 1);
  assert.equal(s.costUSD, 0.0121);
  assert.equal(s.labels, 'read');
  assert.ok(progressFacts(s).includes('diagram labels read in 6.1 s'), progressFacts(s).join(' | '));
});

test('a failed read says the lesson is built without the diagram, while running and at the end', () => {
  const running = liveStrip(liveAt(labelsWire('failed'), 10));
  assert.equal(running.labels, 'failed');
  assert.ok(progressFacts(running).includes('built without the diagram'));
  const done = liveStrip(normaliseJobDetail(labelsWire('failed')));
  assert.ok(closingBeat(done).facts.includes('built without the diagram'));
  assert.equal(done.museCalls, liveStrip(normaliseJobDetail(labelsWire())).museCalls, 'the failed call still counts (it was charged)');
});

test('labels read earlier for the same image: no call counted, no time claimed', () => {
  const wire = labelsWire();
  const end = wire.events.find((e) => e.stage === 'labels' && e.status === 'succeeded')!;
  Object.assign(end, { detail: 'Printed labels read earlier', latencyMs: 0, estCostUSD: undefined, at: new Date(FIXTURE_START_MS + 20).toISOString() });
  const s = liveStrip(liveAt(wire, 10));
  assert.equal(s.labels, 'read');
  assert.equal(s.museCalls, 0);
  assert.ok(progressFacts(s).includes('diagram labels read'), progressFacts(s).join(' | '));
});

test('a run without a diagram is unchanged: no labels op, no labels fact', () => {
  const plain = fixtureFinalWire() as Wire;
  const s = liveStrip(normaliseJobDetail(plain));
  assert.equal(s.labels, null);
  assert.ok(!closingBeat(s).facts.some((f) => /diagram/.test(f)));
});

test('the labels call never enters a part\'s work log', () => {
  const builds = partBuilds(liveAt(labelsWire(), 70));
  for (const b of Object.values(builds)) assert.ok(b.lines.every((l) => !/label/i.test(l.key)), b.componentId);
});

test('a replay of the run shows the same labels call', () => {
  const s = liveStrip(normaliseJobDetail(replaySnapshot(labelsWire(), 3000)));
  assert.equal(s.ops[0]?.text, 'Reading the diagram’s labels');
});

// ---- the steps list -----------------------------------------------------------------------------------------------

test('the steps list opens with the labels step: model, time, cost and Muse\'s own detail', () => {
  const steps = buildLessonSteps(normaliseJobDetail(labelsWire()));
  const first = steps[0]!;
  assert.equal(first.key, 'labels');
  assert.equal(first.label, 'Read the diagram’s labels (beta)');
  assert.equal(first.status, 'succeeded');
  assert.equal(first.detail, `${READ}.`);
  assert.equal(first.model, 'muse-spark-1.3');
  assert.equal(first.costUSD, 0.0121);
  assert.equal(first.durationMs, 6110);
  assert.equal(first.responseId, 'resp-labels-1');
  assert.equal(steps[1]!.key, 'analyse');
});

test('a failed labels step keeps the worker\'s plain sentence', () => {
  const first = buildLessonSteps(normaliseJobDetail(labelsWire('failed')))[0]!;
  assert.equal(first.status, 'failed');
  assert.equal(first.detail, FAILED);
});

test('a running labels step says Muse is reading; runs without a diagram have no labels step', () => {
  const first = buildLessonSteps(liveAt(labelsWire(), 3))[0]!;
  assert.equal(first.status, 'running');
  assert.match(first.detail, /Muse is reading the diagram’s labels/);
  const plain = labelsWire();
  plain.events = plain.events.filter((e) => e.stage !== 'labels');
  assert.ok(!buildLessonSteps(normaliseJobDetail(plain)).some((s) => s.key === 'labels'));
});

// ---- the Demo beats -----------------------------------------------------------------------------------------------

test('a recorded run with a diagram gets a labels beat before the reading beat, lit on the strip', () => {
  const beats = buildBeats(labelsWire());
  assert.equal(beats[0]?.kind, 'labels');
  assert.equal(beats[1]?.kind, 'reading');
  assert.equal(beats[0]?.untilMs, Math.round((LABELS_END) * 1000));
  const card = beatCard(beats[0]!, { model: 'Muse Spark 1.3', speed: 4 });
  assert.equal(card.title, 'Muse Spark 1.3 reads the diagram’s labels');
  assert.match(card.body, /teacher added/);
  assert.match(card.body, /[Bb]eta/);
  assert.deepEqual(beatLights(beats[0]!, beats[0]!.tMs).targets, ['[data-tour="live-strip"]']);
  assert.ok(!buildBeats(fixtureFinalWire()).some((b) => b.kind === 'labels'));
});

// ---- the job request ----------------------------------------------------------------------------------------------

test('Build sends the figure id with a lesson build; a classic activity and a text without a diagram send none', () => {
  assert.deepEqual(createJobBody('user-abc', undefined, 'muse-spark-1.3', 'lesson', FIG), { sourceId: 'user-abc', flow: 'lesson', model: 'muse-spark-1.3', figureId: FIG });
  assert.deepEqual(createJobBody('user-abc', undefined, undefined, 'activity', FIG), { sourceId: 'user-abc', flow: 'activity' });
  assert.deepEqual(createJobBody('user-abc', undefined, undefined, 'lesson', null), { sourceId: 'user-abc', flow: 'lesson' });
});

// ---- the credit ---------------------------------------------------------------------------------------------------

test('a teacher diagram is credited to the teacher and Muse (beta), never with the library credit line', () => {
  assert.equal(figureCredit({ id: FIG, credit: 'Ms Rivera', license: 'CC BY 4.0' }), TEACHER_FIGURE_CREDIT);
  assert.equal(figureCredit({ id: 'x', provided: 'teacher', credit: '', license: '' }), TEACHER_FIGURE_CREDIT);
  assert.equal(figureCredit({ id: 'noaa-hydrologic-cycle-1', credit: 'Credit: NOAA', license: 'U.S. Government work, public domain' }), 'NOAA · U.S. Government work, public domain');
});
