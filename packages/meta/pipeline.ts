import { isDeepStrictEqual } from 'node:util';
import { Ajv } from 'ajv';
import type { AnySchemaObject, ValidateFunction } from 'ajv';
import { assembleSpec, assembleTimelineSpec, initialProvenance, isActivityId, isEngineId, repairProvenance } from '../contracts/index.ts';
import type {
  ActivitySpec,
  EngineId,
  ForcesGeneratedSpec,
  GeneratedSpec,
  LiftGeneratedSpec,
  MetaReceipt,
  ProjectileGeneratedSpec,
  RepairFinding,
  SoundGeneratedSpec,
  SourceAnalysis,
  SourceDocument,
  TimelineActivitySpec,
  TimelineGeneratedSpec,
  ValidationCheck,
  ValidationReport,
} from '../contracts/index.ts';
import { genSchemaFor, sourceAnalysisGenSchema, timelineGenSchema } from '../contracts/schemas.ts';
import { compareRevisions, repairFindings, validateAnalysis, validateSpec } from '../validation/validate.ts';
import type { AnyActivitySpec } from '../validation/validate.ts';
import { buildAnalysisMessages, buildAnalysisRepairMessages, buildRepairMessages, buildSpecMessages, PROMPT_VERSION } from './prompts.ts';
import type { CompleteRequest, MetaClient } from './client.ts';

export class GeneratedOutputError extends Error {
  readonly code: 'OUTPUT_INVALID';
  readonly stage: 'analyze' | 'specify' | 'repair' | 'analysis-repair';
  readonly receipt: MetaReceipt;
  constructor(stage: 'analyze' | 'specify' | 'repair' | 'analysis-repair', receipt: MetaReceipt) {
    super('The model returned output that does not match the required structure.');
    this.name = 'GeneratedOutputError';
    this.code = 'OUTPUT_INVALID';
    this.stage = stage;
    this.receipt = receipt;
  }
}

/** Source analysis that selects the timeline-v1 sequence engine. */
export type TimelineSourceAnalysis = Omit<SourceAnalysis, 'activity'> & { activity: 'timeline-v1' };

const ajv: Ajv = new Ajv({ allErrors: true, strict: false });
const validateAnalysisGen: ValidateFunction = ajv.compile(
  sourceAnalysisGenSchema as unknown as AnySchemaObject,
);
const validateTimelineGen: ValidateFunction = ajv.compile(
  timelineGenSchema as unknown as AnySchemaObject,
);

const genValidators = new Map<EngineId, ValidateFunction>();
function genValidatorFor(engine: EngineId): ValidateFunction {
  let v: ValidateFunction | undefined = genValidators.get(engine);
  if (v === undefined) {
    v = ajv.compile(genSchemaFor(engine) as unknown as AnySchemaObject);
    genValidators.set(engine, v);
  }
  return v;
}

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
  analysis: TimelineSourceAnalysis,
  ids: { jobId: string; specId: string },
  purpose: 'test-live' | 'demo',
  now?: () => Date,
  opts?: { signal?: AbortSignal; maxOutputTokens?: number },
): Promise<{
  generated: TimelineGeneratedSpec;
  spec: TimelineActivitySpec;
  report: ValidationReport;
  receipt: MetaReceipt;
}>;
export async function generateSpec(
  client: MetaClient,
  source: SourceDocument,
  analysis: SourceAnalysis,
  ids: { jobId: string; specId: string },
  purpose: 'test-live' | 'demo',
  now?: () => Date,
  opts?: { signal?: AbortSignal; maxOutputTokens?: number },
): Promise<{
  generated: GeneratedSpec;
  spec: ActivitySpec;
  report: ValidationReport;
  receipt: MetaReceipt;
}>;
export async function generateSpec(
  client: MetaClient,
  source: SourceDocument,
  analysis: SourceAnalysis | TimelineSourceAnalysis,
  ids: { jobId: string; specId: string },
  purpose: 'test-live' | 'demo',
  now: () => Date = () => new Date(),
  opts?: { signal?: AbortSignal; maxOutputTokens?: number },
): Promise<{
  generated: GeneratedSpec | TimelineGeneratedSpec;
  spec: AnyActivitySpec;
  report: ValidationReport;
  receipt: MetaReceipt;
}> {
  const activityValue: unknown = (analysis as { activity: unknown }).activity;
  if (!isActivityId(activityValue)) {
    throw new Error('ENGINE_REQUIRED');
  }
  const maxOutputTokens: number = opts?.maxOutputTokens ?? 8000;
  if (activityValue === 'timeline-v1') {
    const jsonSchema: Record<string, unknown> = timelineGenSchema;
    const messages = buildSpecMessages(source, analysis as unknown as SourceAnalysis);
    const req: CompleteRequest = {
      purpose,
      schemaName: 'activity_spec',
      jsonSchema,
      messages,
      maxOutputTokens,
    };
    if (opts?.signal !== undefined) {
      req.signal = opts.signal;
    }
    const result = await client.complete<GeneratedSpec | TimelineGeneratedSpec>(req);
    const raw: unknown = result.data;
    if (!isPlainObject(raw) || !validateTimelineGen(raw)) {
      throw new GeneratedOutputError('specify', result.receipt);
    }
    let spec: AnyActivitySpec;
    try {
      spec = assembleTimelineSpec(result.data as TimelineGeneratedSpec, {
        id: ids.specId,
        sources: [source],
        provenance: initialProvenance({
          provider: 'meta',
          requestedModel: result.receipt.requestedModel,
          returnedModel: result.receipt.returnedModel,
          responseId: result.receipt.responseId,
          runId: ids.jobId,
          promptVersion: PROMPT_VERSION,
          generatedAt: now().toISOString(),
        }),
      });
    } catch {
      throw new GeneratedOutputError('specify', result.receipt);
    }
    const report: ValidationReport = validateSpec(spec, [source]);
    return { generated: result.data, spec, report, receipt: result.receipt };
  }
  if (!isEngineId(activityValue)) {
    throw new Error('ENGINE_REQUIRED');
  }
  const engine: EngineId = activityValue;
  const jsonSchema: Record<string, unknown> = genSchemaFor(engine);
  const messages = buildSpecMessages(source, analysis as unknown as SourceAnalysis);
  const req: CompleteRequest = {
    purpose,
    schemaName: 'activity_spec',
    jsonSchema,
    messages,
    maxOutputTokens,
  };
  if (opts?.signal !== undefined) {
    req.signal = opts.signal;
  }
  const result = await client.complete<GeneratedSpec>(req);
  const raw: unknown = result.data;
  if (!isPlainObject(raw) || !genValidatorFor(engine)(raw)) {
    throw new GeneratedOutputError('specify', result.receipt);
  }
  let spec: ActivitySpec;
  try {
    if (engine === 'forces-1d-v1') {
      spec = assembleSpec(result.data as ForcesGeneratedSpec, engine, {
        id: ids.specId,
        sources: [source],
        provenance: initialProvenance({
          provider: 'meta',
          requestedModel: result.receipt.requestedModel,
          returnedModel: result.receipt.returnedModel,
          responseId: result.receipt.responseId,
          runId: ids.jobId,
          promptVersion: PROMPT_VERSION,
          generatedAt: now().toISOString(),
        }),
      });
    } else if (engine === 'projectile-v1') {
      spec = assembleSpec(result.data as ProjectileGeneratedSpec, engine, {
        id: ids.specId,
        sources: [source],
        provenance: initialProvenance({
          provider: 'meta',
          requestedModel: result.receipt.requestedModel,
          returnedModel: result.receipt.returnedModel,
          responseId: result.receipt.responseId,
          runId: ids.jobId,
          promptVersion: PROMPT_VERSION,
          generatedAt: now().toISOString(),
        }),
      });
    } else if (engine === 'lift-equation-v1') {
      spec = assembleSpec(result.data as LiftGeneratedSpec, engine, {
        id: ids.specId,
        sources: [source],
        provenance: initialProvenance({
          provider: 'meta',
          requestedModel: result.receipt.requestedModel,
          returnedModel: result.receipt.returnedModel,
          responseId: result.receipt.responseId,
          runId: ids.jobId,
          promptVersion: PROMPT_VERSION,
          generatedAt: now().toISOString(),
        }),
      });
    } else {
      spec = assembleSpec(result.data as SoundGeneratedSpec, engine, {
        id: ids.specId,
        sources: [source],
        provenance: initialProvenance({
          provider: 'meta',
          requestedModel: result.receipt.requestedModel,
          returnedModel: result.receipt.returnedModel,
          responseId: result.receipt.responseId,
          runId: ids.jobId,
          promptVersion: PROMPT_VERSION,
          generatedAt: now().toISOString(),
        }),
      });
    }
  } catch {
    throw new GeneratedOutputError('specify', result.receipt);
  }
  const report: ValidationReport = validateSpec(spec, [source]);
  return { generated: result.data, spec, report, receipt: result.receipt };
}

export async function repairSpec(
  client: MetaClient,
  source: SourceDocument,
  analysis: TimelineSourceAnalysis,
  previous: {
    generated: TimelineGeneratedSpec;
    spec: TimelineActivitySpec;
    report: ValidationReport;
    revision: number;
    findingsHistory: RepairFinding[][];
    baseline?: { spec: TimelineActivitySpec; failedIds: string[] };
  },
  ids: { jobId: string; specId: string },
  purpose: 'test-live' | 'demo',
  now?: () => Date,
  opts?: { signal?: AbortSignal; maxOutputTokens?: number },
): Promise<{
  generated: TimelineGeneratedSpec;
  spec: TimelineActivitySpec;
  report: ValidationReport;
  receipt: MetaReceipt;
}>;
export async function repairSpec(
  client: MetaClient,
  source: SourceDocument,
  analysis: SourceAnalysis,
  previous: {
    generated: GeneratedSpec;
    spec: ActivitySpec;
    report: ValidationReport;
    revision: number;
    findingsHistory: RepairFinding[][];
    baseline?: { spec: ActivitySpec; failedIds: string[] };
  },
  ids: { jobId: string; specId: string },
  purpose: 'test-live' | 'demo',
  now?: () => Date,
  opts?: { signal?: AbortSignal; maxOutputTokens?: number },
): Promise<{
  generated: GeneratedSpec;
  spec: ActivitySpec;
  report: ValidationReport;
  receipt: MetaReceipt;
}>;
export async function repairSpec(
  client: MetaClient,
  source: SourceDocument,
  analysis: SourceAnalysis | TimelineSourceAnalysis,
  previous: {
    generated: GeneratedSpec | TimelineGeneratedSpec;
    spec: AnyActivitySpec;
    report: ValidationReport;
    revision: number;
    findingsHistory: RepairFinding[][];
    baseline?: { spec: AnyActivitySpec; failedIds: string[] };
  },
  ids: { jobId: string; specId: string },
  purpose: 'test-live' | 'demo',
  now: () => Date = () => new Date(),
  opts?: { signal?: AbortSignal; maxOutputTokens?: number },
): Promise<{
  generated: GeneratedSpec | TimelineGeneratedSpec;
  spec: AnyActivitySpec;
  report: ValidationReport;
  receipt: MetaReceipt;
}> {
  const activityValue: unknown = (analysis as { activity: unknown }).activity;
  if (!isActivityId(activityValue)) {
    throw new Error('ENGINE_REQUIRED');
  }
  const prevEngine: unknown = (previous.spec as unknown as { simulation?: { engine?: unknown } })
    .simulation?.engine;
  if (prevEngine !== activityValue) {
    throw new Error(
      `ENGINE_MISMATCH: analysis.activity is ${String(activityValue)} but previous.spec.simulation.engine is ${String(prevEngine)}`,
    );
  }
  const maxOutputTokens: number = opts?.maxOutputTokens ?? 8000;
  if (activityValue === 'timeline-v1') {
    const req: CompleteRequest = {
      purpose,
      schemaName: 'activity_spec_repair',
      jsonSchema: timelineGenSchema,
      messages: buildRepairMessages(
        source,
        analysis as unknown as SourceAnalysis,
        activityValue,
        previous.generated,
        previous.findingsHistory,
      ),
      maxOutputTokens,
    };
    if (opts?.signal !== undefined) {
      req.signal = opts.signal;
    }
    const result = await client.complete<GeneratedSpec | TimelineGeneratedSpec>(req);
    const raw: unknown = result.data;
    if (!isPlainObject(raw) || !validateTimelineGen(raw)) {
      throw new GeneratedOutputError('repair', result.receipt);
    }
    let spec: AnyActivitySpec;
    try {
      spec = assembleTimelineSpec(result.data as TimelineGeneratedSpec, {
        id: ids.specId,
        sources: [source],
        provenance: repairProvenance(
          {
            provider: 'meta',
            requestedModel: result.receipt.requestedModel,
            returnedModel: result.receipt.returnedModel,
            responseId: result.receipt.responseId,
            runId: ids.jobId,
            promptVersion: PROMPT_VERSION,
            generatedAt: now().toISOString(),
          },
          previous.revision,
        ),
      });
    } catch {
      throw new GeneratedOutputError('repair', result.receipt);
    }
    const base: ValidationReport = validateSpec(spec, [source]);
    const baselineSpec: AnyActivitySpec = previous.baseline?.spec ?? previous.spec;
    const baselineFailedIds: string[] =
      previous.baseline?.failedIds ??
      previous.report.checks.filter((c) => !c.passed).map((c) => c.id);
    const baselineFindings: RepairFinding[] =
      previous.baseline !== undefined
        ? repairFindings(validateSpec(baselineSpec, [source]), baselineSpec)
        : repairFindings(previous.report, previous.spec);
    const weakening = compareRevisions(baselineSpec, spec, baselineFailedIds, {
      sources: [source],
      findings: baselineFindings,
    });
    const checks = [...base.checks, weakening];
    const report: ValidationReport = {
      artifactId: base.artifactId,
      revision: base.revision,
      checks,
      publishable: checks.every((c) => c.passed),
    };
    return { generated: result.data, spec, report, receipt: result.receipt };
  }
  if (!isEngineId(activityValue)) {
    throw new Error('ENGINE_REQUIRED');
  }
  const engine: EngineId = activityValue;
  const req: CompleteRequest = {
    purpose,
    schemaName: 'activity_spec_repair',
    jsonSchema: genSchemaFor(engine),
    messages: buildRepairMessages(
      source,
      analysis as unknown as SourceAnalysis,
      engine,
      previous.generated,
      previous.findingsHistory,
    ),
    maxOutputTokens,
  };
  if (opts?.signal !== undefined) {
    req.signal = opts.signal;
  }
  const result = await client.complete<GeneratedSpec>(req);
  const raw: unknown = result.data;
  if (!isPlainObject(raw) || !genValidatorFor(engine)(raw)) {
    throw new GeneratedOutputError('repair', result.receipt);
  }
  let spec: ActivitySpec;
  try {
    if (engine === 'forces-1d-v1') {
      spec = assembleSpec(result.data as ForcesGeneratedSpec, engine, {
        id: ids.specId,
        sources: [source],
        provenance: repairProvenance(
          {
            provider: 'meta',
            requestedModel: result.receipt.requestedModel,
            returnedModel: result.receipt.returnedModel,
            responseId: result.receipt.responseId,
            runId: ids.jobId,
            promptVersion: PROMPT_VERSION,
            generatedAt: now().toISOString(),
          },
          previous.revision,
        ),
      });
    } else if (engine === 'projectile-v1') {
      spec = assembleSpec(result.data as ProjectileGeneratedSpec, engine, {
        id: ids.specId,
        sources: [source],
        provenance: repairProvenance(
          {
            provider: 'meta',
            requestedModel: result.receipt.requestedModel,
            returnedModel: result.receipt.returnedModel,
            responseId: result.receipt.responseId,
            runId: ids.jobId,
            promptVersion: PROMPT_VERSION,
            generatedAt: now().toISOString(),
          },
          previous.revision,
        ),
      });
    } else if (engine === 'lift-equation-v1') {
      spec = assembleSpec(result.data as LiftGeneratedSpec, engine, {
        id: ids.specId,
        sources: [source],
        provenance: repairProvenance(
          {
            provider: 'meta',
            requestedModel: result.receipt.requestedModel,
            returnedModel: result.receipt.returnedModel,
            responseId: result.receipt.responseId,
            runId: ids.jobId,
            promptVersion: PROMPT_VERSION,
            generatedAt: now().toISOString(),
          },
          previous.revision,
        ),
      });
    } else {
      spec = assembleSpec(result.data as SoundGeneratedSpec, engine, {
        id: ids.specId,
        sources: [source],
        provenance: repairProvenance(
          {
            provider: 'meta',
            requestedModel: result.receipt.requestedModel,
            returnedModel: result.receipt.returnedModel,
            responseId: result.receipt.responseId,
            runId: ids.jobId,
            promptVersion: PROMPT_VERSION,
            generatedAt: now().toISOString(),
          },
          previous.revision,
        ),
      });
    }
  } catch {
    throw new GeneratedOutputError('repair', result.receipt);
  }
  const base: ValidationReport = validateSpec(spec, [source]);
  const baselineSpec: AnyActivitySpec = previous.baseline?.spec ?? previous.spec;
  const baselineFailedIds: string[] =
    previous.baseline?.failedIds ??
    previous.report.checks.filter((c) => !c.passed).map((c) => c.id);
  const baselineFindings: RepairFinding[] =
    previous.baseline !== undefined
      ? repairFindings(validateSpec(baselineSpec, [source]), baselineSpec)
      : repairFindings(previous.report, previous.spec);
  const weakening = compareRevisions(baselineSpec, spec, baselineFailedIds, {
    sources: [source],
    findings: baselineFindings,
  });
  const checks = [...base.checks, weakening];
  const report: ValidationReport = {
    artifactId: base.artifactId,
    revision: base.revision,
    checks,
    publishable: checks.every((c) => c.passed),
  };
  return { generated: result.data, spec, report, receipt: result.receipt };
}

function allowedAnalysisGroups(report: ValidationReport): Set<string> {
  const allowed = new Set<string>();
  const raw: unknown = (report as { checks?: unknown } | null | undefined)?.checks;
  if (!Array.isArray(raw)) {
    return allowed;
  }
  for (const check of raw as ValidationCheck[]) {
    if (check.passed) {
      continue;
    }
    if (check.id === 'repair.analysis-unchanged') {
      continue;
    }
    if (check.id === 'schema.analysis' || check.id === 'analysis.invariants') {
      allowed.add('decision');
      allowed.add('unsupportedReason');
      allowed.add('objectives');
      allowed.add('concepts');
      continue;
    }
    const p: unknown = check.path;
    if (typeof p !== 'string') {
      continue;
    }
    const names = (field: string): boolean => p === `/${field}` || p.startsWith(`/${field}/`);
    if (names('supported') || names('activity')) {
      allowed.add('decision');
    }
    if (names('unsupportedReason')) {
      allowed.add('unsupportedReason');
    }
    if (names('objectives')) {
      allowed.add('objectives');
    }
    if (names('concepts')) {
      allowed.add('concepts');
    }
  }
  return allowed;
}

function checkAnalysisUnchanged(
  prevAnalysis: unknown,
  nextAnalysis: SourceAnalysis,
  prevReport: ValidationReport,
): ValidationCheck {
  // Rationale: without this check a repair could escape a concept-id finding by declining the source (supported=false, activity 'none'), which validateAnalysis alone would accept as an honest decline.
  const allowed: Set<string> = allowedAnalysisGroups(prevReport);
  const rawChecks: unknown = (prevReport as { checks?: unknown } | null | undefined)?.checks;
  const prevChecks: ValidationCheck[] = Array.isArray(rawChecks) ? (rawChecks as ValidationCheck[]) : [];
  const nextRec = nextAnalysis as unknown as Record<string, unknown>;
  const nextDecision = { supported: nextRec.supported, activity: nextRec.activity };
  let prevDecision: { supported: unknown; activity: unknown };
  let changedDecision: boolean;
  let changedReason: boolean;
  let changedObjectives: boolean;
  let changedConcepts: boolean;
  if (!isPlainObject(prevAnalysis)) {
    changedDecision = true;
    changedReason = true;
    changedObjectives = true;
    changedConcepts = true;
    prevDecision = { supported: undefined, activity: undefined };
  } else {
    const p = prevAnalysis as unknown as Record<string, unknown>;
    prevDecision = { supported: p.supported, activity: p.activity };
    changedDecision = !isDeepStrictEqual(prevDecision, nextDecision);
    changedReason = !isDeepStrictEqual(p.unsupportedReason, nextRec.unsupportedReason);
    changedObjectives = !isDeepStrictEqual(p.objectives, nextRec.objectives);
    changedConcepts = !isDeepStrictEqual(p.concepts, nextRec.concepts);
  }
  const changed: string[] = [];
  if (changedDecision) {
    changed.push('decision');
  }
  if (changedReason) {
    changed.push('unsupportedReason');
  }
  if (changedObjectives) {
    changed.push('objectives');
  }
  if (changedConcepts) {
    changed.push('concepts');
  }
  const offending: string[] = changed.filter((g) => !allowed.has(g));
  if (offending.length === 0) {
    const failingIds: string[] = prevChecks.filter((c) => !c.passed).map((c) => c.id);
    const changedText: string = changed.length === 0 ? 'no groups changed' : `changed groups: ${changed.join(', ')}`;
    return {
      id: 'repair.analysis-unchanged',
      kind: 'semantic',
      passed: true,
      message: `${changedText}; allowed by findings ${failingIds.join(', ')}`,
    };
  }
  const pathFor = (group: string): string => {
    if (group === 'decision') {
      return '/activity';
    }
    return `/${group}`;
  };
  const first: string = offending[0] as string;
  let message = `repair changed ${offending.join(', ')} without a finding naming them`;
  if (offending.includes('decision')) {
    message += `; decision changed from supported=${String(prevDecision.supported)} activity=${String(prevDecision.activity)} to supported=${String(nextDecision.supported)} activity=${String(nextDecision.activity)}`;
  }
  return {
    id: 'repair.analysis-unchanged',
    kind: 'semantic',
    passed: false,
    message,
    path: pathFor(first),
  };
}

export async function repairAnalysis(
  client: MetaClient,
  source: SourceDocument,
  previous: { analysis: unknown; report: ValidationReport; attempt: number; baseline?: { analysis: unknown; report: ValidationReport } },
  purpose: 'test-live' | 'demo',
  opts?: { signal?: AbortSignal; maxOutputTokens?: number },
): Promise<{ analysis: SourceAnalysis; report: ValidationReport; receipt: MetaReceipt }> {
  if (!Number.isInteger(previous.attempt) || previous.attempt < 1 || previous.attempt > 2) {
    throw new Error('REPAIR_ATTEMPT_INVALID');
  }
  const rawChecks: unknown = (previous.report as { checks?: unknown } | null | undefined)?.checks;
  if (!Array.isArray(rawChecks) || !(rawChecks as ValidationCheck[]).some((c) => !c.passed)) {
    throw new Error('NOTHING_TO_REPAIR');
  }
  const findings: RepairFinding[] = repairFindings(previous.report);
  const baselineAnalysis: unknown = previous.baseline?.analysis ?? previous.analysis;
  const baselineReport: ValidationReport = previous.baseline?.report ?? previous.report;
  const maxOutputTokens: number = opts?.maxOutputTokens ?? 6000;
  const req: CompleteRequest = {
    purpose,
    schemaName: 'source_analysis_repair',
    jsonSchema: sourceAnalysisGenSchema,
    messages: previous.baseline === undefined
      ? buildAnalysisRepairMessages(source, previous.analysis, findings)
      : buildAnalysisRepairMessages(source, previous.analysis, findings, baselineAnalysis),
    maxOutputTokens,
  };
  if (opts?.signal !== undefined) {
    req.signal = opts.signal;
  }
  const result = await client.complete<SourceAnalysis>(req);
  const raw: unknown = result.data;
  if (!isPlainObject(raw) || !validateAnalysisGen(raw)) {
    throw new GeneratedOutputError('analysis-repair', result.receipt);
  }
  const base: ValidationReport = validateAnalysis(result.data, [source]);
  const unchanged: ValidationCheck = checkAnalysisUnchanged(baselineAnalysis, result.data, baselineReport);
  const checks: ValidationCheck[] = [...base.checks, unchanged];
  const report: ValidationReport = {
    artifactId: base.artifactId,
    revision: previous.attempt + 1,
    checks,
    publishable: checks.every((c) => c.passed),
  };
  return { analysis: result.data, report, receipt: result.receipt };
}
