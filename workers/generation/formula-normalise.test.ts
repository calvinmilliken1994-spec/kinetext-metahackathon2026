// S6-W fix — unit tests for the deterministic formula-expression normaliser.
// The frozen calculator grammar (packages/validation/expression.ts) rejects '=' outright
// (FE-02/FE-08: unexpected character "="), so a model writing the whole equation
// (`v = a * t`) lost the part even though the right-hand side was fine. The normaliser
// strips a leading `<identifier> =` BEFORE validation; everything else is left alone and
// FE-02/FE-08 still run on the result, so a wrong formula still fails.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formulaNormalisedNote,
  normaliseFormulaExplorerGen,
  normaliseFormulaExpression,
} from './formula-normalise.ts';
import type { FormulaExplorerGen } from '../../packages/contracts/kit.ts';

test('normalise: strips a leading "<name> =" and reports the original', () => {
  const a = normaliseFormulaExpression('v = a * t');
  assert.equal(a.expression, 'a * t');
  assert.equal(a.normalisedFrom, 'v = a * t');
  assert.equal(a.strippedName, 'v');

  const b = normaliseFormulaExpression('t = 59 - .00356 * h');
  assert.equal(b.expression, '59 - .00356 * h');
  assert.equal(b.normalisedFrom, 't = 59 - .00356 * h');
  assert.equal(b.strippedName, 't');
});

test('normalise: strips regardless of spacing, accepts grammar identifiers and page-symbol capitals', () => {
  assert.equal(normaliseFormulaExpression('v=a*t').expression, 'a*t');
  assert.equal(normaliseFormulaExpression('  cd_1  =  a + b ').expression, 'a + b');
  assert.equal(normaliseFormulaExpression('x2 = sqrt(y)').expression, 'sqrt(y)');
  // Models write the page's left-hand symbol (`D = cd * (rho * v^2 * a) / 2`); the
  // stripped name never reaches the grammar, so capitalised identifiers are accepted.
  const d = normaliseFormulaExpression('D = cd * (rho * v^2 * a) / 2');
  assert.equal(d.expression, 'cd * (rho * v^2 * a) / 2');
  assert.equal(d.normalisedFrom, 'D = cd * (rho * v^2 * a) / 2');
  assert.equal(d.strippedName, 'D');
});

test('normalise: leaves plain expressions and non-assignment "=" forms unchanged', () => {
  const unchanged = [
    'a * t', // no '=' at all
    'a == b', // '==' is not a single assignment '='
    'x <= y', // '<=' is not an assignment
    'x >= y',
    'v != x',
    '= a', // no identifier on the left
    'v = ', // empty rhs
    'v =',
    'v = a = b', // two standalone '=' — ambiguous, never touched
    '1v = a', // identifier must start with a letter
    'sqrt(x) = y', // lhs is not a bare identifier
    'v-1 = a', // lhs is not an identifier
  ];
  for (const s of unchanged) {
    const r = normaliseFormulaExpression(s);
    assert.equal(r.expression, s, `"${s}" must stay unchanged`);
    assert.equal(r.normalisedFrom, null);
    assert.equal(r.strippedName, null);
  }
  // The frozen rule is EXACTLY one standalone '=': it strips even when the rhs contains
  // a comparison-looking '=' pair; the result then still has to survive FE-02 on its own.
  const edge = normaliseFormulaExpression('v = a <= b');
  assert.equal(edge.expression, 'a <= b');
  assert.equal(edge.normalisedFrom, 'v = a <= b');
});

test('normalise: the gen-level helper only replaces expression and never mutates its input', () => {
  const gen: FormulaExplorerGen = {
    schemaVersion: 'formula-explorer-v1',
    title: 'Drag equation explorer',
    formulaText: 'D = Cd * (rho * V^2 * A) / 2',
    sourceId: 'nasa-grc-drag-equation',
    quote: 'D = Cd * (rho * V^2 * A) / 2',
    expression: 'D = cd * (rho * v^2 * a) / 2',
    variables: [],
    xVariable: 'v',
    cases: [],
    sourceExample: { quote: '', resultNumber: 0, tolerance: 0 },
    hasSourceExample: false,
  };
  const before = structuredClone(gen);
  const r = normaliseFormulaExplorerGen(gen);
  assert.deepEqual(gen, before, 'input gen is never mutated');
  assert.equal(r.gen.expression, 'cd * (rho * v^2 * a) / 2');
  assert.equal(r.normalisedFrom, 'D = cd * (rho * v^2 * a) / 2');
  assert.equal(r.strippedName, 'D'); // the raw lhs identifier as written
  // Everything except expression is untouched.
  assert.equal(r.gen.formulaText, gen.formulaText);
  assert.equal(r.gen.quote, gen.quote);
  assert.equal(r.gen.title, gen.title);
  assert.deepEqual(r.gen.variables, gen.variables);

  // An unchanged expression returns the SAME object and null markers.
  const ok = normaliseFormulaExplorerGen({ ...gen, expression: 'cd * (rho * v^2 * a) / 2' });
  assert.equal(ok.gen.expression, 'cd * (rho * v^2 * a) / 2');
  assert.equal(ok.normalisedFrom, null);
  assert.equal(ok.strippedName, null);
});

test('normalise: the note is plain words and names the stripped prefix', () => {
  assert.equal(
    formulaNormalisedNote('v'),
    'expression tidied: removed "v =" before checking',
  );
});
