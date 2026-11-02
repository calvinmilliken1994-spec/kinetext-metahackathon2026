/// <reference types="node" />
// Stage 10c: on a replay, the "SAM 3.1 is confirming" line gets a readable minimum (CONFIRM_HOLD_MS of recorded time,
// 1.5 s at 4x). Recorded durations shown in the text stay the recorded ones; only the pacing of later events shifts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIRM_HOLD_MS, replayBounds } from './replay.ts';

const at = (ms: number): string => new Date(Date.UTC(2026, 10, 2, 0, 0, 0) + ms).toISOString();
const ev = (seq: number, ms: number, stage: string, status: string, extra: Record<string, unknown> = {}) =>
  ({ jobId: 'j', seq, at: at(ms), stage, status, componentId: 'label-diagram-v1', revision: 1, ...extra });

test('a short SAM confirm after a real locate event is held to CONFIRM_HOLD_MS; later events move by the deficit', () => {
  assert.equal(CONFIRM_HOLD_MS, 6000);
  const raw = { events: [
    ev(1, 0, 'segment', 'started'),
    ev(2, 16000, 'locate', 'succeeded', { detail: 'muse-spark-1.3 located 5 of 5 part(s) for SAM' }),
    ev(3, 17000, 'segment', 'succeeded', { detail: 'sam-3.1 returned 5 of 5 region(s); muse-spark-1.3 located 5 of 5 part(s) for SAM' }),
    ev(4, 17012, 'component', 'succeeded'),
  ] };
  assert.equal(replayBounds(raw)?.durationMs, 17012 + 5000);
});

test('a confirm already longer than the hold, and runs without a locate step, keep their recorded pacing', () => {
  const long = { events: [
    ev(1, 0, 'segment', 'started'),
    ev(2, 10000, 'locate', 'succeeded', { detail: 'muse-spark-1.3 located 5 of 5 part(s) for SAM' }),
    ev(3, 20000, 'segment', 'succeeded', { detail: 'x' }),
  ] };
  assert.equal(replayBounds(long)?.durationMs, 20000);
  const old = { events: [ev(1, 0, 'segment', 'started'), ev(2, 1900, 'segment', 'succeeded', { detail: 'sam-3.1 returned 5 of 5 region(s)' })] };
  assert.equal(replayBounds(old)?.durationMs, 1900);
});
