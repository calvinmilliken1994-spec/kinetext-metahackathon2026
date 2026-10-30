/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { CHECKED_SENTENCE, REVIEW_STATUS, checkTally, quoteTally, receiptSegments, receiptLabel, sectionTally, withoutReviewNote } from './provenance.ts';
import { disclosureText } from './sources.ts';

// ---- Stage 7 item 2a: one status, said once ------------------------------------------------------------------------

test('the review status is said once, as a short draft status', () => {
  assert.equal(REVIEW_STATUS, 'Draft · needs teacher review');
  assert.doesNotMatch(CHECKED_SENTENCE, /teacher review/i);
  assert.match(CHECKED_SENTENCE, /checked/);
});

test('withoutReviewNote drops only the teacher-review sentence of a teacher-source disclosure', () => {
  const teacher = disclosureText({ title: 't', license: 'CC-BY-4.0', kind: 'user' }, 'Muse Spark 1.3 (Meta)');
  assert.match(teacher, /The wording needs teacher review\.$/, 'sources.ts wording this helper relies on');
  const out = withoutReviewNote(teacher);
  assert.doesNotMatch(out, /teacher review/i);
  assert.match(out, /^AI-generated with Muse Spark 1\.3 \(Meta\) from a teacher-provided text \(.+\)\.$/);
});

test('withoutReviewNote keeps publisher disclosures (NASA: AI-generated, not endorsed) unchanged', () => {
  const nasa = disclosureText({
    title: 'Ballistic flight equations', license: 'US-Gov-Work', kind: 'library',
    attribution: "Source material: NASA Glenn Research Center, Beginner's Guide to Aeronautics. NASA content is generally not subject to copyright in the United States. Used under the NASA Images and Media Usage Guidelines; NASA has not reviewed, approved or endorsed this activity.",
  }, 'Muse Spark 1.3 (Meta)');
  assert.equal(withoutReviewNote(nasa), nasa);
  assert.match(nasa, /^AI-generated with Muse Spark 1\.3 \(Meta\)\. Includes material from NASA Glenn Research Center; NASA Glenn Research Center has not reviewed or endorsed this lesson\.$/);
});

// ---- Stage 7 item 2b: the trust receipt counts come only from recorded data ------------------------------------------

test('checkTally counts a report; an empty report has no tally', () => {
  assert.deepEqual(checkTally({ checks: [{ passed: true }, { passed: true }, { passed: false }] }), { passed: 2, total: 3 });
  assert.equal(checkTally({ checks: [] }), null);
  assert.equal(checkTally(null), null);
});

test('sectionTally sums lesson check sections', () => {
  assert.deepEqual(sectionTally([{ passed: 7, total: 7 }, { passed: 5, total: 6 }]), { passed: 12, total: 13 });
  assert.equal(sectionTally([]), null);
});

test('quoteTally counts quotes found on the page; unknown while the page text is not loaded', () => {
  const quotes = [{ key: 'a' }, { key: 'b' }, { key: 'c' }];
  assert.deepEqual(quoteTally(quotes, new Set(['a', 'c'])), { found: 2, total: 3 });
  // a located key that is not one of the lesson's quotes does not count
  assert.deepEqual(quoteTally(quotes, new Set(['a', 'z'])), { found: 1, total: 3 });
  assert.equal(quoteTally(quotes, null), null);
  assert.equal(quoteTally([], new Set()), null);
});

test('receiptSegments: checks, quotes and cost in that order, with tones', () => {
  const segs = receiptSegments({ checks: { passed: 14, total: 14 }, quotes: { found: 8, total: 8 }, costUSD: 0.0471, reservedUSD: 0 });
  assert.deepEqual(segs.map((s) => s.text), ['14/14 checks', '8/8 quotes found', '$0.0471']);
  assert.deepEqual(segs.map((s) => s.tone), ['ok', 'ok', 'neutral']);
});

test('receiptSegments never invents a number: missing counts and unknown cost are omitted', () => {
  assert.deepEqual(receiptSegments({ checks: null, quotes: null, costUSD: null }).map((s) => s.text), []);
  assert.deepEqual(receiptSegments({ checks: { passed: 3, total: 4 }, quotes: null, costUSD: Number.NaN }).map((s) => [s.text, s.tone]), [['3/4 checks', 'bad']]);
  assert.deepEqual(receiptSegments({ checks: null, quotes: { found: 5, total: 6 }, costUSD: undefined }).map((s) => [s.text, s.tone]), [['5/6 quotes found', 'warn']]);
});

test('receiptSegments marks a cost that includes a reservation', () => {
  const segs = receiptSegments({ checks: null, quotes: null, costUSD: 0.2, reservedUSD: 0.05 });
  assert.deepEqual(segs.map((s) => s.text), ['$0.200 incl. reserved']);
});

test('receiptLabel spells the receipt out for screen readers', () => {
  assert.equal(
    receiptLabel({ checks: { passed: 14, total: 14 }, quotes: { found: 8, total: 8 }, costUSD: 0.0471, reservedUSD: 0 }),
    'Trust receipt: 14 of 14 checks passed, 8 of 8 quotes found on the page, estimated model cost $0.0471',
  );
  assert.equal(receiptLabel({ checks: { passed: 1, total: 1 }, quotes: null, costUSD: null }), 'Trust receipt: 1 of 1 check passed');
});
