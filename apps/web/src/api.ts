// Thin typed client for the local API (apps/api/server.ts). The browser never calls a model:
// it only reads stored results and asks the server to start a job.

import type { ActivitySpec, MetaReceipt, SourceAnalysis, StageEvent, ValidationReport } from '../../../packages/contracts/index.ts';

export type JobStatus = 'running' | 'succeeded' | 'unsupported' | 'failed';

export interface Health { ok: boolean; live: boolean }

export interface SourceMeta {
  id: string; title: string; locator: string; license: string; attribution: string; sha256: string; purpose: string;
}
export interface SourceDoc extends SourceMeta { text: string; page?: number }

export interface JobSummary {
  jobId: string; sourceId: string; status: JobStatus; purpose: string; createdAt: string; finishedAt?: string;
  specId?: string; publishable?: boolean; checksPassed?: number; checksTotal?: number; totalCostUSD: number;
  error?: { code: string; message: string };
}

export interface JobDetail {
  summary: JobSummary;
  events: StageEvent[];
  analysis?: { analysis: SourceAnalysis; report: ValidationReport; receipt: MetaReceipt };
  spec?: ActivitySpec;
  report?: ValidationReport;
}

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) {
    super(code);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
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
    throw new ApiError(res.status, code);
  }
  return body as T;
}

export const api = {
  health: (signal?: AbortSignal) => request<Health>('/api/health', { signal }),
  sources: (signal?: AbortSignal) => request<SourceMeta[]>('/api/sources', { signal }),
  source: (id: string, signal?: AbortSignal) => request<SourceDoc>(`/api/sources/${encodeURIComponent(id)}`, { signal }),
  jobs: (signal?: AbortSignal) => request<JobSummary[]>('/api/jobs', { signal }),
  job: (id: string, signal?: AbortSignal) => request<JobDetail>(`/api/jobs/${encodeURIComponent(id)}`, { signal }),
  createJob: (sourceId: string) =>
    request<{ jobId: string }>('/api/jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sourceId }),
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
};

export function describeError(e: unknown): string {
  if (e instanceof ApiError) return MESSAGES[e.code] ?? `Request failed (${e.code}).`;
  return 'Unexpected error.';
}
