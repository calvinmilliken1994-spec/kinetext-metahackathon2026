/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canReveal, checksLine, deckFromActivity, deckFromLesson, deckQuotes, initialPresent, isRevealed, keyAction, keyContext,
  licenceText, numericAnswer, planBeats, presentReducer, presentRequest, presentSearch, exitSearch, quoteForLinks,
  titleCard, visibleCount, leftOutLine,
} from './presentation.ts';
import type { Beat, PresentState } from './presentation.ts';
import { loadDemoLessons } from './stage6-fixtures.ts';
import { makeMoonSpec } from './moon-fixture.ts';
import { linkKey } from './linking.ts';

const lessons = loadDemoLessons();
const drag = lessons.find((l) => l.id === 'drag');
const premium = lessons.find((l) => l.id === 'premium');
const partial = lessons.find((l) => l.id === 'partial');
const gallery = lessons.find((l) => l.id === 'gallery');
if (drag === undefined || premium === undefined || partial === undefined || gallery === undefined) throw new Error('demo lessons missing');

const SOURCE = {
  id: 'nasa-grc-drag-equation', title: 'Drag Equation — NASA Glenn Research Center, Beginner\'s Guide to Aeronautics',
  locator: 'https://www.grc.nasa.gov/www/k-12/airplane/drageq.html', license: 'US-Gov-Work',
  attribution: 'Source material: NASA Glenn Research Center, Beginner\'s Guide to Aeronautics.', kind: 'library' as const,
};

function dragDeck() {
  return deckFromLesson({
    jobId: 'job-drag', lesson: drag!.lesson, specs: drag!.specs, premium: null, analysis: drag!.analysis, source: SOURCE,
    disclosure: 'AI-generated with Muse Spark 1.3 (Meta).', checks: { passed: 20, total: 20 }, quotes: { found: 9, total: 9 }, fallbackTitle: 'Lesson',
  });
}

const kinds = (beats: readonly Beat[]): string[] => beats.map((b) => b.kind);

// ---- the deck ---------------------------------------------------------------------------------------------------

test('a lesson becomes title → the parts (most visual first, one beat per quiz card) → In short → terms → closing', () => {
  const beats = planBeats(dragDeck());
  assert.equal(beats[0]?.kind, 'title');
  assert.equal(beats[1]?.kind, 'predict', 'the formula explorer leads (set B: the hook)');
  const ov = beats.findIndex((b) => b.kind === 'overview');
  const lastQuiz = beats.map((b) => b.kind).lastIndexOf('quiz');
  assert.ok(ov > lastQuiz, 'the summary comes after the questions it would answer');
  assert.equal(beats[ov]?.title, 'In short');
  assert.equal(beats[beats.length - 1]?.kind, 'closing');
  const quiz = drag!.lesson.components.find((c) => c.componentId === 'quiz-cards-v1');
  const quizSpec = quiz === undefined ? undefined : drag!.specs[quiz.specId];
  assert.ok(quizSpec !== undefined && quizSpec.componentId === 'quiz-cards-v1');
  const quizBeats = beats.filter((b) => b.kind === 'quiz');
  assert.equal(quizBeats.length, quizSpec.cards.length, 'one beat per quiz card');
  assert.deepEqual(quizBeats.map((b) => b.label), quizSpec.cards.map((_, i) => `Question ${i + 1}`));
  // every id is unique, so answers stored by beat id never collide
  assert.equal(new Set(beats.map((b) => b.id)).size, beats.length);
});

test('the overview reveals its key points one at a time; key terms reveal their meaning one at a time', () => {
  const beats = planBeats(dragDeck());
  const overview = beats.find((b) => b.kind === 'overview');
  const points = drag!.lesson.overview?.keyPoints.length ?? 0;
  assert.ok(overview !== undefined && points > 1);
  assert.equal(overview.steps, points, 'the first point is up on arrival, each step adds one');
  assert.equal(visibleCount(overview, 0), 1);
  assert.equal(visibleCount(overview, points - 1), points);
  const terms = beats.find((b) => b.kind === 'terms');
  const termCount = drag!.lesson.overview?.keyTerms.length ?? 0;
  if (termCount > 0) {
    assert.ok(terms !== undefined);
    assert.equal(terms.steps, termCount + 1, 'terms first, then each meaning');
    assert.equal(visibleCount(terms, 0), 0);
  } else {
    assert.equal(terms, undefined);
  }
});

test('a formula explorer gets a predict beat for its FIRST case, then the interactive explorer', () => {
  const beats = planBeats(dragDeck());
  const i = beats.findIndex((b) => b.kind === 'predict');
  assert.ok(i > 0, 'predict beat present');
  const p = beats[i];
  assert.ok(p !== undefined && p.kind === 'predict' && p.target.kind === 'formula');
  assert.equal(p.steps, 2);
  assert.equal(beats[i + 1]?.kind, 'stage', 'the explorer itself follows its predict beat');
  const answer = numericAnswer(p.target);
  assert.ok(answer !== null && Number.isFinite(answer.value));
});

test('parts that did not pass are never presented, and the closing beat says how many were left out', () => {
  const deck = deckFromLesson({
    jobId: 'job-partial', lesson: partial!.lesson, specs: partial!.specs, premium: null, analysis: partial!.analysis, source: SOURCE,
    disclosure: 'x', checks: null, quotes: null, fallbackTitle: 'Lesson',
  });
  const failed = partial!.lesson.components.filter((c) => c.status === 'failed').length;
  assert.ok(failed > 0);
  assert.equal(deck.leftOut, failed, 'skipped parts were never built, so only failed ones count as left out');
  const presented = deck.parts.map((p) => p.spec.id);
  for (const c of partial!.lesson.components) if (c.status !== 'passed') assert.ok(!presented.includes(c.specId), c.componentId);
  assert.match(leftOutLine(1) ?? '', /^1 part was left out because it could not be verified against the page\.$/);
  assert.match(leftOutLine(2) ?? '', /^2 parts were left out/);
  assert.equal(leftOutLine(0), null);
});

test('a premium timeline gets a which-came-first predict beat (two options) before the interactive timeline', () => {
  const deck = deckFromLesson({
    jobId: 'job-tl', lesson: premium!.lesson, specs: premium!.specs, premium: premium!.premium, analysis: premium!.analysis, source: SOURCE,
    disclosure: 'x', checks: null, quotes: null, fallbackTitle: 'Lesson',
  });
  const beats = planBeats(deck);
  const p = beats.find((b) => b.kind === 'predict');
  assert.ok(p !== undefined && p.kind === 'predict' && p.target.kind === 'timeline');
  assert.equal(p.target.options.length, 2);
  const stage = beats.find((b) => b.kind === 'stage');
  assert.ok(stage !== undefined && stage.kind === 'stage' && stage.part.kind === 'activity');
  assert.equal(stage.label, 'Timeline');
});

test('an older single-activity run: title → objectives → predict case 1 → simulation → closing', () => {
  const moon = makeMoonSpec();
  const deck = deckFromActivity({ jobId: 'job-moon', spec: moon, source: null, disclosure: 'x', checks: { passed: 15, total: 15 }, quotes: null });
  const beats = planBeats(deck);
  assert.deepEqual(kinds(beats), ['title', 'objectives', 'predict', 'stage', 'closing']);
  const p = beats[2];
  assert.ok(p !== undefined && p.kind === 'predict' && p.target.kind === 'engine');
  assert.equal(p.target.prediction.id, moon.predictions[0]?.id, 'always the first case');
  const answer = numericAnswer(p.target);
  assert.ok(answer !== null);
  assert.equal(answer.unit, 'm');
  assert.ok(answer.value > 0);
  assert.equal(beats[3]?.label, 'Simulation');
});

test('every gallery kit part becomes a beat; compare with three distinct values in a column is predict-then-reveal', () => {
  const deck = deckFromLesson({
    jobId: 'job-gal', lesson: gallery!.lesson, specs: gallery!.specs, premium: null, analysis: gallery!.analysis, source: SOURCE,
    disclosure: 'x', checks: null, quotes: null, fallbackTitle: 'Lesson',
  });
  const beats = planBeats(deck);
  const compare = beats.find((b) => b.kind === 'compare');
  assert.ok(compare !== undefined && compare.kind === 'compare');
  assert.equal(compare.steps, compare.plan === null ? 1 : 2);
  for (const b of beats) assert.ok(b.label.length > 0 && b.label.length <= 16, `short bar label: ${b.label}`);
});

// ---- navigation -------------------------------------------------------------------------------------------------

function demoBeats(): Beat[] { return planBeats(dragDeck()); }
const run = (beats: Beat[], s: PresentState, ...actions: Parameters<ReturnType<typeof presentReducer>>[1][]): PresentState =>
  actions.reduce((st, a) => presentReducer(beats)(st, a), s);

test('next walks the build steps of a beat before moving on; prev shows the previous beat fully built', () => {
  const beats = demoBeats();
  const ov = beats.findIndex((b) => b.kind === 'overview');
  const steps = beats[ov]!.steps;
  let s = initialPresent(beats, ov);
  assert.deepEqual([s.beat, s.step], [ov, 0]);
  for (let i = 1; i < steps; i++) { s = run(beats, s, { type: 'next' }); assert.deepEqual([s.beat, s.step], [ov, i]); }
  s = run(beats, s, { type: 'next' });
  assert.deepEqual([s.beat, s.step], [ov + 1, 0]);
  s = run(beats, s, { type: 'prev' });
  assert.deepEqual([s.beat, s.step], [ov, steps - 1], 'back lands on the fully built overview');
  s = run(beats, s, { type: 'prev' });
  assert.deepEqual([s.beat, s.step], [ov, steps - 2], 'back steps out of the build');
});

test('next stops at the closing beat; prev stops at the title', () => {
  const beats = demoBeats();
  let s = initialPresent(beats, beats.length - 1);
  s = run(beats, s, { type: 'next' }, { type: 'next' });
  assert.equal(s.beat, beats.length - 1);
  s = run(beats, initialPresent(beats), { type: 'prev' });
  assert.deepEqual([s.beat, s.step], [0, 0]);
});

test('R reveals the current beat completely and never advances; a fresh jump hides the answer again', () => {
  const beats = demoBeats();
  const q = beats.findIndex((b) => b.kind === 'quiz');
  let s = initialPresent(beats, q);
  assert.equal(canReveal(beats[q]!, s.step), true);
  assert.equal(isRevealed(beats[q]!, s.step), false);
  s = run(beats, s, { type: 'reveal' });
  assert.deepEqual([s.beat, s.step], [q, 1]);
  assert.equal(isRevealed(beats[q]!, s.step), true);
  s = run(beats, s, { type: 'reveal' });
  assert.deepEqual([s.beat, s.step], [q, 1], 'R twice does not move on');
  s = run(beats, s, { type: 'jump', beat: q });
  assert.deepEqual([s.beat, s.step], [q, 0], 'jumping to a beat starts it unrevealed, so a question can be asked again');
  const ov = beats.findIndex((b) => b.kind === 'overview');
  s = run(beats, s, { type: 'jump', beat: ov }, { type: 'reveal' });
  assert.equal(s.step, beats[ov]!.steps - 1, 'R on the overview shows every key point');
});

test('jump clamps to the deck; first and last go to the ends', () => {
  const beats = demoBeats();
  let s = run(beats, initialPresent(beats), { type: 'jump', beat: 99 });
  assert.equal(s.beat, beats.length - 1);
  s = run(beats, s, { type: 'jump', beat: -3 });
  assert.equal(s.beat, 0);
  s = run(beats, s, { type: 'last' });
  assert.equal(s.beat, beats.length - 1);
  s = run(beats, s, { type: 'first' });
  assert.equal(s.beat, 0);
});

test('B blanks the screen; the next key press only brings it back, it does not move', () => {
  const beats = demoBeats();
  let s = run(beats, initialPresent(beats), { type: 'blank' });
  assert.equal(s.blank, true);
  s = run(beats, s, { type: 'next' });
  assert.deepEqual([s.blank, s.beat], [false, 0]);
  s = run(beats, s, { type: 'blank' }, { type: 'prev' });
  assert.deepEqual([s.blank, s.beat], [false, 0]);
  s = run(beats, s, { type: 'blank' }, { type: 'blank' });
  assert.equal(s.blank, false, 'B again toggles back');
});

test('notes and help toggle; a navigation key closes help; answers are kept per beat across navigation', () => {
  const beats = demoBeats();
  let s = run(beats, initialPresent(beats), { type: 'notes' });
  assert.equal(s.notes, true);
  s = run(beats, s, { type: 'help' }, { type: 'next' });
  assert.equal(s.help, false);
  assert.equal(s.notes, true, 'notes stay open while moving');
  const q = beats.find((b) => b.kind === 'quiz')!;
  s = run(beats, s, { type: 'answer', beatId: q.id, value: '2' }, { type: 'next' }, { type: 'prev' });
  assert.equal(s.answers[q.id], '2');
});

test('initialPresent clamps a deep-linked start beat', () => {
  const beats = demoBeats();
  assert.equal(initialPresent(beats, 500).beat, beats.length - 1);
  assert.equal(initialPresent(beats, Number.NaN).beat, 0);
});

// ---- keys -------------------------------------------------------------------------------------------------------

const k = (key: string, extra: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) => ({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...extra });

test('the keyboard map: arrows, Space and clicker keys move; R reveals; B blanks; P notes; numbers jump; Esc exits', () => {
  for (const key of ['ArrowRight', ' ', 'PageDown', 'ArrowDown']) assert.deepEqual(keyAction(k(key), 'none'), { type: 'next' }, key);
  for (const key of ['ArrowLeft', 'PageUp', 'ArrowUp']) assert.deepEqual(keyAction(k(key), 'none'), { type: 'prev' }, key);
  assert.deepEqual(keyAction(k('r'), 'none'), { type: 'reveal' });
  assert.deepEqual(keyAction(k('R', { shiftKey: true }), 'none'), { type: 'reveal' });
  assert.deepEqual(keyAction(k('b'), 'none'), { type: 'blank' });
  assert.deepEqual(keyAction(k('.'), 'none'), { type: 'blank' }, 'clickers send . for a black screen');
  assert.deepEqual(keyAction(k('p'), 'none'), { type: 'notes' });
  assert.deepEqual(keyAction(k('?', { shiftKey: true }), 'none'), { type: 'help' });
  assert.deepEqual(keyAction(k('Home'), 'none'), { type: 'first' });
  assert.deepEqual(keyAction(k('End'), 'none'), { type: 'last' });
  assert.deepEqual(keyAction(k('1'), 'none'), { type: 'jump', beat: 0 });
  assert.deepEqual(keyAction(k('9'), 'none'), { type: 'jump', beat: 8 });
  assert.deepEqual(keyAction(k('0'), 'none'), { type: 'jump', beat: 9 });
  assert.equal(keyAction(k('Escape'), 'none'), 'exit');
  assert.equal(keyAction(k('f'), 'none'), 'fullscreen');
  assert.equal(keyAction(k('x'), 'none'), null);
});

test('browser shortcuts are never taken over', () => {
  assert.equal(keyAction(k('r', { ctrlKey: true }), 'none'), null);
  assert.equal(keyAction(k('ArrowLeft', { altKey: true }), 'none'), null);
  assert.equal(keyAction(k('p', { metaKey: true }), 'none'), null);
});

test('typing in a field or using a slider keeps its keys; Esc there only lets go of the field', () => {
  for (const key of ['ArrowRight', 'ArrowLeft', ' ', 'r', 'b', '1', 'p']) assert.equal(keyAction(k(key), 'text'), null, key);
  assert.equal(keyAction(k('Escape'), 'text'), 'release');
  // a focused button keeps Space/Enter (it activates), but arrows still move the deck
  assert.equal(keyAction(k(' '), 'button'), null);
  assert.equal(keyAction(k('Enter'), 'button'), null);
  assert.deepEqual(keyAction(k('ArrowRight'), 'button'), { type: 'next' });
});

test('keyContext: inputs, sliders, selects and editable text are "text"; buttons and links are "button"', () => {
  assert.equal(keyContext({ tagName: 'INPUT', type: 'text' }), 'text');
  assert.equal(keyContext({ tagName: 'INPUT', type: 'range' }), 'text');
  assert.equal(keyContext({ tagName: 'INPUT', type: 'radio' }), 'text');
  assert.equal(keyContext({ tagName: 'INPUT', type: 'submit' }), 'button');
  assert.equal(keyContext({ tagName: 'TEXTAREA' }), 'text');
  assert.equal(keyContext({ tagName: 'SELECT' }), 'text');
  assert.equal(keyContext({ tagName: 'DIV', isContentEditable: true }), 'text');
  assert.equal(keyContext({ tagName: 'DIV', role: 'slider' }), 'text');
  assert.equal(keyContext({ tagName: 'BUTTON' }), 'button');
  assert.equal(keyContext({ tagName: 'A' }), 'button');
  assert.equal(keyContext({ tagName: 'SUMMARY' }), 'button');
  assert.equal(keyContext({ tagName: 'DIV' }), 'none');
  assert.equal(keyContext(null), 'none');
});

// ---- deep link --------------------------------------------------------------------------------------------------

test('?present=<jobId> opens presentation mode; &beat=N (1-based) picks the start beat', () => {
  assert.deepEqual(presentRequest('?present=job-1'), { jobId: 'job-1', beat: -1 }, 'no beat: open on the hook');
  assert.deepEqual(presentRequest('?present=job-1&beat=4'), { jobId: 'job-1', beat: 3 });
  assert.deepEqual(presentRequest('?present=job-1&beat=1'), { jobId: 'job-1', beat: 0 }, 'beat=1 is still the title');
  assert.deepEqual(presentRequest('?present=job-1&beat=nope'), { jobId: 'job-1', beat: -1 });
  assert.equal(presentRequest('?job=job-1'), null);
  assert.equal(presentRequest('?present='), null);
  assert.equal(presentSearch('?job=job-1&x=1', 'job-1', 2), '?x=1&present=job-1&beat=3');
  assert.equal(exitSearch('?x=1&present=job-1&beat=3', 'job-1'), '?x=1&job=job-1');
});

// ---- cards and lines --------------------------------------------------------------------------------------------

test('the title card splits the page title from its publisher and names the licence plainly', () => {
  assert.deepEqual(titleCard(SOURCE), { name: 'Drag Equation', from: 'NASA Glenn Research Center, Beginner\'s Guide to Aeronautics', licence: 'U.S. Government work' });
  const teacher = { id: 'u', title: 'Throwing a ball on the Moon (project-authored test text)', locator: '', license: 'own-work', attribution: 'Written by the Make knowledge interactive project team for testing.', kind: 'user' as const, licenseLabel: 'Teacher\'s own work' };
  assert.deepEqual(titleCard(teacher), { name: 'Throwing a ball on the Moon (project-authored test text)', from: 'Written by the project team', licence: 'Teacher\'s own work' });
  assert.equal(titleCard(null), null);
  assert.equal(licenceText('CC0-1.0'), 'CC0 1.0');
  assert.equal(licenceText('Something-Else'), 'Something-Else');
});

test('the checks line is one calm sentence and never invents a count', () => {
  assert.equal(checksLine({ passed: 31, total: 31 }, { found: 14, total: 14 }), 'All 31 checks passed · all 14 quotes found on the page');
  assert.equal(checksLine({ passed: 29, total: 31 }, { found: 12, total: 14 }), '29 of 31 checks passed · 12 of 14 quotes found on the page');
  assert.equal(checksLine({ passed: 1, total: 1 }, null), 'The 1 check passed');
  assert.equal(checksLine(null, { found: 3, total: 3 }), 'All 3 quotes found on the page');
  assert.equal(checksLine(null, null), null);
});

test('hovering a linked value shows its page sentence: link keys map back to the quote', () => {
  const quotes = [{ sourceId: 's', quote: 'The drag coefficient Cd is a number.' }, { sourceId: 's', quote: 'Drag depends on density.' }];
  assert.equal(quoteForLinks([linkKey('s', 'Drag depends on density.')], quotes), 'Drag depends on density.');
  assert.equal(quoteForLinks(['nope'], quotes), null);
  assert.equal(quoteForLinks([], quotes), null);
});

test('deckQuotes lists each quote used in the deck once, in order', () => {
  const beats = demoBeats();
  const quotes = deckQuotes(beats);
  assert.ok(quotes.length > 0);
  assert.equal(new Set(quotes.map((q) => `${q.sourceId}\u0000${q.quote}`)).size, quotes.length);
});
