/// <reference types="node" />
// Set A item 4 (W-08): the tour completes without its recording. Missing recording: the steps come from what is on screen
// (the open lesson's first checked part, its Present button). Failed replay fetch: the reading step offers Retry and
// Continue, and Continue moves on to the steps that need no replay. Every traversal reaches the last step.
import test from 'node:test';
import assert from 'node:assert/strict';
import { normaliseJobDetail } from './lessonJob.ts';
import type { JobDetail } from '../api.ts';
import { lessonWire } from './lessonJobFixtures.ts';
import { liveStrip, partBuilds } from './liveBuild.ts';
import { replaySnapshot } from './replay.ts';
import { fixtureFinalWire } from './liveBuildFixtures.ts';
import { activeSteps, canGoNext, indexAfterSkip, stepReady, tourSignals, withoutReplay } from './onboarding.ts';
import type { SignalInput, TourSignals } from './onboarding.ts';

const LIB = { pages: 97, subjects: 9 };
const base = (over: Partial<SignalInput>): TourSignals => tourSignals({
  replayAvailable: false, replaying: false, detail: null, builds: {}, strip: null, canPresent: false, library: LIB, speed: 2, ...over,
});
const ids = (s: TourSignals): string[] => activeSteps(s).map((x) => x.id);

/** Walk the tour with Next only: every step must be reachable and the walk must end on the last step. */
function walk(s: TourSignals): string[] {
  const steps = activeSteps(s);
  const seen: string[] = [steps[0]?.id ?? ''];
  for (let i = 0; i < steps.length - 1; i++) {
    const cur = steps[i];
    // a 'replay' primary moves on at once; any other Next waits for the next step's moment
    assert.ok(cur?.primary === 'replay' || canGoNext(steps, i, s), `stuck after ${cur?.id}`);
    seen.push(steps[i + 1]?.id ?? '');
  }
  return seen;
}

test('no recording, a finished lesson open: the tour points at its first checked part and its Present button', () => {
  const open: JobDetail = normaliseJobDetail(lessonWire('complete'));
  const s = base({ detail: open, canPresent: true });
  assert.equal(s.firstPart, 'formula-explorer-v1', 'the open lesson’s first passed part, in plan order');
  assert.deepEqual(ids(s), ['welcome', 'library', 'try', 'present']);
  assert.deepEqual(walk(s), ['welcome', 'library', 'try', 'present']);
  assert.equal(activeSteps(s).at(-1)?.primary, 'present');
});

test('no recording and nothing to try on screen: the try step drops out and the tour still finishes', () => {
  const s = base({});
  assert.deepEqual(ids(s), ['welcome', 'library', 'present']);
  assert.deepEqual(walk(s), ['welcome', 'library', 'present']);
  assert.equal(activeSteps(s).at(-1)?.primary, 'finish');
});

test('a lesson with no passed part (all failed or withheld) offers nothing to try', () => {
  const wire = lessonWire('complete');
  for (const c of (wire.lesson as { components: Array<Record<string, unknown>> }).components) c.recheck = { publishable: false, failedChecks: [] };
  const s = base({ detail: normaliseJobDetail(wire) });
  assert.equal(s.firstPart, null);
  assert.deepEqual(ids(s), ['welcome', 'library', 'present']);
});

test('with the recording, the open lesson is NOT used for the try step before the replay reaches it', () => {
  const open = normaliseJobDetail(lessonWire('complete'));
  const s = base({ replayAvailable: true, detail: open });
  assert.equal(s.firstPart, null, 'the replay decides which part is tried');
  assert.ok(ids(s).includes('try'), 'still planned: the replay will produce it');
});

test('a failed replay fetch is a signal; Continue drops the replay steps and moves on from where the tour stood', () => {
  const s = base({ replayAvailable: true, replayFailed: true });
  assert.equal(s.replayFailed, true);
  const withReplay = activeSteps(s);
  const reading = withReplay.findIndex((x) => x.id === 'reading');
  assert.equal(reading, 2);
  assert.equal(stepReady('reading', s), false, 'the reading step cannot start: the card offers Retry / Continue instead');
  const skipped = withoutReplay(s);
  const after = activeSteps(skipped);
  assert.deepEqual(after.map((x) => x.id), ['welcome', 'library', 'present']);
  assert.equal(indexAfterSkip(withReplay, reading, after), 2, 'the step after the library: present');
  assert.deepEqual(walk(skipped), ['welcome', 'library', 'present']);
});

test('Continue mid-replay (after the overview) lands on the next non-replay step, keeping the tried part when known', () => {
  const d = normaliseJobDetail(replaySnapshot(fixtureFinalWire(), 1e9));
  const s = tourSignals({ replayAvailable: true, replaying: true, detail: d, builds: partBuilds(d), strip: liveStrip(d), canPresent: true, library: LIB, speed: 2 });
  const steps = activeSteps(s);
  const checking = steps.findIndex((x) => x.id === 'checking');
  const after = activeSteps(withoutReplay(s));
  assert.deepEqual(after.map((x) => x.id), ['welcome', 'library', 'try', 'present']);
  assert.equal(after[indexAfterSkip(steps, checking, after)]?.id, 'try');
});

test('indexAfterSkip keeps a step that survives and clamps at the end', () => {
  const s = base({ replayAvailable: true });
  const full = activeSteps(s);
  const short = activeSteps(withoutReplay(s));
  assert.equal(indexAfterSkip(full, 1, short), 1, 'library stays library');
  assert.equal(indexAfterSkip(full, full.length - 1, short), short.length - 1);
});
