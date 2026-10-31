/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { normaliseJobDetail } from './lessonJob.ts';
import type { JobDetail } from '../api.ts';
import {
  formatElapsed, jobStartMs, liveStrip, parseCheckCount, parseFailedChecks, parseSegmentAsk, partBuilds, reserveHeight, stagger,
} from './liveBuild.ts';
import { replaySnapshot } from './replay.ts';
import { fixtureFinalWire, FIXTURE_START_MS } from './liveBuildFixtures.ts';

const at = (s: number): JobDetail => normaliseJobDetail(replaySnapshot(fixtureFinalWire(), s * 1000));
const lines = (d: JobDetail, id: string): string[] => (partBuilds(d)[id]?.lines ?? []).map((l) => `${l.kind}${l.open ? '…' : ''}`);

test('parsers read the worker event details', () => {
  assert.deepEqual(parseCheckCount('11/11 checks passed'), { passed: 11, total: 11 });
  assert.deepEqual(parseCheckCount('usable; checks 18/18 passed'), { passed: 18, total: 18 });
  assert.equal(parseCheckCount('repaired revision 1'), null);
  assert.deepEqual(parseFailedChecks('failed checks: LD-04'), ['LD-04']);
  assert.deepEqual(parseFailedChecks('failed checks: Q-06, Q-02'), ['Q-06', 'Q-02']);
  assert.deepEqual(parseFailedChecks('OUTPUT_INVALID'), []);
  assert.equal(parseSegmentAsk('sam-3.1 point segmentation of 5 part(s)'), 5);
  assert.equal(parseSegmentAsk(undefined), null);
});

test('formatElapsed: whole seconds under a minute, then minutes and seconds', () => {
  assert.equal(formatElapsed(0), '0 s');
  assert.equal(formatElapsed(12_400), '12 s');
  assert.equal(formatElapsed(59_999), '59 s');
  assert.equal(formatElapsed(83_000), '1 min 23 s');
  assert.equal(formatElapsed(-50), '0 s');
});

test('stagger caps the delay so a long list never waits', () => {
  assert.equal(stagger(0, 70), 0);
  assert.equal(stagger(3, 70), 210);
  assert.equal(stagger(40, 70, 600), 600);
});

test('reserveHeight gives every planned kind a positive estimate', () => {
  for (const id of ['label-diagram-v1', 'sequence-v1', 'quiz-cards-v1', 'timeline-v1', 'unknown-v9']) assert.ok(reserveHeight(id) >= 200, id);
});

test('jobStartMs is the first event time', () => {
  assert.equal(jobStartMs(at(1).events), FIXTURE_START_MS);
  assert.equal(jobStartMs([]), null);
});

test('strip: reading the page while the analysis call is open', () => {
  const s = liveStrip(at(10));
  assert.equal(s.finished, false);
  assert.deepEqual(s.ops.map((o) => [o.actor, o.text]), [['muse', 'Reading the page and planning the lesson']]);
  assert.equal(s.ops[0]?.startMs, 16);
  assert.equal(s.museCalls, 0);
});

test('strip: two parts written at once, then SAM outlining beside Muse', () => {
  assert.deepEqual(liveStrip(at(40)).ops.map((o) => o.text), ['Writing Label the diagram', 'Writing Sequence']);
  assert.deepEqual(liveStrip(at(60)).ops.map((o) => [o.actor, o.text]), [['sam', 'Outlining 5 parts of the figure'], ['muse', 'Writing Sequence']]);
  assert.deepEqual(liveStrip(at(65)).ops.map((o) => o.text), ['Reworking Label the diagram', 'Writing Sequence']);
});

test('strip: finished job counts the real calls and keeps the recorded cost', () => {
  const s = liveStrip(at(90));
  assert.equal(s.finished, true);
  assert.deepEqual(s.ops, []);
  assert.equal(s.museCalls, 4);
  assert.equal(s.samCalls, 2);
  assert.equal(s.totalMs, 82860);
  assert.equal(s.costUSD, 0.144494);
});

test('part log: the label diagram writes, is outlined by SAM, fails one check, is reworked and passes', () => {
  assert.deepEqual(lines(at(40), 'label-diagram-v1'), ['writing…']);
  assert.deepEqual(lines(at(60), 'label-diagram-v1'), ['writing', 'outlining…']);
  assert.deepEqual(lines(at(62), 'label-diagram-v1'), ['writing', 'outlining', 'checks-failed', 'writing…']);
  assert.deepEqual(lines(at(90), 'label-diagram-v1'), ['writing', 'outlining', 'checks-failed', 'writing', 'outlining', 'checks-passed']);
  const done = partBuilds(at(90))['label-diagram-v1'];
  assert.ok(done !== undefined);
  assert.equal(done.revision, 2);
  assert.deepEqual(done.checks, { passed: 11, total: 11 });
  const [w1, s1, f1, w2] = done.lines;
  assert.equal(w1?.durationMs, 24546, 'the recorded latency wins over the event gap');
  assert.equal(w1?.tokens, 5434);
  assert.equal(s1?.durationMs, 1850);
  assert.match(s1?.text ?? '', /SAM 3\.1 outlined 5 of 5 parts/);
  assert.match(f1?.text ?? '', /^1 check failed: /);
  assert.doesNotMatch(f1?.text ?? '', /LD-04/, 'plain check names, never raw ids');
  assert.equal(w2?.revision, 2);
  assert.match(w2?.text ?? '', /^Revision 2 written/);
  assert.equal(w2?.durationMs, 20892);
});

test('part log: while writing, the line is open with the start time for the live counter', () => {
  const b = partBuilds(at(40))['sequence-v1'];
  assert.equal(b?.lines[0]?.open, true);
  assert.equal(b?.lines[0]?.startMs, 34700);
  assert.match(b?.lines[0]?.text ?? '', /Muse Spark 1\.3 is writing it/);
  assert.equal(b?.reason, 'The cycle is a sequence of stages.');
});

test('part log: a closed writing line takes its time from the SAM start until the latency arrives', () => {
  const w = partBuilds(at(60))['label-diagram-v1']?.lines[0];
  assert.equal(w?.open, false);
  assert.equal(w?.durationMs, 59230 - 34690);
  assert.equal(w?.tokens, null);
});

test('trace: one short step per finished line, ending in the checks', () => {
  const t = partBuilds(at(90))['label-diagram-v1']?.trace.map((x) => `${x.tone}:${x.text}`);
  assert.deepEqual(t, ['plain:Written 24.5 s', 'plain:SAM 3.1 1.9 s', 'bad:1 check failed', 'plain:Revision 2 · 20.9 s', 'plain:SAM 3.1 0.8 s', 'ok:11/11 checks']);
});

test('queued: a planned part with no event yet waits for its turn', () => {
  const d = at(35);
  const raw = JSON.parse(JSON.stringify(d)) as JobDetail;
  raw.events = raw.events.filter((e) => (e as { componentId?: string }).componentId !== 'sequence-v1');
  assert.deepEqual(lines(raw, 'sequence-v1'), ['queued…']);
});

test('no plan before the analysis: no frames are promised', () => {
  assert.deepEqual(partBuilds(at(10)), {});
});
