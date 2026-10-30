import { useLayoutEffect, useRef, useState } from 'react';
import { CONCEALED, CONCEALED_HINT } from '../lib/reveal.ts';

interface Box { x: number; y: number; width: number; height: number }

/**
 * A scene label whose number is still hidden (predict-then-reveal): the label's words stay and a dashed '?' chip stands in
 * for the number and its unit — 'max height [?]', 'a = [?]', or the chip alone. One treatment for every engine scene, so a
 * hidden answer reads as deliberate rather than as a missing value ('max height ? m'). The chip is sized from the drawn '?'.
 */
export function HiddenValueText({ x, y, anchor = 'start', lead, className = 'scene-label' }: {
  x: number;
  y: number;
  anchor?: 'start' | 'middle' | 'end';
  /** The label's words before the number (lib/displayText.ts hiddenAnswerLead); '' for the chip alone. */
  lead: string;
  className?: string;
}) {
  const q = useRef<SVGTSpanElement>(null);
  const [box, setBox] = useState<Box | null>(null);
  useLayoutEffect(() => {
    const el = q.current;
    if (el === null || typeof el.getBBox !== 'function') return;
    const b = el.getBBox();
    setBox((prev) => (prev !== null && prev.x === b.x && prev.y === b.y && prev.width === b.width && prev.height === b.height ? prev : { x: b.x, y: b.y, width: b.width, height: b.height }));
  }, [x, y, anchor, lead]);
  // The chip sits a little wider than the glyph so it reads as a box, not an outline round a character.
  const padX = 6;
  const padY = 2;
  return (
    <g className="scene-hidden" aria-hidden="true">
      {box !== null && (
        <rect x={box.x - padX} y={box.y - padY} width={box.width + 2 * padX} height={box.height + 2 * padY} rx={5} className="scene-hidden-chip" />
      )}
      <text x={x} y={y} textAnchor={anchor} className={className}>
        <title>{CONCEALED_HINT}</title>
        {lead === '' ? '' : `${lead} `}
        <tspan ref={q} className="scene-hidden-q" dx={lead === '' ? 0 : 7}>{CONCEALED}</tspan>
      </text>
    </g>
  );
}
