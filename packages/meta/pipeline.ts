import { Ajv } from 'ajv';
import type { AnySchemaObject, ValidateFunction } from 'ajv';
import { assembleSpec } from '../contracts/index.ts';
import type {
  ActivitySpec,
  GeneratedSpec,
  ForcesGeneratedSpec,
  MetaReceipt,
  SourceAnalysis,
  SourceDocument,
  ValidationReport,
} from '../contracts/index.ts';
import { activitySpecGenSchema, sourceAnalysisGenSchema } from '../contracts/schemas.ts';
import { validateAnalysis, validateSpec } from '../validation/validate.ts';
import { buildAnalysisMessages, buildSpecMessages, PROMPT_VERSION } from './prompts.ts';
import type { CompleteRequest, MetaClient } from './client.ts';

export class GeneratedOutputError extends Error {
  readonly code: 'OUTPUT_INVALID';
  readonly stage: 'analyze' | 'specify';
  readonly receipt: MetaReceipt;
  constructor(stage: 'analyze' | 'specify', receipt: MetaReceipt) {
    super('The model returned output that does not match the required structure.');
    this.name = 'GeneratedOutputError';
    this.code = 'OUTPUT_INVALID';
    this.stage = stage;
    this.receipt = receipt;
  }
}

const ajv: Ajv = new Ajv({ allErrors: true, strict: false });
const validateAnalysisGen: ValidateFunction = ajv.compile(
  sourceAnalysisGenSchema as unknown as AnySchemaObject,
);
const validateSpecGen: ValidateFunction = ajv.compile(
  activitySpecGenSchema as unknown as AnySchemaObject,
);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  if (Array.isArray(value)) {
    return false;
  }
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export async function analyzeSource(
  client: MetaClient,
  source: SourceDocument,
  purpose: 'test-live' | 'demo',
  opts?: { signal?: AbortSignal; maxOutputTokens?: number },
): Promise<{ analysis: SourceAnalysis; report: ValidationReport; receipt: MetaReceipt }> {
  const maxOutputTokens: number = opts?.maxOutputTokens ?? 6000;
  const req: CompleteRequest = {
    purpose,
    schemaName: 'source_analysis',
    jsonSchema: sourceAnalysisGenSchema,
    messages: buildAnalysisMessages(source),
    maxOutputTokens,
  };
  if (opts?.signal !== undefined) {
    req.signal = opts.signal;
  }
  const result = await client.complete<SourceAnalysis>(req);
  const raw: unknown = result.data;
  if (!isPlainObject(raw) || !validateAnalysisGen(raw)) {
    throw new GeneratedOutputError('analyze', result.receipt);
  }
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
  opts?: { signal?: AbortSignal; maxOutputTokens?: number },
): Promise<{
  generated: GeneratedSpec;
  spec: ActivitySpec;
  report: ValidationReport;
  receipt: MetaReceipt;
}> {
  const maxOutputTokens: number = opts?.maxOutputTokens ?? 8000;
  const req: CompleteRequest = {
    purpose,
    schemaName: 'activity_spec',
    jsonSchema: activitySpecGenSchema,
    messages: buildSpecMessages(source, analysis),
    maxOutputTokens,
  };
  if (opts?.signal !== undefined) {
    req.signal = opts.signal;
  }
  const result = await client.complete<GeneratedSpec>(req);
  const raw: unknown = result.data;
  if (!isPlainObject(raw) || !validateSpecGen(raw)) {
    throw new GeneratedOutputError('specify', result.receipt);
  }
  let spec: ActivitySpec;
  try {
    spec = assembleSpec(result.data as ForcesGeneratedSpec, 'forces-1d-v1', {
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
  } catch {
    throw new GeneratedOutputError('specify', result.receipt);
  }
  const report: ValidationReport = validateSpec(spec, [source]);
  return { generated: result.data, spec, report, receipt: result.receipt };
}
