/// <reference types="node" />
// Demo v2 (docs/specs/DEMO-V2-follow-the-build.md): the Demo's build steps are the recorded run's beats. Next and Back
// always work during the build: they seek the replay to the next or previous beat's event time; nothing is greyed out.
// After the last beat ("Ready for your review") Next goes to the try step. 4x by default.
import test from 'node:test';
import assert from 'node:assert/strict';
import { normaliseJobDetail } from './lessonJob.ts';
import type { JobDetail } from '../api.ts';
import { liveStrip, partBuilds } from './liveBuild.ts';
import { replaySnapshot } from './replay.ts';
import { demoRunWire } from './demoRunFixtures.ts';
import { beatCard, beatLights, buildBeats } from './demoBeats.ts';
import { activeSteps, canGoNext, indexAfterSkip, stepLights, tourMove, tourRequest, tourSignals, withoutReplay, TOUR_DEFAULT_SPEED } from './onboarding.ts';
import type { SignalInput, TourSignals } from './onboarding.ts';

const wire = demoRunWire();
const record = normaliseJobDetail(wire);
const beats = buildBeats(wire);
const LIB = { pages: 97, subjects: 10 };
const sig = (ms: number | null, extra: Partial<SignalInput> = {}): TourSignals => {
  const d: JobDetail | null = ms === null ? null : normaliseJobDetail(replaySnapshot(wire, ms));
  return tourSignals({
    replayAvailable: true, replaying: d !== null, detail: d, builds: d === null ? {} : partBuilds(d), strip: d === null ? null : liveStrip(d),
    canPresent: d !== null && d.summary.status === 'succeeded', library: LIB, speed: 4, recording: record, ...extra,
  });
};
const ids = (s: TourSignals, o?: { intro: boolean }): string[] => activeSteps(s, o).map((x) => x.id);
const BUILD = Array.from({ length: 12 }, () => 'build');

test('4x by default; &speed=N still overrides', () => {
  assert.equal(TOUR_DEFAULT_SPEED, 4);
  assert.equal(tourRequest('?demo=1').speed, 4);
  assert.equal(tourRequest('?demo=1&speed=2').speed, 2);
  assert.equal(tourRequest('?demo=1&speed=abc').speed, 4);
});

test('the build steps are the recorded run’s beats, worded and lit from each beat', () => {
  const s = sig(null);
  assert.deepEqual(ids(s), ['welcome', 'library', ...BUILD, 'try', 'present', 'own']);
  const build = activeSteps(s).filter((x) => x.id === 'build');
  assert.deepEqual(build.map((x) => x.beat?.id), beats.map((b) => b.id));
  build.forEach((x, i) => {
    const b = beats[i]!;
    const c = beatCard(b, { model: s.model, speed: 4 });
    assert.equal(x.title, c.title);
    assert.equal(x.body, c.body);
    assert.deepEqual({ targets: x.targets, extras: x.extras }, beatLights(b, b.tMs));
    assert.equal(x.needsReplay, true);
    assert.equal(x.primaryLabel, 'Next');
  });
  assert.deepEqual(ids(s, { intro: false }), [...BUILD, 'try', 'present', 'own'], 'from the guide the Demo opens on the build');
});

test('before the recording has loaded the build holds one reading step, so the Demo can still start', () => {
  const s = sig(null, { recording: null });
  assert.deepEqual(ids(s), ['welcome', 'library', 'build', 'try', 'present', 'own']);
  assert.match(activeSteps(s)[2]?.title ?? '', /is reading the page/);
});

test('Next is never disabled during the build, whatever the replay has reached', () => {
  for (const ms of [null, -800, 0, 39_000, 72_383, 101_600, 130_801]) {
    const s = sig(ms);
    const steps = activeSteps(s);
    steps.forEach((x, i) => { if (x.id === 'build') assert.equal(canGoNext(steps, i, s), true, `${x.beat?.id} at ${ms}`); });
  }
});

test('Next and Back seek the replay to the next or previous beat; the ends leave the build', () => {
  const steps = activeSteps(sig(null));
  const first = steps.findIndex((x) => x.id === 'build');
  const last = first + beats.length - 1;
  for (let i = first; i < last; i++) assert.deepEqual(tourMove(steps, i, 1), { index: i + 1, seek: beats[i + 1 - first]!.tMs });
  for (let i = first + 1; i <= last; i++) assert.deepEqual(tourMove(steps, i, -1), { index: i - 1, seek: beats[i - 1 - first]!.tMs });
  assert.deepEqual(tourMove(steps, first, -1), { index: first - 1, seek: null }, 'Back from the first beat: the library card');
  assert.equal(steps[last + 1]?.id, 'try');
  assert.deepEqual(tourMove(steps, last, 1), { index: last + 1, seek: null }, 'Next after "Ready for your review": try it');
  assert.deepEqual(tourMove(steps, last + 1, -1), { index: last, seek: null }, 'Back from try: the finished build');
  assert.equal(tourMove(steps, steps.length - 1, 1), null);
  assert.equal(tourMove(steps, 0, -1), null);
});

test('a checked part hands the light on as replay time passes; other steps keep their own targets', () => {
  const steps = activeSteps(sig(null));
  const seq = steps.find((x) => x.beat?.kind === 'passed' && x.beat.part === 'sequence-v1')!;
  assert.deepEqual(stepLights(seq, seq.beat!.tMs).targets, ['.lesson [data-component="sequence-v1"]']);
  assert.deepEqual(stepLights(seq, 72_383).targets, ['.lesson [data-component="label-diagram-v1"]']);
  const lib = steps.find((x) => x.id === 'library')!;
  assert.deepEqual(stepLights(lib, 72_383), { targets: lib.targets, extras: lib.extras });
});

test('without the recording the build steps drop out, and Continue lands on the step after the build', () => {
  const s = sig(null);
  const steps = activeSteps(s);
  const after = activeSteps(withoutReplay(s));
  assert.deepEqual(after.map((x) => x.id), ['welcome', 'library', 'present', 'own']);
  const mid = steps.findIndex((x) => x.beat?.kind === 'confirming');
  assert.equal(after[indexAfterSkip(steps, mid, after)]?.id, 'present');
  assert.deepEqual(ids(sig(null, { replayAvailable: false, recording: null })), ['welcome', 'library', 'present', 'own']);
});
