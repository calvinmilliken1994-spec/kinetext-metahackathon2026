/// <reference types="node" />
// UX pair review: the first frame was the tour card over an empty, loading app. The tour now waits for the runs list and
// the opening lesson; once shown it stays (the tour's own replay reloads the lesson under it).
import test from 'node:test';
import assert from 'node:assert/strict';
import { tourSteps, tourReady, tourSignals, watchAfterTourClose, TOUR_JOB_ID } from './onboarding.ts';
import { normaliseJobDetail } from './lessonJob.ts';
import { demoRunWire } from './demoRunFixtures.ts';

test('the tour waits while the runs list loads', () => {
  assert.equal(tourReady({ jobs: 'loading', sources: 'ready', lesson: 'none' }), false);
});

test('the tour waits while the page list or the opening lesson loads', () => {
  assert.equal(tourReady({ jobs: 'ready', sources: 'loading', lesson: 'ready' }), false);
  assert.equal(tourReady({ jobs: 'ready', sources: 'ready', lesson: 'loading' }), false);
});

test('the tour opens once the opening lesson is on screen, or when there is no lesson to wait for', () => {
  assert.equal(tourReady({ jobs: 'ready', sources: 'ready', lesson: 'ready' }), true);
  assert.equal(tourReady({ jobs: 'ready', sources: 'ready', lesson: 'none' }), true);
  // a broken API never holds the tour back for ever
  assert.equal(tourReady({ jobs: 'error', sources: 'error', lesson: 'none' }), true);
  assert.equal(tourReady({ jobs: 'ready', sources: 'ready', lesson: 'error' }), true);
});

test('skipping the tour mid-replay leaves the tour run at rest (no build view kept)', () => {
  assert.equal(watchAfterTourClose(TOUR_JOB_ID, 'skipped'), null);
  assert.equal(watchAfterTourClose(TOUR_JOB_ID, 'done'), TOUR_JOB_ID, 'a finished tour keeps the build view (no jump at the end)');
  assert.equal(watchAfterTourClose('job-live', 'skipped'), 'job-live', 'a live build the teacher started is untouched');
  assert.equal(watchAfterTourClose(null, 'skipped'), null);
});

test('step 4 says Muse writes the summary first (the finished lesson puts the activity first)', () => {
  const s = tourSignals({ replayAvailable: true, replaying: false, detail: null, builds: {}, strip: null, canPresent: false, library: null, speed: 4, recording: normaliseJobDetail(demoRunWire()) });
  const step = tourSteps(s)[3];
  assert.equal(step?.beat?.kind, 'summary');
  assert.equal(step?.title, 'Muse writes the summary first');
});
