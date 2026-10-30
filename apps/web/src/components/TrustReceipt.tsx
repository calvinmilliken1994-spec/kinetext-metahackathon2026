import type { ReactNode } from 'react';
import { receiptLabel, receiptSegments } from '../lib/provenance.ts';
import type { ReceiptInput } from '../lib/provenance.ts';
import { IconChevronDown, IconChevronUp } from './icons.tsx';

interface ButtonProps {
  input: ReceiptInput;
  open: boolean;
  onToggle: () => void;
  /** Id of the panel the button opens (TrustReceiptPanel). */
  panelId: string;
}

/**
 * The compact trust receipt beside the lesson's review status: "14/14 checks · 8/8 quotes found · $0.0471". Every
 * number comes from the stored run (checks), the page text shown beside the lesson (quotes) or the job's recorded cost;
 * a count that is not known is left out. Pressing it opens the check list underneath.
 */
export function TrustReceipt({ input, open, onToggle, panelId }: ButtonProps) {
  const segments = receiptSegments(input);
  if (segments.length === 0) return null;
  return (
    <button
      type="button"
      className="receipt-btn"
      aria-expanded={open}
      aria-controls={panelId}
      aria-description={`${receiptLabel(input)}. ${open ? 'Hide' : 'Show'} the checks.`}
      onClick={onToggle}
      data-testid="trust-receipt"
    >
      {segments.map((s, i) => (
        <span key={s.key} className={`receipt-seg receipt-${s.key} tone-${s.tone}`}>
          {i > 0 && <span className="receipt-sep" aria-hidden="true">·</span>}
          {s.text}
        </span>
      ))}
      {open ? <IconChevronUp size={16} /> : <IconChevronDown size={16} />}
    </button>
  );
}

/** The check list the receipt opens: the same panels as the runs drawer, for the published result. */
export function TrustReceiptPanel({ id, children }: { id: string; children: ReactNode }) {
  return <div id={id} className="receipt-panel" data-testid="trust-receipt-panel">{children}</div>;
}
