/// <reference types="node" />
// Stage 10c slice D (UX review 2: H3, M2, M8, Results polish): the wording of the checks drawer, How it works and the Results
// index, held in one lib file so a test can pin what the product claims.
import test from 'node:test';
import assert from 'node:assert/strict';
import { AI_SUMMARY_PHRASE, BAR_SCALE_NOTE, CHECKS_INTRO, HOW_STEPS, howLede, RESULTS_SECTIONS } from './pageCopy.ts';
import { NOT_REVIEWED_LINE } from './review.ts';

test('the checks drawer says what code matches and recomputes, and that it does not check the page itself (H3)', () => {
  assert.match(CHECKS_INTRO, /^Code matches every quote to the page and recomputes every number it calculates\. It does not check whether the page itself is right\./);
  assert.doesNotMatch(CHECKS_INTRO, /compares every quote/);
  assert.match(CHECKS_INTRO, /Open a part to see what it checked\.$/);
});

test('How it works: the lede calls the summary AI-written, tied to the sentence each point came from (M2)', () => {
  const lede = howLede('97 licensed public pages in 10 subjects');
  assert.match(lede, /a short AI-written summary, each point tied to the sentence it came from/);
  assert.doesNotMatch(lede, /page’s own words/);
  assert.ok(lede.includes(AI_SUMMARY_PHRASE));
  assert.match(lede, /97 licensed public pages in 10 subjects/);
});

test('How it works: six steps; step 4 no longer claims more than the checks prove (M8)', () => {
  assert.equal(HOW_STEPS.length, 6);
  const four = HOW_STEPS[3]!;
  assert.match(four.body, /left out rather than shown without passing its checks/);
  assert.doesNotMatch(HOW_STEPS.map((s) => s.body).join(' '), /rather than shown wrong/);
});

test('How it works: steps 3 to 6 link to where a judge can see them; 1 and 2 do not', () => {
  assert.deepEqual(HOW_STEPS.map((s) => s.link?.nav ?? null), [null, null, 'checks', 'demo', 'results', 'review']);
  for (const s of HOW_STEPS.slice(2)) assert.ok((s.link?.label ?? '').length > 8, `${s.title} has a link label`);
});

test('How it works: step 6 says publishing happens on Review and publish; step 3 says the page itself is not checked', () => {
  assert.match(HOW_STEPS[5]!.body, /Publishing happens on Review and publish/);
  assert.match(HOW_STEPS[2]!.body, /not whether the page itself is right/);
});

test('Results: an index of its seven sections, each with a unique key, in page order', () => {
  assert.equal(RESULTS_SECTIONS.length, 7);
  assert.equal(new Set(RESULTS_SECTIONS.map((s) => s.key)).size, 7);
  assert.deepEqual(RESULTS_SECTIONS.map((s) => s.key), ['headline', 'compare', 'funnel', 'subjects', 'retest', 'diagrams', 'method']);
});

test('Results: the bar scale is said as a scale; the Review page says "Not reviewed yet"', () => {
  assert.equal(BAR_SCALE_NOTE, 'Bars are drawn on a 0–100% scale.');
  assert.equal(NOT_REVIEWED_LINE, 'Not reviewed yet');
});
