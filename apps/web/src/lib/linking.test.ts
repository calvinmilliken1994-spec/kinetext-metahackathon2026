/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createLinkStore, equationQuoteLinks, isLit, linkKey, linkKeysOf, markLinks, segmentIsTabStop,
} from './linking.ts';

test('linkKey: the validator whitespace normalisation decides equality, the source id is part of the key', () => {
  const a = linkKey('moon', 'On the Moon g is about 1.62 m/s^2,');
  assert.equal(linkKey('moon', '  On the Moon\ng is   about 1.62 m/s^2, '), a);
  assert.equal(linkKey('moon', 'On the\tMoon g is about 1.62 m/s^2,'), a);
  assert.notEqual(linkKey('other', 'On the Moon g is about 1.62 m/s^2,'), a);
  assert.notEqual(linkKey('moon', 'On the Moon g is about 1.62 m/s^2.'), a);
  // Safe as a token in a space-separated data attribute.
  assert.match(a, /^q[0-9a-z]+$/);
});

test('linkKey: an empty or blank quote links to nothing', () => {
  assert.equal(linkKey('moon', ''), '');
  assert.equal(linkKey('moon', '  \n '), '');
});

test('linkKeysOf: one key per distinct normalised quote, blanks skipped, order kept', () => {
  const keys = linkKeysOf([
    { sourceId: 's', quote: 'alpha beta' },
    { sourceId: 's', quote: 'alpha  beta' },
    { sourceId: 's', quote: '' },
    { sourceId: 's', quote: 'gamma' },
  ]);
  assert.deepEqual(keys, [linkKey('s', 'alpha beta'), linkKey('s', 'gamma')]);
});

test('markLinks: the segment keys map to the link keys of their quotes on the shown source', () => {
  const quotes = new Map([
    ['explanation:a:0', 'alpha beta'],
    ['lesson:quiz.card.c1:0', 'alpha   beta'],
    ['concept:x:0', 'gamma'],
  ]);
  const links = markLinks(['explanation:a:0', 'lesson:quiz.card.c1:0', 'concept:x:0', 'missing:key'], (k) => quotes.get(k), 'src');
  assert.deepEqual(links, [linkKey('src', 'alpha beta'), linkKey('src', 'gamma')]);
});

test('segmentIsTabStop: only the segment where one of its quotes begins takes a tab stop', () => {
  const ranges = { a: { start: 0, end: 10 }, b: { start: 5, end: 20 } };
  assert.equal(segmentIsTabStop({ start: 0, keys: ['a'] }, ranges), true);
  assert.equal(segmentIsTabStop({ start: 5, keys: ['a', 'b'] }, ranges), true);
  assert.equal(segmentIsTabStop({ start: 10, keys: ['b'] }, ranges), false);
  assert.equal(segmentIsTabStop({ start: 3, keys: [] }, ranges), false);
});

test('isLit: an element lights when any of its keys is active', () => {
  assert.equal(isLit(null, ['a']), false);
  assert.equal(isLit({ owner: 'o', keys: ['a', 'b'], origin: 'source' }, ['c', 'b']), true);
  assert.equal(isLit({ owner: 'o', keys: ['a'], origin: 'lesson' }, []), false);
  assert.equal(isLit({ owner: 'o', keys: ['a'], origin: 'lesson' }, ['']), false);
});

test('link store: nested hover (a quote inside a card) falls back to the outer element when the inner one is left', () => {
  const store = createLinkStore();
  let calls = 0;
  const off = store.subscribe(() => { calls += 1; });
  store.enter('card', ['k1'], 'lesson');
  store.enter('quote', ['k1', 'k2'], 'lesson');
  assert.deepEqual(store.get()?.keys, ['k1', 'k2']);
  store.leave('quote');
  assert.equal(store.get()?.owner, 'card');
  store.leave('card');
  assert.equal(store.get(), null);
  assert.equal(calls, 4);
  store.leave('never-entered');
  assert.equal(calls, 4, 'leaving an unknown owner changes nothing');
  off();
  store.enter('x', ['k'], 'source');
  assert.equal(calls, 4, 'unsubscribed listeners are not called');
});

test('link store: re-entering an owner moves it to the top; an element with no keys never becomes active', () => {
  const store = createLinkStore();
  store.enter('a', ['ka'], 'lesson');
  store.enter('b', ['kb'], 'lesson');
  store.enter('a', ['ka'], 'lesson');
  assert.equal(store.get()?.owner, 'a');
  store.leave('a');
  assert.equal(store.get()?.owner, 'b');
  store.enter('empty', [], 'lesson');
  assert.equal(store.get()?.owner, 'b');
  store.clear();
  assert.equal(store.get(), null);
});

const moonExplanations = [
  { id: 'no-drag', text: '', evidence: [{ sourceId: 'moon', quote: 'On the Moon there is no air, so a thrown ball feels no drag at all.' }] },
  {
    id: 'max-height', text: '', evidence: [
      { sourceId: 'moon', quote: 'The vertical speed is V = V0 - g * t, and the height is y = V0 * t - g * t^2 / 2.' },
      { sourceId: 'moon', quote: 'Putting that time into the height equation gives the highest point: ymax = V0^2 / (2 * g).' },
    ],
  },
];

test('equationQuoteLinks: the quote that states the engine equation (spacing, * and _ ignored) is the equation’s link', () => {
  const links = equationQuoteLinks({ simulation: { equation: 'y_max=V0^2/(2*g)' }, explanations: moonExplanations });
  assert.deepEqual(links, [linkKey('moon', 'Putting that time into the height equation gives the highest point: ymax = V0^2 / (2 * g).')]);
});

test('equationQuoteLinks: without a quote stating the whole equation, quotes that define its left-hand side are used; else none', () => {
  const lhsOnly = equationQuoteLinks({
    simulation: { equation: 'L = Cl*rho*V^2/2*A' },
    explanations: [
      { id: 'e', text: '', evidence: [{ sourceId: 's', quote: 'The lift L = 1/2 rho V^2 A Cl in the textbook form.' }, { sourceId: 's', quote: 'Lift depends on the air.' }] },
    ],
  });
  assert.deepEqual(lhsOnly, [linkKey('s', 'The lift L = 1/2 rho V^2 A Cl in the textbook form.')]);
  assert.deepEqual(equationQuoteLinks({ simulation: {}, explanations: moonExplanations }), []);
  assert.deepEqual(equationQuoteLinks({ simulation: { equation: 'a = F/m' }, explanations: moonExplanations }), []);
});
