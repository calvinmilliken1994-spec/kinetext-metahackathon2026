import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, RefObject } from 'react';
import type { TimelineEvent } from '../../../../packages/contracts/index.ts';
import { dateOrder, formatEventDate } from '../lib/timeline.ts';
import { buildTimeAxis, layoutLabels } from '../lib/timeAxis.ts';
import type { AxisMark, LabelPlacement, TimeAxis } from '../lib/timeAxis.ts';
import { linkKeysOf } from '../lib/linking.ts';
import { Linked, useLinked } from './Linked.tsx';

/** Vertical geometry of the chart, in px. Label boxes hang off their leader ends, so their real height never misplaces a leader. */
const LABEL_ROOM = 96;
const STEM_ABOVE = 26;
const STEM_BELOW = 44;
const BAND_H = 10;
const MIN_BAND = 8;
const ARC_ROOM = 78;

/** Width of an element, kept current with a ResizeObserver (0 until measured). */
export function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return undefined;
    setWidth(Math.floor(el.getBoundingClientRect().width));
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w !== undefined) setWidth(Math.floor(w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

export interface AxisArrow { fromId: string; toId: string; text: string }

interface Props {
  events: readonly TimelineEvent[];
  /** Accessible name of the chart. */
  label: string;
  /** The event whose quote is shown (highlighted on the axis). */
  activeId?: string | null;
  /** Hover, focus or click on an event. */
  onActivate?: (id: string, how: 'hover' | 'focus' | 'click') => void;
  onDeactivate?: () => void;
  /** Events drawn as the emphasised pair (which-came-first). */
  emphasis?: readonly string[];
  /** An arrow drawn along the axis from one event to the other, in time order. */
  arrow?: AxisArrow | null;
  /** Show the key to the marks (day dot, month/year band, axis break) under the chart. */
  legend?: boolean;
}

/** Key to the marks, drawn with the same shapes as the chart (no glyph icons). */
function AxisLegend({ precisions, hasBreak }: { precisions: ReadonlySet<string>; hasBreak: boolean }) {
  return (
    <ul className="ta-legend" aria-label="Key">
      {precisions.has('day') && (
        <li><svg width="16" height="12" aria-hidden="true"><circle cx="8" cy="6" r="4.5" className="ta-dot" /></svg>a stated day</li>
      )}
      {(precisions.has('month') || precisions.has('year')) && (
        <li><svg width="24" height="12" aria-hidden="true"><rect x="1" y="1" width="22" height="10" rx="3" className="ta-band" /></svg>a stated month or year: the band covers all of it</li>
      )}
      {hasBreak && (
        <li className="ta-break"><svg width="20" height="14" aria-hidden="true"><line x1="4" y1="13" x2="9" y2="1" /><line x1="11" y1="13" x2="16" y2="1" /></svg>a long empty gap, cut short</li>
      )}
    </ul>
  );
}

/** One mark on the axis: a dot for a stated day, a band over the whole month or year otherwise. Lights with its quote. */
function AxisMarkShape({ mark, keys, axisY, active, emphasised, onEnter, onLeave }: {
  mark: AxisMark; keys: readonly string[]; axisY: number; active: boolean; emphasised: boolean;
  onEnter: () => void; onLeave: () => void;
}) {
  const { lit, props } = useLinked(keys);
  const cls = `ta-mark ta-${mark.precision}${active ? ' is-active' : ''}${lit ? ' is-lit' : ''}${emphasised ? ' is-emph' : ''}`;
  const enter = (): void => { props.onMouseEnter?.(); onEnter(); };
  const leave = (): void => { props.onMouseLeave?.(); onLeave(); };
  if (mark.precision === 'day') {
    return (
      <g className={cls} onMouseEnter={enter} onMouseLeave={leave}>
        <circle cx={mark.x} cy={axisY} r={12} className="ta-hit" />
        <circle cx={mark.x} cy={axisY} r={active || emphasised ? 6.5 : 5} className="ta-dot" />
      </g>
    );
  }
  // a 1.5 px inset at each end keeps back-to-back years (1775, 1776) visibly separate bands
  const w = Math.max(MIN_BAND, mark.x1 - mark.x0 - 3);
  const x = w === MIN_BAND ? mark.x - MIN_BAND / 2 : mark.x0 + 1.5;
  return (
    <g className={cls} onMouseEnter={enter} onMouseLeave={leave}>
      <rect x={x} y={axisY - 12} width={w} height={24} className="ta-hit" />
      <rect x={x} y={axisY - BAND_H / 2} width={w} height={BAND_H} rx={3} className="ta-band" />
      <line x1={mark.x} x2={mark.x} y1={axisY - BAND_H / 2 - 3} y2={axisY + BAND_H / 2 + 3} className="ta-band-mid" />
    </g>
  );
}

/** The leader from a mark to its label box: up (or down) a short stem, then straight to the box. */
function leaderPoints(p: LabelPlacement, axisY: number, labelEdge: number): string {
  const dir = p.side === 'above' ? -1 : 1;
  const knee = axisY + dir * (p.side === 'above' ? 10 : 30);
  return `${p.anchorX},${axisY + dir * 7} ${p.anchorX},${knee} ${p.attachX},${labelEdge}`;
}

/**
 * A horizontal time axis for timeline-v1: every event at its stated date (to scale), ticks, marked axis breaks for cut
 * gaps, and labels staggered above and below with leader lines so none collide. Labels are buttons: hovering or focusing
 * one lights its page quote in the source panel (lib/linking.ts) and reports it to the parent.
 */
export function TimeAxisChart({ events, label, activeId = null, onActivate, onDeactivate, emphasis = [], arrow = null, legend = false }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>();
  // the which-came-first pair: both labels under the axis, the arrow arcs over it
  const pairMode = emphasis.length > 0;
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const ordered = useMemo(() => dateOrder(events), [events]);
  const axis: TimeAxis | null = useMemo(() => (width > 0 ? buildTimeAxis(ordered, { width }) : null), [ordered, width]);
  const layout = useMemo(() => (axis === null ? null : layoutLabels(axis.marks.map((m) => ({ id: m.id, x: m.x })), { width: axis.width, maxLabelWidth: 200, sides: pairMode ? 'below' : 'alternate' })), [axis, pairMode]);
  const listRef = useRef<HTMLOListElement>(null);
  const keysById = useMemo(() => new Map(events.map((e) => [e.id, linkKeysOf(e.evidence)] as const)), [events]);

  const hasAbove = layout?.placements.some((p) => p.side === 'above') ?? false;
  // label rows are as tall as their tallest label, measured after layout (LABEL_ROOM until then)
  const [rooms, setRooms] = useState({ above: LABEL_ROOM, below: LABEL_ROOM });
  useLayoutEffect(() => {
    const items = [...(listRef.current?.querySelectorAll<HTMLElement>('.ta-item') ?? [])];
    const tallest = (cls: string): number => Math.max(0, ...items.filter((el) => el.classList.contains(cls)).map((el) => el.offsetHeight));
    const next = { above: Math.ceil(tallest('ta-above')) || LABEL_ROOM, below: Math.ceil(tallest('ta-below')) || LABEL_ROOM };
    if (next.above !== rooms.above || next.below !== rooms.below) setRooms(next);
  });
  const axisY = (hasAbove ? rooms.above + STEM_ABOVE : pairMode ? ARC_ROOM : 18) + 8;
  const labelsBelow = layout?.placements.some((p) => p.side === 'below') ?? false;
  const height = axisY + (labelsBelow ? STEM_BELOW + rooms.below : 30) + 4;
  const markOf = (id: string): AxisMark | undefined => axis?.marks.find((m) => m.id === id);
  const arrowFrom = arrow === null ? undefined : markOf(arrow.fromId);
  const arrowTo = arrow === null ? undefined : markOf(arrow.toId);

  const onKeyDown = (e: KeyboardEvent<HTMLOListElement>): void => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'Home' && e.key !== 'End') return;
    const buttons = [...(listRef.current?.querySelectorAll<HTMLButtonElement>('button.ta-label') ?? [])];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    e.preventDefault();
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : Math.min(buttons.length - 1, Math.max(0, at + (e.key === 'ArrowRight' ? 1 : -1)));
    buttons[next]?.focus({ preventScroll: true });
  };

  const placeOf = new Map(layout?.placements.map((p) => [p.id, p] as const) ?? []);
  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  const range = first === undefined || last === undefined ? '' : `${formatEventDate(first)} to ${formatEventDate(last)}`;

  return (
    <div className={`ta${arrow !== null ? ' ta-has-arrow' : ''}${emphasis.length > 0 ? ' ta-has-emph' : ''}${layout === null ? ' ta-narrow' : ''}`} ref={ref}>
      {axis !== null && (
        <div className="ta-plot" style={{ height: layout === null ? undefined : height }}>
          <svg className="ta-svg" width={axis.width} height={layout === null ? axisY + 34 : height} role="img" aria-labelledby={`${uid}-t`}>
            <title id={`${uid}-t`}>{`${label}: ${ordered.length} events from ${range}, placed by their dates${axis.breaks.length > 0 ? ', with long gaps cut short' : ''}`}</title>
            <defs>
              <marker id={`ta-head-${uid}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" className="ta-arrow-head" />
              </marker>
            </defs>
            {axis.segments.map((s, i) => <line key={`s${i}`} x1={s.x0} x2={s.x1} y1={axisY} y2={axisY} className="ta-axis" />)}
            {axis.breaks.map((b, i) => {
              const cx = (b.x0 + b.x1) / 2;
              return (
                <g key={`b${i}`} className="ta-break">
                  <line x1={b.x0} x2={b.x1} y1={axisY} y2={axisY} className="ta-break-gap" />
                  <line x1={cx - 9} x2={cx - 3} y1={axisY + 8} y2={axisY - 8} />
                  <line x1={cx + 3} x2={cx + 9} y1={axisY + 8} y2={axisY - 8} />
                  <text x={cx} y={axisY + 24} textAnchor="middle" className="ta-break-label">{b.label}</text>
                  <text x={cx} y={axisY + 39} textAnchor="middle" className="ta-break-label">not drawn</text>
                </g>
              );
            })}
            {layout !== null && layout.placements.map((p) => (
              <polyline
                key={`l${p.id}`}
                points={leaderPoints(p, axisY, p.side === 'above' ? axisY - STEM_ABOVE : axisY + STEM_BELOW)}
                className={`ta-leader${p.id === activeId || emphasis.includes(p.id) ? ' is-active' : ''}`}
              />
            ))}
            {/* ticks after the leaders, so a tick label's halo sits over a leader that crosses it */}
            {axis.ticks.map((t, i) => (
              <g key={`t${i}`} className="ta-tick">
                <line x1={t.x} x2={t.x} y1={axisY} y2={axisY + 6} />
                <text x={t.x} y={axisY + 21} textAnchor="middle">{t.label}</text>
              </g>
            ))}
            {arrowFrom !== undefined && arrowTo !== undefined && Math.abs(arrowTo.x - arrowFrom.x) > 14 && (
              <g className="ta-arrow">
                <path
                  d={`M${arrowFrom.x},${axisY - 10} Q${(arrowFrom.x + arrowTo.x) / 2},${axisY - ARC_ROOM - 18} ${arrowTo.x},${axisY - 12}`}
                  pathLength={1}
                  markerEnd={`url(#ta-head-${uid})`}
                  className="ta-arrow-line"
                />
                <text x={(arrowFrom.x + arrowTo.x) / 2} y={axisY - 62} textAnchor="middle" className="ta-arrow-text">{arrow?.text}</text>
              </g>
            )}
            {axis.marks.map((m) => (
              <AxisMarkShape
                key={m.id}
                mark={m}
                keys={keysById.get(m.id) ?? []}
                axisY={axisY}
                active={m.id === activeId}
                emphasised={emphasis.includes(m.id)}
                onEnter={() => onActivate?.(m.id, 'hover')}
                onLeave={() => onDeactivate?.()}
              />
            ))}
          </svg>
          <ol className={`ta-labels${layout === null ? ' ta-labels-list' : ''}`} ref={listRef} onKeyDown={onKeyDown} aria-label="Events in date order, earliest first">
            {ordered.map((e) => {
              const p = placeOf.get(e.id);
              const style = p === undefined || layout === null ? undefined : {
                left: p.left,
                width: layout.labelWidth,
                top: p.side === 'above' ? axisY - STEM_ABOVE : axisY + STEM_BELOW,
              };
              return (
                <Linked
                  as="li"
                  key={e.id}
                  links={keysById.get(e.id) ?? []}
                  className={`ta-item${p?.side === 'above' ? ' ta-above' : ' ta-below'}${e.id === activeId ? ' is-active' : ''}${emphasis.includes(e.id) ? ' is-emph' : ''}`}
                  style={style}
                >
                  <button
                    type="button"
                    className="ta-label"
                    aria-pressed={onActivate === undefined ? undefined : e.id === activeId}
                    onMouseEnter={() => onActivate?.(e.id, 'hover')}
                    onMouseLeave={() => onDeactivate?.()}
                    onFocus={() => onActivate?.(e.id, 'focus')}
                    onClick={() => onActivate?.(e.id, 'click')}
                    title={e.label}
                  >
                    <span className="ta-date">{formatEventDate(e)}</span>
                    <span className="ta-text">{e.label}</span>
                  </button>
                </Linked>
              );
            })}
          </ol>
        </div>
      )}
      {axis !== null && legend && <AxisLegend precisions={new Set(axis.marks.map((m) => m.precision))} hasBreak={axis.breaks.length > 0} />}
    </div>
  );
}
