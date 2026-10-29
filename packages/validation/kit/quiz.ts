// S6-V — quiz-cards-v1 validation (Q-01..Q-07, design §2.2 frozen) + the per-item drop helper
// ("drop bad cards while >= 3 remain, else fail", design §2.2f). The correct answer is ALWAYS
// options[0] pre-shuffle; Q-02/Q-05/Q-07 verify it against the card's own quote with
// whitespace-normalised, case-insensitive matching.
//
// S6R-09 (Stage 6 review): every number in an answer/option/distractor is compared as a WHOLE
// SIGNED numeric token by value, so `2` is not the `2` inside `20`, `2.5`, `-2` or `1,200`, while
// `5` still matches a printed `5.0`. Q-02/Q-05/Q-07 share one predicate (contentOccursWhole) and
// Q-06 uses the signed variant of the shared N-01 numbers check. This is the narrow wrong-token
// class only; it does not claim semantic entailment.

import type { SourceDocument, ValidationCheck, ValidationReport } from '../../contracts/index.ts';
import { KIT_LIMITS } from '../../contracts/kit.ts';
import type { QuizCardsGen } from '../../contracts/kit.ts';
import { guarded } from '../validate.ts';
import {
  buildReport,
  buildSourceIndex,
  collectQuoteFailures,
  contentOccursWhole,
  duplicateOccurrences,
  idProblems,
  itemIndicesWithFailures,
  KIT_FAILURE_MESSAGES,
  lengthProblems,
  numbersCarryingToken,
  numbersCheckProblems,
  numericOptionValue,
  optionalLengthProblems,
} from './shared.ts';

const Q = KIT_LIMITS.quiz;

export interface DroppedItem {
  /** Index in the ORIGINAL gen list. */
  index: number;
  id: string;
  reason: string;
  checks: string[];
}
export interface PruneResult<T> {
  /** The pruned gen, or null when the component cannot be saved by dropping items. */
  gen: T | null;
  dropped: DroppedItem[];
  /** The frozen design failure message when gen is null. */
  failureMessage: string | null;
}

/** Validator-side structural limits beyond the Ajv gen schema (reported under 'schema.gen'). */
export function quizStructuralProblems(gen: QuizCardsGen): { problems: string[]; affected: string[] } {
  const problems: string[] = [];
  const affected: string[] = [];
  const push = (p: string[], ptr: string): void => { if (p.length > 0) { problems.push(...p); affected.push(ptr); } };
  if (typeof gen.title !== 'string' || gen.title === '') { problems.push('title must be a non-empty string'); affected.push('/title'); }
  if (gen.cards.length < Q.cards.min || gen.cards.length > Q.cards.max) {
    problems.push(`cards has ${gen.cards.length} entries, expected ${Q.cards.min}-${Q.cards.max}`);
    affected.push('/cards');
  }
  const ids = gen.cards.map(c => c.id);
  const dups = duplicateOccurrences(ids);
  gen.cards.forEach((card, i) => {
    push(idProblems(`cards[${i}].id`, card.id), `/cards/${i}/id`);
    if (dups.has(card.id)) { problems.push(`card id "${card.id}" occurs more than once (expected unique ids)`); affected.push(`/cards/${i}/id`); }
    if (card.options.length < Q.options.min || card.options.length > Q.options.max) {
      problems.push(`cards[${i}].options has ${card.options.length} entries, expected ${Q.options.min}-${Q.options.max}`);
      affected.push(`/cards/${i}/options`);
    }
    push(lengthProblems(`cards[${i}].stem`, card.stem, Q.stem.min, Q.stem.max), `/cards/${i}/stem`);
    card.options.forEach((opt, j) => {
      push(lengthProblems(`cards[${i}].options[${j}]`, opt, Q.option.min, Q.option.max), `/cards/${i}/options/${j}`);
    });
    push(optionalLengthProblems(`cards[${i}].hint`, card.hint, Q.hint.min, Q.hint.max), `/cards/${i}/hint`);
  });
  return { problems, affected };
}

export function validateQuizCards(gen: QuizCardsGen, sources: SourceDocument[], opts: { revision?: number } = {}): ValidationReport {
  const idx = buildSourceIndex(sources);
  const all = idx.allTexts();
  const structural = quizStructuralProblems(gen);
  const norm = (s: string): string => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().toLowerCase() : '');

  const checks: ValidationCheck[] = [
    structural.problems.length === 0
      ? { id: 'schema.gen', kind: 'schema', passed: true, message: 'every quiz text length, id pattern and id uniqueness is within the frozen limits' }
      : { id: 'schema.gen', kind: 'schema', passed: false, message: `quiz gen failed the structural limits: ${structural.problems.join('; ')}`, path: structural.affected[0], affected: structural.affected },

    guarded('Q-01', 'grounding', () => {
      const { problems, affected, grounded } = collectQuoteFailures(
        gen.cards.map((c, i) => ({ quote: c.quote, sourceId: c.sourceId, quotePtr: `/cards/${i}/quote`, sourceIdPtr: `/cards/${i}/sourceId`, label: `cards[${i}] (${c.id})` })),
        idx,
      );
      return problems.length === 0
        ? { passed: true, message: `all ${grounded} card quote(s) appear verbatim in their cited source after whitespace normalisation (quote-verbatim)` }
        : { passed: false, message: `${problems.join('; ')} (expected verbatim quotes of 1-${KIT_LIMITS.common.quote.max} characters from the cited source)`, path: affected[0], affected };
    }),

    guarded('Q-02', 'semantic', () => {
      const problems: string[] = [];
      const affected: string[] = [];
      gen.cards.forEach((card, i) => {
        const answer = card.options[0];
        if (typeof answer !== 'string') return;
        const quote = card.quote ?? '';
        const match = contentOccursWhole(quote, answer);
        if (!match.contained) {
          problems.push(`cards[${i}] (${card.id}): the correct answer "${answer}" (options[0]) does not occur in the card quote (answer-in-quote)`);
          affected.push(`/cards/${i}/options/0`, `/cards/${i}/quote`);
        } else if (!match.ok) {
          // S6R-09: the text is there, but a number in it is only part of a different number.
          const shown = match.missingNumbers.map(n => `"${n}"`).join(', ');
          const quoteNumbers = [...new Set(match.missingNumbers.flatMap(n => numbersCarryingToken(quote, n)))];
          problems.push(`cards[${i}] (${card.id}): the correct answer "${answer}" states the number ${shown} as a whole number, but the card quote only contains ${quoteNumbers.length === 0 ? 'it inside a different number' : quoteNumbers.map(q => `"${q}"`).join(', ')} there — a number inside a larger number, a decimal or a signed number is a different value (answer-in-quote)`);
          affected.push(`/cards/${i}/options/0`, `/cards/${i}/quote`);
        }
      });
      return problems.length === 0
        ? { passed: true, message: `every card's correct answer options[0] occurs in its quote after normalisation, with any numbers matching as whole signed numbers (answer-in-quote)` }
        : { passed: false, message: problems.join('; '), path: affected[0], affected };
    }),

    guarded('Q-03', 'semantic', () => {
      const problems: string[] = [];
      const affected: string[] = [];
      gen.cards.forEach((card, i) => {
        const opts = card.options.map(norm);
        const dups = duplicateOccurrences(opts.filter(o => o !== ''));
        if (dups.size > 0) {
          problems.push(`cards[${i}] (${card.id}): duplicate options after normalisation: ${[...dups].map(d => `"${d}"`).join(', ')} (expected ${Q.options.min}-${Q.options.max} distinct options)`);
          card.options.forEach((o, j) => { if (dups.has(norm(o))) affected.push(`/cards/${i}/options/${j}`); });
        }
        // S6R-13: `5` and `5.00` are the same answer. Grading keys options[0] by index, so a card
        // with two options of the same value marks one of them wrong whatever the learner picks.
        const byValue = new Map<string, number[]>();
        card.options.forEach((o, j) => {
          const value = numericOptionValue(o);
          if (value === null) return;
          const list = byValue.get(value) ?? [];
          list.push(j);
          byValue.set(value, list);
        });
        for (const [value, indices] of byValue) {
          if (indices.length < 2) continue;
          // Already reported as an exact textual duplicate above.
          if (new Set(indices.map(j => norm(card.options[j] ?? ''))).size !== indices.length) continue;
          const shown = indices.map(j => `options[${j}] "${card.options[j]}"`).join(', ');
          problems.push(`cards[${i}] (${card.id}): ${shown} are the same number ${value} written differently, so a learner picking either gives the same answer but only options[0] is graded correct — expected ${Q.options.min}-${Q.options.max} options that are different values (options-distinct)`);
          indices.forEach(j => affected.push(`/cards/${i}/options/${j}`));
        }
      });
      return problems.length === 0
        ? { passed: true, message: 'every card has distinct options after normalisation, with no two options spelling the same number (options-distinct)' }
        : { passed: false, message: problems.join('; '), path: affected[0], affected };
    }),

    guarded('Q-04', 'semantic', () => {
      const problems: string[] = [];
      const affected: string[] = [];
      gen.cards.forEach((card, i) => {
        const answer = norm(card.options[0] ?? '');
        const stem = norm(card.stem ?? '');
        if (answer !== '' && stem.includes(answer)) {
          problems.push(`cards[${i}] (${card.id}): the stem "${card.stem}" already contains the correct answer "${card.options[0]}" (stem-no-answer-leak)`);
          affected.push(`/cards/${i}/stem`);
        }
      });
      return problems.length === 0
        ? { passed: true, message: 'no stem contains its own correct answer (stem-no-answer-leak)' }
        : { passed: false, message: problems.join('; '), path: affected[0], affected };
    }),

    guarded('Q-05', 'semantic', () => {
      const problems: string[] = [];
      const affected: string[] = [];
      gen.cards.forEach((card, i) => {
        const quote = card.quote ?? '';
        const matching = card.options
          .map((o, j) => ({ o, j }))
          .filter(({ o }) => typeof o === 'string' && o !== '' && contentOccursWhole(quote, o).ok);
        if (matching.length !== 1) {
          problems.push(
            matching.length === 0
              ? `cards[${i}] (${card.id}): no option occurs in the quote, expected exactly one (the correct answer) to match (one-correct)`
              : `cards[${i}] (${card.id}): ${matching.length} options occur in the quote (${matching.map(m => `"${m.o}"`).join(', ')}), expected exactly one — replace a distractor (one-correct)`,
          );
          if (matching.length > 1) matching.forEach(m => affected.push(`/cards/${i}/options/${m.j}`));
          else affected.push(`/cards/${i}/options/0`, `/cards/${i}/quote`);
        }
      });
      return problems.length === 0
        ? { passed: true, message: 'exactly one option per card matches the quote (one-correct)' }
        : { passed: false, message: problems.join('; '), path: affected[0], affected };
    }),

    guarded('Q-06', 'grounding', () => {
      const problems: string[] = [];
      const affected: string[] = [];
      if (typeof gen.title === 'string') {
        const p = numbersCheckProblems('title', gen.title, all);
        if (p.length > 0) { problems.push(...p); affected.push('/title'); }
      }
      gen.cards.forEach((card, i) => {
        const texts = [idx.textOf(card.sourceId), ...all];
        const fields: [string, unknown, string][] = [
          [`cards[${i}].stem`, card.stem, `/cards/${i}/stem`],
          [`cards[${i}].hint`, card.hint, `/cards/${i}/hint`],
          ...card.options.map((o, j) => [`cards[${i}].options[${j}]`, o, `/cards/${i}/options/${j}`] as [string, unknown, string]),
        ];
        for (const [label, text, ptr] of fields) {
          const p = numbersCheckProblems(label, text, texts);
          if (p.length > 0) { problems.push(...p); affected.push(ptr); }
        }
      });
      return problems.length === 0
        ? { passed: true, message: 'every number in stems, options and hints appears on the cited page or in the same quote as that whole signed number (N-01) (numbers-checkable)' }
        : { passed: false, message: problems.join('; '), path: affected[0], affected };
    }),

    guarded('Q-07', 'semantic', () => {
      const problems: string[] = [];
      const affected: string[] = [];
      gen.cards.forEach((card, i) => {
        card.options.slice(1).forEach((opt, k) => {
          const j = k + 1;
          if (typeof opt === 'string' && opt !== '' && contentOccursWhole(card.quote ?? '', opt).ok) {
            problems.push(`cards[${i}] (${card.id}): the distractor "${opt}" (options[${j}]) occurs in the quote — distractors must be discriminating (distractors-not-in-quote)`);
            affected.push(`/cards/${i}/options/${j}`);
          }
        });
      });
      return problems.length === 0
        ? { passed: true, message: 'no distractor occurs in its card quote (distractors-not-in-quote)' }
        : { passed: false, message: problems.join('; '), path: affected[0], affected };
    }),
  ];

  return buildReport('quiz-cards-v1', checks, opts.revision ?? 1);
}

/**
 * Design §2.2(f): drop the cards whose item-scoped checks fail while at least
 * KIT_LIMITS.quiz.cards.min (3) cards remain; when the component cannot be saved the frozen
 * failure message is returned. Revalidates after every drop (small lists; exact results).
 */
export function pruneQuizCards(gen: QuizCardsGen, sources: SourceDocument[]): PruneResult<QuizCardsGen> {
  const failureMessage = KIT_FAILURE_MESSAGES['quiz-cards-v1'] as string;
  let current: QuizCardsGen = { ...gen, cards: [...gen.cards] };
  const dropped: DroppedItem[] = [];
  const originalIndex = current.cards.map((_, i) => i);
  for (;;) {
    const report = validateQuizCards(current, sources);
    if (report.publishable) return { gen: current, dropped, failureMessage: null };
    if (current.cards.length <= Q.cards.min) return { gen: null, dropped, failureMessage };
    const byItem = itemIndicesWithFailures(report, '/cards');
    const itemScoped = [...byItem.entries()].filter(([i]) => i >= 0 && i < current.cards.length);
    if (itemScoped.length === 0) return { gen: null, dropped, failureMessage };
    // Drop the worst card first (most failing checks named against it).
    itemScoped.sort((a, b) => b[1].length - a[1].length || a[0] - b[0]);
    const [i, checks] = itemScoped[0] as [number, string[]];
    const card = current.cards[i] as { id: string };
    dropped.push({ index: originalIndex[i] as number, id: card.id, reason: `card failed ${checks.join(', ')}`, checks });
    current = { ...current, cards: current.cards.filter((_, j) => j !== i) };
    originalIndex.splice(i, 1);
  }
}
