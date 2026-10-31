// Stage 8a V-B — threshold-v1 validation (TH-01..TH-07, frozen spec docs/specs/STAGE-8a-subject-engines.md §1c).
// Muse writes lesson DATA grounded in verbatim page quotes; the tested engine
// (packages/kit-engines/threshold.ts: requiredCount, stagePasses, fractionWords) computes, and these
// checks tie every value to the page:
//   TH-01 quote + totalQuote verbatim (shared collectQuoteFailures convention: an unresolvable
//         sourceId unlocks sourceId AND quote, any other quote problem unlocks the quote only);
//   TH-02 total as a WHOLE numeric token in totalQuote (shared signed-token rule, so a printed
//         "12,104" grounds 12104 but "20" never grounds 2). A page that states the rule but no
//         total (USA.gov impeachment: "simple majority", no member count) honestly fails here;
//   TH-03 the rule is stated IN the quote: majority ⇒ the word "majority"; fraction ⇒ one of the
//         engine's fractionWords(n, d) spellings as a whole phrase ("two-thirds", "three-fourths",
//         "3/4"…); count ⇒ statedCount as a whole numeric token;
//   TH-04 stated-count consistency (and, Set A, the roles of "N of M body": total = M, required = N, body word): with a statedCount > 0 under majority/fraction the engine's
//         requiredCount must equal it (270 = majority of 538; 38 = three-fourths of 50); the count
//         rule requires a page-stated integer 1..total; statedCount 0 means "the page states none";
//   TH-05 scenarios: one integer yes count per stage within [0, total], distinct vectors; the
//         engine (stagePasses) runs every scenario and the message reports each outcome;
//   TH-06 the shared N-01 numbers-checkable rule over the AI-written title, stage bodies and
//         scenario labels (scenario yes counts are engine inputs, not page claims);
//   TH-07 counts and sentinel discipline (a fraction is at most 1): stage/scenario counts within KIT_LIMITS.threshold, total
//         an integer 1..100000, numerator/denominator positive integers exactly for the fraction
//         rule and the 0 sentinel otherwise.
// schema.gen owns the non-quote structural shape (title, id pattern/uniqueness, body/label lengths)
// like the other kit components. Failing checks carry validator-owned `affected` JSON pointers into
// the GEN (the artifact a repair revises), e.g. /stages/0/statedCount, /scenarios/1/yes; every id is
// always emitted, in frozen order, and no check throws (guarded()).

import type { SourceDocument, ValidationCheck, ValidationReport } from '../../contracts/index.ts';
import { KIT_LIMITS } from '../../contracts/kit.ts';
import type { ThresholdGen, ThresholdScenarioGen, ThresholdStageGen } from '../../contracts/kit.ts';
import { fractionWords, requiredCount, stagePasses } from '../../kit-engines/threshold.ts';
import { guarded, QUOTE_MESSAGE_LIMIT } from '../validate.ts';
import {
  buildReport,
  buildSourceIndex,
  collectQuoteFailures,
  duplicateOccurrences,
  idProblems,
  lengthProblems,
  normalizeWhitespace,
  numberCutAtQuoteEdge,
  numbersCheckProblems,
  signedNumberOccursIn,
  truncate,
} from './shared.ts';
import type { EntryQuote } from './shared.ts';

const L = KIT_LIMITS.threshold;

function stagesOf(gen: ThresholdGen): ThresholdStageGen[] {
  return Array.isArray(gen?.stages) ? gen.stages : [];
}
function scenariosOf(gen: ThresholdGen): ThresholdScenarioGen[] {
  return Array.isArray(gen?.scenarios) ? gen.scenarios : [];
}
function yesOf(scenario: ThresholdScenarioGen | undefined): number[] {
  return Array.isArray(scenario?.yes) ? scenario.yes : [];
}

function escapeRegExpLocal(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

/**
 * True when `phrase` occurs in `haystack` as a whole phrase: whitespace-normalised,
 * case-insensitive, with no letter or digit attached on either side (so "majority" never matches
 * inside "majorities" and "3/4" never matches inside "13/45").
 */
export function phraseOccursWhole(haystack: unknown, phrase: unknown): boolean {
  if (typeof haystack !== 'string' || typeof phrase !== 'string') return false;
  const hay = normalizeWhitespace(haystack).toLowerCase();
  const ndl = normalizeWhitespace(phrase).toLowerCase();
  if (hay === '' || ndl === '') return false;
  return new RegExp(`(?<![A-Za-z0-9])${escapeRegExpLocal(ndl)}(?![A-Za-z0-9])`).test(hay);
}

/** Words that follow "N of M" without being the body being counted ("38 of 50 are needed"). */
const NOT_A_BODY = new Set(['are', 'is', 'were', 'was', 'will', 'must', 'to', 'and', 'or', 'in', 'on', 'for', 'the', 'a', 'an', 'be', 'have', 'has', 'can', 'may', 'that', 'which', 'who', 'it', 'as', 'at', 'by', 'with', 'if', 'but', 'so']);

/** One "N of M <body>" / "N out of M <body>" statement of a quote (digits only, after un-grouping thousands). */
export interface NofM { n: number; m: number; body: string | null; text: string }

/**
 * Set A (B-03 / B2-04b): the "N of M body" statements a quote makes ("38 of 50 States", "270 out of 538 electors"):
 * M is the size of the voting body, N the votes it takes, the next word the body. Only plain digit forms count and
 * N must not exceed M; anything else is not parsed (fail open: no statement, no role binding).
 */
export function statedNofM(quote: unknown): NofM[] {
  if (typeof quote !== 'string') return [];
  const text = normalizeWhitespace(quote);
  const out: NofM[] = [];
  const re = /(?<![\d.,])(\d{1,3}(?:,\d{3})+|\d+)\s+(?:of|out\s+of)\s+(?:the\s+)?(\d{1,3}(?:,\d{3})+|\d+)(?![\d]|[.,]\d)(?:\s+([A-Za-z][A-Za-z'-]*))?/gi;
  for (const m of text.matchAll(re)) {
    const n = Number((m[1] as string).replace(/,/g, ''));
    const mm = Number((m[2] as string).replace(/,/g, ''));
    if (!Number.isFinite(n) || !Number.isFinite(mm) || n < 1 || n > mm) continue;
    const word = m[3] !== undefined && !NOT_A_BODY.has(m[3].toLowerCase()) ? m[3] : null;
    out.push({ n, m: mm, body: word, text: m[0] });
  }
  return out;
}

const bodyStem = (w: string): string => {
  const x = w.toLowerCase().replace(/[^a-z]/g, '');
  return x.length >= 4 && x.endsWith('s') && !x.endsWith('ss') ? x.slice(0, -1) : x;
};

/** True when the stage body (AI-written, e.g. "Ratifying states") contains the page's body word, plural-insensitive. */
export function bodyNamesWord(body: unknown, word: string): boolean {
  if (typeof body !== 'string') return false;
  const target = bodyStem(word);
  return target !== '' && (body.match(/[A-Za-z]+/g) ?? []).some(w => bodyStem(w) === target);
}

/** The engine's rule inputs are usable only when these preconditions hold (requiredCount throws otherwise). */
function ruleInputsUsable(stage: ThresholdStageGen): boolean {
  const total = stage?.total;
  if (!Number.isInteger(total) || total < L.total.min || total > L.total.max) return false;
  if (stage?.rule === 'fraction') {
    return Number.isInteger(stage?.numerator) && stage.numerator >= 1
      && Number.isInteger(stage?.denominator) && stage.denominator >= 1
      && stage.numerator <= stage.denominator;
  }
  if (stage?.rule === 'count') {
    return Number.isInteger(stage?.statedCount) && stage.statedCount >= 1 && stage.statedCount <= total;
  }
  return stage?.rule === 'majority';
}

/** Plain-language rendering of what the rule requires, e.g. "a majority of 538" / "three-fourths of 50". */
function describeRule(stage: ThresholdStageGen): string {
  if (stage?.rule === 'fraction' && Number.isInteger(stage?.numerator) && Number.isInteger(stage?.denominator)
    && stage.numerator >= 1 && stage.denominator >= 1) {
    return `${fractionWords(stage.numerator, stage.denominator)[0]} of ${stage.total}`;
  }
  if (stage?.rule === 'majority') return `a majority of ${stage?.total}`;
  return `the stated count of ${stage?.statedCount}`;
}

export function thresholdStructuralProblems(gen: ThresholdGen): { problems: string[]; affected: string[] } {
  const problems: string[] = [];
  const affected: string[] = [];
  const push = (p: string[], ptr: string): void => { if (p.length > 0) { problems.push(...p); affected.push(ptr); } };
  if (typeof gen?.title !== 'string' || gen.title === '') { problems.push('title must be a non-empty string'); affected.push('/title'); }
  const stages = stagesOf(gen);
  const stageIds = stages.map(s => String(s?.id));
  const stageDups = duplicateOccurrences(stageIds);
  stages.forEach((s, i) => {
    push(idProblems(`stages[${i}].id`, s?.id), `/stages/${i}/id`);
    if (stageDups.has(stageIds[i] as string)) {
      problems.push(`stage id "${stageIds[i]}" occurs more than once (expected unique ids)`);
      affected.push(`/stages/${i}/id`);
    }
    push(lengthProblems(`stages[${i}].body`, s?.body, L.body.min, L.body.max), `/stages/${i}/body`);
  });
  const scenarios = scenariosOf(gen);
  const scenarioIds = scenarios.map(s => String(s?.id));
  const scenarioDups = duplicateOccurrences(scenarioIds);
  scenarios.forEach((s, i) => {
    push(idProblems(`scenarios[${i}].id`, s?.id), `/scenarios/${i}/id`);
    if (scenarioDups.has(scenarioIds[i] as string)) {
      problems.push(`scenario id "${scenarioIds[i]}" occurs more than once (expected unique ids)`);
      affected.push(`/scenarios/${i}/id`);
    }
    push(lengthProblems(`scenarios[${i}].label`, s?.label, L.label.min, L.label.max), `/scenarios/${i}/label`);
  });
  return { problems, affected };
}

export function validateThreshold(gen: ThresholdGen, sources: SourceDocument[], opts: { revision?: number } = {}): ValidationReport {
  // Defensive: a direct call with junk degrades into failed checks, never a throw.
  const g = (typeof gen === 'object' && gen !== null ? gen : {}) as ThresholdGen;
  const idx = buildSourceIndex(Array.isArray(sources) ? sources : []);
  const all = idx.allTexts();
  const structural = thresholdStructuralProblems(g);
  const stages = stagesOf(g);
  const scenarios = scenariosOf(g);

  const checks: ValidationCheck[] = [
    structural.problems.length === 0
      ? { id: 'schema.gen', kind: 'schema', passed: true, message: 'every threshold title, stage id, body, scenario id and label shape is within the frozen limits' }
      : { id: 'schema.gen', kind: 'schema', passed: false, message: `threshold gen failed the structural limits: ${structural.problems.join('; ')}`, path: structural.affected[0], affected: structural.affected },

    guarded('TH-01', 'grounding', () => {
      const entries: EntryQuote[] = [];
      stages.forEach((s, i) => {
        entries.push({ quote: s?.quote, sourceId: s?.sourceId, quotePtr: `/stages/${i}/quote`, sourceIdPtr: `/stages/${i}/sourceId`, label: `stages[${i}].quote` });
        entries.push({ quote: s?.totalQuote, sourceId: s?.sourceId, quotePtr: `/stages/${i}/totalQuote`, sourceIdPtr: `/stages/${i}/sourceId`, label: `stages[${i}].totalQuote` });
      });
      const { problems, affected, grounded } = collectQuoteFailures(entries, idx);
      return problems.length === 0
        ? { passed: true, message: `all ${grounded} stage quote(s) (rule quote and total quote) appear verbatim in their cited source after whitespace normalisation (quotes-verbatim)` }
        : { passed: false, message: `${problems.join('; ')} (expected verbatim quotes of 1-${KIT_LIMITS.common.quote.max} characters copied from the cited source)`, path: affected[0], affected };
    }),

    guarded('TH-02', 'grounding', () => {
      const problems: string[] = [];
      const affected: string[] = [];
      stages.forEach((s, i) => {
        const total = s?.total;
        // A non-integer total is the Ajv gate's / TH-07's job; TH-02 checks the grounding of a stated total.
        if (!Number.isInteger(total)) return;
        if (typeof s?.totalQuote !== 'string') return; // TH-01 already fails the missing quote
        if (!signedNumberOccursIn(String(total), s.totalQuote)) {
          problems.push(`stages[${i}]: the total ${total} does not occur as that whole number in totalQuote "${truncate(s.totalQuote, QUOTE_MESSAGE_LIMIT)}" — the page itself must state the total (a page that states only the rule, without the number of voters, cannot ground it)`);
          affected.push(`/stages/${i}/total`, `/stages/${i}/totalQuote`);
        } else {
          // Set A (B-04): the total must not continue past the quote's edge in the source ("5" cut from "50").
          const cut = numberCutAtQuoteEdge(String(total), s.totalQuote, typeof s?.sourceId === 'string' ? idx.textOf(s.sourceId) : undefined);
          if (cut.cut) {
            problems.push(`stages[${i}]: the total ${total} sits at the edge of totalQuote "${truncate(s.totalQuote, QUOTE_MESSAGE_LIMIT)}" and the page prints ${cut.printed === null ? 'a longer number' : `"${cut.printed}"`} there — quote the whole number`);
            affected.push(`/stages/${i}/total`, `/stages/${i}/totalQuote`);
          }
        }
      });
      return problems.length === 0
        ? { passed: true, message: `every stage total occurs as a whole number in its totalQuote, so the page states the size of each voting body (total-in-quote)` }
        : { passed: false, message: problems.join('; '), path: affected[0], affected };
    }),

    guarded('TH-03', 'grounding', () => {
      const problems: string[] = [];
      const affected: string[] = [];
      stages.forEach((s, i) => {
        const rule = s?.rule;
        const quote = typeof s?.quote === 'string' ? s.quote : '';
        const shown = truncate(quote, QUOTE_MESSAGE_LIMIT);
        if (rule === 'majority') {
          if (!phraseOccursWhole(quote, 'majority')) {
            problems.push(`stages[${i}]: the rule is majority but the word "majority" does not occur in the quote "${shown}" — quote the sentence where the page states the rule`);
            affected.push(`/stages/${i}/rule`, `/stages/${i}/quote`);
          }
        } else if (rule === 'fraction') {
          const n = s?.numerator;
          const d = s?.denominator;
          if (!Number.isInteger(n) || n < 1 || !Number.isInteger(d) || d < 1) {
            problems.push(`stages[${i}]: the fraction rule needs a positive numerator and denominator, got ${JSON.stringify(n)}/${JSON.stringify(d)}`);
            affected.push(`/stages/${i}/numerator`, `/stages/${i}/denominator`);
          } else {
            const words = fractionWords(n, d);
            if (!words.some(w => phraseOccursWhole(quote, w))) {
              problems.push(`stages[${i}]: none of the fraction spellings of ${n}/${d} (${words.map(w => `"${w}"`).join(', ')}) occurs as a whole phrase in the quote "${shown}" — the quote must state the fraction the page uses (a "two-thirds" quote belongs to numerator 2, denominator 3, not 3/4)`);
              affected.push(`/stages/${i}/numerator`, `/stages/${i}/denominator`, `/stages/${i}/quote`);
            }
          }
        } else if (rule === 'count') {
          const sc = s?.statedCount;
          if (!Number.isInteger(sc) || sc < 1 || !signedNumberOccursIn(String(sc), quote)) {
            problems.push(`stages[${i}]: the count rule needs the page-stated required count, but ${JSON.stringify(sc)} does not occur as that whole number in the quote "${shown}"`);
            affected.push(`/stages/${i}/statedCount`, `/stages/${i}/quote`);
          } else {
            const cut = numberCutAtQuoteEdge(String(sc), quote, typeof s?.sourceId === 'string' ? idx.textOf(s.sourceId) : undefined);
            if (cut.cut) {
              problems.push(`stages[${i}]: the count ${sc} sits at the edge of the quote "${shown}" and the page prints ${cut.printed === null ? 'a longer number' : `"${cut.printed}"`} there — quote the whole number`);
              affected.push(`/stages/${i}/statedCount`, `/stages/${i}/quote`);
            }
          }
        } else {
          problems.push(`stages[${i}].rule is ${JSON.stringify(rule)}, expected majority, fraction or count`);
          affected.push(`/stages/${i}/rule`);
        }
      });
      return problems.length === 0
        ? { passed: true, message: 'every stage quote states its rule in the page\'s own words: "majority", a whole fraction spelling ("two-thirds", "three-fourths", …), or the stated count as a whole number (rule-in-quote)' }
        : { passed: false, message: problems.join('; '), path: affected[0], affected };
    }),

    guarded('TH-04', 'behavioral', () => {
      const problems: string[] = [];
      const affected: string[] = [];
      const agreed: string[] = [];
      // Set A (B-03 / B2-04b): when a quote states "N of M <body>" ("38 of 50 States"), the stage's total must be M,
      // its required count (the count rule's number, or what the fraction/majority rule computes) must be N, and its
      // body must name the page's body word. A statement that matches no reading of the stage is reported by role.
      stages.forEach((s, i) => {
        const stated = [...statedNofM(s?.quote), ...statedNofM(s?.totalQuote)].filter((p, k, all) => all.findIndex(q => q.n === p.n && q.m === p.m && q.body === p.body) === k);
        if (stated.length === 0) return;
        type Found = { message: string; paths: string[] };
        const evaluate = (p: NofM): Found[] => {
          const out: Found[] = [];
          if (Number.isInteger(s?.total) && s.total !== p.m) {
            out.push({ message: `stages[${i}]: the page says "${p.text}": the voting body has ${p.m} members, so total must be ${p.m} (not ${s.total}); ${p.n} is the number of votes it takes`, paths: [`/stages/${i}/total`, `/stages/${i}/totalQuote`] });
          } else {
            let need: number | null = null;
            if (s?.rule === 'count') need = Number.isInteger(s?.statedCount) ? s.statedCount : null;
            else if (ruleInputsUsable(s)) need = requiredCount(s);
            if (need !== null && need !== p.n) {
              out.push({ message: `stages[${i}]: the page says "${p.text}": ${p.n} of ${p.m} are required, but this stage requires ${need} of ${s.total} (${s.rule === 'count' ? `statedCount ${s.statedCount}` : describeRule(s)}); the required count is ${p.n}, never the total ${p.m}`, paths: [`/stages/${i}/statedCount`, `/stages/${i}/numerator`, `/stages/${i}/denominator`, `/stages/${i}/rule`] });
            }
          }
          if (p.body !== null && !bodyNamesWord(s?.body, p.body)) {
            out.push({ message: `stages[${i}]: the page counts "${p.body}" ("${p.text}"), but the stage body is "${String(s?.body)}"; name the body the page counts`, paths: [`/stages/${i}/body`] });
          }
          return out;
        };
        const results = stated.map(p => ({ p, found: evaluate(p) }));
        if (results.some(r => r.found.length === 0)) return;
        const best = results.reduce((a, b) => (b.found.length < a.found.length ? b : a));
        for (const f of best.found) { problems.push(f.message); affected.push(...f.paths); }
      });
      stages.forEach((s, i) => {
        const sc = s?.statedCount;
        if (!Number.isInteger(sc) || sc < 0) {
          problems.push(`stages[${i}].statedCount is ${JSON.stringify(sc)}, expected the count the page states or the 0 sentinel when the page states none`);
          affected.push(`/stages/${i}/statedCount`);
          return;
        }
        if (s?.rule === 'count') {
          const total = s?.total;
          if (sc < 1) {
            problems.push(`stages[${i}]: the count rule requires the page-stated required count, but statedCount is 0 (expected an integer 1..${JSON.stringify(total)})`);
            affected.push(`/stages/${i}/statedCount`);
          } else if (Number.isInteger(total) && sc > total) {
            problems.push(`stages[${i}]: statedCount ${sc} is greater than the total ${total} — the required count cannot exceed the voting body`);
            affected.push(`/stages/${i}/statedCount`);
          } else {
            agreed.push(`stages[${i}]: the page states ${sc}`);
          }
          return;
        }
        if (s?.rule !== 'majority' && s?.rule !== 'fraction') return; // TH-03 flags an unknown rule
        if (sc === 0) {
          agreed.push(`stages[${i}]: the page states no count, the engine computes ${ruleInputsUsable(s) ? requiredCount(s) : '—'}`);
          return;
        }
        if (!ruleInputsUsable(s)) {
          problems.push(`stages[${i}]: the engine cannot compute the required count for these stage numbers, so statedCount ${sc} cannot be checked (fix total, numerator and denominator first)`);
          affected.push(`/stages/${i}/statedCount`);
          return;
        }
        const need = requiredCount(s);
        if (need !== sc) {
          problems.push(`stages[${i}]: the page-stated count ${sc} is not the count the rule requires — ${describeRule(s)} is ${need} (270 = majority of 538; 38 = three-fourths of 50)`);
          affected.push(`/stages/${i}/statedCount`);
        } else {
          agreed.push(`stages[${i}]: ${sc} = ${describeRule(s)}`);
        }
      });
      return problems.length === 0
        ? { passed: true, message: `every page-stated required count equals the count our engine computes from the rule (${agreed.join('; ') || 'no stage states a count'}) (stated-count-consistent)` }
        : { passed: false, message: problems.join('; '), path: affected[0], affected };
    }),

    guarded('TH-05', 'semantic', () => {
      const problems: string[] = [];
      const affected: string[] = [];
      const n = stages.length;
      const seen = new Map<string, number>();
      scenarios.forEach((sc, i) => {
        const yes = Array.isArray(sc?.yes) ? sc.yes : null;
        if (yes === null) {
          problems.push(`scenarios[${i}].yes is ${JSON.stringify(sc?.yes)}, expected an array with one integer yes count per stage`);
          affected.push(`/scenarios/${i}/yes`);
          return;
        }
        if (yes.length !== n) {
          problems.push(`scenarios[${i}] has ${yes.length} yes counts; it needs one per stage (${n})`);
          affected.push(`/scenarios/${i}/yes`);
        }
        yes.forEach((y, j) => {
          if (!Number.isInteger(y)) {
            problems.push(`scenarios[${i}].yes[${j}] is ${JSON.stringify(y)}, expected an integer`);
            affected.push(`/scenarios/${i}/yes`);
            return;
          }
          const total = stages[j]?.total;
          if (y < 0 || (Number.isInteger(total) && y > total)) {
            problems.push(`scenarios[${i}].yes[${j}] is ${y}, expected an integer within 0..${JSON.stringify(total)} (a yes count can never exceed the voting body)`);
            affected.push(`/scenarios/${i}/yes`);
          }
        });
        const key = JSON.stringify(yes);
        const prior = seen.get(key);
        if (prior !== undefined) {
          problems.push(`scenarios[${i}] repeats the yes counts of scenarios[${prior}] (${key}); every try-it scenario must be distinct`);
          affected.push(`/scenarios/${i}/yes`);
        } else {
          seen.set(key, i);
        }
      });
      // Run the engine over every scenario so the teacher-facing message can state each outcome.
      // An unusable stage (bad total/sentinels) is TH-04/TH-07's finding, not a second TH-05 failure.
      const outcomes: string[] = [];
      scenarios.forEach((sc, i) => {
        const yes = yesOf(sc);
        const label = typeof sc?.label === 'string' ? sc.label : `scenarios[${i}]`;
        if (yes.length !== n || n === 0) return;
        try {
          outcomes.push(`"${truncate(label, 40)}" ${stages.every((st, j) => stagePasses(st, yes[j] as number)) ? 'passes' : 'falls short'}`);
        } catch {
          outcomes.push(`"${truncate(label, 40)}" cannot run (its stage numbers are flagged above)`);
        }
      });
      return problems.length === 0
        ? { passed: true, message: `every scenario holds one distinct integer yes count per stage, each within 0..total, and the engine runs them all: ${outcomes.join('; ') || 'no scenarios to run'} (scenarios-valid)` }
        : { passed: false, message: problems.join('; '), path: affected[0], affected };
    }),

    guarded('TH-06', 'grounding', () => {
      const problems: string[] = [];
      const affected: string[] = [];
      const check = (label: string, text: unknown, ptr: string): void => {
        const p = numbersCheckProblems(label, text, all);
        if (p.length > 0) { problems.push(...p); affected.push(ptr); }
      };
      check('title', g.title, '/title');
      stages.forEach((s, i) => check(`stages[${i}].body`, s?.body, `/stages/${i}/body`));
      scenarios.forEach((s, i) => check(`scenarios[${i}].label`, s?.label, `/scenarios/${i}/label`));
      return problems.length === 0
        ? { passed: true, message: 'every number in the title, the stage bodies and the scenario labels appears on a provided page (N-01); scenario yes counts are engine inputs, not page claims (numbers-checkable)' }
        : { passed: false, message: problems.join('; '), path: affected[0], affected };
    }),

    guarded('TH-07', 'semantic', () => {
      const problems: string[] = [];
      const affected: string[] = [];
      if (stages.length < L.stages.min || stages.length > L.stages.max) {
        problems.push(`stages has ${stages.length} entries, expected ${L.stages.min}-${L.stages.max}`);
        affected.push('/stages');
      }
      if (scenarios.length < L.scenarios.min || scenarios.length > L.scenarios.max) {
        problems.push(`scenarios has ${scenarios.length} entries, expected ${L.scenarios.min}-${L.scenarios.max}`);
        affected.push('/scenarios');
      }
      stages.forEach((s, i) => {
        const total = s?.total;
        if (!Number.isInteger(total) || total < L.total.min || total > L.total.max) {
          problems.push(`stages[${i}].total is ${JSON.stringify(total)}, expected an integer ${L.total.min}-${L.total.max}`);
          affected.push(`/stages/${i}/total`);
        }
        const n = s?.numerator;
        const d = s?.denominator;
        if (s?.rule === 'fraction') {
          if (!Number.isInteger(n) || n < 1) {
            problems.push(`stages[${i}].numerator is ${JSON.stringify(n)}, expected a positive integer for the fraction rule`);
            affected.push(`/stages/${i}/numerator`);
          }
          if (!Number.isInteger(d) || d < 1) {
            problems.push(`stages[${i}].denominator is ${JSON.stringify(d)}, expected a positive integer for the fraction rule`);
            affected.push(`/stages/${i}/denominator`);
          }
          if (Number.isInteger(n) && Number.isInteger(d) && n >= 1 && d >= 1 && n > d) {
            problems.push(`stages[${i}]: the fraction ${n}/${d} is above 1, so no vote count can ever reach it; a threshold fraction is at most 1 (numerator at most the denominator)`);
            affected.push(`/stages/${i}/numerator`, `/stages/${i}/denominator`);
          }
        } else if ((n !== 0 && n !== undefined) || (d !== 0 && d !== undefined)) {
          problems.push(`stages[${i}]: numerator ${JSON.stringify(n)} and denominator ${JSON.stringify(d)} must be the 0 sentinel unless the rule is fraction`);
          affected.push(`/stages/${i}/numerator`, `/stages/${i}/denominator`);
        }
      });
      return problems.length === 0
        ? { passed: true, message: `the shape is valid: ${stages.length} stage(s) (${L.stages.min}-${L.stages.max}), ${scenarios.length} scenario(s) (${L.scenarios.min}-${L.scenarios.max}), every total an integer ${L.total.min}-${L.total.max}, and the fraction sentinels agree with each rule (counts-valid)` }
        : { passed: false, message: problems.join('; '), path: affected[0], affected };
    }),
  ];

  return buildReport('threshold-v1', checks, opts.revision ?? 1);
}
