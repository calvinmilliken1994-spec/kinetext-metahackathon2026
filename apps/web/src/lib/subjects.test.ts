import test from 'node:test';
import assert from 'node:assert/strict';
import { SUBJECTS } from '../../../../packages/contracts/kit.ts';
import {
  SUBJECT_ORDER, chipList, filterRuns, groupSources, pickerValue, subjectCounts, subjectLabel, subjectNote, subjectOf,
  subjectOfSource, filterPrompt,
} from './subjects.ts';

const lib = (id: string, title: string, subject?: string) => ({ id, title, license: 'US-Gov-Work', kind: 'library' as const, ...(subject !== undefined ? { subject } : {}) });
const user = (id: string, title: string, subject?: string) => ({ id, title, license: 'own-work', kind: 'user' as const, ...(subject !== undefined ? { subject, subjectSource: 'muse' as const } : {}) });

const SOURCES = [
  lib('nara-a', 'Lee Resolution (1776)', 'history'),
  lib('nasa-b', 'Weight Equation', 'physics'),
  lib('nasa-a', 'Drag Equation', 'physics'),
  lib('usgs-a', 'Geologic Age', 'earth-science'),
  lib('cfpb-a', 'Compound interest', 'finance'),
  lib('odd', 'Unsorted page'),
  lib('weird', 'Weird subject', 'astrology'),
  user('user-000000000001', 'Ball thrown up', 'physics'),
  user('user-000000000002', 'My notes'),
];

test('subject order and plain teacher names cover every SUBJECT exactly once', () => {
  assert.deepEqual([...SUBJECT_ORDER].sort(), [...SUBJECTS].sort());
  assert.deepEqual(SUBJECT_ORDER, ['physics', 'maths', 'chemistry', 'biology', 'earth-science', 'finance', 'history', 'civics', 'language-reading', 'other']);
  assert.equal(subjectLabel('earth-science'), 'Earth & space');
  assert.equal(subjectLabel('maths'), 'Maths');
  assert.equal(subjectLabel('language-reading'), 'Language & reading');
  assert.equal(subjectLabel('other'), 'Other');
});

test('subjectOf: missing or unknown subjects read as other', () => {
  assert.equal(subjectOf({ subject: 'physics' }), 'physics');
  assert.equal(subjectOf({}), 'other');
  assert.equal(subjectOf({ subject: 'astrology' }), 'other');
  assert.equal(subjectOf({ subject: 3 }), 'other');
});

test('subjectCounts: subject order, empty subjects left out', () => {
  assert.deepEqual(subjectCounts(SOURCES, subjectOf), [
    { subject: 'physics', label: 'Physics', count: 3 },
    { subject: 'earth-science', label: 'Earth & space', count: 1 },
    { subject: 'finance', label: 'Finance', count: 1 },
    { subject: 'history', label: 'History', count: 1 },
    { subject: 'other', label: 'Other', count: 3 },
  ]);
  assert.deepEqual(subjectCounts([], subjectOf), []);
});

test('chipList keeps an active subject visible even when it has nothing to show (so it can be switched off)', () => {
  const counts = subjectCounts(SOURCES, subjectOf);
  assert.equal(chipList(counts, null), counts);
  assert.equal(chipList(counts, 'physics'), counts);
  const withMaths = chipList(counts, 'maths');
  assert.deepEqual(withMaths.map((c) => c.subject), ['physics', 'maths', 'earth-science', 'finance', 'history', 'other']);
  assert.equal(withMaths[1]?.count, 0);
});

test('groupSources: library pages grouped in subject order and sorted by title; teacher pages kept apart', () => {
  const all = groupSources(SOURCES, null);
  assert.deepEqual(all.groups.map((g) => [g.subject, g.label, g.items.map((s) => s.id)]), [
    ['physics', 'Physics', ['nasa-a', 'nasa-b']],
    ['earth-science', 'Earth & space', ['usgs-a']],
    ['finance', 'Finance', ['cfpb-a']],
    ['history', 'History', ['nara-a']],
    ['other', 'Other', ['odd', 'weird']],
  ]);
  assert.deepEqual(all.teacher.map((s) => s.id), ['user-000000000001', 'user-000000000002']);
  assert.equal(all.visible.size, SOURCES.length);
  assert.equal(all.total, SOURCES.length);
});

test('groupSources with a filter: only that subject, teacher pages by their Muse-detected subject', () => {
  const phys = groupSources(SOURCES, 'physics');
  assert.deepEqual(phys.groups.map((g) => g.subject), ['physics']);
  assert.deepEqual(phys.teacher.map((s) => s.id), ['user-000000000001']);
  assert.deepEqual([...phys.visible].sort(), ['nasa-a', 'nasa-b', 'user-000000000001']);
  assert.equal(phys.total, SOURCES.length, 'chip counts and totals stay unfiltered');
  const other = groupSources(SOURCES, 'other');
  assert.deepEqual(other.teacher.map((s) => s.id), ['user-000000000002']);
  const civics = groupSources(SOURCES, 'civics');
  assert.equal(civics.groups.length, 0);
  assert.equal(civics.visible.size, 0);
});

test('pickerValue: the selected page only when it is in the filtered list, else the prompt', () => {
  const phys = groupSources(SOURCES, 'physics');
  assert.equal(pickerValue('nasa-a', phys.visible), 'nasa-a');
  assert.equal(pickerValue('nara-a', phys.visible), '');
  assert.equal(pickerValue(null, phys.visible), '');
  assert.equal(filterPrompt('physics', 3), 'Choose one of 3 Physics pages');
  assert.equal(filterPrompt('earth-science', 1), 'Choose the Earth & space page');
  assert.equal(filterPrompt('civics', 0), 'No Civics pages');
});

test('subjectNote: curated library subject, teacher subject labelled as detected by Muse, nothing when unknown', () => {
  assert.deepEqual(subjectNote(lib('x', 't', 'physics')), { text: 'Physics', detected: false });
  assert.equal(subjectNote(lib('x', 't')), null);
  assert.equal(subjectNote(lib('x', 't', 'astrology')), null);
  assert.deepEqual(subjectNote(user('user-000000000001', 't', 'biology')), { text: 'Biology · detected by Muse', detected: true });
  assert.equal(subjectNote(user('user-000000000002', 't')), null);
  assert.equal(subjectNote(null), null);
});

test('runs: subject of each run comes from its page; filter by subject, unknown pages read as other', () => {
  const byId = new Map(SOURCES.map((s) => [s.id, s] as const));
  assert.equal(subjectOfSource(byId, 'nasa-a'), 'physics');
  assert.equal(subjectOfSource(byId, 'gone'), 'other');
  const jobs = [
    { jobId: 'j1', sourceId: 'nasa-a' }, { jobId: 'j2', sourceId: 'nara-a' }, { jobId: 'j3', sourceId: 'user-000000000001' }, { jobId: 'j4', sourceId: 'gone' },
  ];
  assert.deepEqual(filterRuns(jobs, byId, null).map((j) => j.jobId), ['j1', 'j2', 'j3', 'j4']);
  assert.deepEqual(filterRuns(jobs, byId, 'physics').map((j) => j.jobId), ['j1', 'j3']);
  assert.deepEqual(filterRuns(jobs, byId, 'other').map((j) => j.jobId), ['j4']);
  assert.deepEqual(subjectCounts(jobs, (j) => subjectOfSource(byId, j.sourceId)).map((c) => [c.subject, c.count]), [['physics', 2], ['history', 1], ['other', 1]]);
});
