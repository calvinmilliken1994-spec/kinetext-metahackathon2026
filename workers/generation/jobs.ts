// TASK-005 — bounded generation worker: ingest → analyze → specify → validate → done.
//
// One job per call of startJob(). The stage machine persists everything under
// `${storageDir}/runs/<jobId>/`:
//   job.json        — JobSummary, written synchronously at start ('running') and rewritten at the end
//   events.jsonl    — one StageEvent per line, appended as stages progress (seq 0..n per job)
//   analysis.json   — {analysis, report, receipt} from analyzeSource
//   spec.r1.json    — the assembled ActivitySpec from generateSpec (revision 1)
//   report.r1.json  — the ValidationReport for spec.r1
//
// Failure policy: `done` never rejects. Every failure (missing source, MetaError,
// unpublishable analysis, failed spec validation, unexpected crash) becomes a
// terminal JobSummary with status 'failed' (or 'unsupported' for an honest
// not-supported-yet analysis) plus an error {code, message}. Spend is accounted
// from receipts only: totalCostUSD is the sum of receipt estCostUSD values,
// including the receipt attached to a MetaError when one is present.

import { appendFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { analyzeSource, generateSpec } from '../../packages/meta/pipeline.ts';
import { MetaError } from '../../packages/meta/client.ts';
import type { MetaClient } from '../../packages/meta/client.ts';
import { loadSource } from '../../packages/sources/index.ts';
import type {
  MetaReceipt,
  SourceAnalysis,
  SourceDocument,
  Stage,
  StageEvent,
  StageStatus,
  ValidationReport,
} from '../../packages/contracts/index.ts';

export type JobStatus = 'running' | 'succeeded' | 'unsupported' | 'failed';

export interface JobSummary {
  jobId: string;
  sourceId: string;
  status: JobStatus;
  purpose: 'test-live' | 'demo';
  createdAt: string;
  finishedAt?: string;
  specId?: string;
  publishable?: boolean;
  checksPassed?: number;
  checksTotal?: number;
  totalCostUSD: number;
  error?: { code: string; message: string };
}

export interface JobDeps {
  client: MetaClient;
  storageDir: string;
  purpose: 'test-live' | 'demo';
  sourcesDir?: URL;
  now?: () => Date;
  newJobId?: () => string;
}

const SOURCE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const JOB_ID_PATTERN = /^[a-z0-9-]{1,80}$/;

type EventExtra = Partial<
  Pick<StageEvent, 'model' | 'responseId' | 'usage' | 'latencyMs' | 'estCostUSD' | 'detail'>
>;

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Money stays readable in job.json: sum of receipt costs, rounded to 1e-6 USD. */
function roundCost(usd: number): number {
  return Math.round(usd * 1e6) / 1e6;
}

function receiptFields(receipt: MetaReceipt): EventExtra {
  return {
    model: receipt.returnedModel,
    responseId: receipt.responseId,
    usage: receipt.usage,
    latencyMs: receipt.latencyMs,
    estCostUSD: receipt.estCostUSD,
  };
}

function checksPassed(report: ValidationReport): number {
  return report.checks.filter(c => c.passed).length;
}

function failedCheckIds(report: ValidationReport): string[] {
  return report.checks.filter(c => !c.passed).map(c => c.id);
}

function readJsonFile(path: string): unknown | undefined {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch {
    return undefined;
  }
}

export function startJob(
  sourceId: string,
  deps: JobDeps,
  onEvent?: (e: StageEvent) => void,
): { jobId: string; done: Promise<JobSummary> } {
  if (!SOURCE_ID_PATTERN.test(sourceId)) {
    throw new Error('SOURCE_ID_INVALID');
  }
  const now: () => Date = deps.now ?? ((): Date => new Date());
  const jobId: string =
    deps.newJobId?.() ??
    `job-${now()
      .toISOString()
      .replace(/[^0-9]/g, '')
      .slice(0, 14)}-${randomUUID().slice(0, 8)}`;
  const runDir: string = join(deps.storageDir, 'runs', jobId);
  mkdirSync(runDir, { recursive: true });

  const summary: JobSummary = {
    jobId,
    sourceId,
    status: 'running',
    purpose: deps.purpose,
    createdAt: now().toISOString(),
    totalCostUSD: 0,
  };
  writeFileSync(join(runDir, 'job.json'), JSON.stringify(summary, null, 2));

  const done: Promise<JobSummary> = runJob(sourceId, jobId, runDir, deps, summary, now, onEvent).catch(
    (err: unknown): JobSummary => {
      // Last resort: runJob already finalises on expected failures, so reaching here
      // means persistence itself broke. Still never reject.
      summary.status = 'failed';
      summary.error = { code: 'INTERNAL', message: errMsg(err) };
      return summary;
    },
  );
  return { jobId, done };
}

async function runJob(
  sourceId: string,
  jobId: string,
  runDir: string,
  deps: JobDeps,
  summary: JobSummary,
  now: () => Date,
  onEvent?: (e: StageEvent) => void,
): Promise<JobSummary> {
  let seq = 0;
  let totalCostUSD = 0;

  function emit(stage: Stage, status: StageStatus, extra?: EventExtra): StageEvent {
    const event: StageEvent = { jobId, seq, stage, status, at: now().toISOString(), ...extra };
    seq += 1;
    appendFileSync(join(runDir, 'events.jsonl'), `${JSON.stringify(event)}\n`);
    if (onEvent !== undefined) {
      try {
        onEvent(event);
      } catch {
        // A broken subscriber must not fail the job; the event is already persisted.
      }
    }
    return event;
  }

  function writeJob(): void {
    writeFileSync(join(runDir, 'job.json'), JSON.stringify(summary, null, 2));
  }

  function finish(status: JobStatus): JobSummary {
    summary.status = status;
    summary.finishedAt = now().toISOString();
    summary.totalCostUSD = roundCost(totalCostUSD);
    writeJob();
    return summary;
  }

  function fail(stage: Stage, code: string, message: string, extra?: EventExtra): JobSummary {
    emit(stage, 'failed', extra);
    summary.error = { code, message };
    return finish('failed');
  }

  function failFromError(stage: Stage, err: unknown): JobSummary {
    if (err instanceof MetaError) {
      const extra: EventExtra = { detail: `${err.code}: ${err.message}` };
      if (err.receipt !== undefined) {
        // A MetaError can carry a receipt for a call that was billed before it failed.
        totalCostUSD += err.receipt.estCostUSD;
        Object.assign(extra, receiptFields(err.receipt));
      }
      return fail(stage, err.code, err.message, extra);
    }
    return fail(stage, 'INTERNAL', errMsg(err), { detail: errMsg(err) });
  }

  // --- ingest -------------------------------------------------------------
  emit('ingest', 'started');
  let source: SourceDocument;
  try {
    source = loadSource(sourceId, deps.sourcesDir);
  } catch (err: unknown) {
    const message = errMsg(err);
    return fail('ingest', 'SOURCE_UNAVAILABLE', message, { detail: message });
  }
  emit('ingest', 'succeeded', { detail: `sha256 ${source.sha256.slice(0, 12)}` });

  // --- analyze --------------------------------------------------------------
  emit('analyze', 'started');
  let analysis: SourceAnalysis;
  let analysisReport: ValidationReport;
  let analysisReceipt: MetaReceipt;
  try {
    const result = await analyzeSource(deps.client, source, deps.purpose);
    analysis = result.analysis;
    analysisReport = result.report;
    analysisReceipt = result.receipt;
  } catch (err: unknown) {
    return failFromError('analyze', err);
  }
  totalCostUSD += analysisReceipt.estCostUSD;
  writeFileSync(
    join(runDir, 'analysis.json'),
    JSON.stringify({ analysis, report: analysisReport, receipt: analysisReceipt }, null, 2),
  );
  const analysisDetail = `${
    analysis.supported ? 'supported' : `unsupported: ${analysis.unsupportedReason}`
  }; checks ${checksPassed(analysisReport)}/${analysisReport.checks.length} passed`;
  if (!analysisReport.publishable) {
    return fail('analyze', 'ANALYSIS_INVALID', 'analysis report is not publishable', {
      ...receiptFields(analysisReceipt),
      detail: analysisDetail,
    });
  }
  emit('analyze', 'succeeded', { ...receiptFields(analysisReceipt), detail: analysisDetail });
  if (!analysis.supported) {
    emit('done', 'succeeded', { detail: 'unsupported' });
    return finish('unsupported');
  }

  // --- specify --------------------------------------------------------------
  emit('specify', 'started');
  const specId = `${sourceId}-${jobId}`.slice(0, 64);
  let specResult: Awaited<ReturnType<typeof generateSpec>>;
  try {
    specResult = await generateSpec(
      deps.client,
      source,
      analysis,
      { jobId, specId },
      deps.purpose,
      now,
    );
  } catch (err: unknown) {
    return failFromError('specify', err);
  }
  totalCostUSD += specResult.receipt.estCostUSD;
  writeFileSync(join(runDir, 'spec.r1.json'), JSON.stringify(specResult.spec, null, 2));
  emit('specify', 'succeeded', {
    ...receiptFields(specResult.receipt),
    detail: `spec ${specId}`,
  });

  // --- validate -------------------------------------------------------------
  emit('validate', 'started');
  const report = specResult.report;
  writeFileSync(join(runDir, 'report.r1.json'), JSON.stringify(report, null, 2));
  const passed = checksPassed(report);
  const total = report.checks.length;
  const validateDetail = `${passed}/${total} checks passed`;
  if (!report.publishable) {
    const ids = failedCheckIds(report);
    return fail('validate', 'VALIDATION_FAILED', `${validateDetail}; failed checks: ${ids.join(', ')}`, {
      detail: `${validateDetail}; failed checks: ${ids.join(', ')}`,
    });
  }
  emit('validate', 'succeeded', { detail: validateDetail });

  // --- done -----------------------------------------------------------------
  emit('done', 'succeeded', { detail: 'publishable' });
  summary.specId = specId;
  summary.publishable = true;
  summary.checksPassed = passed;
  summary.checksTotal = total;
  return finish('succeeded');
}

export function listJobs(storageDir: string): JobSummary[] {
  let entries;
  try {
    entries = readdirSync(join(storageDir, 'runs'), { withFileTypes: true });
  } catch {
    return [];
  }
  const jobs: JobSummary[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const parsed = readJsonFile(join(storageDir, 'runs', entry.name, 'job.json'));
    if (parsed === undefined || typeof parsed !== 'object' || parsed === null) {
      continue; // skip unreadable or incomplete run dirs
    }
    const candidate = parsed as { jobId?: unknown };
    if (typeof candidate.jobId !== 'string') {
      continue;
    }
    jobs.push(parsed as JobSummary);
  }
  jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt)); // newest first
  return jobs;
}

export function readJob(
  storageDir: string,
  jobId: string,
): { summary: JobSummary; events: StageEvent[]; analysis?: unknown; spec?: unknown; report?: unknown } | null {
  if (!JOB_ID_PATTERN.test(jobId)) {
    throw new Error('JOB_ID_INVALID');
  }
  const runDir = join(storageDir, 'runs', jobId);
  const summary = readJsonFile(join(runDir, 'job.json'));
  if (summary === undefined || typeof summary !== 'object' || summary === null) {
    return null;
  }
  const events: StageEvent[] = [];
  try {
    const text = readFileSync(join(runDir, 'events.jsonl'), 'utf8');
    for (const line of text.split('\n')) {
      if (line.trim() === '') {
        continue;
      }
      try {
        events.push(JSON.parse(line) as StageEvent);
      } catch {
        // skip a malformed line; the rest of the stream stays readable
      }
    }
  } catch {
    // no events file (yet)
  }
  const result: { summary: JobSummary; events: StageEvent[]; analysis?: unknown; spec?: unknown; report?: unknown } = {
    summary: summary as JobSummary,
    events,
  };
  const analysis = readJsonFile(join(runDir, 'analysis.json'));
  if (analysis !== undefined) {
    result.analysis = analysis;
  }
  const spec = readJsonFile(join(runDir, 'spec.r1.json'));
  if (spec !== undefined) {
    result.spec = spec;
  }
  const report = readJsonFile(join(runDir, 'report.r1.json'));
  if (report !== undefined) {
    result.report = report;
  }
  return result;
}
