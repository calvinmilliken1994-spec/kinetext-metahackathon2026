// S6-W fix — deterministic formula-expression normaliser (our code, never AI).
//
// Live evidence (docs/evidence/stage-6/evaluation-lesson-open): Muse Spark Open wrote whole
// equations into the formula-explorer `expression` field — `v = a * t`, `t = 59 - .00356 * h`,
// `D = cd * (rho * v^2 * a) / 2` — and the frozen calculator grammar rejects any '='
// (FE-02/FE-08: unexpected character "="), so those parts were lost and repairs did not fix
// them. This module strips a leading `<identifier> =` from such an expression BEFORE
// validation. Nothing else is altered (variables, formulaText, quote untouched), and
// FE-02/FE-08 still run on the result, so a WRONG formula still fails.
//
// The rule (frozen by the task brief):
//   - the expression contains EXACTLY one '=' that is not part of '==', '<=', '>=' or '!=';
//   - the trimmed left side is a single identifier. The grammar's identifier form is
//     `[a-z][a-z0-9_]*`; models write the page's left-hand symbol (`D = …`), and the
//     stripped name never reaches the grammar, so capitalised identifiers are accepted too;
//   - the trimmed right side is non-empty.
//   Otherwise the expression is returned unchanged.
//
// Honest persistence: the caller stores the NORMALISED gen and records `normalisedFrom`
// (the original expression) beside it, plus a plain-words event detail line.
import type { FormulaExplorerGen } from '../../packages/contracts/kit.ts';

/**
 * Identifier shape for the stripped left-hand side: the grammar's `[a-z][a-z0-9_]*` plus
 * capitalised page symbols (`D`, `Cd`), which models copy from the page's equation. The
 * lhs is discarded, so the wider form can never let a bad character into the grammar.
 */
const IDENTIFIER_RE = /^[A-Za-z][A-Za-z0-9_]*$/;

export interface FormulaExpressionNormalisation {
  /** The expression to validate: the trimmed rhs when stripped, else the input unchanged. */
  expression: string;
  /** The ORIGINAL expression when (and only when) it was rewritten; else null. */
  normalisedFrom: string | null;
  /** The stripped left-hand identifier (e.g. 'v' of 'v = a * t'); else null. */
  strippedName: string | null;
}

/** Count '=' characters that are not part of '==', '<=', '>=' or '!='; return the sole index or -1. */
function soleStandaloneEquals(s: string): number {
  let found = -1;
  for (let i = 0; i < s.length; i += 1) {
    if (s[i] !== '=') {
      continue;
    }
    const prev = i > 0 ? s[i - 1] : '';
    const next = i + 1 < s.length ? s[i + 1] : '';
    if (prev === '=' || next === '=' || prev === '<' || prev === '>' || prev === '!') {
      continue; // part of '==', '<=', '>=' or '!='
    }
    if (found !== -1) {
      return -1; // a second standalone '=' — ambiguous, never touched
    }
    found = i;
  }
  return found;
}

/** Pure: strip a leading `<identifier> =` from a formula-explorer expression, else return it as-is. */
export function normaliseFormulaExpression(expression: string): FormulaExpressionNormalisation {
  const unchanged: FormulaExpressionNormalisation = { expression, normalisedFrom: null, strippedName: null };
  if (typeof expression !== 'string') {
    return unchanged;
  }
  const eq = soleStandaloneEquals(expression);
  if (eq === -1) {
    return unchanged;
  }
  const lhs = expression.slice(0, eq).trim();
  const rhs = expression.slice(eq + 1).trim();
  if (!IDENTIFIER_RE.test(lhs) || rhs === '') {
    return unchanged;
  }
  return { expression: rhs, normalisedFrom: expression, strippedName: lhs };
}

export interface FormulaGenNormalisation {
  /** A gen with the normalised expression (a shallow copy), or the SAME object when unchanged. */
  gen: FormulaExplorerGen;
  normalisedFrom: string | null;
  strippedName: string | null;
}

/** Pure gen-level wrapper: only `expression` is ever replaced; the input is never mutated. */
export function normaliseFormulaExplorerGen(gen: FormulaExplorerGen): FormulaGenNormalisation {
  if (typeof gen !== 'object' || gen === null || typeof gen.expression !== 'string') {
    return { gen, normalisedFrom: null, strippedName: null };
  }
  const n = normaliseFormulaExpression(gen.expression);
  if (n.normalisedFrom === null) {
    return { gen, normalisedFrom: null, strippedName: null };
  }
  return { gen: { ...gen, expression: n.expression }, normalisedFrom: n.normalisedFrom, strippedName: n.strippedName };
}

/** Plain-words event detail for a stripped expression (never shows the rhs or model text). */
export function formulaNormalisedNote(strippedName: string): string {
  return `expression tidied: removed "${strippedName} =" before checking`;
}
