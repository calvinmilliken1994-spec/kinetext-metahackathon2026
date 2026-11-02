// Stage 11 slice L — the pure parts of `npm start` (scripts/start.mjs). No servers, no network, no browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildDecision,
  describeMode,
  findFreePort,
  loadEnvFiles,
  nodeSupportsTypeStripping,
  parseArgs,
  serverEnv,
} from '../scripts/start.mjs';

test('start: parseArgs reads the flags and ignores unknown words', () => {
  assert.deepEqual(parseArgs([]), { open: true, rebuild: false, noBuild: false });
  assert.deepEqual(parseArgs(['--no-open']), { open: false, rebuild: false, noBuild: false });
  assert.deepEqual(parseArgs(['--rebuild', '--no-build', 'whatever']), { open: true, rebuild: true, noBuild: true });
});

test('start: Node must be able to run the TypeScript sources directly', () => {
  for (const ok of ['24.0.0', '24.14.1', '25.1.0', '22.18.0', '22.20.3', '23.6.0', '23.11.0']) {
    assert.equal(nodeSupportsTypeStripping(ok), true, ok);
  }
  for (const bad of ['20.19.0', '22.0.0', '22.17.9', '23.5.0', '21.7.3', 'garbage', '']) {
    assert.equal(nodeSupportsTypeStripping(bad), false, bad);
  }
});

function touch(file, ms) {
  const t = new Date(ms);
  utimesSync(file, t, t);
}

function site() {
  const root = mkdtempSync(join(tmpdir(), 'start-site-'));
  mkdirSync(join(root, 'apps/web/src/lib'), { recursive: true });
  mkdirSync(join(root, 'apps/web/public'), { recursive: true });
  mkdirSync(join(root, 'apps/web/dist/assets'), { recursive: true });
  mkdirSync(join(root, 'apps/web/node_modules/x'), { recursive: true });
  mkdirSync(join(root, 'packages/contracts'), { recursive: true });
  writeFileSync(join(root, 'apps/web/index.html'), '<html>');
  writeFileSync(join(root, 'apps/web/src/App.tsx'), 'a');
  writeFileSync(join(root, 'apps/web/src/lib/x.ts'), 'a');
  writeFileSync(join(root, 'apps/web/public/logo.svg'), 'a');
  writeFileSync(join(root, 'packages/contracts/index.ts'), 'a');
  writeFileSync(join(root, 'apps/web/node_modules/x/huge.js'), 'a');
  writeFileSync(join(root, 'apps/web/dist/index.html'), '<html>');
  return root;
}

const T0 = Date.UTC(2026, 10, 1);

test('start: no dist folder means a build is needed', () => {
  const root = site();
  const dist = join(root, 'apps/web/dist/index.html');
  writeFileSync(join(root, 'nothing'), '');
  const missing = buildDecision(root, { rebuild: false, noBuild: false, distIndex: join(root, 'apps/web/dist/missing.html') });
  assert.equal(missing.build, true);
  assert.match(missing.reason, /not built/i);
  assert.equal(typeof dist, 'string');
});

test('start: a dist newer than every source is used as is', () => {
  const root = site();
  for (const f of ['apps/web/index.html', 'apps/web/src/App.tsx', 'apps/web/src/lib/x.ts', 'apps/web/public/logo.svg', 'packages/contracts/index.ts']) {
    touch(join(root, f), T0);
  }
  touch(join(root, 'apps/web/dist/index.html'), T0 + 60_000);
  assert.deepEqual(buildDecision(root, { rebuild: false, noBuild: false }), { build: false, reason: 'up to date' });
});

test('start: a source newer than dist (web src, public, index.html or shared packages) means a rebuild', () => {
  for (const f of ['apps/web/index.html', 'apps/web/src/lib/x.ts', 'apps/web/public/logo.svg', 'packages/contracts/index.ts']) {
    const root = site();
    for (const g of ['apps/web/index.html', 'apps/web/src/App.tsx', 'apps/web/src/lib/x.ts', 'apps/web/public/logo.svg', 'packages/contracts/index.ts']) {
      touch(join(root, g), T0);
    }
    touch(join(root, 'apps/web/dist/index.html'), T0 + 60_000);
    touch(join(root, f), T0 + 120_000);
    const decision = buildDecision(root, { rebuild: false, noBuild: false });
    assert.equal(decision.build, true, f);
    assert.match(decision.reason, /changed/i);
  }
});

test('start: node_modules and the dist folder itself never count as sources', () => {
  const root = site();
  for (const f of ['apps/web/index.html', 'apps/web/src/App.tsx', 'apps/web/src/lib/x.ts', 'apps/web/public/logo.svg', 'packages/contracts/index.ts']) {
    touch(join(root, f), T0);
  }
  touch(join(root, 'apps/web/dist/index.html'), T0 + 60_000);
  touch(join(root, 'apps/web/node_modules/x/huge.js'), T0 + 999_000);
  touch(join(root, 'apps/web/dist/assets'), T0 + 999_000);
  assert.equal(buildDecision(root, { rebuild: false, noBuild: false }).build, false);
});

test('start: --rebuild forces a build, --no-build skips it', () => {
  const root = site();
  for (const f of ['apps/web/index.html', 'apps/web/src/App.tsx', 'apps/web/src/lib/x.ts', 'apps/web/public/logo.svg', 'packages/contracts/index.ts']) {
    touch(join(root, f), T0);
  }
  touch(join(root, 'apps/web/dist/index.html'), T0 + 60_000);
  assert.equal(buildDecision(root, { rebuild: true, noBuild: false }).build, true);
  touch(join(root, 'apps/web/src/App.tsx'), T0 + 120_000);
  assert.equal(buildDecision(root, { rebuild: false, noBuild: true }).build, false, 'stale but told not to build');
  // --no-build with no dist at all cannot serve the app: the caller is told
  const decision = buildDecision(root, { rebuild: false, noBuild: true, distIndex: join(root, 'apps/web/dist/missing.html') });
  assert.equal(decision.build, false);
  assert.match(decision.reason, /not built/i);
});

test('start: .env files fill missing variables only, in order, and never print values', () => {
  const dir = mkdtempSync(join(tmpdir(), 'start-env-'));
  writeFileSync(join(dir, '.env'), 'MKI_T_ONE=from-env\nMKI_T_TWO=from-env\nMKI_T_QUOTED="a b"\n# comment\n');
  writeFileSync(join(dir, '.env.local'), 'MKI_T_TWO=from-local\nMKI_T_THREE=from-local\n');
  const target = { MKI_T_ONE: 'already-set' };
  const loaded = loadEnvFiles([join(dir, '.env'), join(dir, '.env.local'), join(dir, 'absent')], target);
  assert.deepEqual(target, {
    MKI_T_ONE: 'already-set',
    MKI_T_TWO: 'from-env',
    MKI_T_QUOTED: 'a b',
    MKI_T_THREE: 'from-local',
  });
  assert.deepEqual(loaded.map(f => f.split(/[\\/]/).pop()), ['.env', '.env.local']);
});

test('start: serverEnv serves the app, picks the port, and turns on live mode for an own key only', () => {
  const base = { PATH: 'x' };
  const a = serverEnv(base, { port: 8790, webDist: 'C:/dist' });
  assert.equal(a.PORT, '8790');
  assert.equal(a.WEB_DIST_DIR, 'C:/dist');
  assert.equal(a.META_LIVE, undefined, 'no key: no live flag (relay mode or read-only decides)');
  const b = serverEnv({ ...base, MODEL_API_KEY: 'LLM_x' }, { port: 8790, webDist: 'C:/dist' });
  assert.equal(b.META_LIVE, '1', 'an own key means direct live mode');
  const c = serverEnv({ ...base, MODEL_API_KEY: 'LLM_x', META_LIVE: '0' }, { port: 8790, webDist: 'C:/dist' });
  assert.equal(c.META_LIVE, '0', 'an explicit setting is respected');
  const d = serverEnv({ ...base, MODEL_API_KEY: '  ' }, { port: 8790, webDist: 'C:/dist' });
  assert.equal(d.META_LIVE, undefined, 'a blank key is no key');
  assert.equal(base.PORT, undefined, 'the input is not mutated');
});

test('start: describeMode says plainly what works', () => {
  const relay = describeMode('relay', 'https://relay.example.com');
  assert.match(relay, /access code/i);
  const direct = describeMode('direct', '');
  assert.match(direct, /own|MODEL_API_KEY/i);
  const readonly = describeMode('readonly', '');
  assert.match(readonly, /unavailable/i);
  assert.match(readonly, /recorded lessons/i);
  for (const text of [relay, direct, readonly]) {
    assert.equal(/LLM_|wk-|ws-/.test(text), false);
  }
});

test('start: findFreePort skips a busy port', async () => {
  const busy = createServer();
  await new Promise(resolve => busy.listen(0, '127.0.0.1', resolve));
  const taken = busy.address().port;
  try {
    const free = await findFreePort(taken, 5);
    assert.ok(free > taken && free <= taken + 5, String(free));
    await assert.rejects(() => findFreePort(taken, 1), /EADDRINUSE|PORT_UNAVAILABLE/);
  } finally {
    await new Promise(resolve => busy.close(resolve));
  }
});
