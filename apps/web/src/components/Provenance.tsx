import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { CHECKED_SENTENCE, REVIEW_STATUS, withoutReviewNote } from '../lib/provenance.ts';
import type { CountPhrase, ReceiptInput } from '../lib/provenance.ts';
import { TrustReceipt, TrustReceiptPanel } from './TrustReceipt.tsx';

export interface ProvenanceReceipt {
  input: ReceiptInput;
  /** The check list the receipt opens (LessonChecksPanel or ValidationPanel for the published result). */
  checks: ReactNode;
}

interface Props {
  /** disclosureText(): AI-generated with <model>, and the source's publisher has not reviewed or endorsed it. */
  disclosure: string;
  /** Natural repairs, system-made faults and repairs that did not pass, in words. */
  phrases: readonly CountPhrase[];
  /** Opens the runs drawer with the steps, repairs and checks. */
  onDetails?: (() => void) | undefined;
  /** The trust receipt and the checks it opens; absent while a run is still working or has no checks. */
  receipt?: ProvenanceReceipt | null | undefined;
  /** Stage 7b: the page's subject as a quiet label (subjectNote); teacher pages say it was detected by Muse. */
  subject?: { text: string; detected: boolean } | null | undefined;
}

/**
 * The provenance block under a lesson's title. One status ("Draft · needs teacher review") beside the collapsed trust
 * receipt, then one plain line: AI-written by which model (open weights on Modal when so), the publisher disclosure
 * (never implying endorsement), what code checked, and what was repaired — natural mistakes and system-made faults
 * kept apart. The receipt opens the checks in place; "Run details" opens the runs drawer.
 */
export function Provenance({ disclosure, phrases, onDetails, receipt = null, subject = null }: Props) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <div className="provenance" data-testid="provenance">
      <p className="prov-status">
        {subject !== null && <span className="prov-subject" data-testid="lesson-subject">{subject.text}</span>}
        <span className="review-status" data-testid="review-status">{REVIEW_STATUS}</span>
        {receipt !== null && <TrustReceipt input={receipt.input} open={open} onToggle={() => setOpen((v) => !v)} panelId={panelId} />}
        {onDetails !== undefined && <button type="button" className="link-btn" onClick={onDetails}>Run details</button>}
      </p>
      <p className="prov-line">
        <span className="prov-ai">{withoutReviewNote(disclosure)}</span>{' '}
        <span>{CHECKED_SENTENCE}</span>
        {phrases.map((p) => (
          <span key={p.text} className={`prov-count tone-${p.tone}`} data-testid={p.tone === 'fault' ? 'system-made-count' : undefined}> {p.text}.</span>
        ))}
      </p>
      {receipt !== null && open && <TrustReceiptPanel id={panelId}>{receipt.checks}</TrustReceiptPanel>}
    </div>
  );
}
