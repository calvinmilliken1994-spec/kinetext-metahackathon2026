/// <reference types="node" />
// Stage 7c P2: the atom tally bars and the live typeset equation are views of atomTotals / gradeBalance / solveBalance,
// never a second atom calculation. Species below are the stored NOAA "Fueling life on Earth" balance spec
// (job-20261029123057-ea478a2a, equation "6CO2 + 6H2O → C6H12O6 + 6O2").
import test from 'node:test';
import assert from 'node:assert/strict';
import { atomBars, atomTotals, barScale, equationTerms, gradeBalance, nextBarScale, solveBalance } from './balance.ts';

const q = '6CO2 + 6H2O → C6H12O6 + 6O2';
const src = 'noaa-oceanexplorer-fueling-life-on-earth';
const photo = [
  { id: 'carbon-dioxide', formula: 'CO2', side: 'left' as const, sourceId: src, quote: q },
  { id: 'water', formula: 'H2O', side: 'left' as const, sourceId: src, quote: q },
  { id: 'sugar', formula: 'C6H12O6', side: 'right' as const, sourceId: src, quote: q },
  { id: 'oxygen', formula: 'O2', side: 'right' as const, sourceId: src, quote: q },
];
const ones = [1, 1, 1, 1];

test('the stored photosynthesis species solve to 6, 6, 1, 6', () => {
  assert.deepEqual(solveBalance(photo), [6, 6, 1, 6]);
});

test('equation terms: coefficient 1 is not written, others are, formulas keep real subscripts', () => {
  const t = equationTerms(photo, ones);
  assert.deepEqual(t.left.map((x) => [x.id, x.coefficient, x.written]), [['carbon-dioxide', 1, ''], ['water', 1, '']]);
  assert.deepEqual(t.right.map((x) => [x.id, x.coefficient, x.written]), [['sugar', 1, ''], ['oxygen', 1, '']]);
  const b = equationTerms(photo, [6, 6, 1, 6]);
  assert.deepEqual([...b.left, ...b.right].map((x) => x.written), ['6', '6', '', '6']);
  assert.deepEqual(b.right[0]?.parts, [{ text: 'C', sub: false }, { text: '6', sub: true }, { text: 'H', sub: false }, { text: '12', sub: true }, { text: 'O', sub: false }, { text: '6', sub: true }]);
  assert.deepEqual([...b.left, ...b.right].map((x) => x.index), [0, 1, 2, 3], 'index points back into the species list');
});

test('bars at the opening coefficients: totals, per-substance segments and the excess', () => {
  const rows = atomBars(photo, ones);
  assert.ok(rows);
  assert.deepEqual(rows.map((r) => [r.element, r.left, r.right, r.balanced]), [['C', 1, 6, false], ['O', 3, 8, false], ['H', 2, 12, false]]);
  const o = rows[1];
  assert.deepEqual(o?.segments.left.map((s) => [s.formula, s.coefficient, s.atoms, s.start, s.end]), [['CO2', 1, 2, 0, 2], ['H2O', 1, 1, 2, 3]]);
  assert.deepEqual(o?.segments.right.map((s) => [s.formula, s.coefficient, s.atoms, s.start, s.end]), [['C6H12O6', 1, 6, 0, 6], ['O2', 1, 2, 6, 8]]);
  assert.deepEqual(o?.excess, { side: 'right', from: 3, to: 8, atoms: 5 });
  assert.equal(o?.status, '5 more in the products');
  // A substance without the element has no segment (H2O carries no C).
  assert.deepEqual(rows[0]?.segments.left.map((s) => s.formula), ['CO2']);
});

test('bars agree with atomTotals for every coefficient set we try', () => {
  for (const coefs of [ones, [6, 6, 1, 6], [12, 1, 3, 7], [2, 9, 12, 1]]) {
    const totals = atomTotals(photo, coefs);
    const rows = atomBars(photo, coefs);
    assert.ok(totals && rows);
    assert.deepEqual(rows.map((r) => [r.element, r.left, r.right, r.balanced]), totals.rows.map((r) => [r.element, r.left, r.right, r.balanced]));
    for (const r of rows) {
      assert.equal(r.segments.left.reduce((a, s) => a + s.atoms, 0), r.left);
      assert.equal(r.segments.right.reduce((a, s) => a + s.atoms, 0), r.right);
    }
  }
});

test('mid-way: carbon level, oxygen and hydrogen still off; the excess sits on the longer side', () => {
  const rows = atomBars(photo, [6, 1, 1, 1]);
  assert.ok(rows);
  const [c, o, h] = rows;
  assert.equal(c?.balanced, true);
  assert.equal(c?.excess, null);
  assert.equal(c?.status, 'level');
  assert.deepEqual(o?.excess, { side: 'left', from: 8, to: 13, atoms: 5 });
  assert.equal(o?.status, '5 more in the reactants');
  assert.deepEqual(h?.excess, { side: 'right', from: 2, to: 12, atoms: 10 });
});

test('balanced: every element level, and gradeBalance separates smallest whole numbers from multiples', () => {
  const rows = atomBars(photo, [6, 6, 1, 6]);
  assert.ok(rows);
  assert.deepEqual(rows.map((r) => [r.element, r.left, r.right]), [['C', 6, 6], ['O', 18, 18], ['H', 12, 12]]);
  assert.ok(rows.every((r) => r.balanced && r.excess === null && r.status === 'level'));
  const key = solveBalance(photo) as number[];
  assert.deepEqual(gradeBalance(photo, [6, 6, 1, 6], key), { status: 'correct' });
  assert.deepEqual(gradeBalance(photo, [12, 12, 2, 12], key), { status: 'balanced-multiple', factor: 2 });
});

test('bars are null when a formula cannot be parsed', () => {
  assert.equal(atomBars([{ formula: 'CH4', side: 'left' }, { formula: 'Xx', side: 'right' }], [1, 1]), null);
});

test('bar scale is a nice ceiling: 4, 6, 8, 12, 16, 24, 32, 48 ...', () => {
  const cases: [number, number][] = [[0, 4], [1, 4], [4, 4], [5, 6], [7, 8], [9, 12], [12, 12], [13, 16], [18, 24], [25, 32], [33, 48], [100, 128], [144, 192]];
  for (const [n, want] of cases) assert.equal(barScale(n), want, `barScale(${n})`);
});

test('the bar scale only grows during a session, so bars never shrink because another element grew', () => {
  const start = nextBarScale(null, atomTotals(photo, ones) as NonNullable<ReturnType<typeof atomTotals>>);
  assert.equal(start, 12, 'H has 12 atoms in the products at the start');
  const grown = nextBarScale(start, atomTotals(photo, [6, 6, 1, 6]) as NonNullable<ReturnType<typeof atomTotals>>);
  assert.equal(grown, 24, 'O reaches 18');
  const back = nextBarScale(grown, atomTotals(photo, ones) as NonNullable<ReturnType<typeof atomTotals>>);
  assert.equal(back, 24, 'stepping back down keeps the scale');
});
