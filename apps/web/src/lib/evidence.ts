// Collect every evidence quote (explanations, timeline events, analysis concepts) that cites the selected source.

import type { Evidence, SourceAnalysis } from '../../../../packages/contracts/index.ts';

export type QuoteKind = 'explanation' | 'concept' | 'event' | 'lesson';

export interface QuoteRef {
  /** Unique key: `${kind}:${ownerId}:${index}` */
  key: string;
  quote: string;
  kind: QuoteKind;
  ownerId: string;
  ownerLabel: string;
}

/** Explanation and timeline-event quotes are the activity's evidence; analysis concepts are what Muse found. */
export function isEvidenceKey(key: string): boolean {
  return key.startsWith('explanation:') || key.startsWith('event:') || key.startsWith('lesson:');
}

export function quoteKey(kind: QuoteKind, ownerId: string, index: number): string {
  return `${kind}:${ownerId}:${index}`;
}

/** The parts of a spec that carry evidence quotes: explanations for every engine, plus the events of a timeline. */
export interface SpecWithQuotes {
  explanations: readonly { id: string; evidence: readonly Evidence[] }[];
  simulation?: { engine?: string; events?: readonly { id: string; label: string; evidence: readonly Evidence[] }[] };
}

export function collectQuoteRefs(
  sourceId: string,
  spec: SpecWithQuotes | null | undefined,
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
  for (const e of spec?.simulation?.events ?? []) {
    e.evidence.forEach((ev, i) => {
      if (ev.sourceId === sourceId) {
        out.push({ key: quoteKey('event', e.id, i), quote: ev.quote, kind: 'event', ownerId: e.id, ownerLabel: e.label });
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
