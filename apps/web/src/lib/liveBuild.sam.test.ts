/// <reference types="node" />
// Demo pair review #1a and #10: what the figure frame says about SAM during a build, and which parts count as arrivals
// when a replay restarts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { normaliseJobDetail } from './lessonJob.ts';
import type { JobDetail } from '../api.ts';
import { arrivals, figureNote, partBuilds } from './liveBuild.ts';
import { replaySnapshot } from './replay.ts';
import { fixtureFinalWire } from './liveBuildFixtures.ts';

const at = (s: number): JobDetail => normaliseJobDetail(replaySnapshot(fixtureFinalWire(), s * 1000));
const LD = 'label-diagram-v1';

test('figure frame: no SAM note before any SAM call, and never one for other kinds', () => {
  assert.equal(figureNote(undefined), null);
  assert.equal(figureNote(partBuilds(at(20))[LD]), null, 'Muse is still writing: nothing about SAM yet');
  assert.equal(figureNote(partBuilds(at(60))['sequence-v1']), null);
});

test('figure frame: SAM working while its call is open, then what it outlined (no regions invented)', () => {
  const open = figureNote(partBuilds(at(60))[LD]);
  assert.deepEqual(open, { actor: 'SAM 3.1', text: 'is outlining 5 parts of the figure', working: true });
  const done = figureNote(partBuilds(at(62))[LD]);
  assert.equal(done?.working, false, 'the call has closed: no working cue');
  assert.equal(done?.actor, 'SAM 3.1');
  assert.match(done?.text ?? '', /^outlined 5 of 5 parts in \d+\.\d s$/);
});

test('figure frame: a second SAM call (revision 2) shows as working again', () => {
  const b = partBuilds(at(90))[LD];
  const sam = b?.lines.filter((l) => l.kind === 'outlining') ?? [];
  assert.equal(sam.length, 2);
  assert.equal(figureNote(b)?.working, false);
});

test('arrivals: the first frame is a baseline, later frames report only new parts', () => {
  const a = arrivals(null, ['overview-x', LD]);
  assert.deepEqual(a.newly, []);
  assert.equal(a.restarted, false);
  const b = arrivals(a.known, ['overview-x', LD, 'sequence-v1']);
  assert.deepEqual(b.newly, ['sequence-v1']);
  assert.equal(b.restarted, false);
});

test('arrivals: a replay restart (parts vanish) makes the same parts arrive again', () => {
  const finished = arrivals(null, [LD, 'sequence-v1']).known;
  // "Replay again": one stale frame with the finished lesson, then the empty start of the recording
  const stale = arrivals(finished, [LD, 'sequence-v1']);
  assert.deepEqual(stale.newly, []);
  const empty = arrivals(stale.known, []);
  assert.equal(empty.restarted, true, 'parts that vanish mean the replay started again');
  const again = arrivals(empty.known, [LD]);
  assert.deepEqual(again.newly, [LD], 'the diagram arrives again and is followed');
  assert.equal(again.restarted, false);
});
