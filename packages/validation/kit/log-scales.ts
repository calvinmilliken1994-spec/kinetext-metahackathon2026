// Set A (reviews B-02 / W-02): the DIRECTION of a log ladder. `increasing` says whether the effect grows as
// the scale value rises, and the view prints and grades from it, but the old checks never grounded it: the real
// USGS earthquake quote with only `increasing` flipped published "magnitude 6.3 has LESS amplitude than 5.3".
//
// Binding (an allow-list, never a prose recogniser):
//   1. a small catalogue of well-known scales, keyed by the quantity wording (and, for the shared word
//      "magnitude", by the page context): pH (higher = less acidic), earthquake magnitude (higher = larger
//      amplitude / more energy), decibels (higher = louder / more intense), stellar magnitude (higher = dimmer).
//      The effectPhrase's effect word picks the catalogue class; a leading "less/fewer/lower…" flips it;
//      `increasing` must equal the result. Some classes also pin the factor (amplitude x10, energy about x32),
//      which stops the amplitude factor being reused for energy release.
//   2. any other ladder (quantity not in the catalogue, or an effect word the catalogue does not classify)
//      must have its direction STATED by the cited quote: every content word of the effectPhrase occurs in the
//      quote, and the quote carries a comparison word (more, less, larger, increase, ...). That fixes the words
//      of the effect but cannot prove the direction on its own; it is the weaker, disclosed rule.
// Pure; never throws.

export interface ScaleDirectionInput {
  quantity: unknown;
  effectPhrase: unknown;
  increasing: unknown;
  factor: unknown;
  quote: unknown;
  /** Extra page words used only to pick a catalogue entry for the shared word "magnitude" (title, rung quotes). */
  context: string;
}

export interface ScaleDirectionProblem {
  message: string;
  /** Gen fields a repair may change to fix it. */
  affected: string[];
}

interface EffectClass {
  name: string;
  words: RegExp;
  /** True when the effect grows as the scale value rises. */
  grows: boolean;
  /** Pinned per-step factor range for this effect on this scale, when the scale defines one. */
  factor?: { min: number; max: number };
}

interface KnownScale {
  id: string;
  quantity: RegExp;
  /** Page words that must (and, for `notContext`, must not) occur for the shared quantity word. */
  context?: RegExp;
  notContext?: RegExp;
  classes: EffectClass[];
  /** Plain statement of the direction, for messages. */
  higherMeans: string;
}

export const KNOWN_SCALES: readonly KnownScale[] = [
  {
    id: 'pH',
    quantity: /^(?:the\s+)?p\.?h(?:\s+(?:scale|value|level))?$/,
    classes: [
      { name: 'acidity', words: /\b(?:acid|acids|acidic|acidity)\b/, grows: false },
      { name: 'basicity', words: /\b(?:basic|basicity|alkaline|alkalinity|alkali|base)\b/, grows: true },
    ],
    higherMeans: 'a higher pH value is less acidic (more basic)',
  },
  {
    id: 'earthquake magnitude',
    quantity: /^(?:the\s+)?(?:(?:earthquake|seismic|moment|richter|local)\s+)*(?:magnitude|scale)$|^(?:the\s+)?richter(?:\s+scale)?$/,
    context: /\b(?:earthquakes?|seismic|seismograph\w*|richter|quakes?|tremors?)\b/,
    notContext: /\b(?:stars?|stellar|starlight|constellations?|telescopes?)\b/,
    classes: [
      { name: 'amplitude', words: /\b(?:amplitudes?|ground motion|shaking)\b/, grows: true, factor: { min: 9.99, max: 10.01 } },
      { name: 'energy', words: /\b(?:energy|energies)\b/, grows: true, factor: { min: 30, max: 33 } },
      { name: 'size', words: /\b(?:stronger|larger|bigger|greater|powerful|strong|large|big)\b/, grows: true },
    ],
    higherMeans: 'a higher earthquake magnitude is a larger amplitude and more energy released',
  },
  {
    id: 'decibels',
    quantity: /^(?:the\s+)?(?:decibels?|dba?|sound(?:\s+(?:pressure|intensity))?\s+level|sound\s+level|loudness)$/,
    classes: [
      { name: 'loudness', words: /\b(?:loud|louder|loudness|intense|intensity|noisy|noise|power|powerful|energy|pressure)\b/, grows: true },
    ],
    higherMeans: 'a higher decibel value is louder (more intense)',
  },
  {
    id: 'stellar magnitude',
    quantity: /^(?:the\s+)?(?:(?:apparent|absolute|stellar|visual)\s+)*magnitude$/,
    context: /\b(?:stars?|stellar|starlight|constellations?|telescopes?|apparent magnitude|absolute magnitude|luminosity)\b/,
    notContext: /\b(?:earthquakes?|seismic|richter|quakes?)\b/,
    classes: [
      { name: 'brightness', words: /\b(?:bright|brighter|brightest|brightness|luminous|luminosity)\b/, grows: false },
      { name: 'dimness', words: /\b(?:dim|dimmer|dimmest|dimness|faint|fainter|faintest|faintness)\b/, grows: true },
    ],
    higherMeans: 'a higher stellar magnitude is a dimmer star',
  },
];

const FLIP_WORDS = /\b(?:less|fewer|lower|weaker|smaller|decrease|decreases|decreased|reduced|reduces|reduction|lowers)\b/;

const STOP_WORDS = new Set(['a', 'an', 'the', 'of', 'in', 'to', 'and', 'or', 'is', 'are', 'was', 'be', 'by', 'for', 'on', 'at', 'as', 'with', 'more', 'less', 'fewer', 'much', 'many', 'very']);
const COMPARISON_WORDS = /\b(?:more|less|fewer|larger|smaller|greater|higher|lower|stronger|weaker|bigger|faster|slower|increase\w*|decrease\w*|rises?|grows?|falls?|drops?|than|times|\w+fold)\b/;

function normal(text: unknown): string {
  return typeof text === 'string' ? text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim() : '';
}

/** The catalogue entry the ladder's quantity names (with page context for the shared word "magnitude"), or null. */
export function knownScaleOf(quantity: unknown, context: string): KnownScale | null {
  const q = normal(quantity).replace(/[^\p{L}\p{N}.\s]/gu, '').replace(/\s+/g, ' ').trim();
  if (q === '') return null;
  const ctx = normal(context);
  const hits = KNOWN_SCALES.filter(sc => {
    if (!sc.quantity.test(q)) return false;
    // A quantity that names its own domain ("Richter scale", "earthquake magnitude") needs no context words.
    const selfNamed = /(?:earthquake|seismic|richter|moment|stellar|apparent|absolute|visual)/.test(q);
    if (sc.context !== undefined && !selfNamed && !sc.context.test(ctx)) return false;
    if (sc.notContext !== undefined && sc.notContext.test(ctx) && !selfNamed) return false;
    return true;
  });
  return hits.length === 1 ? hits[0]! : null;
}

function stem(word: string): string {
  return word.length >= 4 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word;
}

/** Plain problems with the ladder's direction; empty when the direction is bound to the catalogue or the quote. */
export function scaleDirectionProblems(input: ScaleDirectionInput): ScaleDirectionProblem[] {
  const effect = normal(input.effectPhrase);
  if (effect === '' || typeof input.increasing !== 'boolean') return []; // schema.gen and the Ajv gate own these
  const scale = knownScaleOf(input.quantity, input.context);
  if (scale !== null) {
    const cls = scale.classes.find(c => c.words.test(effect));
    if (cls !== undefined) {
      const flip = FLIP_WORDS.test(effect);
      const expected = flip ? !cls.grows : cls.grows;
      const out: ScaleDirectionProblem[] = [];
      if (input.increasing !== expected) {
        out.push({
          message: `increasing is ${String(input.increasing)}, but on the ${scale.id} scale ${scale.higherMeans}, so "${String(input.effectPhrase)}" grows as the value rises only when increasing is ${String(expected)} — set increasing to ${String(expected)} or reword the effect (direction-bound)`,
          affected: ['/increasing', '/effectPhrase'],
        });
      }
      const factor = typeof input.factor === 'number' && Number.isFinite(input.factor) ? input.factor : null;
      if (cls.factor !== undefined && factor !== null && (factor < cls.factor.min || factor > cls.factor.max)) {
        out.push({
          message: `the ${scale.id} scale changes ${cls.name} by ${cls.factor.min === 9.99 ? 'a factor of 10' : `about ${cls.factor.min} to ${cls.factor.max} times`} per whole step, not ${factor}: the factor on the page belongs to a different effect than "${String(input.effectPhrase)}" — use the factor the quote states for ${cls.name}, or the effect word that goes with ${factor} (direction-bound)`,
          affected: ['/factor', '/factorText', '/effectPhrase'],
        });
      }
      return out;
    }
  }
  // Not in the catalogue (or an effect word the catalogue does not classify): the quote must state the effect.
  const quote = normal(input.quote);
  const words = (effect.match(/[\p{L}\p{N}]+/gu) ?? []).filter(w => !STOP_WORDS.has(w));
  const quoteWords = new Set((quote.match(/[\p{L}\p{N}]+/gu) ?? []).map(stem));
  const missing = words.filter(w => !quoteWords.has(stem(w)));
  const known = scale !== null ? `the ${scale.id} scale has no catalogue entry for this effect word, and ` : `the scale "${String(input.quantity)}" is not one we know, so `;
  if (words.length === 0 || missing.length > 0) {
    return [{
      message: `${known}the cited quote must state the effect in its own words: ${words.length === 0 ? `effectPhrase "${String(input.effectPhrase)}" has no effect word` : `the word(s) ${missing.map(w => `"${w}"`).join(', ')} of effectPhrase "${String(input.effectPhrase)}" do not occur in the quote`} — quote the sentence that says what the factor multiplies, or use the quote's own effect words (direction-bound)`,
      affected: ['/effectPhrase', '/quote'],
    }];
  }
  if (!COMPARISON_WORDS.test(quote) && !COMPARISON_WORDS.test(effect)) {
    return [{
      message: `${known}the cited quote must also say which way the effect goes with a comparison word (more, less, larger, increase, ...); the quote has none — quote the sentence that compares the steps (direction-bound)`,
      affected: ['/effectPhrase', '/quote'],
    }];
  }
  return [];
}
