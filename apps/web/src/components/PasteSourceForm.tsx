import { useId, useState } from 'react';
import type { ClipboardEvent, DragEvent, FormEvent } from 'react';
import { USER_SOURCE_LIMITS } from '../../../../packages/contracts/index.ts';
import type { UserLicense } from '../../../../packages/contracts/index.ts';
import { api, ApiError, describeError } from '../api.ts';
import { EMPTY_FORM, FREE_CREDITS_NOTE, licenseOptions, problemsByField, reuseNotice, RIGHTS_LABEL, textCount, validateSourceForm } from '../lib/sources.ts';
import type { FieldProblems, SourceFormValues } from '../lib/sources.ts';
import { figureErrorMessage, figureInputProblem, figurePayload, parseAddedFigure, pastedImageIndex } from '../lib/teacherFigure.ts';
import type { AddedFigure, FigureProblems } from '../lib/teacherFigure.ts';
import { FigureField } from './FigureField.tsx';
import { FigurePrepareError, prepareFigure } from './figureImage.ts';
import type { PreparedFigure } from './figureImage.ts';

export interface PasteSourceFormProps {
  /**
   * Called with the stored source id after a successful save, plus a notice when the text already existed, and the
   * teacher's diagram (beta) when one was added with it (null: none, or the teacher went on without it).
   */
  onCreated: (sourceId: string, notice: string | null, figure: AddedFigure | null) => void;
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

/** A source saved while its diagram was refused: the teacher can retry, or go on with the text alone. */
interface SavedWithoutFigure { id: string; notice: string | null; message: string }

/** Paste-a-source form. The server re-validates everything; the problems it returns are shown in plain language. */
export function PasteSourceForm({ onCreated, onCancel, title = 'Paste your own text', rows = 9 }: PasteSourceFormProps) {
  const uid = useId();
  const [v, setV] = useState<SourceFormValues>(EMPTY_FORM);
  const [problems, setProblems] = useState<FieldProblems>({});
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState<null | 'text' | 'figure'>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  // Teacher diagram (beta)
  const [fig, setFig] = useState<PreparedFigure | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [figCaption, setFigCaption] = useState('');
  const [figRights, setFigRights] = useState(false);
  const [figProblems, setFigProblems] = useState<FigureProblems>({});
  const [figSaved, setFigSaved] = useState<SavedWithoutFigure | null>(null);
  const count = textCount(v.text);
  const L = USER_SOURCE_LIMITS;
  const id = (name: string): string => `${uid}-${name}`;
  const busy = saving !== null;

  const set = <K extends keyof SourceFormValues>(key: K, value: SourceFormValues[K]): void => {
    const next = { ...v, [key]: value };
    setV(next);
    setServerError(null);
    if (submitted) {
      const r = validateSourceForm(next);
      setProblems(r.ok ? {} : r.problems);
    }
  };

  // ---- the diagram ----------------------------------------------------------------------------------------------
  const addFile = (file: File): void => {
    const bad = figureInputProblem({ type: file.type, size: file.size });
    setFigSaved(null);
    if (bad !== null) { setFigProblems({ image: bad }); return; }
    setPreparing(true);
    setFigProblems({});
    prepareFigure(file).then(
      (prepared) => { setFig(prepared); setPreparing(false); },
      (err: unknown) => {
        setPreparing(false);
        setFigProblems({ image: err instanceof FigurePrepareError ? err.message : 'The image could not be read. Try another file or screenshot.' });
      },
    );
  };
  const removeFigure = (): void => { setFig(null); setFigProblems({}); setFigSaved(null); setFigRights(false); setFigCaption(''); };
  const figValues = (patch: Partial<{ caption: string; rights: boolean }>): void => {
    const caption = patch.caption ?? figCaption;
    const rights = patch.rights ?? figRights;
    if (patch.caption !== undefined) setFigCaption(caption);
    if (patch.rights !== undefined) setFigRights(rights);
    // Once a problem has been shown, re-check as the teacher fixes it (like the text fields).
    if (fig !== null && (figProblems.caption !== undefined || figProblems.rights !== undefined)) {
      const r = figurePayload({ base64: fig.base64, caption, rights });
      setFigProblems(r.ok ? {} : r.problems);
    }
  };

  // An image pasted anywhere in the form (the Text box included) goes to the diagram, but only when the clipboard holds
  // an image and no text: pasting text from a document that also carries a picture of it stays a text paste.
  const onPaste = (e: ClipboardEvent<HTMLFormElement>): void => {
    if (busy) return;
    const items = Array.from(e.clipboardData.items);
    const at = pastedImageIndex(items.map((it) => ({ kind: it.kind, type: it.type })), e.clipboardData.getData('text/plain'));
    if (at === null) return;
    const file = items[at]?.getAsFile() ?? null;
    if (file === null) return;
    e.preventDefault();
    addFile(file);
  };
  // A file dropped anywhere on the form is taken here, so the browser never opens it in place of the app.
  const hasFiles = (e: DragEvent): boolean => Array.from(e.dataTransfer.types).includes('Files');
  const onDragOver = (e: DragEvent<HTMLFormElement>): void => {
    if (!hasFiles(e) || busy) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!dragging) setDragging(true);
  };
  const onDragLeave = (e: DragEvent<HTMLFormElement>): void => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setDragging(false);
  };
  const onDrop = (e: DragEvent<HTMLFormElement>): void => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    setDragging(false);
    if (busy) return;
    const file = e.dataTransfer.files[0];
    if (file !== undefined) addFile(file);
  };

  // ---- submit ---------------------------------------------------------------------------------------------------
  const sendFigure = (sourceId: string, notice: string | null): void => {
    if (fig === null) { setSaving(null); onCreated(sourceId, notice, null); return; }
    const payload = figurePayload({ base64: fig.base64, caption: figCaption, rights: figRights });
    if (!payload.ok) { setSaving(null); setFigProblems(payload.problems); return; }
    setSaving('figure');
    api.addFigure(sourceId, payload.body).then(
      (raw) => {
        setSaving(null);
        const added = parseAddedFigure(raw, figCaption);
        if (added === null) {
          setFigSaved({ id: sourceId, notice, message: figureErrorMessage({ status: 200, code: 'BAD_ANSWER', problems: [] }, 'The server gave an answer this page does not understand.') });
          return;
        }
        setFigSaved(null);
        onCreated(sourceId, notice, added);
      },
      (err: unknown) => {
        setSaving(null);
        const e = err instanceof ApiError ? err : new ApiError(0, 'NETWORK');
        setFigSaved({ id: sourceId, notice, message: figureErrorMessage(e, describeError(e)) });
      },
    );
  };

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    if (preparing) return;
    setSubmitted(true);
    setServerError(null);
    setFigSaved(null);
    const r = validateSourceForm(v);
    const f = fig === null ? null : figurePayload({ base64: fig.base64, caption: figCaption, rights: figRights });
    setProblems(r.ok ? {} : r.problems);
    setFigProblems(f === null || f.ok ? {} : f.problems);
    if (!r.ok || (f !== null && !f.ok)) return;
    setSaving('text');
    api.createSource(r.input).then(
      (created) => sendFigure(created.id, reuseNotice(created)),
      (err: unknown) => {
        setSaving(null);
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
  const figErrorCount = Object.keys(figProblems).filter((k) => k !== 'image').length;
  const label = saving === 'text' ? 'Saving…' : saving === 'figure' ? 'Saving the diagram…' : fig !== null ? 'Use this text and diagram' : 'Use this text';

  return (
    <form
      className="paste-form" onSubmit={submit} noValidate aria-labelledby={title === null ? undefined : id('heading')} aria-label={title === null ? 'Your own source' : undefined}
      onPaste={onPaste} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
    >
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

      <FigureField
        idBase={uid} figure={fig} preparing={preparing} dragging={dragging} caption={figCaption} rights={figRights} problems={figProblems} disabled={busy}
        onFile={addFile} onRemove={removeFigure} onCaption={(c) => figValues({ caption: c })} onRights={(r) => figValues({ rights: r })}
      />

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
      {figSaved !== null && (
        <p className="field-error" role="alert" data-testid="figure-upload-error">
          {figSaved.message}{' '}
          <button type="button" className="link-btn" onClick={() => { const s = figSaved; setFigSaved(null); onCreated(s.id, s.notice, null); }}>Use the text without the diagram</button>
        </p>
      )}
      {submitted && (Object.keys(problems).length > 0 || figErrorCount > 0) && <p className="field-error" role="status">Fix the highlighted fields and try again.</p>}

      <div className="paste-actions">
        <button type="submit" className="btn btn-primary" disabled={busy || preparing}>{label}</button>
        {onCancel !== undefined && <button type="button" className="btn" onClick={onCancel} disabled={busy}>Cancel</button>}
      </div>
      <p className="muted small">The text is stored locally on this computer with a SHA-256 fingerprint. Muse treats it as untrusted data, never as instructions.</p>
    </form>
  );
}
