// Thin typed client for the local API (apps/api/server.ts). The browser never calls a model:
// it only reads stored results and asks the server to start a job.

import type { CreatedSource } from './lib/sources.ts';
import type { ActivitySpec, DemoFault, EngineId, FaultRecord, MetaReceipt, RepairRecord, SourceAnalysis, StageEvent, UserSourceInput, ValidationReport } from '../../../packages/contracts/index.ts';

export type JobStatus = 'running' | 'succeeded' | 'unsupported' | 'failed';

export interface Health { ok: boolean; live: boolean; /** The server is running a job right now (absent on older servers). */ busy?: boolean }

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
  engine?: EngineId | null;
  revisions?: number;
  repairs?: RepairRecord[];
  publishedRevision?: number;
  bestRevision?: number;
  demoFault?: FaultRecord;
  sourceKind?: 'library' | 'user';
}

/** One stored revision of the activity spec and its validation report (Stage 5). */
export interface JobRevision { revision: number; spec: ActivitySpec; report?: ValidationReport }

export interface JobDetail {
  summary: JobSummary;
  events: StageEvent[];
  analysis?: { analysis: SourceAnalysis; report: ValidationReport; receipt: MetaReceipt };
  /** The published (else best, else latest) revision's spec / report. */
  spec?: ActivitySpec;
  report?: ValidationReport;
  /** Absent on older servers; the UI then treats spec/report as the only revision. */
  revisions?: JobRevision[];
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
  jobs: (signal?: AbortSignal) => request<JobSummary[]>('/api/jobs', { signal }),
  job: (id: string, signal?: AbortSignal) => request<JobDetail>(`/api/jobs/${encodeURIComponent(id)}`, { signal }),
  /** `demoFault` asks the SYSTEM to inject a labelled fault into revision 1 (a demonstration, not a model error). */
  createJob: (sourceId: string, demoFault?: DemoFault) =>
    request<{ jobId: string }>('/api/jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(demoFault === undefined ? { sourceId } : { sourceId, demoFault }),
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
  INTERNAL: 'The server hit an unexpected error.',
};

export function describeError(e: unknown): string {
  if (e instanceof ApiError) return MESSAGES[e.code] ?? `Request failed (${e.code}).`;
  return 'Unexpected error.';
}
