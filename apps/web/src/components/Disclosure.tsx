export const AI_WRITTEN_LABEL = 'AI-written';

interface Props {
  /** The disclosure wording for this source kind (see disclosureText in lib/sources.ts). */
  text: string;
  /** 'panel' is the full-width notice above an activity; 'badge' is the small AI-written label on each lesson component. */
  variant?: 'panel' | 'badge';
}

/** The single AI-disclosure component: a notice panel, or a compact badge whose full wording is its tooltip and screen-reader text. */
export function Disclosure({ text, variant = 'panel' }: Props) {
  if (variant === 'badge') {
    return (
      <span className="badge badge-ai" title={text}>
        <span aria-hidden="true">ⓘ</span> {AI_WRITTEN_LABEL}
        <span className="sr-only">. {text}</span>
      </span>
    );
  }
  return (
    <aside className="disclosure" aria-label="AI-generation disclosure">
      <span className="disclosure-icon" aria-hidden="true">ⓘ</span>
      <p>{text}</p>
    </aside>
  );
}
