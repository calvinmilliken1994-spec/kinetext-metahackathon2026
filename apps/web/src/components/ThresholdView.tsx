// Stage 8a threshold-v1 view — STUB placed by the lead so dispatch compiles; replaced by slice W-B
// (docs/specs/STAGE-8a-subject-engines.md). Keep the exported name and props.
import type { ThresholdSpec } from '../../../../packages/contracts/kit.ts';
import type { EnginePresentation } from '../lib/enginePresentation.ts';
import type { CiteProps } from './Explanations.tsx';

export interface ThresholdViewProps { spec: ThresholdSpec; cite: CiteProps; presentation?: EnginePresentation }

export function ThresholdView({ spec }: ThresholdViewProps) {
  return <p className="muted small">{spec.title}</p>;
}
