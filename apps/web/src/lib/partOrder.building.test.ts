// Calvin, 2 Nov: in the Demo replay the sequence was built above the label diagram, so the finished lesson (diagram
// first) and the build (plan order) disagreed. While building, parts now sit in the same most-visual-first order as the
// finished lesson, placeholders included, so nothing jumps when the build ends.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildingOrder } from './partOrder.ts';
import type { LessonCard, LessonItem } from './lesson.ts';

const card = (componentId: string): LessonItem => ({
  kind: 'card',
  card: { key: `${componentId}:x`, componentId: componentId as LessonCard['componentId'], label: componentId, title: componentId, status: 'passed', spec: null, premium: false, note: '', message: '', detail: '', explain: null, revision: 1 },
});
const pending = (componentId: string): LessonItem => ({ kind: 'pending', slot: { componentId } as Extract<LessonItem, { kind: 'pending' }>['slot'] });
const ids = (items: readonly LessonItem[]): string[] => items.map((i) => (i.kind === 'card' ? i.card.componentId : `pending:${i.slot.componentId}`));

test('a planned diagram still being built sits above a finished sequence', () => {
  assert.deepEqual(ids(buildingOrder([card('sequence-v1'), pending('label-diagram-v1')])), ['pending:label-diagram-v1', 'sequence-v1']);
});

test('once both are built the order is the finished lesson\'s order', () => {
  assert.deepEqual(ids(buildingOrder([card('sequence-v1'), card('label-diagram-v1')])), ['label-diagram-v1', 'sequence-v1']);
});

test('text-only plans keep plan order', () => {
  assert.deepEqual(ids(buildingOrder([pending('quiz-cards-v1'), card('sequence-v1')])), ['pending:quiz-cards-v1', 'sequence-v1']);
});
