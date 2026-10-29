// Thin typed client for the local API (apps/api/server.ts). The browser never calls a model:
// it only reads stored results and asks the server to start a job.

import type { CreatedSource } from './lib/sources.ts';
import type { AnyActivitySpec } from './lib/timeline.ts';
import type { AnalysisRepairRecord } from './lib/analysisRepairs.ts';
import { parseModels } from './lib/models.ts';
import type { ModelId, ModelOption } from './lib/models.ts';
import type { ActivityId, DemoFault, FaultRecord, MetaReceipt, RepairRecord, SourceAnalysis, StageEvent, UserSourceInput, ValidationReport } from '../../../packages/contracts/index.ts';

export type JobStatus = 'running' | 'succeeded' | 'unsupported' | 'failed';

export interface Health {
  ok: boolean; live: boolean; /** The server is running a job right now (absent on older servers). */ busy?: boolean;
  /** OW-2: which models can be used right now (booleans only). Absent on older servers. */
  models?: Partial<Record<ModelId, boolean>>;
}

export interface SourceMeta {
  id: string; title: string; locator: string; license: string; attribution: string; sha256: string; purpose: string;
  /** Stage 5: 'user' = a teacher's pasted text. Absent on older servers (treated as library). */
  kind?: 'library' | 'user';
  /** Readable licence of a teacher source ('CC BY 4.0'). */
  licenseLabel?: string;
  createdAt?: string;
}
export interface SourceDoc extends SourceMeta { text: string; page?: number }

export interface JobSummary {
  jobId: string; sourceId: string; status: JobStatus; purpose: string; createdAt: string; finishedAt?: string;
  specId?: string; publishable?: boolean; checksPassed?: number; checksTotal?: number; totalCostUSD: number;
  /** Part of totalCostUSD charged at a reservation (outcome uncertain). Absent on jobs recorded before the fix = 0. */
  reservedUnknownUSD?: number;
  error?: { code: string; message: string };
  /** Stage 5 fields — all absent on runs recorded before Stage 5. */
  engine?: ActivityId | null;
  revisions?: number;
  repairs?: RepairRecord[];
  /** TASK-024b: one record per ANALYSIS repair attempt (Muse repaired its own first analysis). Absent on older runs. */
  analysisRepairs?: AnalysisRepairRecord[];
  publishedRevision?: number;
  bestRevision?: number;
  demoFault?: FaultRecord;
  sourceKind?: 'library' | 'user';
  /** OW-2: which model made the job. Servers normalise legacy jobs; the UI still treats absent as Muse Spark 1.3 / Meta API. */
  model?: string;
  provider?: string;
  /** The exact model string sent to the provider (e.g. meta-models/Muse-Spark-Open-816B-A42B). */
  providerModel?: string;
}

/** One stored revision of the activity spec and its validation report (Stage 5). */
export interface JobRevision { revision: number; spec: AnyActivitySpec; report?: ValidationReport }

/** One stored revision of the source analysis (only present when an analysis repair ran). */
export interface JobAnalysisRevision { revision: number; analysis: SourceAnalysis; report?: ValidationReport; receipt?: MetaReceipt }

export interface JobDetail {
  summary: JobSummary;
  events: StageEvent[];
  analysis?: { analysis: SourceAnalysis; report: ValidationReport; receipt: MetaReceipt };
  /** The published (else best, else latest) revision's spec / report. */
  spec?: AnyActivitySpec;
  report?: ValidationReport;
  /** Absent on older servers; the UI then treats spec/report as the only revision. */
  revisions?: JobRevision[];
  /** TASK-024b: revision 1 = Muse's first analysis, then each repair. Empty / absent when the analysis was never repaired. */
  analysisRevisions?: JobAnalysisRevision[];
}

export class ApiError extends Error {
  status: number;
  code: string;
  /** Problem codes of a 400 SOURCE_INVALID answer. */
  problems: string[];
  constructor(status: number, code: string, problems: string[] = []) {
    super(code);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.problems = problems;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new ApiError(0, 'NETWORK');
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const code = typeof body === 'object' && body !== null && typeof (body as { error?: unknown }).error === 'string'
      ? (body as { error: string }).error
      : `HTTP_${res.status}`;
    const rawProblems = typeof body === 'object' && body !== null ? (body as { problems?: unknown }).problems : undefined;
    const problems = Array.isArray(rawProblems) ? rawProblems.filter((p): p is string => typeof p === 'string') : [];
    throw new ApiError(res.status, code, problems);
  }
  return body as T;
}

export const api = {
  health: (signal?: AbortSignal) => request<Health>('/api/health', { signal }),
  sources: (signal?: AbortSignal) => request<SourceMeta[]>('/api/sources', { signal }),
  source: (id: string, signal?: AbortSignal) => request<SourceDoc>(`/api/sources/${encodeURIComponent(id)}`, { signal }),
  /** The picker list. Parsed defensively: anything unexpected becomes an empty list (picker hidden). */
  models: async (signal?: AbortSignal): Promise<ModelOption[]> => parseModels(await request<unknown>('/api/models', { signal })),
  jobs: (signal?: AbortSignal) => request<JobSummary[]>('/api/jobs', { signal }),
  job: (id: string, signal?: AbortSignal) => request<JobDetail>(`/api/jobs/${encodeURIComponent(id)}`, { signal }),
  /** `demoFault` asks the SYSTEM to inject a labelled fault into revision 1 (a demonstration, not a model error). */
  createJob: (sourceId: string, demoFault?: DemoFault, model?: ModelId) =>
    request<{ jobId: string }>('/api/jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sourceId, ...(demoFault === undefined ? {} : { demoFault }), ...(model === undefined ? {} : { model }) }),
    }),
  /** Store a teacher-pasted text. 201 = created, 200 = the same text was stored before. */
  createSource: (input: UserSourceInput) =>
    request<CreatedSource>('/api/sources', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    }),
};

const MESSAGES: Record<string, string> = {
  NETWORK: 'Cannot reach the API. Is it running on port 8787?',
  LIVE_DISABLED: 'Live generation is switched off on this server.',
  JOB_RUNNING: 'A generation job is already running. Wait for it to finish.',
  SOURCE_NOT_FOUND: 'That source is not in the registry.',
  NOT_FOUND: 'Not found.',
  SOURCE_UNAVAILABLE: 'The source could not be loaded (its hash did not verify).',
  JOB_START_FAILED: 'The server could not start the job.',
  HOST_NOT_ALLOWED: 'The API refused this host. Open the app at http://127.0.0.1:5173.',
  ORIGIN_NOT_ALLOWED: 'The API refused this origin. Open the app at http://127.0.0.1:5173.',
  SOURCE_INVALID: 'The server rejected the text. See the problems listed below.',
  SOURCE_LIMIT: 'The server already stores the maximum number of teacher sources.',
  PAYLOAD_TOO_LARGE: 'The request was too large for the server.',
  UNSUPPORTED_MEDIA_TYPE: 'The server refused the request format.',
  BAD_REQUEST: 'The server did not understand the request.',
  MODEL_INVALID: 'The server did not recognise that model. Pick one from the list.',
  INTERNAL: 'The server hit an unexpected error.',
};

export function describeError(e: unknown): string {
  if (e instanceof ApiError) return MESSAGES[e.code] ?? `Request failed (${e.code}).`;
  return 'Unexpected error.';
}
