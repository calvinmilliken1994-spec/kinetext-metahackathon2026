// Teacher diagram (beta), docs/specs/TEACHER-FIGURE.md section 4: the "Diagram" field of Your own source. A focusable
// paste area with its instructions, a real "Choose an image" button, then the preview, its size, Remove, an optional
// caption and the image's own rights tick. Paste and drop are caught by the whole form (PasteSourceForm), so Ctrl+V of
// a screenshot works anywhere in it; this field only shows the state.
import { useRef } from 'react';
import type { PreparedFigure } from './figureImage.ts';
import {
  cleanCaption, FIGURE_ACCEPT, FIGURE_CAPTION_MAX, FIGURE_FIELD_LABEL, FIGURE_MAX_LONG_SIDE, FIGURE_NOTE, FIGURE_RIGHTS_LABEL, figureSizeText, pasteKeys,
} from '../lib/teacherFigure.ts';
import type { FigureProblems } from '../lib/teacherFigure.ts';

export interface FigureFieldProps {
  /** id prefix from the form (useId), so every id is unique on the page. */
  idBase: string;
  figure: PreparedFigure | null;
  preparing: boolean;
  dragging: boolean;
  caption: string;
  rights: boolean;
  problems: FigureProblems;
  disabled: boolean;
  onFile: (file: File) => void;
  onRemove: () => void;
  onCaption: (caption: string) => void;
  onRights: (rights: boolean) => void;
}

function platform(): string {
  if (typeof navigator === 'undefined') return '';
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  return nav.userAgentData?.platform ?? nav.platform ?? '';
}

export function FigureField(p: FigureFieldProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const id = (name: string): string => `${p.idBase}-fig-${name}`;
  const choose = (): void => fileRef.current?.click();
  const keys = pasteKeys(platform());
  const caption = cleanCaption(p.caption);
  const f = p.figure;
  const scaledFrom = f !== null && (f.originalWidth !== f.width || f.originalHeight !== f.height)
    ? ` · scaled down from ${figureSizeText(f.originalWidth, f.originalHeight)}`
    : '';

  return (
    <div className="field figure-field" data-testid="figure-field">
      <span className="field-label figure-label" id={id('label')}>
        {FIGURE_FIELD_LABEL} (optional) <span className="tag figure-beta">beta</span>
      </span>
      <p id={id('note')} className="muted small">{FIGURE_NOTE}</p>

      {f === null ? (
        <div
          className="figure-drop" role="region" tabIndex={0} aria-labelledby={id('label')} aria-describedby={`${id('how')} ${id('note')}`}
          aria-busy={p.preparing} data-drag={p.dragging ? 'on' : undefined} data-testid="figure-drop"
        >
          <p id={id('how')} className="figure-drop-text">
            {p.preparing ? 'Preparing the image…' : `Paste a screenshot of the diagram here with ${keys}, or drop an image file.`}
          </p>
          <div className="figure-drop-row">
            <button type="button" className="btn btn-small" onClick={choose} disabled={p.disabled || p.preparing}>Choose an image</button>
            <span className="muted small">PNG, JPEG or WebP. Large images are scaled to {FIGURE_MAX_LONG_SIDE.toLocaleString('en-US')} px on the long side.</span>
          </div>
        </div>
      ) : (
        <div className="figure-picked" data-testid="figure-picked">
          <img src={f.previewUrl} alt={caption !== '' ? caption : 'The diagram you added'} draggable={false} />
          <div className="figure-picked-meta">
            <p role="status">{figureSizeText(f.width, f.height, f.bytes)} · PNG{scaledFrom}</p>
            <div className="paste-actions">
              <button type="button" className="btn btn-small" onClick={p.onRemove} disabled={p.disabled}>Remove</button>
              <button type="button" className="btn btn-small" onClick={choose} disabled={p.disabled || p.preparing}>Choose another</button>
            </div>
          </div>
        </div>
      )}
      {/* The real file chooser behind both buttons; hidden, so it is not a second tab stop. */}
      <input
        ref={fileRef} type="file" accept={FIGURE_ACCEPT} hidden aria-hidden="true" tabIndex={-1}
        onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file !== undefined) p.onFile(file); }}
      />
      {p.problems.image !== undefined && <p id={id('image-err')} className="field-error" role="alert">{p.problems.image}</p>}

      {f !== null && (
        <>
          <div className="field">
            <label htmlFor={id('caption')} className="field-label">Caption (optional)</label>
            <input
              id={id('caption')} value={p.caption} maxLength={FIGURE_CAPTION_MAX * 2} autoComplete="off" disabled={p.disabled}
              placeholder="What the diagram shows"
              aria-invalid={p.problems.caption !== undefined} aria-describedby={p.problems.caption !== undefined ? id('caption-err') : undefined}
              onChange={(e) => p.onCaption(e.target.value)}
            />
            {p.problems.caption !== undefined && <p id={id('caption-err')} className="field-error" role="alert">{p.problems.caption}</p>}
          </div>
          <div className="field field-check">
            <label className="check-label">
              <input
                type="checkbox" checked={p.rights} disabled={p.disabled} aria-invalid={p.problems.rights !== undefined}
                aria-describedby={p.problems.rights !== undefined ? id('rights-err') : undefined}
                onChange={(e) => p.onRights(e.target.checked)}
              />
              <span>{FIGURE_RIGHTS_LABEL}</span>
            </label>
            {p.problems.rights !== undefined && <p id={id('rights-err')} className="field-error" role="alert">{p.problems.rights}</p>}
          </div>
        </>
      )}
    </div>
  );
}
