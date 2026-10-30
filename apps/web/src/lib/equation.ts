// Live substituted equations (Stage 7 item 3): the engine's formula, the same formula with the current slider values put
// in, and the result. Templates are code-owned (one per engine); the RESULT is always the engine's own output
// (engineOutput, the code the validator ran), never recomputed here. The formula explorer renders its stored expression
// from the validator's parser (packages/validation/expression.ts) with the current values substituted.
//
// Pieces are plain text with superscripts / subscripts, rendered as HTML <sup>/<sub> (no math library).

import type { EngineId } from '../../../../packages/contracts/index.ts';
import { parseExpression } from '../../../../packages/validation/expression.ts';
import type { AstNode } from '../../../../packages/validation/expression.ts';
import { formatUSD } from './compound.ts';
import { engineOutput, formatOutputValue, formatWithUnit, outputInfo } from './engines.ts';
import { groupedSig6, sig6 } from './explorer.ts';
import { groupThousands } from './displayText.ts';
import { readableNumber } from './format.ts';
import { CONCEALED } from './reveal.ts';

export type EqPiece =
  | { k: 'text'; v: string }
  /** A symbol, optionally with a subscript: V0, y_max, C_l. */
  | { k: 'sym'; v: string; sub?: string }
  /** A number put in for a symbol. */
  | { k: 'num'; v: string }
  | { k: 'sup'; v: EqPiece[] };

export interface Equation {
  lhs: EqPiece[];
  symbolic: EqPiece[];
  substituted: EqPiece[];
  /** The result as shown, with its unit ('69.444 m', '$1,647.01', 'not defined'). */
  result: string;
  /** The engine / calculator value behind `result`. */
  value: number;
}

// ---- piece builders --------------------------------------------------------------------------------------------------

const t = (v: string): EqPiece => ({ k: 'text', v });
const sym = (v: string, sub?: string): EqPiece => (sub === undefined ? { k: 'sym', v } : { k: 'sym', v, sub });
const sup = (...v: EqPiece[]): EqPiece => ({ k: 'sup', v });
const MINUS = '−';
const dot = t(' · ');

/** A number as the sliders show it; a negative one is bracketed so '½ · (−0.2)' and '(−3)²' read right. */
function num(n: number, format: (n: number) => string = readableNumber): EqPiece {
  const s = groupThousands(format(n)).replace(/^-/, MINUS);
  return { k: 'num', v: s.startsWith(MINUS) ? `(${s})` : s };
}

// ---- text form (tests, aria labels) ---------------------------------------------------------------------------------

const SUPER: Readonly<Record<string, string>> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };

export function piecesText(pieces: readonly EqPiece[]): string {
  return pieces.map((p) => {
    switch (p.k) {
      case 'text': case 'num': return p.v;
      case 'sym': return p.sub === undefined ? p.v : /^\d+$/.test(p.sub) ? `${p.v}${p.sub}` : `${p.v}_${p.sub}`;
      case 'sup': {
        const inner = piecesText(p.v);
        return /^\d$/.test(inner) ? SUPER[inner] as string : `^(${inner})`;
      }
    }
  }).join('');
}

/** 'y_max = V0² / (2 · g) = 15² / (2 · 1.62) = 69.444 m'; concealed → '… = ?'. */
export function equationText(eq: Equation, concealed = false): string {
  return `${piecesText(eq.lhs)} = ${piecesText(eq.symbolic)} = ${piecesText(eq.substituted)} = ${concealed ? CONCEALED : eq.result}`;
}

// ---- engine templates --------------------------------------------------------------------------------------------------

type Template = { lhs: EqPiece[]; build: (v: (key: string) => EqPiece | null, s: boolean) => EqPiece[] | null };

/** `s` = symbolic: each builder returns the symbol when s is true, else the number. */
const TEMPLATES: Readonly<Record<EngineId, Template>> = {
  'forces-1d-v1': {
    lhs: [sym('a')],
    build: (v, s) => {
      const f = s ? sym('F', 'net') : v('netForceN');
      const m = s ? sym('m') : v('massKg');
      return f === null || m === null ? null : [f, t(' / '), m];
    },
  },
  'projectile-v1': {
    lhs: [sym('y', 'max')],
    build: (v, s) => {
      const v0 = s ? sym('V', '0') : v('verticalSpeedMps');
      const g = s ? sym('g') : v('gravityMps2');
      return v0 === null || g === null ? null : [v0, sup(t('2')), t(' / (2 · '), g, t(')')];
    },
  },
  'lift-equation-v1': {
    lhs: [sym('L')],
    build: (v, s) => {
      const parts = s
        ? [sym('C', 'l'), sym('ρ'), sym('V'), sym('A')]
        : [v('liftCoefficient'), v('airDensityKgM3'), v('airspeedMps'), v('wingAreaM2')];
      if (parts.some((p) => p === null)) return null;
      const [cl, rho, vel, area] = parts as EqPiece[];
      return [t('½'), dot, cl as EqPiece, dot, rho as EqPiece, dot, vel as EqPiece, sup(t('2')), dot, area as EqPiece];
    },
  },
  'speed-of-sound-v1': {
    lhs: [sym('a')],
    build: (v, s) => {
      const parts = s ? [sym('γ'), sym('R'), sym('T')] : [v('gamma'), v('gasConstantJPerKgK'), v('temperatureK')];
      if (parts.some((p) => p === null)) return null;
      const [g, r, temp] = parts as EqPiece[];
      return [t('√('), g as EqPiece, dot, r as EqPiece, dot, temp as EqPiece, t(')')];
    },
  },
  'compound-interest-v1': {
    lhs: [sym('A')],
    build: (v, s) => {
      const parts = s ? [sym('P'), sym('r'), sym('n'), sym('n'), sym('t')] : [v('principalUSD'), v('annualRatePercent'), v('compoundsPerYear'), v('compoundsPerYear'), v('years')];
      if (parts.some((p) => p === null)) return null;
      const [p, r, n, n2, yrs] = parts as EqPiece[];
      return [p as EqPiece, t(' · (1 + '), r as EqPiece, t(' / (100 · '), n as EqPiece, t('))'), sup(n2 as EqPiece, dot, yrs as EqPiece)];
    },
  },
  'hardy-weinberg-v1': {
    lhs: [t('2pq')],
    build: (v, s) => {
      const p = s ? sym('p') : v('alleleFrequencyP');
      return p === null ? null : [t('2 · '), p, t(` · (1 ${MINUS} `), p, t(')')];
    },
  },
  'half-life-v1': {
    lhs: [sym('N')],
    build: (v, s) => {
      const parts = s ? [sym('N', '0'), sym('t'), sym('T')] : [v('initialAmount'), v('elapsedTime'), v('halfLife')];
      if (parts.some((p) => p === null)) return null;
      const [n0, el, hl] = parts as EqPiece[];
      return [n0 as EqPiece, t(' · (½)'), sup(el as EqPiece, t(' / '), hl as EqPiece)];
    },
  },
};

/** How an input is written when substituted: money as dollars, everything else as the slider shows it. */
function inputFormat(engine: EngineId, key: string): (n: number) => string {
  return engine === 'compound-interest-v1' && key === 'principalUSD' ? formatUSD : readableNumber;
}

/** The result with its unit, in the readout format (dollars for compound interest). */
function resultText(engine: EngineId, value: number): string {
  const shown = engine === 'compound-interest-v1'
    ? formatUSD(value)
    : formatWithUnit(value, outputInfo(engine).unit, (n) => formatOutputValue(engine, n));
  return shown.replace(/^-/, MINUS);
}

/** The engine's equation with `inputs` put in, and the engine's own result; null when the engine rejects the inputs. */
export function engineEquation(engine: EngineId, inputs: Readonly<Record<string, number>>): Equation | null {
  const value = engineOutput(engine, inputs as Record<string, number>);
  if (value === null) return null;
  const tpl = TEMPLATES[engine];
  const pick = (key: string): EqPiece | null => {
    const n = inputs[key];
    return typeof n === 'number' && Number.isFinite(n) ? num(n, inputFormat(engine, key)) : null;
  };
  const symbolic = tpl.build(pick, true);
  const substituted = tpl.build(pick, false);
  if (symbolic === null || substituted === null) return null;
  return { lhs: tpl.lhs, symbolic, substituted, result: resultText(engine, value), value };
}

// ---- formula explorer: the parsed expression ---------------------------------------------------------------------------

const PREC: Readonly<Record<string, number>> = { '+': 1, '-': 1, '*': 2, '/': 2, neg: 3, '^': 4 };
const OP_TEXT: Readonly<Record<string, string>> = { '+': ' + ', '-': ` ${MINUS} `, '*': ' · ', '/': ' / ' };

function precOf(node: AstNode, values: Readonly<Record<string, number>> | null): number {
  if (node.kind === 'bin') return PREC[node.op] as number;
  if (node.kind === 'neg') return PREC['neg'] as number;
  // A negative number put in for a variable is bracketed by num(), so it binds like an atom.
  if (node.kind === 'num' && node.value < 0) return PREC['neg'] as number;
  void values;
  return 9;
}

const wrap = (pieces: EqPiece[], yes: boolean): EqPiece[] => (yes ? [t('('), ...pieces, t(')')] : pieces);

/** Render an AST: symbols when `values` is null, else every variable replaced by its value. Brackets only where needed. */
function renderAst(node: AstNode, values: Readonly<Record<string, number>> | null, symbols: Readonly<Record<string, EqPiece>>): EqPiece[] {
  const r = (n: AstNode): EqPiece[] => renderAst(n, values, symbols);
  switch (node.kind) {
    case 'num': return [{ k: 'num', v: sig6(node.value).replace(/^-/, MINUS) }];
    case 'const': return [sym(node.name === 'pi' ? 'π' : 'e')];
    case 'var': {
      if (values === null) return [symbols[node.name] ?? sym(node.name)];
      const v = values[node.name];
      return [num(typeof v === 'number' ? v : Number.NaN, sig6)];
    }
    case 'neg': return [t(MINUS), ...wrap(r(node.operand), precOf(node.operand, values) < PREC['neg']!)];
    case 'call': {
      const name = node.fn === 'sqrt' ? '√' : node.fn;
      return [t(`${name}(`), ...r(node.arg), t(')')];
    }
    case 'bin': {
      const p = PREC[node.op] as number;
      if (node.op === '^') {
        // Base bracketed unless it is an atom; the exponent sits in a superscript, so it needs no brackets.
        const baseAtom = node.left.kind === 'var' || node.left.kind === 'const' || (node.left.kind === 'num' && node.left.value >= 0);
        return [...wrap(r(node.left), !baseAtom), sup(...r(node.right))];
      }
      const left = wrap(r(node.left), precOf(node.left, values) < p);
      // Right operand of − and / binds tighter: a − (b − c), a / (b · c).
      const rightPrec = precOf(node.right, values);
      const right = wrap(r(node.right), rightPrec < p || (rightPrec === p && (node.op === '-' || node.op === '/')));
      return [...left, t(OP_TEXT[node.op] as string), ...right];
    }
  }
}

/**
 * The explorer's formula: `lhs = <expression> = <expression with the current values> = output` (sig6, 'not defined'
 * when the calculator has no value). `output` comes from the explorer's own evaluator. Null when the stored expression
 * does not parse with the validator's parser. `lhs` is the result's name (text, or typeset pieces from lib/typeset.ts);
 * `symbols` are the typeset page symbols per variable (lib/typeset.ts symbolPieces), else the variable names are shown.
 */
export function explorerEquation(
  expression: string,
  variables: readonly string[],
  lhs: string | readonly EqPiece[],
  inputs: Readonly<Record<string, number>>,
  output: number,
  symbols: Readonly<Record<string, EqPiece>> = {},
): Equation | null {
  const parsed = parseExpression(expression, { knownVariables: variables });
  if (!parsed.ok) return null;
  return {
    lhs: typeof lhs === 'string' ? [sym(lhs)] : [...lhs],
    symbolic: renderAst(parsed.ast, null, symbols),
    substituted: renderAst(parsed.ast, inputs, symbols),
    result: groupedSig6(output).replace(/^-/, MINUS),
    value: output,
  };
}
