/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import type { QuizCardsSpec } from '../../../../packages/contracts/kit.ts';
import { gradeQuizCard, quizCards, quizSummary } from './quiz.ts';
import { loadDemoLessons } from './stage6-fixtures.ts';

const drag = loadDemoLessons().find((l) => l.id === 'drag');
const spec = Object.values(drag?.specs ?? {}).find((s) => s.componentId === 'quiz-cards-v1') as QuizCardsSpec;

test('fixture quiz has three cards', () => {
  assert.equal(spec.cards.length, 3);
});

test('each card shows every option exactly once and tags the original index', () => {
  const cards = quizCards(spec);
  assert.equal(cards.length, 3);
  cards.forEach((c, i) => {
    const original = spec.cards[i]?.options ?? [];
    assert.deepEqual(c.options.map((o) => o.text).sort(), [...original].sort());
    for (const o of c.options) assert.equal(o.text, original[o.index]);
  });
});

test('the shuffle is seeded: same seed same order, other seeds move something', () => {
  assert.deepEqual(quizCards(spec), quizCards(spec));
  const orders = new Set<string>();
  for (let seed = 0; seed < 20; seed++) orders.add(quizCards({ ...spec, seed }).map((c) => c.options.map((o) => o.index).join('')).join('|'));
  assert.ok(orders.size > 3);
});

test('the right answer (stored first) is never displayed first', () => {
  for (let seed = 0; seed < 200; seed++) {
    for (const c of quizCards({ ...spec, seed })) assert.notEqual(c.options[0]?.index, 0, `seed ${seed} card ${c.id}`);
  }
});

test('grading picks the stored first option as the answer', () => {
  const id = spec.cards[0]?.id as string;
  const right = gradeQuizCard(spec, id, 0);
  assert.equal(right?.correct, true);
  assert.equal(right?.correctText, spec.cards[0]?.options[0]);
  const wrong = gradeQuizCard(spec, id, 2);
  assert.equal(wrong?.correct, false);
  assert.equal(wrong?.pickedText, spec.cards[0]?.options[2]);
  assert.equal(wrong?.correctText, spec.cards[0]?.options[0]);
});

test('grading rejects unknown cards and out-of-range options', () => {
  assert.equal(gradeQuizCard(spec, 'nope', 0), null);
  assert.equal(gradeQuizCard(spec, spec.cards[0]?.id as string, 9), null);
  assert.equal(gradeQuizCard(spec, spec.cards[0]?.id as string, -1), null);
});

test('summary counts answered and correct', () => {
  const a = gradeQuizCard(spec, spec.cards[0]?.id as string, 0);
  const b = gradeQuizCard(spec, spec.cards[1]?.id as string, 1);
  assert.deepEqual(quizSummary([a, b].filter((g) => g !== null), 3), { answered: 2, correct: 1, total: 3, done: false });
  assert.equal(quizSummary([], 3).done, false);
  assert.equal(quizSummary([a, a, a].filter((g) => g !== null), 3).done, true);
});
