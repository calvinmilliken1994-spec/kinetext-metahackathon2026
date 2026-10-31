// Stage 8a V-A — log-ladder-v1 validation (LOG-01..LOG-07, frozen in
// docs/specs/STAGE-8a-subject-engines.md §1b). Product split: Muse writes lesson DATA (the
// scale's name, the page's own factor wording, page-stated rungs with quotes, predict-the-ratio
// case values); our tested engine (packages/kit-engines ladderRatio) COMPUTES every ratio; the
// checks tie the factor, the quantity and every rung value to verbatim page quotes.
//
// Conventions follow the other kit validators (quiz.ts / balance.ts / compare.ts):
//   - every check id is ALWAYS emitted, passing or failing, in frozen order after 'schema.gen';
//   - quotes are whitespace-normalised verbatim matches (collectQuoteFailures / quoteProblems);
//   - rung values match only as WHOLE numeric tokens of their own quote (S6R-09: 6 never
//     matches inside 6.3, 3 never inside 33), accepting the page's printed forms ("5.3");
//   - failing checks carry validator-owned `affected` JSON-pointers into the GEN
//     (/factor, /rungs/1/value, /cases/0/toValue, ...); repair authorization consumes ONLY those;
//   - log-ladder has no dedicated counts check id, so 'schema.gen' owns the rung/case COUNTS
//     (the Ajv gate exempts minItems/maxItems from its short-circuit for exactly this reason,
//     kit/index.ts) plus ids, labels and the non-empty page-word fields.
// Recorded decision: the frozen factor bounds (KIT_LIMITS.logLadder.factor: >1, <=1000) are
// enforced under LOG-02 'factor-stated' — a factor the ladder engine cannot run is not a factor
// the page states — so LOG-06 can fail cleanly (never crash) when LOG-02 already failed.
// BUG-013 (published pH ladder with "Water at pH five" plotted at 6.3): two EXISTING ids were
// extended rather than new ones added (contracts STAGE6_CHECKS and apps/web STAGE6_CHECK_NAMES pin
// the id set): LOG-07 also requires every number a rung label states (digits OR number words,
// statedNumbersIn) to equal that rung's value (multi-number labels: the value must be among them),
// unlocking label+value+quote; LOG-06 also requires case endpoints to BE rung values, not merely
// inside the rung range. LOG-04 already enforced value-in-quote (digits), which the bad gen passed.
// Never throws: malformed input degrades into failed checks (guarded() + local pre-checks).

import type { SourceDocument, ValidationCheck, ValidationReport } from '../../contracts/index.ts';
import { KIT_LIMITS } from '../../contracts/kit.ts';
import type { LogCaseGen, LogLadderGen, LogRungGen } from '../../contracts/kit.ts';
import { ladderRatio } from '../../kit-engines/logLadder.ts';
import { guarded, normalizeWhitespace } from '../validate.ts';
import {
  buildReport,
  buildSourceIndex,
  collectQuoteFailures,
  duplicateOccurrences,
  idProblems,
  lengthProblems,
  numberCutAtQuoteEdge,
  numbersCarryingToken,
  numbersCheckProblems,
  signedNumberTokens,
  signedNumericTokens,
  statedNumbersOrdered,
  truncate,
} from './shared.ts';
import { scaleDirectionProblems } from './log-scales.ts';
import type { EntryQuote } from './shared.ts';

const L = KIT_LIMITS.logLadder;

/**
 * BUG-013 tolerance: a number a rung label states, or a case endpoint, counts as the rung value
 * when they differ by at most this (float-printing noise only; 6.3 written "6.3" is exact).
 */
const VALUE_TOLERANCE = 1e-9;

/**
 * Set A (W-03 / B2-04c): the most whole steps the view may be asked to draw, per case and across the rungs
 * (the factor floor 1.000001 with the 1e12 ratio cap would otherwise allow ~27 million ticks).
 */
export const LADDER_MAX_WHOLE_STEPS = 60;

const NAMING_FILLER = new Set(['of', 'at', 'is', 'about', 'around', 'roughly', 'nearly', 'near', 'approximately', 'level', 'value', 'reading', 'a', 'an', 'the', 'scale', 'on']);

/**
 * Set A (B-02): the number that NAMES a rung label: the first stated number right after the quantity word
 * ("Magnitude 6.3, 5.3 times stronger" names 6.3; "pH of seven" names 7), or a plain digit number right before it
 * ("a 6.3 magnitude quake"). null when no number is attached to the quantity word. Positions are in the
 * whitespace-normalised, lower-cased label.
 */
export function rungNamingNumber(label: unknown, quantity: unknown): number | null {
  if (typeof label !== 'string' || typeof quantity !== 'string') return null;
  const lab = normalizeWhitespace(label).toLowerCase();
  const names = [normalizeWhitespace(quantity).toLowerCase()];
  const bare = names[0]!.replace(/\s+scale$/, '');
  if (bare !== '' && bare !== names[0]) names.push(bare);
  const ordered = statedNumbersOrdered(lab);
  for (const name of names) {
    if (name === '') continue;
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const m of lab.matchAll(new RegExp(`(?<![a-z0-9])${esc}(?![a-z0-9])`, 'g'))) {
      const qs = m.index ?? 0;
      const qe = qs + name.length;
      const after = ordered.find(n => n.start >= qe);
      if (after !== undefined) {
        const between = lab.slice(qe, after.start).split(/[\s=:,]+/).filter(t => t !== '');
        if (between.length <= 3 && between.every(t => NAMING_FILLER.has(t))) return after.value;
      }
      const before = /(\d+(?:\.\d+)?)\s*$/.exec(lab.slice(0, qs));
      if (before !== null) return Number(before[1]);
    }
  }
  return null;
}

/**
 * Whole-phrase occurrence (the same rule algorithm.ts ALG-02 uses, kept local to this slice):
 * `needle` occurs in `haystack` whitespace-normalised and case-insensitively with no letter or
 * digit attached on either side, so "ten times" never matches inside "often times" and "pH"
 * never matches inside "pHs".
 */
function phraseOccursWhole(haystack: unknown, needle: unknown): boolean {
  if (typeof haystack !== 'string' || typeof needle !== 'string') return false;
  const hay = normalizeWhitespace(haystack).toLowerCase();
  const ndl = normalizeWhitespace(needle).toLowerCase();
  if (ndl === '') return false;
  const esc = ndl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![a-z0-9])${esc}(?![a-z0-9])`).test(hay);
}

/** The frozen number words LOG-02 accepts (spec §1b: ten, hundred, thousand). */
const FACTOR_WORDS: Readonly<Record<string, number>> = { ten: 10, hundred: 100, thousand: 1000 };
const FACTOR_WORD_RE = /^(?:(?:a|an|one)\s+)?(ten|hundred|thousand)(?:-?\s?fold|-?\s?times|x)?$/;

/**
 * The factor `factorText` states (spec §1b LOG-02): digits ("32 times", "10-fold", "32"), the
 * number words ten/hundred/thousand with an optional "times"/"-fold"/"fold" ("tenfold",
 * "ten times", "a hundred times"), or null when the wording states no factor at all. A text
 * holding several distinct numbers is ambiguous and states nothing (fail closed).
 */
export function statedFactorOf(factorText: unknown): number | null {
  if (typeof factorText !== 'string') return null;
  const t = normalizeWhitespace(factorText).toLowerCase();
  if (t === '') return null;
  const nums = signedNumericTokens(t);
  if (nums.length === 1) {
    const v = Number(nums[0]);
    return Number.isFinite(v) && v > 0 ? v : null;
  }
  if (nums.length > 1) return null;
  const m = FACTOR_WORD_RE.exec(t.replace(/\s*-\s*/g, '-'));
  if (m !== null) return FACTOR_WORDS[m[1] as string] ?? null;
  return null;
}

/**
 * The canonical printed form of a rung value for whole-token matching (5.3 → "5.3", 7 → "7",
 * -2 → "-2"), or null when the value cannot be compared as a plain printed number (NaN,
 * exponential forms) — callers fail closed on null.
 */
function canonicalRungValue(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const toks = signedNumericTokens(String(value));
  if (toks.length !== 1) return null;
  const canonical = toks[0] as string;
  return Number(canonical) === value ? canonical : null;
}

function rungsOf(gen: LogLadderGen): LogRungGen[] {
  return Array.isArray(gen?.rungs) ? gen.rungs : [];
}

function casesOf(gen: LogLadderGen): LogCaseGen[] {
  return Array.isArray(gen?.cases) ? gen.cases : [];
}

/** Structural limits beyond the Ajv gen schema (reported under 'schema.gen'), incl. list counts. */
export function logLadderStructuralProblems(gen: LogLadderGen): { problems: string[]; affected: string[] } {
  const problems: string[] = [];
  const affected: string[] = [];
  const push = (p: string[], ptr: string): void => { if (p.length > 0) { problems.push(...p); affected.push(ptr); } };
  if (typeof gen?.title !== 'string' || gen.title === '') { problems.push('title must be a non-empty string'); affected.push('/title'); }
  for (const [field, ptr] of [['quantity', '/quantity'], ['factorText', '/factorText'], ['effectPhrase', '/effectPhrase']] as const) {
    const v = gen?.[field];
    if (typeof v !== 'string' || normalizeWhitespace(v) === '') {
      problems.push(`${field} is ${JSON.stringify(v)}, expected the page's non-empty wording`);
      affected.push(ptr);
    }
  }
  const rungs = rungsOf(gen);
  if (!Array.isArray(gen?.rungs) || rungs.length < L.rungs.min || rungs.length > L.rungs.max) {
    problems.push(`rungs has ${Array.isArray(gen?.rungs) ? rungs.length : 'no'} entries, expected ${L.rungs.min}-${L.rungs.max}`);
    affected.push('/rungs');
  }
  const rungIds = rungs.map(r => r?.id).filter((v): v is string => typeof v === 'string');
  const rungDups = duplicateOccurrences(rungIds);
  rungs.forEach((rung, i) => {
    push(idProblems(`rungs[${i}].id`, rung?.id), `/rungs/${i}/id`);
    if (typeof rung?.id === 'string' && rungDups.has(rung.id)) {
      problems.push(`rung id "${rung.id}" occurs more than once (expected unique ids)`);
      affected.push(`/rungs/${i}/id`);
    }
    push(lengthProblems(`rungs[${i}].label`, rung?.label, L.label.min, L.label.max), `/rungs/${i}/label`);
  });
  const cases = casesOf(gen);
  if (!Array.isArray(gen?.cases) || cases.length < L.cases.min || cases.length > L.cases.max) {
    problems.push(`cases has ${Array.isArray(gen?.cases) ? cases.length : 'no'} entries, expected ${L.cases.min}-${L.cases.max}`);
    affected.push('/cases');
  }
  const caseIds = cases.map(c => c?.id).filter((v): v is string => typeof v === 'string');
  const caseDups = duplicateOccurrences(caseIds);
  cases.forEach((c, i) => {
    push(idProblems(`cases[${i}].id`, c?.id), `/cases/${i}/id`);
    if (typeof c?.id === 'string' && caseDups.has(c.id)) {
      problems.push(`case id "${c.id}" occurs more than once (expected unique ids)`);
      affected.push(`/cases/${i}/id`);
    }
  });
  return { problems, affected };
}

export function validateLogLadder(gen: LogLadderGen, sources: SourceDocument[], opts: { revision?: number } = {}): ValidationReport {
  const idx = buildSourceIndex(sources);
  const all = idx.allTexts();
  const structural = logLadderStructuralProblems(gen);
  const rungs = rungsOf(gen);
  const cases = casesOf(gen);
  const factor = gen?.factor;
  const factorUsable = typeof factor === 'number' && Number.isFinite(factor) && factor >= L.factor.min && factor <= L.factor.max;
  const rungValues = rungs.map(r => (typeof r?.value === 'number' && Number.isFinite(r.value) ? r.value : null));
  const knownValues = rungValues.filter((v): v is number => v !== null);

  const checks: ValidationCheck[] = [
    structural.problems.length === 0
      ? { id: 'schema.gen', kind: 'schema', passed: true, message: 'every log-ladder title, page-word field, rung/case count, id and label shape is within the frozen limits' }
      : { id: 'schema.gen', kind: 'schema', passed: false, message: `log-ladder gen failed the structural limits: ${structural.problems.join('; ')}`, path: structural.affected[0], affected: structural.affected },

    guarded('LOG-01', 'grounding', () => {
      const entries: EntryQuote[] = [
        { quote: gen?.quote, sourceId: gen?.sourceId, quotePtr: '/quote', sourceIdPtr: '/sourceId', label: 'ladder quote' },
        ...rungs.map((r, i) => ({
          quote: r?.quote,
          sourceId: r?.sourceId,
          quotePtr: `/rungs/${i}/quote`,
          sourceIdPtr: `/rungs/${i}/sourceId`,
          label: `rungs[${i}] (${String(r?.id)})`,
        })),
      ];
      const { problems, affected, grounded } = collectQuoteFailures(entries, idx);
      return problems.length === 0
        ? { passed: true, message: `all ${grounded} quote(s) appear verbatim in their cited source after whitespace normalisation (quotes-verbatim)` }
        : { passed: false, message: `${problems.join('; ')} (expected verbatim quotes of 1-${KIT_LIMITS.common.quote.max} characters from the cited source)`, path: affected[0], affected };
    }),

    guarded('LOG-02', 'grounding', () => {
      const problems: string[] = [];
      const affected: string[] = [];
      if (!factorUsable) {
        problems.push(`factor is ${JSON.stringify(factor)}, expected a number above 1 and at most ${L.factor.max} — the multiplier per whole step of the scale (factor-stated)`);
        affected.push('/factor');
      }
      const factorText = typeof gen?.factorText === 'string' ? gen.factorText : '';
      if (normalizeWhitespace(factorText) === '') {
        problems.push(`factorText is ${JSON.stringify(gen?.factorText)}, expected the page's own words for the factor (e.g. "ten times", "32 times", "tenfold") (factor-stated)`);
        affected.push('/factorText');
      } else {
        if (!phraseOccursWhole(gen?.quote, factorText)) {
          problems.push(`factorText "${factorText}" does not occur as a whole phrase in the quote "${typeof gen?.quote === 'string' ? gen.quote.slice(0, 60) : String(gen?.quote)}" — the quote must contain the page's own factor wording (factor-stated)`);
          affected.push('/factorText', '/quote');
        }
        const stated = statedFactorOf(factorText);
        if (stated === null) {
          problems.push(`factorText "${factorText}" states no factor: expected digits ("32 times", "10-fold"), a number word (ten, hundred, thousand) or "tenfold"/"N-fold" (factor-stated)`);
          affected.push('/factorText');
        } else if (factorUsable && stated !== factor) {
          problems.push(`factorText "${factorText}" states the factor ${stated}, but factor is ${factor} — the page's wording and the ladder multiplier must be the same number (factor-stated)`);
          affected.push('/factor', '/factorText');
        }
      }
      return problems.length === 0
        ? { passed: true, message: `the quote states the factor in the page's own words: "${factorText}" occurs in the quote and means ${String(factor)} per whole step (factor-stated)` }
        : { passed: false, message: problems.join('; '), path: affected[0], affected };
    }),

    guarded('LOG-03', 'grounding', () => {
      const problems: string[] = [];
      const affected: string[] = [];
      const quantity = typeof gen?.quantity === 'string' ? normalizeWhitespace(gen.quantity) : '';
      if (quantity === '') {
        problems.push(`quantity is ${JSON.stringify(gen?.quantity)}, expected the scale's name as the page writes it (e.g. "pH", "magnitude") (quantity-in-quote)`);
        affected.push('/quantity');
      } else if (!phraseOccursWhole(gen?.quote, quantity)) {
        problems.push(`quantity "${quantity}" does not occur as a whole phrase in the quote "${typeof gen?.quote === 'string' ? gen.quote.slice(0, 60) : String(gen?.quote)}" — the quote must name the scale (quantity-in-quote)`);
        affected.push('/quantity', '/quote');
      }
      // Set A (B-02/W-02): the direction the view prints and grades is bound to a known scale or to the quote.
      const context = [gen?.title, gen?.quote, ...rungs.flatMap(r => [r?.label, r?.quote])].filter((t): t is string => typeof t === 'string').join(' ');
      // The factor pin only applies when LOG-02 already accepts the factor wording (no double reporting).
      const factorWordingOk = typeof gen?.factorText === 'string' && phraseOccursWhole(gen?.quote, gen.factorText) && statedFactorOf(gen.factorText) === gen?.factor;
      for (const d of scaleDirectionProblems({ quantity: gen?.quantity, effectPhrase: gen?.effectPhrase, increasing: gen?.increasing, factor: factorWordingOk ? gen?.factor : null, quote: gen?.quote, context })) {
        problems.push(d.message);
        affected.push(...d.affected);
      }
      return problems.length === 0
        ? { passed: true, message: `the quote names the scale "${quantity}" as a whole phrase and the direction of the effect "${String(gen?.effectPhrase)}" (increasing ${String(gen?.increasing)}) is bound to a known scale or stated by the quote (quantity-in-quote)` }
        : { passed: false, message: problems.join('; '), path: affected[0], affected: [...new Set(affected)] };
    }),

    guarded('LOG-04', 'grounding', () => {
      const problems: string[] = [];
      const affected: string[] = [];
      rungs.forEach((rung, i) => {
        const canonical = canonicalRungValue(rung?.value);
        const quote = typeof rung?.quote === 'string' ? rung.quote : '';
        if (canonical === null) {
          problems.push(`rungs[${i}] (${String(rung?.id)}): value ${JSON.stringify(rung?.value)} is not a finite plain number, so it cannot be matched against the page (rung-values-in-quote)`);
          affected.push(`/rungs/${i}/value`);
          return;
        }
        const tokens = signedNumberTokens(quote).map(t => t.value);
        // Set A (B-04): the matched number must not continue past the quote's edge in the SOURCE (12 cut from 120).
        const cutAtEdge = tokens.includes(canonical) ? numberCutAtQuoteEdge(canonical, quote, typeof rung?.sourceId === 'string' ? idx.textOf(rung.sourceId) : undefined) : { cut: false, printed: null };
        if (cutAtEdge.cut) {
          problems.push(`rungs[${i}] (${String(rung?.id)}): the quote \"${quote.slice(0, 60)}\" ends or starts inside a longer number: the page prints ${cutAtEdge.printed === null ? 'a longer number' : `\"${cutAtEdge.printed}\"`} there, not ${canonical} — quote the whole number (rung-values-in-quote)`);
          affected.push(`/rungs/${i}/value`, `/rungs/${i}/quote`);
          return;
        }
        if (!tokens.includes(canonical)) {
          const carriers = numbersCarryingToken(quote, canonical);
          problems.push(`rungs[${i}] (${String(rung?.id)}): the value ${canonical} does not occur as a whole number in its quote "${quote.slice(0, 60)}"${carriers.length === 0 ? '' : ` — the quote prints ${carriers.map(c => `"${c}"`).join(', ')} there`} (a number inside a larger number, like 3 inside 33 or 6 inside 6.3, is a different value) (rung-values-in-quote)`);
          affected.push(`/rungs/${i}/value`, `/rungs/${i}/quote`);
        }
      });
      return problems.length === 0
        ? { passed: true, message: `all ${rungs.length} rung value(s) occur in their own quote as the same whole number, in the form the page prints (rung-values-in-quote)` }
        : { passed: false, message: problems.join('; '), path: affected[0], affected };
    }),

    guarded('LOG-05', 'semantic', () => {
      const problems: string[] = [];
      const affected: string[] = [];
      const byValue = new Map<string, number[]>();
      rungs.forEach((rung, i) => {
        const canonical = canonicalRungValue(rung?.value);
        if (canonical === null) return;
        const list = byValue.get(canonical) ?? [];
        list.push(i);
        byValue.set(canonical, list);
      });
      for (const [value, indices] of byValue) {
        if (indices.length < 2) continue;
        problems.push(`rungs ${indices.map(i => `rungs[${i}] (${String(rungs[i]?.id)})`).join(', ')} all state the scale value ${value} — every rung must be a distinct point on the scale (rungs-distinct)`);
        indices.forEach(i => affected.push(`/rungs/${i}/value`));
      }
      return problems.length === 0
        ? { passed: true, message: `all ${rungs.length} rung values are distinct points on the scale (rungs-distinct)` }
        : { passed: false, message: problems.join('; '), path: affected[0], affected };
    }),

    guarded('LOG-06', 'behavioral', () => {
      const problems: string[] = [];
      const affected: string[] = [];
      if (knownValues.length === 0) {
        return { passed: false, message: 'no rung states a finite scale value, so the case range cannot be established — fix the rungs first (cases-valid)', path: '/rungs', affected: ['/rungs', ...cases.map((_, i) => `/cases/${i}/fromValue`)] };
      }
      if (!factorUsable) {
        return { passed: false, message: `factor ${JSON.stringify(factor)} is not a usable ladder factor (expected above 1 and at most ${L.factor.max}), so no ratio can be computed — see LOG-02 (cases-valid)`, path: '/factor', affected: ['/factor'] };
      }
      const min = Math.min(...knownValues);
      const max = Math.max(...knownValues);
      // Set A (W-03/B2-04c): a bounded number of whole steps, per axis span and per case, so the view is never
      // asked for millions of ticks (the 1e12 ratio cap alone allows ~27 million steps at factor 1.000001).
      if (max - min > LADDER_MAX_WHOLE_STEPS) {
        problems.push(`the rungs span ${max - min} whole steps (${min} to ${max}); the ladder draws at most ${LADDER_MAX_WHOLE_STEPS} whole steps, so keep the rungs within ${LADDER_MAX_WHOLE_STEPS} of each other`);
        rungValues.forEach((v, i) => { if (v === min || v === max) affected.push(`/rungs/${i}/value`); });
      }
      const ratios: string[] = [];
      cases.forEach((c, i) => {
        const from = c?.fromValue;
        const to = c?.toValue;
        if (typeof from !== 'number' || !Number.isFinite(from)) {
          problems.push(`cases[${i}] (${String(c?.id)}): fromValue is ${JSON.stringify(from)}, expected a finite scale value (cases-valid)`);
          affected.push(`/cases/${i}/fromValue`);
          return;
        }
        if (typeof to !== 'number' || !Number.isFinite(to)) {
          problems.push(`cases[${i}] (${String(c?.id)}): toValue is ${JSON.stringify(to)}, expected a finite scale value (cases-valid)`);
          affected.push(`/cases/${i}/toValue`);
          return;
        }
        if (Math.abs(to - from) > LADDER_MAX_WHOLE_STEPS) {
          problems.push(`cases[${i}] (${String(c?.id)}): from ${from} to ${to} is ${Math.abs(to - from)} whole steps; the ladder draws at most ${LADDER_MAX_WHOLE_STEPS} whole steps per case (cases-valid)`);
          affected.push(`/cases/${i}/fromValue`, `/cases/${i}/toValue`);
          return;
        }
        if (from === to) {
          problems.push(`cases[${i}] (${String(c?.id)}): fromValue and toValue are both ${from} — a ladder case must move between two different scale values (cases-valid)`);
          affected.push(`/cases/${i}/fromValue`, `/cases/${i}/toValue`);
          return;
        }
        if (from < min || from > max) {
          problems.push(`cases[${i}] (${String(c?.id)}): fromValue ${from} is outside the rung range ${min} to ${max} — cases move between points the page states (cases-valid)`);
          affected.push(`/cases/${i}/fromValue`);
        } else if (!knownValues.some(v => Math.abs(v - from) <= VALUE_TOLERANCE)) {
          // BUG-013: inside the range is not enough — a case must start ON a rung the page states.
          problems.push(`cases[${i}] (${String(c?.id)}): fromValue ${from} is not the value of any rung (the rungs sit at ${knownValues.join(', ')}) — a case must start on a rung the page states; set fromValue to one of the rung values (cases-valid)`);
          affected.push(`/cases/${i}/fromValue`);
        }
        if (to < min || to > max) {
          problems.push(`cases[${i}] (${String(c?.id)}): toValue ${to} is outside the rung range ${min} to ${max} — cases move between points the page states (cases-valid)`);
          affected.push(`/cases/${i}/toValue`);
        } else if (!knownValues.some(v => Math.abs(v - to) <= VALUE_TOLERANCE)) {
          problems.push(`cases[${i}] (${String(c?.id)}): toValue ${to} is not the value of any rung (the rungs sit at ${knownValues.join(', ')}) — a case must end on a rung the page states; set toValue to one of the rung values (cases-valid)`);
          affected.push(`/cases/${i}/toValue`);
        }
        let ratio: number;
        try {
          ratio = ladderRatio(factor as number, from, to);
        } catch (err) {
          problems.push(`cases[${i}] (${String(c?.id)}): our ladder engine cannot compute the ratio from ${from} to ${to}: ${err instanceof Error ? err.message : String(err)} (cases-valid)`);
          affected.push(`/cases/${i}/fromValue`, `/cases/${i}/toValue`);
          return;
        }
        if (!Number.isFinite(ratio) || ratio > L.maxRatio) {
          problems.push(`cases[${i}] (${String(c?.id)}): the ratio from ${from} to ${to} is ${ratio}, above the maximum ${L.maxRatio} our engine may ask a class to predict (cases-valid)`);
          affected.push(`/cases/${i}/fromValue`, `/cases/${i}/toValue`);
          return;
        }
        ratios.push(`${from} → ${to} is ${String(Number(ratio.toPrecision(6)))} times`);
      });
      return problems.length === 0
        ? { passed: true, message: `all ${cases.length} case(s) move between distinct values that ARE rungs of this ladder (inside the rung range ${min} to ${max}), and every ratio our engine computes (${ratios.join('; ')}) stays within ${L.maxRatio} (cases-valid)` }
        : { passed: false, message: problems.join('; '), path: affected[0], affected };
    }),

    guarded('LOG-07', 'grounding', () => {
      const problems: string[] = [];
      const affected: string[] = [];
      const check = (label: string, text: unknown, ptr: string, texts: (string | undefined)[]): void => {
        const p = numbersCheckProblems(label, text, texts);
        if (p.length > 0) { problems.push(...p); affected.push(ptr); }
      };
      check('title', gen?.title, '/title', all);
      check('quantity', gen?.quantity, '/quantity', all);
      check('factorText', gen?.factorText, '/factorText', all);
      check('effectPhrase', gen?.effectPhrase, '/effectPhrase', all);
      rungs.forEach((rung, i) => {
        const cited = typeof rung?.sourceId === 'string' ? idx.textOf(rung.sourceId) : undefined;
        check(`rungs[${i}].label`, rung?.label, `/rungs/${i}/label`, [cited, ...all]);
        // BUG-013 label-value agreement: a number the label states (digits OR number words like
        // "five"/"five point six") must be the rung's own value; with several stated numbers (e.g.
        // "pH 7 water, 10 times more acidic than pH 8") the value must be one of them. A label
        // without any number is fine. Unlocks label, value AND quote: an honest repair may reword
        // the label, or move the rung onto the label's number with a quote that prints it (LOG-01
        // and LOG-04 still hold it to the page).
        const value = typeof rung?.value === 'number' && Number.isFinite(rung.value) ? rung.value : null;
        if (value !== null && typeof rung?.label === 'string') {
          const stated = statedNumbersOrdered(rung.label).map(n => n.value);
          if (stated.length > 0) {
            // Set A (B-02): the number that NAMES the rung must equal its value; a different number elsewhere in
            // the label (a factor, a neighbour rung) cannot rescue it. Without a number next to the quantity
            // word, the label's first stated number names the rung.
            const named = rungNamingNumber(rung.label, gen?.quantity) ?? stated[0]!;
            const others = stated.length > 1 ? ` (the label also states ${stated.filter(n => n !== named).join(', ')}, which cannot stand in for it)` : '';
            if (Math.abs(named - value) > VALUE_TOLERANCE) {
              problems.push(`rungs[${i}] (${String(rung?.id)}): the label "${truncate(rung.label, 60)}" names this rung with the number ${named}${others} but the rung sits at ${value} on the scale; the number that names a rung (the one next to the scale word, digits or words) must equal that rung's value — reword the label so its own number is ${value}, or move the rung's value and quote to the number the label names (label-value agreement)`);
              affected.push(`/rungs/${i}/label`, `/rungs/${i}/value`, `/rungs/${i}/quote`);
            }
          }
        }
      });
      return problems.length === 0
        ? { passed: true, message: 'every number in the title, the scale name, the factor wording, the effect phrase and the rung labels appears on the cited page as that whole number (N-01), and every number a rung label states (digits or words) agrees with that rung\'s value (numbers-checkable)' }
        : { passed: false, message: problems.join('; '), path: affected[0], affected };
    }),
  ];

  return buildReport('log-ladder-v1', checks, opts.revision ?? 1);
}
