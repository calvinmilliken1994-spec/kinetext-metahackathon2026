/// <reference types="node" />
// Stage 10 section B: the New lesson page's library list (search + subject) and the All lessons page (finished lessons,
// newest first, subject filter and search). Pure helpers so the two pages and node tests share them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { browseLessons, browsePages, lessonsByPage, matchesQuery, previewExcerpt } from './browse.ts';

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
