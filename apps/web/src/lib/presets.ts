// Page-stated presets (Stage 7 item 4a). A value becomes a one-click chip on a slider only when BOTH hold:
//  - the lesson's own cases use it for that input (predictions and behavioural tests), and
//  - the source page states it as a whole number token (so 9.8 does not match inside 19.8 or 9.81, nor V0 or t^2).
// The chip's tooltip is the page sentence that states it, so the teacher sees where the number comes from. Pure; no DOM.

import type { ActivitySpec } from '../../../../packages/contracts/index.ts';
import { sliderModels } from './engines.ts';

export interface NumberToken { value: number; start: number; end: number; text: string }

// A number not glued to a word, a decimal point or an exponent on its left (U0, x.5, t^2), and not continued by more digits
// on its right. Thousands separators ("1,000") and one optional leading minus are part of the token.
const NUMBER = /(?<![\w.^,])-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?![\d]|[.,]\d)/g;

/** Every whole numeric token of the text with its value and character span. */
export function numberTokens(text: string): NumberToken[] {
  const out: NumberToken[] = [];
  for (const m of text.matchAll(NUMBER)) {
    const value = Number(m[0].replace(/,/g, ''));
    if (Number.isFinite(value)) out.push({ value, start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, text: m[0] });
  }
  return out;
}

/** The sentence holding [start, end): bounded by '.', '!' or '?' followed by whitespace, or by a line break. Whitespace collapsed. */
export function sentenceAround(text: string, start: number, end: number): string {
  let a = start;
  while (a > 0) {
    const c = text[a - 1] as string;
    if (c === '\n') break;
    if (/\s/.test(c) && a >= 2 && /[.!?]/.test(text[a - 2] as string)) break;
    a--;
  }
  let b = end;
  while (b < text.length) {
    const c = text[b] as string;
    if (c === '\n') break;
    if (/[.!?]/.test(c) && (b + 1 >= text.length || /\s/.test(text[b + 1] as string))) { b++; break; }
    b++;
  }
  return text.slice(a, b).replace(/\s+/g, ' ').trim();
}

export interface PagePreset {
  value: number;
  /** Value + display unit, e.g. '1.62 m/s²' (the number exactly as the page writes it). */
  label: string;
  /** The page sentence that states the value (tooltip). */
  sentence: string;
}

const same = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

// Set A (W2-05): the page must write the value AS that quantity, i.e. the number followed directly by one of the unit's
// written forms. "The experiment lasts 9.8 seconds" is not a 9.8 m/s² gravity. Units without a known form get no chips.
const METRE = '(?:m|metres?|meters?)';
const UNIT_FORMS: Readonly<Record<string, RegExp>> = {
  // m/s², m/s^2, m/s2, m s^-2, m s⁻², m·s⁻², ms^-2, m/sec², metres per second squared, … per second per second
  'm/s²': new RegExp(`^\\s*(?:m(?:\\s*/\\s*s(?:ec)?\\s*(?:\\^\\s*2|²|2)|[\\s·⋅]*s(?:ec)?\\s*(?:\\^\\s*\\(?\\s*-\\s*2\\s*\\)?|⁻²|-2))(?![\\w²³⁰-⁹^]|\\.\\d)|${METRE}\\s+per\\s+second\\s+(?:squared|per\\s+second)\\b)`, 'iu'),
  // m/s, m s^-1, m s⁻¹, metres per second (but not "per second squared" / "per second per second")
  'm/s': new RegExp(`^\\s*(?:m(?:\\s*/\\s*s(?:ec)?|[\\s·⋅]*s(?:ec)?\\s*(?:\\^\\s*\\(?\\s*-\\s*1\\s*\\)?|⁻¹|-1))(?![\\w²³⁰-⁹⁻^/]|\\s*(?:\\^|²|⁻))|${METRE}\\s+per\\s+second\\b(?!\\s+(?:squared|per\\b)))`, 'iu'),
};
const canonicalUnit = (unit: string): string => {
  const u = unit.replace(/\s+/g, '').replace(/\^2/g, '²').replace(/\*/g, '·');
  return u === 'm/s²' || u === 'm·s⁻²' || u === 'ms⁻²' ? 'm/s²' : u === 'm/s' || u === 'm·s⁻¹' ? 'm/s' : u;
};

/** Whether `after` (the page text right after a number) starts with a written form of `unit` (raw or display form). */
export function unitFollows(after: string, unit: string): boolean {
  const form = UNIT_FORMS[canonicalUnit(unit)];
  return form !== undefined && form.test(after);
}

/** Chips for one slider input, in case order (the opening case first). Values outside the slider range are left out. */
export function pagePresets(spec: ActivitySpec, key: string, sourceText: string | null | undefined): PagePreset[] {
  if (typeof sourceText !== 'string' || sourceText === '') return [];
  const model = sliderModels(spec).find((m) => m.key === key);
  if (model === undefined) return [];
  const cases = [...(spec.predictions as readonly unknown[]), ...(spec.behavioralTests as readonly unknown[])];
  const values: number[] = [];
  for (const c of cases) {
    const v = typeof c === 'object' && c !== null ? (c as Record<string, unknown>)[key] : undefined;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < model.min || v > model.max) continue;
    if (!values.some((x) => same(x, v))) values.push(v);
  }
  // Only tokens that carry the slider's unit on the page count (a 40-character look-ahead covers every written form).
  const tokens = numberTokens(sourceText).filter((t) => unitFollows(sourceText.slice(t.end, t.end + 40), model.unit));
  const out: PagePreset[] = [];
  for (const v of values) {
    const tok = tokens.find((t) => same(t.value, v));
    if (tok === undefined) continue;
    out.push({ value: v, label: `${tok.text} ${model.unit}`, sentence: sentenceAround(sourceText, tok.start, tok.end) });
  }
  return out;
}

/** The chip matching the current slider value, if any. */
export function activePreset(presets: readonly PagePreset[], current: number): PagePreset | null {
  return presets.find((p) => same(p.value, current)) ?? null;
}

/**
 * Values drawn as faint comparison ghosts: the page-stated values other than the current one. Only when the page states at
 * least two (it is then comparing them, e.g. the Moon's 1.62 against the Earth's 9.8).
 */
export function comparisonValues(presets: readonly PagePreset[], current: number): number[] {
  if (presets.length < 2) return [];
  return presets.filter((p) => !same(p.value, current)).map((p) => p.value);
}
