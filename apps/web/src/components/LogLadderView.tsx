// Stage 8a log-ladder-v1 view — STUB placed by the lead so dispatch compiles; replaced by slice W-A
// (docs/specs/STAGE-8a-subject-engines.md). Keep the exported name and props.
import type { LogLadderSpec } from '../../../../packages/contracts/kit.ts';
import type { EnginePresentation } from '../lib/enginePresentation.ts';
import type { CiteProps } from './Explanations.tsx';

export interface LogLadderViewProps { spec: LogLadderSpec; cite: CiteProps; presentation?: EnginePresentation }

export function LogLadderView({ spec }: LogLadderViewProps) {
  return <p className="muted small">{spec.title}</p>;
}
