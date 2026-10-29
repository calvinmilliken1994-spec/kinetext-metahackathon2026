// Round-4 S5B-22: the lead's round-3 exception (a NEGATED "until" states when the event happened)
// is REMOVED. "until"/"till" is always a temporal bound: a nearby "not"/"never"/"n't" is a heuristic
// that mis-scopes (misplaced negation, double negatives), so none of these sentences grounds. These
// are the former exception's tests, inverted, plus the reviewer's misplaced-negation rows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSourceUnitIndex, sourceQuoteGrounding } from './timeline.ts';

const D = (year: number, month = 0, day = 0) => ({ year, month, day });
const status = (text: string, quote: string, date: ReturnType<typeof D>, titleYear: number | null = null) =>
  sourceQuoteGrounding(buildSourceUnitIndex(text), quote, date, titleYear).status;

test('negated until no longer grounds: the former Lee Resolution exception is gone', () => {
  const s = 'The plan for making treaties was not approved until September of 1776.';
  assert.notEqual(status(s, s, D(1776, 9)), 'grounded');
});

test("negated until with a contraction and with never does not ground: wasn't / never", () => {
  const a = "The treaty wasn't signed until March 3, 1889.";
  assert.notEqual(status(a, a, D(1889, 3, 3)), 'grounded');
  const b = 'The office never opened its doors until 1902.';
  assert.notEqual(status(b, b, D(1902)), 'grounded');
});

test('un-negated until stays a bound: deferred / delayed / from-until periods', () => {
  const a = 'Approval was deferred until July 2, 1776.';
  assert.notEqual(status(a, a, D(1776, 7, 2)), 'grounded');
  const b = 'The plan of confederation was delayed until November of 1777.';
  assert.notEqual(status(b, b, D(1777, 11)), 'grounded');
  const c = 'It was in force from March 1, 1781, until 1789 when the present-day Constitution went into effect.';
  assert.notEqual(status(c, c, D(1789)), 'grounded');
  const d = 'The office stayed open until 1902.';
  assert.notEqual(status(d, d, D(1902)), 'grounded');
});

test('misplaced negation, double negatives and nearby qualifiers never lift until', () => {
  for (const text of [
    'The office (not the museum) operated until March 3, 1889.',
    'The office was not only open until March 3, 1889.',
    'The office was probably not opened until March 3, 1889.',
    'The office could not open until March 3, 1889.',
    'The office was not not opened until March 3, 1889.',
    'The office was not never opened until March 3, 1889.',
    'The treaty was not signed until about March 3, 1889.',
    'The treaty was not signed until after March 3, 1889.',
    'The treaty was not signed until March 3, 1889 or March 4, 1889.',
  ]) {
    assert.notEqual(status(text, text, D(1889, 3, 3)), 'grounded', text);
  }
  const d = 'The treaty was not signed until the 18th century.';
  assert.notEqual(status(d, d, D(18)), 'grounded');
});

test('negation in the same or an earlier clause never applies; the bound stays', () => {
  const a = 'It was not a quiet year. The treaty stayed open until 1790.';
  assert.notEqual(status(a, 'The treaty stayed open until 1790.', D(1790)), 'grounded');
  const b = 'Not every delegate agreed, and the assembly, after long and bitter debate over the terms, waited until 1790.';
  assert.notEqual(status(b, b, D(1790)), 'grounded');
});
