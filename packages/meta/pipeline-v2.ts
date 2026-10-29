// Stage 6 v2 pipeline (S6-M): analysis v2, per-component generation, repairs.
// Pattern decision: like v1 (packages/meta/pipeline.ts), every function returns
// the model output plus its receipt and, where a checker is available, a
// ValidationReport. Unlike v1, the Stage 6 checkers live in packages/validation
// and are being written concurrently, so this module imports NOTHING from
// packages/validation; the caller INJECTS the checker functions (typed against
// the contracts' ValidationReport / ValidationCheck). Analysis and component
// generation take an OPTIONAL validator (no report without it); repairs REQUIRE
// a validator, because repair authorization must be recomputed from revision 1.
import { isDeepStrictEqual } from 'node:util';
import { Ajv } from 'ajv';
import type { AnySchemaObject, ValidateFunction } from 'ajv';
import type { MetaReceipt, RepairFinding, SourceDocument, ValidationCheck, ValidationReport } from '../contracts/index.ts';
import type { ComponentPlanEntry, KitGenByComponent, KitGenComponentId, SourceAnalysisV2 } from '../contracts/kit.ts';
import { isKitGenComponentId } from '../contracts/kit.ts';
import { kitGenSchemaFor, sourceAnalysisV2GenSchema } from '../contracts/schemas.ts';
import {
  ANALYSIS_V2_REPAIR_SCHEMA_NAME,
  ANALYSIS_V2_SCHEMA_NAME,
  KIT_REPAIR_SCHEMA_NAMES,
  KIT_SCHEMA_NAMES,
  buildAnalysisV2Messages,
  buildAnalysisV2RepairMessages,
  buildKitComponentMessages,
  buildKitComponentRepairMessages
} from './prompts-v2.ts';
import { GeneratedOutputError } from './pipeline.ts';
import type { CompleteRequest, MetaClient } from './client.ts';

export const ANALYSIS_V2_MAX_OUTPUT_TOKENS: 16000 = 16000;
export const KIT_CALL_MAX_OUTPUT_TOKENS: 12000 = 12000;

export type V2Purpose = 'test-live' | 'demo';
export type V2Validator<T> = (value: T, sources: SourceDocument[]) => ValidationReport;
export type V2RevisionComparator<T> = (baseline: T, candidate: T, sources: SourceDocument[]) => ValidationCheck;

export interface V2CallOptions {
  signal?: AbortSignal;
  maxOutputTokens?: number;
}

export type V2GeneratedOutputStage = 'analyze-v2' | 'component' | 'component-repair' | 'analysis-v2-repair';

const V1_STAGE_FOR_V2: Readonly<Record<V2GeneratedOutputStage, 'analyze' | 'specify' | 'repair' | 'analysis-repair'>> = {
  'analyze-v2': 'analyze',
  'component': 'specify',
  'component-repair': 'repair',
  'analysis-v2-repair': 'analysis-repair'
};

export class GeneratedOutputErrorV2 extends GeneratedOutputError {
  readonly v2Stage: V2GeneratedOutputStage;
  constructor(v2Stage: V2GeneratedOutputStage, receipt: MetaReceipt) {
    super(V1_STAGE_FOR_V2[v2Stage], receipt);
    this.name = 'GeneratedOutputError';
    this.v2Stage = v2Stage;
  }
}

const ajv: Ajv = new Ajv({ allErrors: true, strict: false });
const validateAnalysisV2Gen: ValidateFunction = ajv.compile(
  sourceAnalysisV2GenSchema as unknown as AnySchemaObject
);

const kitValidators = new Map<KitGenComponentId, ValidateFunction>();
function kitValidatorFor(componentId: KitGenComponentId): ValidateFunction {
  let v: ValidateFunction | undefined = kitValidators.get(componentId);
  if (v === undefined) {
    v = ajv.compile(kitGenSchemaFor(componentId) as unknown as AnySchemaObject);
    kitValidators.set(componentId, v);
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

function resolveMaxTokens(requested: number | undefined, cap: number): number {
  if (requested === undefined) {
    return cap;
  }
  if (!Number.isInteger(requested) || (requested as number) < 1 || (requested as number) > cap) {
    throw new Error('MAX_OUTPUT_TOKENS_INVALID');
  }
  return requested as number;
}

function requireKitPlan(analysis: SourceAnalysisV2, planEntry: ComponentPlanEntry): KitGenComponentId {
  if (analysis.usable !== true) {
    throw new Error('ANALYSIS_DECLINED');
  }
  const cid: unknown = (planEntry as ComponentPlanEntry).componentId;
  if (!isKitGenComponentId(cid)) {
    throw new Error('KIT_COMPONENT_REQUIRED');
  }
  const plan: unknown = (analysis as SourceAnalysisV2).componentPlan;
  let found: boolean = false;
  if (Array.isArray(plan)) {
    for (const entry of plan as unknown[]) {
      if (isDeepStrictEqual(entry, planEntry)) {
        found = true;
        break;
      }
    }
  }
  if (!found) {
    throw new Error('PLAN_ENTRY_NOT_IN_ANALYSIS');
  }
  return cid;
}

function requireRepairAttempt(attempt: unknown): void {
  if (!Number.isInteger(attempt) || (attempt !== 1 && attempt !== 2)) {
    throw new Error('REPAIR_ATTEMPT_INVALID');
  }
}

function requireFailingReport(report: ValidationReport): void {
  const raw: unknown = (report as unknown as { checks?: unknown } | null | undefined)?.checks;
  if (!Array.isArray(raw)) {
    throw new Error('NOTHING_TO_REPAIR');
  }
  let hasFailing: boolean = false;
  for (const item of raw as unknown[]) {
    if (typeof item === 'object' && item !== null && !(item as ValidationCheck).passed) {
      hasFailing = true;
      break;
    }
  }
  if (!hasFailing) {
    throw new Error('NOTHING_TO_REPAIR');
  }
}

function findingsFromReport(report: ValidationReport): RepairFinding[] {
  const raw: unknown = (report as unknown as { checks?: unknown } | null | undefined)?.checks;
  const out: RepairFinding[] = [];
  if (!Array.isArray(raw)) {
    return out;
  }
  for (const item of raw as unknown[]) {
    if (typeof item !== 'object' || item === null) {
      continue;
    }
    const c = item as ValidationCheck;
    if (c.passed) {
      continue;
    }
    const f: RepairFinding = { id: c.id, kind: c.kind, message: c.message };
    if (c.path !== undefined) {
      f.path = c.path;
    }
    if ((c as { affected?: unknown }).affected !== undefined) {
      f.affected = structuredClone((c as { affected?: string[] }).affected);
    }
    out.push(f);
  }
  return out;
}

function authorizedFromReport(report: unknown): string[] {
  const raw: unknown = (report as unknown as { checks?: unknown } | null | undefined)?.checks;
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw as unknown[]) {
    if (typeof item !== 'object' || item === null) {
      continue;
    }
    const c = item as ValidationCheck;
    if (c.passed) {
      continue;
    }
    if (typeof c.id === 'string' && c.id.startsWith('repair.')) {
      continue;
    }
    if (!Array.isArray(c.affected)) {
      continue;
    }
    for (const p of c.affected as unknown[]) {
      if (typeof p === 'string' && p !== '' && !seen.has(p)) {
        seen.add(p);
        out.push(p);
      }
    }
  }
  return out;
}

function computeAuthorizedPaths<T>(validate: V2Validator<T>, baseline: T, source: SourceDocument): string[] {
  let rep: ValidationReport;
  try {
    rep = validate(structuredClone(baseline), [source]);
  } catch {
    return [];
  }
  return authorizedFromReport(rep);
}

export async function analyzeSourceV2(
  client: MetaClient,
  source: SourceDocument,
  purpose: V2Purpose,
  opts?: V2CallOptions & { validate?: V2Validator<SourceAnalysisV2> }
): Promise<{ analysis: SourceAnalysisV2; report?: ValidationReport; receipt: MetaReceipt }> {
  const maxOutputTokens: number = resolveMaxTokens(opts?.maxOutputTokens, ANALYSIS_V2_MAX_OUTPUT_TOKENS);
  const req: CompleteRequest = {
    purpose,
    schemaName: ANALYSIS_V2_SCHEMA_NAME,
    jsonSchema: sourceAnalysisV2GenSchema as unknown as Record<string, unknown>,
    messages: buildAnalysisV2Messages(source),
    maxOutputTokens
  };
  if (opts?.signal !== undefined) {
    req.signal = opts.signal;
  }
  const result = await client.complete<SourceAnalysisV2>(req);
  const raw: unknown = result.data;
  if (!isPlainObject(raw) || !validateAnalysisV2Gen(raw)) {
    throw new GeneratedOutputErrorV2('analyze-v2', result.receipt);
  }
  if (opts?.validate === undefined) {
    return { analysis: result.data, receipt: result.receipt };
  }
  let report: ValidationReport;
  try {
    report = opts.validate(structuredClone(result.data), [source]);
  } catch {
    throw new GeneratedOutputErrorV2('analyze-v2', result.receipt);
  }
  return { analysis: result.data, report, receipt: result.receipt };
}

export async function generateKitComponent<C extends KitGenComponentId>(
  client: MetaClient,
  source: SourceDocument,
  analysis: SourceAnalysisV2,
  planEntry: ComponentPlanEntry & { componentId: C },
  purpose: V2Purpose,
  opts?: V2CallOptions & { validate?: V2Validator<KitGenByComponent[C]> }
): Promise<{ gen: KitGenByComponent[C]; report?: ValidationReport; receipt: MetaReceipt }> {
  const maxOutputTokens: number = resolveMaxTokens(opts?.maxOutputTokens, KIT_CALL_MAX_OUTPUT_TOKENS);
  const c: KitGenComponentId = requireKitPlan(analysis, planEntry);
  const req: CompleteRequest = {
    purpose,
    schemaName: KIT_SCHEMA_NAMES[c],
    jsonSchema: kitGenSchemaFor(c) as unknown as Record<string, unknown>,
    messages: buildKitComponentMessages(source, analysis, planEntry),
    maxOutputTokens
  };
  if (opts?.signal !== undefined) {
    req.signal = opts.signal;
  }
  const result = await client.complete<KitGenByComponent[C]>(req);
  const raw: unknown = result.data;
  if (!isPlainObject(raw) || !kitValidatorFor(c)(raw) || (raw as Record<string, unknown>)['schemaVersion'] !== c) {
    throw new GeneratedOutputErrorV2('component', result.receipt);
  }
  if (opts?.validate === undefined) {
    return { gen: result.data, receipt: result.receipt };
  }
  let report: ValidationReport;
  try {
    report = opts.validate(structuredClone(result.data), [source]);
  } catch {
    throw new GeneratedOutputErrorV2('component', result.receipt);
  }
  return { gen: result.data, report, receipt: result.receipt };
}

export async function repairKitComponent<C extends KitGenComponentId>(
  client: MetaClient,
  source: SourceDocument,
  analysis: SourceAnalysisV2,
  planEntry: ComponentPlanEntry & { componentId: C },
  previous: { gen: KitGenByComponent[C]; report: ValidationReport; attempt: number; baseline?: { gen: KitGenByComponent[C] } },
  purpose: V2Purpose,
  opts: V2CallOptions & { validate: V2Validator<KitGenByComponent[C]>; compare?: V2RevisionComparator<KitGenByComponent[C]> }
): Promise<{ gen: KitGenByComponent[C]; report: ValidationReport; receipt: MetaReceipt; authorizedPaths: string[] }> {
  const maxOutputTokens: number = resolveMaxTokens(opts.maxOutputTokens, KIT_CALL_MAX_OUTPUT_TOKENS);
  const c: KitGenComponentId = requireKitPlan(analysis, planEntry);
  requireRepairAttempt(previous.attempt);
  if (previous.attempt === 2 && previous.baseline === undefined) {
    throw new Error('REPAIR_BASELINE_REQUIRED');
  }
  requireFailingReport(previous.report);
  const prevSv: unknown = (previous.gen as unknown as Record<string, unknown>)?.['schemaVersion'];
  if (prevSv !== (planEntry as ComponentPlanEntry).componentId) {
    throw new Error('COMPONENT_MISMATCH');
  }
  if (previous.baseline !== undefined) {
    const baseSv: unknown = (previous.baseline.gen as unknown as Record<string, unknown>)?.['schemaVersion'];
    if (baseSv !== (planEntry as ComponentPlanEntry).componentId) {
      throw new Error('COMPONENT_MISMATCH');
    }
  }
  const baseline: KitGenByComponent[C] = previous.baseline?.gen ?? previous.gen;
  const authorizedPaths: string[] = computeAuthorizedPaths(opts.validate, baseline, source);
  const findings: RepairFinding[] = findingsFromReport(previous.report);
  const req: CompleteRequest = {
    purpose,
    schemaName: KIT_REPAIR_SCHEMA_NAMES[c],
    jsonSchema: kitGenSchemaFor(c) as unknown as Record<string, unknown>,
    messages: buildKitComponentRepairMessages(source, analysis, planEntry, {
      original: baseline,
      previous: previous.gen,
      findings,
      authorizedPaths
    }),
    maxOutputTokens
  };
  if (opts.signal !== undefined) {
    req.signal = opts.signal;
  }
  const result = await client.complete<KitGenByComponent[C]>(req);
  const raw: unknown = result.data;
  if (!isPlainObject(raw) || !kitValidatorFor(c)(raw) || (raw as Record<string, unknown>)['schemaVersion'] !== c) {
    throw new GeneratedOutputErrorV2('component-repair', result.receipt);
  }
  let base: ValidationReport;
  try {
    base = opts.validate(structuredClone(result.data), [source]);
  } catch {
    throw new GeneratedOutputErrorV2('component-repair', result.receipt);
  }
  const baseChecksRaw: unknown = (base as unknown as { checks?: unknown } | null | undefined)?.checks;
  if (!Array.isArray(baseChecksRaw)) {
    throw new GeneratedOutputErrorV2('component-repair', result.receipt);
  }
  const checks: ValidationCheck[] = [...(baseChecksRaw as ValidationCheck[])];
  if (opts.compare !== undefined) {
    let cmp: ValidationCheck;
    try {
      cmp = opts.compare(structuredClone(baseline), structuredClone(result.data), [source]);
    } catch {
      throw new GeneratedOutputErrorV2('component-repair', result.receipt);
    }
    checks.push(cmp);
  }
  const report: ValidationReport = {
    artifactId: base.artifactId,
    revision: previous.attempt + 1,
    checks,
    publishable: checks.every((ch) => ch.passed)
  };
  return { gen: result.data, report, receipt: result.receipt, authorizedPaths };
}

export async function repairAnalysisV2(
  client: MetaClient,
  source: SourceDocument,
  previous: { analysis: SourceAnalysisV2; report: ValidationReport; attempt: number; baseline?: { analysis: SourceAnalysisV2 } },
  purpose: V2Purpose,
  opts: V2CallOptions & { validate: V2Validator<SourceAnalysisV2>; compare?: V2RevisionComparator<SourceAnalysisV2> }
): Promise<{ analysis: SourceAnalysisV2; report: ValidationReport; receipt: MetaReceipt; authorizedPaths: string[] }> {
  const maxOutputTokens: number = resolveMaxTokens(opts.maxOutputTokens, KIT_CALL_MAX_OUTPUT_TOKENS);
  requireRepairAttempt(previous.attempt);
  if (previous.attempt === 2 && previous.baseline === undefined) {
    throw new Error('REPAIR_BASELINE_REQUIRED');
  }
  requireFailingReport(previous.report);
  const baseline: SourceAnalysisV2 = previous.baseline?.analysis ?? previous.analysis;
  const authorizedPaths: string[] = computeAuthorizedPaths(opts.validate, baseline, source);
  const findings: RepairFinding[] = findingsFromReport(previous.report);
  const req: CompleteRequest = {
    purpose,
    schemaName: ANALYSIS_V2_REPAIR_SCHEMA_NAME,
    jsonSchema: sourceAnalysisV2GenSchema as unknown as Record<string, unknown>,
    messages: buildAnalysisV2RepairMessages(source, {
      original: baseline,
      previous: previous.analysis,
      findings,
      authorizedPaths
    }),
    maxOutputTokens
  };
  if (opts.signal !== undefined) {
    req.signal = opts.signal;
  }
  const result = await client.complete<SourceAnalysisV2>(req);
  const raw: unknown = result.data;
  if (!isPlainObject(raw) || !validateAnalysisV2Gen(raw)) {
    throw new GeneratedOutputErrorV2('analysis-v2-repair', result.receipt);
  }
  let base: ValidationReport;
  try {
    base = opts.validate(structuredClone(result.data), [source]);
  } catch {
    throw new GeneratedOutputErrorV2('analysis-v2-repair', result.receipt);
  }
  const baseChecksRaw: unknown = (base as unknown as { checks?: unknown } | null | undefined)?.checks;
  if (!Array.isArray(baseChecksRaw)) {
    throw new GeneratedOutputErrorV2('analysis-v2-repair', result.receipt);
  }
  const checks: ValidationCheck[] = [...(baseChecksRaw as ValidationCheck[])];
  if (opts.compare !== undefined) {
    let cmp: ValidationCheck;
    try {
      cmp = opts.compare(structuredClone(baseline), structuredClone(result.data), [source]);
    } catch {
      throw new GeneratedOutputErrorV2('analysis-v2-repair', result.receipt);
    }
    checks.push(cmp);
  }
  const report: ValidationReport = {
    artifactId: base.artifactId,
    revision: previous.attempt + 1,
    checks,
    publishable: checks.every((ch) => ch.passed)
  };
  return { analysis: result.data, report, receipt: result.receipt, authorizedPaths };
}
