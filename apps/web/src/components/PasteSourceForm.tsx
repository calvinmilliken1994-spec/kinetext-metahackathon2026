import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { USER_SOURCE_LIMITS } from '../../../../packages/contracts/index.ts';
import type { UserLicense } from '../../../../packages/contracts/index.ts';
import { api, ApiError, describeError } from '../api.ts';
import { EMPTY_FORM, FREE_CREDITS_NOTE, licenseOptions, problemsByField, reuseNotice, RIGHTS_LABEL, textCount, validateSourceForm } from '../lib/sources.ts';
import type { FieldProblems, SourceFormValues } from '../lib/sources.ts';

export interface PasteSourceFormProps {
  /** Called with the stored source id after a successful save, plus a notice when the text already existed. */
  onCreated: (sourceId: string, notice: string | null) => void;
  /** Absent: no Cancel button (Stage 10: the form is a path of the New lesson page, not a pop-up). */
  onCancel?: (() => void) | undefined;
  /** The form's heading; null leaves it out when the page already names the form. */
  title?: string | null;
  /** Height of the text box in lines. */
  rows?: number;
}

function FieldError({ id, message }: { id: string; message: string | undefined }) {
  return message === undefined ? null : <p id={id} className="field-error" role="alert">{message}</p>;
}

/** Paste-a-source form. The server re-validates everything; the problems it returns are shown in plain language. */
export function PasteSourceForm({ onCreated, onCancel, title = 'Paste your own text', rows = 9 }: PasteSourceFormProps) {
  const uid = useId();
  const [v, setV] = useState<SourceFormValues>(EMPTY_FORM);
  const [problems, setProblems] = useState<FieldProblems>({});
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const count = textCount(v.text);
  const L = USER_SOURCE_LIMITS;
  const id = (name: string): string => `${uid}-${name}`;

  const set = <K extends keyof SourceFormValues>(key: K, value: SourceFormValues[K]): void => {
    const next = { ...v, [key]: value };
    setV(next);
    setServerError(null);
    if (submitted) {
      const r = validateSourceForm(next);
      setProblems(r.ok ? {} : r.problems);
    }
  };

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    setSubmitted(true);
    setServerError(null);
    const r = validateSourceForm(v);
    if (!r.ok) {
      setProblems(r.problems);
      return;
    }
    setProblems({});
    setSaving(true);
    api.createSource(r.input).then(
      (created) => { setSaving(false); onCreated(created.id, reuseNotice(created)); },
      (err: unknown) => {
        setSaving(false);
        if (err instanceof ApiError && err.code === 'SOURCE_INVALID' && err.problems.length > 0) {
          setProblems(problemsByField(err.problems));
          setServerError('The server did not accept the text:');
        } else {
          setServerError(describeError(err));
        }
      },
    );
  };

  const countClass = count.status === 'ok' ? 'ok' : count.status === 'empty' ? 'idle' : 'bad';

  return (
    <form className="paste-form" onSubmit={submit} noValidate aria-labelledby={title === null ? undefined : id('heading')} aria-label={title === null ? 'Your own source' : undefined}>
      {title !== null && <h3 id={id('heading')}>{title}</h3>}
      <p className="callout callout-warn small" role="note" data-testid="free-credits-note">{FREE_CREDITS_NOTE}</p>

      <div className="field">
        <label htmlFor={id('title')} className="field-label">Title</label>
        <input id={id('title')} value={v.title} maxLength={L.titleMax * 2} autoComplete="off"
          aria-invalid={problems.title !== undefined} aria-describedby={problems.title !== undefined ? id('title-err') : undefined}
          onChange={(e) => set('title', e.target.value)} />
        <FieldError id={id('title-err')} message={problems.title} />
      </div>

      <div className="field">
        <label htmlFor={id('text')} className="field-label">Text</label>
        <textarea id={id('text')} rows={rows} value={v.text}
          aria-invalid={problems.text !== undefined || count.status === 'long'}
          aria-describedby={`${id('count')}${problems.text !== undefined ? ` ${id('text-err')}` : ''}`}
          onChange={(e) => set('text', e.target.value)} />
        <p id={id('count')} className={`char-count char-${countClass}`} aria-live="polite" data-testid="char-count">
          <span>{count.label}</span>
          {count.hint !== null && <span> · {count.hint}</span>}
        </p>
        <FieldError id={id('text-err')} message={problems.text} />
      </div>

      <div className="field">
        <label htmlFor={id('license')} className="field-label">License</label>
        <select id={id('license')} value={v.license}
          aria-invalid={problems.license !== undefined} aria-describedby={problems.license !== undefined ? id('license-err') : undefined}
          onChange={(e) => set('license', e.target.value as UserLicense | '')}>
          <option value="">Choose a license…</option>
          {licenseOptions().map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <FieldError id={id('license-err')} message={problems.license} />
      </div>

      <div className="field">
        <label htmlFor={id('attr')} className="field-label">Attribution (author / publisher / who gave permission)</label>
        <input id={id('attr')} value={v.attribution} autoComplete="off"
          aria-invalid={problems.attribution !== undefined} aria-describedby={problems.attribution !== undefined ? id('attr-err') : undefined}
          onChange={(e) => set('attribution', e.target.value)} />
        <FieldError id={id('attr-err')} message={problems.attribution} />
      </div>

      <div className="field">
        <label htmlFor={id('link')} className="field-label">Link to the original (optional)</label>
        <input id={id('link')} type="url" inputMode="url" value={v.link} autoComplete="off" placeholder="https://…"
          aria-invalid={problems.link !== undefined} aria-describedby={problems.link !== undefined ? id('link-err') : undefined}
          onChange={(e) => set('link', e.target.value)} />
        <FieldError id={id('link-err')} message={problems.link} />
      </div>

      <div className="field field-check">
        <label className="check-label">
          <input type="checkbox" checked={v.rights} aria-invalid={problems.rights !== undefined}
            aria-describedby={problems.rights !== undefined ? id('rights-err') : undefined}
            onChange={(e) => set('rights', e.target.checked)} />
          <span>{RIGHTS_LABEL}</span>
        </label>
        <FieldError id={id('rights-err')} message={problems.rights} />
      </div>

      {serverError !== null && <p className="field-error" role="alert">{serverError}</p>}
      {problems.form !== undefined && <p className="field-error" role="alert">{problems.form}</p>}
      {submitted && Object.keys(problems).length > 0 && <p className="field-error" role="status">Fix the highlighted fields and try again.</p>}

      <div className="paste-actions">
        <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Use this text'}</button>
        {onCancel !== undefined && <button type="button" className="btn" onClick={onCancel} disabled={saving}>Cancel</button>}
      </div>
      <p className="muted small">The text is stored locally on this computer with a SHA-256 fingerprint. Muse treats it as untrusted data, never as instructions.</p>
    </form>
  );
}
