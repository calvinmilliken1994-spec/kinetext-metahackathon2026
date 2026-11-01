import test from 'node:test';
import assert from 'node:assert/strict';
import { libraryCounts, teacherNote, toggleSubject } from './libraryCounts.ts';

const lib = (id: string, subject: string, extra: Record<string, unknown> = {}) => ({ id, title: id, kind: 'library' as const, subject, ...extra });
const SOURCES = [
  lib('p1', 'physics', { featured: true }), lib('p2', 'physics'), lib('p3', 'physics', { retired: true }),
  lib('e1', 'earth-science', { featured: true }), lib('e2', 'earth-science'),
  { id: 'u1', title: 'Moon text', kind: 'user' as const, subject: 'physics' }, { id: 'u2', title: 'Glider', kind: 'user' as const },
];

test('the All count is active library pages only (the tour count); teacher texts apart', () => {
  const c = libraryCounts(SOURCES);
  assert.equal(c.library, 4);
  assert.equal(c.teacher, 2);
  assert.deepEqual(c.counts.map((x) => [x.subject, x.count]), [['physics', 2], ['earth-science', 2]]);
  assert.equal(teacherNote(c.teacher), '+ 2 teacher texts');
  assert.equal(teacherNote(0), '');
});

test('the Show all toggle follows the chip that is on, else the selected page', () => {
  assert.equal(toggleSubject('physics', SOURCES, 'e1'), 'physics');
  assert.equal(toggleSubject(null, SOURCES, 'e1'), 'earth-science');
  assert.equal(toggleSubject(null, SOURCES, null), null);
  assert.equal(toggleSubject(null, SOURCES, 'u1'), null);
});
