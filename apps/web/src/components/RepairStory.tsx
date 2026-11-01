import { useContext, useId } from 'react';
import type { RepairStory as Story } from '../lib/repairStory.ts';
import { FigureSrcContext } from './LabelDiagramView.tsx';

/**
 * Set B: one repaired part told as a short visual sequence: Check found an issue → Revised by Muse → Rechecked →
 * Published, one plain sentence each. A label-diagram repair also draws where its points were in the failed version
 * (open rings) and where the revision put them (filled dots), with an arrow for each move, on a crop of the real figure.
 * Positions only: no names and no text of the failed version are drawn. Check ids and checker text are not here.
 */
export function RepairStory({ story }: { story: Story }) {
  const headId = useId();
  const arrowId = useId().replace(/:/g, '');
  const figureSrc = useContext(FigureSrcContext);
  const v = story.view;
  return (
    <div className="story" aria-labelledby={headId} role="group" data-testid="repair-story">
      <h4 id={headId} className="story-head">{story.heading}</h4>
      <ol className="story-steps">
        {story.steps.map((s) => (
          <li key={s.key} className={`story-step tone-${s.tone}`}>
            <span className="story-dot" aria-hidden="true" />
            <span className="story-title">{s.title}</span>
            <span className="story-text">{s.sentence}</span>
          </li>
        ))}
      </ol>
      {v !== null && story.figureId !== null && story.moves.length > 0 && (
        <figure className="story-figure">
          <svg
            className="story-svg"
            viewBox={`${v.x} ${v.y} ${v.w} ${v.h}`}
            preserveAspectRatio="none"
            style={{ aspectRatio: `${v.w * story.figureAspect} / ${v.h}` }}
            role="img"
            aria-labelledby={`${arrowId}-t`}
          >
            <title id={`${arrowId}-t`}>{`Where ${story.moves.length} points were in the first version and where the revision moved them`}</title>
            <defs>
              <marker id={arrowId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                <path d="M0 0 L10 5 L0 10 z" className="story-arrowhead" />
              </marker>
            </defs>
            <image href={figureSrc(story.figureId)} x={0} y={0} width={1000} height={1000} preserveAspectRatio="none" />
            {story.moves.map((m, i) => {
              const r = Math.max(5, v.w * 0.02);
              const dx = m.to.x - m.from.x;
              const dy = m.to.y - m.from.y;
              const len = Math.hypot(dx, dy) || 1;
              // the arrow runs from the ring's edge to just short of the dot
              const x1 = m.from.x + (dx / len) * r * 1.2;
              const y1 = m.from.y + (dy / len) * r * 1.2;
              const x2 = m.to.x - (dx / len) * r * 1.3;
              const y2 = m.to.y - (dy / len) * r * 1.3;
              return (
                <g key={i}>
                  {len > r * 3 && <line x1={x1} y1={y1} x2={x2} y2={y2} className="story-arrow" markerEnd={`url(#${arrowId})`} style={{ strokeWidth: r * 0.4 }} />}
                  <circle cx={m.from.x} cy={m.from.y} r={r} className="story-before" style={{ strokeWidth: r * 0.45 }} />
                  <circle cx={m.to.x} cy={m.to.y} r={r} className="story-after" style={{ strokeWidth: r * 0.3 }} />
                </g>
              );
            })}
          </svg>
          <figcaption className="story-legend small">
            <span className="story-key"><span className="story-key-before" aria-hidden="true" />First version</span>
            <span className="story-key"><span className="story-key-after" aria-hidden="true" />After the revision</span>
          </figcaption>
        </figure>
      )}
    </div>
  );
}
