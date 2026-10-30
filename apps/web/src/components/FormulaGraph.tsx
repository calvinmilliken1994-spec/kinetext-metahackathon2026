import { useId } from 'react';
import type { CSSProperties } from 'react';
import type { GraphGeometry, GraphReveal } from '../lib/explorer.ts';
import { groupedSig6 } from '../lib/explorer.ts';
import { leaderLine } from '../lib/geometry.ts';
import { HiddenValueText } from './SceneHidden.tsx';

/** The graded guess drawn on the graph: the overlay geometry plus the two numbers and a run number (replays the settle). */
export interface GraphRevealView extends GraphReveal { guess: number; actual: number; tolerance: number; seq: number }

interface Props {
  geometry: GraphGeometry;
  /** Name of the output, for example “D”. */
  yName: string;
  /** Meaning and unit of the horizontal variable, for example “flow velocity (m/s)”. */
  xName: string;
  /** Case 1's answer is not shown yet: the current value and the y-axis numbers read '?'. */
  concealed?: boolean;
  /** After a prediction is checked, while the sliders still show that case. */
  reveal?: GraphRevealView | null;
}

/**
 * Output against the x variable: the line over the slider range, with the current point marked. Pure SVG, no chart library.
 * While case 1 is unanswered the y-axis numbers are withheld (the curve's shape stays). After a check, the class's guess is a
 * level line, the teaching margin a band around the true value, and the point travels from the guess to the value once.
 */
export function FormulaGraph({ geometry: g, yName, xName, concealed = false, reveal = null }: Props) {
  const id = useId();
  const { plot, current } = g;
  const nowText = concealed ? `${yName} = ?` : current.defined ? `${yName} = ${groupedSig6(current.y)}` : 'not defined here';
  const summary = concealed
    ? `${yName} against ${xName}. The current value and the vertical scale are hidden until case 1 is checked. The line covers ${groupedSig6(g.xMin)} to ${groupedSig6(g.xMax)}.`
    : current.defined
    ? `${yName} against ${xName}. Now ${xName} is ${groupedSig6(current.x)} and ${yName} is ${groupedSig6(current.y)}. The line covers ${groupedSig6(g.xMin)} to ${groupedSig6(g.xMax)}.${reveal === null ? '' : ` Your guess was ${groupedSig6(reveal.guess)}: ${reveal.text}.`}`
    : `${yName} against ${xName}. At ${groupedSig6(current.x)} the formula has no value.`;

  const showReveal = reveal !== null && !concealed && current.defined && current.py !== null;
  const bx = reveal?.bracketX ?? current.px;
  const deltaLead = reveal === null || current.py === null ? null : leaderLine(reveal.deltaLabel, { px: bx, py: (reveal.guessPy + current.py) / 2 }, 26);

  return (
    <figure className="graph explorer-graph" data-testid="explorer-graph" data-concealed={concealed ? 'true' : undefined}>
      <svg viewBox={`0 0 ${g.width} ${g.height}`} className="graph-svg explorer-svg" role="img" aria-labelledby={id}>
        <title id={id}>{summary}</title>
        <rect x={plot.l} y={plot.t} width={plot.r - plot.l} height={plot.b - plot.t} className="graph-plot" />
        {g.yTicks.map((t) => (
          <g key={`y${t.value}`}>
            <line x1={plot.l} y1={t.py} x2={plot.r} y2={t.py} className="chart-grid" />
            <text x={plot.l - 8} y={t.py} textAnchor="end" dominantBaseline="central" className="graph-tick graph-tick-y">{t.label}</text>
          </g>
        ))}
        {concealed && <HiddenValueText x={plot.l - 14} y={(plot.t + plot.b) / 2 + 5} anchor="end" lead="" className="graph-tick graph-tick-hidden" />}
        {g.xTicks.map((t) => (
          <g key={`x${t.value}`}>
            <line x1={t.px} y1={plot.b} x2={t.px} y2={plot.b + 5} className="chart-axis" />
            <text x={t.px} y={plot.b + 20} textAnchor="middle" className="graph-tick">{t.label}</text>
          </g>
        ))}

        {showReveal && reveal !== null && (
          <rect key={`band-${reveal.seq}`} x={plot.l} y={reveal.band.top} width={plot.r - plot.l} height={reveal.band.bottom - reveal.band.top} className="reveal-band" aria-hidden="true" />
        )}
        {g.segments.map((points, i) => <polyline key={i} points={points} fill="none" className="explorer-line" />)}

        {showReveal && reveal !== null && (
          <g className={`reveal-guess${reveal.offScale !== null ? ' reveal-guess-off' : ''}`} aria-hidden="true">
            <line x1={plot.l} y1={reveal.guessPy} x2={plot.r} y2={reveal.guessPy} className="reveal-guess-line" />
            <text x={reveal.guessLabel.x} y={reveal.guessLabel.y} textAnchor={reveal.guessLabel.anchor} className="reveal-guess-label">{reveal.guessLabel.text}</text>
          </g>
        )}

        {current.defined && current.py !== null ? (
          <>
            <line x1={current.px} y1={plot.b} x2={current.px} y2={current.py} className="graph-cursor" />
            {!concealed && <line x1={plot.l} y1={current.py} x2={current.px} y2={current.py} className="graph-cursor" />}
            {showReveal && reveal !== null ? (
              <g key={`dot-${reveal.seq}`} className="explorer-dot-settle" style={{ '--from-dy': `${reveal.fromDy}px` } as CSSProperties}>
                <circle cx={current.px} cy={current.py} r={7.5} className="explorer-dot" />
              </g>
            ) : (
              <circle cx={current.px} cy={current.py} r={6.5} className="explorer-dot" />
            )}
          </>
        ) : (
          <line x1={current.px} y1={plot.t} x2={current.px} y2={plot.b} className="graph-cursor" />
        )}

        {showReveal && reveal !== null && current.py !== null && (
          <g key={`gap-${reveal.seq}`} className={`reveal-gap ${reveal.within ? 'reveal-ok' : 'reveal-miss'}`} aria-hidden="true">
            {Math.abs(reveal.guessPy - current.py) >= 3 && (
              <>
                <line x1={bx} y1={reveal.guessPy} x2={bx} y2={current.py} className="reveal-bracket" pathLength={1} />
                <line x1={bx - 4} y1={reveal.guessPy} x2={bx + 4} y2={reveal.guessPy} className="reveal-bracket-end" />
                <line x1={bx - 4} y1={current.py} x2={bx + 4} y2={current.py} className="reveal-bracket-end" />
              </>
            )}
            {deltaLead !== null && <line {...deltaLead} className="label-leader" />}
            <text x={reveal.deltaLabel.x} y={reveal.deltaLabel.y} textAnchor={reveal.deltaLabel.anchor} className="reveal-delta">{reveal.deltaLabel.text}</text>
          </g>
        )}

        {/* The current value sits above the plot, clear of the line and the axes. */}
        {concealed
          ? <HiddenValueText x={plot.r - 6} y={plot.t - 11} anchor="end" lead={`Now: ${yName} =`} className="explorer-now" />
          : <text x={plot.r} y={plot.t - 8} textAnchor="end" className="explorer-now">Now: {nowText}</text>}
        <text x={(plot.l + plot.r) / 2} y={g.height - 6} textAnchor="middle" className="graph-axis">{xName}</text>
        <text x={plot.l} y={plot.t - 8} className="graph-axis">{yName}</text>
      </svg>
      {g.hasGap && <figcaption className="muted small">The line stops where the formula has no value for these inputs.</figcaption>}
    </figure>
  );
}
