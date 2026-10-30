import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { SequenceSpec } from '../../../../packages/contracts/kit.ts';
import { layoutLabels } from '../lib/timeAxis.ts';
import type { LabelLayout, LabelPlacement } from '../lib/timeAxis.ts';
import { quoteDate, stationXs } from '../lib/stepTrack.ts';
import { linkKey } from '../lib/linking.ts';
import { Mark } from './icons.tsx';
import { Linked } from './Linked.tsx';
import { useWidth } from './TimeAxisChart.tsx';
import { capitalFirst } from '../lib/displayText.ts';

/** Vertical geometry in px. Label boxes hang off their leader ends (above: bottom edge, below: top edge). */
const LABEL_ROOM = 118;
const STEM_ABOVE = 24;
const STEM_BELOW = 26;
const STATION = 30;
const TOP_PAD = 6;
const LOOP_ROOM = 24;
/** One row of labels under the track reads best; it is used whenever every label still gets this much width. */
const ONE_ROW_MIN = 150;

interface Props {
  spec: SequenceSpec;
  /** Step id -> placed right at the learner's last check (null before any check). */
  results: Readonly<Record<string, boolean>> | null;
}

function leader(p: LabelPlacement, axisY: number): string {
  const dir = p.side === 'above' ? -1 : 1;
  const edge = p.side === 'above' ? axisY - STATION / 2 - STEM_ABOVE : axisY + STATION / 2 + STEM_BELOW;
  const start = axisY + dir * (STATION / 2 + 1);
  const knee = axisY + dir * (STATION / 2 + 8);
  return `${p.anchorX},${start} ${p.anchorX},${knee} ${p.attachX},${edge}`;
}

/**
 * The page's order as a track: numbered stations along one line, each with its step title; a date shows only when the
 * step's own stored quote states one (read verbatim from the quote, lib/stepTrack.ts quoteDate). Labels sit in one row
 * under the track when they fit, otherwise they alternate above and below so none collide. A cycle closes the line back
 * to its first station. Shown once the learner has checked; the line draws in step order (reduced motion: no drawing).
 */
export function StepTrack({ spec, results }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const steps = spec.steps;
  const cyclic = spec.cyclic === true;
  const dates = useMemo(() => steps.map((s) => quoteDate(s.quote)), [steps]);
  const xs = useMemo(() => (width > 0 ? stationXs(steps.length, width, cyclic ? 52 : 40) : []), [steps.length, width, cyclic]);
  const layout: LabelLayout | null = useMemo(() => {
    if (width <= 0) return null;
    const anchors = steps.map((s, i) => ({ id: s.id, x: xs[i] ?? 0 }));
    const opts = { width, inset: cyclic ? 22 : 0, maxLabelWidth: 210 };
    return layoutLabels(anchors, { ...opts, sides: 'below', minLabelWidth: ONE_ROW_MIN }) ?? layoutLabels(anchors, opts);
  }, [steps, xs, width, cyclic]);
  const place = new Map(layout?.placements.map((p) => [p.id, p] as const) ?? []);
  const hasAbove = layout?.placements.some((p) => p.side === 'above') ?? false;
  // the rows are as tall as their tallest label, measured after layout (LABEL_ROOM until then)
  const listRef = useRef<HTMLOListElement>(null);
  const [rooms, setRooms] = useState({ above: LABEL_ROOM, below: LABEL_ROOM });
  useLayoutEffect(() => {
    const items = [...(listRef.current?.querySelectorAll<HTMLElement>('.st-item') ?? [])];
    const tallest = (cls: string): number => Math.max(0, ...items.filter((el) => el.classList.contains(cls)).map((el) => el.offsetHeight));
    const next = { above: Math.ceil(tallest('st-above')) || LABEL_ROOM, below: Math.ceil(tallest('st-below')) || LABEL_ROOM };
    if (next.above !== rooms.above || next.below !== rooms.below) setRooms(next);
  });
  const axisY = TOP_PAD + (hasAbove ? rooms.above + STEM_ABOVE : 0) + STATION / 2 + 4;
  const height = axisY + STATION / 2 + STEM_BELOW + rooms.below + (cyclic ? LOOP_ROOM : 4);
  const firstX = xs[0] ?? 0;
  const lastX = xs[xs.length - 1] ?? 0;
  const loopY = height - 10;
  const narrow = layout === null;
  const lineY = narrow ? STATION / 2 + 4 : axisY;

  return (
    <div className={`st${cyclic ? ' st-cyclic' : ''}${narrow ? ' st-narrow' : ''}`} ref={ref} data-testid="step-track">
      {width > 0 && (
        <div className="st-plot" style={{ height: narrow ? undefined : height }}>
          <svg className="st-svg" width={width} height={narrow ? lineY + STATION / 2 + 4 : height} aria-hidden="true">
            <defs>
              <marker id={`st-head-${uid}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M0,0 L10,5 L0,10 z" className="st-head" />
              </marker>
            </defs>
            <line x1={firstX} x2={lastX} y1={lineY} y2={lineY} className="st-line" pathLength={1} />
            {cyclic && !narrow && (
              <path
                d={`M${lastX + STATION / 2},${axisY} H${width - 8} V${loopY} H8 V${axisY} H${firstX - STATION / 2 - 3}`}
                className="st-loop"
                markerEnd={`url(#st-head-${uid})`}
              />
            )}
            {!narrow && layout.placements.map((p) => {
              const i = steps.findIndex((s) => s.id === p.id);
              return <polyline key={p.id} points={leader(p, axisY)} className="st-leader" style={{ animationDelay: `${Math.min(i, 9) * 60 + 120}ms` }} />;
            })}
            {steps.map((s, i) => {
              const ok = results?.[s.id];
              const x = xs[i] ?? 0;
              return (
                <g key={s.id} className={`st-station${ok === true ? ' is-ok' : ok === false ? ' is-miss' : ''}`} style={{ animationDelay: `${Math.min(i, 9) * 60}ms` }}>
                  <rect x={x - STATION / 2} y={lineY - STATION / 2} width={STATION} height={STATION} rx={7} />
                  <text x={x} y={lineY + 5.5} textAnchor="middle">{i + 1}</text>
                </g>
              );
            })}
          </svg>
          <ol ref={listRef} className={`st-labels${narrow ? ' st-labels-list' : ''}`} aria-label={cyclic ? 'The steps in the page’s order; the last leads back to the first' : 'The steps in the page’s order'}>
            {steps.map((s, i) => {
              const p = place.get(s.id);
              const ok = results?.[s.id];
              const date = dates[i] ?? null;
              const style = p === undefined || narrow ? undefined : {
                left: p.left,
                width: layout.labelWidth,
                top: p.side === 'above' ? axisY - STATION / 2 - STEM_ABOVE : axisY + STATION / 2 + STEM_BELOW,
                animationDelay: `${Math.min(i, 9) * 60 + 120}ms`,
              };
              return (
                <Linked as="li" key={s.id} links={[linkKey(s.sourceId, s.quote)]} className={`st-item${p?.side === 'above' ? ' st-above' : ' st-below'}`} style={style} tabIndex={0}>
                  <span className="st-num">Step {i + 1}</span>
                  {date !== null && <span className="st-date" title="As written in this step’s quote from the page">{date}</span>}
                  <span className="st-title">{capitalFirst(s.label)}</span>
                  {s.orderHint !== '' && <span className="st-hint">{s.orderHint}</span>}
                  {ok !== undefined && (
                    <span className={`st-result ${ok ? 'ok' : 'bad'}`}><Mark kind={ok ? 'ok' : 'bad'} />{ok ? 'You had it here' : 'You had it elsewhere'}</span>
                  )}
                </Linked>
              );
            })}
          </ol>
        </div>
      )}
    </div>
  );
}
