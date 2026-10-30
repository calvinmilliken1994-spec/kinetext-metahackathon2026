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

/** A gap or margin as a person reads it: three significant figures, grouped, with its unit ('4.75 m', '2,750', '±' added by the caller). */
export function amountText(n: number, unit: string): string {
  if (!Number.isFinite(n)) return 'not defined';
  const u = unit.trim() === '' ? '' : ` ${prettyExponents(unit.trim())}`;
  return `${groupThousands(sig3Plain(n))}${u}`;
}
