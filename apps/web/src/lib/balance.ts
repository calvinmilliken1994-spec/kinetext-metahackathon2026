// Balance-the-equation (balance-equation-v1) view model (pure). Parser for the frozen formula subset (element symbols,
// subscripts 1-999, brackets to depth 2; no charges, no hydrate dots; state symbols are stripped), a live atom counter,
// an exact integer solver (nullspace of the atom matrix) and grading. The stored spec carries the printed equation but no
// solution, so the answer key is derived here and must be unique up to scale, in lowest terms, with coefficients 1-12.

import type { BalanceSpeciesGen } from '../../../../packages/contracts/kit.ts';
import { KIT_LIMITS } from '../../../../packages/contracts/kit.ts';

const LIMITS = KIT_LIMITS.balance;

const ELEMENTS = new Set(
  ('H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe ' +
    'Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr ' +
    'Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og').split(' '),
);

const SUBSCRIPT_DIGITS = '₀₁₂₃₄₅₆₇₈₉';

export type Counts = Record<string, number>;
export type FormulaParse = { ok: true; counts: Counts } | { ok: false; reason: string };

/** Unicode subscripts become digits and a trailing state symbol is dropped; states are never verified or graded. */
export function cleanFormula(raw: string): string {
  return [...raw.trim()].map((c) => { const i = SUBSCRIPT_DIGITS.indexOf(c); return i >= 0 ? String(i) : c; }).join('').replace(/\((?:s|l|g|aq)\)$/, '');
}

export function parseChemFormula(raw: string): FormulaParse {
  const f = cleanFormula(raw);
  const bad = (reason: string): FormulaParse => ({ ok: false, reason });
  if (f === '') return bad('The formula is empty.');
  if (/[·.•]/.test(f)) return bad('Hydrates (a dot between parts) are not supported.');
  if (/[+\-^]/.test(f) || /\d[+-]$/.test(f)) return bad('Charges are not supported.');
  if (/\s/.test(f)) return bad('A formula has no spaces.');
  if (/^\d/.test(f)) return bad('A coefficient is not part of a formula.');
  let pos = 0;
  let failure: string | null = null;
  const fail = (reason: string): Counts => { failure ??= reason; return {}; };

  const readNumber = (): number | null => {
    const m = /^\d+/.exec(f.slice(pos));
    if (m === null) return null;
    pos += m[0].length;
    if (m[0].startsWith('0')) { fail('A subscript cannot start with 0.'); return 1; }
    const v = Number(m[0]);
    if (v < LIMITS.subscript.min || v > LIMITS.subscript.max) { fail(`A subscript must be between ${LIMITS.subscript.min} and ${LIMITS.subscript.max}.`); return 1; }
    return v;
  };

  const group = (depth: number): Counts => {
    const counts: Counts = {};
    const add = (sym: string, n: number): void => { counts[sym] = (counts[sym] ?? 0) + n; };
    while (pos < f.length && failure === null) {
      const ch = f[pos] as string;
      if (ch === '(') {
        if (depth >= LIMITS.parenDepthMax) return fail('Brackets are nested too deeply.');
        pos++;
        const inner = group(depth + 1);
        if (failure !== null) return {};
        if (f[pos] !== ')') return fail('A bracket is not closed.');
        pos++;
        if (Object.keys(inner).length === 0) return fail('A bracket is empty.');
        const times = readNumber() ?? 1;
        for (const [sym, n] of Object.entries(inner)) add(sym, n * times);
      } else if (ch === ')') {
        if (depth === 0) return fail('A bracket is closed but was never opened.');
        return counts;
      } else {
        const m = /^[A-Z][a-z]?/.exec(f.slice(pos));
        if (m === null) return fail(`“${ch}” is not part of a formula.`);
        let sym = m[0];
        if (!ELEMENTS.has(sym)) {
          // “Co” is cobalt but “CO” is two elements: fall back to the one-letter symbol when the two-letter one is unknown.
          if (sym.length === 2 && ELEMENTS.has(sym[0] as string)) sym = sym[0] as string;
          else return fail(`“${sym}” is not an element symbol.`);
        }
        pos += sym.length;
        add(sym, readNumber() ?? 1);
      }
    }
    if (depth > 0 && failure === null) return fail('A bracket is not closed.');
    return counts;
  };

  const counts = group(0);
  if (failure !== null) return bad(failure);
  const atoms = Object.values(counts).reduce((a, b) => a + b, 0);
  if (Object.keys(counts).length > LIMITS.elements.max) return bad(`A formula may have at most ${LIMITS.elements.max} elements.`);
  if (atoms > LIMITS.atomsPerSpeciesMax) return bad(`A formula may have at most ${LIMITS.atomsPerSpeciesMax} atoms.`);
  return { ok: true, counts };
}

// ---- live atom counts -------------------------------------------------------------------------------------------

export interface AtomRow { element: string; left: number; right: number; balanced: boolean }
export interface AtomTotals { rows: AtomRow[]; balanced: boolean }

type SpeciesLike = Pick<BalanceSpeciesGen, 'formula' | 'side'>;

/** Atoms of each element on each side for the given coefficients; null when a formula cannot be parsed. */
export function atomTotals(species: readonly SpeciesLike[], coefficients: readonly number[]): AtomTotals | null {
  const parsed = species.map((s) => parseChemFormula(s.formula));
  const order: string[] = [];
  const left: Counts = {};
  const right: Counts = {};
  for (let i = 0; i < species.length; i++) {
    const p = parsed[i];
    if (p === undefined || !p.ok) return null;
    const c = coefficients[i] ?? 0;
    const side = species[i]?.side === 'left' ? left : right;
    for (const [sym, n] of Object.entries(p.counts)) {
      if (!order.includes(sym)) order.push(sym);
      side[sym] = (side[sym] ?? 0) + n * c;
    }
  }
  const rows = order.map((element) => ({ element, left: left[element] ?? 0, right: right[element] ?? 0, balanced: (left[element] ?? 0) === (right[element] ?? 0) }));
  return { rows, balanced: rows.every((r) => r.balanced) };
}

// ---- exact solver ---------------------------------------------------------------------------------------------

type Frac = { n: bigint; d: bigint };
const big = (n: number): bigint => BigInt(n);
const gcdBig = (a: bigint, b: bigint): bigint => { let x = a < 0n ? -a : a; let y = b < 0n ? -b : b; while (y !== 0n) { [x, y] = [y, x % y]; } return x; };
function frac(n: bigint, d: bigint = 1n): Frac {
  if (d < 0n) { n = -n; d = -d; }
  const g = gcdBig(n, d) || 1n;
  return { n: n / g, d: d / g };
}
const sub = (a: Frac, b: Frac): Frac => frac(a.n * b.d - b.n * a.d, a.d * b.d);
const mul = (a: Frac, b: Frac): Frac => frac(a.n * b.n, a.d * b.d);
const div = (a: Frac, b: Frac): Frac => frac(a.n * b.d, a.d * b.n);

/**
 * The smallest whole-number coefficients that balance every element, or null when there is none, the equation is
 * ambiguous (more than one independent balance), a formula does not parse, or a coefficient would fall outside 1-12.
 */
export function solveBalance(species: readonly SpeciesLike[]): number[] | null {
  const parsed = species.map((s) => parseChemFormula(s.formula));
  const cols = species.length;
  if (cols < LIMITS.species.min || parsed.some((p) => !p.ok)) return null;
  const elements: string[] = [];
  for (const p of parsed) if (p.ok) for (const sym of Object.keys(p.counts)) if (!elements.includes(sym)) elements.push(sym);
  const m: Frac[][] = elements.map((el) => species.map((s, j) => {
    const p = parsed[j];
    const n = p !== undefined && p.ok ? p.counts[el] ?? 0 : 0;
    return frac(big(s.side === 'left' ? n : -n));
  }));
  // Reduced row echelon form over the rationals.
  const pivotCols: number[] = [];
  let row = 0;
  for (let c = 0; c < cols && row < m.length; c++) {
    let p = row;
    while (p < m.length && (m[p]?.[c] as Frac).n === 0n) p++;
    if (p === m.length) continue;
    [m[row], m[p]] = [m[p] as Frac[], m[row] as Frac[]];
    const pivot = (m[row] as Frac[])[c] as Frac;
    m[row] = (m[row] as Frac[]).map((x) => div(x, pivot));
    for (let r = 0; r < m.length; r++) {
      if (r === row) continue;
      const factor = (m[r] as Frac[])[c] as Frac;
      if (factor.n === 0n) continue;
      m[r] = (m[r] as Frac[]).map((x, k) => sub(x, mul(factor, (m[row] as Frac[])[k] as Frac)));
    }
    pivotCols.push(c);
    row++;
  }
  const free = Array.from({ length: cols }, (_, i) => i).filter((c) => !pivotCols.includes(c));
  if (free.length !== 1) return null;
  const f = free[0] as number;
  const vec: Frac[] = Array.from({ length: cols }, () => frac(0n));
  vec[f] = frac(1n);
  pivotCols.forEach((c, r) => { vec[c] = sub(frac(0n), (m[r] as Frac[])[f] as Frac); });
  let lcm = 1n;
  for (const x of vec) lcm = (lcm * x.d) / gcdBig(lcm, x.d);
  let ints = vec.map((x) => (x.n * lcm) / x.d);
  if (ints.every((x) => x <= 0n)) ints = ints.map((x) => -x);
  if (ints.some((x) => x <= 0n)) return null;
  const g = ints.reduce((a, b) => gcdBig(a, b), 0n);
  ints = ints.map((x) => x / g);
  const out = ints.map((x) => Number(x));
  if (out.some((x) => !Number.isSafeInteger(x) || x < LIMITS.coefficient.min || x > LIMITS.coefficient.max)) return null;
  return out;
}

// ---- the page equation, grading and display ----------------------------------------------------------------------

/** Coefficients, in species order, read from the printed equation text; null when its terms do not match the species. */
export function equationCoefficients(text: string, species: readonly SpeciesLike[]): number[] | null {
  const parts = text.split(/→|⟶|->|=>|⇌|⇄|=/);
  if (parts.length !== 2) return null;
  const terms = (side: string): { coef: number; formula: string }[] | null => {
    const out: { coef: number; formula: string }[] = [];
    for (const raw of side.split('+')) {
      const m = /^\s*(\d+)?\s*(\S+)\s*$/.exec(raw);
      if (m === null) return null;
      out.push({ coef: m[1] === undefined ? 1 : Number(m[1]), formula: cleanFormula(m[2] as string) });
    }
    return out;
  };
  const left = terms(parts[0] as string);
  const right = terms(parts[1] as string);
  if (left === null || right === null) return null;
  const used = { left: new Set<number>(), right: new Set<number>() };
  const coefs: number[] = [];
  for (const s of species) {
    const list = s.side === 'left' ? left : right;
    const taken = s.side === 'left' ? used.left : used.right;
    const idx = list.findIndex((t, i) => !taken.has(i) && t.formula === cleanFormula(s.formula));
    if (idx < 0) return null;
    taken.add(idx);
    const coef = (list[idx] as { coef: number }).coef;
    if (coef < LIMITS.coefficient.min || coef > LIMITS.coefficient.max) return null;
    coefs.push(coef);
  }
  return used.left.size === left.length && used.right.size === right.length ? coefs : null;
}

export type BalanceGrade =
  | { status: 'correct' }
  | { status: 'balanced-multiple'; factor: number }
  | { status: 'unbalanced'; elements: string[] }
  | { status: 'invalid' };

const gcd = (a: number, b: number): number => (b === 0 ? Math.abs(a) : gcd(b, a % b));

export function gradeBalance(species: readonly SpeciesLike[], coefficients: readonly number[], key: readonly number[]): BalanceGrade {
  const valid = coefficients.length === species.length && coefficients.every((c) => Number.isInteger(c) && c >= LIMITS.coefficient.min && c <= LIMITS.coefficient.max);
  if (!valid) return { status: 'invalid' };
  if (coefficients.every((c, i) => c === key[i])) return { status: 'correct' };
  const totals = atomTotals(species, coefficients);
  if (totals === null) return { status: 'invalid' };
  if (!totals.balanced) return { status: 'unbalanced', elements: totals.rows.filter((r) => !r.balanced).map((r) => r.element) };
  const factor = coefficients.reduce((a, b) => gcd(a, b), 0);
  return factor > 1 ? { status: 'balanced-multiple', factor } : { status: 'correct' };
}

/** 'CH4 + 2 O2 → CO2 + 2 H2O' (a coefficient of 1 is not written). */
export function formatEquation(species: readonly SpeciesLike[], coefficients: readonly number[]): string {
  const side = (which: 'left' | 'right'): string =>
    species.flatMap((s, i) => (s.side === which ? [`${coefficients[i] === 1 || coefficients[i] === undefined ? '' : `${coefficients[i]} `}${cleanFormula(s.formula)}`] : [])).join(' + ');
  return `${side('left')} → ${side('right')}`;
}

// ---- the live typeset equation and the atom tally bars (Stage 7c) -------------------------------------------------
// Pure views of atomTotals: the bars never count atoms a second way. A substance's share of a bar is atomTotals with
// every other coefficient set to 0, and the bar totals are atomTotals itself.

export interface EquationTerm { index: number; id: string; side: 'left' | 'right'; formula: string; coefficient: number; written: string; parts: FormulaPart[] }

/** The equation as a chemist writes it: a coefficient of 1 is not written, formulas split into subscript runs. */
export function equationTerms(species: readonly (SpeciesLike & { id: string })[], coefficients: readonly number[]): { left: EquationTerm[]; right: EquationTerm[] } {
  const terms = species.map((s, index): EquationTerm => {
    const coefficient = coefficients[index] ?? 1;
    return { index, id: s.id, side: s.side, formula: cleanFormula(s.formula), coefficient, written: coefficient === 1 ? '' : String(coefficient), parts: formulaParts(s.formula) };
  });
  return { left: terms.filter((t) => t.side === 'left'), right: terms.filter((t) => t.side === 'right') };
}

/** One substance's share of a side's bar, in atom positions [start, end). */
export interface BarSegment { index: number; formula: string; coefficient: number; atoms: number; start: number; end: number }
export interface BarRow {
  element: string;
  left: number;
  right: number;
  balanced: boolean;
  segments: { left: BarSegment[]; right: BarSegment[] };
  /** The longer bar's part past the shorter bar's end; null when level. */
  excess: { side: 'left' | 'right'; from: number; to: number; atoms: number } | null;
  status: string;
}

/** Atoms of each element on each side for the given coefficients, split by substance; null when a formula cannot be parsed. */
export function atomBars(species: readonly SpeciesLike[], coefficients: readonly number[]): BarRow[] | null {
  const totals = atomTotals(species, coefficients);
  if (totals === null) return null;
  const shares = species.map((_, i) => atomTotals(species, coefficients.map((c, k) => (k === i ? c : 0))));
  return totals.rows.map((row) => {
    const segments: BarRow['segments'] = { left: [], right: [] };
    const pos = { left: 0, right: 0 };
    species.forEach((s, i) => {
      const share = shares[i]?.rows.find((r) => r.element === row.element);
      const atoms = share === undefined ? 0 : share.left + share.right;
      if (atoms === 0) return;
      const start = pos[s.side];
      segments[s.side].push({ index: i, formula: cleanFormula(s.formula), coefficient: coefficients[i] ?? 0, atoms, start, end: start + atoms });
      pos[s.side] = start + atoms;
    });
    const diff = row.left - row.right;
    const excess = diff === 0 ? null : diff > 0
      ? { side: 'left' as const, from: row.right, to: row.left, atoms: diff }
      : { side: 'right' as const, from: row.left, to: row.right, atoms: -diff };
    const status = excess === null ? 'level' : `${excess.atoms} more in the ${excess.side === 'left' ? 'reactants' : 'products'}`;
    return { ...row, segments, excess, status };
  });
}

/** A readable bar scale at or above n atoms: 4, 6, 8, 12, 16, 24, 32, 48, ... */
export function barScale(n: number): number {
  let base = 4;
  for (;;) {
    if (n <= base) return base;
    if (n <= base * 1.5) return base * 1.5;
    base *= 2;
  }
}

/**
 * The scale for the current totals: the readable step that fits the largest count, growing and shrinking with it, so
 * removing a big coefficient brings the diagram back to its earlier size (it used to only grow). `previous` is kept in
 * the signature for callers; the scale no longer depends on it.
 */
export function nextBarScale(_previous: number | null, totals: AtomTotals): number {
  const most = totals.rows.reduce((m, r) => Math.max(m, r.left, r.right), 0);
  return barScale(most);
}

export interface FormulaPart { text: string; sub: boolean }

/** Split a formula into plain and subscript runs, for rendering H₂O style text with <sub>. */
export function formulaParts(formula: string): FormulaPart[] {
  const out: FormulaPart[] = [];
  for (const m of cleanFormula(formula).matchAll(/(\d+)|([^\d]+)/g)) {
    const text = m[0];
    const prev = out[out.length - 1];
    const isSub = m[1] !== undefined;
    if (prev !== undefined && prev.sub === isSub) prev.text += text;
    else out.push({ text, sub: isSub });
  }
  return out;
}
