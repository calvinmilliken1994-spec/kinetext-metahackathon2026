// Stage 8a algorithm-trace-v1 validator — STUB placed by the lead so dispatch typechecks; replaced by the owning
// validator slice (docs/specs/STAGE-8a-subject-engines.md). Until then every gen fails closed.
import type { SourceDocument, ValidationReport } from '../../contracts/index.ts';
import type { AlgorithmTraceGen } from '../../contracts/kit.ts';
import { buildReport } from './shared.ts';

export function validateAlgorithmTrace(gen: AlgorithmTraceGen, sources: SourceDocument[], opts: { revision?: number } = {}): ValidationReport {
  void gen; void sources;
  return buildReport('algorithm-trace-v1', [{ id: 'schema.gen', kind: 'schema', passed: false, message: 'algorithm-trace-v1 validator not built yet' }], opts.revision ?? 1);
}
