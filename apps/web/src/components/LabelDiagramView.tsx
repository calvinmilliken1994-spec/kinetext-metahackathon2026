// Label the diagram (label-diagram-v1, Stage 8b): the page's own figure with its printed labels covered, a numbered
// marker on each part, and a word bank of the page's part names. The class drags (or picks, then places) each name onto
// its number; Check marks each number; Show the answers uncovers the printed labels and outlines each part's region with
// its name. All geometry comes from the spec (lib/labelDiagramView.ts scales it and places the name tags); the view only
// measures the rendered tag sizes for that placement.
import { createContext, useContext, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, DragEvent, ReactNode, RefObject } from 'react';
import type { LabelDiagramSpec } from '../../../../packages/contracts/kit.ts';
import type { EnginePresentation } from '../lib/enginePresentation.ts';
import {
  checkPlacements, coverMasks, labelDiagramPresentationSteps, lessonFigureMaxWidth, partViews, place, placeTags, stageFigureSize, stageQuestion,
  stageView, unplace, wordBank,
} from '../lib/labelDiagramView.ts';
import type { CheckResult, LabelMask, PartView, PctBox, Placements } from '../lib/labelDiagramView.ts';
import { aiLabel } from '../lib/displayText.ts';
import { linkKey } from '../lib/linking.ts';
import type { CiteProps } from './Explanations.tsx';
import { Linked } from './Linked.tsx';
import { QuoteBlock } from './QuoteBlock.tsx';
import { IconClose, Mark } from './icons.tsx';

export interface LabelDiagramViewProps {
  spec: LabelDiagramSpec; cite: CiteProps; presentation?: EnginePresentation;
  /** Stage 9: the part has just arrived in a building lesson: its markers and SAM regions draw in one by one, then the regions fade (CSS, on mount). */
  build?: boolean;
}

/** Where the figure image comes from. The app reads the API; the dev harness serves the committed file instead. */
export const FigureSrcContext = createContext<(figureId: string) => string>((id) => `/api/figures/${encodeURIComponent(id)}/image`);

/**
 * Design size of the figure on a slide. Beats lays the part out 1100 wide and StageFit scales it whole to the stage
 * (about 1189×453 at 1366×768 and 1670×662 at 1920×1080, i.e. ~2.55:1), so a figure 436 tall IS the part's height: the
 * side column (question, names, numbers, credit) stays shorter, and the figure fills the stage from top to bottom.
 */
const STAGE_FIGURE = { maxW: 600, maxH: 436 };

const pct = (b: PctBox): CSSProperties => ({ left: `${b.left}%`, top: `${b.top}%`, width: `${b.width}%`, height: `${b.height}%` });
const DRAG_TYPE = 'text/plain';

type MarkerState = 'idle' | 'current' | 'right' | 'wrong';

/** A tag's top-left corner as a percentage of the plate, and its width in layout px (the name's measured width). */
type TagPos = { left: number; top: number; width: number };

let measureCtx: CanvasRenderingContext2D | null | undefined;
/** A name's width in the tag's font (layout px), measured off-DOM so a hidden tag never holds its answer's text. */
function textWidth(text: string, font: string): number {
  if (measureCtx === undefined) measureCtx = document.createElement('canvas').getContext('2d');
  if (measureCtx === null) return text.length * 8;
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}

/**
 * Places every name tag once per rendered size (lib placeTags: no tag on another tag, a cover or a marker, none outside
 * the figure). Every tag is laid out up front from its name's measured width (a hidden tag holds no name), so naming one
 * never moves another. Sizes are read in the plate's own layout units (client/offset sizes, unaffected by a slide's CSS
 * zoom).
 */
function useTagLayout(plateRef: RefObject<HTMLDivElement | null>, views: readonly PartView[], masks: readonly LabelMask[]): readonly TagPos[] | null {
  const [layout, setLayout] = useState<{ key: string; list: TagPos[] } | null>(null);
  useLayoutEffect(() => {
    const plate = plateRef.current;
    if (plate === null) return undefined;
    const measure = (): void => {
      const W = plate.clientWidth;
      const H = plate.clientHeight;
      if (!(W > 0) || !(H > 0)) return;
      const tagEls = Array.from(plate.querySelectorAll<HTMLElement>(':scope > .ld-tag'));
      const marker = plate.querySelector<HTMLElement>('.ld-marker');
      // the marker's white ring (2 px) counts as part of it
      const m = (marker?.offsetWidth ?? 26) + 4;
      const tags = views.map((v, i) => {
        const el = tagEls[i];
        let w = 0;
        if (el !== undefined) {
          const cs = getComputedStyle(el);
          w = Math.ceil(textWidth(v.name, cs.font) + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight)) + 1;
        }
        return { x: (v.point.left * W) / 100, y: (v.point.top * H) / 100, w, h: el?.offsetHeight ?? 0 };
      });
      const covers = masks.map((c) => ({ x: (c.box.left * W) / 100, y: (c.box.top * H) / 100, w: (c.box.width * W) / 100, h: (c.box.height * H) / 100 }));
      const list = placeTags({ width: W, height: H, marker: m, tags, covers }).map((p, i) => ({ left: (p.x * 100) / W, top: (p.y * 100) / H, width: tags[i]?.w ?? 0 }));
      const key = list.map((p) => `${p.left.toFixed(3)},${p.top.toFixed(3)},${p.width}`).join(';');
      setLayout((prev) => (prev !== null && prev.key === key ? prev : { key, list }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(plate);
    for (const t of Array.from(plate.querySelectorAll(':scope > .ld-tag'))) ro.observe(t);
    return () => ro.disconnect();
  }, [plateRef, views, masks]);
  return layout?.list ?? null;
}

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
  /** Caption and credit under the figure (lesson); a slide shows the credit in its side column instead. */
  caption: boolean;
  /** Lesson only: markers are buttons and drop targets. */
  marker?: (v: PartView, style: CSSProperties, state: MarkerState) => ReactNode;
  /** Stage 9: draw the markers and SAM regions in, part by part. */
  build?: boolean;
}

/** The page's figure: printed labels covered, a numbered marker per part, region outlines with names once named. */
function figureCredit(fig: LabelDiagramSpec['figure']): string {
  return [fig.credit.trim(), fig.license.trim()].filter((s) => s !== '').join(' · ');
}

function Figure({ spec, views, masks, named, labelsShown, markerState, current, size, caption, marker, build = false }: FigureProps) {
  const srcOf = useContext(FigureSrcContext);
  const [failed, setFailed] = useState(false);
  const plateRef = useRef<HTMLDivElement>(null);
  const tagPos = useTagLayout(plateRef, views, masks);
  const fig = spec.figure;
  const plateStyle: CSSProperties = size !== undefined
    ? { width: size.width, height: size.height }
    : { aspectRatio: `${fig.width > 0 ? fig.width : 1} / ${fig.height > 0 ? fig.height : 1}` };
  const maxW = lessonFigureMaxWidth(fig);
  const figureStyle: CSSProperties | undefined = size !== undefined ? { width: size.width } : maxW !== null ? { maxInlineSize: `${maxW}px` } : undefined;
  const credit = figureCredit(fig);
  return (
    <figure className="ld-figure" style={figureStyle}>
      <div className="ld-plate" style={plateStyle} ref={plateRef} data-labels={labelsShown ? 'shown' : 'covered'} data-build={build ? 'draw' : undefined}>
        {failed
          ? <p className="ld-missing">The figure could not be loaded.</p>
          : <img src={srcOf(spec.figureId)} alt={fig.caption.trim() === '' ? 'The page’s figure, labels covered' : `The page’s figure, labels covered: ${fig.caption.trim()}`} draggable={false} onError={() => setFailed(true)} />}
        {masks.map((m) => (
          <span key={m.key} className="ld-mask" style={pct(m.box)} data-on={labelsShown ? 'false' : 'true'} aria-hidden="true" />
        ))}
        {views.map((v) => (v.region === null ? null : (
          <span
            key={`r-${v.part.id}`} className="ld-region" style={build ? { ...pct(v.region), '--i': v.index } as CSSProperties : pct(v.region)} data-on={named[v.index] === true ? 'true' : 'false'}
            data-current={current === v.index ? 'true' : 'false'} aria-hidden="true"
          />
        )))}
        {views.map((v) => {
          const state = markerState(v);
          const style: CSSProperties = { left: `${v.point.left}%`, top: `${v.point.top}%` };
          return marker !== undefined
            ? <span key={`m-${v.part.id}`} className="ld-marker-slot" style={build ? { '--i': v.index } as CSSProperties : undefined}>{marker(v, style, state)}</span>
            : <span key={`m-${v.part.id}`} className="ld-marker" data-state={state} style={style} aria-hidden="true"><span className="num">{v.number}</span></span>;
        })}
        {/* Name tags last (above markers), one per part in spec order, placed once by lib placeTags; shown when named. */}
        {views.map((v) => {
          const p = tagPos?.[v.index];
          const on = named[v.index] === true && p !== undefined;
          return (
            <span
              key={`t-${v.part.id}`} className="ld-tag" aria-hidden="true" data-on={on ? 'true' : 'false'} data-current={current === v.index ? 'true' : 'false'}
              style={p === undefined ? undefined : { left: `${p.left}%`, top: `${p.top}%`, inlineSize: p.width }}
            >{named[v.index] === true ? v.name : '\u00a0'}</span>
          );
        })}
      </div>
      {caption && (
        <figcaption className="ld-figcaption">
          {fig.caption.trim() !== '' && <span className="ld-caption">{fig.caption.trim()}</span>}
          {credit !== '' && <span className="ld-credit">{credit}</span>}
        </figcaption>
      )}
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

function LessonDiagram({ spec, cite, build = false }: { spec: LabelDiagramSpec; cite: CiteProps; build?: boolean }) {
  const views = useMemo(() => partViews(spec), [spec]);
  const masks = useMemo(() => coverMasks(spec), [spec]);
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
        <Figure spec={spec} views={views} masks={masks} named={named} labelsShown={revealed} markerState={markerState} current={null} caption marker={marker} build={build} />
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
  const masks = useMemo(() => coverMasks(spec), [spec]);
  const bank = useMemo(() => wordBank(spec), [spec]);
  const steps = labelDiagramPresentationSteps(spec);
  const st = stageView(spec, presentation.step, presentation.revealed);
  const size = stageFigureSize(spec.figure, STAGE_FIGURE.maxW, STAGE_FIGURE.maxH);
  const markerState = (v: PartView): MarkerState => (st.current === v.index ? 'current' : 'idle');
  const namedTokens = new Set(views.filter((v) => st.named[v.index] === true).map((v) => v.part.id));
  // Two columns of numbers from five parts on, so the side stays shorter than the figure (which sets the slide's height).
  const cols = spec.parts.length > 4 ? 2 : 1;
  const credit = figureCredit(spec.figure);
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
          {credit !== '' && <p className="ld-credit ld-stage-credit">{credit}</p>}
        </div>
      </div>
    </div>
  );
}

/**
 * Label the diagram. In a lesson: drag or place the page's names on the numbered parts, check, hint, show the answers.
 * On a slide (`presentation`): one part per presenter step, R names it; the last step's R uncovers the printed labels.
 */
export function LabelDiagramView({ spec, cite, presentation, build = false }: LabelDiagramViewProps) {
  if (presentation !== undefined) return <StageDiagram spec={spec} presentation={presentation} />;
  return <LessonDiagram spec={spec} cite={cite} build={build} />;
}
