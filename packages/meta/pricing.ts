import type { Usage } from '../contracts/index.ts';

export type ModelChoice = 'muse-spark-1.3' | 'muse-spark-open';
export type MetaProvider = 'meta-api' | 'modal';

export const MODEL_CHOICES: readonly ModelChoice[] = ['muse-spark-1.3', 'muse-spark-open'];
export const META_PROVIDERS: readonly MetaProvider[] = ['meta-api', 'modal'];

export function isModelChoice(v: unknown): v is ModelChoice {
  return v === 'muse-spark-1.3' || v === 'muse-spark-open';
}

export function isMetaProvider(v: unknown): v is MetaProvider {
  return v === 'meta-api' || v === 'modal';
}

export const PRICES_PER_MTOK: Record<ModelChoice, { input: number; cachedInput: number; output: number }> = {
  'muse-spark-1.3': { input: 1.25, cachedInput: 0.15, output: 4.25 },
  'muse-spark-open': { input: 1.25, cachedInput: 0.15, output: 4.25 },
};

export function isValidUsage(usage: Usage): boolean {
  if (typeof usage !== 'object' || usage === null) {
    return false;
  }
  const promptTokens: unknown = (usage as Usage).promptTokens;
  const completionTokens: unknown = (usage as Usage).completionTokens;
  const reasoningTokens: unknown = (usage as Usage).reasoningTokens;
  const cachedTokens: unknown = (usage as Usage).cachedTokens;
  if (
    typeof promptTokens !== 'number' ||
    typeof completionTokens !== 'number' ||
    typeof reasoningTokens !== 'number' ||
    typeof cachedTokens !== 'number'
  ) {
    return false;
  }
  if (
    !Number.isInteger(promptTokens) ||
    !Number.isInteger(completionTokens) ||
    !Number.isInteger(reasoningTokens) ||
    !Number.isInteger(cachedTokens)
  ) {
    return false;
  }
  if (promptTokens < 0 || completionTokens < 0 || reasoningTokens < 0 || cachedTokens < 0) {
    return false;
  }
  if (!Number.isFinite(promptTokens) || !Number.isFinite(completionTokens)) {
    return false;
  }
  if (cachedTokens > promptTokens) {
    return false;
  }
  if (reasoningTokens > completionTokens) {
    return false;
  }
  return true;
}

// Note: cached tokens that a provider does not report are passed in as
// cachedTokens: 0 by the client, so costFromUsage charges the full input
// price for them (conservative). No model-specific adjustment is needed.
export function costFromUsage(model: ModelChoice, usage: Usage): number {
  if (!isModelChoice(model)) {
    throw new Error('UNKNOWN_MODEL');
  }
  if (!isValidUsage(usage)) {
    throw new Error('INVALID_USAGE');
  }
  const prices = PRICES_PER_MTOK[model];
  const uncachedPromptTokens: number = usage.promptTokens - usage.cachedTokens;
  return (
    (uncachedPromptTokens * prices.input +
      usage.cachedTokens * prices.cachedInput +
      usage.completionTokens * prices.output) /
    1e6
  );
}

// Assumption: byte-level BPE tokenizers emit at most one token per byte, so
// this is an upper bound for them; it is not verified against Meta's
// tokenizer. This assumes one token per byte for byte-level BPE; NOT verified
// against Meta's tokenizer; not a hard guarantee.
export function inputTokenBound(
  messages: ReadonlyArray<{ content: string }>,
  jsonSchema: Record<string, unknown>,
): number {
  let bytes = 0;
  for (const m of messages) {
    bytes += Buffer.byteLength(m.content, 'utf8');
  }
  bytes += Buffer.byteLength(JSON.stringify(jsonSchema), 'utf8');
  bytes += 64 * messages.length;
  bytes += 256;
  return bytes;
}

export function reservationUSD(model: ModelChoice, inputTokens: number, maxOutputTokens: number): number {
  if (!isModelChoice(model)) {
    throw new Error('UNKNOWN_MODEL');
  }
  if (typeof inputTokens !== 'number' || !Number.isFinite(inputTokens) || inputTokens < 0) {
    throw new Error('INVALID_AMOUNT');
  }
  if (typeof maxOutputTokens !== 'number' || !Number.isFinite(maxOutputTokens) || maxOutputTokens < 0) {
    throw new Error('INVALID_AMOUNT');
  }
  const prices = PRICES_PER_MTOK[model];
  return (inputTokens * prices.input + maxOutputTokens * prices.output) / 1e6;
}
