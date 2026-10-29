// S6-V — safe formula expression lexer/parser/evaluator for formula-explorer-v1.
//
// Implements the FROZEN grammar of docs/specs/STAGE-6-design.md §2.7(d) exactly:
//
//   Expr    := Term (("+"|"-") Term)*
//   Term    := Unary (("*"|"/") Unary)*
//   Unary   := "-" Unary | Power
//     Power := Primary ("^" Unary)?
//   Primary := Number | Variable | FuncCall | Constant | "(" Expr ")"
//
// `^` binds tighter than unary minus (-x^2 = -(x^2)), is right-associative
// (a^b^c = a^(b^c)) and accepts a unary right operand (2^-1). Functions are
// exactly sqrt|exp|log|sin|cos|tan (log = natural log, trig in radians);
// constants are exactly pi|e. NO eval/Function/require — evaluation walks the
// AST with IEEE-754 doubles and every domain error (÷0, sqrt(<0), log(<=0),
// 0^negative, |exponent| > 100, any non-finite intermediate) yields NaN, which
// the UI renders as "Not defined for these inputs".
//
// Lexer: longest match wins, so `1e5` is ONE Number while a bare `e` is the
// constant; `e5` lexes as the identifier e5 (an unknown variable — rejected at
// validation) and `1e` lexes as Number(1) followed by `e`, which the parser
// rejects as implicit multiplication. Identifiers are lowercase ASCII only.
//
// Normalisation (fixed, design §2.7d): `×·∙` → `*`, unicode minus → `-`,
// unicode superscripts → `^digits`, whitespace ignored. `**` → `^` is applied
// ONLY to page-formula text (FE-08); a generated `expression` field must be in
// final form and `**` there is rejected (FE-02), as is implicit multiplication
// everywhere (juxtaposition is a parse error).
//
// Nothing here throws at callers: parse failures are returned as
// { ok: false, error } results; evaluate() is total (returns NaN for domain
// errors). parseExpression() throws ExpressionParseError only through the
// helper `parseExpressionOrThrow`, kept for internal convenience.

import { FORMULA_CONSTANTS, FORMULA_FUNCTIONS, KIT_LIMITS } from '../contracts/kit.ts';

/* ------------------------------------------------------------------ */
/* Normalisation                                                       */
/* ------------------------------------------------------------------ */

const UNICODE_MINUS = /[\u2212\u2010\u2011]/g; // −, ‐, ‑ (NOT en/em dashes: prose punctuation)
const MULTIPLICATION = /[\u00d7\u00b7\u2219\u22c5]/g; // × · ∙ ⋅
const SUPERSCRIPT_MAP: Readonly<Record<string, string>> = {
  '\u2070': '0', '\u00b9': '1', '\u00b2': '2', '\u00b3': '3', '\u2074': '4',
  '\u2075': '5', '\u2076': '6', '\u2077': '7', '\u2078': '8', '\u2079': '9',
  '\u207b': '-', '\u207a': '+',
};
const SUPERSCRIPT_RUN = /[\u2070\u00b9\u00b2\u00b3\u2074\u2075\u2076\u2077\u2078\u2079\u207b\u207a]+/g;

function mapSuperscripts(s: string): string {
  return s.replace(SUPERSCRIPT_RUN, run => '^' + [...run].map(ch => SUPERSCRIPT_MAP[ch] ?? '').join(''));
}

/**
 * Fixed normalisation for a formula line QUOTED FROM THE PAGE (FE-08):
 * unicode multiplication dots → `*`, `**` → `^`, unicode minus → `-`,
 * superscript digit runs → `^digits`, all whitespace removed.
 */
export function normalizePageFormula(s: string): string {
  let out = s.replace(MULTIPLICATION, '*').replace(UNICODE_MINUS, '-');
  out = mapSuperscripts(out);
  out = out.replace(/\*\*/g, '^');
  return out.replace(/\s+/g, '');
}

/**
 * Fixed normalisation for the generated `expression` field: same unicode
 * mappings, but `**` is NOT rewritten — the final form must use `^`, so a
 * surviving `**` is a lex error (design: "`**` in final form rejected").
 */
export function normalizeExpression(s: string): string {
  let out = s.replace(MULTIPLICATION, '*').replace(UNICODE_MINUS, '-');
  out = mapSuperscripts(out);
  return out.replace(/\s+/g, '');
}

/* ------------------------------------------------------------------ */
/* Lexer                                                               */
/* ------------------------------------------------------------------ */

export type TokenType = 'number' | 'ident' | 'op' | 'lparen' | 'rparen' | 'comma';
export interface Token { type: TokenType; value: string; pos: number }

export class ExpressionParseError extends Error {}

const NUMBER_RE = /^(?:\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)/;
const IDENT_RE = /^[a-z][a-z0-9_]*/;
const OPS = new Set(['+', '-', '*', '/', '^']);

/**
 * Longest-match lexer. `1e5` is one number; `1e` is number(1) + ident(e),
 * which the parser rejects as implicit multiplication. Any other character
 * (uppercase letters, greek symbols, `**` after the number/`^` token, ...) is
 * a lex error. Returns either the token list or a plain-language error.
 */
export function lexExpression(input: string): { ok: true; tokens: Token[] } | { ok: false; error: string } {
  const tokens: Token[] = [];
  let rest = input;
  let pos = 0;
  while (rest.length > 0) {
    const ch = rest[0] as string;
    if (ch === '*') {
      if (rest.startsWith('**')) {
        return { ok: false, error: `"**" is not allowed in the final expression form (use "^" for exponents) at position ${pos}` };
      }
      tokens.push({ type: 'op', value: '*', pos });
      rest = rest.slice(1); pos += 1; continue;
    }
    if (OPS.has(ch)) {
      tokens.push({ type: 'op', value: ch, pos });
      rest = rest.slice(1); pos += 1; continue;
    }
    if (ch === '(') { tokens.push({ type: 'lparen', value: ch, pos }); rest = rest.slice(1); pos += 1; continue; }
    if (ch === ')') { tokens.push({ type: 'rparen', value: ch, pos }); rest = rest.slice(1); pos += 1; continue; }
    if (ch === ',') { tokens.push({ type: 'comma', value: ch, pos }); rest = rest.slice(1); pos += 1; continue; }
    const num = NUMBER_RE.exec(rest);
    if (num !== null && num[0].length > 0) {
      tokens.push({ type: 'number', value: num[0], pos });
      rest = rest.slice(num[0].length); pos += num[0].length; continue;
    }
    const ident = IDENT_RE.exec(rest);
    if (ident !== null && ident[0].length > 0) {
      tokens.push({ type: 'ident', value: ident[0], pos });
      rest = rest.slice(ident[0].length); pos += ident[0].length; continue;
    }
    return { ok: false, error: `unexpected character ${JSON.stringify(ch)} at position ${pos}` };
  }
  return { ok: true, tokens };
}

/* ------------------------------------------------------------------ */
/* AST                                                                 */
/* ------------------------------------------------------------------ */

export type AstNode =
  | { kind: 'num'; value: number }
  | { kind: 'var'; name: string }
  | { kind: 'const'; name: 'pi' | 'e' }
  | { kind: 'neg'; operand: AstNode }
  | { kind: 'bin'; op: '+' | '-' | '*' | '/' | '^'; left: AstNode; right: AstNode }
  | { kind: 'call'; fn: 'sqrt' | 'exp' | 'log' | 'sin' | 'cos' | 'tan'; arg: AstNode };

export const EXPONENT_ABS_MAX = KIT_LIMITS.formulaExplorer.exponentAbsMax;
export const AST_MAX_NODES = KIT_LIMITS.formulaExplorer.astMaxNodes;

export function astNodeCount(node: AstNode): number {
  switch (node.kind) {
    case 'num': case 'var': case 'const': return 1;
    case 'neg': return 1 + astNodeCount(node.operand);
    case 'call': return 1 + astNodeCount(node.arg);
    case 'bin': return 1 + astNodeCount(node.left) + astNodeCount(node.right);
  }
}

export interface ParseOptions {
  /** When given, every variable identifier must be in this list (FE-02 variable-set equality uses the collected set instead). */
  knownVariables?: readonly string[];
  /** AST node budget; parsing aborts past it. Default KIT_LIMITS.formulaExplorer.astMaxNodes (50). */
  maxNodes?: number;
}

/**
 * Recursive-descent parser for the frozen grammar. Rejects implicit
 * multiplication (any juxtaposition), unknown functions/constants, malformed
 * input, and ASTs above the node budget. Pure; returns a result object.
 */
export function parseTokens(tokens: Token[], opts: ParseOptions = {}): { ok: true; ast: AstNode } | { ok: false; error: string } {
  const maxNodes = opts.maxNodes ?? AST_MAX_NODES;
  let i = 0;
  let nodes = 0;
  const budget = (): { ok: false; error: string } | null => {
    nodes += 1;
    return nodes > maxNodes ? { ok: false, error: `expression AST exceeds the ${maxNodes}-node budget` } : null;
  };
  const peek = (): Token | undefined => tokens[i];
  const atOp = (v: string): boolean => { const t = peek(); return t !== undefined && t.type === 'op' && t.value === v; };

  function parseExpr(): AstNode | null {
    let left = parseTerm();
    if (left === null) return null;
    while (atOp('+') || atOp('-')) {
      const op = (peek() as Token).value as '+' | '-';
      i += 1;
      const right = parseTerm();
      if (right === null) return null;
      if (budget() !== null) { lastError = `expression AST exceeds the ${maxNodes}-node budget`; return null; }
      left = { kind: 'bin', op, left, right };
    }
    return left;
  }

  function parseTerm(): AstNode | null {
    let left = parseUnary();
    if (left === null) return null;
    while (atOp('*') || atOp('/')) {
      const op = (peek() as Token).value as '*' | '/';
      i += 1;
      const right = parseUnary();
      if (right === null) return null;
      if (budget() !== null) { lastError = `expression AST exceeds the ${maxNodes}-node budget`; return null; }
      left = { kind: 'bin', op, left, right };
    }
    return left;
  }

  function parseUnary(): AstNode | null {
    if (atOp('-')) {
      i += 1;
      const operand = parseUnary();
      if (operand === null) return null;
      if (budget() !== null) { lastError = `expression AST exceeds the ${maxNodes}-node budget`; return null; }
      return { kind: 'neg', operand };
    }
    return parsePower();
  }

  function parsePower(): AstNode | null {
    const base = parsePrimary();
    if (base === null) return null;
    if (atOp('^')) {
      i += 1;
      const exp = parseUnary(); // right operand is a Unary: 2^-1 parses, and ^ is right-associative
      if (exp === null) return null;
      if (budget() !== null) { lastError = `expression AST exceeds the ${maxNodes}-node budget`; return null; }
      return { kind: 'bin', op: '^', left: base, right: exp };
    }
    return base;
  }

  function parsePrimary(): AstNode | null {
    const t = peek();
    if (t === undefined) { lastError = 'expression ended unexpectedly'; return null; }
    if (t.type === 'number') {
      i += 1;
      const value = Number(t.value);
      if (!Number.isFinite(value)) { lastError = `number ${t.value} is not finite`; return null; }
      if (budget() !== null) { lastError = `expression AST exceeds the ${maxNodes}-node budget`; return null; }
      return { kind: 'num', value };
    }
    if (t.type === 'lparen') {
      i += 1;
      const inner = parseExpr();
      if (inner === null) return null;
      if (peek()?.type !== 'rparen') { lastError = `missing ")" at position ${peek()?.pos ?? 'end'}`; return null; }
      i += 1;
      return inner;
    }
    if (t.type === 'ident') {
      i += 1;
      if ((FORMULA_FUNCTIONS as readonly string[]).includes(t.value)) {
        if (peek()?.type !== 'lparen') { lastError = `function "${t.value}" must be followed by "(" at position ${peek()?.pos ?? 'end'}`; return null; }
        i += 1;
        const arg = parseExpr();
        if (arg === null) return null;
        if (peek()?.type !== 'rparen') { lastError = `missing ")" after the argument of "${t.value}"`; return null; }
        i += 1;
        if (budget() !== null) { lastError = `expression AST exceeds the ${maxNodes}-node budget`; return null; }
        return { kind: 'call', fn: t.value as 'sqrt', arg };
      }
      if ((FORMULA_CONSTANTS as readonly string[]).includes(t.value)) {
        if (budget() !== null) { lastError = `expression AST exceeds the ${maxNodes}-node budget`; return null; }
        return { kind: 'const', name: t.value as 'pi' | 'e' };
      }
      if (opts.knownVariables !== undefined && !opts.knownVariables.includes(t.value)) {
        lastError = `unknown name "${t.value}" (not a declared variable, function or constant)`;
        return null;
      }
      if (budget() !== null) { lastError = `expression AST exceeds the ${maxNodes}-node budget`; return null; }
      return { kind: 'var', name: t.value };
    }
    lastError = `unexpected token "${t.value}" at position ${t.pos}`;
    return null;
  }

  let lastError = 'malformed expression';
  const ast = parseExpr();
  if (ast === null) return { ok: false, error: lastError };
  if (i < tokens.length) {
    const t = tokens[i] as Token;
    // Juxtaposition (e.g. "2x", "(a)(b)") lands here: implicit multiplication is rejected.
    return { ok: false, error: `unexpected trailing token "${t.value}" at position ${t.pos} (implicit multiplication is not allowed; write "*" explicitly)` };
  }
  return { ok: true, ast };
}

/** Lex + parse a final-form expression string (whitespace ignored, `**` rejected). */
export function parseExpression(input: string, opts: ParseOptions = {}): { ok: true; ast: AstNode } | { ok: false; error: string } {
  if (typeof input !== 'string') return { ok: false, error: 'expression must be a string' };
  if (input.length > KIT_LIMITS.formulaExplorer.expressionMaxChars) {
    return { ok: false, error: `expression is ${input.length} characters, expected <= ${KIT_LIMITS.formulaExplorer.expressionMaxChars}` };
  }
  const normalized = normalizeExpression(input);
  if (normalized === '') return { ok: false, error: 'expression is empty' };
  const lexed = lexExpression(normalized);
  if (!lexed.ok) return { ok: false, error: lexed.error };
  if (lexed.tokens.length === 0) return { ok: false, error: 'expression is empty' };
  return parseTokens(lexed.tokens, opts);
}

/** Lex + parse a PAGE formula line (unicode normalisation incl. `**` → `^`). */
export function parsePageFormula(input: string, opts: ParseOptions = {}): { ok: true; ast: AstNode } | { ok: false; error: string } {
  if (typeof input !== 'string') return { ok: false, error: 'formula must be a string' };
  const normalized = normalizePageFormula(input);
  if (normalized === '') return { ok: false, error: 'formula is empty' };
  const lexed = lexExpression(normalized);
  if (!lexed.ok) return { ok: false, error: lexed.error };
  if (lexed.tokens.length === 0) return { ok: false, error: 'formula is empty' };
  return parseTokens(lexed.tokens, opts);
}

/* ------------------------------------------------------------------ */
/* Evaluator                                                           */
/* ------------------------------------------------------------------ */

/**
 * Total evaluator: every domain error (division by zero, sqrt of a negative,
 * log of <= 0, 0^negative, |exponent| > 100, any non-finite intermediate or
 * variable value) returns NaN — the "Not defined for these inputs" case.
 */
export function evaluate(node: AstNode, vars: Readonly<Record<string, number>>): number {
  switch (node.kind) {
    case 'num': return node.value;
    case 'const': return node.name === 'pi' ? Math.PI : Math.E;
    case 'var': {
      const v = vars[node.name];
      return typeof v === 'number' && Number.isFinite(v) ? v : NaN;
    }
    case 'neg': return negate(evaluate(node.operand, vars));
    case 'call': return applyFn(node.fn, evaluate(node.arg, vars));
    case 'bin': {
      const a = evaluate(node.left, vars);
      const b = evaluate(node.right, vars);
      return applyBin(node.op, a, b);
    }
  }
}

function finiteOrNaN(x: number): number {
  return Number.isFinite(x) ? x : NaN;
}

function negate(x: number): number {
  return Number.isNaN(x) ? NaN : -x;
}

function applyFn(fn: string, x: number): number {
  if (Number.isNaN(x)) return NaN;
  switch (fn) {
    case 'sqrt': return x < 0 ? NaN : finiteOrNaN(Math.sqrt(x));
    case 'exp': return finiteOrNaN(Math.exp(x));
    case 'log': return x <= 0 ? NaN : finiteOrNaN(Math.log(x));
    case 'sin': return finiteOrNaN(Math.sin(x));
    case 'cos': return finiteOrNaN(Math.cos(x));
    case 'tan': return finiteOrNaN(Math.tan(x));
    default: return NaN;
  }
}

function applyBin(op: string, a: number, b: number): number {
  if (Number.isNaN(a) || Number.isNaN(b)) return NaN;
  switch (op) {
    case '+': return finiteOrNaN(a + b);
    case '-': return finiteOrNaN(a - b);
    case '*': return finiteOrNaN(a * b);
    case '/': return b === 0 ? NaN : finiteOrNaN(a / b); // ÷0 is a domain error, never Infinity
    case '^': {
      if (Math.abs(b) > EXPONENT_ABS_MAX) return NaN; // |exponent| <= 100
      if (a === 0 && b < 0) return NaN; // 0^negative is a domain error
      return finiteOrNaN(Math.pow(a, b));
    }
    default: return NaN;
  }
}

/** Lex + parse + evaluate in one step; NaN on any parse or domain error. */
export function evalExpression(input: string, vars: Readonly<Record<string, number>>): number {
  const parsed = parseExpression(input);
  return parsed.ok ? evaluate(parsed.ast, vars) : NaN;
}

/* ------------------------------------------------------------------ */
/* Structural helpers                                                  */
/* ------------------------------------------------------------------ */

/** Every variable identifier used by an AST, in first-appearance order. */
export function astVariables(node: AstNode): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const walk = (n: AstNode): void => {
    switch (n.kind) {
      case 'var': if (!seen.has(n.name)) { seen.add(n.name); out.push(n.name); } return;
      case 'neg': walk(n.operand); return;
      case 'call': walk(n.arg); return;
      case 'bin': walk(n.left); walk(n.right); return;
      default: return;
    }
  };
  walk(node);
  return out;
}

/**
 * Canonical structural form: parentheses are canonical by construction (the
 * AST carries no parens) and commutative `+`/`*` operands are sorted by their
 * canonical string, per design §2.7 FE-08. Used for structural equality.
 */
export function canonicalAst(node: AstNode): AstNode {
  switch (node.kind) {
    case 'num': case 'var': case 'const': return node;
    case 'neg': return { kind: 'neg', operand: canonicalAst(node.operand) };
    case 'call': return { kind: 'call', fn: node.fn, arg: canonicalAst(node.arg) };
    case 'bin': {
      const left = canonicalAst(node.left);
      const right = canonicalAst(node.right);
      if (node.op === '+' || node.op === '*') {
        const l = canonicalString(left);
        const r = canonicalString(right);
        return l <= r ? { kind: 'bin', op: node.op, left, right } : { kind: 'bin', op: node.op, left: right, right: left };
      }
      return { kind: 'bin', op: node.op, left, right };
    }
  }
}

export function canonicalString(node: AstNode): string {
  switch (node.kind) {
    case 'num': return String(node.value);
    case 'var': return node.name;
    case 'const': return node.name;
    case 'neg': return `(-${canonicalString(node.operand)})`;
    case 'call': return `${node.fn}(${canonicalString(node.arg)})`;
    case 'bin': return `(${canonicalString(node.left)}${node.op}${canonicalString(node.right)})`;
  }
}

/** Structural equality after canonicalisation. */
export function astStructurallyEqual(a: AstNode, b: AstNode): boolean {
  return canonicalString(canonicalAst(a)) === canonicalString(canonicalAst(b));
}

/**
 * DEPRECATED diagonal sampling (kept for reference and existing consumers): the five sample
 * points "spread over the slider ranges" using the SAME fraction of every variable's [min, max].
 * Stage 6 review S6R-02: every variable moves in lockstep, so errors containing a factor of
 * (x - y) vanish on the diagonal. FE-08 now uses independentSamplePoints() below; do not add
 * new callers of this function.
 */
export function sliderSamplePoints(variables: readonly { name: string; min: number; max: number }[]): Record<string, number>[] {
  const fractions = [0.1, 0.3, 0.5, 0.7, 0.9];
  return fractions.map(f => {
    const point: Record<string, number> = {};
    for (const v of variables) point[v.name] = v.min + f * (v.max - v.min);
    return point;
  });
}

/* ------------------------------------------------------------------ */
/* Independent FE-08 comparison sampling (Stage 6 review S6R-02)       */
/* ------------------------------------------------------------------ */

export interface SampledVariable { name: string; min: number; max: number; default?: number }

/** The one-at-a-time variation fractions (the frozen FE-08 fraction list). */
export const ONE_AT_A_TIME_FRACTIONS = [0.1, 0.3, 0.5, 0.7, 0.9] as const;

/** Fixed seed for the pseudo-random comparison points (deterministic; never Math.random). */
export const FE08_SAMPLE_SEED = 0x46453038; // "FE08"

/** Deterministic seeded PRNG (mulberry32): same seed → same sequence, run to run. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Independently varied FE-08 comparison points (Stage 6 review S6R-02). The old diagonal
 * sampling moved every variable by the same fraction of its range, so with equal ranges
 * x === y at every sample and any error containing a factor of (x - y) disappeared. This set
 * is built from:
 *   1. the base point (each variable at its slider default, clamped into [min, max]);
 *   2. per-variable ONE-AT-A-TIME variation around the base point (each fraction of
 *      ONE_AT_A_TIME_FRACTIONS applied to one variable while the others stay at the base);
 *   3. seeded pseudo-random points with every variable drawn INDEPENDENTLY (mulberry32,
 *      fixed FE08_SAMPLE_SEED — deterministic across runs and machines);
 *   4. caller-provided extra points (the stored case inputs, the slider defaults), kept only
 *      when they carry a finite value for every variable.
 * Exact-duplicate points are removed (first occurrence wins), so the count varies with the
 * input. Pure: no clock, no Math.random, no I/O.
 */
export function independentSamplePoints(
  variables: readonly SampledVariable[],
  extraPoints: readonly Record<string, number>[] = [],
  opts: { seed?: number; randomPointCount?: number } = {},
): Record<string, number>[] {
  const vars = (Array.isArray(variables) ? variables : []).filter(
    (v): v is SampledVariable => typeof v?.name === 'string' && v.name !== '' && Number.isFinite(v.min) && Number.isFinite(v.max) && v.min < v.max,
  );
  if (vars.length === 0) return [];
  const at = (v: SampledVariable, f: number): number => v.min + f * (v.max - v.min);
  const base: Record<string, number> = {};
  for (const v of vars) {
    const d = v.default;
    base[v.name] = typeof d === 'number' && Number.isFinite(d) && d >= v.min && d <= v.max ? d : at(v, 0.5);
  }
  const points: Record<string, number>[] = [{ ...base }];
  for (const v of vars) {
    for (const f of ONE_AT_A_TIME_FRACTIONS) points.push({ ...base, [v.name]: at(v, f) });
  }
  const rng = mulberry32(opts.seed ?? FE08_SAMPLE_SEED);
  const randomCount = Number.isFinite(opts.randomPointCount) && (opts.randomPointCount as number) >= 0 ? Math.floor(opts.randomPointCount as number) : 5;
  for (let i = 0; i < randomCount; i++) {
    const p: Record<string, number> = {};
    for (const v of vars) p[v.name] = at(v, rng());
    points.push(p);
  }
  for (const extra of extraPoints ?? []) {
    if (extra === null || typeof extra !== 'object') continue;
    const p: Record<string, number> = {};
    let complete = true;
    for (const v of vars) {
      const value = extra[v.name];
      if (typeof value !== 'number' || !Number.isFinite(value)) { complete = false; break; }
      p[v.name] = value;
    }
    if (complete) points.push(p);
  }
  const seen = new Set<string>();
  const out: Record<string, number>[] = [];
  for (const p of points) {
    const key = vars.map(v => String(p[v.name])).join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

export interface FormulaMismatch { point: Record<string, number>; a: number; b: number }
export interface FormulaComparison { finite: number; agreeing: number; mismatches: FormulaMismatch[] }

/**
 * Pure numeric comparison of two ASTs over a point set (FE-08's comparison helper, exported so
 * the browser can share the exact same implementation later). Points where either side is
 * non-finite are skipped (never counted as agreements); a point agrees when
 * |a - b| <= relativeTolerance * max(|a|, |b|). Grammar/AST-walk evaluation only — no
 * eval/Function anywhere.
 */
export function compareAtPoints(a: AstNode, b: AstNode, points: readonly Record<string, number>[], relativeTolerance: number): FormulaComparison {
  let finite = 0;
  let agreeing = 0;
  const mismatches: FormulaMismatch[] = [];
  for (const point of points ?? []) {
    const va = evaluate(a, point);
    const vb = evaluate(b, point);
    if (!Number.isFinite(va) || !Number.isFinite(vb)) continue;
    finite += 1;
    const denom = Math.max(Math.abs(va), Math.abs(vb));
    if (Math.abs(va - vb) <= relativeTolerance * denom) agreeing += 1;
    else mismatches.push({ point, a: va, b: vb });
  }
  return { finite, agreeing, mismatches };
}
