// Stage 8a data-table-v1 validator — STUB placed by the lead so dispatch typechecks; replaced by the owning
// validator slice (docs/specs/STAGE-8a-subject-engines.md). Until then every gen fails closed.
import type { SourceDocument, ValidationReport } from '../../contracts/index.ts';
import type { DataTableGen } from '../../contracts/kit.ts';
import { buildReport } from './shared.ts';

export function validateDataTable(gen: DataTableGen, sources: SourceDocument[], opts: { revision?: number } = {}): ValidationReport {
  void gen; void sources;
  return buildReport('data-table-v1', [{ id: 'schema.gen', kind: 'schema', passed: false, message: 'data-table-v1 validator not built yet' }], opts.revision ?? 1);
}
