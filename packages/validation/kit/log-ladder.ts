// Stage 8a log-ladder-v1 validator — STUB placed by the lead so dispatch typechecks; replaced by the owning
// validator slice (docs/specs/STAGE-8a-subject-engines.md). Until then every gen fails closed.
import type { SourceDocument, ValidationReport } from '../../contracts/index.ts';
import type { LogLadderGen } from '../../contracts/kit.ts';
import { buildReport } from './shared.ts';

export function validateLogLadder(gen: LogLadderGen, sources: SourceDocument[], opts: { revision?: number } = {}): ValidationReport {
  void gen; void sources;
  return buildReport('log-ladder-v1', [{ id: 'schema.gen', kind: 'schema', passed: false, message: 'log-ladder-v1 validator not built yet' }], opts.revision ?? 1);
}
