// Stage 11 slice L — local relay mode (docs/specs/STAGE-11-judge-relay.md).
//
// A judge's machine has no Meta or Modal key. It holds one access code, which the relay (a small
// service on Modal that keeps Calvin's keys) checks. This module is the local half of that:
//   - config/relay.json: the relay's base URL (empty until deployed = relay mode unavailable);
//   - mode selection: relay | direct | readonly;
//   - the relay control: validates a code against GET <url>/v1/status, keeps the code IN MEMORY
//     ONLY, and caches the relay's budget figures for 10 seconds.
//
// Secrecy: the code is never written to disk, never logged, never put in a response. Nothing in
// this module writes to the console. Failures map to fixed reasons, never to provider text.

import { readFileSync } from 'node:fs';

/** The relay budget figures are re-read from the relay at most this often. */
export const RELAY_STATUS_TTL_MS = 10_000;
/** A code check is a login: allow the relay a little longer than a background refresh. */
const VERIFY_TIMEOUT_MS = 8_000;
const REFRESH_TIMEOUT_MS = 4_000;
/** Printable ASCII without spaces: safe as a bearer value and as a Modal-Secret header value. */
export const RELAY_CODE_PATTERN = /^[\x21-\x7e]{1,256}$/;
const MAX_STATUS_BYTES = 4096;

/* ------------------------------------------------------------------ */
/* config/relay.json                                                    */
/* ------------------------------------------------------------------ */

export interface RelayConfig {
  /** The relay base URL without a trailing slash; '' = relay mode unavailable. */
  url: string;
}

/**
 * Validate the relay config. An empty url is allowed (nothing deployed yet). A non-empty url must be a
 * plain https URL: no credentials, no query, no fragment. Trailing slashes are dropped.
 */
export function parseRelayConfig(raw: unknown): RelayConfig {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('RELAY_CONFIG_INVALID');
  }
  const url: unknown = (raw as Record<string, unknown>)['url'];
  if (typeof url !== 'string') {
    throw new Error('RELAY_CONFIG_INVALID');
  }
  const trimmed = url.trim();
  if (trimmed === '') {
    return { url: '' };
  }
  // A bare "?" or "#" parses to an empty search/hash, so look at the text as well.
  if (trimmed.includes('?') || trimmed.includes('#')) {
    throw new Error('RELAY_CONFIG_INVALID');
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('RELAY_CONFIG_INVALID');
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.hostname === '' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.search !== '' ||
    parsed.hash !== ''
  ) {
    throw new Error('RELAY_CONFIG_INVALID');
  }
  return { url: trimmed.replace(/\/+$/, '') };
}

const DEFAULT_RELAY_CONFIG = new URL('../../config/relay.json', import.meta.url);

/** Read config/relay.json. A missing file means no relay; an unreadable or invalid file is an error. */
export function loadRelayConfig(file: URL = DEFAULT_RELAY_CONFIG): RelayConfig {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { url: '' };
    }
    throw new Error('RELAY_CONFIG_INVALID');
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('RELAY_CONFIG_INVALID');
  }
  return parseRelayConfig(json);
}

/* ------------------------------------------------------------------ */
/* mode selection                                                       */
/* ------------------------------------------------------------------ */

export type ApiMode = 'relay' | 'direct' | 'readonly';

/**
 * Which way this server runs.
 *   relay    - MODEL_API_KEY absent (or blank) and a relay url is configured, or RELAY=1;
 *              builds go through the relay with the judge's access code.
 *   direct   - META_LIVE=1 with the server's own keys (today's behaviour, unchanged).
 *   readonly - everything else: recorded lessons, the Demo, Results and presenting only.
 * RELAY=0 turns relay mode off. RELAY=1 without a configured url is an error (RELAY_URL_MISSING).
 */
export function selectApiMode(env: Readonly<Record<string, string | undefined>>, relayUrl: string): ApiMode {
  const hasKey = (env['MODEL_API_KEY'] ?? '').trim() !== '';
  const relayUsable = relayUrl !== '';
  if (env['RELAY'] === '1') {
    if (!relayUsable) {
      throw new Error('RELAY_URL_MISSING');
    }
    return 'relay';
  }
  if (env['RELAY'] !== '0' && !hasKey && relayUsable) {
    return 'relay';
  }
  return env['META_LIVE'] === '1' ? 'direct' : 'readonly';
}

/* ------------------------------------------------------------------ */
/* relay control                                                        */
/* ------------------------------------------------------------------ */

/** What GET <url>/v1/status says about the relay's shared budget. */
export interface RelayStatus {
  /** False while Calvin has paused the relay (kill switch). */
  enabled: boolean;
  capUSD: number;
  spentUSD: number;
  remainingUSD: number;
}

export type RelayVerdict =
  | { ok: true; status: RelayStatus }
  | { ok: false; reason: 'invalid' | 'rate-limited' | 'unreachable' };

export interface RelayControlOptions {
  url: string;
  /** Test seam: a fake relay. */
  fetchImpl?: typeof fetch;
  /** Clock in epoch ms (tests). */
  now?: () => number;
}

export interface RelayControl {
  /** The validated relay base URL (not secret). */
  readonly url: string;
  /** Check a code against the relay. On success the code is kept in memory and the status cached. */
  verify(code: string): Promise<RelayVerdict>;
  /** A code the relay accepted is held in memory. */
  hasCode(): boolean;
  /** The held code, for building job clients only. Never log or return it. */
  code(): string | null;
  /** The last status read from the relay, or null. */
  snapshot(): RelayStatus | null;
  /** Refresh the status when the cache is older than 10 s. Never throws. */
  refresh(): Promise<void>;
  /** Drop the code and the status (sign-out). */
  forget(): void;
}

function toStatus(json: unknown): RelayStatus | null {
  if (typeof json !== 'object' || json === null) {
    return null;
  }
  const r = json as Record<string, unknown>;
  const { enabled, capUSD, spentUSD, remainingUSD } = r;
  if (r['ok'] !== true || typeof enabled !== 'boolean') {
    return null;
  }
  for (const n of [capUSD, spentUSD, remainingUSD]) {
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) {
      return null;
    }
  }
  return { enabled, capUSD: capUSD as number, spentUSD: spentUSD as number, remainingUSD: remainingUSD as number };
}

export function createRelayControl(opts: RelayControlOptions): RelayControl {
  const url: string = parseRelayConfig({ url: opts.url }).url;
  if (url === '') {
    throw new Error('RELAY_CONFIG_INVALID');
  }
  const fetchImpl: typeof fetch = opts.fetchImpl ?? (globalThis.fetch as typeof fetch);
  const now: () => number = opts.now ?? ((): number => Date.now());

  let heldCode: string | null = null;
  let status: RelayStatus | null = null;
  let lastTryAt: number | null = null;
  let inFlight: Promise<void> | null = null;

  /** One status request. Fixed outcomes only: the relay's answer text is never kept. */
  async function fetchStatus(code: string, timeoutMs: number): Promise<RelayVerdict> {
    try {
      const res = await fetchImpl(`${url}/v1/status`, {
        method: 'GET',
        headers: { authorization: `Bearer ${code}`, accept: 'application/json' },
        // A redirect would carry the code somewhere the relay did not name.
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 401) {
        return { ok: false, reason: 'invalid' };
      }
      if (res.status === 429) {
        return { ok: false, reason: 'rate-limited' };
      }
      if (res.status !== 200) {
        return { ok: false, reason: 'unreachable' };
      }
      const text = await res.text();
      if (text.length > MAX_STATUS_BYTES) {
        return { ok: false, reason: 'unreachable' };
      }
      const parsed = toStatus(JSON.parse(text) as unknown);
      return parsed === null ? { ok: false, reason: 'unreachable' } : { ok: true, status: parsed };
    } catch {
      return { ok: false, reason: 'unreachable' };
    }
  }

  async function verify(code: string): Promise<RelayVerdict> {
    if (!RELAY_CODE_PATTERN.test(code)) {
      return { ok: false, reason: 'invalid' };
    }
    const verdict = await fetchStatus(code, VERIFY_TIMEOUT_MS);
    if (verdict.ok) {
      heldCode = code;
      status = verdict.status;
      lastTryAt = now();
    }
    return verdict;
  }

  function refresh(): Promise<void> {
    if (heldCode === null) {
      return Promise.resolve();
    }
    if (inFlight !== null) {
      return inFlight;
    }
    if (lastTryAt !== null && now() - lastTryAt < RELAY_STATUS_TTL_MS) {
      return Promise.resolve();
    }
    const code: string = heldCode;
    lastTryAt = now();
    inFlight = (async (): Promise<void> => {
      const verdict = await fetchStatus(code, REFRESH_TIMEOUT_MS);
      if (heldCode !== code) {
        return; // signed out or a different code arrived while this was in flight
      }
      if (verdict.ok) {
        status = verdict.status;
      } else if (verdict.reason === 'invalid') {
        // The relay no longer accepts this code (rotated or revoked): stop using it.
        heldCode = null;
        status = null;
      }
      // rate-limited / unreachable: keep what we have; the next try waits out the cache window
    })().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  return {
    url,
    verify,
    hasCode: (): boolean => heldCode !== null,
    code: (): string | null => heldCode,
    snapshot: (): RelayStatus | null => status,
    refresh,
    forget: (): void => {
      heldCode = null;
      status = null;
      lastTryAt = null;
    },
  };
}
