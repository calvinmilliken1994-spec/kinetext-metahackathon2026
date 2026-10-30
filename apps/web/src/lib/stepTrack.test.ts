/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { quoteDate, stationResults, stationXs } from './stepTrack.ts';

test('stationXs: n evenly spaced stations inside the insets, first and last on the insets', () => {
  const xs = stationXs(5, 1000, 40);
  assert.deepEqual(xs, [40, 270, 500, 730, 960]);
  assert.deepEqual(stationXs(1, 1000, 40), [500]);
  assert.deepEqual(stationXs(0, 1000, 40), []);
});

test('stationResults: per step id, whether the learner put it in its right place', () => {
  const r = stationResults({ positions: [true, false, false, true] }, ['a', 'c', 'b', 'd']);
  assert.deepEqual(r, { a: true, c: false, b: false, d: true });
});

test('quoteDate: the one date a step quote states, read verbatim from the quote (never completed or invented)', () => {
  // stored nara-constitution step quotes (job-20261030045550-8266ebd8)
  assert.equal(quoteDate('The Federal Convention convened in the State House (Independence Hall) in Philadelphia on May 14, 1787'), 'May 14, 1787');
  assert.equal(quoteDate('the members adjourned from day to day until a quorum of seven states was obtained on May 25'), 'May 25');
  assert.equal(quoteDate('Through discussion and debate it became clear by mid-June that, rather than amend the existing Articles'), null);
  assert.equal(quoteDate('the delegates debated, and redrafted the articles of the new Constitution'), null);
  // other supported forms
  assert.equal(quoteDate('ratified December 15, 1791, as the Bill of Rights'), 'December 15, 1791');
  assert.equal(quoteDate('signed in April 1803 in Paris'), 'April 1803');
  assert.equal(quoteDate('on 4 July 1776 the Congress'), '4 July 1776');
  assert.equal(quoteDate('In 1803, the United States bought'), '1803');
  assert.equal(quoteDate('in 500 BCE the city'), '500 BCE');
  // not dates: amounts, distances, words that merely look like months
  assert.equal(quoteDate('authorized to pay France up to $10 million'), null);
  assert.equal(quoteDate('a march of 2000 miles'), null);
  assert.equal(quoteDate('the delegates may 14 times have voted'), null);
  assert.equal(quoteDate('the United States doubled its size, expanding the nation westward.'), null);
  // two different dates: which one belongs to the step is not clear, so none is shown
  assert.equal(quoteDate('from May 14, 1787 to September 17, 1787'), null);
  // the same date twice is still one date
  assert.equal(quoteDate('in 1787 ... in 1787'), '1787');
});

test('quoteDate keeps a bound word that stands before the date, so "after January 1, 1863" is never shown as the date itself', () => {
  assert.equal(quoteDate('After January 1, 1863, every advance of federal troops expanded the domain of freedom.'), 'After January 1, 1863');
  assert.equal(quoteDate('still in rebellion as of January 1, 1863, would be free'), 'as of January 1, 1863');
  assert.equal(quoteDate('no vote was taken until July 2, 1776'), 'until July 2, 1776');
  assert.equal(quoteDate('the rule held since 1803 in the territory'), 'since 1803');
  assert.equal(quoteDate('On June 7, 1776, Richard Henry Lee introduced a resolution'), 'June 7, 1776');
});
