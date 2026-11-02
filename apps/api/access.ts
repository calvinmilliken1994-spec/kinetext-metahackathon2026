// Stage 10 slice A — judge access (docs/specs/STAGE-10-navigation-and-access.md section A).
//
// One shared access code unlocks the WRITE routes (POST /api/jobs, POST /api/sources) for
// judges; every GET stays open. The gate is ON when `access.code` (env ACCESS_CODE, wired by
// main.ts) is a non-empty string; with the gate off nothing here changes any existing route.
//
// Secrecy: the code, the signing secret and cookie values are never logged, never put in a
// response body, and never compared with `===` (equal-length SHA-256 digests go through
// crypto.timingSafeEqual). Nothing in this module writes to the console.
//
// Session: a stateless cookie `mki_access=<payload>.<sig>`; payload = base64url(`<sessionId>.<issuedAtMs>`),
// sig = base64url(HMAC-SHA256(key, payload)). The key is derived from the session secret AND the
// access code, so rotating either ends every session. Verification recomputes the HMAC (constant
// time), then enforces the 7-day Max-Age on the server. DELETE also revokes that session id in
// memory until it would have expired anyway.
//
// Relay mode (Stage 11, docs/specs/STAGE-11-judge-relay.md): on a judge's own machine there is no
// ACCESS_CODE. The gate is ON and the RELAY decides whether a code is right (server.ts calls
// relay.verify; this module never sees the code). The session is still this module's signed cookie,
// but it only counts while the server holds a code the relay accepted (in memory, apps/api/relay.ts),
// so a cookie that outlives a restart grants nothing. The budget figures come from the relay's
// cached status instead of local job costs.
//
// Spend (the judge budget): spentUSD is the summed cost of every job whose stored record
// carries `access: 'judge'` (workers/generation/jobs.ts). For a finished job that is
// max(job.json totalCostUSD, sum of estCostUSD over its events): the two agree on 732 of 742
// stored runs and the event sum is the larger on the other 10, so taking the larger can only
// over-count (conservative). A RUNNING job's job.json is not rewritten until it ends, and the
// API holds no handle on the worker's in-memory accumulator, so its live accumulated estimate
// is the sum of the estCostUSD already written to its events.jsonl (every settled call, error
// charges included), never less than the per-job reserved floor (JUDGE_MIN_HEADROOM_USD, the
// same headroom a build needs to start). The floor also covers the call currently in flight,
// whose cost is not in the events yet, and makes a burst of simultaneous starts count against
// the budget the moment each job is recorded.

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { join } from 'node:path';
import { DEFAULT_JUDGE_CAP_USD } from './resource-limits.ts';

export { DEFAULT_JUDGE_CAP_USD };

export const ACCESS_COOKIE_NAME = 'mki_access';
/** 7 days, in seconds (the Max-Age the spec freezes). */
export const ACCESS_COOKIE_MAX_AGE_S = 604800;
/** A build needs at least this much budget left (and a running job counts at least this much). */
export const JUDGE_MIN_HEADROOM_USD = 1;
/** POST /api/access: at most this many code attempts per client address per window. */
export const ACCESS_ATTEMPTS_PER_WINDOW = 5;
export const ACCESS_ATTEMPT_WINDOW_MS = 60_000;
/** Name of the kill-switch file inside the storage directory. */
export const BUILDS_PAUSED_FILE = 'BUILDS_PAUSED';
/** A cookie stamped further in the future than this (clock skew allowance) is not a session. */
const MAX_FUTURE_SKEW_MS = 5 * 60_000;
/** Rate-limit table bound: past this many tracked addresses, expired ones are dropped first. */
const MAX_TRACKED_ADDRESSES = 5000;

/** What access.ts needs from the relay control (apps/api/relay.ts satisfies it). */
export interface RelayAccess {
  /** The server holds a code the relay accepted. */
  hasCode(): boolean;
  /** The relay's last budget status (cached <= 10 s), or null. */
  snapshot(): { enabled: boolean; capUSD: number; spentUSD: number; remainingUSD: number } | null;
}

export interface AccessOptions {
  /** The shared judge code. The gate is on when this is a non-empty string. Never logged. */
  code?: string;
  /** HMAC key material for the session cookie; a random per-process key when absent. Never logged. */
  sessionSecret?: string;
  /** Judge budget in USD (config judgeCapUSD, validated in resource-limits.ts); default 50. */
  judgeCapUSD?: number;
  /** Minimum remaining budget for a build to start (default JUDGE_MIN_HEADROOM_USD). */
  minHeadroomUSD?: number;
  /**
   * Behind a trusted reverse proxy (Render): key the attempt limiter on the RIGHTMOST
   * X-Forwarded-For entry (the one the proxy appended). Off by default: the header is
   * client-controlled unless a proxy you trust overwrites it.
   */
  trustProxy?: boolean;
  /** Env kill switch, read on every gated POST (default: process.env.BUILDS_PAUSED === '1'). */
  buildsPaused?: () => boolean;
  /** Clock in epoch ms (tests). */
  now?: () => number;
  /**
   * Relay mode: the relay is the judge of the code. The gate is on, `code` is ignored, and the budget
   * and kill switch come from the relay's status.
   */
  relay?: RelayAccess;
}

export interface AccessBody {
  gate: boolean;
  granted: boolean;
  capUSD: number;
  spentUSD: number;
  remainingUSD: number;
  buildsEnabled: boolean;
}

/** Constant-time string comparison: equal-length SHA-256 digests through timingSafeEqual. */
export function safeEqual(a: string, b: string): boolean {
  const da = createHash('sha256').update(a, 'utf8').digest();
  const db = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(da, db);
}

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

function signature(key: Buffer, payload: string): string {
  return b64url(createHmac('sha256', key).update(payload, 'utf8').digest());
}

/** Build the signed cookie VALUE for a session id issued at `issuedAtMs`. */
export function signSession(key: Buffer, sessionId: string, issuedAtMs: number): string {
  const payload = b64url(Buffer.from(`${sessionId}.${Math.trunc(issuedAtMs)}`, 'utf8'));
  return `${payload}.${signature(key, payload)}`;
}

/**
 * Verify a cookie VALUE: signature (constant time, over the exact string), shape, and the
 * Max-Age window. Returns the session or null; never throws.
 */
export function verifySession(
  key: Buffer,
  value: string,
  nowMs: number,
): { sessionId: string; issuedAt: number } | null {
  const parts = value.split('.');
  if (parts.length !== 2) {
    return null;
  }
  const [payload, sig] = parts as [string, string];
  if (payload === '' || sig === '') {
    return null;
  }
  const expected = Buffer.from(signature(key, payload), 'utf8');
  const given = Buffer.from(sig, 'utf8');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return null;
  }
  let decoded: string;
  try {
    decoded = Buffer.from(payload, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const dot = decoded.lastIndexOf('.');
  if (dot <= 0) {
    return null;
  }
  const sessionId = decoded.slice(0, dot);
  const stamp = decoded.slice(dot + 1);
  if (!/^[0-9]{1,16}$/.test(stamp)) {
    return null;
  }
  const issuedAt = Number(stamp);
  if (issuedAt > nowMs + MAX_FUTURE_SKEW_MS) {
    return null;
  }
  if (nowMs - issuedAt >= ACCESS_COOKIE_MAX_AGE_S * 1000) {
    return null;
  }
  return { sessionId, issuedAt };
}

function readCookie(req: IncomingMessage, name: string): string | undefined {
  const header = req.headers.cookie;
  if (typeof header !== 'string') {
    return undefined;
  }
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) {
      continue;
    }
    if (part.slice(0, eq).trim() === name) {
      return part.slice(eq + 1).trim();
    }
  }
  return undefined;
}

function isHttps(req: IncomingMessage): boolean {
  const forwarded = req.headers['x-forwarded-proto'];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim().toLowerCase();
  if (first === 'https') {
    return true;
  }
  return (req.socket as { encrypted?: boolean }).encrypted === true;
}

function roundUSD(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** Sum of estCostUSD over a job's events (live accumulated estimate); 0 when unreadable. */
function eventCostUSD(eventsPath: string): number {
  let text: string;
  try {
    text = readFileSync(eventsPath, 'utf8');
  } catch {
    return 0;
  }
  let sum = 0;
  for (const line of text.split('\n')) {
    if (line.trim() === '') {
      continue;
    }
    try {
      const est: unknown = (JSON.parse(line) as { estCostUSD?: unknown }).estCostUSD;
      if (typeof est === 'number' && Number.isFinite(est) && est > 0) {
        sum += est;
      }
    } catch {
      // a torn line costs nothing; the rest of the stream still counts
    }
  }
  return sum;
}

type SpendCacheEntry = { stamp: string; judge: false } | { stamp: string; judge: true; costUSD: number };

export interface AccessControl {
  /** True when ACCESS_CODE is set and non-empty, or the relay judges the code. */
  readonly gateOn: boolean;
  readonly capUSD: number;
  /** A valid, unexpired, unrevoked session cookie (always true with the gate off). */
  isGranted(req: IncomingMessage): boolean;
  /** The GET /api/access body. */
  body(req: IncomingMessage): AccessBody;
  /** Constant-time check of a submitted code. */
  codeMatches(submitted: string): boolean;
  /** Record an attempt for this client; false when the 5/min budget is used up (retryAfterS set). */
  takeAttempt(req: IncomingMessage): { ok: true } | { ok: false; retryAfterS: number };
  /** Set-Cookie value that starts a session. */
  sessionCookie(req: IncomingMessage): string;
  /** Set-Cookie value that clears the cookie; also revokes the request's session server-side. */
  clearCookie(req: IncomingMessage): string;
  /** Kill switch: the BUILDS_PAUSED file exists in the storage dir, or the env switch is on. */
  buildsPaused(): boolean;
  /** Remaining judge budget is below the build headroom. */
  budgetReached(): boolean;
  spentUSD(): number;
}

export function createAccessControl(opts: AccessOptions | undefined, ctx: { storageDir: string; live: () => boolean }): AccessControl {
  const relay: RelayAccess | undefined = opts?.relay;
  const code: string = relay === undefined && typeof opts?.code === 'string' ? opts.code : '';
  const gateOn = code !== '' || relay !== undefined;
  const capUSD: number = opts?.judgeCapUSD ?? DEFAULT_JUDGE_CAP_USD;
  const headroom: number = opts?.minHeadroomUSD ?? JUDGE_MIN_HEADROOM_USD;
  const now: () => number = opts?.now ?? ((): number => Date.now());
  const trustProxy = opts?.trustProxy === true;
  const envPaused: () => boolean = opts?.buildsPaused ?? ((): boolean => process.env['BUILDS_PAUSED'] === '1');
  const key: Buffer = createHmac('sha256', opts?.sessionSecret ?? randomBytes(32))
    .update('mki-access-session-v1\0', 'utf8')
    .update(code, 'utf8')
    .digest();

  const revoked = new Map<string, number>(); // sessionId -> epoch ms after which it is expired anyway
  const attempts = new Map<string, number[]>(); // client address -> attempt timestamps in the window
  const spendCache = new Map<string, SpendCacheEntry>();

  function sessionOf(req: IncomingMessage): { sessionId: string; issuedAt: number } | null {
    const value = readCookie(req, ACCESS_COOKIE_NAME);
    if (value === undefined || value === '') {
      return null;
    }
    const session = verifySession(key, value, now());
    if (session === null || revoked.has(session.sessionId)) {
      return null;
    }
    return session;
  }

  function isGranted(req: IncomingMessage): boolean {
    if (!gateOn) {
      return true;
    }
    // Relay mode: a session only counts while the server holds a code the relay accepted.
    return sessionOf(req) !== null && (relay === undefined || relay.hasCode());
  }

  function clientAddress(req: IncomingMessage): string {
    if (trustProxy) {
      const forwarded = req.headers['x-forwarded-for'];
      const raw = Array.isArray(forwarded) ? forwarded.join(',') : forwarded;
      const last = raw?.split(',').pop()?.trim();
      if (last !== undefined && last !== '') {
        return last.slice(0, 64);
      }
    }
    return (req.socket.remoteAddress ?? 'unknown').slice(0, 64);
  }

  function takeAttempt(req: IncomingMessage): { ok: true } | { ok: false; retryAfterS: number } {
    const at = now();
    const address = clientAddress(req);
    if (attempts.size > MAX_TRACKED_ADDRESSES) {
      for (const [addr, stamps] of attempts) {
        if (stamps.every(t => at - t >= ACCESS_ATTEMPT_WINDOW_MS)) {
          attempts.delete(addr);
        }
      }
    }
    const recent = (attempts.get(address) ?? []).filter(t => at - t < ACCESS_ATTEMPT_WINDOW_MS);
    if (recent.length >= ACCESS_ATTEMPTS_PER_WINDOW) {
      attempts.set(address, recent);
      const oldest = recent[0] as number;
      return { ok: false, retryAfterS: Math.max(1, Math.ceil((oldest + ACCESS_ATTEMPT_WINDOW_MS - at) / 1000)) };
    }
    recent.push(at);
    attempts.set(address, recent);
    return { ok: true };
  }

  function cookieString(value: string, maxAgeS: number, req: IncomingMessage): string {
    return `${ACCESS_COOKIE_NAME}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeS}${isHttps(req) ? '; Secure' : ''}`;
  }

  function sessionCookie(req: IncomingMessage): string {
    return cookieString(signSession(key, randomBytes(16).toString('hex'), now()), ACCESS_COOKIE_MAX_AGE_S, req);
  }

  function clearCookie(req: IncomingMessage): string {
    const session = sessionOf(req);
    if (session !== null) {
      const at = now();
      for (const [id, expires] of revoked) {
        if (expires <= at) {
          revoked.delete(id);
        }
      }
      revoked.set(session.sessionId, session.issuedAt + ACCESS_COOKIE_MAX_AGE_S * 1000);
    }
    return cookieString('', 0, req);
  }

  function buildsPaused(): boolean {
    if (relay !== undefined && relay.snapshot()?.enabled === false) {
      return true; // Calvin paused the relay
    }
    return existsSync(join(ctx.storageDir, BUILDS_PAUSED_FILE)) || envPaused();
  }

  /** Total cost of judge-tagged jobs (see the module header for what each state counts). */
  function spentUSD(): number {
    const runsDir = join(ctx.storageDir, 'runs');
    let entries: string[];
    try {
      entries = readdirSync(runsDir, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => e.name);
    } catch {
      return 0;
    }
    let total = 0;
    const seen = new Set<string>();
    for (const name of entries) {
      seen.add(name);
      const jobPath = join(runsDir, name, 'job.json');
      let stamp: string;
      try {
        const st = statSync(jobPath);
        stamp = `${st.mtimeMs}:${st.size}`;
      } catch {
        continue; // no job.json (yet)
      }
      const cached = spendCache.get(name);
      if (cached !== undefined && cached.stamp === stamp) {
        if (cached.judge) {
          total += cached.costUSD;
        }
        continue;
      }
      let record: { access?: unknown; status?: unknown; totalCostUSD?: unknown };
      try {
        record = JSON.parse(readFileSync(jobPath, 'utf8')) as typeof record;
      } catch {
        continue; // unreadable or mid-write; looked at again next time
      }
      if (typeof record !== 'object' || record === null || record.access !== 'judge') {
        spendCache.set(name, { stamp, judge: false });
        continue;
      }
      const recorded =
        typeof record.totalCostUSD === 'number' && Number.isFinite(record.totalCostUSD) && record.totalCostUSD > 0
          ? record.totalCostUSD
          : 0;
      const live = eventCostUSD(join(runsDir, name, 'events.jsonl'));
      const running = record.status === 'running';
      const cost = running ? Math.max(recorded, live, headroom) : Math.max(recorded, live);
      if (!running) {
        spendCache.set(name, { stamp, judge: true, costUSD: cost }); // settled records do not change
      }
      total += cost;
    }
    for (const name of spendCache.keys()) {
      if (!seen.has(name)) {
        spendCache.delete(name);
      }
    }
    return roundUSD(total);
  }

  function remainingUSD(spent: number): number {
    return Math.max(0, roundUSD(capUSD - spent));
  }

  /** The budget figures: the relay's own numbers once it has answered, else the local judge-job sums. */
  function figures(): { cap: number; spent: number; remaining: number } {
    const status = relay?.snapshot() ?? null;
    if (status !== null) {
      return { cap: status.capUSD, spent: status.spentUSD, remaining: Math.max(0, roundUSD(status.remainingUSD)) };
    }
    const spent = spentUSD();
    return { cap: capUSD, spent, remaining: remainingUSD(spent) };
  }

  function budgetReached(): boolean {
    return figures().remaining < headroom;
  }

  function body(req: IncomingMessage): AccessBody {
    const { cap, spent, remaining } = figures();
    return {
      gate: gateOn,
      granted: isGranted(req),
      capUSD: cap,
      spentUSD: spent,
      remainingUSD: remaining,
      buildsEnabled: ctx.live() && !buildsPaused() && remaining >= headroom,
    };
  }

  return {
    gateOn,
    capUSD,
    isGranted,
    body,
    codeMatches: (submitted: string): boolean => relay === undefined && gateOn && safeEqual(submitted, code),
    takeAttempt,
    sessionCookie,
    clearCookie,
    buildsPaused,
    budgetReached,
    spentUSD,
  };
}
