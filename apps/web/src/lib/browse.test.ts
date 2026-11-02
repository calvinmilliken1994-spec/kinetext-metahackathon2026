/// <reference types="node" />
// Stage 10 section B: the New lesson page's library list (search + subject) and the All lessons page (finished lessons,
// newest first, subject filter and search). Pure helpers so the two pages and node tests share them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { browseLessons, browsePages, chipUnit, lessonsByPage, lessonsLede, matchesQuery, pageBreakdown, partsText, previewExcerpt, rowsCountText } from './browse.ts';
import type { LessonScope } from './browse.ts';

const page = (id: string, title: string, subject: string, extra: Record<string, unknown> = {}) => ({
  id, title, subject, kind: 'library' as const, attribution: `Source material: NOAA, '${title}'.`, ...extra,
});
const SOURCES = [
  page('water', 'The Hydrologic Cycle', 'earth-science', { featured: true }),
  page('clouds', 'Cloud types', 'earth-science'),
  page('newton', 'Newton’s Laws of Motion', 'physics', { featured: true }),
  page('lift', 'What is Lift?', 'physics'),
  page('old', 'Retired page', 'physics', { retired: true }),
  { id: 'mine', title: 'My notes on tides', subject: 'earth-science', kind: 'user' as const, attribution: 'Ms Lee' },
];

test('matchesQuery: every word must appear, case and accents ignored', () => {
  assert.equal(matchesQuery('The Hydrologic Cycle', 'hydro cycle'), true);
  assert.equal(matchesQuery('The Hydrologic Cycle', 'CYCLE water'), false);
  assert.equal(matchesQuery('Résumé of Café', 'resume cafe'), true);
  assert.equal(matchesQuery('Anything', '   '), true);
});

test('browsePages: active library pages by subject, featured first, retired and teacher texts left out', () => {
  const r = browsePages(SOURCES, { query: '', subject: null });
  assert.deepEqual(r.groups.map((g) => [g.label, g.items.map((s) => s.id)]), [
    ['Physics', ['newton', 'lift']],
    ['Earth & space', ['water', 'clouds']],
  ]);
  assert.equal(r.shown, 4);
  assert.equal(r.total, 4);
});

test('browsePages: the subject filter and the search narrow the list; the publisher is searchable', () => {
  assert.deepEqual(browsePages(SOURCES, { query: '', subject: 'physics' }).groups.map((g) => g.items.map((s) => s.id)), [['newton', 'lift']]);
  const q = browsePages(SOURCES, { query: 'cloud', subject: null });
  assert.deepEqual(q.groups.flatMap((g) => g.items.map((s) => s.id)), ['clouds']);
  assert.equal(q.shown, 1);
  assert.equal(browsePages(SOURCES, { query: 'noaa', subject: 'physics' }).shown, 2);
  assert.equal(browsePages(SOURCES, { query: 'zzz', subject: null }).shown, 0);
});

const job = (jobId: string, sourceId: string, createdAt: string, status = 'succeeded', flow: 'lesson' | 'activity' = 'lesson') =>
  ({ jobId, sourceId, createdAt, status, flow });
const JOBS = [
  job('j1', 'water', '2026-10-30T10:00:00Z'),
  job('j2', 'water', '2026-11-01T10:00:00Z'),
  job('j3', 'newton', '2026-10-31T10:00:00Z', 'failed'),
  job('j4', 'lift', '2026-10-29T10:00:00Z', 'succeeded', 'activity'),
  job('j5', 'clouds', '2026-10-28T10:00:00Z', 'unsupported'),
  job('j6', 'gone', '2026-10-27T10:00:00Z'),
];

test('lessonsByPage: finished lessons per page with the newest one to open', () => {
  const m = lessonsByPage(JOBS);
  assert.deepEqual(m.get('water'), { count: 2, latest: 'j2' });
  assert.equal(m.get('newton'), undefined, 'a failed run is not a lesson');
  assert.deepEqual(m.get('lift'), { count: 1, latest: 'j4' });
});

test('browseLessons: finished lessons newest first; All runs adds failed and declined runs', () => {
  const byId = new Map(SOURCES.map((s) => [s.id, s] as const));
  const ids = (o: Parameters<typeof browseLessons>[2]) => browseLessons(JOBS, byId, o).map((r) => r.jobId);
  assert.deepEqual(ids({ query: '', subject: null, scope: 'lessons' }), ['j2', 'j1', 'j4', 'j6']);
  assert.deepEqual(ids({ query: '', subject: null, scope: 'all' }), ['j2', 'j3', 'j1', 'j4', 'j5', 'j6']);
  assert.deepEqual(ids({ query: '', subject: 'physics', scope: 'all' }), ['j3', 'j4']);
  assert.deepEqual(ids({ query: 'hydrologic', subject: null, scope: 'lessons' }), ['j2', 'j1']);
  assert.deepEqual(ids({ query: '', subject: null, scope: 'latest' }), ['j2', 'j4', 'j6'], 'the newest finished lesson of each page');
  const gone = browseLessons(JOBS, byId, { query: '', subject: null, scope: 'lessons' }).find((r) => r.jobId === 'j6');
  assert.equal(gone?.title, 'A page no longer listed');
  assert.equal(gone?.subject, 'other');
});

test('previewExcerpt: the start of the page without markdown markers, cut at a word, about N characters', () => {
  const text = '# The Hydrologic Cycle\n\nThe basic **hydrologic** (water) cycle\n\nThe hydrologic cycle involves the continuous circulation of water in the Earth-Atmosphere system.';
  assert.equal(previewExcerpt(text, 400), 'The Hydrologic Cycle\n\nThe basic hydrologic (water) cycle\n\nThe hydrologic cycle involves the continuous circulation of water in the Earth-Atmosphere system.');
  const cut = previewExcerpt(text, 60);
  assert.ok(cut.endsWith('…'));
  assert.ok(cut.length <= 61);
  assert.ok(!/\s…$/.test(cut), 'no space before the ellipsis');
  assert.equal(previewExcerpt('a\n\n\n\n\nb', 50), 'a\n\nb');
  assert.equal(previewExcerpt(text, 400, 'The hydrologic cycle').startsWith('The basic hydrologic'), true, 'a first line that repeats the title is dropped');
  assert.equal(previewExcerpt(text, 400, 'Clouds').startsWith('The Hydrologic Cycle'), true);
});

// ---- Stage 10c slice D (UX review 2, M5): All lessons counts, units and the 104 vs 97 pages ---------------------------

test('pageBreakdown: pages with a finished lesson, split into library, your own and no longer listed', () => {
  const byId = new Map(SOURCES.map((s) => [s.id, s] as const));
  const jobs = [
    job('a', 'water', '2026-11-01T10:00:00Z'), job('b', 'water', '2026-10-30T10:00:00Z'), job('c', 'newton', '2026-10-31T10:00:00Z'),
    job('d', 'mine', '2026-10-29T10:00:00Z'), job('e', 'gone', '2026-10-27T10:00:00Z'), job('f', 'old', '2026-10-26T10:00:00Z'),
    job('g', 'lift', '2026-10-25T10:00:00Z', 'failed'),
  ];
  assert.deepEqual(pageBreakdown(jobs, byId), { pages: 5, library: 2, own: 1, retired: 2 });
});

test('lessonsLede: says what the pages are, and why there are more than the library lists', () => {
  assert.equal(
    lessonsLede(670, { pages: 104, library: 97, own: 2, retired: 5 }),
    '670 finished lessons and activities from 104 pages: 97 in the library, 2 pasted by a teacher and 5 since retired from it. Open one to try its parts, present it, or see how it was built and checked.',
  );
  assert.equal(
    lessonsLede(1, { pages: 1, library: 1, own: 0, retired: 0 }),
    '1 finished lesson or activity from 1 page, in the library. Open it to try its parts, present it, or see how it was built and checked.',
  );
  assert.equal(
    lessonsLede(12, { pages: 9, library: 9, own: 0, retired: 0 }),
    '12 finished lessons and activities from 9 pages, all in the library. Open one to try its parts, present it, or see how it was built and checked.',
  );
});

test('rowsCountText: the unit follows the list (pages, lessons, runs), singular for one', () => {
  const t = (scope: LessonScope, n: number, subject: string | null = null, query = '') => rowsCountText({ scope, count: n, subjectLabel: subject, query });
  assert.equal(t('latest', 104), '104 pages · the newest lesson of each');
  assert.equal(t('latest', 1), '1 page · the newest lesson of each');
  assert.equal(t('lessons', 670), '670 lessons');
  assert.equal(t('lessons', 1), '1 lesson');
  assert.equal(t('all', 746), '746 runs');
  assert.equal(t('all', 1), '1 run');
  assert.equal(t('latest', 0), 'No pages');
  assert.equal(t('lessons', 0), 'No lessons');
  assert.equal(t('all', 0), 'No runs');
  assert.equal(t('latest', 19, 'Physics'), '19 pages in Physics · the newest lesson of each');
  assert.equal(t('lessons', 3, 'Physics', ' water '), '3 lessons in Physics matching “water”');
});

test('chipUnit: what a subject chip counts follows the list too', () => {
  assert.equal(chipUnit('latest'), 'page');
  assert.equal(chipUnit('lessons'), 'lesson');
  assert.equal(chipUnit('all'), 'run');
});

test('partsText: "2 of 3 parts", singular for one, the activity for a classic run', () => {
  const lesson = (published: number, planned: number) => ({ flow: 'lesson', lesson: { componentsPublished: published, componentsPlanned: planned } });
  assert.equal(partsText(lesson(2, 3)), '2 of 3 parts');
  assert.equal(partsText(lesson(1, 1)), '1 of 1 part');
  assert.equal(partsText(lesson(0, 1)), '0 of 1 part');
  assert.equal(partsText({ flow: 'activity' }), 'One activity');
  assert.equal(partsText({ flow: 'lesson' }), '');
});

test('browsePages: the subject name is searchable too ("physics" finds the Physics pages)', () => {
  assert.deepEqual(browsePages(SOURCES, { query: 'physics', subject: null }).groups.flatMap((g) => g.items.map((s) => s.id)), ['newton', 'lift']);
  assert.deepEqual(browsePages(SOURCES, { query: 'earth cycle', subject: null }).groups.flatMap((g) => g.items.map((s) => s.id)), ['water']);
});
