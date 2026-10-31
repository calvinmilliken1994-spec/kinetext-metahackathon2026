// Label the diagram (label-diagram-v1, Stage 8b): the page's own figure with its printed labels covered, a numbered
// marker on each part, and a word bank of the page's part names. The class drags (or picks, then places) each name onto
// its number; Check marks each number; Show the answers uncovers the printed labels and outlines each part's region with
// its name. All geometry comes from the spec (lib/labelDiagramView.ts scales it); nothing here is computed beyond that.
import { createContext, useContext, useMemo, useState } from 'react';
import type { CSSProperties, DragEvent, ReactNode } from 'react';
import type { LabelDiagramSpec } from '../../../../packages/contracts/kit.ts';
import type { EnginePresentation } from '../lib/enginePresentation.ts';
import {
  checkPlacements, labelDiagramPresentationSteps, labelMasks, partViews, place, stageFigureSize, stageQuestion, stageView, unplace, wordBank,
} from '../lib/labelDiagramView.ts';
import type { CheckResult, LabelMask, PartView, PctBox, Placements } from '../lib/labelDiagramView.ts';
import { aiLabel } from '../lib/displayText.ts';
import { linkKey } from '../lib/linking.ts';
import type { CiteProps } from './Explanations.tsx';
import { Linked } from './Linked.tsx';
import { QuoteBlock } from './QuoteBlock.tsx';
import { IconClose, Mark } from './icons.tsx';

export interface LabelDiagramViewProps { spec: LabelDiagramSpec; cite: CiteProps; presentation?: EnginePresentation }

/** Where the figure image comes from. The app reads the API; the dev harness serves the committed file instead. */
export const FigureSrcContext = createContext<(figureId: string) => string>((id) => `/api/figures/${encodeURIComponent(id)}/image`);

/** Design size of the figure on a slide (StageFit scales the whole part to the stage; Beats lays it out 1100 wide). */
const STAGE_FIGURE = { maxW: 560, maxH: 392 };

const pct = (b: PctBox): CSSProperties => ({ left: `${b.left}%`, top: `${b.top}%`, width: `${b.width}%`, height: `${b.height}%` });
const DRAG_TYPE = 'text/plain';

type MarkerState = 'idle' | 'current' | 'right' | 'wrong';

interface FigureProps {
  spec: LabelDiagramSpec;
  views: readonly PartView[];
  masks: readonly LabelMask[];
  named: readonly boolean[];
  labelsShown: boolean;
  markerState: (v: PartView) => MarkerState;
  /** The outline drawn stronger (the part a slide just revealed). */
  current: number | null;
  /** Fixed slide size; the lesson figure fills its column at the image's aspect instead. */
  size?: { width: number; height: number };
  caption: boolean;
  /** Lesson only: markers are buttons and drop targets. */
  marker?: (v: PartView, style: CSSProperties, state: MarkerState) => ReactNode;
}

/** The page's figure: printed labels covered, a numbered marker per part, region outlines with names once named. */
function Figure({ spec, views, masks, named, labelsShown, markerState, current, size, caption, marker }: FigureProps) {
  const srcOf = useContext(FigureSrcContext);
  const [failed, setFailed] = useState(false);
  const fig = spec.figure;
  const plateStyle: CSSProperties = size !== undefined
    ? { width: size.width, height: size.height }
    : { aspectRatio: `${fig.width > 0 ? fig.width : 1} / ${fig.height > 0 ? fig.height : 1}` };
  const credit = [fig.credit.trim(), fig.license.trim()].filter((s) => s !== '').join(' · ');
  return (
    <figure className="ld-figure" style={size !== undefined ? { width: size.width } : undefined}>
      <div className="ld-plate" style={plateStyle}>
        {failed
          ? <p className="ld-missing">The figure could not be loaded.</p>
          : <img src={srcOf(spec.figureId)} alt={fig.caption.trim() === '' ? 'The page’s figure, labels covered' : `The page’s figure, labels covered: ${fig.caption.trim()}`} draggable={false} onError={() => setFailed(true)} />}
        {masks.map((m) => (
          <span key={m.key} className="ld-mask" style={pct(m.box)} data-on={labelsShown ? 'false' : 'true'} aria-hidden="true" />
        ))}
        {views.map((v) => (v.region === null ? null : (
          <span
            key={`r-${v.part.id}`} className="ld-region" style={{ ...pct(v.region), '--depth': v.pointDepth } as CSSProperties} data-on={named[v.index] === true ? 'true' : 'false'}
            data-current={current === v.index ? 'true' : 'false'} aria-hidden="true"
          >
            <span className="ld-region-tag" data-tag={v.tag}>{v.name}</span>
          </span>
        )))}
        {views.map((v) => {
          const state = markerState(v);
          const style: CSSProperties = { left: `${v.point.left}%`, top: `${v.point.top}%` };
          return marker !== undefined
            ? <span key={`m-${v.part.id}`} className="ld-marker-slot">{marker(v, style, state)}</span>
            : <span key={`m-${v.part.id}`} className="ld-marker" data-state={state} style={style} aria-hidden="true"><span className="num">{v.number}</span></span>;
        })}
      </div>
      <figcaption className="ld-figcaption">
        {caption && fig.caption.trim() !== '' && <span className="ld-caption">{fig.caption.trim()}</span>}
        {credit !== '' && <span className="ld-credit">{credit}</span>}
      </figcaption>
    </figure>
  );
}

/** The page's sentences behind the names, once per sentence (four bases may share one), each with "Show in source". */
function PageQuotes({ spec, views, cite }: { spec: LabelDiagramSpec; views: readonly PartView[]; cite: CiteProps }) {
  const groups = useMemo(() => {
    const out: { first: PartView; names: string[] }[] = [];
    for (const v of views) {
      const g = out.find((x) => x.first.part.sourceId === v.part.sourceId && x.first.part.quote === v.part.quote);
      if (g === undefined) out.push({ first: v, names: [v.name] });
      else g.names.push(v.part.name.trim());
    }
    return out;
  }, [views]);
  return (
    <details className="ld-quotes">
      <summary>Where the page names each part</summary>
      {groups.map((g) => (
        <QuoteBlock
          key={g.first.part.id} componentId={spec.componentId} part="part" id={g.first.part.id} sourceId={g.first.part.sourceId}
          quote={g.first.part.quote} cite={cite} caption={g.names.join(', ')}
        />
      ))}
    </details>
  );
}

// ---- lesson ----------------------------------------------------------------------------------------------------------

function LessonDiagram({ spec, cite }: { spec: LabelDiagramSpec; cite: CiteProps }) {
  const views = useMemo(() => partViews(spec), [spec]);
  const masks = useMemo(() => labelMasks(spec.parts), [spec]);
  const bank = useMemo(() => wordBank(spec), [spec]);
  const [placements, setPlacements] = useState<Placements>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [checked, setChecked] = useState<CheckResult | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [hint, setHint] = useState(false);
  const [said, setSaid] = useState('');
  const [over, setOver] = useState<string | null>(null);

  const nameOf = (token: string | undefined): string => bank.find((b) => b.token === token)?.name ?? '';
  const placedOn = new Map(Object.entries(placements).map(([m, t]) => [t, m]));
  const numberOf = (partId: string): number => (views.find((v) => v.part.id === partId)?.number ?? 0);
  const answers = checkPlacements(spec, placements);
  const open = !revealed;

  const put = (token: string, markerId: string): void => {
    if (!open) return;
    setPlacements((p) => place(p, token, markerId));
    setChecked(null);
    setSelected(null);
    setSaid(`${nameOf(token)} is on number ${numberOf(markerId)}.`);
  };
  const takeOff = (markerId: string): void => {
    const token = placements[markerId];
    setPlacements((p) => unplace(p, markerId));
    setChecked(null);
    setSaid(token === undefined ? '' : `${nameOf(token)} is back in the word bank.`);
  };
  /** A marker or slot clicked: place the chosen name there, or pick up the name already on it. */
  const target = (markerId: string): void => {
    if (!open) return;
    if (selected !== null) { put(selected, markerId); return; }
    const token = placements[markerId];
    if (token !== undefined) { setSelected(token); setSaid(`${nameOf(token)} picked up. Choose its number.`); }
  };
  const choose = (token: string): void => {
    if (!open) return;
    const next = selected === token ? null : token;
    setSelected(next);
    setSaid(next === null ? '' : `${nameOf(token)} chosen. Now choose its number on the diagram or in the list.`);
  };
  const dropProps = (markerId: string) => ({
    onDragOver: (e: DragEvent) => { if (open) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (over !== markerId) setOver(markerId); } },
    onDragLeave: () => setOver((o) => (o === markerId ? null : o)),
    onDrop: (e: DragEvent) => { e.preventDefault(); setOver(null); const token = e.dataTransfer.getData(DRAG_TYPE); if (bank.some((b) => b.token === token)) put(token, markerId); },
  });
  const dragProps = (token: string) => ({
    draggable: open,
    onDragStart: (e: DragEvent) => { e.dataTransfer.setData(DRAG_TYPE, token); e.dataTransfer.effectAllowed = 'move'; setSelected(null); },
    onDragEnd: () => setOver(null),
  });
  const reset = (): void => { setPlacements({}); setSelected(null); setChecked(null); setRevealed(false); setHint(false); setSaid(''); };

  const resultOf = (partId: string): 'right' | 'wrong' | null => {
    const shown = revealed ? answers : checked;
    const r = shown?.results[partId];
    return r === 'right' || r === 'wrong' ? r : null;
  };
  const markerState = (v: PartView): MarkerState => resultOf(v.part.id) ?? 'idle';
  const named = views.map(() => revealed);
  const armed = selected !== null && open ? 'true' : 'false';

  const marker = (v: PartView, style: CSSProperties, state: MarkerState): ReactNode => {
    const token = placements[v.part.id];
    const label = `Number ${v.number} on the diagram${token === undefined ? ', no name yet' : `, labelled ${nameOf(token)}`}${state === 'right' ? ', right' : state === 'wrong' ? ', wrong' : ''}`;
    return (
      <button
        type="button" className="ld-marker" data-state={state} data-filled={token !== undefined ? 'true' : 'false'} data-over={over === v.part.id ? 'true' : 'false'}
        data-armed={armed} style={style} aria-label={label} onClick={() => target(v.part.id)} disabled={!open}
        {...dropProps(v.part.id)}
      ><span className="num">{v.number}</span></button>
    );
  };

  const status = revealed
    ? (masks.length > 0 ? 'Answers shown, and the figure’s own labels are uncovered.' : 'Answers shown.')
    : checked !== null
      ? (checked.right === checked.total ? `All ${checked.total} right.` : `${checked.right} of ${checked.total} right.${checked.complete ? ' Move the names marked wrong and check again.' : ' Some numbers have no name yet.'}`)
      : selected !== null
        ? `“${nameOf(selected)}” chosen. Now choose its number.`
        : 'Drag each name onto its number, or choose a name and then a number.';

  return (
    <div className="ld" data-mode="lesson" data-testid="label-diagram">
      <div className="ld-body">
        <Figure spec={spec} views={views} masks={masks} named={named} labelsShown={revealed} markerState={markerState} current={null} caption marker={marker} />
        <div className="ld-side">
          <div className="ld-bank" role="group" aria-label="Word bank: the page’s names for the parts">
            {bank.map((b) => {
              const on = placedOn.get(b.token);
              const part = spec.parts.find((p) => p.id === b.token);
              return (
                <Linked key={b.token} as="div" className="ld-chip-wrap" links={part === undefined ? [] : [linkKey(part.sourceId, part.quote)]}>
                  <button
                    type="button" className="ld-chip" aria-pressed={selected === b.token} data-used={on !== undefined ? 'true' : 'false'}
                    disabled={!open} onClick={() => choose(b.token)} {...dragProps(b.token)}
                    aria-label={`${b.name}${on !== undefined ? `, on number ${numberOf(on)}` : ''}`}
                  >{b.name}</button>
                </Linked>
              );
            })}
          </div>

          <ol className="ld-rows" aria-label="Numbers on the diagram">
            {views.map((v) => {
              const token = placements[v.part.id];
              const r = resultOf(v.part.id);
              return (
                <Linked as="li" key={v.part.id} className="ld-row" links={revealed ? [linkKey(v.part.sourceId, v.part.quote)] : []} data-result={r ?? 'open'}>
                  <span className="ld-row-n num" aria-hidden="true">{v.number}</span>
                  <span className="ld-stack">
                    <span data-on={revealed ? 'false' : 'true'} className="ld-slot-cell">
                      <button
                        type="button" className="ld-slot" data-filled={token !== undefined ? 'true' : 'false'} data-over={over === v.part.id ? 'true' : 'false'}
                        data-armed={armed} disabled={!open} onClick={() => target(v.part.id)} {...dropProps(v.part.id)}
                        aria-label={`Number ${v.number} in the list: ${token === undefined ? 'no name yet' : nameOf(token)}`}
                      >
                        {token === undefined
                          ? <span className="ld-slot-empty">Drop a name here</span>
                          : <span className="ld-slot-name" {...dragProps(token)}>{nameOf(token)}</span>}
                      </button>
                      <button
                        type="button" className="ld-off" onClick={() => takeOff(v.part.id)} data-on={token !== undefined && open ? 'true' : 'false'}
                        disabled={token === undefined || !open} aria-hidden={token !== undefined && open ? undefined : true} tabIndex={token !== undefined && open ? undefined : -1}
                        aria-label={token === undefined ? undefined : `Take ${nameOf(token)} off number ${v.number}`}
                      ><IconClose size={16} /></button>
                    </span>
                    <span data-on={revealed ? 'true' : 'false'} className="ld-answer" aria-hidden={revealed ? undefined : true}>
                      {revealed ? v.name : '\u00a0'}
                      {revealed && r === 'wrong' && <span className="ld-yours"> · you had {nameOf(token)}</span>}
                    </span>
                  </span>
                  <span className="ld-row-mark">
                    {r !== null && <Mark kind={r === 'right' ? 'ok' : 'bad'} label={r === 'right' ? 'Right' : 'Wrong'} />}
                  </span>
                </Linked>
              );
            })}
          </ol>

          <div className="ld-actions">
            <button type="button" className="btn btn-primary" onClick={() => setChecked(checkPlacements(spec, placements))} disabled={!open || Object.keys(placements).length === 0}>Check</button>
            <button type="button" className="btn" onClick={() => setHint((h) => !h)} aria-expanded={hint} disabled={spec.hint.trim() === ''}>Hint</button>
            <button type="button" className="btn" onClick={() => { setRevealed(true); setSelected(null); }} disabled={revealed}>Show the answers</button>
            <button type="button" className="btn btn-quiet" onClick={reset}>Start again</button>
          </div>
          <p className="ld-status" role="status">{status}</p>
          <p className="ld-hint" data-on={hint ? 'true' : 'false'} aria-hidden={hint ? undefined : true}>{aiLabel(spec.hint)}</p>
          <p className="sr-only" aria-live="polite">{said}</p>
        </div>
      </div>
      <PageQuotes spec={spec} views={views} cite={cite} />
    </div>
  );
}

// ---- presentation ----------------------------------------------------------------------------------------------------

function StageDiagram({ spec, presentation }: { spec: LabelDiagramSpec; presentation: EnginePresentation }) {
  const views = useMemo(() => partViews(spec), [spec]);
  const masks = useMemo(() => labelMasks(spec.parts), [spec]);
  const bank = useMemo(() => wordBank(spec), [spec]);
  const steps = labelDiagramPresentationSteps(spec);
  const st = stageView(spec, presentation.step, presentation.revealed);
  const size = stageFigureSize(spec.figure, STAGE_FIGURE.maxW, STAGE_FIGURE.maxH);
  const markerState = (v: PartView): MarkerState => (st.current === v.index ? 'current' : 'idle');
  const namedTokens = new Set(views.filter((v) => st.named[v.index] === true).map((v) => v.part.id));
  const cols = spec.parts.length > 6 ? 2 : 1;
  const step = st.final ? spec.parts.length : (st.current ?? 0);

  return (
    <div className="ld" data-mode="stage" data-testid="label-diagram">
      <div className="ld-body">
        <Figure spec={spec} views={views} masks={masks} named={st.named} labelsShown={st.labelsShown} markerState={markerState} current={presentation.revealed ? st.current : null} size={size} caption={false} />
        <div className="ld-side">
          {/* Every step's question in one stacked cell, so → never moves the slide. */}
          <div className="ld-ask ld-stack">
            {Array.from({ length: steps }, (_, i) => {
              const q = stageQuestion(spec, i);
              return (
                <p key={i} className="ld-question" data-on={i === step ? 'true' : 'false'} aria-hidden={i === step ? undefined : true}>
                  {q.question} <span className="ld-progress">{q.eyebrow}</span>
                </p>
              );
            })}
          </div>
          <div className="ld-bank" aria-label="The page’s names for the parts">
            {bank.map((b) => {
              const part = spec.parts.find((p) => p.id === b.token);
              return (
                <Linked key={b.token} as="p" className="ld-chip" data-used={namedTokens.has(b.token) ? 'true' : 'false'} links={part === undefined ? [] : [linkKey(part.sourceId, part.quote)]}>
                  {b.name}
                </Linked>
              );
            })}
          </div>
          <ol className="ld-rows" data-cols={cols} aria-label="Numbers on the diagram">
            {views.map((v) => {
              const on = st.named[v.index] === true;
              return (
                <Linked as="li" key={v.part.id} className="ld-row" links={on ? [linkKey(v.part.sourceId, v.part.quote)] : []} data-current={st.current === v.index ? 'true' : 'false'}>
                  <span className="ld-row-n num" aria-hidden="true">{v.number}</span>
                  <span className="ld-stack">
                    <span data-on={on ? 'true' : 'false'} className="ld-answer" aria-hidden={on ? undefined : true}>{on ? v.name : '\u00a0'}</span>
                    <span data-on={on ? 'false' : 'true'} className="concealed" aria-label={on ? undefined : `Number ${v.number}: hidden until the reveal`}>?</span>
                  </span>
                </Linked>
              );
            })}
          </ol>
          <div className="ld-foot ld-stack">
            <p data-on={!st.final && !presentation.revealed ? 'true' : 'false'}>Let the class name it, then press <kbd>R</kbd>.</p>
            <p data-on={!st.final && presentation.revealed ? 'true' : 'false'}>Press <kbd>→</kbd> for the next part.</p>
            <p data-on={st.final && !presentation.revealed ? 'true' : 'false'}>Press <kbd>R</kbd> to uncover the figure’s labels.</p>
            <p data-on={st.labelsShown ? 'true' : 'false'}>These are the labels the figure prints.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Label the diagram. In a lesson: drag or place the page's names on the numbered parts, check, hint, show the answers.
 * On a slide (`presentation`): one part per presenter step, R names it; the last step's R uncovers the printed labels.
 */
export function LabelDiagramView({ spec, cite, presentation }: LabelDiagramViewProps) {
  if (presentation !== undefined) return <StageDiagram spec={spec} presentation={presentation} />;
  return <LessonDiagram spec={spec} cite={cite} />;
}
