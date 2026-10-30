import type { ReactNode } from 'react';
import type { TsPiece, TypesetFormula as Formula } from '../lib/typeset.ts';
import { tsText } from '../lib/typeset.ts';

function Pieces({ pieces }: { pieces: readonly TsPiece[] }): ReactNode {
  return pieces.map((p, i) => {
    switch (p.k) {
      case 'text': return <span key={i} className="ts-op">{p.v}</span>;
      case 'num': return <span key={i} className="ts-num">{p.v}</span>;
      case 'sym': return <var key={i}>{p.v}{p.sub !== undefined && <sub>{p.sub}</sub>}</var>;
      case 'sup': return <sup key={i}><Pieces pieces={p.v} /></sup>;
      case 'frac': return (
        <span key={i} className="ts-frac">
          <span className="ts-frac-num"><Pieces pieces={p.num} /></span>
          <span className="ts-frac-den"><Pieces pieces={p.den} /></span>
        </span>
      );
    }
  });
}

/** One typeset symbol (a slider's page symbol: C with subscript d, ρ). */
export function SymbolMark({ piece }: { piece: TsPiece }) {
  return <span className="ts-symbol"><Pieces pieces={[piece]} /></span>;
}

/**
 * The formula set as maths: page symbols with subscripts and Greek letters, powers raised, a division stacked. Built from
 * the parsed expression (lib/typeset.ts); screen readers get the same formula as one line of text.
 */
export function TypesetFormula({ formula, label = 'The formula' }: { formula: Formula; label?: string }) {
  const text = `${formula.lhs === null ? '' : `${tsText(formula.lhs)} = `}${tsText(formula.rhs)}`;
  return (
    <span className="ts-formula">
      <span className="sr-only">{label}: {text}</span>
      <span className="ts-body" aria-hidden="true">
        {formula.lhs !== null && <><Pieces pieces={formula.lhs} /><span className="ts-eq">=</span></>}
        <Pieces pieces={formula.rhs} />
      </span>
    </span>
  );
}
