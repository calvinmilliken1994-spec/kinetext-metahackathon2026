/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { afterOrderCheck, offerShowOrder, ORDER_HINT, resultNoteShown, SHOW_ORDER_LABEL, TIMELINE_ORDER_HINT } from './orderReveal.ts';

// UX pair review 2, H1 + Calvin's Q4: a wrong "Check order" shows only which steps are out of place. The page's order
// (the step track, every card's quote, a timeline's dates) appears when the order is right, or after "Show the page's
// order", which is offered from the first wrong check on.

test('a wrong check reveals nothing and offers the page order from then on', () => {
  const out = afterOrderCheck({ correct: false, revealed: false, missed: false });
  assert.deepEqual(out, { reveal: false, missed: true });
  assert.equal(offerShowOrder({ missed: out.missed, revealed: false }), true);
});

test('a right check reveals the page order', () => {
  assert.deepEqual(afterOrderCheck({ correct: true, revealed: false, missed: false }), { reveal: true, missed: false });
  // ... also after earlier misses.
  assert.deepEqual(afterOrderCheck({ correct: true, revealed: false, missed: true }), { reveal: true, missed: true });
});

test('before any check the page order is not offered', () => {
  assert.equal(offerShowOrder({ missed: false, revealed: false }), false);
});

test('once revealed, nothing is offered and a later wrong check never hides it again', () => {
  assert.equal(offerShowOrder({ missed: true, revealed: true }), false);
  // A revealed board is never asked to reveal again (the parent already shows the order).
  assert.deepEqual(afterOrderCheck({ correct: false, revealed: true, missed: true }), { reveal: false, missed: true });
  assert.deepEqual(afterOrderCheck({ correct: true, revealed: true, missed: true }), { reveal: false, missed: true });
});

test('the note that points at the revealed order shows only once the order is revealed', () => {
  assert.equal(resultNoteShown({ revealed: false }), false);
  assert.equal(resultNoteShown({ revealed: true }), true);
});

test('the hints promise the reveal rule, never "until you check"', () => {
  for (const hint of [ORDER_HINT, TIMELINE_ORDER_HINT]) {
    assert.doesNotMatch(hint, /until you check/i);
    assert.match(hint, /right/);
  }
  assert.equal(SHOW_ORDER_LABEL, 'Show the page’s order');
});
