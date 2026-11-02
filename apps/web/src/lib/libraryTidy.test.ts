/// <reference types="node" />
// Library tidy (docs/specs/LIBRARY-TIDY.md, Web): "Needs review" wording and badges, the One per page / Every lesson /
// All runs / Archived scopes, the Published shelf, archived runs left out of every count, and the archive controls'
// rules and words. Pure: no React, no DOM, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  browseLessons, chipUnit, lessonsByPage, lessonsLede, pageBreakdown, publishedShelf, rowsCountText,
} from './browse.ts';
import {
  archiveConfirmText, archiveErrorMessage, archiveKeeper, archiveStatusText, canArchive, canArchiveRun, olderCopies,
  parseArchiveAnswer, parseBulkAnswer, rowArchiveAction,
} from './archive.ts';
import { shelfVisible } from './browse.ts';
import { lessonReviewCue, NEEDS_REVIEW, NEEDS_REVIEW_DETAIL, reviewBadge } from './reviewState.ts';
import { lessonStatusLine, partCountsLine, reviewStatusView } from './partOrder.ts';
import { parseJobSummary } from './lessonJob.ts';
import { HOW_STEPS } from './pageCopy.ts';
import { guideSteps } from './welcome.ts';
import type { Access, AccessInfo } from './access.ts';

interface J {
  jobId: string; sourceId: string; createdAt: string; status: string; flow?: string;
  reviewPublishedAt?: string; archivedAt?: string; pinned?: boolean;
}
const run = (jobId: string, sourceId: string, day: number, extra: Partial<J> = {}): J =>
  ({ jobId, sourceId, createdAt: `2026-10-${String(day).padStart(2, '0')}T10:00:00Z`, status: 'succeeded', flow: 'lesson', ...extra });

const SOURCES = new Map([
  ['water', { title: 'The Hydrologic Cycle', subject: 'earth-science' }],
  ['newton', { title: 'Newton’s Laws of Motion', subject: 'physics' }],
  ['lift', { title: 'What is Lift?', subject: 'physics' }],
]);

// water: an older published lesson, a newer lesson, an archived one, a failed run. newton: a pinned old copy, a newer
// lesson, a run still building. lift: only a classic activity.
const JOBS: J[] = [
  run('w1', 'water', 10, { reviewPublishedAt: '2026-11-02T02:40:09.313Z' }),
  run('w2', 'water', 20),
  run('w3', 'water', 15, { archivedAt: '2026-11-02T05:00:00Z' }),
  run('w4', 'water', 22, { status: 'failed' }),
  run('w5', 'water', 5),
  run('n1', 'newton', 11, { pinned: true }),
  run('n2', 'newton', 21),
  run('n3', 'newton', 25, { status: 'running' }),
  run('l1', 'lift', 12, { flow: 'activity' }),
];
const ids = (scope: Parameters<typeof browseLessons>[2]['scope'], extra: { query?: string; subject?: 'physics' | null } = {}) =>
  browseLessons(JOBS, SOURCES, { query: extra.query ?? '', subject: extra.subject ?? null, scope }).map((r) => r.jobId);

// ---- wording -------------------------------------------------------------------------------------------------------

test('one wording: "Needs review", with the plain detail line the lesson page shows', () => {
  assert.equal(NEEDS_REVIEW, 'Needs review');
  assert.equal(NEEDS_REVIEW_DETAIL, 'AI-written and not yet checked by a teacher');
  assert.equal(lessonStatusLine({ ready: 2, heldBack: 1 }), 'Needs review · 2 parts ready · 1 held back');
  assert.equal(lessonStatusLine(null), 'Needs review');
});

test('partCountsLine: the counts alone, for beside the notice', () => {
  assert.equal(partCountsLine({ ready: 2, heldBack: 1 }), '2 parts ready · 1 held back');
  assert.equal(partCountsLine({ ready: 1, heldBack: 0 }), '1 part ready');
  assert.equal(partCountsLine({ ready: 0, heldBack: 0 }), '');
  assert.equal(partCountsLine(null), '');
});

test('no copy says "Teacher review pending" any more', () => {
  const copy = [
    ...HOW_STEPS.map((s) => s.body),
    ...guideSteps({ library: null, access: 'locked', demo: { available: true, length: 'about 1 minute' } }).map((s) => s.body),
  ].join(' ');
  assert.doesNotMatch(copy, /review pending/i);
  assert.match(copy, /“Needs review”/);
});

// ---- the badge and the lesson-page cue -----------------------------------------------------------------------------

test('reviewBadge: Published, else Needs review on a finished lesson; activities and failed runs get none', () => {
  assert.equal(reviewBadge({ status: 'succeeded', flow: 'lesson', reviewPublishedAt: '2026-11-02T00:00:00Z' }), 'published');
  assert.equal(reviewBadge({ status: 'succeeded', flow: 'lesson' }), 'needs-review');
  assert.equal(reviewBadge({ status: 'succeeded', flow: 'activity' }), null);
  assert.equal(reviewBadge({ status: 'succeeded' }), null, 'no flow = a run recorded before lessons existed');
  assert.equal(reviewBadge({ status: 'failed', flow: 'lesson' }), null);
  assert.equal(reviewBadge({ status: 'unsupported', flow: 'lesson' }), null);
  assert.equal(reviewBadge({ status: 'running', flow: 'lesson' }), null);
  // An archived copy is out of the way: it does not ask for a review (Calvin's walk-through, 2 Nov).
  assert.equal(reviewBadge({ status: 'succeeded', flow: 'lesson', archivedAt: '2026-11-02T00:00:00Z' }), null);
});

test('lessonReviewCue: the amber notice on a finished unpublished lesson only', () => {
  assert.equal(lessonReviewCue({ status: 'succeeded', lesson: true, published: false, live: false }), 'notice');
  assert.equal(lessonReviewCue({ status: 'succeeded', lesson: true, published: true, live: false }), 'line', 'published keeps its line');
  assert.equal(lessonReviewCue({ status: 'running', lesson: true, published: false, live: true }), 'line', 'a build being watched');
  assert.equal(lessonReviewCue({ status: 'succeeded', lesson: true, published: false, live: true }), 'line', 'a replay that just ended');
  assert.equal(lessonReviewCue({ status: 'succeeded', lesson: false, published: false, live: false }), 'none', 'a classic activity');
  assert.equal(lessonReviewCue({ status: 'failed', lesson: true, published: false, live: false }), 'none');
});

test('reviewStatusView: what the line under the title holds for each cue', () => {
  const counts = { ready: 2, heldBack: 1 };
  const published = { status: 'published' as const, publishedAt: '2026-11-02T02:40:09.313Z', hiddenParts: [], checkedParts: [] };
  assert.deepEqual(reviewStatusView('notice', counts, null), { notice: true, text: '2 parts ready · 1 held back' });
  assert.deepEqual(reviewStatusView('notice', counts, published, true), { notice: false, text: 'Reviewed by a teacher · published 2 Nov 2026 · 2 parts ready · 1 held back' });
  assert.deepEqual(reviewStatusView('line', null, null), { notice: false, text: 'Needs review' });
  assert.deepEqual(reviewStatusView('none', null, null), { notice: false, text: '' });
  assert.deepEqual(reviewStatusView('none', counts, null), { notice: false, text: '2 parts ready · 1 held back' });
});

// ---- the wire ------------------------------------------------------------------------------------------------------

test('parseJobSummary keeps a real archive time and pinned: true, drops anything else', () => {
  const base = { jobId: 'a', sourceId: 's', status: 'succeeded', createdAt: '2026-11-01T00:00:00Z', totalCostUSD: 0 };
  const ok = parseJobSummary({ ...base, archivedAt: '2026-11-02T05:00:00Z', pinned: true });
  assert.equal(ok.archivedAt, '2026-11-02T05:00:00Z');
  assert.equal(ok.pinned, true);
  const bad = parseJobSummary({ ...base, archivedAt: 'yesterday', pinned: 'yes' });
  assert.equal('archivedAt' in bad, false);
  assert.equal('pinned' in bad, false);
  assert.equal('archivedAt' in parseJobSummary({ ...base, archivedAt: null }), false);
});

test('parseArchiveAnswer / parseBulkAnswer read the API answers defensively', () => {
  assert.deepEqual(parseArchiveAnswer({ archivedAt: '2026-11-02T05:00:00Z' }), { archivedAt: '2026-11-02T05:00:00Z' });
  assert.deepEqual(parseArchiveAnswer({ archivedAt: null }), { archivedAt: null });
  assert.equal(parseArchiveAnswer({ archivedAt: 3 }), null);
  assert.equal(parseArchiveAnswer(null), null);
  assert.deepEqual(parseBulkAnswer({ archived: ['a', 'b', 4], restored: [] }), { archived: ['a', 'b'], restored: [] });
  assert.deepEqual(parseBulkAnswer('nope'), { archived: [], restored: [] });
});

// ---- the scopes ----------------------------------------------------------------------------------------------------

test('One per page: the published lesson of each page, else the newest finished lesson; archived runs never', () => {
  assert.deepEqual(ids('latest'), ['n2', 'l1', 'w1']);
});

test('Every lesson and All runs leave archived runs out; Archived lists only them', () => {
  assert.deepEqual(ids('lessons'), ['n2', 'w2', 'l1', 'n1', 'w1', 'w5']);
  assert.deepEqual(ids('all'), ['n3', 'w4', 'n2', 'w2', 'l1', 'n1', 'w1', 'w5']);
  assert.deepEqual(ids('archived'), ['w3']);
  assert.deepEqual(ids('archived', { subject: 'physics' }), []);
});

test('rows carry the badge, the archive time, the pin and how many older copies the page has', () => {
  const rows = browseLessons(JOBS, SOURCES, { query: '', subject: null, scope: 'all' });
  const by = new Map(rows.map((r) => [r.jobId, r]));
  assert.equal(by.get('w1')?.badge, 'published');
  assert.equal(by.get('w2')?.badge, 'needs-review');
  assert.equal(by.get('l1')?.badge, null, 'a classic activity is not reviewable');
  assert.equal(by.get('w4')?.badge, null, 'a failed run is not reviewable');
  assert.equal(by.get('n1')?.pinned, true);
  assert.equal(by.get('n2')?.pinned, false);
  const latest = new Map(browseLessons(JOBS, SOURCES, { query: '', subject: null, scope: 'latest' }).map((r) => [r.jobId, r]));
  assert.equal(latest.get('w1')?.older, 2, 'water: w4 and w5 go; w1 is published, w2 is the keeper, w3 is archived');
  assert.equal(latest.get('n2')?.older, 0, 'newton: n1 is pinned, n3 is still building');
  assert.equal(latest.get('l1')?.older, 0);
  const archived = browseLessons(JOBS, SOURCES, { query: '', subject: null, scope: 'archived' });
  assert.equal(archived[0]?.archived, '2026-11-02T05:00:00Z');
});

test('the Published shelf: published lessons, newest published first, archived ones left out', () => {
  const jobs = [
    ...JOBS,
    run('x1', 'newton', 3, { reviewPublishedAt: '2026-11-03T00:00:00Z' }),
    run('x2', 'lift', 4, { reviewPublishedAt: '2026-11-04T00:00:00Z', archivedAt: '2026-11-04T01:00:00Z' }),
  ];
  assert.deepEqual(publishedShelf(jobs, SOURCES).map((r) => r.jobId), ['x1', 'w1']);
  assert.deepEqual(publishedShelf(JOBS.filter((j) => j.reviewPublishedAt === undefined), SOURCES), []);
});

// ---- counts --------------------------------------------------------------------------------------------------------

test('lessonsByPage (New lesson page): archived runs left out; it opens the published lesson first', () => {
  const m = lessonsByPage(JOBS);
  assert.deepEqual(m.get('water'), { count: 3, open: 'w1', published: true });
  assert.deepEqual(m.get('newton'), { count: 2, open: 'n2', published: false });
  assert.deepEqual(m.get('lift'), { count: 1, open: 'l1', published: false });
  assert.equal(lessonsByPage([run('a', 'p', 1, { archivedAt: '2026-11-02T00:00:00Z' })]).get('p'), undefined);
});

test('pageBreakdown counts pages from runs that are not archived', () => {
  const byId = new Map([['water', {}], ['newton', {}], ['gone', { retired: true }]]);
  const jobs = [run('a', 'water', 1), run('b', 'newton', 2), run('c', 'gone', 3, { archivedAt: '2026-11-02T00:00:00Z' })];
  assert.deepEqual(pageBreakdown(jobs, byId), { pages: 2, library: 2, own: 0, retired: 0 });
});

test('lessonsLede says how many runs are archived, and only when there are any', () => {
  const b = { pages: 101, library: 97, own: 0, retired: 4 };
  assert.equal(
    lessonsLede(130, b, 512),
    '130 finished lessons and activities from 101 pages: 97 in the library and 4 since retired from it. 512 archived runs are not counted. Open one to try its parts, present it, or see how it was built and checked.',
  );
  assert.match(lessonsLede(130, b, 1), /\. 1 archived run is not counted\. /);
  assert.doesNotMatch(lessonsLede(130, b, 0), /archived/);
  assert.doesNotMatch(lessonsLede(130, b), /archived/);
});

test('rowsCountText and chipUnit for the four scopes', () => {
  const t = (scope: Parameters<typeof rowsCountText>[0]['scope'], n: number, subject: string | null = null) => rowsCountText({ scope, count: n, subjectLabel: subject, query: '' });
  assert.equal(t('latest', 101), '101 pages · the published or newest lesson of each');
  assert.equal(t('latest', 1), '1 page · the published or newest lesson of each');
  assert.equal(t('archived', 512), '512 archived runs');
  assert.equal(t('archived', 1, 'Physics'), '1 archived run in Physics');
  assert.equal(t('archived', 0), 'No archived runs');
  assert.equal(chipUnit('archived'), 'run');
});

// ---- archive rules (mirror of the API's archive-older) ----------------------------------------------------------------

test('archiveKeeper: the newest finished lesson, else the newest finished run of any flow, else none', () => {
  assert.equal(archiveKeeper(JOBS.filter((j) => j.sourceId === 'water')), 'w2', 'the archived w3 is not considered');
  assert.equal(archiveKeeper([run('a', 'p', 1, { flow: 'activity' }), run('b', 'p', 2, { flow: 'activity' })]), 'b');
  assert.equal(archiveKeeper([run('a', 'p', 1, { flow: 'activity' }), run('b', 'p', 0, { flow: 'lesson' })]), 'b', 'a lesson wins over a newer activity');
  assert.equal(archiveKeeper([run('a', 'p', 1, { status: 'failed' })]), null);
});

test('olderCopies: everything but the keeper, published, pinned and unfinished runs, per page or everywhere', () => {
  assert.deepEqual(olderCopies(JOBS).sort(), ['w4', 'w5']);
  assert.deepEqual(olderCopies(JOBS, 'water').sort(), ['w4', 'w5']);
  assert.deepEqual(olderCopies(JOBS, 'newton'), []);
  assert.deepEqual(olderCopies(JOBS, 'unknown'), []);
  // A page with no finished run has no keeper: every finished run of it goes.
  assert.deepEqual(olderCopies([run('a', 'p', 1, { status: 'failed' }), run('b', 'p', 2, { status: 'unsupported' })]).sort(), ['a', 'b']);
});

test('canArchiveRun: never published, pinned, unfinished or already archived runs', () => {
  const by = new Map(JOBS.map((j) => [j.jobId, j]));
  assert.equal(canArchiveRun(by.get('w2')!), true);
  assert.equal(canArchiveRun(by.get('w4')!), true, 'a failed run can go');
  assert.equal(canArchiveRun(by.get('w1')!), false, 'published');
  assert.equal(canArchiveRun(by.get('n1')!), false, 'pinned');
  assert.equal(canArchiveRun(by.get('n3')!), false, 'still building');
  assert.equal(canArchiveRun(by.get('w3')!), false, 'already archived');
});

const INFO: AccessInfo = { gate: true, granted: true, capUSD: 50, spentUSD: 0, remainingUSD: 50, buildsEnabled: true };
test('canArchive: the same gate as publishing; read-only visitors see no controls', () => {
  const at = (a: Access) => canArchive(a);
  assert.equal(at({ state: 'off' }), true);
  assert.equal(at({ state: 'granted', info: INFO }), true);
  assert.equal(at({ state: 'granted', info: { ...INFO, buildsEnabled: false, remainingUSD: 0 } }), true, 'a spent build budget does not matter');
  assert.equal(at({ state: 'locked', info: { ...INFO, granted: false } }), false);
  assert.equal(at({ state: 'loading' }), false);
});

test('rowArchiveAction: per run in Every lesson and All runs, older copies in One per page, Restore under Archived', () => {
  const rows = (scope: 'latest' | 'lessons' | 'all' | 'archived') => new Map(browseLessons(JOBS, SOURCES, { query: '', subject: null, scope }).map((r) => [r.jobId, r]));
  const all = rows('all');
  assert.deepEqual(rowArchiveAction(all.get('w2')!, 'all'), { kind: 'archive', label: 'Archive', aria: 'Archive this run of The Hydrologic Cycle' });
  assert.equal(rowArchiveAction(all.get('w1')!, 'lessons'), null, 'published');
  assert.equal(rowArchiveAction(all.get('n1')!, 'lessons'), null, 'pinned');
  assert.equal(rowArchiveAction(all.get('n3')!, 'all'), null, 'still building');
  const latest = rows('latest');
  assert.deepEqual(rowArchiveAction(latest.get('w1')!, 'latest'), { kind: 'archive-older', label: 'Archive 2 older', aria: 'Archive 2 older copies of The Hydrologic Cycle', count: 2 });
  assert.equal(rowArchiveAction(latest.get('n2')!, 'latest'), null, 'no older copies to archive');
  assert.deepEqual(rowArchiveAction(rows('archived').get('w3')!, 'archived'), { kind: 'restore', label: 'Restore', aria: 'Restore this run of The Hydrologic Cycle' });
});

test('archive words: the inline confirmation says what stays; the status line says what changed', () => {
  assert.equal(
    archiveConfirmText(512, 98),
    'Archive 512 older copies from 98 pages? Each page keeps its newest lesson, and published and pinned lessons stay. Nothing is deleted: Restore brings any back.',
  );
  assert.match(archiveConfirmText(1, 1), /^Archive 1 older copy from 1 page\?/);
  assert.equal(archiveStatusText('archive-older', 512), 'Archived 512 older copies.');
  assert.equal(archiveStatusText('archive-older', 1), 'Archived 1 older copy.');
  assert.equal(archiveStatusText('archive-older', 0), 'Nothing to archive: every page already shows one lesson.');
  assert.equal(archiveStatusText('archive', 1), 'Archived 1 run. It is listed under Archived.');
  assert.equal(archiveStatusText('restore', 1), 'Restored 1 run.');
  assert.equal(archiveStatusText('restore-all', 512), 'Restored 512 runs.');
  assert.equal(archiveStatusText('restore-all', 0), 'Nothing to restore.');
  for (const s of [archiveConfirmText(5, 2), archiveStatusText('archive', 1)]) assert.doesNotMatch(s, /[—–]/, 'no em or en dashes');
});

test('archiveErrorMessage: plain sentences for the API refusals', () => {
  assert.match(archiveErrorMessage({ code: 'ACCESS_REQUIRED' }), /access code/);
  assert.match(archiveErrorMessage({ code: 'RUN_PINNED' }), /links to it/);
  assert.match(archiveErrorMessage({ code: 'RUN_PUBLISHED' }), /Unpublish it on Review and publish/);
  assert.match(archiveErrorMessage({ code: 'RUN_ACTIVE' }), /still being built/);
  assert.match(archiveErrorMessage({ code: 'NOT_FOUND' }), /no longer on the server/);
  assert.match(archiveErrorMessage({ code: 'HTTP_404' }), /does not support archiving/);
  assert.equal(archiveErrorMessage(new Error('x')), 'The change could not be saved. Try again.');
});


// Calvin, 2 Nov: no "Show all" while two rows of the shelf still have room.
test('shelfVisible: everything that fits in three rows of the measured grid; six on an unmeasured grid', () => {
  assert.equal(shelfVisible(8, 5), 8, '8 cards in a 5-column grid');
  assert.equal(shelfVisible(10, 4), 10, 'ten published lessons at 1920 (four columns): no Show all');
  assert.equal(shelfVisible(13, 4), 12, 'the thirteenth waits for Show all');
  assert.equal(shelfVisible(11, 3), 9);
  assert.equal(shelfVisible(4, 0), 4, 'not measured yet: no cut below one sensible row');
  assert.equal(shelfVisible(9, 0), 6);
});
