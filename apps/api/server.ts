// TASK-005 — zero-framework HTTP API over the generation worker and run storage.
//
// JSON only. Every response carries content-type application/json; charset=utf-8,
// x-content-type-options: nosniff and cache-control: no-store. Responses never
// contain stack traces or error internals — failures map to fixed error codes.
// Nothing is logged here (the server must never echo request bodies).
//
// Routes:
//   GET  /api/health      → {ok, live, busy, running, maxConcurrentJobs, models} — models is a
//                           per-ModelChoice availability map (booleans only); running is the
//                           in-process live-job count and busy stays running >= limit (R-10
//                           compatibility)
//   GET  /api/models      → [{id, label, provider, available}] for the web model picker (OW-2)
//   GET  /api/sources     → metadata list (no text), library + teacher ('user') sources with kind;
//                           Stage 7b: subject + subjectSource ('curated' for library pages, 'muse' for
//                           teacher pages = the latest lesson analysis' subject; absent when unknown)
//   POST /api/sources     → store a teacher-pasted source (JSON ≤ 64 KB); 201 created / 200 existing
//   GET  /api/sources/:id → metadata + hash-checked text (library and user sources)
//   GET  /api/jobs        → newest-first job summaries
//   GET  /api/jobs/:id    → {summary, events, revisions, analysis?, spec?, report?}
//   POST /api/jobs        → 202 {jobId}; body {sourceId, demoFault?, model?, flow?}; at most
//                           `maxConcurrentJobs` live jobs at a time (409 JOB_RUNNING while
//                           that many are running — the pre-concurrency single-job gate is
//                           the option default 1; the product config default is 3).
//                           model (OW-2) is optional and
//                           defaults to 'muse-spark-1.3'; anything outside the two ModelChoice
//                           values is a 400 MODEL_INVALID. flow (S6-W) defaults to 'lesson'
//                           (the Stage 6 pipeline); 'activity' runs the unchanged v1 pipeline;
//                           anything else is a 400 FLOW_INVALID.
//
// Authorization (TASK-009 R-07): every request must carry an allowed Host
// (127.0.0.1:<bound port>, localhost:<bound port>, or an allowedHosts entry —
// by default the Vite dev proxy hosts); POST routes additionally require
// an Origin of http:// + an allowed host when the header is present. Anything
// else is 403 before routing. (A per-session token is deferred technical debt.)

import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import {
  listSourceIds,
  listUserSourceIds,
  loadSource,
  loadSourceMeta,
  loadUserSource,
  loadUserSourceMeta,
  MAX_USER_SOURCES,
  saveUserSource,
  sourceSubject,
  userSourceId,
  userSourcesDirOf,
  USER_SOURCE_ID_PATTERN,
} from '../../packages/sources/index.ts';
import { DEMO_FAULTS, validateUserSourceInput } from '../../packages/contracts/index.ts';
import type { DemoFault } from '../../packages/contracts/index.ts';
import { isModelChoice } from '../../packages/meta/pricing.ts';
import type { ModelChoice } from '../../packages/meta/pricing.ts';
import { DEFAULT_MODEL, MODEL_INFO } from './model-clients.ts';
import { MAX_CONCURRENT_JOBS_BOUND } from './resource-limits.ts';
import { listJobs, readJob } from '../../workers/generation/jobs.ts';
import { museSubjectsBySource } from './source-subjects.ts';
import type { Subject } from '../../packages/contracts/kit.ts';
import type { JobFlow, JobSummary } from '../../workers/generation/jobs.ts';

export interface ApiOptions {
  storageDir: string;
  sourcesDir?: URL;
  /** Teacher-source store; defaults to `<storageDir>/user-sources`. */
  userSourcesDir?: string;
  /** null disables live generation: POST /api/jobs then answers 503 LIVE_DISABLED. */
  startJob:
    | ((
        sourceId: string,
        opts?: { demoFault?: DemoFault; model?: ModelChoice; flow?: JobFlow },
      ) => { jobId: string; done: Promise<JobSummary> })
    | null;
  /** Extra allowed Host values (and http://<value> Origins); replaces the Vite defaults. */
  allowedHosts?: string[];
  /**
   * Concurrency (BUG-006 wave, part B): how many live jobs this server runs at once.
   * Must be an integer in [1, MAX_CONCURRENT_JOBS_BOUND] (fail closed at construction);
   * the OPTION default is 1 — the pre-concurrency single-job gate every direct embedder
   * (e2e harness) has always had. The product default is 3, wired by main.ts from the
   * validated config/resource-limits.json `maxConcurrentJobs` field. Each job keeps its
   * own abort/wall-time budget and its own cost accumulator (workers/generation/jobs.ts);
   * the shared spending ledger serialises its synchronous reserve/reconcile writes and
   * holds every outstanding reservation against the stage cap.
   */
  maxConcurrentJobs?: number;
  /**
   * OW-2: which ModelChoice values this server can actually run right now —
   * reported as BOOLEANS ONLY by GET /api/health and GET /api/models (never why,
   * never any credential state). A function is re-evaluated per request, so a
   * token appearing in the environment is reflected without a restart. Default:
   * 'muse-spark-1.3' when a startJob function exists, nothing otherwise.
   */
  availableModels?: readonly ModelChoice[] | (() => readonly ModelChoice[]);
}

const MAX_BODY_BYTES = 10 * 1024;
/** Teacher-pasted source bodies may be larger than job bodies, but stay bounded (Stage 5). */
const MAX_SOURCE_BODY_BYTES = 64 * 1024;
const DEFAULT_ALLOWED_HOSTS: readonly string[] = ['127.0.0.1:5173', 'localhost:5173'];

interface SourceRefResponse {
  id: string;
  title: string;
  locator: string;
  license: string;
  attribution: string;
  sha256: string;
  purpose: string;
  kind: 'library' | 'user';
  licenseLabel?: string;
  createdAt?: string;
  /** Stage 7b: library pages carry their curated subject; teacher pages the latest Muse-detected one (when any). */
  subject?: Subject;
  subjectSource?: 'curated' | 'muse';
}

/** The subject fields for a response: present only when a subject is known. */
function subjectFields(subject: Subject | undefined, from: 'curated' | 'muse'): Pick<SourceRefResponse, 'subject' | 'subjectSource'> {
  return subject === undefined ? {} : { subject, subjectSource: from };
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
  /**
   * Guards runaway spend: at most `maxConcurrentJobs` live jobs between start and
   * settlement (concurrency, part B). The OPTION default is 1 — the pre-concurrency
   * single-job gate; main.ts wires the validated config value (product default 3).
   * Fail closed on an invalid option value.
   */
  const maxConcurrentJobs: number = opts.maxConcurrentJobs === undefined ? 1 : opts.maxConcurrentJobs;
  if (
    !Number.isInteger(maxConcurrentJobs) ||
    (maxConcurrentJobs as number) < 1 ||
    (maxConcurrentJobs as number) > MAX_CONCURRENT_JOBS_BOUND
  ) {
    throw new Error('MAX_CONCURRENT_JOBS_INVALID');
  }
  const inFlight: Set<Promise<JobSummary>> = new Set();
  const allowedHosts: readonly string[] = opts.allowedHosts ?? DEFAULT_ALLOWED_HOSTS;

  /** Stage 5: teacher-source store (defaults to `<storageDir>/user-sources`). */
  function userSourcesDir(): string {
    return opts.userSourcesDir ?? userSourcesDirOf(opts.storageDir);
  }

  /**
   * OW-2: per-model availability as BOOLEANS ONLY — the health/models routes
   * must never leak why a model is unavailable (that could reveal credential
   * state). Re-evaluated per request when given as a function.
   */
  function modelAvailability(): Record<ModelChoice, boolean> {
    const configured =
      typeof opts.availableModels === 'function' ? opts.availableModels() : opts.availableModels;
    const list: readonly ModelChoice[] =
      configured ?? (opts.startJob !== null ? [DEFAULT_MODEL] : []);
    const available = new Set<ModelChoice>(list.filter(isModelChoice));
    return {
      'muse-spark-1.3': available.has('muse-spark-1.3'),
      'muse-spark-open': available.has('muse-spark-open'),
    };
  }

  /** R-07: POST routes require an Origin of http:// + an allowed host when present. */
  function originAllowed(req: IncomingMessage): boolean {
    const origin = req.headers.origin;
    if (typeof origin !== 'string') {
      return true;
    }
    const prefix = 'http://';
    return origin.startsWith(prefix) && hostAllowed(origin.slice(prefix.length));
  }

  /** R-07: the allowed Host values, including this server's actual bound port. */
  function hostAllowed(rawHost: string): boolean {
    const host = rawHost.toLowerCase();
    const address = server.address();
    if (address !== null && typeof address === 'object') {
      if (host === `127.0.0.1:${address.port}` || host === `localhost:${address.port}`) {
        return true;
      }
    }
    return allowedHosts.some(allowed => allowed.toLowerCase() === host);
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = req.method ?? 'GET';
    const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;

    // R-07: Host allowlist on EVERY request, before any routing.
    if (!hostAllowed(req.headers.host ?? '')) {
      return sendError(res, 403, 'HOST_NOT_ALLOWED');
    }

    if (pathname === '/api/health') {
      if (method !== 'GET') {
        return sendError(res, 405, 'METHOD_NOT_ALLOWED');
      }
      // busy (R-10): kept for compatibility as running >= maxConcurrentJobs.
      // running / maxConcurrentJobs (concurrency, part B): the live-job count and its limit.
      // models (OW-2): which ModelChoice values are available — booleans only.
      return sendJson(res, 200, {
        ok: true,
        live: opts.startJob !== null,
        busy: inFlight.size >= maxConcurrentJobs,
        running: inFlight.size,
        maxConcurrentJobs,
        models: modelAvailability(),
      });
    }

    if (pathname === '/api/models') {
      if (method !== 'GET') {
        return sendError(res, 405, 'METHOD_NOT_ALLOWED');
      }
      // OW-2: the picker list for the web app — fixed labels, provider mapping
      // and the same availability booleans as /api/health. Nothing else.
      const availability = modelAvailability();
      return sendJson(
        res,
        200,
        MODEL_INFO.map(info => ({
          id: info.id,
          label: info.label,
          provider: info.provider,
          available: availability[info.id],
        })),
      );
    }

    if (pathname === '/api/sources') {
      if (method === 'GET') {
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
              kind: 'library',
              ...subjectFields(sourceSubject(meta), 'curated'),
            });
          } catch {
            // skip an unreadable registry entry rather than failing the whole list
          }
        }
        // Stage 5: teacher-pasted sources join the list (never their text).
        const userIds = listUserSourceIds(userSourcesDir());
        // Stage 7b: their subject is the one Muse detected in the latest lesson analysis of that page (if any).
        const museSubjects = museSubjectsBySource(opts.storageDir, new Set(userIds));
        for (const id of userIds) {
          try {
            const meta = loadUserSourceMeta(id, userSourcesDir());
            out.push({
              id: meta.id,
              title: meta.title,
              locator: meta.locator,
              license: meta.license,
              attribution: meta.attribution,
              sha256: meta.sha256,
              purpose: 'teacher-provided',
              kind: 'user',
              licenseLabel: meta.licenseLabel,
              createdAt: meta.createdAt,
              ...subjectFields(museSubjects.get(id), 'muse'),
            });
          } catch {
            // skip an unreadable user entry rather than failing the whole list
          }
        }
        return sendJson(res, 200, out);
      }
      if (method === 'POST') {
        return handleCreateSource(req, res);
      }
      return sendError(res, 405, 'METHOD_NOT_ALLOWED');
    }

    if (pathname.startsWith('/api/sources/')) {
      const id = decodeURIComponent(pathname.slice('/api/sources/'.length));
      if (id === '' || id.includes('/')) {
        return sendError(res, 404, 'NOT_FOUND');
      }
      if (method !== 'GET') {
        return sendError(res, 405, 'METHOD_NOT_ALLOWED');
      }
      // Stage 5: teacher sources live in their own store but answer the same shape.
      if (USER_SOURCE_ID_PATTERN.test(id)) {
        try {
          const meta = loadUserSourceMeta(id, userSourcesDir());
          const doc = loadUserSource(id, userSourcesDir()); // hash-checked
          const userBody: SourceRefResponse & { text: string } = {
            id: doc.id,
            title: doc.title,
            locator: doc.locator,
            license: doc.license,
            attribution: doc.attribution,
            sha256: doc.sha256,
            purpose: 'teacher-provided',
            kind: 'user',
            licenseLabel: meta.licenseLabel,
            createdAt: meta.createdAt,
            ...subjectFields(museSubjectsBySource(opts.storageDir, new Set([id])).get(id), 'muse'),
            text: doc.text,
          };
          return sendJson(res, 200, userBody);
        } catch (err: unknown) {
          if (isNotFound(err)) {
            return sendError(res, 404, 'NOT_FOUND');
          }
          return sendError(res, 500, 'SOURCE_UNAVAILABLE'); // e.g. sha256 mismatch (tampered text)
        }
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
          kind: 'library',
          ...subjectFields(sourceSubject(meta), 'curated'),
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

  async function handleCreateSource(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // R-07: same Origin protection as every other POST route.
    if (!originAllowed(req)) {
      return sendError(res, 403, 'ORIGIN_NOT_ALLOWED');
    }
    const contentType = (req.headers['content-type'] ?? '').toLowerCase();
    if (!contentType.startsWith('application/json')) {
      return sendError(res, 415, 'UNSUPPORTED_MEDIA_TYPE');
    }
    let rawBody: string;
    try {
      rawBody = await readBodyLimited(req, MAX_SOURCE_BODY_BYTES);
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
    // Contracts own the limits/normalisation: title/text/attribution lengths,
    // licence id, rights confirmation, CRLF→LF + control-char strip + trim.
    const validated = validateUserSourceInput(parsed);
    if (!validated.ok) {
      return sendJson(res, 400, { error: 'SOURCE_INVALID', problems: validated.problems });
    }
    const dir = userSourcesDir();
    // Idempotent: identical (normalised) text maps to the same id — 200, even at the limit.
    const prospectiveId = userSourceId(validated.value.text);
    const existingIds = listUserSourceIds(dir);
    if (!existingIds.includes(prospectiveId) && existingIds.length >= MAX_USER_SOURCES) {
      return sendError(res, 409, 'SOURCE_LIMIT');
    }
    try {
      const { id, created } = saveUserSource(validated.value, dir);
      // S5-07: answer with the STORED metadata — a duplicate-text POST returns
      // the original source's title/licence/attribution with reused: true, never
      // the newly submitted values (which were not saved).
      const meta = loadUserSourceMeta(id, dir);
      return sendJson(res, created ? 201 : 200, {
        id,
        title: meta.title,
        kind: 'user',
        licenseLabel: meta.licenseLabel,
        attribution: meta.attribution,
        reused: !created,
      });
    } catch {
      // Fixed, content-free 500; never expose fs internals.
      return sendError(res, 500, 'INTERNAL');
    }
  }

  async function handleCreateJob(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // R-07: a browser Origin, when present, must be http:// + an allowed host.
    if (!originAllowed(req)) {
      return sendError(res, 403, 'ORIGIN_NOT_ALLOWED');
    }
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
    // Stage 5: optional labelled demo fault; anything outside DEMO_FAULTS is a 400.
    let demoFault: DemoFault | undefined;
    if ('demoFault' in (parsed as Record<string, unknown>)) {
      const rawFault: unknown = (parsed as Record<string, unknown>)['demoFault'];
      if (typeof rawFault !== 'string' || !(DEMO_FAULTS as readonly string[]).includes(rawFault)) {
        return sendError(res, 400, 'BAD_REQUEST');
      }
      demoFault = rawFault as DemoFault;
    }
    // OW-2: optional model choice; the default is muse-spark-1.3 and ANY other
    // value is a 400 with the fixed MODEL_INVALID code (no reflected input, no
    // provider text). There is no fallback between providers — the choice is
    // explicit per job.
    let model: ModelChoice = DEFAULT_MODEL;
    if ('model' in (parsed as Record<string, unknown>)) {
      const rawModel: unknown = (parsed as Record<string, unknown>)['model'];
      if (!isModelChoice(rawModel)) {
        return sendError(res, 400, 'MODEL_INVALID');
      }
      model = rawModel;
    }
    // S6-W (frozen lesson-flow contract): the optional flow choice. 'lesson' (the Stage 6
    // flow) is the PRODUCT DEFAULT; 'activity' runs the unchanged v1 pipeline (kept for the
    // pre-registered evaluation and comparisons). Anything else is a 400 with the fixed
    // FLOW_INVALID code (no reflected input).
    let flow: JobFlow = 'lesson';
    if ('flow' in (parsed as Record<string, unknown>)) {
      const rawFlow: unknown = (parsed as Record<string, unknown>)['flow'];
      if (rawFlow !== 'lesson' && rawFlow !== 'activity') {
        return sendError(res, 400, 'FLOW_INVALID');
      }
      flow = rawFlow;
    }
    let knownIds: string[] = [];
    try {
      knownIds = listSourceIds(opts.sourcesDir);
    } catch {
      knownIds = [];
    }
    // Teacher sources are first-class job inputs (Stage 5).
    knownIds = [...knownIds, ...listUserSourceIds(userSourcesDir())];
    if (!knownIds.includes(sourceId)) {
      return sendError(res, 404, 'SOURCE_NOT_FOUND');
    }
    if (inFlight.size >= maxConcurrentJobs) {
      // Concurrency (part B): the busy 409 only fires when the configured number of jobs
      // is already running — same error code/shape as the pre-concurrency single-job gate.
      return sendError(res, 409, 'JOB_RUNNING');
    }
    let started: { jobId: string; done: Promise<JobSummary> };
    try {
      // OW-2: the model always travels with the job (defaulted above), so the
      // server-side startJob builds the right client per job. S6-W: the flow
      // (defaulted to 'lesson') travels with it too.
      started = start(sourceId, {
        ...(demoFault !== undefined ? { demoFault } : {}),
        model,
        flow,
      });
    } catch {
      return sendError(res, 500, 'JOB_START_FAILED');
    }
    const donePromise = started.done;
    inFlight.add(donePromise);
    const clear = (): void => {
      inFlight.delete(donePromise);
    };
    void donePromise.then(clear, clear);
    return sendJson(res, 202, { jobId: started.jobId });
  }

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    handle(req, res).catch(() => {
      // Fixed, content-free 500; never expose internals.
      if (!res.headersSent) {
        sendError(res, 500, 'INTERNAL');
      } else {
        res.end();
      }
    });
  });
  return server;
}
