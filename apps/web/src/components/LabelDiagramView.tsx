// Stage 8b label-diagram-v1 view — STUB placed by the lead so dispatch compiles; replaced by slice U
// (docs/specs/STAGE-8b-label-diagram.md). Keep the exported name and props.
import type { LabelDiagramSpec } from '../../../../packages/contracts/kit.ts';
import type { EnginePresentation } from '../lib/enginePresentation.ts';
import type { CiteProps } from './Explanations.tsx';

export interface LabelDiagramViewProps { spec: LabelDiagramSpec; cite: CiteProps; presentation?: EnginePresentation }

export function LabelDiagramView({ spec }: LabelDiagramViewProps) {
  return <p className="muted small">{spec.title}</p>;
}
