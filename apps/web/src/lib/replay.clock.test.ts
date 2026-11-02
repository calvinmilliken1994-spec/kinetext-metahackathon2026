/// <reference types="node" />
// Demo v2 (docs/specs/DEMO-V2-follow-the-build.md): the replay's clock can be sought (Next and Back jump to a beat's
// event time) and held below a cap (a fast beat stays readable: the replay waits for the Demo's minimum dwell, never the
// other way round). Pure: wall time is passed in.
import test from 'node:test';
import assert from 'node:assert/strict';
import { clockHold, clockRead, clockSeek, clockStart, REPLAY_LEAD_IN_MS } from './replay.ts';

test('a fresh clock opens on the lead-in and runs at the replay speed', () => {
  const c = clockStart(4, 1000);
  assert.equal(clockRead(c, 1000), -REPLAY_LEAD_IN_MS);
  assert.equal(clockRead(c, 2000), -REPLAY_LEAD_IN_MS + 4000);
});

test('seek jumps to a job time and keeps playing from there, forwards or back', () => {
  const c = clockSeek(clockStart(4, 0), 50_000, 10_000);
  assert.equal(clockRead(c, 10_000), 50_000);
  assert.equal(clockRead(c, 10_500), 52_000);
  const back = clockSeek(c, 1_000, 11_000);
  assert.equal(clockRead(back, 11_000), 1_000);
});

test('a hold stops the clock at its cap; lifting it plays on from the cap, with no jump', () => {
  const c = clockHold(clockStart(4, 0), 5_000, 0);
  assert.equal(clockRead(c, 1_000), 3_200);
  assert.equal(clockRead(c, 9_000), 5_000, 'held at the cap');
  const lifted = clockHold(c, null, 9_000);
  assert.equal(clockRead(lifted, 9_000), 5_000);
  assert.equal(clockRead(lifted, 9_250), 6_000);
});

test('the same cap again returns the same clock (no needless re-render); a cap behind now never runs time back', () => {
  const c = clockHold(clockStart(4, 0), 5_000, 0);
  assert.equal(clockHold(c, 5_000, 500), c);
  const late = clockHold(clockStart(1, 0), 100, 2_000);
  assert.equal(clockRead(late, 2_000), 2_000 - REPLAY_LEAD_IN_MS);
  assert.ok(clockRead(late, 3_000) >= clockRead(late, 2_000));
});

test('seek can carry a cap, so the beat after the target is not passed before the Demo has shown the target', () => {
  const c = clockSeek(clockStart(4, 0), 39_000, 0, 39_050);
  assert.equal(clockRead(c, 0), 39_000);
  assert.equal(clockRead(c, 1_000), 39_050);
  assert.equal(clockSeek(c, 10, 0).cap, null, 'a plain seek clears the hold');
});
