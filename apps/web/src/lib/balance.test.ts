/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import type { BalanceEquationSpec } from '../../../../packages/contracts/kit.ts';
import { atomTotals, equationCoefficients, formatEquation, formulaParts, gradeBalance, parseChemFormula, solveBalance } from './balance.ts';
import { loadDemoLessons } from './stage6-fixtures.ts';

const gallery = loadDemoLessons().find((l) => l.id === 'gallery');
const spec = Object.values(gallery?.specs ?? {}).find((s) => s.componentId === 'balance-equation-v1') as BalanceEquationSpec;

const sp = (...formulas: [string, 'left' | 'right'][]) => formulas.map(([formula, side], i) => ({ id: `s${i}`, formula, side, sourceId: 's', quote: 'q' }));

function counts(f: string): Record<string, number> | null {
  const r = parseChemFormula(f);
  return r.ok ? r.counts : null;
}

test('parses simple and grouped formulas', () => {
  assert.deepEqual(counts('CH4'), { C: 1, H: 4 });
  assert.deepEqual(counts('H2O'), { H: 2, O: 1 });
  assert.deepEqual(counts('O2'), { O: 2 });
  assert.deepEqual(counts('Ca(OH)2'), { Ca: 1, O: 2, H: 2 });
  assert.deepEqual(counts('Al2(SO4)3'), { Al: 2, S: 3, O: 12 });
  assert.deepEqual(counts('Ca((OH)2)2'), { Ca: 1, O: 4, H: 4 });
});

test('unicode subscripts and state symbols are normalised', () => {
  assert.deepEqual(counts('Fe₂O₃'), { Fe: 2, O: 3 });
  assert.deepEqual(counts('CO2(g)'), { C: 1, O: 2 });
  assert.deepEqual(counts('H2O(l)'), { H: 2, O: 1 });
  assert.deepEqual(counts('NaCl(aq)'), { Na: 1, Cl: 1 });
  assert.deepEqual(counts('Ca(OH)2(s)'), { Ca: 1, O: 2, H: 2 });
});

test('unsupported or invalid formulas are rejected with a reason', () => {
  for (const bad of ['Fe3+', 'e-', 'CuSO4·5H2O', 'CuSO4.5H2O', 'Xx2', 'ch4', '', 'H0', 'H02', 'H1000', '(OH', 'OH)', '()2', 'Ca(((OH)2)2)2', 'C H4', '2H2O', 'H2O+']) {
    assert.equal(parseChemFormula(bad).ok, false, `should reject ${JSON.stringify(bad)}`);
  }
  const r = parseChemFormula('Fe3+');
  if (!r.ok) assert.match(r.reason, /charge/i);
  const h = parseChemFormula('CuSO4·5H2O');
  if (!h.ok) assert.match(h.reason, /hydrate/i);
});

test('atom totals per element, left against right', () => {
  const species = sp(['CH4', 'left'], ['O2', 'left'], ['CO2', 'right'], ['H2O', 'right']);
  const ok = atomTotals(species, [1, 2, 1, 2]);
  assert.equal(ok?.balanced, true);
  assert.deepEqual(ok?.rows.map((r) => [r.element, r.left, r.right, r.balanced]), [['C', 1, 1, true], ['H', 4, 4, true], ['O', 4, 4, true]]);
  const off = atomTotals(species, [1, 1, 1, 1]);
  assert.equal(off?.balanced, false);
  assert.deepEqual(off?.rows.map((r) => [r.element, r.left, r.right, r.balanced]), [['C', 1, 1, true], ['H', 4, 2, false], ['O', 2, 3, false]]);
});

test('atom totals return null when a formula cannot be parsed', () => {
  assert.equal(atomTotals(sp(['CH4', 'left'], ['Xx', 'right']), [1, 1]), null);
});

test('solver finds the smallest whole-number balance', () => {
  assert.deepEqual(solveBalance(sp(['CH4', 'left'], ['O2', 'left'], ['CO2', 'right'], ['H2O', 'right'])), [1, 2, 1, 2]);
  assert.deepEqual(solveBalance(sp(['H2', 'left'], ['O2', 'left'], ['H2O', 'right'])), [2, 1, 2]);
  assert.deepEqual(solveBalance(sp(['Fe', 'left'], ['O2', 'left'], ['Fe2O3', 'right'])), [4, 3, 2]);
  assert.deepEqual(solveBalance(sp(['C3H8', 'left'], ['O2', 'left'], ['CO2', 'right'], ['H2O', 'right'])), [1, 5, 3, 4]);
  assert.deepEqual(solveBalance(sp(['Al', 'left'], ['H2SO4', 'left'], ['Al2(SO4)3', 'right'], ['H2', 'right'])), [2, 3, 1, 3]);
});

test('solver refuses impossible and ambiguous equations', () => {
  assert.equal(solveBalance(sp(['H2', 'left'], ['O2', 'right'])), null, 'no element in common');
  assert.equal(solveBalance(sp(['H2', 'left'], ['O2', 'left'], ['H2O', 'right'], ['H2O2', 'right'])), null, 'two independent balances');
  assert.equal(solveBalance(sp(['H2', 'left'], ['H2', 'left'])), null, 'nothing on the right');
  assert.equal(solveBalance(sp(['CH4', 'left'], ['Zz', 'right'])), null);
});

test('solver respects the 1 to 12 coefficient limit', () => {
  assert.equal(solveBalance(sp(['C12H26', 'left'], ['O2', 'left'], ['CO2', 'right'], ['H2O', 'right'])), null, '2, 37, 24, 26 are past 12');
  assert.equal(solveBalance(sp(['C13H28', 'left'], ['O2', 'left'], ['CO2', 'right'], ['H2O', 'right'])), null, 'more than 40 atoms in one species');
});

test('formula parts mark subscripts', () => {
  assert.deepEqual(formulaParts('H2O'), [{ text: 'H', sub: false }, { text: '2', sub: true }, { text: 'O', sub: false }]);
  assert.deepEqual(formulaParts('Ca(OH)2'), [{ text: 'Ca(OH)', sub: false }, { text: '2', sub: true }]);
  assert.deepEqual(formulaParts('CO2(g)'), [{ text: 'CO', sub: false }, { text: '2', sub: true }]);
});

test('the page equation text gives coefficients by species', () => {
  const species = spec.species;
  assert.deepEqual(equationCoefficients(spec.equationText, species), [1, 2, 1, 2]);
  assert.deepEqual(equationCoefficients('CH4 + 2 O2 -> CO2 + 2 H2O', species), [1, 2, 1, 2]);
  assert.deepEqual(equationCoefficients('CH4 + O2 → CO2 + H2O', species), [1, 1, 1, 1]);
  assert.equal(equationCoefficients('CH4 + 2O2 → CO2', species), null);
  assert.equal(equationCoefficients('not an equation', species), null);
});

test('the fixture species solve to the equation the page prints', () => {
  assert.deepEqual(solveBalance(spec.species), [1, 2, 1, 2]);
});

test('checking: exact, balanced but not lowest terms, and unbalanced', () => {
  const species = spec.species;
  const key = [1, 2, 1, 2];
  assert.deepEqual(gradeBalance(species, [1, 2, 1, 2], key), { status: 'correct' });
  assert.deepEqual(gradeBalance(species, [2, 4, 2, 4], key), { status: 'balanced-multiple', factor: 2 });
  const off = gradeBalance(species, [1, 1, 1, 1], key);
  assert.equal(off.status, 'unbalanced');
  if (off.status === 'unbalanced') assert.deepEqual(off.elements, ['H', 'O']);
});

test('equation text for display', () => {
  assert.equal(formatEquation(spec.species, [1, 2, 1, 2]), 'CH4 + 2 O2 → CO2 + 2 H2O');
  assert.equal(formatEquation(spec.species, [1, 1, 1, 1]), 'CH4 + O2 → CO2 + H2O');
});
