// Plan-time pre-check for balance-equation-v1: the planned focus quote must hold one printed reaction the balancer can
// handle (exactly one arrow, every species a neutral formula). Found on job-20261031111156-12c77646: Spark Open planned
// the part for "H2O = H^+ + OH^-." (no arrow, charged ions), so three paid generation/repair calls could never pass.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { balancePlanProblem, validateAnalysisV2 } from './analysis-v2.ts';
import { checkOf, clone, dragSource, usableAnalysis } from './fixtures/stage6.ts';

// Every focus quote of a balance plan that later passed, from stored runs (replayed 2026-11-01).
const PASSED_QUOTES = ['6CO2 + 6H2O → C6H12O6 + 6O2', 'CO2 + 4H2S + O2 → CH2O + 4S + 3H2O'];

test('stored balance plans that passed still pass the pre-check', () => {
  for (const q of PASSED_QUOTES) assert.equal(balancePlanProblem(q), null, q);
});

test('the failed Spark Open plan is caught: "=" is not a reaction arrow and the ions carry charges', () => {
  const p = balancePlanProblem('H2O = H^+ + OH^-.');
  assert.ok(p !== null);
  assert.match(p, /no reaction arrow/);
});

test('a reaction with an arrow but charged species is caught', () => {
  const p = balancePlanProblem('Fe → Fe3+ + 3e-');
  assert.ok(p !== null);
  assert.match(p, /charge/);
  assert.ok(balancePlanProblem('H2O → H+ + OH-') !== null);
});

test('an equation inside a sentence is found; prose with no equation is caught', () => {
  assert.equal(balancePlanProblem('The overall reaction is 2H2 + O2 → 2H2O, releasing energy.'), null);
  assert.equal(balancePlanProblem('Photosynthesis: 6CO2 + 6H2O → C6H12O6 + 6O2.'), null);
  assert.ok(balancePlanProblem('Plants turn carbon dioxide and water into sugar.') !== null);
  assert.ok(balancePlanProblem('A → B → C') !== null, 'two arrows');
});

test('A-08 fails a plan that names balance-equation-v1 for an unbalanceable quote, pointing at that entry', () => {
  const a = clone(usableAnalysis());
  a.componentPlan[1]!.componentId = 'balance-equation-v1';
  a.componentPlan[1]!.focusQuote = 'H2O = H^+ + OH^-.';
  const a08 = checkOf(validateAnalysisV2(a, [dragSource()]), 'A-08');
  assert.equal(a08.passed, false);
  assert.match(a08.message, /balance-equation-v1/);
  assert.ok((a08.affected ?? []).includes('/componentPlan/1/componentId'), (a08.affected ?? []).join(', '));
});

test('A-08 leaves a balanceable balance plan alone (no new failure from this rule)', () => {
  const a = clone(usableAnalysis());
  a.componentPlan[1]!.componentId = 'balance-equation-v1';
  a.componentPlan[1]!.focusQuote = '2H2 + O2 → 2H2O';
  const a08 = checkOf(validateAnalysisV2(a, [dragSource()]), 'A-08');
  assert.doesNotMatch(a08.message, /balance-equation-v1 needs/);
});
