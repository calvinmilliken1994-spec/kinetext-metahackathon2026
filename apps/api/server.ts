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
//   GET  /api/sources     → metadata list (no text), library + teacher ('user') sources with kind (retired library pages left out unless ?include=retired);
//                           Stage 7b: subject + subjectSource ('curated' for library pages, 'muse' for
//                           teacher pages = the latest lesson analysis' subject; absent when unknown)
//   POST /api/sources     → store a teacher-pasted source (JSON ≤ 64 KB); 201 created / 200 existing
//   GET  /api/sources/:id → metadata + hash-checked text (library and user sources)
//   GET  /api/jobs        → newest-first job summaries
//   GET  /api/jobs/:id    → {summary, events, revisions, analysis?, spec?, report?}
//   GET  /api/figures/:id → Stage 8b: the figure's FigureMeta sidecar JSON (404 unknown id)
//   GET  /api/figures/:id/image → Stage 8b: the figure's EXACT stored bytes (never re-encoded),
//                           Content-Type from the sidecar mime, long public cache, ETag = the
//                           recorded sha256 (If-None-Match answers 304). Ids must be bare
//                           store ids (/^[a-z0-9-]{1,80}$/); nothing outside data/figures is
//                           ever served.
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
//   POST /api/jobs/:id/review -> Stage 10b slice R, teacher review and publish (apps/api/review.ts): body
//                           {action:'publish', checkedParts, hiddenParts} or {action:'unpublish'}; the same Origin
//                           check and judge-access gate as the other POSTs (403 ACCESS_REQUIRED); free, so the judge
//                           budget does not apply. 409 NOT_REVIEWABLE unless the job is a succeeded lesson; 400
//                           BAD_REQUEST / REVIEW_INCOMPLETE / NOTHING_TO_PUBLISH; 200 {review: record | null}. The review is
//                           `<storageDir>/runs/<id>/review.json`; GET /api/jobs/:id adds `review` when it exists and
//                           GET /api/jobs marks published lessons with `reviewPublishedAt`.
//
//   GET/POST/DELETE /api/access -> Stage 10 slice A, judge access (apps/api/access.ts): GET reports
//                           {gate, granted, capUSD, spentUSD, remainingUSD, buildsEnabled}; POST {code}
//                           starts a signed HttpOnly session (401 ACCESS_CODE_INVALID, 429
//                           TOO_MANY_ATTEMPTS); DELETE ends it. With `access.code` set (the gate),
//                           POST /api/jobs and POST /api/sources need a session (403 ACCESS_REQUIRED)
//                           and POST /api/jobs also answers 503 BUILDS_PAUSED (kill switch) and 402
//                           JUDGE_BUDGET_REACHED; its jobs start with access: 'judge'. Gate off (the
//                           default) leaves every existing route exactly as it was.
//
// Authorization (TASK-009 R-07): every request must carry an allowed Host
// (127.0.0.1:<bound port>, localhost:<bound port>, or an allowedHosts entry —
// by default the Vite dev proxy hosts); POST routes additionally require
// an Origin of http:// + an allowed host when the header is present. Anything
// else is 403 before routing. (A per-session token is deferred technical debt.)

import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import {
  isFeatured,
  isRetired,
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
import { loadFigure } from '../../packages/sources/figures.ts';
import type { FigureMeta } from '../../packages/sources/figures.ts';
import { DEMO_FAULTS, validateUserSourceInput } from '../../packages/contracts/index.ts';
import type { DemoFault } from '../../packages/contracts/index.ts';
import { isModelChoice } from '../../packages/meta/pricing.ts';
import type { ModelChoice } from '../../packages/meta/pricing.ts';
import { DEFAULT_MODEL, MODEL_INFO } from './model-clients.ts';
import { MAX_CONCURRENT_JOBS_BOUND } from './resource-limits.ts';
import { createAccessControl } from './access.ts';
import { deleteReview, MAX_REVIEW_BODY_BYTES, publishedPartIds, readReview, validatePublishBody, writeReview } from './review.ts';
import type { AccessControl, AccessOptions } from './access.ts';
import { listJobs, readJob } from '../../workers/generation/jobs.ts';
import { applyContentHolds, componentHistory, enrichLabelBoxes, orderLabelParts, recheckLesson } from './recheck.ts';
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
        opts?: { demoFault?: DemoFault; model?: ModelChoice; flow?: JobFlow; access?: 'judge' },
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
  /**
   * Stage 10 slice A: judge access. Absent, or with an empty `code`, the gate is OFF and every
   * existing route behaves exactly as before (GET/POST/DELETE /api/access still exist and report
   * gate: false). See apps/api/access.ts for the options and the spend rule.
   */
  access?: AccessOptions;
  /** Stage 10b: the clock that stamps `publishedAt` (tests pin it). Default: the system clock. */
  now?: () => Date;
}

const MAX_BODY_BYTES = 10 * 1024;
/** Teacher-pasted source bodies may be larger than job bodies, but stay bounded (Stage 5). */
const MAX_SOURCE_BODY_BYTES = 64 * 1024;
/** Stage 10: POST /api/access carries only a short code. */
const MAX_ACCESS_BODY_BYTES = 1024;
const DEFAULT_ALLOWED_HOSTS: readonly string[] = ['127.0.0.1:5173', 'localhost:5173'];

/** Stage 8b: a bare figure-store id — never a path, never dots, bounded length. */
const FIGURE_ID_PATTERN = /^[a-z0-9-]{1,80}$/;
/** Stage 8b: only real image mimes are served as bytes (a tampered sidecar never becomes HTML). */
const FIGURE_IMAGE_MIME = /^image\/(jpeg|png|gif|webp)$/;
/** Stage 8b: the licensed figure store is immutable (exact bytes, sha256-pinned) — cache long. */
const FIGURE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

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
  /** Stage 7e: library pages shown first in the picker for their subject. */
  featured?: true;
  /** Stage 7e: on GET /api/sources/:id and GET /api/sources?include=retired — a retired page leaves the default list. */
  retired?: true;
}

/** Stage 7e: the featured/retired flags of a library page, present only when set. */
function libraryFlags(meta: { featured?: unknown; retired?: unknown }): Pick<SourceRefResponse, 'featured' | 'retired'> {
  return { ...(isFeatured(meta) ? { featured: true as const } : {}), ...(isRetired(meta) ? { retired: true as const } : {}) };
}

/** The subject fields for a response: present only when a subject is known. */
function subjectFields(subject: Subject | undefined, from: 'curated' | 'muse'): Pick<SourceRefResponse, 'subject' | 'subjectSource'> {
  return subject === undefined ? {} : { subject, subjectSource: from };
}

function sendJson(res: ServerResponse, status: number, body: unknown, extraHeaders?: Record<string, string>): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
    ...extraHeaders,
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
  /** Stage 10 slice A: the judge gate (off unless opts.access.code is a non-empty string). */
  const access: AccessControl = createAccessControl(opts.access, {
    storageDir: opts.storageDir,
    live: () => opts.startJob !== null,
  });

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
    const requestUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
    const pathname = requestUrl.pathname;

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

    if (pathname === '/api/access') {
      return handleAccess(req, res, method);
    }

    if (pathname === '/api/sources') {
      if (method === 'GET') {
        const out: SourceRefResponse[] = [];
        // Stage 7e: `?include=retired` also lists retired library pages (flagged), so old runs keep their page titles.
        const includeRetired = requestUrl.searchParams.get('include') === 'retired';
        let ids: string[] = [];
        try {
          ids = listSourceIds(opts.sourcesDir);
        } catch {
          ids = [];
        }
        for (const id of ids) {
          try {
            const meta = loadSourceMeta(id, opts.sourcesDir);
            // Stage 7e: retired library pages leave the list (still served by id for stored runs and evidence).
            if (isRetired(meta) && !includeRetired) continue;
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
              ...libraryFlags(meta),
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
          ...libraryFlags(meta),
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

    // Stage 8b: the licence-checked figure library (read-only). The meta endpoint answers
    // the sidecar JSON; the image endpoint answers the EXACT sha256-verified stored bytes
    // with a long public cache. Ids never become paths: only a bare store id matching
    // FIGURE_ID_PATTERN is looked up, and only the sidecar's own (basename) file is served.
    if (pathname.startsWith('/api/figures/')) {
      if (method !== 'GET') {
        return sendError(res, 405, 'METHOD_NOT_ALLOWED');
      }
      const segments = decodeURIComponent(pathname.slice('/api/figures/'.length)).split('/');
      const id = segments[0] ?? '';
      const sub = segments.length === 2 ? segments[1] : '';
      if (
        segments.length > 2 ||
        !FIGURE_ID_PATTERN.test(id) ||
        (segments.length === 2 && sub !== 'image')
      ) {
        return sendError(res, 404, 'NOT_FOUND');
      }
      let meta: FigureMeta;
      let bytes: Uint8Array;
      try {
        const loaded = loadFigure(id); // re-verifies the recorded sha256 on every load
        meta = loaded.meta;
        bytes = loaded.bytes;
      } catch (err: unknown) {
        if (err instanceof Error && err.message === 'FIGURE_NOT_FOUND') {
          return sendError(res, 404, 'NOT_FOUND');
        }
        return sendError(res, 500, 'FIGURE_UNAVAILABLE'); // e.g. sha256 mismatch (tampered store)
      }
      if (sub === '') {
        return sendJson(res, 200, meta);
      }
      // Defence in depth: even a compromised sidecar can never point the response at a
      // path outside data/figures or at a non-image content type.
      if (
        meta.file.includes('/') ||
        meta.file.includes('\\') ||
        meta.file.includes('..') ||
        !FIGURE_IMAGE_MIME.test(meta.mime)
      ) {
        return sendError(res, 500, 'FIGURE_UNAVAILABLE');
      }
      const etag = `"${meta.sha256}"`;
      if (req.headers['if-none-match'] === etag) {
        res.writeHead(304, { etag, 'cache-control': FIGURE_CACHE_CONTROL });
        res.end();
        return;
      }
      res.writeHead(200, {
        'content-type': meta.mime,
        'content-length': bytes.length,
        'x-content-type-options': 'nosniff',
        'cache-control': FIGURE_CACHE_CONTROL,
        etag,
      });
      res.end(Buffer.from(bytes));
      return;
    }

    if (pathname === '/api/jobs') {
      if (method === 'GET') {
        // Stage 10b: a published lesson carries its publish time, so the web list can mark it.
        return sendJson(res, 200, listJobs(opts.storageDir).map(job => {
          const review = readReview(opts.storageDir, job.jobId);
          return review === null ? job : { ...job, reviewPublishedAt: review.publishedAt };
        }));
      }
      if (method === 'POST') {
        return handleCreateJob(req, res);
      }
      return sendError(res, 405, 'METHOD_NOT_ALLOWED');
    }

    if (pathname.startsWith('/api/jobs/')) {
      const rest = decodeURIComponent(pathname.slice('/api/jobs/'.length));
      // Stage 10b: /api/jobs/:id/review (exactly one id segment, then "review").
      if (rest.endsWith('/review') && !rest.slice(0, -'/review'.length).includes('/') && rest !== '/review') {
        return handleReview(req, res, method, rest.slice(0, -'/review'.length));
      }
      const id = rest;
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
        // Set A: re-check stored parts with today's validators; fill printed-label text into older specs.
        recheckLesson(opts.storageDir, job, {
          ...(opts.sourcesDir !== undefined ? { sourcesDir: opts.sourcesDir } : {}),
          userSourcesDir: userSourcesDir(),
        });
        // ISSUE-011: parts quoting a sentence a human review found wrong on the source page are held back.
        applyContentHolds(opts.storageDir, job);
        for (const spec of Object.values(job.kitSpecs ?? {})) enrichLabelBoxes(spec);
        // Label diagrams are numbered in the order the page describes their parts (label-order.ts).
        orderLabelParts(opts.storageDir, job, {
          ...(opts.sourcesDir !== undefined ? { sourcesDir: opts.sourcesDir } : {}),
          userSourcesDir: userSourcesDir(),
        });
        // Set B: per-revision check outcomes for the repair story (failed revisions give check ids and points only).
        const withHistory = job.lesson !== undefined ? { ...job, componentHistory: componentHistory(opts.storageDir, id) } : job;
        // Stage 10b: the teacher review, when there is one (no file = not reviewed).
        const review = readReview(opts.storageDir, id);
        return sendJson(res, 200, review === null ? withHistory : { ...withHistory, review });
      } catch {
        return sendError(res, 404, 'NOT_FOUND'); // JOB_ID_INVALID or unreadable run
      }
    }

    return sendError(res, 404, 'NOT_FOUND');
  }

  /**
   * Stage 10b slice R: POST /api/jobs/:id/review. Order: Origin, access gate (so a visitor learns nothing about jobs),
   * the job (404), reviewable (409), then the body. Free: no ledger entry, no judge budget.
   */
  async function handleReview(req: IncomingMessage, res: ServerResponse, method: string, id: string): Promise<void> {
    if (method !== 'POST') {
      return sendError(res, 405, 'METHOD_NOT_ALLOWED');
    }
    if (!originAllowed(req)) {
      return sendError(res, 403, 'ORIGIN_NOT_ALLOWED');
    }
    if (!access.isGranted(req)) {
      return sendError(res, 403, 'ACCESS_REQUIRED');
    }
    let job: ReturnType<typeof readJob>;
    try {
      job = readJob(opts.storageDir, id);
    } catch {
      return sendError(res, 404, 'NOT_FOUND'); // JOB_ID_INVALID or an unreadable run
    }
    if (job === null) {
      return sendError(res, 404, 'NOT_FOUND');
    }
    if (job.summary.status !== 'succeeded' || job.summary.flow !== 'lesson') {
      return sendError(res, 409, 'NOT_REVIEWABLE');
    }
    const contentType = (req.headers['content-type'] ?? '').toLowerCase();
    if (!contentType.startsWith('application/json')) {
      return sendError(res, 415, 'UNSUPPORTED_MEDIA_TYPE');
    }
    let rawBody: string;
    try {
      rawBody = await readBodyLimited(req, MAX_REVIEW_BODY_BYTES);
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
    const action: unknown = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>)['action'] : undefined;
    try {
      if (action === 'unpublish') {
        deleteReview(opts.storageDir, id);
        return sendJson(res, 200, { review: null });
      }
      if (action !== 'publish') {
        return sendError(res, 400, 'BAD_REQUEST');
      }
      // The same view of the lesson the detail route serves: parts today's checks or a human review withheld are not reviewable.
      recheckLesson(opts.storageDir, job, {
        ...(opts.sourcesDir !== undefined ? { sourcesDir: opts.sourcesDir } : {}),
        userSourcesDir: userSourcesDir(),
      });
      applyContentHolds(opts.storageDir, job);
      const checked = validatePublishBody(parsed, publishedPartIds(job));
      if (!checked.ok) {
        return sendError(res, checked.status, checked.code);
      }
      const review = {
        status: 'published' as const,
        publishedAt: (opts.now ?? ((): Date => new Date()))().toISOString(),
        hiddenParts: checked.value.hiddenParts,
        checkedParts: checked.value.checkedParts,
      };
      writeReview(opts.storageDir, id, review);
      return sendJson(res, 200, { review });
    } catch {
      return sendError(res, 500, 'INTERNAL');
    }
  }

  /** Stage 10 slice A: GET (open) / POST (code -> session) / DELETE (sign out) /api/access. */
  async function handleAccess(req: IncomingMessage, res: ServerResponse, method: string): Promise<void> {
    if (method === 'GET') {
      return sendJson(res, 200, access.body(req));
    }
    if (method !== 'POST' && method !== 'DELETE') {
      return sendError(res, 405, 'METHOD_NOT_ALLOWED');
    }
    // R-07: the same Origin protection as every other state-changing route.
    if (!originAllowed(req)) {
      return sendError(res, 403, 'ORIGIN_NOT_ALLOWED');
    }
    if (method === 'DELETE') {
      if (!access.gateOn) {
        return sendJson(res, 200, access.body(req));
      }
      const clearing = access.clearCookie(req); // revokes the request's session before the body is built
      return sendJson(res, 200, { ...access.body(req), granted: false }, { 'set-cookie': clearing });
    }
    // POST: with the gate off there is nothing to unlock (and nothing to guess).
    if (!access.gateOn) {
      return sendJson(res, 200, access.body(req));
    }
    const contentType = (req.headers['content-type'] ?? '').toLowerCase();
    if (!contentType.startsWith('application/json')) {
      return sendError(res, 415, 'UNSUPPORTED_MEDIA_TYPE');
    }
    let rawBody: string;
    try {
      rawBody = await readBodyLimited(req, MAX_ACCESS_BODY_BYTES);
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE') {
        return sendError(res, 413, 'PAYLOAD_TOO_LARGE');
      }
      return sendError(res, 400, 'BAD_REQUEST');
    }
    let submitted: unknown;
    try {
      submitted = (JSON.parse(rawBody) as { code?: unknown } | null)?.code;
    } catch {
      return sendError(res, 400, 'BAD_REQUEST');
    }
    if (typeof submitted !== 'string') {
      return sendError(res, 400, 'BAD_REQUEST');
    }
    // Every code guess spends one of the client's 5 attempts per minute (right or wrong).
    const attempt = access.takeAttempt(req);
    if (!attempt.ok) {
      return sendJson(res, 429, { error: 'TOO_MANY_ATTEMPTS' }, { 'retry-after': String(attempt.retryAfterS) });
    }
    if (!access.codeMatches(submitted)) {
      return sendError(res, 401, 'ACCESS_CODE_INVALID');
    }
    const cookie = access.sessionCookie(req);
    // The new session is not on this request yet, so the body is built as granted.
    return sendJson(res, 200, { ...access.body(req), granted: true }, { 'set-cookie': cookie });
  }

  async function handleCreateSource(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // R-07: same Origin protection as every other POST route.
    if (!originAllowed(req)) {
      return sendError(res, 403, 'ORIGIN_NOT_ALLOWED');
    }
    // Stage 10: with the gate on, pasting a source needs a judge session.
    if (!access.isGranted(req)) {
      return sendError(res, 403, 'ACCESS_REQUIRED');
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
    // Stage 10: with the gate on, a build needs a judge session (checked before anything is read).
    if (!access.isGranted(req)) {
      return sendError(res, 403, 'ACCESS_REQUIRED');
    }
    const start = opts.startJob;
    if (start === null) {
      return sendError(res, 503, 'LIVE_DISABLED');
    }
    if (access.gateOn) {
      // Kill switch (file or env) and the judge budget, both re-evaluated on every gated POST.
      if (access.buildsPaused()) {
        return sendError(res, 503, 'BUILDS_PAUSED');
      }
      if (access.budgetReached()) {
        return sendError(res, 402, 'JUDGE_BUDGET_REACHED');
      }
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
    // Stage 10: re-checked in the same synchronous block that starts the job, so concurrent
    // POSTs cannot all pass the early check against one stale budget (each started judge job
    // is recorded, and counted, before the next request gets here).
    if (access.gateOn && access.budgetReached()) {
      return sendError(res, 402, 'JUDGE_BUDGET_REACHED');
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
        ...(access.gateOn ? { access: 'judge' as const } : {}),
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
