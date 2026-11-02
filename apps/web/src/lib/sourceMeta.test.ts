/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { quoteCountLine } from './sourceMeta.ts';

// Polish from UX pair review 2: at 1920 the source header cut "NOAA National Weather Service · 21 of 21 qu…". The credit
// keeps the first line; the quote count gets a quiet line of its own, so neither is cut.

test('the quote count reads as its own short sentence', () => {
  assert.equal(quoteCountLine({ found: 21, total: 21 }), '21 of 21 quotes found on the page');
  assert.equal(quoteCountLine({ found: 1, total: 1 }), '1 of 1 quote found on the page');
  assert.equal(quoteCountLine({ found: 18, total: 21 }), '18 of 21 quotes found on the page');
});

test('no count line while the text is not loaded or when the lesson cites nothing (never a guessed number)', () => {
  assert.equal(quoteCountLine({ found: null, total: 4 }), null);
  assert.equal(quoteCountLine({ found: 3, total: 0 }), null);
});
