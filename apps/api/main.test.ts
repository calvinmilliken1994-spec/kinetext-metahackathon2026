// Stage 11 slice L — the real entry point (apps/api/main.ts) in the two modes that open no ledger:
// read-only (with the built web app served on the same port) and RELAY=1 without a relay url.
// Child processes on a free loopback port and a temp storage dir; no keys, no network, no .env.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRelayConfig } from './relay.ts';

const MAIN = fileURLToPath(new URL('./main.ts', import.meta.url));

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', () => resolve()));
  const port = (probe.address() as AddressInfo).port;
  await new Promise<void>(resolve => probe.close(() => resolve()));
  return port;
}

/** A clean environment: nothing from the developer's shell can switch a mode on. */
function cleanEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of ['MODEL_API_KEY', 'META_LIVE', 'RELAY', 'MODAL_PROXY_TOKEN', 'ACCESS_CODE', 'WEB_DIST_DIR', 'BUILDS_PAUSED']) {
    delete env[key];
  }
  return { ...env, ...extra };
}

function output(child: ChildProcess): { text: () => string } {
  let buf = '';
  child.stdout?.on('data', (d: Buffer) => (buf += d.toString('utf8')));
  child.stderr?.on('data', (d: Buffer) => (buf += d.toString('utf8')));
  return { text: () => buf };
}

async function until(check: () => boolean, ms = 20_000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) {
      return true;
    }
    await new Promise(r => setTimeout(r, 50));
  }
  return false;
}

test('L: read-only start serves the built web app and says live builds are unavailable', async () => {
  const dist = mkdtempSync(join(tmpdir(), 'stage11-main-dist-'));
  mkdirSync(join(dist, 'assets'));
  writeFileSync(join(dist, 'index.html'), '<!doctype html><title>mki-main-test</title>');
  const port = await freePort();
  const child = spawn(process.execPath, [MAIN], {
    env: cleanEnv({ RELAY: '0', PORT: String(port), STORAGE_DIR: mkdtempSync(join(tmpdir(), 'stage11-main-')), WEB_DIST_DIR: dist }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const out = output(child);
  try {
    assert.ok(await until(() => out.text().includes('Serving the web app')), out.text());
    assert.match(out.text(), /live generation: off/);
    assert.match(out.text(), /live builds are unavailable/i);
    const health = (await (await fetch(`http://127.0.0.1:${port}/api/health`)).json()) as { ok: boolean; live: boolean };
    assert.equal(health.ok, true);
    assert.equal(health.live, false);
    const access = (await (await fetch(`http://127.0.0.1:${port}/api/access`)).json()) as { gate: boolean; granted: boolean };
    assert.equal(access.gate, false, 'read-only without a relay: today\'s local behaviour, no gate');
    const page = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /mki-main-test/);
  } finally {
    child.kill();
  }
});

test('L: RELAY=1 without a relay url refuses to start with a plain message', async (t) => {
  if (loadRelayConfig().url !== '') {
    t.skip('config/relay.json has a url: RELAY=1 would start relay mode');
    return;
  }
  const child = spawn(process.execPath, [MAIN], {
    env: cleanEnv({ RELAY: '1', PORT: String(await freePort()), STORAGE_DIR: mkdtempSync(join(tmpdir(), 'stage11-main-')) }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const out = output(child);
  const code = await new Promise<number | null>(resolve => child.on('exit', c => resolve(c)));
  assert.equal(code, 1);
  assert.match(out.text(), /RELAY_URL_MISSING/);
});
