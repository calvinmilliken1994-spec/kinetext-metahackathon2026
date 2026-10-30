// Typeset formulas (Stage 7 view fixes): the formula explorer's main display is built from the PARSED expression (the
// validator's own parser, packages/validation/expression.ts) with the page's symbols typeset — 'Cd' as C with subscript d,
// 'rho' as ρ, powers as superscripts, '*' as '·' and a top-level division as a stacked fraction. The page's own line is
// still shown verbatim beside it as a quote; this module never reads the page line's right-hand side.
//
// Pieces reuse the live equation's EqPiece (lib/equation.ts) plus one extra kind, a fraction. No math library.

import { parseExpression } from '../../../../packages/validation/expression.ts';
import type { AstNode } from '../../../../packages/validation/expression.ts';
import type { EqPiece } from './equation.ts';
import { sig6 } from './explorer.ts';

export type TsPiece = EqPiece | { k: 'frac'; num: TsPiece[]; den: TsPiece[] };

const MINUS = '−';
const t = (v: string): EqPiece => ({ k: 'text', v });
const sym = (v: string, sub?: string): EqPiece => (sub === undefined || sub === '' ? { k: 'sym', v } : { k: 'sym', v, sub });

// ---- page symbols ------------------------------------------------------------------------------------------------------

const GREEK: Readonly<Record<string, string>> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', iota: 'ι', kappa: 'κ',
  lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', omicron: 'ο', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'φ',
  chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
};

const greek = (s: string): string => GREEK[s] ?? s;

/**
 * A page symbol as typeset: 'Cd' → C with subscript d (only C and K take a lowercase subscript, as in Cd, Cl, Kp, Ksp),
 * 'rho' → ρ, 'V0' → V with subscript 0, 'y_max' → y with subscript max. Anything else symbol-like is kept as written; text
 * with spaces (a description, not a symbol) gives null.
 */
export function pageSymbolPiece(symbol: string): EqPiece | null {
  const s = symbol.trim();
  if (s === '' || s.length > 12 || !/^[\p{L}][\p{L}\p{N}_]*$/u.test(s)) return null;
  const us = s.indexOf('_');
  if (us > 0) return sym(greek(s.slice(0, us)), s.slice(us + 1).replace(/_/g, ' '));
  const digits = /^(\p{L}+?)(\d+)$/u.exec(s);
  if (digits !== null) {
    const base = digits[1] as string;
    if (base.length === 1 || GREEK[base] !== undefined) return sym(greek(base), digits[2]);
  }
  if (GREEK[s] !== undefined) return sym(greek(s));
  const ck = /^([CK])([a-z]{1,3})$/.exec(s);
  if (ck !== null) return sym(ck[1] as string, ck[2]);
  return sym(s);
}

/** Each variable's typeset page symbol (its name when the page symbol is not symbol-like). */
export function symbolPieces(variables: readonly { name: string; pageSymbol: string }[]): Record<string, EqPiece> {
  return Object.fromEntries(variables.map((v) => [v.name, pageSymbolPiece(v.pageSymbol) ?? sym(v.name)]));
}

/** The result's name from the left of the page formula ('D = …' → D, 'y_max = …' → y with subscript max); null without one. */
export function formulaLhs(formulaText: string): EqPiece[] | null {
  const eq = formulaText.indexOf('=');
  if (eq < 0) return null;
  const piece = pageSymbolPiece(formulaText.slice(0, eq));
  return piece === null ? null : [piece];
}

// ---- the expression ----------------------------------------------------------------------------------------------------

const PREC: Readonly<Record<string, number>> = { '+': 1, '-': 1, '*': 2, '/': 2, neg: 3, '^': 4 };
const ATOM = 9;
const OP_TEXT: Readonly<Record<string, string>> = { '+': ' + ', '-': ` ${MINUS} `, '*': ' · ', '/': ' / ' };
const wrap = (pieces: TsPiece[], yes: boolean): TsPiece[] => (yes ? [t('('), ...pieces, t(')')] : pieces);

/** How tightly a node binds when shown; a stacked fraction is grouped by its bar, so it binds like an atom. */
function precOf(node: AstNode, inline: boolean): number {
  if (node.kind === 'bin') return node.op === '/' && !inline ? ATOM : (PREC[node.op] as number);
  if (node.kind === 'neg') return PREC['neg'] as number;
  if (node.kind === 'num' && node.value < 0) return PREC['neg'] as number;
  return ATOM;
}

/**
 * `inline` = no stacked fractions (inside an exponent, a function's brackets or a fraction's own numerator/denominator, where
 * a second bar would shrink the type): division is then written ' / ' with the brackets it needs.
 */
function render(node: AstNode, symbols: Readonly<Record<string, EqPiece>>, inline: boolean): TsPiece[] {
  const r = (n: AstNode, inl = inline): TsPiece[] => render(n, symbols, inl);
  switch (node.kind) {
    case 'num': return [{ k: 'num', v: sig6(node.value).replace(/^-/, MINUS) }];
    case 'const': return [sym(node.name === 'pi' ? 'π' : 'e')];
    case 'var': return [symbols[node.name] ?? sym(node.name)];
    case 'neg': return [t(MINUS), ...wrap(r(node.operand), precOf(node.operand, inline) < (PREC['neg'] as number))];
    case 'call': return [t(`${node.fn === 'sqrt' ? '√' : node.fn}(`), ...r(node.arg, true), t(')')];
    case 'bin': {
      if (node.op === '^') {
        const baseAtom = node.left.kind === 'var' || node.left.kind === 'const' || (node.left.kind === 'num' && node.left.value >= 0);
        return [...wrap(r(node.left), !baseAtom), { k: 'sup', v: r(node.right, true) as EqPiece[] }];
      }
      if (node.op === '/' && !inline) return [{ k: 'frac', num: r(node.left, true), den: r(node.right, true) }];
      const p = PREC[node.op] as number;
      const left = wrap(r(node.left), precOf(node.left, inline) < p);
      const rightPrec = precOf(node.right, inline);
      const right = wrap(r(node.right), rightPrec < p || (rightPrec === p && (node.op === '-' || node.op === '/')));
      return [...left, t(OP_TEXT[node.op] as string), ...right];
    }
  }
}

export interface TypesetFormula {
  /** The result's name from the page formula's left side; null when it has none. */
  lhs: EqPiece[] | null;
  rhs: TsPiece[];
}

/**
 * The formula explorer's main display: the stored expression (as the validator parses it) with the page's symbols typeset.
 * Null when the expression does not parse; the view then shows the page's line alone.
 */
export function typesetFormula(spec: { formulaText: string; expression: string; variables: readonly { name: string; pageSymbol: string }[] }): TypesetFormula | null {
  const parsed = parseExpression(spec.expression, { knownVariables: spec.variables.map((v) => v.name) });
  if (!parsed.ok) return null;
  return { lhs: formulaLhs(spec.formulaText), rhs: render(parsed.ast, symbolPieces(spec.variables), false) };
}

// ---- text form (screen readers, tests) -----------------------------------------------------------------------------------

const SUPER: Readonly<Record<string, string>> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };

/** 'D = (C_d · ρ · V² · A) / 2': subscripts after '_', digit powers as superscripts, a fraction as '(num) / den'. */
export function tsText(pieces: readonly TsPiece[]): string {
  return pieces.map((p): string => {
    switch (p.k) {
      case 'text': case 'num': return p.v;
      case 'sym': return p.sub === undefined ? p.v : `${p.v}_${p.sub}`;
      case 'sup': {
        const inner = tsText(p.v);
        return /^\d+$/.test(inner) ? Array.from(inner, (c) => SUPER[c] as string).join('') : `^(${inner})`;
      }
      case 'frac': {
        const group = (s: string): string => (/\s/.test(s) ? `(${s})` : s);
        return `${group(tsText(p.num))} / ${group(tsText(p.den))}`;
      }
    }
  }).join('');
}
