// Stage 11 slice L — serving the built web app from the API (one port for `npm start`).
// Ephemeral servers on 127.0.0.1:0 and a temp dist dir. No network beyond localhost.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from './server.ts';
import type { ApiOptions } from './server.ts';
import { staticDirIfBuilt } from './static.ts';

const INDEX = '<!doctype html><title>mki</title><div id="root"></div>';
const SECRET = 'TOP-SECRET-OUTSIDE-THE-DIST-DIR';

interface Site {
  root: string;
  dist: string;
}

function makeSite(): Site {
  const root = mkdtempSync(join(tmpdir(), 'stage11-static-'));
  const dist = join(root, 'dist');
  mkdirSync(join(dist, 'assets'), { recursive: true });
  mkdirSync(join(dist, 'brand'), { recursive: true });
  writeFileSync(join(dist, 'index.html'), INDEX);
  writeFileSync(join(dist, 'assets', 'index-abc123.js'), 'console.log(1);');
  writeFileSync(join(dist, 'assets', 'index-abc123.css'), 'body{color:red}');
  writeFileSync(join(dist, 'brand', 'mark.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  writeFileSync(join(dist, 'brand', 'photo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  writeFileSync(join(dist, '.hidden'), 'hidden');
  writeFileSync(join(root, 'secret.txt'), SECRET);
  writeFileSync(join(root, 'dist-evil.txt'), SECRET); // shares the "dist" prefix
  return { root, dist };
}

async function withServer(over: Partial<ApiOptions>, run: (base: string, port: number) => Promise<void>): Promise<void> {
  const server: Server = createApiServer({
    storageDir: mkdtempSync(join(tmpdir(), 'stage11-static-storage-')),
    startJob: null,
    ...over,
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as AddressInfo).port;
  try {
    await run(`http://127.0.0.1:${port}`, port);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

/** Raw request: fetch() would normalise `..` away, and these tests are about exactly those paths. */
function raw(port: number, path: string, method = 'GET', headers: Record<string, string> = {}): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, method, agent: false, headers: { host: `127.0.0.1:${port}`, connection: 'close', ...headers } }, res => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('L: GET / serves the built index.html', async () => {
  const { dist } = makeSite();
  await withServer({ staticDir: dist }, async (_base, port) => {
    const res = await raw(port, '/');
    assert.equal(res.status, 200);
    assert.equal(res.body, INDEX);
    assert.match(String(res.headers['content-type']), /^text\/html/);
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['cache-control'], 'no-cache');
    assert.equal((await raw(port, '/index.html')).body, INDEX);
  });
});

test('L: built assets get the right type, nosniff, and long caching for hashed files', async () => {
  const { dist } = makeSite();
  await withServer({ staticDir: dist }, async (_base, port) => {
    const js = await raw(port, '/assets/index-abc123.js');
    assert.equal(js.status, 200);
    assert.equal(js.body, 'console.log(1);');
    assert.match(String(js.headers['content-type']), /^text\/javascript/);
    assert.match(String(js.headers['cache-control']), /immutable/);
    assert.match(String((await raw(port, '/assets/index-abc123.css')).headers['content-type']), /^text\/css/);
    assert.match(String((await raw(port, '/brand/mark.svg')).headers['content-type']), /^image\/svg\+xml/);
    assert.equal((await raw(port, '/brand/photo.png')).headers['content-type'], 'image/png');
    assert.equal(js.headers['x-content-type-options'], 'nosniff');
  });
});

test('L: HEAD answers headers only; other methods are not served', async () => {
  const { dist } = makeSite();
  await withServer({ staticDir: dist }, async (_base, port) => {
    const head = await raw(port, '/', 'HEAD');
    assert.equal(head.status, 200);
    assert.equal(head.body, '');
    assert.ok(Number(head.headers['content-length']) > 0);
    assert.equal((await raw(port, '/', 'POST')).status, 404);
    assert.equal((await raw(port, '/assets/index-abc123.js', 'DELETE')).status, 404);
  });
});

test('L: path traversal never leaves the dist folder', async () => {
  const { dist } = makeSite();
  await withServer({ staticDir: dist }, async (_base, port) => {
    const attacks = [
      '/../secret.txt',
      '/%2e%2e/secret.txt',
      '/%2E%2E/secret.txt',
      '/..%2fsecret.txt',
      '/..%2Fsecret.txt',
      '/assets/../../secret.txt',
      '/assets/%2e%2e/%2e%2e/secret.txt',
      '/assets/..%5c..%5csecret.txt',
      '/..%5csecret.txt',
      '/..\\secret.txt',
      '/%2e%2e%2f%2e%2e%2fsecret.txt',
      '/....//secret.txt',
      '/%252e%252e/secret.txt',
      '/..;/secret.txt',
      '/../dist-evil.txt',
      '//secret.txt',
      '/assets//..//..//secret.txt',
      '/index.html%00.txt',
      '/%00',
      '/.hidden',
      '/assets/.%2e/.%2e/secret.txt',
      '/C:/Windows/win.ini',
      '/C%3A%5CWindows%5Cwin.ini',
      '/%5C%5Clocalhost%5Cc$%5Cwindows%5Cwin.ini',
    ];
    for (const path of attacks) {
      const res = await raw(port, path);
      assert.equal(res.body.includes(SECRET), false, `${path} leaked a file`);
      assert.notEqual(res.body.includes('[fonts]'), true, `${path} leaked win.ini`);
      assert.ok(res.status === 404 || res.status === 400 || res.status === 403 || (res.status === 200 && res.body === INDEX), `${path} -> ${res.status}`);
    }
  });
});

test('L: a symlink inside dist that points outside is not followed', async (t) => {
  const { root, dist } = makeSite();
  try {
    symlinkSync(join(root, 'secret.txt'), join(dist, 'link.txt'));
  } catch {
    t.skip('symlinks are not permitted on this machine');
    return;
  }
  await withServer({ staticDir: dist }, async (_base, port) => {
    const res = await raw(port, '/link.txt');
    assert.equal(res.body.includes(SECRET), false);
    assert.equal(res.status, 404);
  });
});

test('L: /api/* is never answered by the static handler', async () => {
  const { dist } = makeSite();
  await withServer({ staticDir: dist }, async (base, port) => {
    const missing = await raw(port, '/api/nope');
    assert.equal(missing.status, 404);
    assert.match(String(missing.headers['content-type']), /application\/json/);
    assert.deepEqual(JSON.parse(missing.body), { error: 'NOT_FOUND' });
    assert.equal((await raw(port, '/api')).status, 404);
    const health = await fetch(`${base}/api/health`);
    assert.equal(health.status, 200);
    assert.equal(((await health.json()) as { ok: boolean }).ok, true);
  });
});

test('L: unknown pages fall back to the app, unknown files are 404', async () => {
  const { dist } = makeSite();
  await withServer({ staticDir: dist }, async (_base, port) => {
    const page = await raw(port, '/some/where');
    assert.equal(page.status, 200);
    assert.equal(page.body, INDEX);
    const file = await raw(port, '/assets/missing.js');
    assert.equal(file.status, 404);
    assert.deepEqual(JSON.parse(file.body), { error: 'NOT_FOUND' });
    assert.equal((await raw(port, '/assets')).status, 200, 'a folder name with no extension is a page route, never a directory listing');
    assert.equal((await raw(port, '/assets')).body, INDEX);
  });
});

test('L: the Host allowlist still applies to static files', async () => {
  const { dist } = makeSite();
  await withServer({ staticDir: dist }, async (_base, port) => {
    const res = await raw(port, '/', 'GET', { host: 'evil.example' });
    assert.equal(res.status, 403);
    assert.equal(res.body.includes('mki'), false);
  });
});

test('L: without staticDir GET / is the JSON 404 it always was', async () => {
  await withServer({}, async (_base, port) => {
    const res = await raw(port, '/');
    assert.equal(res.status, 404);
    assert.deepEqual(JSON.parse(res.body), { error: 'NOT_FOUND' });
  });
});

test('L: staticDirIfBuilt only returns a folder that holds an index.html', () => {
  const { root, dist } = makeSite();
  assert.equal(staticDirIfBuilt(dist), dist);
  assert.equal(staticDirIfBuilt(join(root, 'nothing-here')), undefined);
  assert.equal(staticDirIfBuilt(root), undefined);
  assert.equal(staticDirIfBuilt(undefined), undefined);
  assert.equal(staticDirIfBuilt(''), undefined);
});
