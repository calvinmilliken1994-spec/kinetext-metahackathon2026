/// <reference types="node" />
// Stage 10c M1 (docs/reviews/ux-pair-review-2-2026-11-02.md): the New lesson library search matches what a teacher
// types (subject and the page summary too), and a chosen page that a search hides is said, not silently previewed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { librarySearch, selectionOutside } from './newLesson.ts';

const page = (id: string, title: string, subject: string, purpose: string, extra: Record<string, unknown> = {}) => ({
  id, title, subject, purpose, kind: 'library' as const,
  attribution: `Source material: ${id.startsWith('noaa') ? 'NOAA National Weather Service' : 'U.S. Geological Survey'}, '${title}'.`, ...extra,
});
const LIST = [
  page('noaa-jetstream-hydrologic-cycle', 'The Hydrologic Cycle — NOAA National Weather Service, JetStream', 'earth-science',
    'library: the water cycle as an ordered set of processes (evaporation, transpiration, condensation).'),
  page('usgs-ph', 'pH and Water — USGS Water Science School', 'chemistry', 'library: pH as the measure of how acidic water is.'),
  page('usgs-flood', 'The 100-Year Flood — U.S. Geological Survey', 'maths', 'library: flood probability maths and recurrence intervals.'),
  page('old', 'A retired page about water', 'maths', 'library: water.', { retired: true }),
  { id: 'mine', title: 'My water notes', subject: 'other', purpose: '', kind: 'user' as const, attribution: '' },
];
const ids = (r: ReturnType<typeof librarySearch>): string[] => r.groups.flatMap((g) => g.items.map((s) => s.id));

test('"water" finds The Hydrologic Cycle through its summary, not only titles', () => {
  const r = librarySearch(LIST, { query: 'water', subject: null });
  assert.ok(ids(r).includes('noaa-jetstream-hydrologic-cycle'));
  assert.ok(ids(r).includes('usgs-ph'));
  assert.equal(r.total, 3, 'active library pages only: no retired page, no teacher text');
  assert.equal(r.shown, ids(r).length);
});

test('the subject name and the publisher match too; every word must match somewhere', () => {
  assert.deepEqual(ids(librarySearch(LIST, { query: 'earth', subject: null })), ['noaa-jetstream-hydrologic-cycle']);
  assert.deepEqual(ids(librarySearch(LIST, { query: 'chemistry acidic', subject: null })), ['usgs-ph']);
  assert.deepEqual(ids(librarySearch(LIST, { query: 'NOAA', subject: null })), ['noaa-jetstream-hydrologic-cycle']);
  assert.deepEqual(ids(librarySearch(LIST, { query: 'water flood', subject: null })), []);
  assert.equal(librarySearch(LIST, { query: 'library', subject: null }).shown, 0, 'the "library:" tag of the summary is not searched');
});

test('an empty search lists every active page; a subject narrows it', () => {
  assert.equal(librarySearch(LIST, { query: '  ', subject: null }).shown, 3);
  assert.deepEqual(ids(librarySearch(LIST, { query: '', subject: 'maths' })), ['usgs-flood']);
  assert.equal(librarySearch(LIST, { query: '', subject: 'maths' }).total, 3, 'the total stays the whole library');
});

test('selectionOutside: the chosen page is named when the search or subject hides it', () => {
  const r = librarySearch(LIST, { query: 'flood', subject: null });
  assert.equal(selectionOutside('noaa-jetstream-hydrologic-cycle', r), true);
  assert.equal(selectionOutside('usgs-flood', r), false);
  assert.equal(selectionOutside(null, r), false);
});
