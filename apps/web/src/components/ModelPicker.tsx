import type { ModelId, ModelOption } from '../lib/models.ts';
import { MODEL_EXPLAINER, unavailableReason } from '../lib/models.ts';

export interface ModelPickerProps {
  options: readonly ModelOption[];
  selected: ModelId;
  onSelect: (id: ModelId) => void;
  /** /api/health live flag (null until loaded); decides the wording of the "not available" reason. */
  live: boolean | null;
  /** A job is running or being started: the choice is locked. */
  locked: boolean;
}

/** Which model writes the next run. Fed by GET /api/models; unavailable models stay visible but disabled, with the reason. */
export function ModelPicker({ options, selected, onSelect, live, locked }: ModelPickerProps) {
  if (options.length === 0) return null;
  return (
    <fieldset className="model-picker" disabled={locked}>
      <legend className="field-label">Model</legend>
      <div className="model-options">
        {options.map((o) => {
          const reason = unavailableReason(o, live);
          // With live generation off every model is unavailable for the same reason; the Build area says it once.
          const why = live === false ? null : reason;
          const checked = o.id === selected;
          const inputId = `model-${o.id}`;
          return (
            <label key={o.id} htmlFor={inputId} className={`model-option${checked ? ' model-option-on' : ''}${reason !== null ? ' model-option-off' : ''}`}>
              <input
                id={inputId}
                type="radio"
                name="model"
                value={o.id}
                checked={checked}
                disabled={reason !== null}
                aria-describedby={why !== null ? `${inputId}-why` : undefined}
                onChange={() => onSelect(o.id)}
              />
              <span className="model-option-text">
                <span className="model-option-label">{o.label}</span>
                {why !== null && <span id={`${inputId}-why`} className="model-option-why">{why}</span>}
              </span>
            </label>
          );
        })}
      </div>
      <details className="small model-about">
        <summary>About the two models</summary>
        <p className="muted">{MODEL_EXPLAINER}</p>
      </details>
    </fieldset>
  );
}
