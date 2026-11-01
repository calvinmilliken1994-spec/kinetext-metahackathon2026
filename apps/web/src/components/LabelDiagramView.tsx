// Label the diagram (label-diagram-v1, Stage 8b): the page's own figure with its printed labels turned into blank label
// slots (like a worksheet: the figure's leader lines point at them), a numbered marker on each part, and a word bank of the
// page's part names. The class drags (or picks, then places) each name onto its number; Check marks each number; a right
// name, Show the answers or a presenter's R writes the part's name INTO its own slot. Parts with no printed label get a
// small name tag beside the marker instead. A printed label no part claims is a muted patch in the figure's own colour,
// never a slot (Stage 8c). SAM's region boxes show only while a build draws them in, as a soft accent glow (Stage 8c
// Addendum A: boxes from the models only, never a traced outline). All geometry
// comes from the spec (lib/labelDiagramView.ts matches parts to slots, fits the text and places the tags); the view only
// measures the rendered size for that fitting.
import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, DragEvent, ReactNode, RefObject } from 'react';
import type { LabelDiagramSpec } from '../../../../packages/contracts/kit.ts';
import type { EnginePresentation } from '../lib/enginePresentation.ts';
import { glowStyle, patchFills, regionDrawing,
  changedBy, checkPlacements, coverMasks, finishLine, fitSlotTexts, keepResults, labelDiagramPresentationSteps, labelSlots, lessonFigureMaxWidth, markerSpots,
  partViews, place, placeTags, slotOfPart, slotStates, stageFigureSize, stageOutline, stageQuestion, stageView, unplace, wordBank,
} from '../lib/labelDiagramView.ts';
import type { CheckResult, LabelMask, LabelSlot, PartView, PctBox, Placements, SlotFit, SlotState } from '../lib/labelDiagramView.ts';
import { aiLabel } from '../lib/displayText.ts';
import { figureCredit } from '../lib/presentation.ts';
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

type PatchFill = { top: string; bottom: string };

/** Where the figure image comes from. The app reads the API; the dev harness serves the committed file instead. */
export const FigureSrcContext = createContext<(figureId: string) => string>((id) => `/api/figures/${encodeURIComponent(id)}/image`);

/**
 * Design size of the figure on a slide. Beats lays the part out 1100 wide and StageFit scales it whole to the stage
 * (about 1189×453 at 1366×768 and 1670×662 at 1920×1080, i.e. ~2.55:1), so a figure 436 tall IS the part's height: the
 * side column (question, names, numbers, credit) stays shorter, and the figure fills the stage from top to bottom.
 */
const STAGE_FIGURE = { maxW: 600, maxH: 436 };
/** Font-size range (layout px) for names written into slots: about the printed labels' own size, never unreadably small. */
const STAGE_SLOT_FONT = { min: 9, max: 17 };
const LESSON_SLOT_FONT = { min: 9, max: 20 };

const pct = (b: PctBox): CSSProperties => ({ left: `${b.left}%`, top: `${b.top}%`, width: `${b.width}%`, height: `${b.height}%` });
const DRAG_TYPE = 'text/plain';

type MarkerState = 'idle' | 'current' | 'right' | 'wrong';

/** A tag's top-left corner as a percentage of the plate, and its width in layout px (the name's measured width). */
type TagPos = { left: number; top: number; width: number };

let measureCtx: CanvasRenderingContext2D | null | undefined;
/** A name's width in a font (layout px), measured off-DOM so a hidden tag or slot never holds its answer's text. */
function textWidth(text: string, font: string): number {
  if (measureCtx === undefined) measureCtx = document.createElement('canvas').getContext('2d');
  if (measureCtx === null) return text.length * 8;
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}

/** Weight of the names written into slots (matches .ld-slotname in engines-c.css). */
const SLOT_WEIGHT = 500;

/** A marker's centre as a percentage of the plate. */
type Spot = { left: number; top: number };

/**
 * Where each numbered marker sits (lib markerSpots, D2): on its part's point, or just clear of every printed label /
 * slot, so a written name never covers a number and no number covers a printed word on the last slide. Once per
 * rendered size; never per step or reveal, so nothing moves on R.
 */
function useMarkerSpots(plateRef: RefObject<HTMLDivElement | null>, views: readonly PartView[], covers: readonly PctBox[]): readonly Spot[] {
  const raw = useMemo(() => views.map((v) => ({ left: v.point.left, top: v.point.top })), [views]);
  const [spots, setSpots] = useState<{ key: string; list: Spot[] } | null>(null);
  useLayoutEffect(() => {
    const plate = plateRef.current;
    if (plate === null) return undefined;
    const measure = (): void => {
      const W = plate.clientWidth;
      const H = plate.clientHeight;
      if (!(W > 0) || !(H > 0)) return;
      const marker = plate.querySelector<HTMLElement>('.ld-marker');
      const m = (marker?.offsetWidth ?? 26) + 4;
      const avoid = covers.map((c) => ({ x: (c.left * W) / 100, y: (c.top * H) / 100, w: (c.width * W) / 100, h: (c.height * H) / 100 }));
      const list = markerSpots({ width: W, height: H, marker: m, points: raw.map((p) => ({ x: (p.left * W) / 100, y: (p.top * H) / 100 })), avoid })
        .map((p) => ({ left: (p.x * 100) / W, top: (p.y * 100) / H }));
      const key = list.map((p) => `${p.left.toFixed(3)},${p.top.toFixed(3)}`).join(';');
      setSpots((prev) => (prev !== null && prev.key === key ? prev : { key, list }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(plate);
    return () => ro.disconnect();
  }, [plateRef, raw, covers]);
  return spots?.list ?? raw;
}

/**
 * Places the floating name tags once per rendered size (lib placeTags: no tag on another tag, a slot or cover, or a
 * marker, none outside the figure). Only parts without a slot get a tag (`tagged`); the others still count as markers.
 * Every tag is laid out up front from its name's measured width (a hidden tag holds no name), so naming one never moves
 * another. Sizes are read in the plate's own layout units (client/offset sizes, unaffected by a slide's CSS zoom).
 */
function useTagLayout(plateRef: RefObject<HTMLDivElement | null>, views: readonly PartView[], tagged: readonly boolean[], covers: readonly PctBox[], spots: readonly Spot[]): readonly TagPos[] | null {
  const [layout, setLayout] = useState<{ key: string; list: TagPos[] } | null>(null);
  useLayoutEffect(() => {
    const plate = plateRef.current;
    if (plate === null) return undefined;
    const measure = (): void => {
      const W = plate.clientWidth;
      const H = plate.clientHeight;
      if (!(W > 0) || !(H > 0)) return;
      const marker = plate.querySelector<HTMLElement>('.ld-marker');
      // the marker's white ring (2 px) counts as part of it
      const m = (marker?.offsetWidth ?? 26) + 4;
      const tags = views.map((v) => {
        const el = plate.querySelector<HTMLElement>(`:scope > .ld-tag[data-i="${v.index}"]`);
        let w = 0;
        if (el !== null && tagged[v.index] === true) {
          const cs = getComputedStyle(el);
          w = Math.ceil(textWidth(v.name, cs.font) + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight)) + 1;
        }
        const at = spots[v.index] ?? v.point;
        return { x: (at.left * W) / 100, y: (at.top * H) / 100, w, h: w > 0 ? (el?.offsetHeight ?? 0) : 0 };
      });
      const rects = covers.map((c) => ({ x: (c.left * W) / 100, y: (c.top * H) / 100, w: (c.width * W) / 100, h: (c.height * H) / 100 }));
      const list = placeTags({ width: W, height: H, marker: m, tags, covers: rects }).map((p, i) => ({ left: (p.x * 100) / W, top: (p.y * 100) / H, width: tags[i]?.w ?? 0 }));
      const key = list.map((p) => `${p.left.toFixed(3)},${p.top.toFixed(3)},${p.width}`).join(';');
      setLayout((prev) => (prev !== null && prev.key === key ? prev : { key, list }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(plate);
    return () => ro.disconnect();
  }, [plateRef, views, tagged, covers, spots]);
  return layout?.list ?? null;
}

/**
 * Fits each matched slot's name to the slot at one shared size (lib fitSlotTexts: shrink to fit, at most two lines), once
 * per rendered size.
 * Every slot is fitted up front, named or not, so writing a name in never changes another slot; the names live in
 * state only and reach the DOM when their part is named.
 */
function useSlotFits(plateRef: RefObject<HTMLDivElement | null>, slots: readonly LabelSlot[], views: readonly PartView[], range: { min: number; max: number }): readonly (SlotFit | null)[] {
  const [fits, setFits] = useState<{ key: string; list: (SlotFit | null)[] }>({ key: '', list: [] });
  useLayoutEffect(() => {
    const plate = plateRef.current;
    if (plate === null) return undefined;
    const measure = (): void => {
      const W = plate.clientWidth;
      const H = plate.clientHeight;
      if (!(W > 0) || !(H > 0)) return;
      const family = getComputedStyle(plate).fontFamily;
      const width = (text: string, px: number): number => textWidth(text, `${SLOT_WEIGHT} ${px}px ${family}`);
      const list = fitSlotTexts(slots.map((s) => {
        const v = s.partIndex === null ? undefined : views[s.partIndex];
        return v === undefined ? null : { name: v.name, w: (s.box.width * W) / 100, h: (s.box.height * H) / 100 };
      }), width, range);
      const key = `${W}x${H}:` + list.map((f) => (f === null ? '-' : `${f.fontSize}/${f.lines.length}`)).join(';');
      setFits((prev) => (prev.key === key ? prev : { key, list }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(plate);
    return () => ro.disconnect();
  }, [plateRef, slots, views, range]);
  return fits.list;
}

/**
 * Stage 8c: the colour of each muted patch (a printed label no part claims), read once from the figure's own pixels
 * around the label (lib patchFills), so the patch blends into the figure. Until the image is read (or when the canvas
 * cannot read it), the patch keeps its CSS fallback.
 */
function usePatchColours(img: HTMLImageElement | null, ready: boolean, slots: readonly LabelSlot[], figure: { width: number; height: number }): Readonly<Record<string, PatchFill>> {
  const [colours, setColours] = useState<Readonly<Record<string, PatchFill>>>({});
  const muted = useMemo(() => slots.filter((s) => s.partIndex === null), [slots]);
  useLayoutEffect(() => {
    if (img === null || !ready || muted.length === 0 || !(img.naturalWidth > 0) || !(figure.width > 0) || !(figure.height > 0)) return;
    try {
      // drawn at the figure's stored size, the size the label boxes are measured in
      const canvas = document.createElement('canvas');
      canvas.width = figure.width;
      canvas.height = figure.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (ctx === null) return;
      ctx.drawImage(img, 0, 0, figure.width, figure.height);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const out: Record<string, PatchFill> = {};
      for (const s of muted) {
        const c = patchFills(pixels, s.px);
        if (c !== null) out[s.key] = c;
      }
      setColours(out);
    } catch {
      // a canvas that cannot read the image (cross-origin) keeps the CSS fallback
    }
  }, [img, ready, muted, figure.width, figure.height]);
  return colours;
}

interface FigureProps {
  spec: LabelDiagramSpec;
  views: readonly PartView[];
  /** The printed labels as slots (lessons with stored label boxes); empty for older lessons, which use `masks`. */
  slots: readonly LabelSlot[];
  /** Fallback covers (older lessons without stored label boxes). */
  masks: readonly LabelMask[];
  named: readonly boolean[];
  /** What each slot shows (lib slotStates). */
  slotState: readonly SlotState[];
  /** Fallback covers and floating tags: the printed labels are uncovered. */
  labelsShown: boolean;
  markerState: (v: PartView) => MarkerState;
  /** The part a slide is on (its slot and tag drawn in the accent). */
  current: number | null;
  /** The one part whose SAM region is outlined, or null. */
  outlined: number | null;
  /** Font-size range for the names written in slots (layout px). */
  slotFont: { min: number; max: number };
  /** Fixed slide size; the lesson figure fills its column at the image's aspect instead. */
  size?: { width: number; height: number };
  /** Caption and credit under the figure (lesson); a slide shows the credit in its side column instead. */
  caption: boolean;
  /** Lesson only: markers are buttons and drop targets. */
  marker?: (v: PartView, style: CSSProperties, state: MarkerState) => ReactNode;
  /** Lesson only: a named slot was hovered (outline its part). */
  onSlotHover?: (index: number | null) => void;
  /** Stage 9: draw the markers and SAM regions in, part by part. */
  build?: boolean;
}

/** The page's figure: printed labels as slots (or covers), a numbered marker per part, the focused part's outline. */

function Figure({ spec, views, slots, masks, named, slotState, labelsShown, markerState, current, outlined, slotFont, size, caption, marker, onSlotHover, build = false }: FigureProps) {
  const srcOf = useContext(FigureSrcContext);
  const [failed, setFailed] = useState(false);
  // Demo review: on a cold load the build's draw-in played over an empty plate. It waits for the image (a cached image
  // is already complete when the ref attaches).
  const [imgReady, setImgReady] = useState(false);
  const [imgEl, setImgEl] = useState<HTMLImageElement | null>(null);
  const imgRef = useCallback((el: HTMLImageElement | null) => { setImgEl(el); if (el?.complete === true && el.naturalWidth > 0) setImgReady(true); }, []);
  const plateRef = useRef<HTMLDivElement>(null);
  const slotOf = useMemo(() => slotOfPart(slots, views.length), [slots, views.length]);
  const tagged = useMemo(() => slotOf.map((k) => k === null), [slotOf]);
  const covers = useMemo(() => (slots.length > 0 ? slots.map((s) => s.box) : masks.map((m) => m.box)), [slots, masks]);
  const spots = useMarkerSpots(plateRef, views, covers);
  const tagPos = useTagLayout(plateRef, views, tagged, covers, spots);
  const fits = useSlotFits(plateRef, slots, views, slotFont);
  const fig = spec.figure;
  const patches = usePatchColours(imgEl, imgReady, slots, fig);
  // Stage 8c Addendum A: SAM's region BOXES as the build draws them in (weak ones not at all), a soft accent glow padded
  // a little around SAM's box. They exist only while a build plays; nothing is drawn at rest, on hover or on slides.
  // Traced outlines stay stored on the regions but are not drawn.
  const drawings = useMemo(() => views.map((v) => regionDrawing(v)), [views]);
  const plateStyle: CSSProperties = size !== undefined
    ? { width: size.width, height: size.height }
    : { aspectRatio: `${fig.width > 0 ? fig.width : 1} / ${fig.height > 0 ? fig.height : 1}` };
  const maxW = lessonFigureMaxWidth(fig);
  const figureStyle: CSSProperties | undefined = size !== undefined ? { width: size.width } : maxW !== null ? { maxInlineSize: `${maxW}px` } : undefined;
  const credit = figureCredit(fig);
  return (
    <figure className="ld-figure" style={figureStyle}>
      <div className="ld-plate" style={plateStyle} ref={plateRef} data-labels={labelsShown ? 'shown' : 'covered'} data-build={build ? 'draw' : undefined} data-img={imgReady || failed ? 'ready' : 'loading'}>
        {failed
          ? <p className="ld-missing">The figure could not be loaded.</p>
          : <img src={srcOf(spec.figureId)} alt={fig.caption.trim() === '' ? 'The page’s figure, labels covered' : `The page’s figure, labels covered: ${fig.caption.trim()}`} draggable={false} onError={() => setFailed(true)} onLoad={() => setImgReady(true)} ref={imgRef} />}
        {masks.length > 0 && slots.length === 0 && masks.map((m) => (
          <span key={m.key} className="ld-mask" style={pct(m.box)} data-on={labelsShown ? 'false' : 'true'} aria-hidden="true" />
        ))}
        {build && views.map((v) => {
          const d = drawings[v.index] ?? null; // SAM's weak regions (< 50% sure) are not drawn
          return d === null ? null : (
            <span
              key={`r-${v.part.id}`} className="ld-region" style={{ ...glowStyle(d.box), '--i': v.index } as CSSProperties}
              data-on={outlined === v.index ? 'true' : 'false'} aria-hidden="true"
            />
          );
        })}
        {/* The printed labels as worksheet slots: blank until their part is named, then the name written in. */}
        {slots.map((s, k) => {
          const state = slotState[k] ?? 'covered';
          const fit = fits[k] ?? null;
          const show = state === 'named' && fit !== null && s.partIndex !== null;
          const nameStyle: CSSProperties | undefined = fit === null ? undefined : { fontSize: `${fit.fontSize}px`, lineHeight: fit.lineHeight, paddingInline: `${fit.padX}px` };
          // Stage 8c: a printed label no part claims is a patch in the figure's own colour, never a fillable slot (it keeps
          // that look while it fades open, so it never flashes as a blank slot).
          const patch = s.partIndex === null ? patches[s.key] : undefined;
          const boxStyle: CSSProperties = patch === undefined ? pct(s.box) : { ...pct(s.box), '--ld-patch': patch.bottom, '--ld-patch-top': patch.top } as CSSProperties;
          return (
            <span
              key={s.key} className="ld-slotbox" style={boxStyle} data-state={state} data-fits={fit === null || fit.fits ? 'true' : 'false'}
              data-claimed={s.partIndex === null ? 'false' : 'true'} data-patch={s.partIndex === null ? (patch === undefined ? 'fallback' : 'figure') : undefined}
              data-current={s.partIndex !== null && s.partIndex === current ? 'true' : 'false'} aria-hidden="true"
              onPointerEnter={onSlotHover !== undefined && show ? () => onSlotHover(s.partIndex) : undefined}
              onPointerLeave={onSlotHover !== undefined ? () => onSlotHover(null) : undefined}
            >
              {show && <span className="ld-slotname" style={nameStyle}>{fit.lines.map((l, i) => <span key={i} className="ld-slotline">{l}</span>)}</span>}
            </span>
          );
        })}
        {views.map((v) => {
          const state = markerState(v);
          const at = spots[v.index] ?? v.point;
          const style: CSSProperties = { left: `${at.left}%`, top: `${at.top}%` };
          return marker !== undefined
            ? <span key={`m-${v.part.id}`} className="ld-marker-slot" style={build ? { '--i': v.index } as CSSProperties : undefined}>{marker(v, style, state)}</span>
            : <span key={`m-${v.part.id}`} className="ld-marker" data-state={state} data-named={named[v.index] === true ? 'true' : 'false'} style={style} aria-hidden="true"><span className="num">{v.number}</span></span>;
        })}
        {/* Name tags last (above markers), only for parts with no printed-label slot, placed once by lib placeTags. */}
        {views.map((v) => {
          if (tagged[v.index] !== true) return null;
          const p = tagPos?.[v.index];
          const on = named[v.index] === true && p !== undefined;
          return (
            <span
              key={`t-${v.part.id}`} className="ld-tag" data-i={v.index} aria-hidden="true" data-on={on ? 'true' : 'false'} data-current={current === v.index ? 'true' : 'false'}
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
  const slots = useMemo(() => labelSlots(spec), [spec]);
  const bank = useMemo(() => wordBank(spec), [spec]);
  const [placements, setPlacements] = useState<Placements>({});
  /** Parts a Check marked right: their names stay written in until that number's name changes. */
  const [confirmed, setConfirmed] = useState<ReadonlySet<string>>(new Set());
  /** The part in focus (marker, row or named slot hovered or focused): only its SAM region is outlined. */
  const [focusPart, setFocusPart] = useState<number | null>(null);
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

  /** Unconfirm the numbers a move changes: the target, and the number the name came from. */
  const unconfirm = (...ids: (string | undefined)[]): void => {
    setConfirmed((c) => (ids.some((id) => id !== undefined && c.has(id)) ? new Set([...c].filter((id) => !ids.includes(id))) : c));
  };
  const put = (token: string, markerId: string): void => {
    if (!open) return;
    // A drop on a filled number swaps the two names (D3); only the numbers it changes lose their marks (D1).
    const changed = changedBy(placements, token, markerId);
    unconfirm(...changed);
    setPlacements((p) => place(p, token, markerId));
    setChecked((c) => keepResults(c, changed));
    setSelected(null);
    setSaid(`${nameOf(token)} is on number ${numberOf(markerId)}.`);
  };
  const takeOff = (markerId: string): void => {
    const token = placements[markerId];
    unconfirm(markerId);
    setPlacements((p) => unplace(p, markerId));
    setChecked((c) => keepResults(c, [markerId]));
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
  const reset = (): void => { setPlacements({}); setConfirmed(new Set()); setSelected(null); setChecked(null); setRevealed(false); setHint(false); setSaid(''); };
  const check = (): void => {
    const r = checkPlacements(spec, placements);
    setChecked(r);
    setConfirmed(new Set(spec.parts.filter((p) => r.results[p.id] === 'right').map((p) => p.id)));
  };

  const resultOf = (partId: string): 'right' | 'wrong' | null => {
    const shown = revealed ? answers : checked;
    const r = shown?.results[partId];
    return r === 'right' || r === 'wrong' ? r : null;
  };
  const markerState = (v: PartView): MarkerState => resultOf(v.part.id) ?? 'idle';
  const named = views.map((v) => revealed || confirmed.has(v.part.id));
  const states = slotStates(slots, named, { labelsShown: false, openUnmatched: revealed });
  const focusProps = (i: number) => ({ onPointerEnter: () => setFocusPart(i), onPointerLeave: () => setFocusPart((f) => (f === i ? null : f)), onFocus: () => setFocusPart(i), onBlur: () => setFocusPart((f) => (f === i ? null : f)) });
  const armed = selected !== null && open ? 'true' : 'false';

  const marker = (v: PartView, style: CSSProperties, state: MarkerState): ReactNode => {
    const token = placements[v.part.id];
    const label = `Number ${v.number} on the diagram${token === undefined ? ', no name yet' : `, labelled ${nameOf(token)}`}${state === 'right' ? ', right' : state === 'wrong' ? ', wrong' : ''}`;
    return (
      <button
        type="button" className="ld-marker" data-state={state} data-named={named[v.index] === true ? 'true' : 'false'} data-filled={token !== undefined ? 'true' : 'false'} data-over={over === v.part.id ? 'true' : 'false'}
        data-armed={armed} style={style} aria-label={label} onClick={() => target(v.part.id)} disabled={!open}
        {...dropProps(v.part.id)} {...focusProps(v.index)}
      ><span className="num">{v.number}</span></button>
    );
  };

  const inSlots = slots.some((s) => s.partIndex !== null);
  // Every number right after a Check: one calm line in the success colour at the top of the side (D4).
  const finished = !revealed && checked !== null && checked.stale !== true && checked.right === checked.total && checked.total > 0;
  const status = revealed
    ? (inSlots ? 'Answers shown in the figure’s own label boxes.' : masks.length > 0 ? 'Answers shown, and the figure’s own labels are uncovered.' : 'Answers shown.')
    : checked !== null
      ? (finished ? 'Every number has its right name.'
        : checked.stale === true ? (checked.right > 0 ? `${checked.right} of ${checked.total} still marked right. Check again for the numbers you moved.` : 'Check again for the numbers you moved.')
        : `${checked.right} of ${checked.total} right.${checked.complete ? ' Move the names marked wrong and check again.' : ' Some numbers have no name yet.'}`)
      : selected !== null
        ? `“${nameOf(selected)}” chosen. Now choose its number.`
        : 'Drag each name onto its number, or choose a name and then a number.';

  return (
    <div className="ld" data-mode="lesson" data-testid="label-diagram">
      <div className="ld-body">
        <Figure
          spec={spec} views={views} slots={slots} masks={masks} named={named} slotState={states} labelsShown={revealed} markerState={markerState} current={null}
          outlined={focusPart} slotFont={LESSON_SLOT_FONT} caption marker={marker} onSlotHover={setFocusPart} build={build}
        />
        <div className="ld-side">
          <p className="ld-finish" data-on={finished ? 'true' : 'false'} aria-hidden={finished ? undefined : true}>
            <Mark kind="ok" />{finishLine(views.length, inSlots)}
          </p>
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
                <Linked
                  as="li" key={v.part.id} className="ld-row" links={revealed ? [linkKey(v.part.sourceId, v.part.quote)] : []} data-result={r ?? 'open'}
                  onPointerEnter={() => setFocusPart(v.index)} onPointerLeave={() => setFocusPart((f) => (f === v.index ? null : f))}
                >
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
            <button type="button" className="btn btn-primary" onClick={check} disabled={!open || Object.keys(placements).length === 0}>Check</button>
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
  const slots = useMemo(() => labelSlots(spec), [spec]);
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
        <Figure
          spec={spec} views={views} slots={slots} masks={masks} named={st.named} slotState={slotStates(slots, st.named, { labelsShown: st.labelsShown, openUnmatched: false })}
          labelsShown={st.labelsShown} markerState={markerState} current={presentation.revealed ? st.current : null} outlined={stageOutline(st)}
          slotFont={STAGE_SLOT_FONT} size={size} caption={false}
        />
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
                // A tab stop, so the page's sentence for each name is reachable by keyboard too (W2-03). The bank names
                // every part already; its sentences say nothing about which number is which.
                <Linked key={b.token} as="p" className="ld-chip" tabIndex={part === undefined ? undefined : 0} data-used={namedTokens.has(b.token) ? 'true' : 'false'} links={part === undefined ? [] : [linkKey(part.sourceId, part.quote)]}>
                  {b.name}
                </Linked>
              );
            })}
          </div>
          <ol className="ld-rows" data-cols={cols} aria-label="Numbers on the diagram">
            {views.map((v) => {
              const on = st.named[v.index] === true;
              return (
                // A named row is a tab stop for its sentence; an unnamed one has no link and no stop (no early answer).
                <Linked as="li" key={v.part.id} className="ld-row" tabIndex={on ? 0 : undefined} links={on ? [linkKey(v.part.sourceId, v.part.quote)] : []} data-current={st.current === v.index ? 'true' : 'false'}>
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
