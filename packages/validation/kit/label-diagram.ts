// Stage 8b label-diagram-v1 validator — STUB placed by the lead so dispatch typechecks; replaced by the
// validator slice (docs/specs/STAGE-8b-label-diagram.md). Until then every gen fails closed.
import type { SourceDocument, ValidationReport } from '../../contracts/index.ts';
import type { LabelDiagramGen, LabelRegion } from '../../contracts/kit.ts';
import type { FigureMeta } from '../../sources/figures.ts';
import { buildReport } from './shared.ts';

export interface LabelDiagramValidateOptions { revision?: number; regions?: readonly LabelRegion[]; figures?: readonly FigureMeta[] }

export function validateLabelDiagram(gen: LabelDiagramGen, sources: SourceDocument[], opts: LabelDiagramValidateOptions = {}): ValidationReport {
  void gen; void sources;
  return buildReport('label-diagram-v1', [{ id: 'schema.gen', kind: 'schema', passed: false, message: 'label-diagram-v1 validator not built yet' }], opts.revision ?? 1);
}
