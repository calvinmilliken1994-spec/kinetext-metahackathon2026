#!/usr/bin/env node
// `npm start`: one command that serves the app and its API on one local port.
//
//   1. checks Node can run the TypeScript sources directly;
//   2. loads .env and .env.local from the repo root (variables already set in the environment win;
//      values are never printed);
//   3. builds apps/web when apps/web/dist is missing or older than its sources (installing the web
//      app's packages first if they are missing);
//   4. starts apps/api/main.ts with WEB_DIST_DIR set, so the API also serves the built app;
//   5. waits for GET /api/health, prints the URL and what works, and opens the browser (best effort).
//
// Modes (decided by apps/api/relay.ts selectApiMode):
//   MODEL_API_KEY in .env            -> your own Meta key, live builds on (Muse Spark 1.3 + SAM)
//   no key + relay in config/relay.json -> relay mode: enter the access code in the app
//   neither                          -> read-only: recorded lessons, Demo, Results, presenting
//
// Flags: --no-open (do not open a browser), --rebuild (force a web build), --no-build (never build).
// Environment: PORT (default 8787, the next free port is used when it is taken), NO_OPEN=1.

import { execSync, spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_PORT = 8787;

/* ------------------------------------------------------------------ */
/* pure helpers (tests/start.test.mjs)                                   */
/* ------------------------------------------------------------------ */

export function parseArgs(argv) {
  return {
    open: !argv.includes('--no-open'),
    rebuild: argv.includes('--rebuild'),
    noBuild: argv.includes('--no-build'),
  };
}

/** Node runs .ts files without a flag from 22.18, 23.6 and every 24+. */
export function nodeSupportsTypeStripping(version) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (m === null) {
    return false;
  }
  const major = Number(m[1]);
  const minor = Number(m[2]);
  return major >= 24 || (major === 23 && minor >= 6) || (major === 22 && minor >= 18);
}

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git']);

/** Newest file mtime (ms) under a file or folder; 0 when it does not exist. */
function newestMtime(path) {
  let st;
  try {
    st = statSync(path);
  } catch {
    return 0;
  }
  if (!st.isDirectory()) {
    return st.mtimeMs;
  }
  let newest = 0;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (entry.isDirectory() && (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.'))) {
      continue;
    }
    newest = Math.max(newest, newestMtime(join(path, entry.name)));
  }
  return newest;
}

/** Does the web app need building? `distIndex` is overridable for tests. */
export function buildDecision(root, { rebuild, noBuild, distIndex = join(root, 'apps/web/dist/index.html') }) {
  let built;
  try {
    built = statSync(distIndex).mtimeMs;
  } catch {
    built = null;
  }
  if (noBuild) {
    return { build: false, reason: built === null ? 'web app not built' : 'build skipped (--no-build)' };
  }
  if (rebuild) {
    return { build: true, reason: 'rebuild requested' };
  }
  if (built === null) {
    return { build: true, reason: 'web app not built yet' };
  }
  const web = join(root, 'apps/web');
  const sources = [
    join(web, 'index.html'),
    join(web, 'src'),
    join(web, 'public'),
    join(web, 'vite.config.ts'),
    join(web, 'tsconfig.json'),
    join(web, 'package.json'),
    join(root, 'packages'), // the web app imports the tested engines and contracts from here
  ];
  const newest = Math.max(...sources.map(newestMtime));
  return newest > built
    ? { build: true, reason: 'sources changed since the last build' }
    : { build: false, reason: 'up to date' };
}

/**
 * Fill missing variables from .env style files, in order (the first file to define a variable wins,
 * and anything already in `target` wins over every file). Returns the files that were read.
 * Values are never printed.
 */
export function loadEnvFiles(files, target = process.env) {
  const read = [];
  for (const file of files) {
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    read.push(file);
    for (const [key, value] of Object.entries(parseEnv(text))) {
      if (target[key] === undefined) {
        target[key] = value;
      }
    }
  }
  return read;
}

/** The environment for the API process. Does not mutate `env`. */
export function serverEnv(env, { port, webDist }) {
  const out = { ...env, PORT: String(port), WEB_DIST_DIR: webDist };
  // An own Meta key in .env means direct live mode (Muse Spark 1.3 + SAM on that key).
  if ((env.MODEL_API_KEY ?? '').trim() !== '' && env.META_LIVE === undefined) {
    out.META_LIVE = '1';
  }
  return out;
}

/** One plain sentence about what this run can do. Never contains a key or a code. */
export function describeMode(mode, relayUrl) {
  if (mode === 'relay') {
    const host = relayUrl === '' ? 'the relay' : new URL(relayUrl).host;
    return `Live builds: enter the access code from the submission notes on the welcome screen (builds go through ${host}).`;
  }
  if (mode === 'direct') {
    return 'Live builds: on, using the MODEL_API_KEY from your environment (your own Meta credit). Muse Spark Open needs MODAL_PROXY_TOKEN, so it shows recorded lessons only.';
  }
  return 'Live builds are unavailable: no MODEL_API_KEY in .env and no relay configured. Recorded lessons, the Demo, Results and presenting all work.';
}

/** First free port at or after `start` (up to `tries` ports). Rejects with PORT_UNAVAILABLE. */
export async function findFreePort(start, tries = 10) {
  for (let port = start; port < start + tries; port += 1) {
    const free = await new Promise(resolveFree => {
      const probe = createServer();
      probe.once('error', () => resolveFree(false));
      probe.listen(port, '127.0.0.1', () => probe.close(() => resolveFree(true)));
    });
    if (free) {
      return port;
    }
  }
  throw new Error('PORT_UNAVAILABLE');
}

/* ------------------------------------------------------------------ */
/* the launcher                                                         */
/* ------------------------------------------------------------------ */

function say(line = '') {
  console.log(line);
}

function openBrowser(url) {
  try {
    const [cmd, args] =
      process.platform === 'win32'
        ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
        : process.platform === 'darwin'
          ? ['open', [url]]
          : ['xdg-open', [url]];
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    // best effort: the URL is printed anyway
  }
}

async function waitForHealth(port, child, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      return false;
    }
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (res.ok) {
        return true;
      }
    } catch {
      // not listening yet
    }
    await new Promise(r => setTimeout(r, 250));
  }
  return false;
}

function run(command) {
  execSync(command, { cwd: ROOT, stdio: 'inherit' });
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!nodeSupportsTypeStripping(process.version)) {
    console.error(`Node ${process.version} cannot run this project's TypeScript sources directly.`);
    console.error('Install Node 24 (or 22.18 or newer) from https://nodejs.org and run npm start again.');
    return 1;
  }
  if (!existsSync(join(ROOT, 'node_modules', 'ajv'))) {
    console.error('Dependencies are missing. Run `npm install` in this folder first, then `npm start`.');
    return 1;
  }

  // .env first (your own key), then .env.local. The environment already set wins.
  const envFiles = process.env.ENV_FILE === ''
    ? []
    : process.env.ENV_FILE !== undefined
      ? [resolve(ROOT, process.env.ENV_FILE)]
      : [join(ROOT, '.env'), join(ROOT, '.env.local')];
  const loaded = loadEnvFiles(envFiles);
  if (loaded.length > 0) {
    say(`Loaded settings from ${loaded.map(f => f.slice(ROOT.length + 1)).join(', ')}`);
  }

  // The web app.
  const decision = buildDecision(ROOT, args);
  const distDir = join(ROOT, 'apps/web/dist');
  if (decision.build) {
    say(`Building the web app (${decision.reason}). This takes a minute the first time.`);
    try {
      if (!existsSync(join(ROOT, 'apps/web/node_modules', 'vite'))) {
        say('Installing the web app packages...');
        run('npm --prefix apps/web install');
      }
      run('npm --prefix apps/web run build');
    } catch {
      console.error('The web build failed. Fix the error above, or run `npm install` and try again.');
      return 1;
    }
  }
  if (!existsSync(join(distDir, 'index.html'))) {
    console.error('The web app is not built (apps/web/dist is missing). Run npm start without --no-build.');
    return 1;
  }

  // The API.
  let port;
  try {
    port = process.env.PORT !== undefined && /^[0-9]+$/.test(process.env.PORT)
      ? Number(process.env.PORT)
      : await findFreePort(DEFAULT_PORT, 10);
  } catch {
    console.error(`No free port found from ${DEFAULT_PORT}. Set PORT to a free port and try again.`);
    return 1;
  }
  const env = serverEnv(process.env, { port, webDist: distDir });
  const relay = await import(pathToFileURL(join(ROOT, 'apps/api/relay.ts')).href);
  let relayUrl = '';
  let mode;
  try {
    relayUrl = relay.loadRelayConfig().url;
    mode = relay.selectApiMode(env, relayUrl);
  } catch (err) {
    console.error(`Cannot start: ${err instanceof Error ? err.message : 'bad configuration'} (see config/relay.json).`);
    return 1;
  }

  const child = spawn(process.execPath, [join(ROOT, 'apps/api/main.ts')], { cwd: ROOT, env, stdio: ['ignore', 'inherit', 'inherit'] });
  const stop = () => {
    if (child.exitCode === null) {
      child.kill('SIGINT');
    }
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  const exited = new Promise(resolveExit => child.on('exit', code => resolveExit(code ?? 0)));

  if (!(await waitForHealth(port, child))) {
    if (child.exitCode === null) {
      stop();
      console.error(`The server did not answer on port ${port} in time.`);
    } else {
      console.error(`The server stopped while starting (see the message above). If port ${port} is in use, set PORT to a free one.`);
    }
    return 1;
  }
  const url = `http://127.0.0.1:${port}`;
  say();
  say(`  Kinetext is running at ${url}`);
  say(`  ${describeMode(mode, relayUrl)}`);
  say('  Press Ctrl+C to stop.');
  say();
  if (args.open && process.env.NO_OPEN !== '1' && process.env.CI === undefined) {
    openBrowser(url);
  }
  return exited;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then(
    code => process.exit(typeof code === 'number' ? code : 0),
    err => {
      console.error(`npm start failed: ${err instanceof Error ? err.message : 'unknown error'}`);
      process.exit(1);
    },
  );
}
