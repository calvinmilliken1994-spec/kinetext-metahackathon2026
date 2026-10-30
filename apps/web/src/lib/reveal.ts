// Predict-then-reveal for the opening scene (Stage 7 item 3). Every view opens on case 1's inputs, so until the class has
// predicted, the numbers that ARE case 1's answer (the engine's checked output wherever it is printed) show a neutral '?'.
// Running any case, moving a slider, a page-value chip, Play or scrubbing reveals them; nothing hides them again.

export type RevealEvent = 'run-case' | 'slider' | 'preset' | 'play' | 'scrub' | 'reset';

/** The neutral placeholder shown instead of a hidden number. */
export const CONCEALED = '?';

/** Hint shown with a hidden value. */
export const CONCEALED_HINT = 'Hidden until you run case 1 or move a slider';

/** Hidden at the start only when there is a first case to predict. */
export function initialConcealed(caseCount: number): boolean {
  return caseCount > 0;
}

/** Reset returns to the opening case but keeps the answer shown; every other interaction reveals it. */
export function nextConcealed(concealed: boolean, event: RevealEvent): boolean {
  if (!concealed) return false;
  return event === 'reset';
}

/** A label with every number replaced by the placeholder ('max height 69.44 m' → 'max height ? m'). */
export function concealNumbers(text: string): string {
  return text.replace(/[-−]?\$?\d[\d,]*(?:\.\d+)?(?:e[-+]?\d+)?/gi, CONCEALED);
}
