// Display helpers for AI-written text and for gaps and margins (pure).
//
// Muse writes powers with a caret ('m/s^2', 'V0^2'). Text the model WROTE (prompts, labels, case text, overview points)
// is shown with real superscripts. Text QUOTED from the page is never passed through here: a quote stays verbatim.

const SUPER: Readonly<Record<string, string>> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻', '−': '⁻',
};

const toSuper = (s: string): string => Array.from(s, (c) => SUPER[c] ?? c).join('');

/** 'm/s^2' → 'm/s²', 'V0^2' → 'V0²', 's^-1' and 's^(-2)' → 's⁻¹', 's⁻²'. Only whole-number powers written right after a symbol. */
export function prettyExponents(text: string): string {
  return text
    .replace(/(?<=[\w)\]])\^\(([-−]?\d{1,3})\)/g, (_m, p: string) => toSuper(p))
    .replace(/(?<=[\w)\]])\^([-−]?\d{1,3})(?![\d.])/g, (_m, p: string) => toSuper(p));
}

/** Thousands separators in the integer part of a plain decimal ('1040000' → '1,040,000'); anything else is returned as is. */
export function groupThousands(s: string): string {
  const m = /^([-−]?)(\d+)(\.\d+)?$/.exec(s);
  if (m === null) return s;
  const [, sign = '', int = '', frac = ''] = m;
  return `${sign}${int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${frac}`;
}

/** Three significant figures, no trailing zeros, no exponent form: 4.753 → '4.75', 12345.6 → '12300', 0.00012345 → '0.000123'. */
function sig3Plain(n: number): string {
  if (n === 0) return '0';
  const r = Number(n.toPrecision(3));
  const digits = Math.max(0, 2 - Math.floor(Math.log10(Math.abs(r))));
  const s = r.toFixed(Math.min(20, digits)).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  return s === '-0' ? '0' : s;
}

// ---- sentences and labels written by the model ------------------------------------------------------------------------

/** Unit symbols and short tokens that must keep their case at the start of a label. */
const KEEP_CASE = new Set(['kg', 'km', 'cm', 'mm', 'nm', 'ml', 'mg', 'mol', 'min', 'hr', 'ms', 'ns', 'ft', 'lb', 'lbs', 'mph', 'kph', 'rad', 'cd', 'kj', 'kw', 'kwh', 'rpm']);

/** A one-letter symbol with a written-out subscript ('ymax', 'vmin', 'xref'): a symbol, not a word. */
const SUBSCRIPTED_SYMBOL = /^[a-z](?:max|min|avg|net|ref|eq|tot)$/;

/**
 * Sentence case for a label the model wrote ('quorum of seven states was obtained' → 'Quorum …'). Only a first word of two
 * or more lowercase letters is changed, so symbols ('x', 'pH', 'mRNA', 'ymax'), unit symbols ('kg', 'm/s') and numbers stay.
 */
export function capitalFirst(text: string): string {
  const m = /^([a-z]{2,})(?=$|[\s,.;:!?)'’-])/.exec(text);
  if (m === null) return text;
  const word = m[1] as string;
  if (KEEP_CASE.has(word) || SUBSCRIPTED_SYMBOL.test(word)) return text;
  return word.charAt(0).toUpperCase() + text.slice(1);
}

/** One sentence: tidy spaces, capital first letter, closing punctuation (a dangling ',', ':' or ';' becomes '.'). */
function asSentence(part: string): string {
  const s = part.replace(/\s+/g, ' ').trim();
  if (s === '') return '';
  const cap = capitalFirst(s);
  if (/[.!?]["”’)]*$/.test(cap)) return cap;
  return `${cap.replace(/[\s,;:–—-]+$/, '')}.`;
}

/**
 * Join fixed UI sentences and AI-written notes into one paragraph. A note the model wrote without a full stop ('Follows the
 * page from convening through debate to compromise') would otherwise run into the next sentence.
 */
export function joinSentences(...parts: readonly string[]): string {
  return parts.map(asSentence).filter((s) => s !== '').join(' ');
}

/**
 * The words of a scene label before its number ('max height 12.34 m' → 'max height', 'a = 343 m/s' → 'a ='), for the
 * hidden-answer treatment: the words stay and a '?' chip stands in for the number and its unit. '' when the label is only
 * a value.
 */
export function hiddenAnswerLead(text: string): string {
  const m = /(?<![\p{L}_\d.])[-−]?\$?\d/u.exec(text);
  return (m === null ? text : text.slice(0, m.index)).trim();
}

/** A gap or margin as a person reads it: three significant figures, grouped, with its unit ('4.75 m', '2,750', '±' added by the caller). */
export function amountText(n: number, unit: string): string {
  if (!Number.isFinite(n)) return 'not defined';
  const u = unit.trim() === '' ? '' : ` ${prettyExponents(unit.trim())}`;
  return `${groupThousands(sig3Plain(n))}${u}`;
}

// ---- hidden characters in model text --------------------------------------------------------------------------------

/**
 * C0/C1 control characters (except tab and newline), zero-width characters, word joiners, bidi embeddings/overrides/
 * isolates and the byte-order mark. Soft hyphens (U+00AD) are kept: real pages use them and they never draw a glyph.
 */
const HIDDEN_CHARS = /[\u0000-\u0008\u000b\u000c\u000d\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff\ufff9-\ufffb]/gu;

/** Model text as it may be shown: no control, zero-width or direction-override characters (line separators read as spaces). */
export function cleanDisplayText(text: string): string {
  return text.replace(/[\u2028\u2029]/g, ' ').replace(HIDDEN_CHARS, '');
}

/** Keys whose strings are the page's own words: kept verbatim so they still match the page text they quote. */
const VERBATIM_KEYS: ReadonlySet<string> = new Set(['quote', 'focusQuote']);

/**
 * A copy of a JSON value (a job detail from the API) with every string cleaned by cleanDisplayText, except page quotes.
 * The one place model text is sanitised for display: everything the lesson views show comes through here.
 */
export function cleanModelStrings(value: unknown, key = ''): unknown {
  if (typeof value === 'string') return VERBATIM_KEYS.has(key) ? value : cleanDisplayText(value);
  if (Array.isArray(value)) return value.map((v) => cleanModelStrings(v, key));
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = cleanModelStrings(v, k);
    return out;
  }
  return value;
}

// ---- AI-written sentences as a teacher reads them ---------------------------------------------------------------------

/**
 * An AI-written sentence (a learning objective, a heading) without raw code: hidden characters dropped, markdown code
 * ticks and bold stars removed, caret powers as superscripts, a multiplication star as '·', and an initial-value zero
 * after a one-letter symbol as a subscript (V0 → V₀, as the typeset equation shows it). Never used on page quotes.
 */
export function aiText(text: string): string {
  return prettyExponents(
    cleanDisplayText(text)
      .replace(/`([^`]*)`/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1'),
  )
    .replace(/(?<=[\w)\]²³¹⁰⁴-⁹])(\s?)\*(\s?)(?=[\w(])/gu, (_m, a: string, b: string) => `${a}·${b}`)
    .replace(/(?<![\p{L}\d_])([A-Za-z])0(?![\p{L}\d_.])/gu, '$1₀');
}

/**
 * The one display form of a short AI-written line a teacher sees (a key term or its meaning, a heading, an answer option,
 * a table cell, a step label): aiText's clean-up and display maths, then sentence case (capitalFirst keeps symbols and
 * units). Never used on page quotes.
 */
export function aiLabel(text: string): string {
  const shown = aiText(text);
  const rest = withoutLearnOpener(shown);
  if (rest === shown) return capitalFirst(shown);
  // After the opener a lone article starts the sentence ('a candidate needs …' → 'A candidate needs …').
  return /^a\s/.test(rest) ? `A${rest.slice(1)}` : capitalFirst(rest);
}

/**
 * Muse opened almost every key point with "Students learn that …" (UX pair review 2026-11-01): the most machine-written
 * voice on screen. The opener is dropped for display only; what follows must be a real clause, so "Students learn",
 * "Students learn that." and "Students learn about …" stay as written. Never used on page quotes.
 */
function withoutLearnOpener(text: string): string {
  const m = /^\s*students\s+(?:will\s+)?learn\s+(?:that\s+(?=[\p{L}\p{N}(])|(?=how\s+[\p{L}\p{N}(]))/iu.exec(text);
  return m === null ? text : text.slice(m[0].length);
}

/** Unit symbols that must stay on the line of their number. */
const UNIT_AFTER_NUMBER = /(\d) (?=(?:m\/s[²³]?|km\/h|kg\/m[²³]|m[²³]?|s|km|cm|mm|kg|g|N|J|K|W|Pa|kPa|Hz|%|mph|ft|lbs?|min|h|mol|mL|L|°C|°F|USD|years?)(?![\p{L}\d_]))/gu;

/** A number and its unit joined by a no-break space ('8 m/s' never breaks as '8 / m/s' at the end of a line). */
export function bindUnits(text: string): string {
  return text.replace(UNIT_AFTER_NUMBER, '$1\u00a0');
}
