/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTimeAxis, dayNumber, dayToX, eventSpan, formatYear, gapText, layoutLabels, precisionOf } from './timeAxis.ts';
import type { TimeAxis } from './timeAxis.ts';

type Ev = { id: string; year: number; month: number; day: number };
/** 'YYYY-MM-DD' with 00 for an unstated month/day; a leading '-' is BCE (as stored: negative year, never 0). */
const ev = (id: string, date: string): Ev => {
  const m = /^(-?\d+)-(\d\d)-(\d\d)$/.exec(date);
  if (m === null) throw new Error(date);
  return { id, year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
};
const evs = (dates: string[]): Ev[] => dates.map((d, i) => ev(`e${i + 1}`, d));

// The dates of every stored timeline-v1 run on the live API (GET /api/jobs, 2026-10-30), dates only.
const STORED: Record<string, string[]> = {
  'lee-a8b6bdbf': ['1775-00-00', '1776-07-09', '1776-06-07', '1776-06-11', '1776-00-00'],
  'lee-d36dffc0': ['1775-00-00', '1776-06-07', '1776-06-11', '1776-07-02', '1776-07-09', '1776-09-00', '1777-11-00'],
  'powell-919343d9': ['1669-00-00', '1788-00-00', '1815-00-00', '1841-00-00', '1896-00-00', '1956-00-00'],
  'lee-45034b22': ['1775-00-00', '1776-06-07', '1776-07-09', '1776-09-00', '1777-11-00'],
  'powell-b93c8c9f': ['1669-00-00', '1788-00-00', '1841-00-00', '1869-00-00', '1896-00-00', '1956-00-00'],
  'lee-2015d30a': ['1775-00-00', '1776-00-00', '1776-07-09', '1776-09-00', '1777-11-00'],
  'powell-58a3467e': ['1669-00-00', '1788-00-00', '1841-00-00', '1896-00-00', '1913-00-00'],
  'wright-45240f1f': ['1900-00-00', '1901-00-00', '1902-00-00', '1903-00-00', '1904-00-00', '1905-00-00'],
  'powell-2489e263': ['1669-00-00', '1788-00-00', '1815-00-00', '1841-00-00', '1896-00-00', '1913-00-00', '1956-00-00'],
  'declaration-fa7f9d4b': ['1776-06-10', '1776-07-03', '1776-07-04', '1776-07-05', '1776-07-19', '1776-08-02'],
  'articles-4dc34853': ['1776-06-11', '1777-11-15', '1781-03-01', '1787-05-00', '1789-00-00'],
  'declaration-c5e1a7da': ['1776-06-10', '1776-07-02', '1776-07-03', '1776-07-04', '1776-07-05', '1776-07-19', '1776-08-02'],
  // synthetic: BCE, an era crossing and a dominant gap (no stored run has these yet)
  'bce-span': ['-500-00-00', '-44-03-15', '-27-01-16', '14-08-19', '79-00-00'],
  'dominant-gap': ['1492-10-12', '1776-07-04', '1781-03-01', '1787-09-17', '1789-00-00', '1791-12-15'],
  'two-gaps': ['1066-00-00', '1492-00-00', '1776-07-04', '1781-03-01', '1787-09-17', '1791-12-15'],
  'ten-dense': ['1776-06-07', '1776-06-08', '1776-06-10', '1776-06-11', '1776-06-12', '1776-06-28', '1776-07-01', '1776-07-02', '1776-07-04', '1776-07-08'],
};

const xOf = (a: TimeAxis, id: string): number => {
  const m = a.marks.find((k) => k.id === id);
  assert.ok(m !== undefined, `mark ${id}`);
  return m.x;
};

test('dayNumber: proleptic Gregorian day count, 1 BCE is directly followed by 1 CE (there is no year 0)', () => {
  assert.equal(dayNumber(1970, 1, 1), 0);
  assert.equal(dayNumber(1970, 1, 2), 1);
  assert.equal(dayNumber(2000, 3, 1) - dayNumber(2000, 2, 1), 29); // 2000 is a leap year
  assert.equal(dayNumber(1900, 3, 1) - dayNumber(1900, 2, 1), 28); // 1900 is not
  assert.equal(dayNumber(1776, 7, 4) - dayNumber(1776, 6, 7), 27);
  assert.equal(dayNumber(1, 1, 1) - dayNumber(-1, 12, 31), 1);
  assert.equal(dayNumber(1, 1, 1) - dayNumber(-1, 1, 1), 366); // 1 BCE (astronomical 0) is a leap year
  assert.ok(dayNumber(-500, 1, 1) < dayNumber(-44, 3, 15));
});

test('precisionOf / eventSpan: a year covers the whole year, a month the whole month, a day one day', () => {
  assert.equal(precisionOf(ev('a', '1776-00-00')), 'year');
  assert.equal(precisionOf(ev('a', '1776-07-00')), 'month');
  assert.equal(precisionOf(ev('a', '1776-07-04')), 'day');
  assert.equal(precisionOf({ year: 1776, month: 0, day: 4 }), 'year'); // a day without a month is not a date
  const y = eventSpan(ev('a', '1776-00-00'));
  assert.deepEqual([y.start, y.end - y.start, y.precision], [dayNumber(1776, 1, 1), 366, 'year']);
  const m = eventSpan(ev('a', '1776-09-00'));
  assert.deepEqual([m.start, m.end - m.start], [dayNumber(1776, 9, 1), 30]);
  const d = eventSpan(ev('a', '1776-07-04'));
  assert.deepEqual([d.start, d.end - d.start], [dayNumber(1776, 7, 4), 1]);
  const dec = eventSpan(ev('a', '1777-12-00'));
  assert.equal(dec.end, dayNumber(1778, 1, 1));
});

test('formatYear: BCE years read "500 BCE"; CE years get "CE" only when asked (an axis that crosses eras)', () => {
  assert.equal(formatYear(1776), '1776');
  assert.equal(formatYear(-500), '500 BCE');
  assert.equal(formatYear(14, true), '14 CE');
});

for (const [name, dates] of Object.entries(STORED)) {
  for (const width of [640, 900, 1280]) {
    test(`axis ${name} @${width}px: every event placed in date order inside the plot, ticks readable and in order`, () => {
      const events = evs(dates);
      const a = buildTimeAxis(events, { width });
      assert.equal(a.marks.length, events.length);
      for (const m of a.marks) {
        assert.ok(m.x0 >= 0 && m.x1 <= width && m.x0 <= m.x && m.x <= m.x1, `${m.id} inside [0, ${width}]: ${m.x0}..${m.x1}`);
        assert.ok(m.x1 - m.x0 >= 0, 'band never negative');
      }
      // date order on the page = x order on the axis (strictly earlier starts are strictly left)
      for (const p of events) {
        for (const q of events) {
          if (precisionOf(p) === 'day' && precisionOf(q) === 'day' && eventSpan(p).start < eventSpan(q).start) assert.ok(xOf(a, p.id) < xOf(a, q.id), `${p.id} left of ${q.id}`);
          if (eventSpan(p).end <= eventSpan(q).start) assert.ok(a.marks.find((m) => m.id === p.id)!.x1 <= a.marks.find((m) => m.id === q.id)!.x0 + 1e-6, `${p.id} band ends before ${q.id} starts`);
        }
      }
      assert.ok(a.ticks.length >= 2, `at least two ticks, got ${a.ticks.map((t) => t.label).join(',')}`);
      for (let i = 1; i < a.ticks.length; i++) {
        assert.ok(a.ticks[i]!.x - a.ticks[i - 1]!.x >= 56, `ticks ${a.ticks[i - 1]!.label} / ${a.ticks[i]!.label} too close at ${width}`);
      }
      for (const t of a.ticks) {
        assert.ok(t.x >= 0 && t.x <= width, `tick ${t.label} inside`);
        assert.ok(!/^-|^0( |$)|^0 BCE$/.test(t.label), `no year 0 / no minus sign: ${t.label}`);
        for (const b of a.breaks) assert.ok(t.x < b.x0 - 20 || t.x > b.x1 + 20, `tick ${t.label} clear of break`);
      }
    });
  }
}

test('to scale inside a segment: equal gaps in days give equal gaps in pixels (Declaration of Independence run)', () => {
  const events = evs(STORED['declaration-c5e1a7da']!);
  const a = buildTimeAxis(events, { width: 1000 });
  assert.equal(a.breaks.length, 0);
  const pxPerDay = (xOf(a, 'e4') - xOf(a, 'e2')) / 2; // Jul 2 -> Jul 4
  assert.ok(pxPerDay > 0);
  assert.ok(Math.abs((xOf(a, 'e7') - xOf(a, 'e6')) / 14 - pxPerDay) < 1e-6); // Jul 19 -> Aug 2
  assert.equal(a.unit, 'day');
});

test('stored runs never get an axis break: their gaps are real and shown to scale', () => {
  for (const [name, dates] of Object.entries(STORED)) {
    if (['dominant-gap', 'two-gaps', 'bce-span', 'ten-dense'].includes(name)) continue;
    assert.equal(buildTimeAxis(evs(dates), { width: 900 }).breaks.length, 0, name);
  }
  const powell = buildTimeAxis(evs(STORED['powell-919343d9']!), { width: 900 });
  assert.equal(powell.unit, 'year');
  // 1669 -> 1788 (119 years) is wider than 1788 -> 1815 (27 years), in proportion
  const r = (xOf(powell, 'e2') - xOf(powell, 'e1')) / (xOf(powell, 'e3') - xOf(powell, 'e2'));
  assert.ok(Math.abs(r - 119 / 27) < 0.05, `ratio ${r}`);
});

test('a dominant empty gap (more than half the span) is cut and clearly marked with how long it is', () => {
  const a = buildTimeAxis(evs(STORED['dominant-gap']!), { width: 1000 });
  assert.equal(a.breaks.length, 1);
  const b = a.breaks[0]!;
  assert.ok(xOf(a, 'e1') < b.x0 && b.x1 < xOf(a, 'e2'), 'break sits between 1492 and 1776');
  assert.match(b.label, /^about 28\d years$/);
  // the 1776-1791 cluster gets most of the width instead of 5%
  assert.ok(xOf(a, 'e6') - xOf(a, 'e2') > 600, `cluster width ${xOf(a, 'e6') - xOf(a, 'e2')}`);
  assert.equal(dayToX(a, dayNumber(1600, 1, 1)), null, 'a day inside the cut gap has no position');
  const two = buildTimeAxis(evs(STORED['two-gaps']!), { width: 1000 });
  assert.equal(two.breaks.length, 2);
  assert.ok(two.breaks.every((k) => /^about \d+ years$/.test(k.label)));
});

test('BCE and an era crossing: ticks read BCE / CE, never 0, and 44 BCE sits left of 14 CE', () => {
  const a = buildTimeAxis(evs(STORED['bce-span']!), { width: 1000 });
  assert.ok(xOf(a, 'e1') < xOf(a, 'e2') && xOf(a, 'e2') < xOf(a, 'e3') && xOf(a, 'e3') < xOf(a, 'e4'));
  assert.ok(a.ticks.some((t) => / BCE$/.test(t.label)), a.ticks.map((t) => t.label).join(','));
  assert.ok(a.ticks.some((t) => / CE$/.test(t.label)), a.ticks.map((t) => t.label).join(','));
  // 27 BCE -> 14 CE is 40 years (no year 0), so it is drawn 40/17 times the 44 -> 27 BCE gap
  const r = (xOf(a, 'e4') - xOf(a, 'e3')) / (xOf(a, 'e3') - xOf(a, 'e2'));
  const want = (dayNumber(14, 8, 19) - dayNumber(-27, 1, 16)) / (dayNumber(-27, 1, 16) - dayNumber(-44, 3, 15));
  assert.ok(Math.abs(r - want) < 1e-6);
});

test('a single event or identical dates still give a usable axis', () => {
  const one = buildTimeAxis([ev('a', '1776-07-04')], { width: 600 });
  assert.equal(one.marks.length, 1);
  assert.ok(one.ticks.length >= 2);
  const same = buildTimeAxis([ev('a', '1776-07-04'), ev('b', '1776-07-04')], { width: 600 });
  assert.equal(xOf(same, 'a'), xOf(same, 'b'));
});

test('gapText: the gap at the precision both dates state', () => {
  assert.equal(gapText(ev('a', '1776-06-07'), ev('b', '1776-07-09')), '32 days later');
  assert.equal(gapText(ev('a', '1776-07-03'), ev('b', '1776-07-04')), '1 day later');
  assert.equal(gapText(ev('a', '1776-06-11'), ev('b', '1777-11-00')), 'about 17 months later');
  assert.equal(gapText(ev('a', '1775-00-00'), ev('b', '1776-06-07')), 'about 1 year later');
  assert.equal(gapText(ev('a', '1669-00-00'), ev('b', '1788-00-00')), 'about 119 years later');
  assert.equal(gapText(ev('a', '-44-03-15'), ev('b', '14-08-19')), 'about 57 years later');
  assert.equal(gapText(ev('a', '1776-07-00'), ev('b', '1776-07-04')), 'the same month');
});

test('layoutLabels: alternating sides, no overlaps on a side, date order kept, all inside the width', () => {
  for (const [name, dates] of Object.entries(STORED)) {
    for (const width of [640, 900, 1280]) {
      const a = buildTimeAxis(evs(dates), { width });
      const anchors = a.marks.map((m) => ({ id: m.id, x: m.x }));
      const lay = layoutLabels(anchors, { width });
      assert.ok(lay !== null, `${name} @${width} fits`);
      assert.equal(lay.placements.length, anchors.length);
      for (const side of ['above', 'below'] as const) {
        const row = lay.placements.filter((p) => p.side === side).sort((p, q) => p.anchorX - q.anchorX);
        for (let i = 1; i < row.length; i++) {
          assert.ok(row[i]!.left >= row[i - 1]!.left + lay.labelWidth + 8 - 1e-6, `${name} @${width} ${side} overlap`);
          assert.ok(row[i]!.anchorX >= row[i - 1]!.anchorX, 'kept in date order');
          assert.ok(row[i]!.attachX >= row[i - 1]!.attachX, 'leaders do not cross');
        }
        for (const p of row) {
          assert.ok(p.left >= 0 && p.left + lay.labelWidth <= width + 1e-6, `${name} @${width} inside`);
          assert.ok(p.attachX >= p.left && p.attachX <= p.left + lay.labelWidth);
        }
      }
      const sorted = [...anchors].sort((p, q) => p.x - q.x);
      // neighbours in date order alternate sides, so a dense cluster spreads over both rows
      const sideOf = (id: string): string => lay.placements.find((p) => p.id === id)!.side;
      for (let i = 1; i < sorted.length; i++) assert.notEqual(sideOf(sorted[i]!.id), sideOf(sorted[i - 1]!.id));
      assert.ok(lay.labelWidth >= 112);
    }
  }
});

test('layoutLabels: too narrow for the labels gives null (the view falls back to a list)', () => {
  const anchors = Array.from({ length: 10 }, (_, i) => ({ id: `e${i}`, x: 10 + i }));
  assert.equal(layoutLabels(anchors, { width: 300 }), null);
});

test('layoutLabels: labels stay near their marks when there is room', () => {
  const lay = layoutLabels([{ id: 'a', x: 100 }, { id: 'b', x: 800 }], { width: 1000 });
  assert.ok(lay !== null);
  for (const p of lay.placements) assert.ok(Math.abs(p.attachX - p.anchorX) < 1e-6, 'leader is vertical when nothing is in the way');
});

test('layoutLabels sides "below": every label under the axis, still without overlaps (the which-came-first pair)', () => {
  const lay = layoutLabels([{ id: 'a', x: 300 }, { id: 'b', x: 340 }], { width: 900, sides: 'below' });
  assert.ok(lay !== null);
  assert.deepEqual(lay.placements.map((p) => p.side), ['below', 'below']);
  const [a, b] = lay.placements;
  assert.ok(b!.left >= a!.left + lay.labelWidth + 8 - 1e-6);
});

test('a day or month axis names the year on its first visible tick (and on every January)', () => {
  for (const [name, dates] of Object.entries(STORED)) {
    for (const width of [640, 900, 1280]) {
      const a = buildTimeAxis(evs(dates), { width });
      if (a.unit === 'year') continue;
      assert.match(a.ticks[0]!.label, /\d{3,4}( BCE| CE)?$/, `${name} @${width}: first tick ${a.ticks[0]!.label}`);
    }
  }
  const pair = buildTimeAxis([ev('a', '1776-06-07'), ev('b', '1776-07-09')], { width: 880 });
  assert.equal(pair.unit, 'day');
  assert.match(pair.ticks[0]!.label, /, 1776$/);
});
