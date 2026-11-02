/// <reference types="node" />
// Demo pair review #13: the demo opens on fixed known-good runs, so a new run before filming cannot change the first frame.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_PINS, openingFor, pinnedOpening } from './demoPins.ts';
import { TOUR_JOB_ID } from './onboarding.ts';

const WATER = 'job-20261031081105-910f3776';
/** Stage 8c water cycle (Muse grounding + SAM, every part confirmed); Calvin 2026-11-02 pinned it for the plain visit. */
const WATER_8C = 'job-20261101200607-c65a20bb';
type Row = { jobId: string; sourceId: string; status: string; createdAt: string; flow?: 'lesson' | 'activity' };
const row = (jobId: string, sourceId: string, createdAt: string, status = 'succeeded', flow: 'lesson' | 'activity' = 'lesson'): Row => ({ jobId, sourceId, status, createdAt, flow });

/** Stage 10c (Calvin's Q2): water cycle with Muse grounding AND a natural repair (LD-06: the models disagreed on the cloud). */
const WATER_DEMO = 'job-20261101234914-97ba271b';

test('a plain visit opens the same grounded water-cycle run the Demo replays (Calvin, 2 Nov)', () => {
  assert.equal(DEMO_PINS.tour, WATER_DEMO);
  assert.equal(DEMO_PINS.opening[0], WATER_DEMO);
  assert.equal(DEMO_PINS.opening[1], WATER_8C, 'the earlier Stage 8c run is the fallback');
  assert.equal(TOUR_JOB_ID, DEMO_PINS.tour, 'onboarding.ts plays the pinned tour run');
});

test('a plain visit opens the pinned run even when a newer run exists', () => {
  const jobs = [
    row('job-20261101091315-a5757999', 'noaa-oceanexplorer-fueling-life-on-earth', '2026-11-01T09:13:15Z'),
    row(WATER_8C, 'noaa-jetstream-hydrologic-cycle', '2026-11-01T20:06:07Z'),
  ];
  assert.deepEqual(pinnedOpening(jobs), { jobId: WATER_8C, sourceId: 'noaa-jetstream-hydrologic-cycle' });
});

test('a pin that is missing, unfinished or not a lesson is passed over (null lets the app use its newest lesson)', () => {
  assert.equal(pinnedOpening([row('job-x', 's', '2026-11-01T00:00:00Z')]), null);
  assert.equal(pinnedOpening([row(WATER_8C, 'noaa-jetstream-hydrologic-cycle', '2026-11-01T20:06:07Z', 'failed')]), null);
  assert.equal(pinnedOpening([row(WATER_8C, 'noaa-jetstream-hydrologic-cycle', '2026-11-01T20:06:07Z', 'succeeded', 'activity')]), null);
});

// The pin is for the demo's first frame, not a trap: a browser that has opened another lesson goes back to it.
test('a plain visit opens the lesson this browser last showed when it is still a finished lesson, else the pin', () => {
  const pin = DEMO_PINS.opening[0];
  const jobs = [
    { jobId: pin, sourceId: 'noaa-water', status: 'succeeded', flow: 'lesson' as const },
    { jobId: 'job-mine', sourceId: 'my-page', status: 'succeeded', flow: 'lesson' as const },
    { jobId: 'job-failed', sourceId: 'x', status: 'failed', flow: 'lesson' as const },
  ];
  assert.deepEqual(openingFor(jobs, 'job-mine'), { jobId: 'job-mine', sourceId: 'my-page' });
  assert.deepEqual(openingFor(jobs, null), { jobId: pin, sourceId: 'noaa-water' }, 'fresh browser: the pin');
  assert.deepEqual(openingFor(jobs, 'job-gone'), { jobId: pin, sourceId: 'noaa-water' }, 'deleted run: the pin');
  assert.deepEqual(openingFor(jobs, 'job-failed'), { jobId: pin, sourceId: 'noaa-water' }, 'not a finished lesson: the pin');
});
