// S6-V — chemical formula parser + exact integer equation balancer for
// balance-equation-v1 (docs/specs/STAGE-6-design.md §3, frozen).
//
// Parser contract (design §3c):
//   - element symbols [A-Z][a-z]?; unknown symbols rejected (full 1..118 list);
//   - subscripts 1..999, no leading zeros;
//   - () and [] group depth <= 2;
//   - hydrate dots (·, ., •) REJECTED day 1 (frozen decision: hydrates deferred);
//   - charges EXCLUDED: "Fe3+", "e-", "^2+", unicode superscript charges rejected;
//   - state symbols (s)/(l)/(g)/(aq) stripped and not verified;
//   - normalisation: unicode subscript digits → ASCII, unicode arrows → '->',
//     whitespace removed, '+' separators.
//
// Balancer: builds the signed element×species matrix (left +, right −) and
// solves M·c = 0 EXACTLY over the integers with BigInt fraction-free
// elimination. Outcomes:
//   - nullity 0            → no nontrivial solution ('no-solution');
//   - nullity 1            → unique up to scale: kernel via signed maximal
//                            minors, reduced to lowest positive integers
//                            (gcd 1). A kernel with a zero or sign-mixed
//                            component has no all-positive solution.
//   - nullity >= 2         → 'ambiguous' (BAL-08 fails; not balanceable to a
//                            unique key).
// Atom counts are exact integers; nothing here uses floating point.

import { KIT_LIMITS } from '../contracts/kit.ts';

/* ------------------------------------------------------------------ */
/* Element table (Z = 1..118)                                          */
/* ------------------------------------------------------------------ */

export const ELEMENT_SYMBOLS: readonly string[] = (
  'H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn ' +
  'Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La ' +
  'Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po ' +
  'At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg ' +
  'Cn Nh Fl Mc Lv Ts Og'
).split(' ');
const ELEMENT_SET = new Set(ELEMENT_SYMBOLS);

/* ------------------------------------------------------------------ */
/* Normalisation                                                       */
/* ------------------------------------------------------------------ */

const UNICODE_SUBSCRIPTS: Readonly<Record<string, string>> = {
  '\u2080': '0', '\u2081': '1', '\u2082': '2', '\u2083': '3', '\u2084': '4',
  '\u2085': '5', '\u2086': '6', '\u2087': '7', '\u2088': '8', '\u2089': '9',
};
const SUBSCRIPT_RUN = /[\u2080-\u2089]+/g;
export const EQUATION_ARROWS = ['\u27f6', '\u2192', '\u21d2', '\u27f9', '\u2194', '\u21cc', '\u21c4', '\u2b0c', '<->', '-->', '->', '=>'];
const STATE_SYMBOL_RE = /\((?:s|l|g|aq)\)/g;

/** Normalise one chemical formula: unicode subscripts → ASCII, state symbols stripped, whitespace removed. */
export function normalizeChemFormula(s: string): string {
  return s
    .replace(SUBSCRIPT_RUN, run => [...run].map(ch => UNICODE_SUBSCRIPTS[ch] ?? '').join(''))
    .replace(STATE_SYMBOL_RE, '')
    .replace(/\s+/g, '');
}

/** Normalise a whole printed equation: unicode subscripts, arrows → '->', state symbols stripped, whitespace normalised around separators. */
export function normalizeEquationText(s: string): string {
  let out = s.replace(SUBSCRIPT_RUN, run => [...run].map(ch => UNICODE_SUBSCRIPTS[ch] ?? '').join(''));
  out = out.replace(STATE_SYMBOL_RE, '');
  // Longest arrow first so '<->'/'-->' are not partially rewritten.
  for (const arrow of EQUATION_ARROWS) out = out.split(arrow).join('->');
  out = out.replace(/\u2212/g, '-'); // unicode minus (charge marker candidate — rejected later)
  return out.replace(/\s+/g, ' ').trim();
}

/* ------------------------------------------------------------------ */
/* Formula parser                                                      */
/* ------------------------------------------------------------------ */

export interface ParsedFormula {
  /** element symbol → exact atom count */
  atoms: Map<string, number>;
  totalAtoms: number;
  maxDepth: number;
}
export type FormulaParseResult = { ok: true; parsed: ParsedFormula } | { ok: false; error: string };

const HYDRATE_DOTS = /[\u00b7\u2022\u22c5.]/; // · • ⋅ . (hydrate dots deferred, rejected day 1)

/**
 * Parse ONE species formula (no coefficient, no '+', no arrow). Rejects
 * charges, hydrate dots, unknown symbols, leading-zero or out-of-range
 * subscripts, group depth > 2, unbalanced groups and empty input.
 */
export function parseChemicalFormula(formula: string): FormulaParseResult {
  if (typeof formula !== 'string') return { ok: false, error: 'formula must be a string' };
  const f = normalizeChemFormula(formula);
  if (f === '') return { ok: false, error: 'formula is empty' };
  if (/[-+\u207a\u207b\u208a\u208b^]/.test(f)) {
    return { ok: false, error: `formula "${formula}" carries a charge marker (charges are excluded day 1; "Fe3+", "e-" and "^2+" forms are rejected)` };
  }
  if (HYDRATE_DOTS.test(f)) {
    return { ok: false, error: `formula "${formula}" contains a dot separator (hydrate dots are deferred and rejected)` };
  }
  const limit = KIT_LIMITS.balance;
  // Tokenise: symbols with optional subscripts, groups with multipliers.
  const stack: Map<string, number>[] = [new Map()];
  let i = 0;
  let maxDepth = 0;
  while (i < f.length) {
    const ch = f[i] as string;
    if (ch === '(' || ch === '[') {
      if (stack.length > limit.parenDepthMax) {
        return { ok: false, error: `formula "${formula}" nests groups deeper than ${limit.parenDepthMax}` };
      }
      stack.push(new Map());
      maxDepth = Math.max(maxDepth, stack.length - 1);
      i += 1;
      continue;
    }
    if (ch === ')' || ch === ']') {
      if (stack.length === 1) return { ok: false, error: `formula "${formula}" has a closing group without an opening one` };
      const top = stack.pop() as Map<string, number>;
      if (top.size === 0) return { ok: false, error: `formula "${formula}" has an empty group` };
      const mult = readSubscript(f, i + 1);
      if (mult.error !== undefined) return { ok: false, error: `formula "${formula}": ${mult.error}` };
      const m = mult.value ?? 1;
      const target = stack[stack.length - 1] as Map<string, number>;
      for (const [el, n] of top) target.set(el, (target.get(el) ?? 0) + n * m);
      i = mult.next;
      continue;
    }
    const sym = readSymbol(f, i);
    if (sym.error !== undefined) return { ok: false, error: `formula "${formula}": ${sym.error}` };
    if (sym.symbol === null) return { ok: false, error: `formula "${formula}": unexpected character ${JSON.stringify(f[i])}` };
    const sub = readSubscript(f, sym.next);
    if (sub.error !== undefined) return { ok: false, error: `formula "${formula}": ${sub.error}` };
    const count = sub.value ?? 1;
    const target = stack[stack.length - 1] as Map<string, number>;
    target.set(sym.symbol, (target.get(sym.symbol) ?? 0) + count);
    i = sub.next;
  }
  if (stack.length !== 1) return { ok: false, error: `formula "${formula}" has an unclosed group` };
  const atoms = stack[0] as Map<string, number>;
  if (atoms.size === 0) return { ok: false, error: `formula "${formula}" contains no atoms` };
  let totalAtoms = 0;
  for (const n of atoms.values()) totalAtoms += n;
  if (totalAtoms > limit.atomsPerSpeciesMax) {
    return { ok: false, error: `formula "${formula}" has ${totalAtoms} atoms, expected <= ${limit.atomsPerSpeciesMax}` };
  }
  return { ok: true, parsed: { atoms, totalAtoms, maxDepth } };
}

function readSymbol(f: string, i: number): { symbol: string | null; next: number; error?: string } {
  const two = f.slice(i, i + 2);
  const one = f.slice(i, i + 1);
  if (/^[A-Z][a-z]$/.test(two) && ELEMENT_SET.has(two)) return { symbol: two, next: i + 2 };
  if (/^[A-Z]$/.test(one)) {
    if (!ELEMENT_SET.has(one)) return { symbol: one, next: i + 1, error: `unknown element symbol "${one}"` };
    return { symbol: one, next: i + 1 };
  }
  if (/^[A-Z][a-z]$/.test(two)) return { symbol: two, next: i + 2, error: `unknown element symbol "${two}"` };
  return { symbol: null, next: i };
}

function readSubscript(f: string, i: number): { value: number | null; next: number; error?: string } {
  const m = /^\d+/.exec(f.slice(i));
  if (m === null) return { value: null, next: i };
  const digits = m[0];
  if (digits.length > 1 && digits.startsWith('0')) return { value: null, next: i, error: `subscript "${digits}" has a leading zero` };
  const value = Number(digits);
  if (value < KIT_LIMITS.balance.subscript.min || value > KIT_LIMITS.balance.subscript.max) {
    return { value: null, next: i, error: `subscript ${value} outside 1..999` };
  }
  return { value, next: i + digits.length };
}

/* ------------------------------------------------------------------ */
/* Equation text parser (species split)                                */
/* ------------------------------------------------------------------ */

export interface EquationPart { coefficient: number; formula: string; side: 'left' | 'right' }
export type EquationParseResult =
  | { ok: true; parts: EquationPart[] }
  | { ok: false; error: string };

/**
 * Split a printed equation into (coefficient, formula, side) parts. Requires
 * exactly one arrow. Coefficients are plain positive integers (no leading
 * zeros). Used to cross-check the Muse-written species split (BAL-02).
 */
export function parseEquationParts(equationText: string): EquationParseResult {
  const t = normalizeEquationText(equationText);
  if (t === '') return { ok: false, error: 'equation text is empty' };
  const sides = t.split('->');
  if (sides.length !== 2) {
    return { ok: false, error: sides.length < 2 ? 'equation text has no reaction arrow' : `equation text has ${sides.length - 1} arrows, expected exactly one` };
  }
  const parts: EquationPart[] = [];
  const sideNames = ['left', 'right'] as const;
  for (let s = 0; s < 2; s++) {
    const side = sides[s] as string;
    const terms = side.split('+').map(x => x.trim()).filter(x => x !== '');
    if (terms.length === 0) return { ok: false, error: `${sideNames[s]} side of the equation is empty` };
    for (const term of terms) {
      const m = /^(\d+)\s*(.*)$/.exec(term);
      let coefficient = 1;
      let formula = term;
      if (m !== null) {
        const digits = m[1] as string;
        if (digits.length > 1 && digits.startsWith('0')) return { ok: false, error: `coefficient "${digits}" has a leading zero` };
        coefficient = Number(digits);
        formula = (m[2] ?? '').trim();
        if (coefficient < 1 || coefficient > KIT_LIMITS.balance.subscript.max) {
          return { ok: false, error: `coefficient ${coefficient} outside the printable range` };
        }
      }
      if (formula === '') return { ok: false, error: `${sideNames[s]} side has a term with no formula` };
      parts.push({ coefficient, formula, side: sideNames[s] as 'left' | 'right' });
    }
  }
  return { ok: true, parts };
}

/* ------------------------------------------------------------------ */
/* Exact integer balancer                                              */
/* ------------------------------------------------------------------ */

export interface BalanceSpeciesInput { formula: string; side: 'left' | 'right' }
export type BalanceResult =
  | { status: 'unique'; coefficients: number[]; gcd: number; elements: string[] }
  | { status: 'ambiguous'; nullity: number; elements: string[] }
  | { status: 'no-solution'; reason: string; elements: string[] }
  | { status: 'parse-error'; error: string };

function gcdBig(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) { const t = x % y; x = y; y = t; }
  return x;
}

/**
 * Fraction-free (Bareiss) elimination over BigInt. Returns the rank and the
 * indices of `rank` linearly independent ROWS of the input matrix.
 */
function rankAndIndependentRows(matrix: bigint[][]): { rank: number; rows: number[] } {
  const rows = matrix.map(r => [...r]);
  const rowIndex = rows.map((_, i) => i);
  const cols = rows.length > 0 ? (rows[0] as bigint[]).length : 0;
  let rank = 0;
  let prevPivot = 1n;
  for (let col = 0; col < cols && rank < rows.length; col++) {
    // Find a pivot row at or below `rank` with a nonzero entry in this column.
    let pivot = -1;
    for (let r = rank; r < rows.length; r++) {
      if ((rows[r] as bigint[])[col] !== 0n) { pivot = r; break; }
    }
    if (pivot === -1) continue;
    // Swap into position.
    if (pivot !== rank) {
      const tr = rows[rank] as bigint[]; rows[rank] = rows[pivot] as bigint[]; rows[pivot] = tr;
      const ti = rowIndex[rank] as number; rowIndex[rank] = rowIndex[pivot] as number; rowIndex[pivot] = ti;
    }
    const prow = rows[rank] as bigint[];
    for (let r = rank + 1; r < rows.length; r++) {
      const row = rows[r] as bigint[];
      const factor = row[col];
      for (let c = col; c < cols; c++) {
        row[c] = (row[c] * prow[col] - factor * (prow[c] as bigint)) / prevPivot;
      }
    }
    prevPivot = prow[col] as bigint;
    rank += 1;
  }
  return { rank, rows: rowIndex.slice(0, rank) };
}

/** Exact BigInt determinant of a square matrix (Bareiss). */
function detBareiss(input: bigint[][]): bigint {
  const n = input.length;
  if (n === 0) return 1n;
  const m = input.map(r => [...r]);
  let prev = 1n;
  let sign = 1n;
  for (let k = 0; k < n - 1; k++) {
    if (m[k][k] === 0n) {
      let swap = -1;
      for (let r = k + 1; r < n; r++) if ((m[r] as bigint[])[k] !== 0n) { swap = r; break; }
      if (swap === -1) return 0n;
      const t = m[k]; m[k] = m[swap] as bigint[]; m[swap] = t;
      sign = -sign;
    }
    for (let i = k + 1; i < n; i++) {
      for (let j = k + 1; j < n; j++) {
        (m[i] as bigint[])[j] = ((m[i] as bigint[])[j] * (m[k] as bigint[])[k] - (m[i] as bigint[])[k] * (m[k] as bigint[])[j]) / prev;
      }
    }
    prev = (m[k] as bigint[])[k] as bigint;
  }
  return sign * ((m[n - 1] as bigint[])[n - 1] as bigint);
}

/**
 * Balance a species list exactly. Species order defines coefficient order.
 * `elements` lists every distinct element symbol involved (the caller checks
 * the 1..8 limit). Never throws; malformed formulas degrade to parse-error.
 */
export function balanceSpecies(species: BalanceSpeciesInput[]): BalanceResult {
  if (!Array.isArray(species) || species.length === 0) return { status: 'parse-error', error: 'species list is empty' };
  const parsed: Map<string, number>[] = [];
  const elementSet = new Set<string>();
  for (const sp of species) {
    const r = parseChemicalFormula(sp.formula);
    if (!r.ok) return { status: 'parse-error', error: r.error };
    parsed.push(r.parsed.atoms);
    for (const el of r.parsed.atoms.keys()) elementSet.add(el);
  }
  const elements = [...elementSet].sort();
  const n = species.length;
  // Signed element matrix: reactants positive, products negative.
  const matrix: bigint[][] = elements.map(el =>
    parsed.map((atoms, col) => {
      const count = BigInt(atoms.get(el) ?? 0);
      return species[col]?.side === 'left' ? count : -count;
    }),
  );
  // Track original row order for the minor-based kernel: rankAndIndependentRows gives row indices.
  const { rank, rows } = rankAndIndependentRows(matrix);
  const nullity = n - rank;
  if (nullity <= 0) {
    return { status: 'no-solution', reason: `the atom matrix has rank ${rank} over ${n} species, so the only solution is the trivial one (atoms cannot be conserved with exactly these species)`, elements };
  }
  if (nullity > 1) {
    return { status: 'ambiguous', nullity, elements };
  }
  // Nullity exactly 1: kernel generator via signed maximal minors of `rank`
  // independent rows (rank === n - 1 here).
  const indep = rows.map(r => matrix[r] as bigint[]);
  const kernel: bigint[] = [];
  for (let j = 0; j < n; j++) {
    const minor = indep.map(row => row.filter((_, c) => c !== j));
    const d = detBareiss(minor);
    kernel.push(j % 2 === 0 ? d : -d);
  }
  if (kernel.some(v => v === 0n)) {
    return { status: 'no-solution', reason: 'the unique solution gives at least one species a zero coefficient (a species appears that cannot take part in the balanced reaction)', elements };
  }
  const allPositive = kernel.every(v => v > 0n);
  const allNegative = kernel.every(v => v < 0n);
  if (!allPositive && !allNegative) {
    return { status: 'no-solution', reason: 'the unique solution mixes positive and negative coefficients (the stated sides cannot balance as written)', elements };
  }
  const signed = allPositive ? kernel : kernel.map(v => -v);
  let g = 0n;
  for (const v of signed) g = gcdBig(g, v);
  if (g === 0n) return { status: 'no-solution', reason: 'degenerate kernel', elements };
  const lowest = signed.map(v => Number(v / g));
  if (lowest.some(v => !Number.isSafeInteger(v) || v < 1)) {
    return { status: 'no-solution', reason: 'the lowest-terms solution is not a list of positive integers', elements };
  }
  // Verify atom balance exactly (A·c = 0 over the integers).
  for (let row = 0; row < matrix.length; row++) {
    let sum = 0n;
    const mrow = matrix[row] as bigint[];
    for (let col = 0; col < n; col++) sum += mrow[col] * BigInt(lowest[col] as number);
    if (sum !== 0n) {
      return { status: 'no-solution', reason: `internal error: element ${elements[row]} does not balance with the derived coefficients`, elements };
    }
  }
  return { status: 'unique', coefficients: lowest, gcd: 1, elements };
}
