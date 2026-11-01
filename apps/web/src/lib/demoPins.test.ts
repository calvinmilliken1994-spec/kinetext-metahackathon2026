/// <reference types="node" />
// Demo pair review #13: the demo opens on fixed known-good runs, so a new run before filming cannot change the first frame.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_PINS, pinnedOpening } from './demoPins.ts';
import { TOUR_JOB_ID } from './onboarding.ts';

const WATER = 'job-20261031081105-910f3776';
type Row = { jobId: string; sourceId: string; status: string; createdAt: string; flow?: 'lesson' | 'activity' };
const row = (jobId: string, sourceId: string, createdAt: string, status = 'succeeded', flow: 'lesson' | 'activity' = 'lesson'): Row => ({ jobId, sourceId, status, createdAt, flow });

test('the pins are the water-cycle run on Muse Spark 1.3, the same run the tour replays', () => {
  assert.equal(DEMO_PINS.tour, WATER);
  assert.equal(DEMO_PINS.opening[0], WATER);
  assert.equal(TOUR_JOB_ID, DEMO_PINS.tour, 'onboarding.ts plays the pinned tour run');
});

test('a plain visit opens the pinned run even when a newer run exists', () => {
  const jobs = [
    row('job-20261101091315-a5757999', 'noaa-oceanexplorer-fueling-life-on-earth', '2026-11-01T09:13:15Z'),
    row(WATER, 'noaa-jetstream-hydrologic-cycle', '2026-10-31T08:11:05Z'),
  ];
  assert.deepEqual(pinnedOpening(jobs), { jobId: WATER, sourceId: 'noaa-jetstream-hydrologic-cycle' });
});

test('a pin that is missing, unfinished or not a lesson is passed over (null lets the app use its newest lesson)', () => {
  assert.equal(pinnedOpening([row('job-x', 's', '2026-11-01T00:00:00Z')]), null);
  assert.equal(pinnedOpening([row(WATER, 'noaa-jetstream-hydrologic-cycle', '2026-10-31T08:11:05Z', 'failed')]), null);
  assert.equal(pinnedOpening([row(WATER, 'noaa-jetstream-hydrologic-cycle', '2026-10-31T08:11:05Z', 'succeeded', 'activity')]), null);
});
