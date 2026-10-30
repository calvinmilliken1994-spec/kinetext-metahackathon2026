/// <reference types="node" />
// Presentation mode pass 3 (Calvin's design feedback): every AI-written line in sentence case, ONE anchored quote zone
// under the slide (hover, Show in source and the revealed page quote all land there), never an echo of words already
// on the slide, and the quote zone's text size chosen from the quote's length so it always fits its reserved band.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deckFromActivity, deckFromLesson, planBeats, quoteRefForLinks, revealQuote, shownPoints, shownTerms, visibleQuotes, zoneQuote, zoneQuoteSize,
} from './presentation.ts';
import type { Beat, Deck } from './presentation.ts';
import { loadDemoLessons } from './stage6-fixtures.ts';
import { makeMoonSpec } from './moon-fixture.ts';
import { linkKey } from './linking.ts';

const lessons = loadDemoLessons();
const byId = (id: string) => {
  const l = lessons.find((x) => x.id === id);
  if (l === undefined) throw new Error(`demo lesson ${id} missing`);
  return l;
};

function lessonDeck(id: string): Deck {
  const l = byId(id);
  return deckFromLesson({
    jobId: `job-${id}`, lesson: l.lesson, specs: l.specs, premium: l.premium ?? null, analysis: l.analysis, source: null,
    disclosure: 'AI-generated.', checks: null, quotes: null, fallbackTitle: 'Lesson',
  });
}

/** The Moon run's real key terms (job-20261030104333-c7083fa8): lower-case terms, one lower-case gloss, a symbol. */
function moonTermsDeck(): Deck {
  const q = (quote: string) => ({ sourceId: 'moon', quote });
  return {
    jobId: 'job-moon', headline: 'ballistic flight on the Moon without air drag', source: null, disclosure: 'x', parts: [], leftOut: 0,
    checks: null, quotes: null, objectives: [],
    overview: {
      keyPoints: [
        { id: 'p1', point: 'students learn that horizontal speed stays U0 during flight.', ...q('Horizontal speed stays U0.') },
      ],
      keyTerms: [
        { id: 't1', term: 'drag', gloss: 'Resistance from air that slows a thrown ball', ...q('There is no air, so no drag.') },
        { id: 't2', term: 'horizontal speed', gloss: 'Sideways speed that stays constant', ...q('Horizontal speed stays U0.') },
        { id: 't3', term: 'ymax', gloss: 'highest position reached when upward motion stops', ...q('ymax = V0^2 / (2*g)') },
        { id: 't4', term: 'pH', gloss: 'acidity on a scale of 0 to 14', ...q('pH runs from 0 to 14.') },
        { id: 't5', term: 'kg', gloss: 'kilogram, the unit of mass', ...q('Mass is in kg.') },
      ],
    },
  };
}

const at = (beats: readonly Beat[], kind: Beat['kind']) => {
  const b = beats.find((x) => x.kind === kind);
  if (b === undefined) throw new Error(`no ${kind} beat`);
  return b;
};

// ---- 1. sentence case --------------------------------------------------------------------------------------------

test('key terms and their meanings are shown in sentence case; symbols and units keep their case', () => {
  const terms = shownTerms(moonTermsDeck());
  assert.deepEqual(terms.map((t) => t.term), ['Drag', 'Horizontal speed', 'ymax', 'pH', 'kg']);
  assert.deepEqual(terms.map((t) => t.gloss), [
    'Resistance from air that slows a thrown ball', 'Sideways speed that stays constant',
    'Highest position reached when upward motion stops', 'Acidity on a scale of 0 to 14', 'Kilogram, the unit of mass',
  ]);
  // the link (the page's words) is untouched: the quote stays verbatim
  assert.equal(terms[2]?.quote, 'ymax = V0^2 / (2*g)');
});

test('key points are shown in sentence case with display maths (U0 → U₀)', () => {
  const points = shownPoints(moonTermsDeck());
  assert.equal(points[0]?.point, 'Students learn that horizontal speed stays U₀ during flight.');
  assert.equal(points[0]?.quote, 'Horizontal speed stays U0.');
});

test('every beat title (bar tooltips, notes, the screen-reader line) is display text: sentence case, no caret powers', () => {
  const decks = [lessonDeck('drag'), lessonDeck('gallery'), lessonDeck('premium'), lessonDeck('partial'),
    deckFromActivity({ jobId: 'job-moon', spec: makeMoonSpec(), source: null, disclosure: 'x', checks: null, quotes: null })];
  for (const deck of decks) {
    for (const b of planBeats(deck)) {
      assert.ok(!b.title.includes('^'), `${deck.jobId} ${b.kind}: ${b.title}`);
      assert.ok(!/^[a-z]{2,}\b/.test(b.title) || /^[a-z](max|min)\b/.test(b.title), `${deck.jobId} ${b.kind} starts lower-case: ${b.title}`);
    }
  }
});

// ---- 2. one quote zone: what the page says on this beat ------------------------------------------------------------

test('a quiz beat reveals its card quote in the zone (nothing before R)', () => {
  const beats = planBeats(lessonDeck('drag'));
  const quiz = at(beats, 'quiz');
  assert.equal(revealQuote(quiz, 0), null, 'never before the reveal');
  const q = revealQuote(quiz, 1);
  assert.ok(q !== null && quiz.kind === 'quiz');
  const card = quiz.spec.cards.find((c) => c.id === quiz.cardId);
  assert.deepEqual(q, { sourceId: card?.sourceId, quote: card?.quote });
});

test('a compare beat reveals the hidden cell’s quote; a beat without a reveal has none', () => {
  const beats = planBeats(lessonDeck('gallery'));
  const compare = at(beats, 'compare');
  assert.ok(compare.kind === 'compare' && compare.plan !== null);
  const cell = compare.spec.cells.find((c) => c.id === compare.plan?.cellId);
  assert.equal(revealQuote(compare, 0), null);
  assert.deepEqual(revealQuote(compare, 1), { sourceId: cell?.sourceId, quote: cell?.quote });
  for (const b of beats.filter((x) => x.kind !== 'quiz' && x.kind !== 'compare')) assert.equal(revealQuote(b, b.steps - 1), null, b.kind);
});

test('the which-came-first pair prints both events’ quotes in its body after R; the closing beat prints its quotes', () => {
  const beats = planBeats(lessonDeck('premium'));
  const pair = beats.find((b) => b.kind === 'predict' && b.target.kind === 'timeline');
  assert.ok(pair !== undefined && pair.kind === 'predict' && pair.target.kind === 'timeline');
  assert.deepEqual(visibleQuotes(pair, 0, beats), []);
  const shown = visibleQuotes(pair, 1, beats).map((q) => q.quote);
  assert.deepEqual(shown, pair.target.options.map((e) => e.evidence[0]?.quote).filter((q) => q !== undefined));
  const closing = at(beats, 'closing');
  assert.ok(visibleQuotes(closing, 0, beats).length > 0);
});

const S = 'src';
const A = { sourceId: S, quote: 'Drag depends on density.' };
const B = { sourceId: S, quote: 'The drag coefficient is found by experiment.' };
const C = { sourceId: S, quote: 'Lift acts at right angles to the flow.' };

test('zone: a hovered quote shows; else a pinned one; else the revealed one; else nothing', () => {
  assert.deepEqual(zoneQuote({ hovered: A, pinned: B, revealed: C, visible: [] }), A);
  assert.deepEqual(zoneQuote({ hovered: null, pinned: B, revealed: C, visible: [] }), B);
  assert.deepEqual(zoneQuote({ hovered: null, pinned: null, revealed: C, visible: [] }), C);
  assert.equal(zoneQuote({ hovered: null, pinned: null, revealed: null, visible: [] }), null);
});

test('zone never echoes words already on the slide: hovering a printed quote leaves the zone as it was', () => {
  // hovering the quote printed under a revealed pair event: the zone does not repeat it
  assert.equal(zoneQuote({ hovered: A, pinned: null, revealed: null, visible: [A, B] }), null);
  assert.deepEqual(zoneQuote({ hovered: A, pinned: null, revealed: C, visible: [A] }), C);
  // hovering the zone's own revealed quote (or anything citing it) keeps it, shown once
  assert.deepEqual(zoneQuote({ hovered: C, pinned: null, revealed: C, visible: [] }), C);
  // whitespace differences are the same words (the link key normalises them)
  assert.equal(zoneQuote({ hovered: { sourceId: S, quote: ' Drag  depends on density. ' }, pinned: null, revealed: null, visible: [A] }), null);
  // the rule, over every combination: the zone's text is never one of the quotes printed in the body
  const all = [A, B, C, null];
  for (const hovered of all) for (const pinned of all) for (const revealed of [C, null]) {
    for (const visible of [[], [A], [A, B], [B, C]]) {
      const z = zoneQuote({ hovered, pinned, revealed, visible });
      if (z === null) continue;
      assert.ok(!visible.some((v) => linkKey(v.sourceId, v.quote) === linkKey(z.sourceId, z.quote)), `echo of ${z.quote}`);
    }
  }
});

test('hover link keys map back to the quote and its source', () => {
  assert.deepEqual(quoteRefForLinks([linkKey(S, B.quote)], [A, B]), B);
  assert.equal(quoteRefForLinks(['nope'], [A, B]), null);
});

test('zone text size steps down for long quotes so it always fits the reserved band', () => {
  assert.equal(zoneQuoteSize('Drag depends on density.'), 'normal');
  assert.equal(zoneQuoteSize('x'.repeat(220)), 'normal');
  assert.equal(zoneQuoteSize('x'.repeat(260)), 'long');
  assert.equal(zoneQuoteSize('x'.repeat(420)), 'longer');
  assert.equal(zoneQuoteSize('x'.repeat(700)), 'longest');
});
