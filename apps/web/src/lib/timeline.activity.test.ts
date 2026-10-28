/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assembleTimelineSpec } from '../../../../packages/contracts/index.ts';
import type { TimelineEvent, TimelineGeneratedSpec, TimelineActivitySpec } from '../../../../packages/contracts/index.ts';
import {
  compareEvents, dateOrder, describeAnswerSwap, formatEventDate, gradeOrder, gradePair, hasUnorderedPair, isTimelineSpec,
  isValidOrder, moveItem, pairOptions, seededShuffle, timelineEventLabels,
} from './timeline.ts';

const ev = (id: string, year: number, month = 0, day = 0): TimelineEvent =>
  ({ id, label: `Event ${id}`, year, month, day, evidence: [{ sourceId: 's', quote: `q ${id}` }] });

function declarationSpec(): TimelineActivitySpec {
  const gen = JSON.parse(readFileSync(new URL('../../../../tests/fixtures/timeline.declaration.gen.json', import.meta.url), 'utf8')) as TimelineGeneratedSpec;
  return assembleTimelineSpec(gen, {
    id: 'timeline-declaration-fixture',
    sources: [],
    provenance: {
      provider: 'meta', requestedModel: 'm', returnedModel: 'm', responseId: 'r', runId: 'x', promptVersion: 'p',
      revision: 1, repairOf: null, generatedAt: '2026-10-29T00:00:00.000Z',
    },
  });
}

// ---- date formatting ------------------------------------------------------------------------------------

test('formatEventDate shows only what the source states: full date, month and year, year, BCE', () => {
  assert.equal(formatEventDate({ year: 1776, month: 6, day: 10 }), 'June 10, 1776');
  assert.equal(formatEventDate({ year: 1776, month: 7, day: 0 }), 'July 1776');
  assert.equal(formatEventDate({ year: 1776, month: 0, day: 0 }), '1776');
  assert.equal(formatEventDate({ year: -500, month: 0, day: 0 }), '500 BCE');
  assert.equal(formatEventDate({ year: -44, month: 3, day: 15 }), 'March 15, 44 BCE');
  assert.equal(formatEventDate({ year: -44, month: 3, day: 0 }), 'March 44 BCE');
  assert.equal(formatEventDate({ year: 1, month: 12, day: 31 }), 'December 31, 1');
});

test('formatEventDate never invents precision and never prints NaN/undefined', () => {
  // A day without a month is not a date the source stated; fall back to the year.
  assert.equal(formatEventDate({ year: 1776, month: 0, day: 4 }), '1776');
  assert.equal(formatEventDate({ year: 1776, month: 13, day: 4 }), '1776');
  for (const bad of [{ year: Number.NaN, month: 0, day: 0 }, { year: 0, month: 0, day: 0 }, { year: 1776.5, month: 0, day: 0 }]) {
    const s = formatEventDate(bad);
    assert.equal(s, 'date unavailable');
    assert.doesNotMatch(s, /NaN|undefined/);
  }
});

// ---- comparison at the precision both events state ------------------------------------------------------

test('compareEvents orders by year, then month, then day, at the precision both state', () => {
  assert.equal(compareEvents({ year: 1775, month: 12, day: 31 }, { year: 1776, month: 1, day: 1 }), -1);
  assert.equal(compareEvents({ year: 1776, month: 8, day: 2 }, { year: 1776, month: 7, day: 4 }), 1);
  assert.equal(compareEvents({ year: 1776, month: 6, day: 10 }, { year: 1776, month: 7, day: 0 }), -1, 'June 10 is strictly before "July 1776"');
  assert.equal(compareEvents({ year: 1776, month: 7, day: 2 }, { year: 1776, month: 7, day: 4 }), -1);
  assert.equal(compareEvents({ year: -500, month: 0, day: 0 }, { year: -44, month: 3, day: 15 }), -1, 'BCE years count up toward 0');
  assert.equal(compareEvents({ year: -44, month: 0, day: 0 }, { year: 5, month: 0, day: 0 }), -1);
});

test('compareEvents: dates that cannot be strictly ordered compare as 0 (year-only vs a month of that year, same date)', () => {
  assert.equal(compareEvents({ year: 1776, month: 0, day: 0 }, { year: 1776, month: 7, day: 4 }), 0);
  assert.equal(compareEvents({ year: 1776, month: 7, day: 0 }, { year: 1776, month: 7, day: 4 }), 0, 'a month does not order against a day inside it');
  assert.equal(compareEvents({ year: 1776, month: 7, day: 4 }, { year: 1776, month: 7, day: 4 }), 0);
  assert.equal(compareEvents({ year: 1776, month: 0, day: 0 }, { year: 1777, month: 1, day: 1 }), -1, 'but a year-only event is strictly before the next year');
});

test('compareEvents is antisymmetric', () => {
  const dates = [[1776, 0, 0], [1776, 6, 0], [1776, 6, 10], [1776, 7, 4], [1777, 0, 0], [-500, 0, 0], [-44, 3, 15]];
  for (const a of dates) for (const b of dates) {
    const x = compareEvents({ year: a[0]!, month: a[1]!, day: a[2]! }, { year: b[0]!, month: b[1]!, day: b[2]! });
    const y = compareEvents({ year: b[0]!, month: b[1]!, day: b[2]! }, { year: a[0]!, month: a[1]!, day: a[2]! });
    assert.equal(x, -y === 0 ? 0 : -y);
  }
});

// ---- order computed by code, never array order -----------------------------------------------------------

test('dateOrder sorts by date, not array order, and does not mutate its input', () => {
  const events = [ev('b', 1776, 8, 2), ev('a', 1776, 6, 10), ev('c', 1776, 7, 4), ev('d', -500), ev('e', 1776, 7, 19)];
  const before = events.map((e) => e.id).join();
  assert.deepEqual(dateOrder(events).map((e) => e.id), ['d', 'a', 'c', 'e', 'b']);
  assert.equal(events.map((e) => e.id).join(), before);
});

test('dateOrder puts a less precise date before a more precise one inside the same period, deterministically', () => {
  const a = [ev('m', 1776, 7), ev('y', 1776), ev('d', 1776, 7, 4)];
  const b = [a[2]!, a[0]!, a[1]!];
  assert.deepEqual(dateOrder(a).map((e) => e.id), ['y', 'm', 'd']);
  assert.deepEqual(dateOrder(b).map((e) => e.id), ['y', 'm', 'd']);
});

test('the Declaration fixture comes out e1..e6 whatever order it is given in', () => {
  const spec = declarationSpec();
  const reversed = [...spec.simulation.events].reverse();
  assert.deepEqual(dateOrder(reversed).map((e) => e.id), ['e1', 'e2', 'e3', 'e4', 'e5', 'e6']);
});

// ---- seeded shuffle --------------------------------------------------------------------------------------

test('seededShuffle is deterministic per seed, a permutation, and varies across seeds', () => {
  const events = declarationSpec().simulation.events;
  const a = seededShuffle(events, 'spec-1').map((e) => e.id);
  assert.deepEqual(seededShuffle(events, 'spec-1').map((e) => e.id), a);
  assert.deepEqual([...a].sort(), events.map((e) => e.id).sort());
  const distinct = new Set(['s1', 's2', 's3', 's4', 's5', 's6'].map((s) => seededShuffle(events, s).map((e) => e.id).join()));
  assert.ok(distinct.size >= 3, `expected several different shuffles, got ${distinct.size}`);
});

test('seededShuffle never returns the events already in a valid order (many seeds, several sizes)', () => {
  const six = declarationSpec().simulation.events;
  const two = [ev('x', 1900), ev('y', 1901)];
  const three = [ev('p', 10), ev('q', 20), ev('r', 30)];
  for (const events of [six, two, three]) {
    for (let i = 0; i < 300; i++) {
      const out = seededShuffle(events, `seed-${i}`);
      assert.equal(isValidOrder(events, out.map((e) => e.id)), false, `${events.length} events, seed-${i}: ${out.map((e) => e.id).join()}`);
    }
  }
});

test('seededShuffle does not hang or lose events when nothing can be out of order (all dates tied)', () => {
  const tied = [ev('a', 1776), ev('b', 1776), ev('c', 1776, 7)];
  const out = seededShuffle(tied, 'x');
  assert.deepEqual(out.map((e) => e.id).sort(), ['a', 'b', 'c']);
  assert.deepEqual(seededShuffle([], 'x'), []);
  assert.deepEqual(seededShuffle([ev('only', 1)], 'x').map((e) => e.id), ['only']);
});

// ---- grading an order ------------------------------------------------------------------------------------

test('gradeOrder: the date order is fully right and reports the code order', () => {
  const events = declarationSpec().simulation.events;
  const g = gradeOrder(events, ['e1', 'e2', 'e3', 'e4', 'e5', 'e6']);
  assert.equal(g.correct, true);
  assert.equal(g.rightCount, 6);
  assert.equal(g.total, 6);
  assert.deepEqual(g.positions, [true, true, true, true, true, true]);
  assert.deepEqual(g.correctOrderIds, ['e1', 'e2', 'e3', 'e4', 'e5', 'e6']);
});

test('gradeOrder marks which positions are right (two swapped; one moved to the end)', () => {
  const events = declarationSpec().simulation.events;
  const swapped = gradeOrder(events, ['e1', 'e2', 'e4', 'e3', 'e5', 'e6']);
  assert.equal(swapped.correct, false);
  assert.deepEqual(swapped.positions, [true, true, false, false, true, true]);
  assert.equal(swapped.rightCount, 4);
  const moved = gradeOrder(events, ['e2', 'e3', 'e4', 'e5', 'e6', 'e1']);
  assert.equal(moved.correct, false);
  assert.equal(moved.rightCount, 0);
});

test('gradeOrder ignores the spec array order: a spec listing events out of order is graded by dates', () => {
  const events = [ev('z', 1900), ev('y', 1800), ev('x', 1850)];
  assert.equal(gradeOrder(events, ['y', 'x', 'z']).correct, true);
  assert.equal(gradeOrder(events, ['z', 'y', 'x']).correct, false);
});

test('gradeOrder accepts either order between events that cannot be strictly ordered', () => {
  const events = [ev('early', 1775, 5, 1), ev('yearOnly', 1776), ev('july', 1776, 7, 4), ev('late', 1777, 1, 1)];
  assert.equal(gradeOrder(events, ['early', 'yearOnly', 'july', 'late']).correct, true);
  assert.equal(gradeOrder(events, ['early', 'july', 'yearOnly', 'late']).correct, true);
  const bad = gradeOrder(events, ['yearOnly', 'early', 'july', 'late']);
  assert.equal(bad.correct, false);
  assert.deepEqual(bad.positions, [false, false, true, true]);
});

test('gradeOrder: "all positions right" holds exactly when the order is valid (brute force over every permutation)', () => {
  const sets: TimelineEvent[][] = [
    [ev('a', 1776), ev('b', 1776, 6), ev('c', 1776, 8), ev('d', 1776, 6, 10), ev('e', 1775)],
    [ev('a', 1776, 1), ev('b', 1776, 1, 5), ev('c', 1776), ev('d', 1776, 2), ev('e', 1777)],
    [ev('a', -500), ev('b', -44, 3, 15), ev('c', -44), ev('d', 1), ev('e', -44, 3)],
  ];
  const perms = (xs: string[]): string[][] => (xs.length <= 1 ? [xs] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p])));
  for (const events of sets) {
    for (const p of perms(events.map((e) => e.id))) {
      const g = gradeOrder(events, p);
      assert.equal(g.correct, g.positions.every(Boolean), p.join());
      assert.equal(g.correct, isValidOrder(events, p), p.join());
    }
  }
});

test('gradeOrder treats a missing or unknown id as wrong, never as a crash', () => {
  const events = [ev('a', 1), ev('b', 2), ev('c', 3)];
  const g = gradeOrder(events, ['a', 'zzz']);
  assert.equal(g.correct, false);
  assert.equal(g.total, 3);
  assert.equal(g.positions.length, 2);
  assert.equal(g.positions[1], false);
});

// ---- moving items ----------------------------------------------------------------------------------------

test('moveItem moves one item without mutating the input and clamps out-of-range targets', () => {
  const a = ['a', 'b', 'c', 'd'];
  assert.deepEqual(moveItem(a, 0, 2), ['b', 'c', 'a', 'd']);
  assert.deepEqual(moveItem(a, 3, 1), ['a', 'd', 'b', 'c']);
  assert.deepEqual(moveItem(a, 1, 0), ['b', 'a', 'c', 'd']);
  assert.deepEqual(moveItem(a, 0, -4), a);
  assert.deepEqual(moveItem(a, 3, 99), a);
  assert.deepEqual(moveItem(a, 2, 2), a);
  assert.deepEqual(moveItem(a, 9, 1), a);
  assert.deepEqual(a, ['a', 'b', 'c', 'd']);
});

// ---- pair predictions ------------------------------------------------------------------------------------

const PRED = { id: 'p1', prompt: 'Which came first?', earlierEventId: 'e3', laterEventId: 'e6' };

test('gradePair grades the learner’s pick from the dates and returns both events', () => {
  const events = declarationSpec().simulation.events;
  const right = gradePair(events, PRED, 'e3');
  assert.ok(right !== null && right.status === 'graded');
  assert.equal(right.correct, true);
  assert.equal(right.earlier.id, 'e3');
  assert.equal(right.later.id, 'e6');
  const wrong = gradePair(events, PRED, 'e6');
  assert.ok(wrong !== null && wrong.status === 'graded');
  assert.equal(wrong.correct, false);
  assert.equal(wrong.earlier.id, 'e3', 'the true answer is shown even when the pick was wrong');
});

test('gradePair uses the dates, not the spec’s stored answer', () => {
  const events = declarationSpec().simulation.events;
  const lying = { id: 'p', prompt: '?', earlierEventId: 'e6', laterEventId: 'e3' };
  const g = gradePair(events, lying, 'e3');
  assert.ok(g !== null && g.status === 'graded');
  assert.equal(g.correct, true);
  assert.equal(g.earlier.id, 'e3');
});

test('gradePair: ties are not graded, unknown events and picks outside the pair give null', () => {
  const events = [ev('y', 1776), ev('d', 1776, 7, 4), ev('a', 1700)];
  const tie = gradePair(events, { id: 'p', prompt: '?', earlierEventId: 'y', laterEventId: 'd' }, 'y');
  assert.ok(tie !== null);
  assert.equal(tie.status, 'ungradable');
  assert.equal(gradePair(events, { id: 'p', prompt: '?', earlierEventId: 'nope', laterEventId: 'd' }, 'd'), null);
  assert.equal(gradePair(events, { id: 'p', prompt: '?', earlierEventId: 'a', laterEventId: 'd' }, 'y'), null);
});

test('pairOptions is deterministic per seed and does not always list the earlier event first', () => {
  const events = declarationSpec().simulation.events;
  const firstIds = new Set<string>();
  for (let i = 0; i < 24; i++) {
    const o = pairOptions(events, PRED, `spec-${i}`);
    assert.ok(o !== null);
    assert.deepEqual(pairOptions(events, PRED, `spec-${i}`)?.map((e) => e.id), o.map((e) => e.id));
    assert.deepEqual(o.map((e) => e.id).sort(), ['e3', 'e6']);
    firstIds.add(o[0].id);
  }
  assert.equal(firstIds.size, 2, 'both orders occur across seeds');
  assert.equal(pairOptions(events, { ...PRED, laterEventId: 'missing' }, 's'), null);
});

// ---- spec helpers, fault text ----------------------------------------------------------------------------

test('isTimelineSpec and timelineEventLabels', () => {
  const spec = declarationSpec();
  assert.equal(isTimelineSpec(spec), true);
  assert.equal(isTimelineSpec(null), false);
  assert.equal(isTimelineSpec(undefined), false);
  assert.equal(isTimelineSpec({ simulation: { engine: 'projectile-v1' } } as never), false);
  const labels = timelineEventLabels(spec);
  assert.equal(labels['e3'], 'Congress adopts the Declaration');
  assert.equal(labels['e6'], 'Delegates begin signing');
  assert.deepEqual(timelineEventLabels({ simulation: { engine: 'projectile-v1' } } as never), {});
});

test('describeAnswerSwap describes the swapped ordering in plain words using event labels', () => {
  const labels = { e1: 'Committee of five appointed', e3: 'Congress adopts the Declaration', e6: 'Delegates begin signing' };
  assert.equal(
    describeAnswerSwap('e3 -> e6', 'e6 -> e3', labels),
    'System swapped the answer: “Delegates begin signing” now claimed to come before “Congress adopts the Declaration” (the honest answer is the other way round)',
  );
  assert.match(describeAnswerSwap('e1 -> e3', 'e3 -> e1', labels) ?? '', /“Congress adopts the Declaration” now claimed to come before “Committee of five appointed”/);
});

test('describeAnswerSwap falls back to the ids when labels are unknown, and rejects anything that is not a swap', () => {
  assert.match(describeAnswerSwap('e1 -> e3', 'e3 -> e1', {}) ?? '', /“e3” now claimed to come before “e1”/);
  assert.equal(describeAnswerSwap(20.4, 31.6, {}), null);
  assert.equal(describeAnswerSwap('Some quote', 'Another quote', {}), null);
  assert.equal(describeAnswerSwap('e1 -> e3', 'plain text', {}), null);
});

test('hasUnorderedPair tells the UI when it must say "either order is accepted"', () => {
  assert.equal(hasUnorderedPair(declarationSpec().simulation.events), false);
  assert.equal(hasUnorderedPair([ev('a', 1776), ev('b', 1776, 7, 4), ev('c', 1800)]), true);
  assert.equal(hasUnorderedPair([]), false);
});
