/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { DECLINE_CODES, KIT_GEN_COMPONENT_IDS } from '../../../../packages/contracts/kit.ts';
import type { KitSpec, LessonSpec } from '../../../../packages/contracts/kit.ts';
import { isEvidenceKey } from './evidence.ts';
import { FAILURE_MESSAGES, collectLessonQuotes, componentLabel, declineText, droppedNoteForTeacher, lessonCards, lessonQuoteKey } from './lesson.ts';
import { loadDemoLessons } from './stage6-fixtures.ts';

const lessons = loadDemoLessons();
const get = (id: string) => {
  const l = lessons.find((x) => x.id === id);
  if (l === undefined) throw new Error(`no demo lesson ${id}`);
  return l;
};

test('the demo has five fixture lessons', () => {
  assert.deepEqual(lessons.map((l) => l.id), ['drag', 'gallery', 'partial', 'declined', 'premium']);
});

test('cards follow the plan order and carry their spec and label', () => {
  const l = get('drag');
  const cards = lessonCards(l.lesson, l.specs, l.premium !== null);
  assert.deepEqual(cards.map((c) => c.componentId), ['formula-explorer-v1', 'quiz-cards-v1', 'concept-map-v1']);
  assert.ok(cards.every((c) => c.status === 'passed' && c.spec !== null && c.premium === false));
  assert.equal(cards[0]?.label, 'Formula explorer');
  assert.equal(cards[0]?.title, 'Drag equation explorer');
});

test('a failed component shows only its message, never content', () => {
  const l = get('partial');
  const cards = lessonCards(l.lesson, l.specs, false);
  const failed = cards.find((c) => c.componentId === 'formula-explorer-v1');
  assert.equal(failed?.status, 'failed');
  assert.equal(failed?.spec, null);
  assert.equal(failed?.message, 'The formula could not be checked with our calculator.');
  const skipped = cards.find((c) => c.componentId === 'concept-map-v1');
  assert.equal(skipped?.status, 'skipped');
  assert.equal(skipped?.spec, null);
});

test('every kit component has the exact failure message from the design', () => {
  assert.deepEqual(FAILURE_MESSAGES, {
    'quiz-cards-v1': 'Quiz cards could not be verified against the page.',
    'sequence-v1': 'Steps could not be ordered from the page wording.',
    'sort-groups-v1': 'Group membership could not be verified against the page.',
    'concept-map-v1': 'Connections could not be verified against the page.',
    'compare-table-v1': 'Comparison could not be verified against the page.',
    'formula-explorer-v1': 'The formula could not be checked with our calculator.',
    'balance-equation-v1': 'The reaction equation could not be verified against the page.',
  });
  for (const id of KIT_GEN_COMPONENT_IDS) assert.ok(FAILURE_MESSAGES[id].length > 10);
});

test('a "passed" entry whose spec is missing or is another component is treated as not verified', () => {
  const l = get('drag');
  const missing: LessonSpec = { ...l.lesson, components: [{ componentId: 'quiz-cards-v1', specId: 'ghost', status: 'passed', reason: '', revision: 1 }] };
  const c1 = lessonCards(missing, l.specs, false)[0];
  assert.equal(c1?.status, 'failed');
  assert.equal(c1?.spec, null);
  const quizId = Object.values(l.specs).find((s) => s.componentId === 'quiz-cards-v1')?.id as string;
  const wrong: LessonSpec = { ...l.lesson, components: [{ componentId: 'sequence-v1', specId: quizId, status: 'passed', reason: '', revision: 1 }] };
  const c2 = lessonCards(wrong, l.specs, false)[0];
  assert.equal(c2?.status, 'failed');
  assert.equal(c2?.spec, null);
});

test('a passed component with a reason shows it as a note about dropped items', () => {
  const l = get('gallery');
  const sort = lessonCards(l.lesson, l.specs, false).find((c) => c.componentId === 'sort-groups-v1');
  assert.equal(sort?.status, 'passed');
  assert.match(sort?.note ?? '', /dropped|left out/);
  const seq = lessonCards(l.lesson, l.specs, false).find((c) => c.componentId === 'sequence-v1');
  assert.equal(seq?.note, '');
});

test('a premium entry needs the premium spec; otherwise it is not verified', () => {
  const l = get('premium');
  const withPremium = lessonCards(l.lesson, l.specs, true);
  assert.equal(withPremium[0]?.premium, true);
  assert.equal(withPremium[0]?.status, 'passed');
  const without = lessonCards(l.lesson, l.specs, false);
  assert.equal(without[0]?.status, 'failed');
  assert.match(without[0]?.message ?? '', /could not be verified/);
});

test('labels cover kit and premium components', () => {
  assert.equal(componentLabel('quiz-cards-v1'), 'Quiz cards');
  assert.equal(componentLabel('timeline-v1'), 'Timeline of dated events');
  assert.equal(componentLabel('forces-1d-v1'), 'Force, mass and acceleration (1D)');
});

test('every decline code has a plain-language explanation', () => {
  for (const code of DECLINE_CODES) {
    const t = declineText(code);
    assert.ok(t.length > 20 && !t.includes(code), `${code}: ${t}`);
  }
  assert.match(declineText('too-short'), /short/);
  assert.match(declineText('' as never), /could not be turned/);
});

test('quote keys are unique and recognised as evidence', () => {
  const l = get('drag');
  const refs = collectLessonQuotes('nasa-grc-drag-equation', l.lesson.overview, l.specs);
  assert.ok(refs.length >= 15, `got ${refs.length}`);
  assert.equal(new Set(refs.map((r) => r.key)).size, refs.length);
  assert.ok(refs.every((r) => isEvidenceKey(r.key)));
  assert.ok(refs.every((r) => r.kind === 'lesson'));
  const point = refs.find((r) => r.key === lessonQuoteKey('overview-v1', 'point', 'drag-equation'));
  assert.equal(point?.quote, 'drag D is equal to the drag coefficient Cd times the density rho');
  assert.deepEqual(collectLessonQuotes('some-other-source', l.lesson.overview, l.specs), []);
});

test('quotes of every kit view are collected (gallery)', () => {
  const l = get('gallery');
  const refs = collectLessonQuotes('nij-heterozygosity', l.lesson.overview, l.specs);
  assert.equal(refs.length, 6, 'one per sort item');
  const bal = collectLessonQuotes('synthetic-balance', null, l.specs);
  assert.ok(bal.some((r) => r.key === lessonQuoteKey('balance-equation-v1', 'equation', 'equation')));
  assert.equal(bal.length, 1 + 4);
  const specs: KitSpec[] = Object.values(l.specs);
  assert.equal(specs.length, 4);
});

test('the left-out note keeps the plain sentence and drops internal ids and check codes', () => {
  assert.equal(
    droppedNoteForTeacher('1 card was left out because they could not be verified against the page: july-2-outcome (Q-06).'),
    '1 card was left out because it could not be verified against the page.',
  );
  assert.equal(
    droppedNoteForTeacher('2 steps were left out because they could not be verified against the page: a (SQ-02), b (SQ-04, SQ-05).'),
    '2 steps were left out because they could not be verified against the page.',
  );
  assert.equal(droppedNoteForTeacher('1 link was left out because its quote did not support the connection.'), '1 link was left out because its quote did not support the connection.');
  assert.equal(droppedNoteForTeacher(''), '');
});
