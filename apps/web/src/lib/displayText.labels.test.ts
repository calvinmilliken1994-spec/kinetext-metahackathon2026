/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { capitalFirst, hiddenAnswerLead, joinSentences } from './displayText.ts';

test('joinSentences: an AI-written note without a full stop still reads as its own sentence', () => {
  assert.equal(
    joinSentences('The page gives these steps in this order.', 'Follows the page from convening through debate to compromise', 'Drag a step along the track.'),
    'The page gives these steps in this order. Follows the page from convening through debate to compromise. Drag a step along the track.',
  );
  assert.equal(joinSentences('One.', '', '  ', 'Two'), 'One. Two.', 'empty parts are skipped');
  assert.equal(joinSentences('Is it a cycle?', 'yes it is!'), 'Is it a cycle? Yes it is!', 'existing end punctuation is kept; the first letter is capitalised');
  assert.equal(joinSentences('Ends with a quote “like this.”'), 'Ends with a quote “like this.”');
  assert.equal(joinSentences('A note ending in a colon:'), 'A note ending in a colon.', 'a dangling colon or comma becomes a full stop');
  assert.equal(joinSentences('  spaced   out note  '), 'Spaced out note.');
});

test('capitalFirst: sentence case for AI-written labels, without breaking symbols, units or names', () => {
  assert.equal(capitalFirst('quorum of seven states was obtained'), 'Quorum of seven states was obtained');
  assert.equal(capitalFirst('art of compromise'), 'Art of compromise');
  assert.equal(capitalFirst('energy'), 'Energy');
  assert.equal(capitalFirst('Federal Convention convened'), 'Federal Convention convened');
  assert.equal(capitalFirst('mRNA carries the code'), 'mRNA carries the code', 'mixed-case words are kept');
  assert.equal(capitalFirst('pH of 7'), 'pH of 7');
  assert.equal(capitalFirst('kg per cubic metre'), 'kg per cubic metre', 'unit symbols are kept');
  assert.equal(capitalFirst('m/s'), 'm/s');
  assert.equal(capitalFirst('x increases'), 'x increases', 'a single letter may be a variable');
  assert.equal(capitalFirst('12 states'), '12 states');
  assert.equal(capitalFirst('“quoted” words'), '“quoted” words');
  assert.equal(capitalFirst(''), '');
});

test('hiddenAnswerLead: the words of a scene label without its number and unit', () => {
  assert.equal(hiddenAnswerLead('max height 12.34 m'), 'max height');
  assert.equal(hiddenAnswerLead('a = 343.2 m/s'), 'a =');
  assert.equal(hiddenAnswerLead('L = 1,250 N'), 'L =');
  assert.equal(hiddenAnswerLead('N = 12.5'), 'N =');
  assert.equal(hiddenAnswerLead('$1,647.01'), '');
  assert.equal(hiddenAnswerLead('0.42'), '');
  assert.equal(hiddenAnswerLead('class guess'), 'class guess', 'no number: the words stay');
  assert.equal(hiddenAnswerLead('V0 = 12 m/s'), 'V0 =', 'a digit inside a symbol is not the value');
});
