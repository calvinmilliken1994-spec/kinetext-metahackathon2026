export const AI_WRITTEN_LABEL = 'AI-written';

/**
 * The small plain "AI-written" note on each lesson part. The full disclosure (model, publisher, teacher review) is the
 * provenance line under the lesson title; this repeats only the fact, in words, where each part starts.
 */
export function AiWritten({ extra }: { extra?: string }) {
  return <span className="ai-written">{AI_WRITTEN_LABEL}{extra !== undefined ? ` · ${extra}` : ''}</span>;
}
