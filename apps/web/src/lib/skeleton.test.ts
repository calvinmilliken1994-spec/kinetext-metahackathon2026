/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { LESSON_SKELETON, paragraphLines, SOURCE_SKELETON } from './skeleton.ts';

// UX pair review 2, M7: a cold start showed ~3 s of empty dark panels with "Loading the lesson…" / "Loading the page…".
// The skeleton sketches the lesson's shape (title, status line, the first part with its figure and controls, the notes)
// and the page's text as bars, so the wait looks like the lesson arriving.

test('paragraph bars are deterministic, between 45% and 98% wide, and the last line of a paragraph is the shortest', () => {
  const a = paragraphLines(5, 3);
  assert.deepEqual(a, paragraphLines(5, 3));
  assert.equal(a.length, 5);
  for (const w of a) assert.ok(w >= 45 && w <= 98, `width ${w}`);
  assert.equal(a[a.length - 1], Math.min(...a));
  assert.notDeepEqual(paragraphLines(5, 3), paragraphLines(5, 4));
});

test('a one-line paragraph is a short line', () => {
  const [w] = paragraphLines(1, 0);
  assert.ok(w !== undefined && w < 80);
});

test('the source sketch is a few paragraphs of text, the lesson sketch a part with controls and the notes', () => {
  assert.ok(SOURCE_SKELETON.length >= 4);
  for (const p of SOURCE_SKELETON) assert.ok(p.length >= 1 && p.length <= 6);
  assert.ok(LESSON_SKELETON.controls >= 3);
  assert.ok(LESSON_SKELETON.notes.length >= 3);
});
