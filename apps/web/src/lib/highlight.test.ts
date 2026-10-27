/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHighlights, findQuoteRange, normalizeWhitespace, normalizeWithMap } from './highlight.ts';

const text = 'Alpha beta\ngamma   delta.\n\nEpsilon zeta eta.';

test('normalizeWithMap equals the validator normalisation', () => {
  for (const s of [text, '  lead and trail  ', 'a\tb\r\nc', '', '   ', 'x']) {
    assert.equal(normalizeWithMap(s).norm, normalizeWhitespace(s));
  }
});

test('a quote spanning a newline and a multi-space run maps to the ORIGINAL range', () => {
  const r = findQuoteRange(text, 'beta gamma delta.');
  assert.ok(r);
  assert.equal(text.slice(r.start, r.end), 'beta\ngamma   delta.');
});

test('quote whitespace is normalised too (tabs / double spaces in the quote)', () => {
  const r = findQuoteRange(text, '  Epsilon \t zeta  ');
  assert.ok(r);
  assert.equal(text.slice(r.start, r.end), 'Epsilon zeta');
});

test('quote not found returns null; empty quote returns null', () => {
  assert.equal(findQuoteRange(text, 'omega'), null);
  assert.equal(findQuoteRange(text, '   '), null);
  const h = buildHighlights(text, [{ key: 'k', quote: 'omega' }]);
  assert.deepEqual(h.missing, ['k']);
  assert.deepEqual(h.segments, [{ start: 0, end: text.length, keys: [] }]);
});

test('segments tile the whole text exactly', () => {
  const h = buildHighlights(text, [
    { key: 'a', quote: 'beta gamma' },
    { key: 'b', quote: 'Epsilon zeta' },
  ]);
  assert.equal(h.segments[0]?.start, 0);
  assert.equal(h.segments[h.segments.length - 1]?.end, text.length);
  for (let i = 1; i < h.segments.length; i++) {
    assert.equal(h.segments[i]?.start, h.segments[i - 1]?.end);
  }
  assert.equal(h.segments.map((s) => text.slice(s.start, s.end)).join(''), text);
  const marked = h.segments.filter((s) => s.keys.length > 0).map((s) => text.slice(s.start, s.end));
  assert.deepEqual(marked, ['beta\ngamma', 'Epsilon zeta']);
});

test('duplicate quotes share one range and both keys', () => {
  const h = buildHighlights(text, [
    { key: 'e1', quote: 'gamma delta' },
    { key: 'c1', quote: 'gamma   delta' },
  ]);
  const marked = h.segments.filter((s) => s.keys.length > 0);
  assert.equal(marked.length, 1);
  assert.deepEqual(marked[0]?.keys, ['e1', 'c1']);
  assert.deepEqual(h.ranges['e1'], h.ranges['c1']);
});

test('overlapping quotes split into segments carrying one or both keys', () => {
  const h = buildHighlights(text, [
    { key: 'long', quote: 'Alpha beta gamma delta.' },
    { key: 'inner', quote: 'beta gamma' },
  ]);
  const view = h.segments.map((s) => [text.slice(s.start, s.end), s.keys.join('+')]);
  assert.deepEqual(view, [
    ['Alpha ', 'long'],
    ['beta\ngamma', 'long+inner'],
    ['   delta.', 'long'],
    ['\n\nEpsilon zeta eta.', ''],
  ].map(([a, b]) => [a, b]));
});

test('only the first occurrence is highlighted', () => {
  const t = 'x = 1. later x = 1.';
  const h = buildHighlights(t, [{ key: 'k', quote: 'x = 1.' }]);
  assert.deepEqual(h.ranges['k'], { start: 0, end: 6 });
});

test('real-style equation quote with symbols maps back correctly', () => {
  const t = 'Intro\n\nx = (a * t^2) / 2 + Vo * t + xo\n\nTail';
  const r = findQuoteRange(t, 'x = (a * t^2) / 2 + Vo * t + xo');
  assert.ok(r);
  assert.equal(t.slice(r.start, r.end), 'x = (a * t^2) / 2 + Vo * t + xo');
});
