// Stage 8b — figure library API tests: the REAL DNA figure from data/figures (read-only),
// an ephemeral server on 127.0.0.1:0. Covers the meta endpoint, the exact-bytes image
// endpoint (mime, long public cache, sha256 ETag, 304), the id/path guards that keep every
// response inside data/figures, and the fixed error codes. No network beyond localhost, no
// credits, no .env access.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { request as httpRequest } from 'node:http';
import { createApiServer } from './server.ts';
import type { ApiOptions } from './server.ts';

const DNA_FIGURE = 'medlineplus-dna-structure-1';
const sidecar = JSON.parse(
  readFileSync(new URL(`../../data/figures/${DNA_FIGURE}.json`, import.meta.url), 'utf8'),
) as Record<string, unknown>;
const imageBytes = readFileSync(new URL(`../../data/figures/${DNA_FIGURE}.jpg`, import.meta.url));

function tempStorage(): string {
  return mkdtempSync(join(tmpdir(), 's8b-figures-api-'));
}

async function withServer(run: (base: string) => Promise<void>): Promise<void> {
  const opts: ApiOptions = { storageDir: tempStorage(), startJob: null };
  const server: Server = createApiServer(opts);
  await new Promise<void>(resolve => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  assert.ok(address !== null && typeof address === 'object');
  const base = `http://127.0.0.1:${(address as AddressInfo).port}`;
  try {
    await run(base);
  } finally {
    await new Promise<void>(resolve => {
      server.close(() => resolve());
    });
  }
}

test('GET /api/figures/:id returns the FigureMeta sidecar JSON', async () => {
  await withServer(async base => {
    const res = await fetch(`${base}/api/figures/${DNA_FIGURE}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/json; charset=utf-8');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    const body = (await res.json()) as Record<string, unknown>;
    assert.deepEqual(body, sidecar, 'the meta endpoint answers the stored sidecar exactly');
    assert.equal(body['id'], DNA_FIGURE);
    assert.equal(body['sourceId'], 'medlineplus-what-is-dna');
    assert.equal(body['mime'], 'image/jpeg');
    assert.equal(body['labelsInImage'], true);
  });
});

test('GET /api/figures/:id/image returns the exact bytes with mime, long public cache and the sha256 ETag', async () => {
  await withServer(async base => {
    const res = await fetch(`${base}/api/figures/${DNA_FIGURE}/image`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/jpeg');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    const cacheControl = res.headers.get('cache-control') ?? '';
    assert.ok(cacheControl.startsWith('public, max-age='), `long public cache: ${cacheControl}`);
    assert.ok(Number(cacheControl.match(/max-age=(\d+)/)?.[1]) >= 31536000, 'max-age is at least one year');
    assert.equal(res.headers.get('etag'), `"${String(sidecar['sha256'])}"`);
    const bytes = Buffer.from(await res.arrayBuffer());
    assert.equal(bytes.length, imageBytes.length);
    assert.ok(bytes.equals(imageBytes), 'the response is the exact stored bytes (never re-encoded)');

    // a conditional GET with the same ETag answers 304 without a body
    const cached = await fetch(`${base}/api/figures/${DNA_FIGURE}/image`, {
      headers: { 'if-none-match': `"${String(sidecar['sha256'])}"` },
    });
    assert.equal(cached.status, 304);
    assert.equal(cached.headers.get('etag'), `"${String(sidecar['sha256'])}"`);
    assert.equal((await cached.text()).length, 0);
  });
});

test('GET /api/figures: unknown, malformed and traversal ids answer 404 and never leave the store', async () => {
  await withServer(async base => {
    const notFound = [
      '/api/figures/no-such-figure', // well-formed but unknown
      '/api/figures/Medlineplus-DNA', // uppercase is not a store id
      '/api/figures/medlineplus_dna', // underscores are not store ids
      `/api/figures/${'a'.repeat(81)}`, // over the 80-char bound
      '/api/figures/', // empty id
      '/api/figures/..', // dot segments
      '/api/figures/..%2F..%2Fsources%2Fnasa-grc-drag-equation', // encoded traversal
      `/api/figures/${DNA_FIGURE}.json`, // never serve the sidecar as a "figure id"
      `/api/figures/${DNA_FIGURE}/image/extra`, // unknown third segment
      `/api/figures/${DNA_FIGURE}/bytes`, // the only sub-resource is `image`
      '/api/figures/%2e%2e%2f%2e%2e%2fpackage', // encoded dot-dot slash
    ];
    for (const path of notFound) {
      const res = await fetch(`${base}${path}`);
      assert.equal(res.status, 404, `${path} → 404`);
      assert.deepEqual(await res.json(), { error: 'NOT_FOUND' }, `${path} → the fixed code`);
    }
  });
});

test('GET /api/figures: non-GET methods answer 405', async () => {
  await withServer(async base => {
    for (const method of ['POST', 'PUT', 'DELETE']) {
      const res = await fetch(`${base}/api/figures/${DNA_FIGURE}`, { method, body: '{}' , headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' } });
      assert.equal(res.status, 405, `${method} → 405`);
      assert.deepEqual(await res.json(), { error: 'METHOD_NOT_ALLOWED' });
      const resImage = await fetch(`${base}/api/figures/${DNA_FIGURE}/image`, { method });
      assert.equal(resImage.status, 405, `${method} image → 405`);
    }
  });
});

test('GET /api/figures: the Host allowlist still guards the figure routes', async () => {
  // fetch cannot set a foreign Host header — use a raw node:http request like server.test.ts.
  await withServer(async base => {
    const port = Number(new URL(base).port);
    const res = await new Promise<{ status: number; bodyText: string }>(resolve => {
      const req = httpRequest(
        {
          host: '127.0.0.1',
          port,
          method: 'GET',
          path: `/api/figures/${DNA_FIGURE}`,
          headers: { host: `attacker.example:${port}` },
        },
        r => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () =>
            resolve({ status: r.statusCode ?? 0, bodyText: Buffer.concat(chunks).toString('utf8') }),
          );
        },
      );
      req.end();
    });
    assert.equal(res.status, 403);
    assert.deepEqual(JSON.parse(res.bodyText), { error: 'HOST_NOT_ALLOWED' });
  });
});
