import type { CountPhrase } from '../lib/provenance.ts';

interface Props {
  /** disclosureText(): AI-generated with <model>, and the source's publisher has not reviewed or endorsed it. */
  disclosure: string;
  /** Natural repairs, system-made faults and repairs that did not pass, in words. */
  phrases: readonly CountPhrase[];
  /** Opens the runs drawer with the steps, repairs and checks. */
  onDetails?: (() => void) | undefined;
}

/**
 * The single provenance line under a lesson's title. It carries every honesty statement once: AI-written, by which model
 * (open weights on Modal when so), the publisher disclosure, that code checked quotes and numbers against the page, that
 * the wording needs teacher review, and what was repaired — natural mistakes and system-made faults kept apart.
 */
export function Provenance({ disclosure, phrases, onDetails }: Props) {
  return (
    <p className="provenance" data-testid="provenance">
      <span className="prov-ai">{disclosure}</span>{' '}
      <span>Quotes and numbers were checked against the page by code; the wording needs teacher review.</span>
      {phrases.map((p) => (
        <span key={p.text} className={`prov-count tone-${p.tone}`} data-testid={p.tone === 'fault' ? 'system-made-count' : undefined}> {p.text}.</span>
      ))}
      {onDetails !== undefined && (
        <>
          {' '}
          <button type="button" className="link-btn" onClick={onDetails}>Run details</button>
        </>
      )}
    </p>
  );
}
