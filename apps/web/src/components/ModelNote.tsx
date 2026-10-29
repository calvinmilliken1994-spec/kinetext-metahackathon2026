import type { JobModel } from '../lib/models.ts';
import { modelRunTag } from '../lib/models.ts';

/** "Made with …" strip above a run's result: the model label and the exact provider model string. */
export function ModelNote({ model }: { model: JobModel }) {
  const tag = modelRunTag(model);
  return (
    <p className={`model-note model-note-${tag.tone}`} data-testid="model-note">
      <span className="model-note-lead">Made with</span>
      <strong>{model.label}</strong>
      <span className={`tag tag-model-${tag.tone}`}>{tag.text}</span>
      <span className="model-note-string">Model string <code>{model.providerModel}</code></span>
    </p>
  );
}
