// S6-V — balance-equation-v1 tests: golden pass, one failing fixture per BAL check id, and the
// required balance vectors end-to-end through the validator (impossible equation, ambiguous
// equation, coefficients above 12, charges rejected, groups accepted).
// Run: node --test packages/validation/stage6-balance.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';

import { validateKitComponent, deriveBalanceSolution } from './kit/index.ts';
import {
  AMBIGUOUS_SOURCE, ambiguousBalanceGen, balanceGoldenSource, BIG_COEFF_SOURCE, bigCoefficientBalanceGen,
  checkOf, clone, expectFailures, failedIds, IMPOSSIBLE_SOURCE, impossibleBalanceGen, stage6Fixture,
} from './fixtures/stage6.ts';
import type { BalanceEquationGen } from '../contracts/kit.ts';

const golden = () => stage6Fixture<BalanceEquationGen>('balance-equation.gen.json');
const bal = (gen: BalanceEquationGen, sources = [balanceGoldenSource()]) =>
  validateKitComponent('balance-equation-v1', gen, sources);

test('BAL-01: an equationText outside the quote fails alone', () => {
  const gen = clone(golden());
  gen.equationText = 'CH4 + 3O2 \u2192 CO2 + 2H2O'; // coefficients are not in the quoted line
  expectFailures(bal(gen), ['BAL-01']);
});

test('BAL-02: charges are rejected by the parser', () => {
  const gen = clone(golden());
  gen.species[0]!.formula = 'CH4+';
  const report = bal(gen);
  assert.ok(failedIds(report).includes('BAL-02'));
  assert.match(checkOf(report, 'BAL-02').message, /charge/);
});

test('BAL-02: a species split that contradicts the printed equation fails', () => {
  const gen = clone(golden());
  gen.species.push({ id: 'nitrogen', formula: 'N2', side: 'left', sourceId: 'synthetic-balance', quote: 'When methane CH4 burns in oxygen O2' });
  const report = bal(gen);
  assert.ok(failedIds(report).includes('BAL-02'));
  assert.match(checkOf(report, 'BAL-02').message, /does not match the printed equationText/);
});

test('BAL-02: more than 5 species fails the count rule (count-exempt gate)', () => {
  const gen = clone(golden());
  gen.species.push({ id: 'nitrogen', formula: 'N2', side: 'left', sourceId: 'synthetic-balance', quote: 'When methane CH4 burns in oxygen O2' });
  gen.species.push({ id: 'argon', formula: 'Ar', side: 'right', sourceId: 'synthetic-balance', quote: 'it produces carbon dioxide CO2 and water H2O' });
  gen.equationText = 'CH4 + 2O2 + N2 \u2192 CO2 + 2H2O + Ar';
  gen.quote = 'The balanced form is CH4 + 2O2 + N2 \u2192 CO2 + 2H2O + Ar';
  const report = bal(gen);
  assert.equal(checkOf(report, 'schema.gen').passed, true, 'a species-count violation must not short-circuit the gate');
  assert.ok(failedIds(report).includes('BAL-02'));
  assert.match(checkOf(report, 'BAL-02').message, /expected 2-5/);
});

test('BAL-03/04/05/08: an impossible equation fails the whole solution family', () => {
  const report = bal(impossibleBalanceGen(), [IMPOSSIBLE_SOURCE()]);
  assert.equal(checkOf(report, 'BAL-01').passed, true);
  assert.equal(checkOf(report, 'BAL-02').passed, true);
  assert.equal(checkOf(report, 'BAL-09').passed, true);
  for (const id of ['BAL-03', 'BAL-04', 'BAL-05', 'BAL-08']) {
    assert.equal(checkOf(report, id).passed, false, `${id} must fail on an impossible equation`);
  }
  assert.equal(report.publishable, false);
  assert.match(checkOf(report, 'BAL-08').message, /nullspace dimension is 0/);
});

test('BAL-08: a non-unique equation fails as ambiguous', () => {
  const report = bal(ambiguousBalanceGen(), [AMBIGUOUS_SOURCE()]);
  assert.equal(checkOf(report, 'BAL-01').passed, true);
  assert.equal(checkOf(report, 'BAL-02').passed, true);
  const bal08 = checkOf(report, 'BAL-08');
  assert.equal(bal08.passed, false);
  assert.match(bal08.message, /ambiguous/);
  assert.match(bal08.message, /nullspace has dimension 2/);
  assert.equal(checkOf(report, 'BAL-03').passed, false);
  assert.equal(checkOf(report, 'BAL-05').passed, false);
  assert.match(checkOf(report, 'BAL-05').message, /The reaction equation could not be verified against the page/);
});

test('BAL-05: a unique solution with a coefficient above 12 fails alone', () => {
  const report = bal(bigCoefficientBalanceGen(), [BIG_COEFF_SOURCE()]);
  assert.deepEqual(failedIds(report), ['BAL-05'], report.checks.filter(c => !c.passed).map(c => c.message).join('\n'));
  assert.match(checkOf(report, 'BAL-05').message, /25/);
  assert.equal(checkOf(report, 'BAL-03').passed, true); // atom balance itself is exact
  assert.equal(checkOf(report, 'BAL-04').passed, true); // gcd is 1
  assert.equal(checkOf(report, 'BAL-08').passed, true); // nullspace dimension is 1
  const solution = deriveBalanceSolution(bigCoefficientBalanceGen());
  assert.equal(solution.status, 'unique');
  if (solution.status === 'unique') assert.deepEqual(solution.coefficients, [2, 25, 16, 18]);
});

test('BAL-06 is retired: reserved id, always passes', () => {
  const report = bal(golden());
  assert.equal(checkOf(report, 'BAL-06').passed, true);
  assert.match(checkOf(report, 'BAL-06').message, /retired/);
});

test('BAL-07: an off-page number in the hint fails alone', () => {
  const gen = clone(golden());
  gen.hint = 'Count all 987654 atoms on each side.';
  expectFailures(bal(gen), ['BAL-07']);
});

test('BAL-09: a fabricated species quote fails alone', () => {
  const gen = clone(golden());
  gen.species[0]!.quote = 'When methane burns in oxygen'; // drops "CH4" AND is not verbatim
  expectFailures(bal(gen), ['BAL-09']);
  // A verbatim quote that does not contain the species formula also fails:
  const g2 = clone(golden());
  g2.species[0]!.quote = 'Classroom methane burning shows atom conservation';
  const r2 = bal(g2);
  assert.ok(failedIds(r2).includes('BAL-09'));
  assert.match(checkOf(r2, 'BAL-09').message, /does not appear in its quote/);
});

test('groups: a Ca(OH)2 reaction validates end to end', () => {
  const text = 'Slaking lime. Calcium hydroxide Ca(OH)2 reacts with hydrochloric acid HCl. The page prints Ca(OH)2 + HCl \u2192 CaCl2 + H2O as written. The products are calcium chloride CaCl2 and water H2O.';
  const src = { id: 'chem-lime', title: 'Synthetic slaking paragraph', locator: 'synthetic:chem-lime', license: 'project-authored', attribution: 'Project-authored synthetic test source.', sha256: 'x', text };
  const gen: BalanceEquationGen = {
    schemaVersion: 'balance-equation-v1',
    title: 'Slaking lime balance',
    equationText: 'Ca(OH)2 + HCl \u2192 CaCl2 + H2O',
    sourceId: 'chem-lime',
    quote: 'The page prints Ca(OH)2 + HCl \u2192 CaCl2 + H2O as written',
    species: [
      { id: 'calcium-hydroxide', formula: 'Ca(OH)2', side: 'left', sourceId: 'chem-lime', quote: 'Calcium hydroxide Ca(OH)2 reacts with hydrochloric acid HCl' },
      { id: 'hydrochloric-acid', formula: 'HCl', side: 'left', sourceId: 'chem-lime', quote: 'Calcium hydroxide Ca(OH)2 reacts with hydrochloric acid HCl' },
      { id: 'calcium-chloride', formula: 'CaCl2', side: 'right', sourceId: 'chem-lime', quote: 'The products are calcium chloride CaCl2 and water H2O' },
      { id: 'water', formula: 'H2O', side: 'right', sourceId: 'chem-lime', quote: 'The products are calcium chloride CaCl2 and water H2O' },
    ],
    hint: 'Count the atoms on each side.',
  };
  const report = validateKitComponent('balance-equation-v1', gen, [src]);
  assert.deepEqual(failedIds(report), [], report.checks.filter(c => !c.passed).map(c => c.message).join('\n'));
  assert.match(checkOf(report, 'BAL-03').message, /\[1, 2, 1, 2\]/);
});

test('unicode subscripts and arrows in the printed equation are normalised (H\u2082 + O\u2082 \u27f6 H\u2082O)', () => {
  const text = 'Water forms from the elements. Hydrogen H2 combines with oxygen O2. The page prints H\u2082 + O\u2082 \u27f6 H\u2082O as written. Water H2O is the product.';
  const src = { id: 'chem-water', title: 'Synthetic water paragraph', locator: 'synthetic:chem-water', license: 'project-authored', attribution: 'Project-authored synthetic test source.', sha256: 'x', text };
  const gen: BalanceEquationGen = {
    schemaVersion: 'balance-equation-v1',
    title: 'Water formation balance',
    equationText: 'H\u2082 + O\u2082 \u27f6 H\u2082O',
    sourceId: 'chem-water',
    quote: 'The page prints H\u2082 + O\u2082 \u27f6 H\u2082O as written',
    species: [
      { id: 'hydrogen', formula: 'H2', side: 'left', sourceId: 'chem-water', quote: 'Hydrogen H2 combines with oxygen O2' },
      { id: 'oxygen', formula: 'O2', side: 'left', sourceId: 'chem-water', quote: 'Hydrogen H2 combines with oxygen O2' },
      { id: 'water', formula: 'H2O', side: 'right', sourceId: 'chem-water', quote: 'Water H2O is the product' },
    ],
    hint: 'Count the atoms on each side.',
  };
  const report = validateKitComponent('balance-equation-v1', gen, [src]);
  assert.deepEqual(failedIds(report), [], report.checks.filter(c => !c.passed).map(c => c.message).join('\n'));
  assert.match(checkOf(report, 'BAL-03').message, /\[2, 1, 2\]/);
});

test('state symbols are stripped and not verified', () => {
  const gen = clone(golden());
  gen.species[3]!.formula = 'H2O(l)';
  // The species formula with a state symbol still parses; the split comparison normalises it away.
  const solution = deriveBalanceSolution(gen);
  assert.equal(solution.status, 'unique');
  if (solution.status === 'unique') assert.deepEqual(solution.coefficients, [1, 2, 1, 2]);
});
