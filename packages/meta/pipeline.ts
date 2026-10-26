import { assembleSpec } from '../contracts/index.ts';
import type {
  ActivitySpec,
  GeneratedSpec,
  MetaReceipt,
  SourceAnalysis,
  SourceDocument,
  ValidationReport,
} from '../contracts/index.ts';
import { activitySpecGenSchema, sourceAnalysisGenSchema } from '../contracts/schemas.ts';
import { validateAnalysis, validateSpec } from '../validation/validate.ts';
import { buildAnalysisMessages, buildSpecMessages, PROMPT_VERSION } from './prompts.ts';
import type { MetaClient } from './client.ts';

export async function analyzeSource(
  client: MetaClient,
  source: SourceDocument,
  purpose: 'test-live' | 'demo',
): Promise<{ analysis: SourceAnalysis; report: ValidationReport; receipt: MetaReceipt }> {
  const result = await client.complete<SourceAnalysis>({
    purpose,
    schemaName: 'source_analysis',
    jsonSchema: sourceAnalysisGenSchema,
    messages: buildAnalysisMessages(source),
    maxOutputTokens: 6000,
  });
  const report: ValidationReport = validateAnalysis(result.data, [source]);
  return { analysis: result.data, report, receipt: result.receipt };
}

export async function generateSpec(
  client: MetaClient,
  source: SourceDocument,
  analysis: SourceAnalysis,
  ids: { jobId: string; specId: string },
  purpose: 'test-live' | 'demo',
  now: () => Date = () => new Date(),
): Promise<{
  generated: GeneratedSpec;
  spec: ActivitySpec;
  report: ValidationReport;
  receipt: MetaReceipt;
}> {
  const result = await client.complete<GeneratedSpec>({
    purpose,
    schemaName: 'activity_spec',
    jsonSchema: activitySpecGenSchema,
    messages: buildSpecMessages(source, analysis),
    maxOutputTokens: 12000,
  });
  const spec: ActivitySpec = assembleSpec(result.data, {
    id: ids.specId,
    sources: [source],
    provenance: {
      provider: 'meta',
      requestedModel: result.receipt.requestedModel,
      returnedModel: result.receipt.returnedModel,
      responseId: result.receipt.responseId,
      runId: ids.jobId,
      promptVersion: PROMPT_VERSION,
      revision: 1,
      repairOf: null,
      generatedAt: now().toISOString(),
    },
  });
  const report: ValidationReport = validateSpec(spec, [source]);
  return { generated: result.data, spec, report, receipt: result.receipt };
}
