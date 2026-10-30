/// <reference types="node" />
// Stage 7e: the presentation overview opens with the lesson's headline and key points — never Muse's internal page-coverage
// note (analysis.pageCoverage, a technical field shown only under technical details in the workspace).
import test from 'node:test';
import assert from 'node:assert/strict';
import { deckFromLesson } from './presentation.ts';
import { loadDemoLessons } from './stage6-fixtures.ts';

const drag = loadDemoLessons().find((l) => l.id === 'drag');
if (drag === undefined) throw new Error('demo lesson missing');

test('the deck never carries the internal page-coverage note', () => {
  const NOTE = 'Explains drag free ballistic flight with split horizontal and vertical motion.';
  const analysis = drag.analysis === null ? null : { ...drag.analysis, pageCoverage: NOTE };
  const deck = deckFromLesson({
    jobId: 'job-drag', lesson: drag.lesson, specs: drag.specs, premium: null, analysis, source: null,
    disclosure: 'AI-generated.', checks: null, quotes: null, fallbackTitle: 'Lesson',
  });
  assert.ok(deck.overview !== null);
  assert.ok(!JSON.stringify(deck).includes(NOTE), 'pageCoverage must not reach the presentation deck');
  assert.equal(deck.headline, drag.lesson.overview?.headline);
});
