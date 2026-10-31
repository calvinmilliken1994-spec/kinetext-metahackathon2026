// Stage 8a data-table-v1 view — STUB placed by the lead so dispatch compiles; replaced by slice W-B
// (docs/specs/STAGE-8a-subject-engines.md). Keep the exported name and props.
import type { DataTableSpec } from '../../../../packages/contracts/kit.ts';
import type { EnginePresentation } from '../lib/enginePresentation.ts';
import type { CiteProps } from './Explanations.tsx';

export interface DataTableViewProps { spec: DataTableSpec; cite: CiteProps; presentation?: EnginePresentation }

export function DataTableView({ spec }: DataTableViewProps) {
  return <p className="muted small">{spec.title}</p>;
}
