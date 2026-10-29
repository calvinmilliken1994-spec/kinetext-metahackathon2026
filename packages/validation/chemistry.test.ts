// S6-V — chemical formula parser + exact integer balancer tests: the task-required vectors
// (H2+O2→H2O, CH4+O2→CO2+H2O, Ca(OH)2 groups, charges, an impossible equation, a non-unique one)
// plus parser edge cases (subscripts, depth, hydrates, state symbols, unicode, unknown symbols).
// Run: node --test packages/validation/chemistry.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  balanceSpecies,
  normalizeChemFormula,
  normalizeEquationText,
  parseChemicalFormula,
  parseEquationParts,
} from './chemistry.ts';

function atoms(formula: string): Record<string, number> {
  const r = parseChemicalFormula(formula);
  assert.equal(r.ok, true, `expected "${formula}" to parse: ${r.ok ? '' : r.error}`);
  return Object.fromEntries(r.ok ? r.parsed.atoms : []);
}

function rejects(formula: string, re: RegExp): void {
  const r = parseChemicalFormula(formula);
  assert.equal(r.ok, false, `expected "${formula}" to be rejected`);
  if (!r.ok) assert.match(r.error, re);
}

test('formula parser: plain formulas and exact atom counts', () => {
  assert.deepEqual(atoms('H2O'), { H: 2, O: 1 });
  assert.deepEqual(atoms('CH4'), { C: 1, H: 4 });
  assert.deepEqual(atoms('O2'), { O: 2 });
  assert.deepEqual(atoms('CO2'), { C: 1, O: 2 });
  assert.deepEqual(atoms('NaCl'), { Na: 1, Cl: 1 });
  assert.deepEqual(atoms('H'), { H: 1 });
  assert.deepEqual(atoms('Og'), { Og: 1 }); // Z=118 present
});

test('formula parser: groups with multipliers, depth <= 2', () => {
  assert.deepEqual(atoms('Ca(OH)2'), { Ca: 1, O: 2, H: 2 });
  assert.deepEqual(atoms('(H2O)3'), { H: 6, O: 3 });
  assert.deepEqual(atoms('Ca(NO3)2'), { Ca: 1, N: 2, O: 6 });
  assert.deepEqual(atoms('K4[Fe(CN)6]'), { K: 4, Fe: 1, C: 6, N: 6 }); // brackets, depth 2
  assert.deepEqual(atoms('Al(OH(H2O))2'), { Al: 1, O: 4, H: 6 }); // depth 2 is allowed
  rejects('C(H(N(O)2)2)2', /deeper than 2/); // depth 3
  rejects('Ca(OH', /unclosed group/);
  rejects('CaOH)2', /closing group without an opening one/);
  rejects('Ca()', /empty group/);
});

test('formula parser: subscripts 1-999, no leading zeros', () => {
  assert.deepEqual(atoms('C6H12O6'), { C: 6, H: 12, O: 6 }); // 24 atoms
  rejects('H02', /leading zero/);
  rejects('H0', /leading zero|outside/);
  rejects('H1000', /outside 1\.\.999/);
});

test('formula parser: charges EXCLUDED, hydrate dots rejected day 1', () => {
  rejects('Fe3+', /charge/);
  rejects('e-', /charge/);
  rejects('Ca^2+', /charge/);
  rejects('SO4^2-', /charge/);
  rejects('Na\u207a', /charge/);
  rejects('CuSO4\u00b75H2O', /dot separator/); // ·
  rejects('CuSO4.5H2O', /dot separator/);
  rejects('CuSO4\u20225H2O', /dot separator/); // •
});

test('formula parser: unknown symbols rejected, state symbols stripped, unicode subscripts', () => {
  rejects('Xx2', /unknown element symbol/);
  rejects('Ab', /unknown element symbol/);
  rejects('D2O', /unknown element symbol "D"/); // deuterium shorthand is not an element symbol
  rejects('', /empty/);
  assert.deepEqual(atoms('NaCl(s)'), { Na: 1, Cl: 1 });
  assert.deepEqual(atoms('H2O(l)'), { H: 2, O: 1 });
  assert.deepEqual(atoms('CO2(g)'), { C: 1, O: 2 });
  assert.deepEqual(atoms('H\u2082O'), { H: 2, O: 1 }); // unicode subscripts
  assert.equal(normalizeChemFormula('H\u2082 SO\u2084 (aq)'), 'H2SO4');
});

test('formula parser: per-species atom cap (40)', () => {
  rejects('C30H12', /atoms, expected <= 40/); // 42 atoms
  assert.deepEqual(atoms('C20H20'), { C: 20, H: 20 }); // exactly 40 is fine
});

test('equation text parser: arrows, coefficients, sides', () => {
  const r = parseEquationParts('CH4 + 2O2 \u2192 CO2 + 2H2O');
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.deepEqual(r.parts, [
      { coefficient: 1, formula: 'CH4', side: 'left' },
      { coefficient: 2, formula: 'O2', side: 'left' },
      { coefficient: 1, formula: 'CO2', side: 'right' },
      { coefficient: 2, formula: 'H2O', side: 'right' },
    ]);
  }
  assert.equal(normalizeEquationText('A \u27f6 B'), 'A -> B');
  assert.equal(normalizeEquationText('A --> B'), 'A -> B');
  assert.equal(parseEquationParts('H2 + O2').ok, false); // no arrow
  const twoArrows = parseEquationParts('A -> B -> C');
  assert.equal(twoArrows.ok, false);
  const noFormula = parseEquationParts('2 + 2 -> 4');
  assert.equal(noFormula.ok, false); // terms without formulas
});

/* ---------------- balancer vectors ---------------- */

function balance(formulas: [string, 'left' | 'right'][]): ReturnType<typeof balanceSpecies> {
  return balanceSpecies(formulas.map(([formula, side]) => ({ formula, side })));
}

test('balance: H2 + O2 -> H2O gives [2, 1, 2] in lowest terms', () => {
  const r = balance([['H2', 'left'], ['O2', 'left'], ['H2O', 'right']]);
  assert.equal(r.status, 'unique');
  if (r.status === 'unique') {
    assert.deepEqual(r.coefficients, [2, 1, 2]);
    assert.equal(r.gcd, 1);
  }
});

test('balance: CH4 + O2 -> CO2 + H2O gives [1, 2, 1, 2]', () => {
  const r = balance([['CH4', 'left'], ['O2', 'left'], ['CO2', 'right'], ['H2O', 'right']]);
  assert.equal(r.status, 'unique');
  if (r.status === 'unique') assert.deepEqual(r.coefficients, [1, 2, 1, 2]);
});

test('balance: Ca(OH)2 groups — Ca(OH)2 + HCl -> CaCl2 + H2O gives [1, 2, 1, 2]', () => {
  const r = balance([['Ca(OH)2', 'left'], ['HCl', 'left'], ['CaCl2', 'right'], ['H2O', 'right']]);
  assert.equal(r.status, 'unique');
  if (r.status === 'unique') assert.deepEqual(r.coefficients, [1, 2, 1, 2]);
});

test('balance: gcd reduction — N2 + H2 -> NH3 gives [1, 3, 2], never a common factor', () => {
  const r = balance([['N2', 'left'], ['H2', 'left'], ['NH3', 'right']]);
  assert.equal(r.status, 'unique');
  if (r.status === 'unique') {
    assert.deepEqual(r.coefficients, [1, 3, 2]);
    assert.equal(r.gcd, 1);
  }
  const iron = balance([['Fe', 'left'], ['O2', 'left'], ['Fe2O3', 'right']]);
  assert.equal(iron.status, 'unique');
  if (iron.status === 'unique') assert.deepEqual(iron.coefficients, [4, 3, 2]);
});

test('balance: impossible equation (atoms cannot be conserved) → no-solution', () => {
  // CH4 + O2 -> CO2 loses every hydrogen atom: only the trivial solution exists.
  const r = balance([['CH4', 'left'], ['O2', 'left'], ['CO2', 'right']]);
  assert.equal(r.status, 'no-solution');
  // A species that cannot take part at all (noble gas both sides aside) gives a zero coefficient.
  const z = balance([['He', 'left'], ['O2', 'left'], ['H2O', 'right']]);
  assert.equal(z.status, 'no-solution');
});

test('balance: non-unique equation (nullspace dimension 2) → ambiguous', () => {
  // NH3 + O2 -> N2 + NO + H2O is the classic ambiguous case (two degrees of freedom).
  const r = balance([['NH3', 'left'], ['O2', 'left'], ['N2', 'right'], ['NO', 'right'], ['H2O', 'right']]);
  assert.equal(r.status, 'ambiguous');
  if (r.status === 'ambiguous') assert.equal(r.nullity, 2);
});

test('balance: coefficients above 12 exist but are flagged by the caller (C8H18 combustion)', () => {
  const r = balance([['C8H18', 'left'], ['O2', 'left'], ['CO2', 'right'], ['H2O', 'right']]);
  assert.equal(r.status, 'unique');
  if (r.status === 'unique') {
    assert.deepEqual(r.coefficients, [2, 25, 16, 18]); // 25 > 12 → BAL-05 fails in the validator
    assert.equal(r.gcd, 1);
  }
});

test('balance: already-balanced printed equations and unbalanced splits both work', () => {
  // The species list carries NO coefficients; the system derives them either way.
  const r = balance([['H2O', 'left'], ['H2', 'right'], ['O2', 'right']]); // decomposition
  assert.equal(r.status, 'unique');
  if (r.status === 'unique') assert.deepEqual(r.coefficients, [2, 2, 1]);
});

test('balance: parse errors degrade, never throw', () => {
  const r = balanceSpecies([{ formula: 'Fe3+', side: 'left' }, { formula: 'Fe', side: 'right' }]);
  assert.equal(r.status, 'parse-error');
  const empty = balanceSpecies([]);
  assert.equal(empty.status, 'parse-error');
});
