// Stage 8a algorithm-trace-v1 view — STUB placed by the lead so dispatch compiles; replaced by slice W-A
// (docs/specs/STAGE-8a-subject-engines.md). Keep the exported name and props.
import type { AlgorithmTraceSpec } from '../../../../packages/contracts/kit.ts';
import type { EnginePresentation } from '../lib/enginePresentation.ts';
import type { CiteProps } from './Explanations.tsx';

export interface AlgorithmTraceViewProps { spec: AlgorithmTraceSpec; cite: CiteProps; presentation?: EnginePresentation }

export function AlgorithmTraceView({ spec }: AlgorithmTraceViewProps) {
  return <p className="muted small">{spec.title}</p>;
}
