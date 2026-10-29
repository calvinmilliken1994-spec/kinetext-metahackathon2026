// Lead decision (round-3 STOP items): a NEGATED "until" states when the event happened
// ("was not approved until September of 1776" = approved in September 1776), so it is an exact
// date. Every other "until" stays a temporal bound (fail closed): "deferred/delayed until" names
// a scheduled date, not proof that the event happened then; "from X until Y" is a period.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSourceUnitIndex, sourceQuoteGrounding } from './timeline.ts';

const D = (year: number, month = 0, day = 0) => ({ year, month, day });
const status = (text: string, quote: string, date: ReturnType<typeof D>, titleYear: number | null = null) =>
  sourceQuoteGrounding(buildSourceUnitIndex(text), quote, date, titleYear).status;

test('negated until grounds: "not approved until September of 1776" (real NARA Lee Resolution sentence)', () => {
  const s = 'The plan for making treaties was not approved until September of 1776.';
  assert.equal(status(s, s, D(1776, 9)), 'grounded');
});

test("negated until grounds with a contraction and with never: wasn't / never", () => {
  const a = "The treaty wasn't signed until March 3, 1889.";
  assert.equal(status(a, a, D(1889, 3, 3)), 'grounded');
  const b = 'The office never opened its doors until 1902.';
  assert.equal(status(b, b, D(1902)), 'grounded');
});

test('un-negated until stays a bound (fail closed): deferred / delayed / from-until periods', () => {
  const a = 'Approval was deferred until July 2, 1776.';
  assert.notEqual(status(a, a, D(1776, 7, 2)), 'grounded');
  const b = 'The plan of confederation was delayed until November of 1777.';
  assert.notEqual(status(b, b, D(1777, 11)), 'grounded');
  const c = 'It was in force from March 1, 1781, until 1789 when the present-day Constitution went into effect.';
  assert.notEqual(status(c, c, D(1789)), 'grounded');
  const d = 'The office stayed open until 1902.';
  assert.notEqual(status(d, d, D(1902)), 'grounded');
});

test('negation never lifts other qualifiers or bounds next to the date', () => {
  const a = 'The treaty was not signed until about 1790.';
  assert.notEqual(status(a, a, D(1790)), 'grounded');
  const b = 'The treaty was not signed until after 1790.';
  assert.notEqual(status(b, b, D(1790)), 'grounded');
  const c = 'The treaty was not signed until 1790 or 1791.';
  assert.notEqual(status(c, c, D(1790)), 'grounded');
  const d = 'The treaty was not signed until the 18th century.';
  assert.notEqual(status(d, d, D(18)), 'grounded');
});

test('negation must be in the same clause, close to until (not a distant or earlier-sentence "not")', () => {
  const a = 'It was not a quiet year. The treaty stayed open until 1790.';
  assert.notEqual(status(a, 'The treaty stayed open until 1790.', D(1790)), 'grounded');
  const b = 'Not every delegate agreed, and the assembly, after long and bitter debate over the terms, waited until 1790.';
  assert.notEqual(status(b, b, D(1790)), 'grounded');
});
