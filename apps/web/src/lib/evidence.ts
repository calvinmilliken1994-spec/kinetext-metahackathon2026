// Collect every evidence quote (explanations + analysis concepts) that cites the selected source.

import type { ActivitySpec, SourceAnalysis } from '../../../../packages/contracts/index.ts';

export type QuoteKind = 'explanation' | 'concept';

export interface QuoteRef {
  /** Unique key: `${kind}:${ownerId}:${index}` */
  key: string;
  quote: string;
  kind: QuoteKind;
  ownerId: string;
  ownerLabel: string;
}

export function quoteKey(kind: QuoteKind, ownerId: string, index: number): string {
  return `${kind}:${ownerId}:${index}`;
}

export function collectQuoteRefs(
  sourceId: string,
  spec: Pick<ActivitySpec, 'explanations'> | null | undefined,
  analysis: Pick<SourceAnalysis, 'concepts'> | null | undefined,
): QuoteRef[] {
  const out: QuoteRef[] = [];
  for (const ex of spec?.explanations ?? []) {
    ex.evidence.forEach((ev, i) => {
      if (ev.sourceId === sourceId) {
        out.push({ key: quoteKey('explanation', ex.id, i), quote: ev.quote, kind: 'explanation', ownerId: ex.id, ownerLabel: ex.id });
      }
    });
  }
  for (const c of analysis?.concepts ?? []) {
    c.evidence.forEach((ev, i) => {
      if (ev.sourceId === sourceId) {
        out.push({ key: quoteKey('concept', c.id, i), quote: ev.quote, kind: 'concept', ownerId: c.id, ownerLabel: c.name });
      }
    });
  }
  return out;
}

/** Truncate a quote for chip previews without cutting inside a word when possible. */
export function previewQuote(quote: string, max = 72): string {
  const q = quote.replace(/\s+/g, ' ').trim();
  if (q.length <= max) return q;
  const cut = q.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut) + '…';
}
