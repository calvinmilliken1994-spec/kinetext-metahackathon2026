import { useId } from 'react';
import type { GraphGeometry } from '../lib/explorer.ts';
import { sig6 } from '../lib/explorer.ts';

interface Props {
  geometry: GraphGeometry;
  /** Name of the output, for example “D”. */
  yName: string;
  /** Meaning and unit of the horizontal variable, for example “velocity (m/s)”. */
  xName: string;
}

/** Output against the x variable: the line over the slider range, with the current point marked. Pure SVG, no chart library. */
export function FormulaGraph({ geometry: g, yName, xName }: Props) {
  const id = useId();
  const { plot, current } = g;
  const nowText = current.defined ? `${yName} = ${sig6(current.y)}` : 'not defined here';
  const summary = current.defined
    ? `${yName} against ${xName}. Now ${xName} is ${sig6(current.x)} and ${yName} is ${sig6(current.y)}. The line covers ${sig6(g.xMin)} to ${sig6(g.xMax)}.`
    : `${yName} against ${xName}. At ${sig6(current.x)} the formula has no value.`;
  return (
    <figure className="graph explorer-graph" data-testid="explorer-graph">
      <svg viewBox={`0 0 ${g.width} ${g.height}`} className="graph-svg explorer-svg" role="img" aria-labelledby={id}>
        <title id={id}>{summary}</title>
        <rect x={plot.l} y={plot.t} width={plot.r - plot.l} height={plot.b - plot.t} className="graph-plot" />
        {g.yTicks.map((t) => (
          <g key={`y${t.value}`}>
            <line x1={plot.l} y1={t.py} x2={plot.r} y2={t.py} className="chart-grid" />
            <text x={plot.l - 7} y={t.py} textAnchor="end" dominantBaseline="central" className="graph-tick">{t.label}</text>
          </g>
        ))}
        {g.xTicks.map((t) => (
          <g key={`x${t.value}`}>
            <line x1={t.px} y1={plot.b} x2={t.px} y2={plot.b + 5} className="chart-axis" />
            <text x={t.px} y={plot.b + 18} textAnchor="middle" className="graph-tick">{t.label}</text>
          </g>
        ))}
        {g.segments.map((points, i) => <polyline key={i} points={points} fill="none" className="explorer-line" />)}
        {current.defined && current.py !== null ? (
          <>
            <line x1={current.px} y1={plot.b} x2={current.px} y2={current.py} className="graph-cursor" />
            <line x1={plot.l} y1={current.py} x2={current.px} y2={current.py} className="graph-cursor" />
            <circle cx={current.px} cy={current.py} r={6.5} className="explorer-dot" />
          </>
        ) : (
          <line x1={current.px} y1={plot.t} x2={current.px} y2={plot.b} className="graph-cursor" />
        )}
        {/* The current value sits above the plot, clear of the line and the axes. */}
        <text x={plot.r} y={plot.t - 6} textAnchor="end" className="explorer-now">Now: {nowText}</text>
        <text x={(plot.l + plot.r) / 2} y={g.height - 6} textAnchor="middle" className="graph-axis">{xName}</text>
        <text x={plot.l} y={plot.t - 6} className="graph-axis">{yName}</text>
      </svg>
      {g.hasGap && <figcaption className="muted small">The line stops where the formula has no value for these inputs.</figcaption>}
    </figure>
  );
}
