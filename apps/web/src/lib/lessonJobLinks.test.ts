/// <reference types="node" />
// Set A items 1 and 3: deep links to a saved run (?job=, ?present=, ?replay=) never silently open a different lesson, and a
// replay link to a classic (non-lesson) run is turned down with a clear message instead of a fake "running" state.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MISSING_TITLE, linkNotice, resolveRunLink, runLink } from './lessonJobLinks.ts';

const jobs = [
  { jobId: 'job-lesson-new', sourceId: 's1', status: 'succeeded' as const, createdAt: '2026-10-31T10:00:00Z', flow: 'lesson' as const },
  { jobId: 'job-lesson-old', sourceId: 's2', status: 'succeeded' as const, createdAt: '2026-10-30T10:00:00Z', flow: 'lesson' as const },
  { jobId: 'job-classic', sourceId: 's3', status: 'succeeded' as const, createdAt: '2026-10-29T10:00:00Z', flow: 'activity' as const },
  { jobId: 'job-older-classic', sourceId: 's3', status: 'succeeded' as const, createdAt: '2026-10-20T10:00:00Z' },
];

test('runLink reads every link kind, keeping malformed ids so they can be reported', () => {
  assert.deepEqual(runLink('?job=job-lesson-old'), { kind: 'job', jobId: 'job-lesson-old' });
  assert.deepEqual(runLink('?present=job-lesson-old&beat=3'), { kind: 'present', jobId: 'job-lesson-old' });
  assert.deepEqual(runLink('?replay=job-lesson-old&speed=4'), { kind: 'replay', jobId: 'job-lesson-old' });
  assert.deepEqual(runLink('?replay=Not%20An%20Id'), { kind: 'replay', jobId: 'Not An Id' });
  assert.deepEqual(runLink('?replay=a&job=b'), { kind: 'replay', jobId: 'a' }, 'replay wins, as the app opens it');
  assert.deepEqual(runLink('?job=a&present=b'), { kind: 'job', jobId: 'a' });
  assert.equal(runLink(''), null);
  assert.equal(runLink('?tour=0'), null);
  assert.deepEqual(runLink('?job='), { kind: 'job', jobId: '' }, 'an empty id is still a link that names nothing');
});

test('no link: the newest succeeded lesson opens, with no notice', () => {
  assert.deepEqual(resolveRunLink(null, jobs), { opening: { jobId: 'job-lesson-new', sourceId: 's1' }, notice: null, replay: false });
});

test('an unknown id for each link kind opens NOTHING else and says the lesson was not found', () => {
  for (const kind of ['job', 'present', 'replay'] as const) {
    const r = resolveRunLink({ kind, jobId: 'ux-review-missing' }, jobs);
    assert.equal(r.opening, null, kind);
    assert.equal(r.replay, false, kind);
    assert.deepEqual(r.notice, { problem: 'not-found', kind, jobId: 'ux-review-missing' }, kind);
  }
  assert.equal(resolveRunLink({ kind: 'job', jobId: '' }, jobs).notice?.problem, 'not-found');
  assert.equal(resolveRunLink({ kind: 'replay', jobId: 'Not An Id' }, jobs).notice?.problem, 'not-found');
});

test('a known id opens that run; a lesson replay plays', () => {
  assert.deepEqual(resolveRunLink({ kind: 'job', jobId: 'job-lesson-old' }, jobs), { opening: { jobId: 'job-lesson-old', sourceId: 's2' }, notice: null, replay: false });
  assert.deepEqual(resolveRunLink({ kind: 'present', jobId: 'job-classic' }, jobs), { opening: { jobId: 'job-classic', sourceId: 's3' }, notice: null, replay: false });
  assert.deepEqual(resolveRunLink({ kind: 'replay', jobId: 'job-lesson-old' }, jobs), { opening: { jobId: 'job-lesson-old', sourceId: 's2' }, notice: null, replay: true });
});

test('W-07: a replay link to a classic run is turned down; the stored result opens with a clear message', () => {
  for (const id of ['job-classic', 'job-older-classic']) {
    const r = resolveRunLink({ kind: 'replay', jobId: id }, jobs);
    assert.equal(r.replay, false, id);
    assert.equal(r.opening?.jobId, id);
    assert.equal(r.notice?.problem, 'classic-replay', id);
  }
});

test('notice wording: calm title, what happened, never a different lesson implied', () => {
  const missing = linkNotice({ problem: 'not-found', kind: 'present', jobId: 'x' });
  assert.equal(missing.title, MISSING_TITLE);
  assert.equal(MISSING_TITLE, 'That saved lesson was not found');
  assert.match(missing.body, /library/i);
  const unreadable = linkNotice({ problem: 'unreadable', kind: 'job', jobId: 'x' });
  assert.equal(unreadable.title, MISSING_TITLE);
  assert.match(unreadable.body, /could not be read/i);
  const classic = linkNotice({ problem: 'classic-replay', kind: 'replay', jobId: 'x' });
  assert.match(classic.title, /can’t be replayed/);
  assert.match(classic.body, /stored result/);
  for (const kind of ['job', 'present', 'replay'] as const) assert.notEqual(linkNotice({ problem: 'not-found', kind, jobId: 'x' }).body, '');
});
