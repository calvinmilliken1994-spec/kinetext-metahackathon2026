// Stage 7e (docs/specs/STAGE-7e-library-and-wording.md) — featured and retired library pages on the API.
// GET /api/sources leaves retired library pages out and marks featured ones; GET /api/sources/:id still serves a retired
// page (flagged), so stored runs and evidence keep working. Ephemeral server on 127.0.0.1:0, fake registry in a temp dir,
// live generation off (startJob null: no ledger, no model client, no network beyond loopback).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from './server.ts';
import type { ApiOptions } from './server.ts';
import { sha256 } from '../../packages/sources/index.ts';

async function withServer(opts: ApiOptions, run: (base: string) => Promise<void>): Promise<void> {
  const server: Server = createApiServer(opts);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    await run(base);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

function fakeRegistry(): URL {
  const dir = mkdtempSync(join(tmpdir(), 's7e-registry-'));
  const text = 'A short licensed page about falling objects.\n';
  writeFileSync(join(dir, 'page.txt'), text);
  const base = {
    locator: 'https://example.gov/page', license: 'US-Gov-Work', attribution: 'Source material: Example Agency, page.',
    sha256: sha256(text), textFile: 'page.txt', retrievedAt: '2026-10-31T00:00:00Z', transcription: 'whole page', purpose: 'test', subject: 'physics',
  };
  writeFileSync(join(dir, 'p-featured.json'), JSON.stringify({ id: 'p-featured', title: 'Free fall', featured: true, ...base }, null, 2));
  writeFileSync(join(dir, 'p-plain.json'), JSON.stringify({ id: 'p-plain', title: 'Weight', ...base }, null, 2));
  writeFileSync(join(dir, 'p-retired.json'), JSON.stringify({ id: 'p-retired', title: 'Old ballistic page', retired: true, ...base }, null, 2));
  return pathToFileURL(`${dir}/`);
}

interface Row { id: string; featured?: boolean; retired?: boolean }

test('GET /api/sources: retired library pages are left out; featured pages say so', async () => {
  const storageDir = mkdtempSync(join(tmpdir(), 's7e-storage-'));
  await withServer({ storageDir, sourcesDir: fakeRegistry(), startJob: null }, async base => {
    const res = await fetch(`${base}/api/sources`);
    assert.equal(res.status, 200);
    const rows = (await res.json()) as Row[];
    assert.deepEqual(rows.map(r => r.id), ['p-featured', 'p-plain']);
    assert.equal(rows[0]?.featured, true);
    assert.equal('featured' in (rows[1] ?? {}), false, 'no featured key on an ordinary page');
    assert.ok(rows.every(r => r.retired === undefined));
  });
});

test('GET /api/sources?include=retired adds retired pages, flagged, so old runs keep their page titles', async () => {
  const storageDir = mkdtempSync(join(tmpdir(), 's7e-storage-'));
  await withServer({ storageDir, sourcesDir: fakeRegistry(), startJob: null }, async base => {
    const rows = (await (await fetch(`${base}/api/sources?include=retired`)).json()) as Row[];
    assert.deepEqual(rows.map(r => r.id), ['p-featured', 'p-plain', 'p-retired']);
    assert.equal(rows[2]?.retired, true);
    assert.equal(rows[0]?.retired, undefined);
    // Any other value of the parameter is the default list.
    const other = (await (await fetch(`${base}/api/sources?include=everything`)).json()) as Row[];
    assert.deepEqual(other.map(r => r.id), ['p-featured', 'p-plain']);
  });
});

test('GET /api/sources/:id still serves a retired page, flagged retired, with its hash-checked text', async () => {
  const storageDir = mkdtempSync(join(tmpdir(), 's7e-storage-'));
  await withServer({ storageDir, sourcesDir: fakeRegistry(), startJob: null }, async base => {
    const res = await fetch(`${base}/api/sources/p-retired`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as Row & { text: string; title: string };
    assert.equal(body.retired, true);
    assert.equal(body.title, 'Old ballistic page');
    assert.equal(body.text, 'A short licensed page about falling objects.\n');
    const featured = (await (await fetch(`${base}/api/sources/p-featured`)).json()) as Row;
    assert.equal(featured.featured, true);
    assert.equal(featured.retired, undefined);
  });
});
