// TASK-005 — zero-framework HTTP API over the generation worker and run storage.
//
// JSON only. Every response carries content-type application/json; charset=utf-8,
// x-content-type-options: nosniff and cache-control: no-store. Responses never
// contain stack traces or error internals — failures map to fixed error codes.
// Nothing is logged here (the server must never echo request bodies).
//
// Routes:
//   GET  /api/health      → {ok, live}
//   GET  /api/sources     → metadata list (no text)
//   GET  /api/sources/:id → metadata + hash-checked text
//   GET  /api/jobs        → newest-first job summaries
//   GET  /api/jobs/:id    → {summary, events, analysis?, spec?, report?}
//   POST /api/jobs        → 202 {jobId}; one live job at a time (409 while running)

import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { listSourceIds, loadSource, loadSourceMeta } from '../../packages/sources/index.ts';
import { listJobs, readJob } from '../../workers/generation/jobs.ts';
import type { JobSummary } from '../../workers/generation/jobs.ts';

export interface ApiOptions {
  storageDir: string;
  sourcesDir?: URL;
  /** null disables live generation: POST /api/jobs then answers 503 LIVE_DISABLED. */
  startJob: ((sourceId: string) => { jobId: string; done: Promise<JobSummary> }) | null;
}

const MAX_BODY_BYTES = 10 * 1024;

interface SourceRefResponse {
  id: string;
  title: string;
  locator: string;
  license: string;
  attribution: string;
  sha256: string;
  purpose: string;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function sendError(res: ServerResponse, status: number, code: string): void {
  sendJson(res, status, { error: code });
}

function isNotFound(err: unknown): boolean {
  if (err instanceof Error) {
    if (err.message === 'SOURCE_ID_INVALID' || err.message === 'JOB_ID_INVALID') {
      return true;
    }
    const code = (err as NodeJS.ErrnoException).code;
    return code === 'ENOENT' || code === 'ENOTDIR' || code === 'EINVAL' || code === 'ERR_INVALID_URL';
  }
  return false;
}

/** Read the request body, refusing anything over the limit. Drains (never destroys)
 *  an oversized stream so the 413 response still reaches the client cleanly. */
function readBodyLimited(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > limit) {
      reject(new Error('PAYLOAD_TOO_LARGE'));
      req.resume();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let rejected = false;
    req.on('data', (chunk: Buffer) => {
      if (rejected) {
        return; // draining
      }
      size += chunk.length;
      if (size > limit) {
        rejected = true;
        reject(new Error('PAYLOAD_TOO_LARGE'));
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!rejected) {
        resolve(Buffer.concat(chunks).toString('utf8'));
      }
    });
    req.on('error', () => {
      if (!rejected) {
        rejected = true;
        reject(new Error('BODY_READ_ERROR'));
      }
    });
  });
}

export function createApiServer(opts: ApiOptions): Server {
  /** Guards runaway spend: at most one live job between start and settlement. */
  let inFlight: Promise<JobSummary> | null = null;

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = req.method ?? 'GET';
    const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;

    if (pathname === '/api/health') {
      if (method !== 'GET') {
        return sendError(res, 405, 'METHOD_NOT_ALLOWED');
      }
      return sendJson(res, 200, { ok: true, live: opts.startJob !== null });
    }

    if (pathname === '/api/sources') {
      if (method !== 'GET') {
        return sendError(res, 405, 'METHOD_NOT_ALLOWED');
      }
      const out: SourceRefResponse[] = [];
      let ids: string[] = [];
      try {
        ids = listSourceIds(opts.sourcesDir);
      } catch {
        ids = [];
      }
      for (const id of ids) {
        try {
          const meta = loadSourceMeta(id, opts.sourcesDir);
          out.push({
            id: meta.id,
            title: meta.title,
            locator: meta.locator,
            license: meta.license,
            attribution: meta.attribution,
            sha256: meta.sha256,
            purpose: meta.purpose,
          });
        } catch {
          // skip an unreadable registry entry rather than failing the whole list
        }
      }
      return sendJson(res, 200, out);
    }

    if (pathname.startsWith('/api/sources/')) {
      const id = decodeURIComponent(pathname.slice('/api/sources/'.length));
      if (id === '' || id.includes('/')) {
        return sendError(res, 404, 'NOT_FOUND');
      }
      if (method !== 'GET') {
        return sendError(res, 405, 'METHOD_NOT_ALLOWED');
      }
      try {
        const meta = loadSourceMeta(id, opts.sourcesDir);
        const doc = loadSource(id, opts.sourcesDir); // hash-checked
        const body: SourceRefResponse & { page?: number; text: string } = {
          id: doc.id,
          title: doc.title,
          locator: doc.locator,
          license: doc.license,
          attribution: doc.attribution,
          sha256: doc.sha256,
          purpose: meta.purpose,
          text: doc.text,
        };
        if (doc.page !== undefined) {
          body.page = doc.page;
        }
        return sendJson(res, 200, body);
      } catch (err: unknown) {
        if (isNotFound(err)) {
          return sendError(res, 404, 'NOT_FOUND');
        }
        return sendError(res, 500, 'SOURCE_UNAVAILABLE'); // e.g. sha256 mismatch
      }
    }

    if (pathname === '/api/jobs') {
      if (method === 'GET') {
        return sendJson(res, 200, listJobs(opts.storageDir));
      }
      if (method === 'POST') {
        return handleCreateJob(req, res);
      }
      return sendError(res, 405, 'METHOD_NOT_ALLOWED');
    }

    if (pathname.startsWith('/api/jobs/')) {
      const id = decodeURIComponent(pathname.slice('/api/jobs/'.length));
      if (id === '' || id.includes('/')) {
        return sendError(res, 404, 'NOT_FOUND');
      }
      if (method !== 'GET') {
        return sendError(res, 405, 'METHOD_NOT_ALLOWED');
      }
      try {
        const job = readJob(opts.storageDir, id);
        if (job === null) {
          return sendError(res, 404, 'NOT_FOUND');
        }
        return sendJson(res, 200, job);
      } catch {
        return sendError(res, 404, 'NOT_FOUND'); // JOB_ID_INVALID or unreadable run
      }
    }

    return sendError(res, 404, 'NOT_FOUND');
  }

  async function handleCreateJob(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const start = opts.startJob;
    if (start === null) {
      return sendError(res, 503, 'LIVE_DISABLED');
    }
    const contentType = (req.headers['content-type'] ?? '').toLowerCase();
    if (!contentType.startsWith('application/json')) {
      return sendError(res, 415, 'UNSUPPORTED_MEDIA_TYPE');
    }
    let rawBody: string;
    try {
      rawBody = await readBodyLimited(req, MAX_BODY_BYTES);
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE') {
        return sendError(res, 413, 'PAYLOAD_TOO_LARGE');
      }
      return sendError(res, 400, 'BAD_REQUEST');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody) as unknown;
    } catch {
      return sendError(res, 400, 'BAD_REQUEST');
    }
    if (typeof parsed !== 'object' || parsed === null) {
      return sendError(res, 400, 'BAD_REQUEST');
    }
    const sourceId: unknown = (parsed as Record<string, unknown>)['sourceId'];
    if (typeof sourceId !== 'string' || sourceId === '') {
      return sendError(res, 400, 'BAD_REQUEST');
    }
    let knownIds: string[] = [];
    try {
      knownIds = listSourceIds(opts.sourcesDir);
    } catch {
      knownIds = [];
    }
    if (!knownIds.includes(sourceId)) {
      return sendError(res, 404, 'SOURCE_NOT_FOUND');
    }
    if (inFlight !== null) {
      return sendError(res, 409, 'JOB_RUNNING');
    }
    let started: { jobId: string; done: Promise<JobSummary> };
    try {
      started = start(sourceId);
    } catch {
      return sendError(res, 500, 'JOB_START_FAILED');
    }
    const donePromise = started.done;
    inFlight = donePromise;
    const clear = (): void => {
      if (inFlight === donePromise) {
        inFlight = null;
      }
    };
    void donePromise.then(clear, clear);
    return sendJson(res, 202, { jobId: started.jobId });
  }

  return createServer((req: IncomingMessage, res: ServerResponse) => {
    handle(req, res).catch(() => {
      // Fixed, content-free 500; never expose internals.
      if (!res.headersSent) {
        sendError(res, 500, 'INTERNAL');
      } else {
        res.end();
      }
    });
  });
}
