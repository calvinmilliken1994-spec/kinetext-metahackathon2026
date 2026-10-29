// Quiz cards (quiz-cards-v1) view model (pure). The right answer is always the stored FIRST option; the display order is a
// seeded shuffle that never shows it first. Grading is recomputed here from the stored order.

import type { QuizCardsSpec } from '../../../../packages/contracts/kit.ts';
import { seededOrder } from './seeded.ts';

export interface QuizOptionView {
  /** Index in the stored options (0 is the right answer). */
  index: number;
  text: string;
}

export interface QuizCardView {
  id: string;
  stem: string;
  /** '' when the card has no hint. */
  hint: string;
  sourceId: string;
  quote: string;
  options: QuizOptionView[];
}

export interface QuizGrade {
  cardId: string;
  pickedIndex: number;
  correct: boolean;
  pickedText: string;
  correctText: string;
}

export function quizCards(spec: QuizCardsSpec): QuizCardView[] {
  return spec.cards.map((card) => {
    const indices = card.options.map((_, i) => i);
    const order = seededOrder(indices, `${spec.seed}:${card.id}`, { avoidFirst: 0 });
    return {
      id: card.id,
      stem: card.stem,
      hint: card.hint,
      sourceId: card.sourceId,
      quote: card.quote,
      options: order.map((index) => ({ index, text: card.options[index] as string })),
    };
  });
}

/** Grade a pick; null when the card or option does not exist. The answer is the stored first option. */
export function gradeQuizCard(spec: QuizCardsSpec, cardId: string, pickedIndex: number): QuizGrade | null {
  const card = spec.cards.find((c) => c.id === cardId);
  if (card === undefined || !Number.isInteger(pickedIndex) || pickedIndex < 0 || pickedIndex >= card.options.length) return null;
  return {
    cardId,
    pickedIndex,
    correct: pickedIndex === 0,
    pickedText: card.options[pickedIndex] as string,
    correctText: card.options[0] as string,
  };
}

export interface QuizSummary { answered: number; correct: number; total: number; done: boolean }

export function quizSummary(grades: readonly QuizGrade[], total: number): QuizSummary {
  return { answered: grades.length, correct: grades.filter((g) => g.correct).length, total, done: total > 0 && grades.length >= total };
}
