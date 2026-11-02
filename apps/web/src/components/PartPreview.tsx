// Welcome v3 (docs/specs/WELCOME-V3-split.md): one small, calm preview per part kind, drawn from lib/partPreview.ts
// (stored specs only; the curves from the lesson's own engines). Display only: no controls, no grading, nothing to
// focus. The caller sizes it (font-size and width on the wrapper); everything inside is in em, so the Welcome montage and
// a later wall of lesson previews (option 2) can reuse it at any size. The element tied to the lit page sentence (a
// figure part, a step, a cell, a chip) carries `data-focus`.
import { useContext } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type {
  CurvePreview, DiagramPreview, FormulaPreview, PartPreview, QuizPreview, SequencePreview, SortPreview, TablePreview,
} from '../lib/partPreview.ts';
import { glowStyle } from '../lib/labelDiagramView.ts';
import { FigureSrcContext } from './LabelDiagramView.tsx';
import '../styles/preview.css';

const pct = (n: number): string => `${(n * 100).toFixed(3)}%`;
/** How many curve marks carry their text. */
const CURVE_LABELS = 3;

function Diagram({ p }: { p: DiagramPreview }) {
  const srcOf = useContext(FigureSrcContext);
  const focus = p.parts[p.focus];
  return (
    <div className="pp-figure" style={{ '--pp-aspect': p.aspect } as CSSProperties}>
      <img src={srcOf(p.figureId)} alt="" draggable={false} />
      {/* SAM 3.1's stored outlines on the figure's own pixel grid; the lit part's is the strong one */}
      <svg className="pp-outlines" viewBox={p.viewBox} preserveAspectRatio="none" aria-hidden="true">
        {p.parts.map((part, i) => (part.outline === null ? null : (
          <path
            key={part.number} d={part.outline} className="pp-outline" data-focus={i === p.focus ? 'true' : undefined}
            style={{ '--pp-i': i } as CSSProperties}
          />
        )))}
      </svg>
      {/* a part with no stored outline shows its model box only when it is the lit one */}
      {focus !== undefined && focus.outline === null && focus.glow !== null && <span className="pp-box" data-focus="true" style={glowStyle(focus.glow, 2)} />}
      {focus !== undefined && (
        <span className="pp-num" style={{ left: `${focus.point.left}%`, top: `${focus.point.top}%` }}>{focus.number}</span>
      )}
    </div>
  );
}

function Curve({ p }: { p: CurvePreview }) {
  const d = p.points.map((pt, i) => `${i === 0 ? 'M' : 'L'}${(pt.x * 100).toFixed(2)} ${(100 - pt.y * 100).toFixed(2)}`).join('');
  return (
    <div className="pp-curve">
      {p.yLabel !== '' && <p className="pp-axis-y">{p.yLabel}</p>}
      <div className="pp-plot">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <path className="pp-curve-line" d={d} />
        </svg>
        {p.marks.map((m, i) => (
          <span key={`${m.x}-${m.text}`} className="pp-mark" style={{ left: pct(m.x), top: pct(1 - m.y) }} data-end={m.x >= 0.999 ? 'true' : undefined}>
            {/* small and calm: the first marks carry their label, later ones (crowding the tail) only their dot */}
            {(i < CURVE_LABELS || m.x >= 0.999) && <span className="pp-mark-text">{m.text}</span>}
          </span>
        ))}
      </div>
      {p.xLabel !== '' && <p className="pp-axis-x">{p.xLabel}</p>}
    </div>
  );
}

function Formula({ p }: { p: FormulaPreview }) {
  return (
    <div className="pp-formula-wrap">
      <p className="pp-formula" data-focus="true">{p.formula}</p>
      {p.slider !== null && (
        <div className="pp-slider">
          <span className="pp-slider-name"><i>{p.slider.symbol}</i> {p.slider.meaning}</span>
          <span className="pp-track"><span className="pp-thumb" style={{ left: pct(p.slider.at) }} /></span>
          <span className="pp-slider-value">{p.slider.value}{p.slider.unit === '' ? '' : ` ${p.slider.unit}`}</span>
        </div>
      )}
    </div>
  );
}

function Table({ p }: { p: TablePreview }) {
  return (
    <table className="pp-table">
      <thead>
        <tr>{p.head.map((h, i) => <th key={i} scope="col">{h}</th>)}</tr>
      </thead>
      <tbody>
        {p.rows.map((row, ri) => (
          <tr key={ri}>
            {row.map((cell, ci) => {
              const focus = p.focus.row === ri && p.focus.col === ci ? 'true' : undefined;
              return ci === 0 ? <th key={ci} scope="row" data-focus={focus}>{cell}</th> : <td key={ci} data-focus={focus}>{cell}</td>;
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Sequence({ p }: { p: SequencePreview }) {
  return (
    <ol className="pp-steps">
      {p.steps.map((s, i) => (
        <li key={i} data-focus={i === p.focus ? 'true' : undefined}><span className="pp-step-n">{i + 1}</span><span>{s}</span></li>
      ))}
    </ol>
  );
}

function Sort({ p }: { p: SortPreview }) {
  return (
    <div className="pp-groups">
      {p.groups.map((g, gi) => (
        <div key={gi} className="pp-group">
          <p className="pp-group-label">{g.label}</p>
          <ul>
            {g.chips.map((c, ci) => (
              <li key={ci} data-focus={p.focus.group === gi && p.focus.chip === ci ? 'true' : undefined}>{c}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function Quiz({ p }: { p: QuizPreview }) {
  return (
    <div className="pp-quiz">
      <p className="pp-stem" data-focus="true">{p.stem}</p>
      <ul className="pp-options">
        {p.options.map((o, i) => <li key={i}><span className="pp-radio" />{o}</li>)}
      </ul>
    </div>
  );
}

function body(p: PartPreview): ReactNode {
  switch (p.kind) {
    case 'label-diagram': return <Diagram p={p} />;
    case 'half-life':
    case 'compound-interest': return <Curve p={p} />;
    case 'formula-explorer': return <Formula p={p} />;
    case 'compare-table':
    case 'data-table': return <Table p={p} />;
    case 'sequence': return <Sequence p={p} />;
    case 'sort-groups': return <Sort p={p} />;
    case 'quiz-cards': return <Quiz p={p} />;
  }
}

/** One part, small: its title, a faithful miniature of its body, and its kind. */
export function PartPreviewView({ preview, className }: { preview: PartPreview; className?: string }) {
  return (
    <figure className={`pp${className === undefined ? '' : ` ${className}`}`} data-kind={preview.kind}>
      <figcaption className="pp-title">{preview.title}</figcaption>
      <div className="pp-body">{body(preview)}</div>
      <p className="pp-kind">{preview.label}</p>
    </figure>
  );
}
