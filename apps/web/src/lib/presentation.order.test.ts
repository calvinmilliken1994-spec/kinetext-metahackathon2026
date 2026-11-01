/// <reference types="node" />
// Set B (UX review #8, P6, P11): the deck opens on its most visual ask, quiz slides come before the AI summary that
// would answer them, the summary is "In short", and the title stays one ← away. `?beat=N` still opens beat N.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assembleKitSpec } from '../../../../packages/contracts/kit.ts';
import type { KitSpec, LogLadderGen } from '../../../../packages/contracts/kit.ts';
import type { Provenance } from '../../../../packages/contracts/index.ts';
import {
  creditLine, deckFromLesson, heroBeatIndex, HOOK_BEAT, initialPresent, planBeats, presentReducer, presentRequest, stepCaption, teachingOrder, trackLabel,
} from './presentation.ts';
import type { Deck, DeckPart } from './presentation.ts';
import { mostVisualFirst, visualRank } from './partOrder.ts';
import { loadDemoLessons } from './stage6-fixtures.ts';

const root = new URL('../../../../', import.meta.url);
const json = <T>(p: string): T => JSON.parse(readFileSync(new URL(p, root), 'utf8')) as T;
const provenance = json<Provenance>('tests/fixtures/provenance.fixture.json');
const ladder = assembleKitSpec(json<LogLadderGen>('tests/fixtures/stage6/log-ladder.gen.json'), 'log-ladder-v1', { id: 'j:log-ladder-v1:r1', sources: [], provenance, seed: 1 });

const drag = loadDemoLessons().find((l) => l.id === 'drag');
if (drag === undefined) throw new Error('drag demo lesson missing');
const specOf = (id: string): KitSpec => {
  const c = drag.lesson.components.find((x) => x.componentId === id);
  const spec = c === undefined ? undefined : drag.specs[c.specId];
  if (spec === undefined) throw new Error(`no ${id}`);
  return spec;
};
const quiz = specOf('quiz-cards-v1');
const SOURCE = {
  id: 'ph', title: 'pH scale — U.S. Geological Survey', locator: 'https://www.usgs.gov/', license: 'US-Gov-Work',
  attribution: 'U.S. Geological Survey.', kind: 'library' as const,
};
const deckOf = (specs: KitSpec[], overview: Deck['overview'] = drag.lesson.overview === null ? null : { keyPoints: drag.lesson.overview.keyPoints, keyTerms: drag.lesson.overview.keyTerms }): Deck => ({
  jobId: 'job-ph', headline: 'Acids and bases', source: SOURCE, disclosure: 'AI-written.', overview, objectives: [], leftOut: 0, checks: null, quotes: null,
  parts: specs.map((spec): DeckPart => ({ kind: 'kit', spec })),
});

test('the most visual part leads; the rest keep plan order, visual parts before quizzes and sequences', () => {
  const kinds = (xs: string[]) => mostVisualFirst(xs, (x) => x);
  assert.deepEqual(kinds(['quiz-cards-v1', 'log-ladder-v1']), ['log-ladder-v1', 'quiz-cards-v1'], 'the pH plan');
  assert.deepEqual(kinds(['sequence-v1', 'threshold-v1']), ['threshold-v1', 'sequence-v1'], 'the Electoral College plan');
  assert.deepEqual(kinds(['quiz-cards-v1', 'algorithm-trace-v1', 'label-diagram-v1']), ['label-diagram-v1', 'algorithm-trace-v1', 'quiz-cards-v1']);
  assert.deepEqual(kinds(['data-table-v1', 'formula-explorer-v1', 'quiz-cards-v1', 'sequence-v1']), ['formula-explorer-v1', 'data-table-v1', 'quiz-cards-v1', 'sequence-v1']);
  assert.deepEqual(kinds(['quiz-cards-v1', 'sequence-v1']), ['quiz-cards-v1', 'sequence-v1'], 'no visual part: plan order unchanged');
  assert.deepEqual(kinds([]), []);
  assert.ok(visualRank('label-diagram-v1') < visualRank('simulation') && visualRank('simulation') < visualRank('formula-explorer-v1'));
  assert.ok(visualRank('threshold-v1') < visualRank('quiz-cards-v1'));
  assert.equal(visualRank('quiz-cards-v1'), visualRank('sequence-v1'), 'text-first parts tie, so they keep plan order');
  // A premium simulation is "simulation", a timeline "timeline".
  assert.deepEqual(teachingOrder(deckOf([quiz, ladder]).parts).map((p) => (p.kind === 'kit' ? p.spec.componentId : p.kind)), ['log-ladder-v1', 'quiz-cards-v1']);
});

test('pH-style deck: title → the scale (hook) → every quiz card → In short → key terms → sources', () => {
  const beats = planBeats(deckOf([quiz, ladder]));
  const kinds = beats.map((b) => b.kind);
  assert.equal(kinds[0], 'title');
  assert.equal(kinds[1], 'engine', 'the scale comes straight after the title');
  const quizzes = kinds.flatMap((k, i) => (k === 'quiz' ? [i] : []));
  const overview = kinds.indexOf('overview');
  const terms = kinds.indexOf('terms');
  assert.ok(quizzes.length > 0 && overview > Math.max(...quizzes), 'P6: no quiz after the summary that answers it');
  assert.ok(terms > Math.max(...quizzes), 'key terms (whose meanings answer questions) after the quizzes too');
  assert.equal(kinds[kinds.length - 1], 'closing');
  const ov = beats[overview];
  assert.equal(ov?.title, 'In short', 'P11: the AI summary is never titled "What the page says"');
  assert.equal(ov?.label, 'In short');
  for (const b of beats) assert.notEqual(b.title, 'What the page says');
  assert.equal(new Set(beats.map((b) => b.id)).size, beats.length, 'beat ids stay unique');
});

test('Present opens on the hook; ← reaches the title; beat=N deep links still open beat N', () => {
  const beats = planBeats(deckOf([quiz, ladder]));
  const hero = heroBeatIndex(beats);
  assert.equal(hero, 1);
  assert.equal(beats[hero]?.kind, 'engine');
  const s = initialPresent(beats, HOOK_BEAT);
  assert.equal(s.beat, hero, 'HOOK_BEAT starts on the hook');
  const back = presentReducer(beats)(s, { type: 'prev' });
  assert.equal(back.beat, 0, '← goes to the title sheet');
  assert.equal(presentReducer(beats)(s, { type: 'first' }).beat, 0, 'Home (Start from the beginning) too');
  // Deep links: no &beat → hook; &beat=1 → the title, &beat=N → beat N-1, clamped.
  const req = presentRequest('?present=job-ph');
  assert.equal(initialPresent(beats, req?.beat).beat, hero);
  assert.equal(initialPresent(beats, presentRequest('?present=job-ph&beat=1')?.beat).beat, 0);
  assert.equal(initialPresent(beats, presentRequest('?present=job-ph&beat=3')?.beat).beat, 2);
  assert.equal(initialPresent(beats, presentRequest('?present=job-ph&beat=99')?.beat).beat, beats.length - 1);
  // A deck without parts opens on its title.
  assert.equal(heroBeatIndex(planBeats(deckOf([]))), 0);
});

test('a lesson-flow deck keeps the plan order in the deck but presents the formula explorer first', () => {
  const deck = deckFromLesson({ jobId: 'j', lesson: drag.lesson, specs: drag.specs, premium: null, analysis: drag.analysis, source: SOURCE, disclosure: 'x', checks: null, quotes: null, fallbackTitle: 'L' });
  const beats = planBeats(deck);
  const hero = beats[heroBeatIndex(beats)];
  assert.ok(hero?.kind === 'predict' && hero.target.kind === 'formula');
});

test('the hook slide carries one credit line: page · publisher · licence · AI-written, teacher review pending', () => {
  assert.equal(creditLine(SOURCE), 'pH scale · U.S. Geological Survey · U.S. Government work · AI-written, teacher review pending');
  assert.equal(creditLine(null), null);
  const plain = { ...SOURCE, title: 'Untitled page' };
  assert.equal(creditLine(plain), 'Untitled page · U.S. Government work · AI-written, teacher review pending', 'no publisher, no empty part');
});

test('the bar names the current step plainly', () => {
  const beats = planBeats(deckOf([quiz, ladder]));
  const engine = beats[1];
  assert.ok(engine !== undefined && engine.kind === 'engine');
  assert.equal(stepCaption(engine, { step: 0, revealed: false }), engine.steps > 1 ? `Scale · step 1 of ${engine.steps}` : 'Scale');
  assert.match(stepCaption(engine, { step: 0, revealed: true }), /revealed$/);
  const q = beats.find((b) => b.kind === 'quiz');
  assert.ok(q !== undefined && q.kind === 'quiz');
  assert.equal(stepCaption(q, { step: 0, revealed: false }), `Question 1 of ${q.of}`);
  assert.equal(stepCaption(q, { step: 1, revealed: false }), `Question 1 of ${q.of} · revealed`);
  assert.equal(trackLabel(q), 'Q1', 'the track says Q1 so nine beats stay readable');
  assert.equal(trackLabel(engine), 'Scale');
  const ov = beats.find((b) => b.kind === 'overview');
  assert.ok(ov !== undefined);
  assert.equal(stepCaption(ov, { step: 0, revealed: false }), `In short · point 1 of ${ov.steps}`);
});
