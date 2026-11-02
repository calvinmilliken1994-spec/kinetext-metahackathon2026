import { useContext, useId, useState } from 'react';
import type { ReactNode } from 'react';
import { CHECKED_SENTENCE } from '../lib/provenance.ts';
import type { CountPhrase, ReceiptInput } from '../lib/provenance.ts';
import { provenanceSentence, reviewStatusView } from '../lib/partOrder.ts';
import { NEEDS_REVIEW, NEEDS_REVIEW_DETAIL } from '../lib/reviewState.ts';
import { IconChevronDown, IconChevronUp } from './icons.tsx';
import { LessonPartsContext, LessonReviewContext } from './LessonPartsContext.ts';
import { revealInPanels } from '../lib/scroll.ts';
import { TrustReceipt, TrustReceiptPanel } from './TrustReceipt.tsx';

export interface ProvenanceReceipt {
  input: ReceiptInput;
  /** The check list the receipt opens (LessonChecksPanel or ValidationPanel for the published result). */
  checks: ReactNode;
}

interface Props {
  /** disclosureText(): AI-generated with <model>, and the source's publisher has not reviewed or endorsed it. */
  disclosure: string;
  /** Revisions after a failed check, system-made faults and repairs that did not pass, in words. */
  phrases: readonly CountPhrase[];
  /** Opens the runs drawer with the steps, repairs and checks. */
  onDetails?: (() => void) | undefined;
  /** The trust receipt and the checks it opens; absent while a run is still working or has no checks. */
  receipt?: ProvenanceReceipt | null | undefined;
  /** Stage 7b: the page's subject as a quiet label (subjectNote); teacher pages say it was detected by Muse. */
  subject?: { text: string; detected: boolean } | null | undefined;
  /**
   * Library tidy (lessonReviewCue): 'notice' = the amber Needs review notice with a way to Review and publish, unless the
   * lesson is published; 'line' = the plain status line (default); 'none' = no review status (classic activities).
   */
  reviewCue?: 'notice' | 'line' | 'none' | undefined;
  /** Opens Review and publish for this lesson (the notice's link). */
  onReview?: (() => void) | undefined;
}

/**
 * The provenance block under a lesson's title (Set B). One status line ("Needs review · 2 parts ready · 1 held back"; for
 * a finished unpublished lesson an amber Needs review notice with a link to Review and publish) beside the collapsed trust receipt, then ONE sentence: AI-written by which model, from which publisher, who has
 * not reviewed or endorsed it. What code checked and what Muse revised sit behind a small disclosure, with a way to the
 * repair story. A system-made demo fault is never folded away: its phrase stays on the line.
 */
export function Provenance({ disclosure, phrases, onDetails, receipt = null, subject = null, reviewCue = 'line', onReview }: Props) {
  const [open, setOpen] = useState(false);
  const [more, setMore] = useState(false);
  const panelId = useId();
  const moreId = useId();
  const counts = useContext(LessonPartsContext);
  const review = useContext(LessonReviewContext);
  const faults = phrases.filter((p) => p.tone === 'fault');
  const folded = phrases.filter((p) => p.tone !== 'fault');
  const revised = folded.some((p) => p.tone === 'neutral');
  // Library tidy: a published lesson keeps its line ("Reviewed by a teacher · published 2 Nov 2026"); an unpublished
  // finished one gets the notice, with the part counts beside it; a classic activity gets only its counts (if any).
  const { notice, text: statusText } = reviewStatusView(reviewCue, counts, review);
  // "See how": open the runs drawer, then bring its repair story into view (the drawer opens scrolled to its top).
  const seeHow = (): void => {
    onDetails?.();
    window.setTimeout(() => {
      const story = document.querySelector<HTMLElement>('[data-testid="component-repair"]') ?? document.querySelector<HTMLElement>('[data-testid="analysis-repair"]');
      revealInPanels(story);
    }, 80);
  };
  return (
    <div className="provenance" data-testid="provenance">
      {notice && (
        <p className="review-notice" data-testid="review-notice">
          <span className="review-notice-head">{NEEDS_REVIEW}</span>
          <span className="review-notice-text">{NEEDS_REVIEW_DETAIL}</span>
          {onReview !== undefined && <button type="button" className="link-btn review-notice-link" onClick={onReview}>Review and publish</button>}
        </p>
      )}
      <p className="prov-status">
        {subject !== null && <span className="prov-subject" data-testid="lesson-subject">{subject.text}</span>}
        {statusText !== '' && <span className="review-status" data-testid="review-status">{statusText}</span>}
        {receipt !== null && <TrustReceipt input={receipt.input} open={open} onToggle={() => setOpen((v) => !v)} panelId={panelId} />}
        {onDetails !== undefined && <button type="button" className="link-btn" onClick={onDetails}>Run details</button>}
      </p>
      <p className="prov-line">
        <span className="prov-ai">{provenanceSentence(disclosure)}</span>
        {faults.map((p) => (
          <span key={p.text} className="prov-count tone-fault" data-testid="system-made-count"> {p.text}.</span>
        ))}{' '}
        <button type="button" className="prov-more-btn" aria-expanded={more} aria-controls={moreId} onClick={() => setMore((v) => !v)}>
          How it was checked{more ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
        </button>
      </p>
      {more && (
        <p id={moreId} className="prov-more" data-testid="provenance-more">
          <span>{CHECKED_SENTENCE}</span>
          {folded.map((p) => (
            <span key={p.text} className={`prov-count tone-${p.tone}`}> {p.text}.</span>
          ))}
          {revised && onDetails !== undefined && <> <button type="button" className="link-btn" onClick={seeHow}>See how</button></>}
        </p>
      )}
      {receipt !== null && open && <TrustReceiptPanel id={panelId}>{receipt.checks}</TrustReceiptPanel>}
    </div>
  );
}
