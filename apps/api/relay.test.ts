// Stage 11 slice L — local relay mode: config, mode selection, relay control, relay client builders.
// FAKE relay (injected fetch) and FAKE ledger only. No network, no credits, no .env access.
// The access code here is an inert marker, so any leak into a log or a response is detectable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  createRelayControl,
  loadRelayConfig,
  parseRelayConfig,
  RELAY_STATUS_TTL_MS,
  selectApiMode,
} from './relay.ts';
import type { RelayStatus } from './relay.ts';
import { buildRelayJobClients, buildRelayMetaClient, buildRelayModalClient, relaySamDeps } from './relay-clients.ts';
import { MetaError, MODAL_MUSE_SPARK_OPEN_MODEL } from '../../packages/meta/client.ts';
import type { Ledger } from '../../packages/meta/ledger.ts';

const RELAY_URL = 'https://mki-relay.example.modal.run';
const CODE = 'relay-code-MARKER-for-tests-7Q2xZ9';

function fakeLedger(): Ledger {
  let n = 0;
  return {
    capUSD: 50,
    reserve: (): string => `res-${(n += 1)}`,
    reconcile: (): void => {},
    committedUSD: (): number => 0,
    close: (): void => {},
  } as unknown as Ledger;
}

const STATUS: RelayStatus = { enabled: true, capUSD: 50, spentUSD: 2.5, remainingUSD: 47.5 };

interface FakeRelay {
  fetchImpl: typeof fetch;
  calls: Array<{ url: string; method: string; auth: string | null; redirect: string | undefined }>;
  behave: (code: string) => Response | Error;
}

/** A fake relay: GET <url>/v1/status answers 200 for CODE, 401 otherwise, unless `behave` is replaced. */
function fakeRelay(): FakeRelay {
  const relay: FakeRelay = {
    calls: [],
    behave: (code: string): Response =>
      code === CODE
        ? new Response(JSON.stringify({ ok: true, ...STATUS }), { status: 200, headers: { 'content-type': 'application/json' } })
        : new Response(JSON.stringify({ error: { code: 'RELAY_CODE_INVALID' } }), { status: 401 }),
    fetchImpl: (async (input: unknown, init?: RequestInit): Promise<Response> => {
      const headers = new Headers(init?.headers);
      const auth = headers.get('authorization');
      relay.calls.push({ url: String(input), method: init?.method ?? 'GET', auth, redirect: init?.redirect });
      const out = relay.behave((auth ?? '').replace(/^Bearer /, ''));
      if (out instanceof Error) {
        throw out;
      }
      return out;
    }) as typeof fetch,
  };
  return relay;
}

/* ------------------------------------------------------------------ */
/* config/relay.json                                                    */
/* ------------------------------------------------------------------ */

test('L: parseRelayConfig accepts an empty url (relay unavailable) and a plain https url', () => {
  assert.deepEqual(parseRelayConfig({ url: '' }), { url: '' });
  assert.deepEqual(parseRelayConfig({ url: RELAY_URL }), { url: RELAY_URL });
  assert.deepEqual(parseRelayConfig({ url: `${RELAY_URL}/` }), { url: RELAY_URL }, 'trailing slash is dropped');
  assert.deepEqual(parseRelayConfig({ url: `${RELAY_URL}/base///` }), { url: `${RELAY_URL}/base` });
  assert.deepEqual(parseRelayConfig({ url: `  ${RELAY_URL}  `, note: 'x' }), { url: RELAY_URL }, 'surrounding space ignored');
});

test('L: parseRelayConfig rejects http, credentials, query, fragment and non-strings', () => {
  const bad: unknown[] = [
    { url: 'http://relay.example.com' },
    { url: 'https://user:pw@relay.example.com' },
    { url: 'https://user@relay.example.com' },
    { url: 'https://relay.example.com/?a=1' },
    { url: 'https://relay.example.com?' },
    { url: 'https://relay.example.com/#frag' },
    { url: 'https://relay.example.com#' },
    { url: 'ftp://relay.example.com' },
    { url: 'not a url' },
    { url: 'https://' },
    { url: 7 },
    { url: null },
    {},
    [],
    null,
    'https://relay.example.com',
  ];
  for (const raw of bad) {
    assert.throws(() => parseRelayConfig(raw), /RELAY_CONFIG_INVALID/, JSON.stringify(raw));
  }
});

test('L: loadRelayConfig reads a file, treats a missing file as no relay, and rejects a bad file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'relay-config-'));
  assert.deepEqual(loadRelayConfig(pathToFileURL(join(dir, 'absent.json'))), { url: '' });
  const good = join(dir, 'relay.json');
  writeFileSync(good, JSON.stringify({ url: RELAY_URL, note: 'n' }));
  assert.deepEqual(loadRelayConfig(pathToFileURL(good)), { url: RELAY_URL });
  const broken = join(dir, 'broken.json');
  writeFileSync(broken, '{not json');
  assert.throws(() => loadRelayConfig(pathToFileURL(broken)), /RELAY_CONFIG_INVALID/);
  const http = join(dir, 'http.json');
  writeFileSync(http, JSON.stringify({ url: 'http://relay.example.com' }));
  assert.throws(() => loadRelayConfig(pathToFileURL(http)), /RELAY_CONFIG_INVALID/);
});

test('L: the committed config/relay.json is valid', () => {
  const cfg = loadRelayConfig();
  assert.equal(typeof cfg.url, 'string');
  if (cfg.url !== '') {
    assert.match(cfg.url, /^https:\/\//);
  }
});

/* ------------------------------------------------------------------ */
/* mode selection                                                       */
/* ------------------------------------------------------------------ */

test('L: selectApiMode - relay when the key is absent and a relay url exists', () => {
  assert.equal(selectApiMode({}, RELAY_URL), 'relay');
  assert.equal(selectApiMode({ MODEL_API_KEY: '' }, RELAY_URL), 'relay', 'a blank key counts as absent');
  assert.equal(selectApiMode({ MODEL_API_KEY: '   ' }, RELAY_URL), 'relay');
  assert.equal(selectApiMode({ META_LIVE: '1' }, RELAY_URL), 'relay', 'no own key: relay beats META_LIVE');
});

test('L: selectApiMode - direct mode is unchanged when a key is present', () => {
  assert.equal(selectApiMode({ MODEL_API_KEY: 'LLM_x', META_LIVE: '1' }, RELAY_URL), 'direct');
  assert.equal(selectApiMode({ MODEL_API_KEY: 'LLM_x', META_LIVE: '1' }, ''), 'direct');
  assert.equal(selectApiMode({ MODEL_API_KEY: 'LLM_x' }, RELAY_URL), 'readonly', 'key without META_LIVE stays offline, as today');
  assert.equal(selectApiMode({ META_LIVE: '1' }, ''), 'direct', 'META_LIVE without key still fails startup as before');
});

test('L: selectApiMode - no key and no relay url is read-only', () => {
  assert.equal(selectApiMode({}, ''), 'readonly');
  assert.equal(selectApiMode({ MODEL_API_KEY: '' }, ''), 'readonly');
});

test('L: selectApiMode - RELAY=1 forces relay, RELAY=0 turns it off, RELAY=1 needs a url', () => {
  assert.equal(selectApiMode({ RELAY: '1', MODEL_API_KEY: 'LLM_x', META_LIVE: '1' }, RELAY_URL), 'relay');
  assert.throws(() => selectApiMode({ RELAY: '1' }, ''), /RELAY_URL_MISSING/);
  assert.equal(selectApiMode({ RELAY: '0' }, RELAY_URL), 'readonly');
  assert.equal(selectApiMode({ RELAY: '0', META_LIVE: '1', MODEL_API_KEY: 'LLM_x' }, RELAY_URL), 'direct');
});

/* ------------------------------------------------------------------ */
/* relay control                                                        */
/* ------------------------------------------------------------------ */

test('L: verify calls GET <url>/v1/status with the code as the bearer and keeps the code in memory', async () => {
  const relay = fakeRelay();
  const control = createRelayControl({ url: RELAY_URL, fetchImpl: relay.fetchImpl });
  assert.equal(control.hasCode(), false);
  assert.equal(control.code(), null);
  assert.equal(control.snapshot(), null);
  const verdict = await control.verify(CODE);
  assert.deepEqual(verdict, { ok: true, status: STATUS });
  assert.equal(relay.calls.length, 1);
  assert.equal(relay.calls[0]?.url, `${RELAY_URL}/v1/status`);
  assert.equal(relay.calls[0]?.method, 'GET');
  assert.equal(relay.calls[0]?.auth, `Bearer ${CODE}`);
  assert.equal(relay.calls[0]?.redirect, 'error', 'a redirect is never followed with the code attached');
  assert.equal(control.hasCode(), true);
  assert.equal(control.code(), CODE);
  assert.deepEqual(control.snapshot(), STATUS);
});

test('L: verify - a wrong code is invalid and nothing is kept', async () => {
  const relay = fakeRelay();
  const control = createRelayControl({ url: RELAY_URL, fetchImpl: relay.fetchImpl });
  assert.deepEqual(await control.verify('wrong-code-wrong-code-0000'), { ok: false, reason: 'invalid' });
  assert.equal(control.hasCode(), false);
  // a failed attempt does not wipe a code that already works
  await control.verify(CODE);
  assert.deepEqual(await control.verify('wrong-code-wrong-code-0000'), { ok: false, reason: 'invalid' });
  assert.equal(control.code(), CODE);
});

test('L: verify - codes that cannot be a header value are invalid without any request', async () => {
  const relay = fakeRelay();
  const control = createRelayControl({ url: RELAY_URL, fetchImpl: relay.fetchImpl });
  for (const bad of ['', ' ', 'has space in it', 'line\nbreak', 'tab\there', 'caf\u00e9-code-with-accent', 'x'.repeat(300), '\u0000nul']) {
    assert.deepEqual(await control.verify(bad), { ok: false, reason: 'invalid' }, JSON.stringify(bad));
  }
  assert.equal(relay.calls.length, 0);
});

test('L: verify maps relay rate limiting, server errors, network errors and malformed answers', async () => {
  const relay = fakeRelay();
  const control = createRelayControl({ url: RELAY_URL, fetchImpl: relay.fetchImpl });
  relay.behave = () => new Response('{}', { status: 429 });
  assert.deepEqual(await control.verify(CODE), { ok: false, reason: 'rate-limited' });
  relay.behave = () => new Response('oops', { status: 500 });
  assert.deepEqual(await control.verify(CODE), { ok: false, reason: 'unreachable' });
  relay.behave = () => new Response('<html>', { status: 200 });
  assert.deepEqual(await control.verify(CODE), { ok: false, reason: 'unreachable' }, 'not JSON');
  relay.behave = () => new Response(JSON.stringify({ ok: true, enabled: true }), { status: 200 });
  assert.deepEqual(await control.verify(CODE), { ok: false, reason: 'unreachable' }, 'missing numbers');
  relay.behave = () => new Response(JSON.stringify({ ok: false, ...STATUS }), { status: 200 });
  assert.deepEqual(await control.verify(CODE), { ok: false, reason: 'unreachable' }, 'ok is not true');
  relay.behave = () => new Response(JSON.stringify({ ok: true, ...STATUS, remainingUSD: 'a lot' }), { status: 200 });
  assert.deepEqual(await control.verify(CODE), { ok: false, reason: 'unreachable' }, 'non-numeric money');
  relay.behave = () => new TypeError('fetch failed');
  assert.deepEqual(await control.verify(CODE), { ok: false, reason: 'unreachable' });
  assert.equal(control.hasCode(), false, 'no failure grants anything');
});

test('L: status is cached for 10 seconds, then refreshed', async () => {
  const relay = fakeRelay();
  let clock = 1_000_000;
  const control = createRelayControl({ url: RELAY_URL, fetchImpl: relay.fetchImpl, now: () => clock });
  await control.verify(CODE);
  assert.equal(relay.calls.length, 1);
  await control.refresh();
  clock += RELAY_STATUS_TTL_MS - 1;
  await control.refresh();
  assert.equal(relay.calls.length, 1, 'within the cache window nothing is fetched');
  relay.behave = () =>
    new Response(JSON.stringify({ ok: true, enabled: true, capUSD: 50, spentUSD: 10, remainingUSD: 40 }), { status: 200 });
  clock += 1;
  await control.refresh();
  assert.equal(relay.calls.length, 2);
  assert.equal(control.snapshot()?.remainingUSD, 40);
  assert.equal(RELAY_STATUS_TTL_MS, 10_000);
});

test('L: simultaneous refreshes share one request', async () => {
  const relay = fakeRelay();
  let clock = 0;
  const control = createRelayControl({ url: RELAY_URL, fetchImpl: relay.fetchImpl, now: () => clock });
  await control.verify(CODE);
  clock += 60_000;
  await Promise.all([control.refresh(), control.refresh(), control.refresh()]);
  assert.equal(relay.calls.length, 2);
});

test('L: refresh keeps the last status when the relay is unreachable, and backs off for the cache window', async () => {
  const relay = fakeRelay();
  let clock = 0;
  const control = createRelayControl({ url: RELAY_URL, fetchImpl: relay.fetchImpl, now: () => clock });
  await control.verify(CODE);
  relay.behave = () => new TypeError('fetch failed');
  clock += 20_000;
  await control.refresh();
  assert.equal(relay.calls.length, 2);
  assert.equal(control.hasCode(), true, 'an outage does not sign the judge out');
  assert.deepEqual(control.snapshot(), STATUS);
  clock += 5_000;
  await control.refresh();
  assert.equal(relay.calls.length, 2, 'a failed refresh is not retried inside the window');
});

test('L: refresh forgets the code when the relay stops accepting it (rotated or revoked)', async () => {
  const relay = fakeRelay();
  let clock = 0;
  const control = createRelayControl({ url: RELAY_URL, fetchImpl: relay.fetchImpl, now: () => clock });
  await control.verify(CODE);
  relay.behave = () => new Response('{}', { status: 401 });
  clock += 20_000;
  await control.refresh();
  assert.equal(control.hasCode(), false);
  assert.equal(control.code(), null);
  assert.equal(control.snapshot(), null);
});

test('L: forget() drops the code and the status', async () => {
  const relay = fakeRelay();
  const control = createRelayControl({ url: RELAY_URL, fetchImpl: relay.fetchImpl });
  await control.verify(CODE);
  control.forget();
  assert.equal(control.hasCode(), false);
  assert.equal(control.code(), null);
  assert.equal(control.snapshot(), null);
  await control.refresh();
  assert.equal(relay.calls.length, 1, 'nothing to refresh without a code');
});

test('L: createRelayControl rejects a bad url', () => {
  assert.throws(() => createRelayControl({ url: 'http://relay.example.com' }), /RELAY_CONFIG_INVALID/);
  assert.throws(() => createRelayControl({ url: '' }), /RELAY_CONFIG_INVALID/);
});

/* ------------------------------------------------------------------ */
/* clients a job gets in relay mode                                      */
/* ------------------------------------------------------------------ */

interface Seen {
  url: string;
  headers: Headers;
  body: string;
}

/** A fake upstream that records the request and answers 401 (a non-retried, content-free failure). */
function recordingFetch(): { fetchImpl: typeof fetch; seen: Seen[] } {
  const seen: Seen[] = [];
  const fetchImpl = (async (input: unknown, init?: RequestInit): Promise<Response> => {
    seen.push({ url: String(input), headers: new Headers(init?.headers), body: String(init?.body ?? '') });
    return new Response('{}', { status: 401 });
  }) as typeof fetch;
  return { fetchImpl, seen };
}

const REQ = {
  purpose: 'test-live' as const,
  schemaName: 'source_analysis',
  jsonSchema: {},
  messages: [{ role: 'user' as const, content: 'hello' }],
  maxOutputTokens: 100,
};

test('L: the Meta client sends the code as the bearer to <url>/meta/v1/chat/completions', async () => {
  const { fetchImpl, seen } = recordingFetch();
  const client = buildRelayMetaClient({ ledger: fakeLedger(), maxInputTokens: 32000, relayUrl: RELAY_URL, code: CODE, fetchImpl });
  assert.equal(client.provider, 'meta-api');
  assert.equal(client.model, 'muse-spark-1.3');
  await assert.rejects(() => client.complete(REQ), MetaError);
  assert.equal(seen[0]?.url, `${RELAY_URL}/meta/v1/chat/completions`);
  assert.equal(seen[0]?.headers.get('authorization'), `Bearer ${CODE}`);
  assert.equal(seen[0]?.headers.get('modal-key'), null);
  assert.equal(JSON.parse(seen[0]?.body ?? '{}').model, 'muse-spark-1.3');
});

test('L: the Modal client sends wk-relay / ws-<code> to <url>/modal/v1/chat/completions', async () => {
  const { fetchImpl, seen } = recordingFetch();
  const client = buildRelayModalClient({ ledger: fakeLedger(), maxInputTokens: 32000, relayUrl: RELAY_URL, code: CODE, fetchImpl });
  assert.equal(client.provider, 'modal');
  assert.equal(client.model, 'muse-spark-open');
  assert.equal(client.providerModel, MODAL_MUSE_SPARK_OPEN_MODEL);
  await assert.rejects(() => client.complete(REQ), MetaError);
  assert.equal(seen[0]?.url, `${RELAY_URL}/modal/v1/chat/completions`);
  assert.equal(seen[0]?.headers.get('modal-key'), 'wk-relay');
  assert.equal(seen[0]?.headers.get('modal-secret'), `ws-${CODE}`);
  assert.equal(seen[0]?.headers.get('authorization'), null);
  assert.equal(JSON.parse(seen[0]?.body ?? '{}').model, MODAL_MUSE_SPARK_OPEN_MODEL);
});

test('L: the SAM deps point at <url>/meta/v1 with the code as the key and the job ledger', () => {
  const ledger = fakeLedger();
  const { fetchImpl } = recordingFetch();
  const deps = relaySamDeps({ ledger, relayUrl: RELAY_URL, code: CODE, fetchImpl });
  assert.equal(deps.baseUrl, `${RELAY_URL}/meta/v1`);
  assert.equal(deps.apiKey, CODE);
  assert.equal(deps.ledger, ledger);
  assert.equal(deps.fetch, fetchImpl);
  const plain = relaySamDeps({ ledger, relayUrl: RELAY_URL, code: CODE });
  assert.equal('fetch' in plain, false, 'no fetch override unless one was given');
});

test('L: a client for a code the headers cannot carry fails closed instead of sending it', () => {
  const deps = { ledger: fakeLedger(), relayUrl: RELAY_URL, code: 'bad code with space' };
  assert.throws(() => buildRelayModalClient({ ...deps, maxInputTokens: 32000 }), MetaError);
  assert.throws(() => buildRelayMetaClient({ ...deps, maxInputTokens: 32000 }), MetaError);
  assert.throws(() => relaySamDeps(deps), MetaError);
});

test('L: a job gets the client for its model and the SAM deps, built from the held code', async () => {
  const relay = fakeRelay();
  const control = createRelayControl({ url: RELAY_URL, fetchImpl: relay.fetchImpl });
  await control.verify(CODE);
  const { fetchImpl, seen } = recordingFetch();
  const ledger = fakeLedger();
  const base = { relay: control, ledger, maxInputTokens: 32000, maxInputTokensV2: 72000, fetchImpl };

  const meta = buildRelayJobClients({ ...base, model: 'muse-spark-1.3', flow: 'lesson' });
  assert.equal(meta.client.provider, 'meta-api');
  assert.equal(meta.sam.baseUrl, `${RELAY_URL}/meta/v1`);
  assert.equal(meta.sam.apiKey, CODE);
  assert.equal(meta.sam.ledger, ledger);
  await assert.rejects(() => meta.client.complete(REQ), MetaError);
  assert.equal(seen[0]?.url, `${RELAY_URL}/meta/v1/chat/completions`);
  assert.equal(seen[0]?.headers.get('authorization'), `Bearer ${CODE}`);

  const open = buildRelayJobClients({ ...base, model: 'muse-spark-open', flow: 'activity' });
  assert.equal(open.client.provider, 'modal');
  assert.equal(open.sam.baseUrl, `${RELAY_URL}/meta/v1`, 'SAM always goes through the Meta route');
  await assert.rejects(() => open.client.complete(REQ), MetaError);
  assert.equal(seen[1]?.url, `${RELAY_URL}/modal/v1/chat/completions`);
  assert.equal(seen[1]?.headers.get('modal-key'), 'wk-relay');
  assert.equal(seen[1]?.headers.get('modal-secret'), `ws-${CODE}`);
});

test('L: the lesson flow uses the V2 input bound, the activity flow the v1 bound', async () => {
  const relay = fakeRelay();
  const control = createRelayControl({ url: RELAY_URL, fetchImpl: relay.fetchImpl });
  await control.verify(CODE);
  const { fetchImpl, seen } = recordingFetch();
  const base = { relay: control, ledger: fakeLedger(), model: 'muse-spark-1.3' as const, maxInputTokens: 100, maxInputTokensV2: 100_000, fetchImpl };
  const big = { ...REQ, messages: [{ role: 'user' as const, content: 'x'.repeat(5000) }] };
  const lesson = buildRelayJobClients({ ...base, flow: 'lesson' });
  await assert.rejects(() => lesson.client.complete(big), MetaError); // the fake relay answers 401
  assert.equal(seen.length, 1, 'the lesson bound lets the request through to the relay');
  const activity = buildRelayJobClients({ ...base, flow: 'activity' });
  await assert.rejects(() => activity.client.complete(big), MetaError);
  assert.equal(seen.length, 1, 'the activity bound refuses it before any request');
});

test('L: no code held means no job clients (ACCESS_REQUIRED)', () => {
  const control = createRelayControl({ url: RELAY_URL, fetchImpl: fakeRelay().fetchImpl });
  assert.throws(
    () => buildRelayJobClients({ relay: control, ledger: fakeLedger(), model: 'muse-spark-1.3', flow: 'lesson', maxInputTokens: 1, maxInputTokensV2: 1 }),
    /ACCESS_REQUIRED/,
  );
});
