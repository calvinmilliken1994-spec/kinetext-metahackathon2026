/// <reference types="node" />
// Set A (W-04, W2-01, W2-02): one concealment policy. While an answer is hidden, no hover, pin or the quote zone's own
// link may put a page sentence that states it on screen, and ← from a revealed answer hides it again.
import test from 'node:test';
import assert from 'node:assert/strict';
import { beatConcealed, deckFromLesson, planBeats, presentReducer, initialPresent, revealQuote, zoneQuote } from './presentation.ts';
import type { Beat, Deck } from './presentation.ts';
import { concealedKeys, disclosesAnswer, linksUnlessConcealed, quoteDisclosesValue } from './conceal.ts';
import { compareConcealed } from './compare.ts';
import { loadDemoLessons } from './stage6-fixtures.ts';
import { linkKey } from './linking.ts';

const lessons = loadDemoLessons();
function lessonDeck(id: string): Deck {
  const l = lessons.find((x) => x.id === id);
  if (l === undefined) throw new Error(`demo lesson ${id} missing`);
  return deckFromLesson({
    jobId: `job-${id}`, lesson: l.lesson, specs: l.specs, premium: l.premium ?? null, analysis: l.analysis, source: null,
    disclosure: 'AI-generated.', checks: null, quotes: null, fallbackTitle: 'Lesson',
  });
}
const at = <K extends Beat['kind']>(beats: readonly Beat[], kind: K): Extract<Beat, { kind: K }> => {
  const b = beats.find((x) => x.kind === kind);
  if (b === undefined) throw new Error(`no ${kind} beat`);
  return b as Extract<Beat, { kind: K }>;
};

test('quoteDisclosesValue matches whole tokens, ignoring case and spacing', () => {
  assert.equal(quoteDisclosesValue("The president, the vice president, and the president's cabinet are the members", "President's  cabinet"), true);
  assert.equal(quoteDisclosesValue('three-fourths, or 38 of 50 States', '38'), true);
  assert.equal(quoteDisclosesValue('a total of 380 seats', '38'), false);
  assert.equal(quoteDisclosesValue('the value 3.8 here', '3'), false);
  assert.equal(quoteDisclosesValue('anything', '  '), false);
});

test('the hidden answer’s own sentence and any sentence stating its value are concealed; others stay linked', () => {
  const S = 'civics';
  const hidden = { quote: { sourceId: S, quote: 'Members: the cabinet.' }, values: ["president's cabinet"] };
  const leak = { sourceId: S, quote: "The president, the vice president, and the president's cabinet are the members of the executive branch." };
  const fine = { sourceId: S, quote: 'Congress makes laws.' };
  assert.equal(disclosesAnswer(hidden.quote, hidden), true);
  assert.equal(disclosesAnswer(leak, hidden), true);
  assert.equal(disclosesAnswer(fine, hidden), false);
  const keys = concealedKeys([leak, fine], hidden);
  assert.deepEqual(linksUnlessConcealed(leak, keys), []);
  assert.deepEqual(linksUnlessConcealed(fine, keys), [linkKey(S, fine.quote)]);
  assert.equal(concealedKeys([leak], null).size, 0, 'nothing is concealed once revealed');
});

test('W-04: a compare beat conceals every cell quote that states the hidden value, in the lesson and on the slide alike', () => {
  const beats = planBeats(lessonDeck('gallery'));
  const compare = at(beats, 'compare');
  assert.ok(compare.plan !== null);
  const plan = compare.plan;
  const hidden = compare.spec.cells.find((c) => c.id === plan.cellId);
  assert.ok(hidden !== undefined);
  // A sibling cell whose quote repeats the hidden value (the reviewer's executive-branch case).
  const other = compare.spec.cells.find((c) => c.id !== plan.cellId);
  assert.ok(other !== undefined);
  const leaky = { ...other, quote: `Also: ${hidden.value} is stated here.` };
  const spec = { ...compare.spec, cells: compare.spec.cells.map((c) => (c.id === other.id ? leaky : c)) };
  const beat: Beat = { ...compare, spec };
  const before = beatConcealed(beat, { step: 0, revealed: false });
  assert.ok(before.has(linkKey(hidden.sourceId, hidden.quote)), 'the hidden cell’s own sentence');
  assert.ok(before.has(linkKey(leaky.sourceId, leaky.quote)), 'a sibling sentence that states the value');
  assert.deepEqual([...before].sort(), [...compareConcealed(spec, plan)].sort(), 'one policy: the lesson view uses the same set');
  // hovering the leaky cell before R leaves the zone empty
  assert.equal(zoneQuote({ hovered: { sourceId: leaky.sourceId, quote: leaky.quote }, pinned: null, revealed: revealQuote(beat, 0), visible: [], concealed: before }), null);
  // after R it is shown
  const after = beatConcealed(beat, { step: 1, revealed: false });
  assert.equal(after.size, 0);
  assert.equal(zoneQuote({ hovered: { sourceId: leaky.sourceId, quote: leaky.quote }, pinned: null, revealed: revealQuote(beat, 1), visible: [], concealed: after })?.quote, leaky.quote);
});

test('W2-01: R → hover the zone’s quote → ← leaves the quiz zone empty (hover and pin both concealed)', () => {
  const beats = planBeats(lessonDeck('drag'));
  const quiz = at(beats, 'quiz');
  const i = beats.indexOf(quiz);
  const reduce = presentReducer(beats);
  let s = initialPresent(beats, i);
  s = reduce(s, { type: 'reveal' });
  const shown = revealQuote(quiz, s.step, s.revealed);
  assert.ok(shown !== null);
  // the pointer rests on the zone, which links its own quote
  assert.equal(zoneQuote({ hovered: shown, pinned: null, revealed: shown, visible: [], concealed: beatConcealed(quiz, s) })?.quote, shown.quote);
  s = reduce(s, { type: 'prev' });
  assert.equal(s.beat, i);
  assert.equal(s.step, 0);
  const z = zoneQuote({ hovered: shown, pinned: shown, revealed: revealQuote(quiz, s.step, s.revealed), visible: [], concealed: beatConcealed(quiz, s) });
  assert.equal(z, null);
});

test('W2-02: a key term’s sentence stays dark until its meaning is shown, and again after ←', () => {
  const q = (quote: string) => ({ sourceId: 'dna', quote });
  const deck: Deck = {
    jobId: 'job-terms', headline: 'DNA', source: null, disclosure: 'x', parts: [], leftOut: 0, checks: null, quotes: null, objectives: [],
    overview: {
      keyPoints: [],
      keyTerms: [
        { id: 't1', term: 'DNA', gloss: 'hereditary material', ...q('Most DNA is located in the cell nucleus.') },
        { id: 't2', term: 'base', gloss: 'a chemical unit', ...q('The four bases are A, G, C and T.') },
        { id: 't3', term: 'nucleus', gloss: 'where DNA is kept', ...q('Most DNA is located in the cell nucleus.') },
      ],
    },
  };
  const beats = planBeats(deck);
  const terms = at(beats, 'terms');
  assert.equal(terms.termQuotes.length, terms.steps - 1);
  const first = terms.termQuotes[0];
  assert.ok(first !== undefined);
  const k = linkKey(first.sourceId, first.quote);
  assert.ok(beatConcealed(terms, { step: 0, revealed: false }).has(k), 'no meaning shown on arrival');
  // term 3 shares term 1's sentence: showing term 1's meaning must not open the sentence that answers term 3
  assert.ok(beatConcealed(terms, { step: 1, revealed: false }).has(k), 'shared with a hidden term');
  const second = terms.termQuotes[1];
  assert.ok(second !== undefined);
  assert.ok(beatConcealed(terms, { step: 1, revealed: false }).has(linkKey(second.sourceId, second.quote)), 'term 2 still hidden at step 1');
  assert.ok(!beatConcealed(terms, { step: 2, revealed: false }).has(linkKey(second.sourceId, second.quote)), 'term 2 shown at step 2');
  assert.ok(beatConcealed(terms, { step: 0, revealed: false }).has(k), '← to step 0 conceals it again');
  // the last step shows every meaning
  assert.equal(beatConcealed(terms, { step: terms.steps - 1, revealed: false }).size, 0);
});

test('beats without an open answer conceal nothing', () => {
  const beats = planBeats(lessonDeck('gallery'));
  for (const b of beats.filter((x) => x.kind === 'title' || x.kind === 'overview' || x.kind === 'closing' || x.kind === 'stage')) {
    assert.equal(beatConcealed(b, { step: 0, revealed: false }).size, 0, b.kind);
  }
});
