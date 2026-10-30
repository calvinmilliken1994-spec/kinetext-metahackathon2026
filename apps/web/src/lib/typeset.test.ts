/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { formulaLhs, pageSymbolPiece, symbolPieces, typesetFormula, tsText } from './typeset.ts';
import { explorerEquation, equationText } from './equation.ts';

const DRAG = {
  formulaText: 'D = Cd * (rho * V^2 * A) / 2',
  expression: 'cd * (rho * v^2 * area) / 2',
  variables: [
    { name: 'cd', pageSymbol: 'Cd' },
    { name: 'rho', pageSymbol: 'rho' },
    { name: 'v', pageSymbol: 'V' },
    { name: 'area', pageSymbol: 'A' },
  ],
};

test('page symbols are typeset: Cd → C with subscript d, rho → ρ, V0 → V with subscript 0, y_max → y with subscript max', () => {
  assert.deepEqual(pageSymbolPiece('Cd'), { k: 'sym', v: 'C', sub: 'd' });
  assert.deepEqual(pageSymbolPiece('Cl'), { k: 'sym', v: 'C', sub: 'l' });
  assert.deepEqual(pageSymbolPiece('rho'), { k: 'sym', v: 'ρ' });
  assert.deepEqual(pageSymbolPiece('ρ'), { k: 'sym', v: 'ρ' });
  assert.deepEqual(pageSymbolPiece('Delta'), { k: 'sym', v: 'Δ' });
  assert.deepEqual(pageSymbolPiece('gamma'), { k: 'sym', v: 'γ' });
  assert.deepEqual(pageSymbolPiece('V0'), { k: 'sym', v: 'V', sub: '0' });
  assert.deepEqual(pageSymbolPiece('y_max'), { k: 'sym', v: 'y', sub: 'max' });
  assert.deepEqual(pageSymbolPiece('rho_0'), { k: 'sym', v: 'ρ', sub: '0' });
  assert.deepEqual(pageSymbolPiece('V'), { k: 'sym', v: 'V' });
  assert.deepEqual(pageSymbolPiece('Ksp'), { k: 'sym', v: 'K', sub: 'sp' });
});

test('a page symbol that is not symbol-like is kept as written (no invented subscripts)', () => {
  assert.deepEqual(pageSymbolPiece('Re'), { k: 'sym', v: 'Re' }, 'only C and K take a lowercase subscript (Cd, Kp); Re stays Re');
  assert.deepEqual(pageSymbolPiece('area'), { k: 'sym', v: 'area' });
  assert.equal(pageSymbolPiece('drag coefficient'), null, 'words with a space are not a symbol');
  assert.equal(pageSymbolPiece(''), null);
});

test('symbolPieces maps every variable to its typeset page symbol, falling back to the variable name', () => {
  const s = symbolPieces([{ name: 'cd', pageSymbol: 'Cd' }, { name: 'x', pageSymbol: 'the distance travelled' }]);
  assert.deepEqual(s['cd'], { k: 'sym', v: 'C', sub: 'd' });
  assert.deepEqual(s['x'], { k: 'sym', v: 'x' });
});

test('the result name comes from the left side of the page formula', () => {
  assert.deepEqual(formulaLhs('D = Cd * (rho * V^2 * A) / 2'), [{ k: 'sym', v: 'D' }]);
  assert.deepEqual(formulaLhs('y_max = V0^2 / (2*g)'), [{ k: 'sym', v: 'y', sub: 'max' }]);
  assert.equal(formulaLhs('Cd * (rho * V^2 * A) / 2'), null, 'no "=" → no result name');
  assert.equal(formulaLhs('the drag force = Cd * A'), null, 'words on the left are not a symbol');
});

test('Drag: the typeset formula is D = C_d · ρ · V² · A over 2, built from the parsed expression', () => {
  const f = typesetFormula(DRAG);
  assert.ok(f);
  assert.deepEqual(f.lhs, [{ k: 'sym', v: 'D' }]);
  assert.equal(f.rhs.length, 1);
  const frac = f.rhs[0];
  assert.ok(frac !== undefined && frac.k === 'frac', 'a top-level division is a stacked fraction');
  assert.equal(tsText(frac.num), 'C_d · ρ · V² · A', 'the fraction bar groups the numerator: the page brackets are not needed');
  assert.equal(tsText(frac.den), '2');
  assert.equal(tsText(f.lhs) + ' = ' + tsText(f.rhs), 'D = (C_d · ρ · V² · A) / 2');
});

test('fractions stay inline inside a superscript and keep the brackets they need', () => {
  const f = typesetFormula({ formulaText: 'N = N0 * exp(-t / tau)', expression: 'n0 * exp(-t / tau)', variables: [{ name: 'n0', pageSymbol: 'N0' }, { name: 't', pageSymbol: 't' }, { name: 'tau', pageSymbol: 'tau' }] });
  assert.ok(f);
  assert.equal(tsText(f.rhs), 'N_0 · exp(−t / τ)', 'a division inside a function argument stays inline');
  assert.ok(!JSON.stringify(f.rhs).includes('"frac"'));
  const p = typesetFormula({ formulaText: 'y = a^(b / c)', expression: 'a^(b / c)', variables: [{ name: 'a', pageSymbol: 'a' }, { name: 'b', pageSymbol: 'b' }, { name: 'c', pageSymbol: 'c' }] });
  assert.ok(p);
  assert.equal(tsText(p.rhs), 'a^(b / c)', 'no stacked fraction inside an exponent');
  assert.ok(!JSON.stringify(p.rhs).includes('"frac"'));
});

test('sums keep their brackets next to a product, and a sum over a number becomes a fraction', () => {
  const f = typesetFormula({ formulaText: 'm = (a + b) * c / 2', expression: '(a + b) * c / 2', variables: [{ name: 'a', pageSymbol: 'a' }, { name: 'b', pageSymbol: 'b' }, { name: 'c', pageSymbol: 'c' }] });
  assert.ok(f);
  const frac = f.rhs[0];
  assert.ok(frac !== undefined && frac.k === 'frac');
  assert.equal(tsText(frac.num), '(a + b) · c');
  const g = typesetFormula({ formulaText: 'v = sqrt(2 * g * h)', expression: 'sqrt(2 * g * h)', variables: [{ name: 'g', pageSymbol: 'g' }, { name: 'h', pageSymbol: 'h' }] });
  assert.ok(g);
  assert.equal(tsText(g.rhs), '√(2 · g · h)');
  const pi = typesetFormula({ formulaText: 'A = pi * r^2', expression: 'pi * r^2', variables: [{ name: 'r', pageSymbol: 'r' }] });
  assert.ok(pi);
  assert.equal(tsText(pi.rhs), 'π · r²');
});

test('an expression that does not parse gives no typeset formula (the view keeps the page line only)', () => {
  assert.equal(typesetFormula({ ...DRAG, expression: '2x' }), null);
});

test('the live equation uses the page symbols too: D = C_d · ρ · V² · A / 2 = 0.5 · 1.2 · 50² · 1 / 2 = 750', () => {
  const eq = explorerEquation(DRAG.expression, ['cd', 'rho', 'v', 'area'], 'D', { cd: 0.5, rho: 1.2, v: 50, area: 1 }, 750, symbolPieces(DRAG.variables));
  assert.ok(eq);
  assert.equal(equationText(eq), 'D = C_d · ρ · V² · A / 2 = 0.5 · 1.2 · 50² · 1 / 2 = 750');
});
