import test from 'node:test';
import assert from 'node:assert/strict';
import { activityFirst, lessonPartKind, lessonStatusLine, partCounts, provenanceSentence, visualRank } from './partOrder.ts';
import type { LessonCard, LessonItem } from './lesson.ts';

const card = (componentId: string, status: LessonCard['status'] = 'passed'): LessonItem => ({
  kind: 'card',
  card: { key: `${componentId}:x`, componentId: componentId as LessonCard['componentId'], label: componentId, title: componentId, status, spec: null, premium: false, note: '', message: '', detail: '', explain: null, revision: 1 },
});
const ids = (items: readonly LessonItem[]): string[] => items.map((i) => (i.kind === 'card' ? i.card.componentId : `pending:${i.slot.componentId}`));

test('pH plan [quiz, ladder] opens on the ladder; the quiz follows', () => {
  const l = activityFirst([card('quiz-cards-v1'), card('log-ladder-v1')]);
  assert.equal(l.lead?.kind === 'card' && l.lead.card.componentId, 'log-ladder-v1');
  assert.deepEqual(ids(l.rest), ['quiz-cards-v1']);
});

test('Electoral College [sequence, threshold] opens on the threshold', () => {
  const l = activityFirst([card('sequence-v1'), card('threshold-v1')]);
  assert.equal(l.lead?.kind === 'card' && l.lead.card.componentId, 'threshold-v1');
});

test('a figure outranks every other kind; a simulation comes next', () => {
  assert.equal(lessonPartKind('projectile-v1'), 'simulation');
  assert.equal(lessonPartKind('timeline-v1'), 'timeline');
  assert.ok(visualRank('label-diagram-v1') < visualRank(lessonPartKind('projectile-v1')));
  assert.ok(visualRank(lessonPartKind('projectile-v1')) < visualRank('formula-explorer-v1'));
  assert.ok(visualRank('data-table-v1') < visualRank('quiz-cards-v1'));
  const l = activityFirst([card('quiz-cards-v1'), card('formula-explorer-v1'), card('label-diagram-v1')]);
  assert.equal(l.lead?.kind === 'card' && l.lead.card.componentId, 'label-diagram-v1');
  // the same rule as the slides: other visual parts before the text-first ones
  assert.deepEqual(ids(l.rest), ['formula-explorer-v1', 'quiz-cards-v1']);
});

test('equal ranks keep plan order (quiz before sequence when planned so)', () => {
  const l = activityFirst([card('quiz-cards-v1'), card('sequence-v1')]);
  assert.equal(l.lead?.kind === 'card' && l.lead.card.componentId, 'quiz-cards-v1');
  const m = activityFirst([card('sequence-v1'), card('quiz-cards-v1')]);
  assert.equal(m.lead?.kind === 'card' && m.lead.card.componentId, 'sequence-v1');
});

test('a held-back part never leads; it goes to the left-out notice after the working parts', () => {
  const l = activityFirst([card('log-ladder-v1', 'failed'), card('quiz-cards-v1'), card('sequence-v1', 'skipped')]);
  assert.equal(l.lead?.kind === 'card' && l.lead.card.componentId, 'quiz-cards-v1');
  assert.deepEqual(ids(l.rest), []);
  assert.deepEqual(l.leftOut.map((c) => c.componentId), ['log-ladder-v1', 'sequence-v1']);
});

test('nothing passed: no lead, every part left out', () => {
  const l = activityFirst([card('quiz-cards-v1', 'failed')]);
  assert.equal(l.lead, null);
  assert.equal(l.leftOut.length, 1);
});

test('status line: Needs review, parts ready, held back', () => {
  assert.equal(lessonStatusLine({ ready: 2, heldBack: 1 }), 'Needs review · 2 parts ready · 1 held back');
  assert.equal(lessonStatusLine({ ready: 1, heldBack: 0 }), 'Needs review · 1 part ready');
  assert.equal(lessonStatusLine(null), 'Needs review');
  assert.deepEqual(partCounts([{ status: 'passed' }, { status: 'failed' }, { status: 'skipped' }]), { ready: 1, heldBack: 2 });
});

test('provenance becomes one sentence; the publisher disclaimer is kept', () => {
  assert.equal(
    provenanceSentence('AI-generated with Muse Spark 1.3 (Meta). Includes material from MedlinePlus Genetics, which has not reviewed or endorsed this lesson.'),
    'AI-generated with Muse Spark 1.3 (Meta) from MedlinePlus Genetics, which has not reviewed or endorsed this lesson.',
  );
  assert.equal(
    provenanceSentence('AI-generated with Muse Spark 1.3 (Meta) from a teacher-provided text (CC BY 4.0). The wording needs teacher review.'),
    'AI-generated with Muse Spark 1.3 (Meta) from a teacher-provided text (CC BY 4.0).',
  );
  assert.match(provenanceSentence('AI-generated with X. The source\'s publisher has not reviewed or endorsed this lesson.'), /^AI-generated with X; the source’s publisher has not reviewed or endorsed this lesson\.$/);
  const other = 'AI-generated with X from a text written by the project team.';
  assert.equal(provenanceSentence(other), other);
});
