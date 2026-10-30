import type { ReactNode } from 'react';
import type { EqPiece, Equation } from '../lib/equation.ts';
import { equationText } from '../lib/equation.ts';
import { CONCEALED, CONCEALED_HINT } from '../lib/reveal.ts';
import { Linked } from './Linked.tsx';

function Pieces({ pieces }: { pieces: readonly EqPiece[] }): ReactNode {
  return pieces.map((p, i) => {
    switch (p.k) {
      case 'text': return <span key={i}>{p.v}</span>;
      case 'num': return <span key={i} className="eq-num">{p.v}</span>;
      case 'sym': return <var key={i}>{p.v}{p.sub !== undefined && <sub>{p.sub}</sub>}</var>;
      case 'sup': return <sup key={i}><Pieces pieces={p.v} /></sup>;
    }
  });
}

/**
 * The live substituted equation under a simulation: formula = formula with the current numbers = the engine's result.
 * Hovering it lights the page sentence that states the formula (`links`). While case 1 is unanswered the result is '?'.
 */
export function EquationLine({ equation, concealed, links, label = 'The formula with the current numbers' }: { equation: Equation | null; concealed: boolean; links: readonly string[]; label?: string }) {
  if (equation === null) return null;
  return (
    <Linked as="p" links={links} className="eq-line">
      <span className="sr-only">{label}: {equationText(equation, concealed)}</span>
      <span className="eq-body" aria-hidden="true">
        <span className="eq-part"><Pieces pieces={equation.lhs} /> = <Pieces pieces={equation.symbolic} /></span>
        <span className="eq-part"> = <Pieces pieces={equation.substituted} /></span>
        <span className="eq-part"> = {concealed
          ? <span className="eq-result concealed" title={CONCEALED_HINT}>{CONCEALED}</span>
          : <span className="eq-result">{equation.result}</span>}</span>
      </span>
    </Linked>
  );
}
