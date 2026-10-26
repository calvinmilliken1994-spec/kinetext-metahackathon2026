import type { Usage } from '../contracts/index.ts';

export const PRICES_PER_MTOK: Record<'muse-spark-1.3', { input: number; cachedInput: number; output: number }> = {
  'muse-spark-1.3': { input: 1.25, cachedInput: 0.15, output: 4.25 },
};

export function costFromUsage(model: 'muse-spark-1.3', usage: Usage): number {
  const prices = PRICES_PER_MTOK[model];
  const uncachedPromptTokens: number = usage.promptTokens - usage.cachedTokens;
  return (
    (uncachedPromptTokens * prices.input +
      usage.cachedTokens * prices.cachedInput +
      usage.completionTokens * prices.output) /
    1e6
  );
}

export function reservationUSD(model: 'muse-spark-1.3', promptChars: number, maxOutputTokens: number): number {
  const prices = PRICES_PER_MTOK[model];
  const estInputTokens: number = Math.ceil(promptChars / 3);
  return (estInputTokens * prices.input + maxOutputTokens * prices.output) / 1e6;
}
