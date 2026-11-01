/// <reference types="node" />
// ISSUE-011: a part held back after human review because the SOURCE PAGE is wrong (the API's `recheck.review`). It is
// withheld like a part that fails today's checks, but it says why in the reviewer's words and never claims a check failed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLessonStream, heldBackChecks, lessonCheckSections, normaliseJobDetail, REVIEW_HOLD_PREFIX } from './lessonJob.ts';
import { lessonWire } from './lessonJobFixtures.ts';

const REASON = 'The source page lists hydrogen sulfide as a product of chemosynthesis.';

function held() {
  const wire = lessonWire('complete');
  const lesson = wire.lesson as { components: Array<{ componentId: string; recheck?: unknown }> };
  for (const c of lesson.components) if (c.componentId === 'quiz-cards-v1') c.recheck = { publishable: false, failedChecks: [], review: { id: 'HOLD-001', reason: REASON } };
  return normaliseJobDetail(wire);
}

test('a review hold withholds the part and gives the reviewer\'s reason, marked as a review', () => {
  const d = held();
  const quiz = d.lessonData?.lesson?.components.find((c) => c.componentId === 'quiz-cards-v1');
  assert.ok(quiz);
  assert.equal(quiz.status, 'failed');
  assert.equal(quiz.reason, `${REVIEW_HOLD_PREFIX} ${REASON}`);
  assert.deepEqual(heldBackChecks(quiz), [{ id: 'HOLD-001', name: REASON, review: true }]);
  assert.equal(Object.values(d.lessonData?.kitSpecs ?? {}).some((s) => s.componentId === 'quiz-cards-v1'), false, 'its spec is not served');
});

test('a review hold never shows up as a failed check in "How it was checked"', () => {
  const d = held();
  const sections = lessonCheckSections(d);
  const quiz = sections.find((s) => s.key === 'component-quiz-cards-v1');
  assert.ok(quiz);
  assert.equal(quiz.checks.some((c) => c.id === 'HOLD-001'), false);
  assert.match(quiz.label, /held back after review/);
  assert.equal(buildLessonStream(d).lesson?.components.length, 3);
});
