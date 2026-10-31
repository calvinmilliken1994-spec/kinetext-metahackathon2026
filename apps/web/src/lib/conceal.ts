// One concealment policy for every predict-then-reveal view, lesson and presentation alike (Set A, W-04/W2-01/W2-02).
// While an answer is hidden, no element may hand the class a page sentence that states it: an element whose quote
// discloses the hidden value keeps no link keys (hover and focus light nothing and fill no quote zone), and the
// presentation's quote zone drops any concealed quote, whatever put it there (a hover, a pin, the zone's own link).

import { linkKey } from './linking.ts';
import type { QuoteLike } from './linking.ts';

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const squash = (s: string): string => s.replace(/\s+/g, ' ').trim();

/**
 * True when `quote` states `value` as a whole token (case and spacing ignored): '38' is in 'three-fourths, or 38 of 50'
 * but not in '380'; "president's cabinet" is in "…and the president's cabinet are…". A blank value discloses nothing.
 */
export function quoteDisclosesValue(quote: string, value: string): boolean {
  const v = squash(value);
  if (v === '') return false;
  const pattern = escapeRe(v).replace(/ /g, '\\s+');
  return new RegExp(`(?<![\\p{L}\\p{N}.,])${pattern}(?![\\p{L}\\p{N}]|[.,]\\d)`, 'iu').test(quote);
}

/** What a question hides: the page sentence behind the answer and the answer's own words. */
export interface HiddenAnswer { quote: QuoteLike | null; values: readonly string[] }

/** True when this quote would give the hidden answer away: it IS the answer's sentence, or it states the answer. */
export function disclosesAnswer(q: QuoteLike, hidden: HiddenAnswer): boolean {
  const k = linkKey(q.sourceId, q.quote);
  if (k === '') return false;
  if (hidden.quote !== null && linkKey(hidden.quote.sourceId, hidden.quote.quote) === k) return true;
  return hidden.values.some((v) => quoteDisclosesValue(q.quote, v));
}

/** The link keys among `quotes` that must stay dark while `hidden` is open (none once it is revealed: pass null). */
export function concealedKeys(quotes: readonly QuoteLike[], hidden: HiddenAnswer | null): Set<string> {
  const out = new Set<string>();
  if (hidden === null) return out;
  if (hidden.quote !== null) {
    const k = linkKey(hidden.quote.sourceId, hidden.quote.quote);
    if (k !== '') out.add(k);
  }
  for (const q of quotes) if (disclosesAnswer(q, hidden)) out.add(linkKey(q.sourceId, q.quote));
  return out;
}

/** An element's link keys under the policy: its quote's key, or none while that quote is concealed. */
export function linksUnlessConcealed(q: QuoteLike, concealed: ReadonlySet<string>): string[] {
  const k = linkKey(q.sourceId, q.quote);
  return k === '' || concealed.has(k) ? [] : [k];
}

/** A quote the zone may show: null when it is concealed. */
export function unlessConcealed(q: QuoteLike | null, concealed: ReadonlySet<string>): QuoteLike | null {
  return q === null || concealed.has(linkKey(q.sourceId, q.quote)) ? null : q;
}
