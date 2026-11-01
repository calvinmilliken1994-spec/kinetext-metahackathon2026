// Calvin 2026-11-01: "Skip tour" during the demo left the recorded build playing. Skipping now stops the tour's
// replay and shows that lesson as it finished; a replay the teacher opened some other way is never touched.
import test from 'node:test';
import assert from 'node:assert/strict';
import { replayAfterTourClose, TOUR_JOB_ID } from './onboarding.ts';

test('skipping the tour stops the tour recording', () => {
  assert.equal(replayAfterTourClose({ jobId: TOUR_JOB_ID, speed: 2 }, 'skipped'), null);
});

test('finishing the tour leaves the recording as it is', () => {
  const req = { jobId: TOUR_JOB_ID, speed: 2 };
  assert.equal(replayAfterTourClose(req, 'done'), req);
});

test('another replay or no replay is left alone', () => {
  const other = { jobId: 'job-other', speed: 4 };
  assert.equal(replayAfterTourClose(other, 'skipped'), other);
  assert.equal(replayAfterTourClose(null, 'skipped'), null);
});
