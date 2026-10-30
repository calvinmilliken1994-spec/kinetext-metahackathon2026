// Stage 7e (docs/specs/STAGE-7e-library-and-wording.md): featured and retired library pages in the picker, and the
// coming `computing` subject ('Computing & AI'), which must not break anything before the contracts change lands.
import test from 'node:test';
import assert from 'node:assert/strict';
import { isSubject } from '../../../../packages/contracts/kit.ts';
import {
  SUBJECT_ORDER, activeSources, groupSources, isRetiredPage, pickerValue, retiredRunNote, showAllLabel, subjectCounts, subjectLabel, subjectOf,
} from './subjects.ts';

const lib = (id: string, title: string, subject: string, flags: { featured?: boolean; retired?: boolean } = {}) =>
  ({ id, title, license: 'US-Gov-Work', kind: 'library' as const, subject, ...flags });

const PHYSICS = [
  lib('p-weight', 'Weight equation', 'physics'),
  lib('p-drag', 'Drag equation', 'physics', { featured: true }),
  lib('p-bern', 'Bernoulli’s equation', 'physics', { featured: true }),
  lib('p-sound', 'Speed of sound', 'physics'),
  lib('p-old', 'Ballistic flight equations', 'physics', { retired: true }),
  lib('p-wright', 'Re-living the Wright way', 'physics', { retired: true }),
];
const SOURCES = [
  ...PHYSICS,
  lib('m-func', 'Idea of functions', 'maths'),
  lib('h-lee', 'Lee Resolution', 'history'),
  { id: 'user-000000000001', title: 'My notes', license: 'own-work', kind: 'user' as const, subject: undefined },
];

test('computing comes right after maths and reads "Computing & AI"; every SUBJECT has a place in the order', () => {
  assert.deepEqual(SUBJECT_ORDER, ['physics', 'maths', 'computing', 'chemistry', 'biology', 'earth-science', 'finance', 'history', 'civics', 'language-reading', 'other']);
  assert.equal(subjectLabel('computing'), 'Computing & AI');
});

test('subjectOf: "computing" is a subject once the contracts list it, and Other until then (never a crash)', () => {
  assert.equal(subjectOf({ subject: 'computing' }), isSubject('computing') ? 'computing' : 'other');
  assert.equal(subjectOf({ subject: 'robotics' }), 'other');
});

test('retired pages never reach the picker lists or the chip counts', () => {
  assert.equal(isRetiredPage({ retired: true }), true);
  assert.equal(isRetiredPage({ retired: 'yes' }), false);
  assert.deepEqual(activeSources(SOURCES).map((s) => s.id), ['p-weight', 'p-drag', 'p-bern', 'p-sound', 'm-func', 'h-lee', 'user-000000000001']);
  assert.deepEqual(subjectCounts(activeSources(SOURCES), subjectOf).map((c) => [c.subject, c.count]), [['physics', 4], ['maths', 1], ['history', 1], ['other', 1]]);
  const all = groupSources(SOURCES, null);
  assert.ok(![...all.visible].includes('p-old'));
  assert.equal(all.total, 7, 'the All chip counts active pages only');
});

test('within a subject, featured pages come first (A–Z), then the rest (A–Z)', () => {
  const g = groupSources(SOURCES, 'physics');
  assert.deepEqual(g.groups[0]?.items.map((s) => s.id), ['p-bern', 'p-drag', 'p-sound', 'p-weight']);
});

test('collapsed picker: a subject with featured pages shows only those, with a "Show all" toggle that counts active pages', () => {
  const g = groupSources(SOURCES, null, { collapse: true });
  const physics = g.groups.find((x) => x.subject === 'physics');
  assert.deepEqual(physics?.items.map((s) => s.id), ['p-bern', 'p-drag']);
  assert.equal(physics?.hidden, 2);
  assert.equal(physics?.size, 4);
  assert.equal(showAllLabel(physics!), 'Show all physics (4)');
  // Subjects without featured pages are never collapsed.
  assert.equal(g.groups.find((x) => x.subject === 'maths')?.hidden, 0);
  assert.ok(!g.visible.has('p-weight'));

  const open = groupSources(SOURCES, null, { collapse: true, expanded: new Set(['physics']) });
  assert.deepEqual(open.groups.find((x) => x.subject === 'physics')?.items.map((s) => s.id), ['p-bern', 'p-drag', 'p-sound', 'p-weight']);
  assert.equal(open.groups.find((x) => x.subject === 'physics')?.hidden, 0);
});

test('collapsed picker keeps the selected page visible even when it is not featured', () => {
  const g = groupSources(SOURCES, null, { collapse: true, selectedId: 'p-weight' });
  assert.deepEqual(g.groups.find((x) => x.subject === 'physics')?.items.map((s) => s.id), ['p-bern', 'p-drag', 'p-weight']);
  assert.equal(g.groups.find((x) => x.subject === 'physics')?.hidden, 1);
  assert.equal(pickerValue('p-weight', g.visible), 'p-weight');
});

test('a retired page that is open (from an old run) is offered on its own, labelled, and never counted', () => {
  const g = groupSources(SOURCES, null, { collapse: true, selectedId: 'p-old' });
  assert.equal(g.retired?.id, 'p-old');
  assert.equal(pickerValue('p-old', g.visible), 'p-old');
  assert.equal(g.total, 7);
  assert.equal(groupSources(SOURCES, null, { selectedId: 'p-sound' }).retired, null);
});

test('runs of retired pages are labelled', () => {
  const byId = new Map(SOURCES.map((s) => [s.id, s] as const));
  assert.equal(retiredRunNote(byId, 'p-old'), 'Retired page');
  assert.equal(retiredRunNote(byId, 'p-drag'), null);
  assert.equal(retiredRunNote(byId, 'gone'), null);
});
