// S6-W — labelled demo-fault helpers shared by the v1 activity flow (jobs.ts applyDemoFault)
// and the Stage 6 lesson flow (lesson.ts). A demo fault is a deterministic, SYSTEM-MADE change
// to a generated revision (never presented as a model error); the record is labelled everywhere
// it appears and excluded from quality metrics.
//
// Stage 6 adds two lesson-flow fault families (frozen lesson-flow API contract):
//   fabricated-quote → the FIRST quiz card's quote is replaced with text not on the page
//                      (must fail Q-01); target component quiz-cards-v1.
//   wrong-answer     → the formula explorer's expression is altered (must fail FE-08, else
//                      FE-05/FE-04; the inject event names the failing check); target
//                      component formula-explorer-v1.
// When the plan does not contain the target component the fault is NOT injected and is recorded
// as not effective with a plain reason (lead decision 2026-10-29) — a natural repair is never
// labelled system-made.
import { KIT_LIMITS } from '../../packages/contracts/index.ts';
import type { DemoFault, FaultRecord } from '../../packages/contracts/index.ts';
import type { KitGenComponentId, QuizCardsGen, FormulaExplorerGen } from '../../packages/contracts/kit.ts';
import { normalizeWhitespace } from '../../packages/validation/validate.ts';
import { sha256 } from '../../packages/sources/index.ts';

/** 8 hex chars taken from the job id (its random suffix); hashed fallback for hand-made ids. */
export function nonceFromJobId(jobId: string): string {
  const match = /([0-9a-f]{8})$/.exec(jobId);
  return match !== null ? match[1] : sha256(jobId).slice(0, 8);
}

export function fabricatedQuoteSentence(nonce: string): string {
  return `Muse confirmed this result in a controlled laboratory trial (ref ${nonce}).`;
}

/**
 * The fabricated sentence for a fabricated-quote demo fault, with a nonce derived from the
 * job id and re-derived until the sentence is absent from the source under the validator's
 * whitespace normalisation on BOTH sides (Muse design review decision 18).
 */
export function fabricatedQuoteWithNonce(jobId: string, sourceText: string): string {
  const normalizedSource = normalizeWhitespace(sourceText);
  let nonce = nonceFromJobId(jobId);
  let sentence = fabricatedQuoteSentence(nonce);
  while (normalizedSource.includes(normalizeWhitespace(sentence))) {
    nonce = sha256(nonce).slice(0, 8);
    sentence = fabricatedQuoteSentence(nonce);
  }
  return sentence;
}

/** The kit component a lesson-flow demo fault kind targets (frozen contract: two families only). */
export function lessonFaultTarget(kind: DemoFault): KitGenComponentId {
  return kind === 'fabricated-quote' ? 'quiz-cards-v1' : 'formula-explorer-v1';
}

/**
 * The check ids a lesson-flow demo fault is designed to trip (S5-04 effectiveness is measured
 * against them). fabricated-quote must fail Q-01; wrong-answer must fail FE-08, else FE-05/FE-04
 * (the first of these found failing names the catch in the inject event detail).
 */
export function lessonIntendedChecks(kind: DemoFault): readonly string[] {
  return kind === 'fabricated-quote' ? ['Q-01'] : ['FE-08', 'FE-05', 'FE-04'];
}

/**
 * Apply a lesson-flow demo fault to a clone of a kit component gen (revision 1), in place, and
 * return the FaultRecord describing the change (`effective` is set by the caller after
 * re-validating the faulty revision). Throws DEMO_FAULT_TARGET_MISSING when the gen does not
 * carry the field the fault alters (the caller checks plan membership separately).
 */
export function applyLessonDemoFault(
  kind: DemoFault,
  gen: unknown,
  componentId: KitGenComponentId,
  jobId: string,
  sourceText: string,
): FaultRecord {
  if (kind === 'fabricated-quote') {
    if (componentId !== 'quiz-cards-v1') {
      throw new Error('DEMO_FAULT_TARGET_MISSING');
    }
    const quiz = gen as QuizCardsGen;
    const first = Array.isArray(quiz?.cards) ? quiz.cards[0] : undefined;
    if (first === undefined || typeof first.quote !== 'string') {
      throw new Error('DEMO_FAULT_TARGET_MISSING');
    }
    const original = first.quote;
    // S5-04: absence under the validator's normalisation, not raw includes().
    const sentence = fabricatedQuoteWithNonce(jobId, sourceText);
    first.quote = sentence;
    return { kind, path: '/cards/0/quote', original, injected: sentence, revision: 1 };
  }
  if (kind === 'wrong-answer') {
    if (componentId !== 'formula-explorer-v1') {
      throw new Error('DEMO_FAULT_TARGET_MISSING');
    }
    const explorer = gen as FormulaExplorerGen;
    const expression: unknown = explorer?.expression;
    if (typeof expression !== 'string' || expression === '') {
      throw new Error('DEMO_FAULT_TARGET_MISSING');
    }
    // A wrong expression that still parses and stays inside the frozen schema limits: the
    // added constant term shifts every evaluated point, so FE-08's sample comparison (and a
    // verified FE-05 example, and FE-04's recomputed expectations when stated) must fail.
    const injected = `(${expression}) + 1`;
    if (injected.length > KIT_LIMITS.formulaExplorer.expressionMaxChars) {
      throw new Error('DEMO_FAULT_TARGET_MISSING');
    }
    explorer.expression = injected;
    return { kind, path: '/expression', original: expression, injected, revision: 1 };
  }
  throw new Error('DEMO_FAULT_INVALID');
}
