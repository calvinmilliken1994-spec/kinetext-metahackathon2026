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
    const baselineFindings: RepairFinding[] = repairFindings(
      validateSpec(baselineSpec, [source]),
      baselineSpec,
    );
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
  const baselineFindings: RepairFinding[] = repairFindings(
    validateSpec(baselineSpec, [source]),
    baselineSpec,
  );
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

function baselineAuthorization(
  baseline: unknown,
  source: SourceDocument,
): { authorized: string[]; failingIds: string[] } {
  let report: ValidationReport;
  try {
    report = validateAnalysis(baseline, [source]);
  } catch {
    return { authorized: [], failingIds: [] };
  }
  const authorized: string[] = [];
  const seenPaths = new Set<string>();
  const failingIds: string[] = [];
  const seenIds = new Set<string>();
  const raw: unknown = (report as { checks?: unknown } | null | undefined)?.checks;
  if (!Array.isArray(raw)) {
    return { authorized, failingIds };
  }
  for (const item of raw as ValidationCheck[]) {
    if (typeof item !== 'object' || item === null) {
      continue;
    }
    const c = item as ValidationCheck;
    if (c.passed) {
      continue;
    }
    if (c.id === 'repair.analysis-unchanged') {
      continue;
    }
    if (typeof c.id === 'string' && !seenIds.has(c.id)) {
      seenIds.add(c.id);
      failingIds.push(c.id);
    }
    if (Array.isArray(c.affected)) {
      for (const p of c.affected) {
        if (typeof p === 'string' && p !== '' && !seenPaths.has(p)) {
          seenPaths.add(p);
          authorized.push(p);
        }
      }
    }
  }
  return { authorized, failingIds };
}

function isBaselineShapeValid(baseline: unknown): boolean {
  if (!isPlainObject(baseline)) {
    return false;
  }
  const rec = baseline as Record<string, unknown>;
  if (!Array.isArray(rec.concepts)) {
    return false;
  }
  if (!Array.isArray(rec.objectives)) {
    return false;
  }
  for (const c of rec.concepts as unknown[]) {
    if (!isPlainObject(c)) {
      return false;
    }
    const cr = c as Record<string, unknown>;
    if (!Array.isArray(cr.evidence)) {
      return false;
    }
  }
  return true;
}

function escapePointerSegment(seg: string): string {
  return seg.replace(/~/g, '~0').replace(/\//g, '~1');
}

function diffJsonPointers(a: unknown, b: unknown, base: string = ''): string[] {
  if (isDeepStrictEqual(a, b)) {
    return [];
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const out: string[] = [];
    const keys = new Set<string>([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      const ptr = `${base}/${escapePointerSegment(k)}`;
      const hasA: boolean = Object.prototype.hasOwnProperty.call(a, k);
      const hasB: boolean = Object.prototype.hasOwnProperty.call(b, k);
      if (!hasA || !hasB) {
        out.push(ptr);
      } else {
        const av: unknown = (a as Record<string, unknown>)[k];
        const bv: unknown = (b as Record<string, unknown>)[k];
        out.push(...diffJsonPointers(av, bv, ptr));
      }
    }
    return out;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    const out: string[] = [];
    const atBase: string = base === '' ? '/' : base;
    if (a.length !== b.length) {
      out.push(atBase);
    }
    const n: number = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
      out.push(...diffJsonPointers(a[i], b[i], `${base}/${i}`));
    }
    if (a.length !== b.length) {
      const longer: unknown[] = a.length > b.length ? a : b;
      for (let i = n; i < longer.length; i++) {
        out.push(`${base}/${i}`);
      }
    }
    return out;
  }
  return [base === '' ? '/' : base];
}

function buildExpectedAnalysis(
  baseline: Record<string, unknown>,
  candidate: SourceAnalysis,
  authorized: Set<string>,
): Record<string, unknown> {
  const expected: Record<string, unknown> = structuredClone(baseline) as Record<string, unknown>;
  if (authorized.has('/supported') || authorized.has('/activity')) {
    expected.supported = candidate.supported;
    expected.activity = candidate.activity;
    expected.unsupportedReason = candidate.unsupportedReason;
  } else if (authorized.has('/unsupportedReason')) {
    expected.unsupportedReason = candidate.unsupportedReason;
  }
  const baseObjs: unknown[] = Array.isArray(baseline.objectives)
    ? (baseline.objectives as unknown[])
    : [];
  const candObjs: unknown[] = Array.isArray(candidate.objectives)
    ? (candidate.objectives as unknown[])
    : [];
  const expObjs: unknown[] = Array.isArray(expected.objectives)
    ? (expected.objectives as unknown[])
    : [];
  for (let i = 0; i < baseObjs.length; i++) {
    if (authorized.has(`/objectives/${i}`) && i < candObjs.length) {
      expObjs[i] = candObjs[i];
    }
  }
  if (authorized.has('/objectives') && candObjs.length >= baseObjs.length) {
    expObjs.length = baseObjs.length;
    for (const v of candObjs.slice(baseObjs.length)) {
      expObjs.push(v);
    }
  }
  expected.objectives = expObjs;
  const baseCons: unknown[] = Array.isArray(baseline.concepts)
    ? (baseline.concepts as unknown[])
    : [];
  const candCons: Record<string, unknown>[] = (candidate.concepts as unknown as Record<string, unknown>[]) ?? [];
  const expCons: unknown[] = Array.isArray(expected.concepts)
    ? (expected.concepts as unknown[])
    : [];
  for (let i = 0; i < baseCons.length; i++) {
    if (i >= candCons.length) {
      continue;
    }
    const baseC: unknown = baseCons[i];
    const candC: unknown = candCons[i];
    const expC: unknown = expCons[i];
    if (!isPlainObject(baseC) || !isPlainObject(candC) || !isPlainObject(expC)) {
      continue;
    }
    if (authorized.has(`/concepts/${i}/id`)) {
      (expC as Record<string, unknown>).id = (candC as Record<string, unknown>).id;
    }
    if (authorized.has(`/concepts/${i}/name`)) {
      (expC as Record<string, unknown>).name = (candC as Record<string, unknown>).name;
    }
    const baseEv: unknown = (baseC as Record<string, unknown>).evidence;
    const candEv: unknown = (candC as Record<string, unknown>).evidence;
    const expEvRaw: unknown = (expC as Record<string, unknown>).evidence;
    if (!Array.isArray(baseEv) || !Array.isArray(candEv) || !Array.isArray(expEvRaw)) {
      continue;
    }
    const expEv: unknown[] = expEvRaw as unknown[];
    for (let j = 0; j < baseEv.length; j++) {
      if (j >= candEv.length) {
        continue;
      }
      const expE: unknown = expEv[j];
      const candE: unknown = (candEv as unknown[])[j];
      if (!isPlainObject(expE) || !isPlainObject(candE)) {
        continue;
      }
      if (authorized.has(`/concepts/${i}/evidence/${j}/quote`)) {
        (expE as Record<string, unknown>).quote = (candE as Record<string, unknown>).quote;
      }
      if (authorized.has(`/concepts/${i}/evidence/${j}/sourceId`)) {
        (expE as Record<string, unknown>).sourceId = (candE as Record<string, unknown>).sourceId;
      }
    }
    if (authorized.has(`/concepts/${i}/evidence`) && (candEv as unknown[]).length >= baseEv.length) {
      const tail: unknown[] = structuredClone((candEv as unknown[]).slice(baseEv.length));
      expEv.length = baseEv.length;
      for (const v of tail) {
        expEv.push(v);
      }
    }
    (expC as Record<string, unknown>).evidence = expEv;
  }
  if (authorized.has('/concepts') && candCons.length >= baseCons.length) {
    const tail: unknown[] = structuredClone(candCons.slice(baseCons.length) as unknown[]);
    expCons.length = baseCons.length;
    for (const v of tail) {
      expCons.push(v);
    }
  }
  expected.concepts = expCons;
  const known = new Set<string>(['supported', 'activity', 'unsupportedReason', 'concepts', 'objectives']);
  const candRec = candidate as unknown as Record<string, unknown>;
  for (const p of authorized) {
    if (!p.startsWith('/')) {
      continue;
    }
    const rest: string = p.slice(1);
    if (rest === '' || rest.includes('/')) {
      continue;
    }
    if (known.has(rest)) {
      continue;
    }
    const inBaseline: boolean = Object.prototype.hasOwnProperty.call(baseline, rest);
    const inCandidate: boolean = Object.prototype.hasOwnProperty.call(candRec, rest);
    if (!inBaseline && inCandidate) {
      expected[rest] = candRec[rest];
    }
  }
  return expected;
}

function checkAnalysisUnchanged(
  baselineAnalysis: unknown,
  nextAnalysis: SourceAnalysis,
  source: SourceDocument,
): ValidationCheck {
  const id = 'repair.analysis-unchanged';
  const kind = 'semantic' as const;
  const auth = baselineAuthorization(baselineAnalysis, source);
  const authSet = new Set<string>(auth.authorized);
  if (!isBaselineShapeValid(baselineAnalysis)) {
    let diffs: string[] = [];
    try {
      if (isPlainObject(baselineAnalysis)) {
        diffs = diffJsonPointers(baselineAnalysis, nextAnalysis as unknown);
      }
    } catch {
      diffs = [];
    }
    const first: string = diffs[0] ?? '/';
    const listed: string = diffs.slice(0, 10).join(', ') || first;
    return {
      id,
      kind,
      passed: false,
      message: `baseline analysis shape unrecognized; cannot compare safely; differences: ${listed}`,
      path: first,
    };
  }
  const baselineRec = baselineAnalysis as Record<string, unknown>;
  const expected: Record<string, unknown> = buildExpectedAnalysis(baselineRec, nextAnalysis, authSet);
  let diffs: string[];
  try {
    diffs = diffJsonPointers(expected, nextAnalysis as unknown);
  } catch {
    return { id, kind, passed: false, message: 'analysis comparison failed; refusing repair', path: '/' };
  }
  if (diffs.length === 0) {
    let changed: string[];
    try {
      changed = diffJsonPointers(baselineAnalysis, nextAnalysis as unknown);
    } catch {
      changed = [];
    }
    const idsText: string = auth.failingIds.join(', ');
    const authSuffix: string =
      idsText === '' ? '(authorized by baseline findings none)' : `(authorized by baseline findings ${idsText})`;
    if (changed.length === 0) {
      return { id, kind, passed: true, message: `no field changed ${authSuffix}` };
    }
    const shown: string = changed.slice(0, 20).join(', ');
    const suffix: string = changed.length > 20 ? ` (+${changed.length - 20} more)` : '';
    return { id, kind, passed: true, message: `changed only authorized fields: ${shown}${suffix} ${authSuffix}` };
  }
  const shown: string = diffs.slice(0, 20).join(', ');
  const suffix: string = diffs.length > 20 ? ` (+${diffs.length - 20} more)` : '';
  return {
    id,
    kind,
    passed: false,
    message: `repair changed unauthorized fields: ${shown}${suffix}`,
    path: diffs[0],
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
  const { authorized: authorizedPaths } = baselineAuthorization(baselineAnalysis, source);
  const maxOutputTokens: number = opts?.maxOutputTokens ?? 6000;
  const req: CompleteRequest = {
    purpose,
    schemaName: 'source_analysis_repair',
    jsonSchema: sourceAnalysisGenSchema,
    messages: previous.baseline === undefined
      ? buildAnalysisRepairMessages(source, previous.analysis, findings, undefined, authorizedPaths)
      : buildAnalysisRepairMessages(source, previous.analysis, findings, baselineAnalysis, authorizedPaths),
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
  const unchanged: ValidationCheck = checkAnalysisUnchanged(baselineAnalysis, result.data, source);
  const checks: ValidationCheck[] = [...base.checks, unchanged];
  const report: ValidationReport = {
    artifactId: base.artifactId,
    revision: previous.attempt + 1,
    checks,
    publishable: checks.every((c) => c.passed),
  };
  return { analysis: result.data, report, receipt: result.receipt };
}
