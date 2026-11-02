#!/usr/bin/env node
// Kinetext video scene driver (docs/video/CAPTURE.md). Plays the demo scenes in a clean 2560x1440 (or --size) Chrome app window
// with a visible fake cursor, one scene per F8 press, so every take clicks and pauses the same way.
//
//   node scripts/video/drive.mjs <all|N|N,M,...> [--dry] [--auto] [--job <id>] [--shots <dir>] [--close]
//
//   --dry    rehearsal against a read-only API: stops scene 3 before Build, skips Publish, and blocks every
//            non-GET /api request at the browser (a safety net, so a rehearsal can never write).
//   --auto   start each scene at once instead of waiting for F8 (rehearsals).
//   --job    the run scenes 4-5 act on when scene 3 has not built one in this session.
//   --shots  save a CDP screenshot at each scene's marked moments, plus timings.json, into this directory.
//   --close  close the Chrome window at the end (otherwise it stays open for the next take).

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { connect, devtoolsJson } from './cdp.mjs';
import { SCENES } from './scenes.mjs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9333;
const BASE = 'http://127.0.0.1:5173';
// Calvin, 3 Nov: record at 1440p (more of the app fits; the edit exports 1080p). `--size 1920x1080` for a 1080p take.
const SIZE = (() => {
  const i = process.argv.indexOf('--size');
  const m = i >= 0 ? /^(\d+)x(\d+)$/.exec(process.argv[i + 1] ?? '') : null;
  return m !== null ? { width: Number(m[1]), height: Number(m[2]) } : { width: 2560, height: 1440 };
})();
// A throwaway profile, so no extensions, saved logins or old app state leak into a take.
const PROFILE = process.env.VIDEO_CHROME_PROFILE
  ?? join(process.env.LOCALAPPDATA ?? '.', 'hermes/profiles/meta-hackathon-2026/cache/scratch/video-chrome');
const WAIT_MS = 20_000;
const MOVE_MS = 450;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- arguments ---------------------------------------------------------------------------------------------------

function parseArgs(argv) {
  const o = { which: null, dry: false, auto: false, job: null, shots: null, close: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry') o.dry = true;
    else if (a === '--auto') o.auto = true;
    else if (a === '--close') o.close = true;
    else if (a === '--job') o.job = argv[++i];
    else if (a === '--shots') o.shots = resolve(argv[++i]);
    else if (a === '--size') i++; // read by SIZE above
    else if (!a.startsWith('--') && o.which === null) o.which = a;
    else throw new Error(`unknown argument ${a}`);
  }
  if (o.which === null) throw new Error('usage: drive.mjs <all|N|N,M> [--dry] [--auto] [--job <id>] [--shots <dir>] [--size WxH] [--close]');
  const nums = o.which === 'all' ? SCENES.map((_, i) => i + 1) : o.which.split(',').map(Number);
  if (nums.some((n) => !Number.isInteger(n) || n < 1 || n > SCENES.length)) throw new Error(`no such scene: ${o.which}`);
  return { ...o, scenes: nums };
}

// ---- in-page overlay: the fake cursor, the F8 trigger, element lookup and slow scrolling ------------------------------
// Serialized into the page with Page.addScriptToEvaluateOnNewDocument, so it survives every navigation.

function overlay() {
  if (window.__vd) return;
  const install = () => {
    const style = document.createElement('style');
    // The OS cursor is hidden over the page: only the scripted arrow is ever on screen.
    style.textContent = `html, html * { cursor: none !important; }
      #__vd-cursor { position: fixed; left: 0; top: 0; z-index: 2147483647; pointer-events: none; width: 30px; height: 30px;
        transform: translate(var(--vd-x, 1500px), var(--vd-y, 820px));
        transition: transform var(--vd-ms, 450ms) cubic-bezier(.45, 0, .55, 1); }
      #__vd-cursor svg { display: block; transform-origin: 3px 2px; transition: transform 110ms ease-out;
        filter: drop-shadow(0 1px 2px rgba(0, 0, 0, .4)); }
      #__vd-cursor.down svg { transform: scale(.8); }`;
    const c = document.createElement('div');
    c.id = '__vd-cursor';
    c.setAttribute('aria-hidden', 'true');
    // Arrow tip at (3, 2): the driver offsets nothing, the tip sits exactly on the click point.
    c.innerHTML = '<svg width="30" height="30" viewBox="0 0 30 30"><path d="M3 2 L3 23 L8.6 17.6 L12.3 26 L16.1 24.4 L12.5 16.2 L20 16.2 Z" fill="#111" stroke="#fff" stroke-width="1.7" stroke-linejoin="round"/></svg>';
    c.style.left = '-3px';
    c.style.top = '-2px';
    document.documentElement.append(style, c);
  };
  if (document.documentElement) install(); else document.addEventListener('DOMContentLoaded', install, { once: true });

  // F8 starts the next scene; capture phase and swallowed, so the app never sees it.
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'F8') return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (typeof window.__vdF8 === 'function') window.__vdF8('F8');
  }, true);

  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  };
  const match = (t) => {
    const want = t.text?.toLowerCase();
    return [...document.querySelectorAll(t.css)].find((el) => visible(el) && (want === undefined || el.textContent.toLowerCase().includes(want))) ?? null;
  };
  const el = (targets) => { for (const t of targets) { const m = match(t); if (m !== null) return m; } return null; };
  const scroller = (node) => {
    for (let p = node.parentElement; p !== null; p = p.parentElement) {
      const oy = getComputedStyle(p).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight + 1) return p;
    }
    return document.scrollingElement;
  };
  window.__vd = {
    cursor(x, y, ms) {
      const c = document.getElementById('__vd-cursor');
      if (c === null) return;
      c.style.setProperty('--vd-ms', `${ms}ms`);
      c.style.setProperty('--vd-x', `${x}px`);
      c.style.setProperty('--vd-y', `${y}px`);
    },
    down(on) { document.getElementById('__vd-cursor')?.classList.toggle('down', on); },
    /** The first visible match of the first target that has one: its box, and whether it is fully on screen. */
    find(targets) {
      const m = el(targets);
      if (m === null) return null;
      const r = m.getBoundingClientRect();
      // On screen means inside every clipping panel too (the app's window frame clips its scroll panels).
      let top = 0, left = 0, bottom = innerHeight, right = innerWidth;
      for (let p = m.parentElement; p !== null; p = p.parentElement) {
        if (getComputedStyle(p).overflowY === 'visible') continue;
        const b = p.getBoundingClientRect();
        top = Math.max(top, b.top); left = Math.max(left, b.left); bottom = Math.min(bottom, b.bottom); right = Math.min(right, b.right);
      }
      const inView = r.top >= top && r.left >= left && r.bottom <= bottom && r.right <= right;
      return { x: r.left, y: r.top, w: r.width, h: r.height, inView, text: m.textContent.trim().slice(0, 60) };
    },
    /** Scroll the element's own scroll box (the app scrolls panels, not the page) with an eased animation. */
    reveal(targets, block, ms, offset) {
      const m = el(targets);
      if (m === null) return Promise.resolve(false);
      const sc = scroller(m);
      const box = sc === document.scrollingElement ? { top: 0, height: innerHeight } : sc.getBoundingClientRect();
      const r = m.getBoundingClientRect();
      const delta = block === 'center' ? (r.top + r.height / 2) - (box.top + box.height / 2) : r.top - box.top - offset;
      const from = sc.scrollTop;
      const to = Math.max(0, Math.min(sc.scrollHeight - sc.clientHeight, from + delta));
      if (Math.abs(to - from) < 2) return Promise.resolve(true);
      const prev = sc.style.scrollBehavior;
      sc.style.scrollBehavior = 'auto';
      const t0 = performance.now();
      return new Promise((done) => {
        const step = (now) => {
          const k = Math.min(1, (now - t0) / ms);
          const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
          sc.scrollTop = from + (to - from) * e;
          if (k < 1) requestAnimationFrame(step); else { sc.style.scrollBehavior = prev; done(true); }
        };
        requestAnimationFrame(step);
      });
    },
  };
}

// ---- Chrome --------------------------------------------------------------------------------------------------------

async function openChrome(startUrl) {
  if (await devtoolsJson(PORT, '/json/version') === null) {
    mkdirSync(PROFILE, { recursive: true });
    const args = [
      `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, `--app=${startUrl}`,
      `--window-position=0,0`, `--window-size=${SIZE.width},${SIZE.height}`,
      // CSS pixels = screen pixels, so the page is exactly SIZE on the recording whatever Windows scaling is.
      '--force-device-scale-factor=1',
      '--no-first-run', '--no-default-browser-check', '--disable-session-crashed-bubble', '--hide-crash-restore-bubble',
      '--disable-features=Translate,MediaRouter,OptimizationHints', '--disable-sync', '--password-store=basic',
      // Keep animations running at full rate even when the window is behind Tella or the terminal.
      '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    ];
    spawn(CHROME, args, { detached: true, stdio: 'ignore' }).unref();
    console.log('Launched Chrome (app window, own profile).');
  } else {
    console.log('Reusing the open Chrome window.');
  }
  for (let i = 0; i < 100; i++) {
    const pages = (await devtoolsJson(PORT, '/json/list'))?.filter((t) => t.type === 'page') ?? [];
    const page = pages.find((t) => t.url.startsWith(BASE)) ?? pages[0];
    if (page !== undefined) return page;
    await sleep(150);
  }
  throw new Error(`Chrome did not open a page on port ${PORT}`);
}

async function browserClose() {
  const v = await devtoolsJson(PORT, '/json/version');
  if (v === null) return;
  const b = await connect(v.webSocketDebuggerUrl);
  await b.send('Browser.close').catch(() => {});
  b.close();
}

// ---- the driver ----------------------------------------------------------------------------------------------------

class Driver {
  constructor(cdp, opts) {
    this.cdp = cdp;
    this.opts = opts;
    this.cur = { x: 1500, y: 820 };
    this.ctx = { job: opts.job, builtJob: null, base: BASE, dry: opts.dry };
    this.blocked = [];
    this.where = '';
  }

  async setup() {
    const { cdp } = this;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Runtime.addBinding', { name: '__vdF8' });
    const src = `(${overlay.toString()})()`;
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: src });
    await this.eval(src);
    if (this.opts.dry) {
      // Safety net for rehearsals: any write to the API is refused before it leaves the browser.
      await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*/api/*', requestStage: 'Request' }] });
      cdp.on('Fetch.requestPaused', ({ requestId, request }) => {
        if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) { // A navigation can cancel the request first: nothing to continue then.
          cdp.send('Fetch.continueRequest', { requestId }).catch(() => {}); return; }
        this.blocked.push(`${request.method} ${request.url}`);
        console.warn(`  [dry] BLOCKED ${request.method} ${request.url}`);
        cdp.send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }).catch(() => {});
      });
    } else {
      // The live take: remember the job id the Build click creates (POST /api/jobs answers { jobId }).
      await cdp.send('Network.enable');
      const posts = new Set();
      cdp.on('Network.requestWillBeSent', ({ requestId, request }) => {
        if (request.method === 'POST' && /\/api\/jobs$/.test(new URL(request.url).pathname)) posts.add(requestId);
      });
      cdp.on('Network.loadingFinished', async ({ requestId }) => {
        if (!posts.delete(requestId)) return;
        try {
          const { body } = await cdp.send('Network.getResponseBody', { requestId });
          const id = JSON.parse(body).jobId;
          if (typeof id === 'string') { this.ctx.builtJob = id; this.ctx.job = id; console.log(`  Build started: ${id}`); }
        } catch { /* the step waiting for the lesson reports a failed build */ }
      });
    }
    await this.fitWindow();
  }

  /** Make the page area exactly SIZE at screen 0,0: fullscreen when the screen is that size, else a window sized round it. */
  async fitWindow() {
    const { windowId } = await this.cdp.send('Browser.getWindowForTarget');
    const scr = await this.eval('({ w: screen.width, h: screen.height, dpr: devicePixelRatio })');
    if (scr.w === SIZE.width && scr.h === SIZE.height) {
      await this.cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'fullscreen' } });
    } else {
      await this.cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
      let w = SIZE.width, h = SIZE.height;
      for (let i = 0; i < 3; i++) {
        await this.cdp.send('Browser.setWindowBounds', { windowId, bounds: { left: 0, top: 0, width: w, height: h } });
        await sleep(250);
        const inner = await this.eval('[innerWidth, innerHeight]');
        if (inner[0] === SIZE.width && inner[1] === SIZE.height) break;
        w += SIZE.width - inner[0];
        h += SIZE.height - inner[1];
      }
      // Slide the frame off the top-left edge so the page itself sits at screen 0,0: Tella then records the region
      // 0,0 to SIZE and the app-mode title bar is never in the shot. Windows' resize borders are invisible.
      const o = await this.eval('({ ow: outerWidth, oh: outerHeight, iw: innerWidth, ih: innerHeight })');
      const side = Math.round((o.ow - o.iw) / 2);
      const title = o.oh - o.ih - side;
      await this.cdp.send('Browser.setWindowBounds', { windowId, bounds: { left: -side, top: -title } });
    }
    await sleep(250);
    const inner = await this.eval('[innerWidth, innerHeight, devicePixelRatio, screenX, screenY]');
    console.log(`Screen ${scr.w}x${scr.h}; page area ${inner[0]}x${inner[1]} at device scale ${inner[2]}; window frame at ${inner[3]},${inner[4]}.`);
    if (inner[0] !== SIZE.width || inner[1] !== SIZE.height) console.warn(`  WARNING: the page area is not ${SIZE.width}x${SIZE.height} (screen too small?).`);
  }

  async eval(expression) {
    const r = await this.cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`page error: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result.value;
  }

  /** Targets: a CSS string, { css, text } (visible element whose text contains `text`), or a list tried in order. */
  norm(target) {
    const t = typeof target === 'function' ? target(this.ctx) : target;
    return (Array.isArray(t) ? t : [t]).map((x) => (typeof x === 'string' ? { css: x } : x));
  }

  async find(targets) { return this.eval(`window.__vd ? __vd.find(${JSON.stringify(targets)}) : null`); }

  async waitFor(target, timeout = WAIT_MS) {
    const targets = this.norm(target);
    const until = Date.now() + timeout;
    for (;;) {
      const box = await this.find(targets).catch(() => null);
      if (box !== null) return { box, targets };
      if (Date.now() > until) throw new Error(`${this.where}: ${JSON.stringify(targets)} not on screen within ${timeout / 1000} s`);
      await sleep(120);
    }
  }

  async moveTo(x, y, ms = MOVE_MS) {
    x = Math.round(x); y = Math.round(y);
    await this.eval(`__vd.cursor(${x}, ${y}, ${ms})`);
    await sleep(ms + 40);
    // A real mouse move on arrival, so hover styles show under the fake cursor.
    await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    this.cur = { x, y };
  }

  /** Wait for the element, bring it on screen if it is not, then glide the cursor to its centre. */
  async reach(target, timeout) {
    let { box, targets } = await this.waitFor(target, timeout);
    if (!box.inView) {
      await this.eval(`__vd.reveal(${JSON.stringify(targets)}, 'center', 700, 0)`);
      box = (await this.waitFor(targets, 2000)).box;
    }
    // Lists re-sort and panels scroll themselves after a click: aim only once the target has stopped moving.
    for (let i = 0; i < 12; i++) {
      await sleep(120);
      const again = (await this.waitFor(targets, 2000)).box;
      const still = Math.abs(again.x - box.x) < 1 && Math.abs(again.y - box.y) < 1;
      box = again;
      if (still) break;
    }
    const pt = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
    await this.moveTo(pt.x, pt.y);
    return pt;
  }

  async click(target, timeout) {
    const { x, y } = await this.reach(target, timeout);
    if (process.env.VIDEO_DEBUG) console.log(`  click ${Math.round(x)},${Math.round(y)} ${JSON.stringify(this.norm(target))}`);
    await this.eval('__vd.down(true)');
    await this.cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: this.cur.x, y: this.cur.y, button: 'left', clickCount: 1 });
    await sleep(90);
    await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: this.cur.x, y: this.cur.y, button: 'left', clickCount: 1 });
    await this.eval('__vd.down(false)');
    await sleep(160);
    return { x, y };
  }

  async goto(path) {
    const loaded = this.cdp.once('Page.loadEventFired', () => true, WAIT_MS);
    await this.cdp.send('Page.navigate', { url: BASE + path });
    await loaded;
    // A new document starts the cursor at its default spot: put it back where it was, without a glide.
    await this.eval(`__vd.cursor(${this.cur.x}, ${this.cur.y}, 0)`);
  }

  async shot(name) {
    if (this.opts.shots === null) return;
    mkdirSync(this.opts.shots, { recursive: true });
    const { data } = await this.cdp.send('Page.captureScreenshot', { format: 'png' });
    const file = join(this.opts.shots, `${name}.png`);
    writeFileSync(file, Buffer.from(data, 'base64'));
    console.log(`  shot ${file}`);
  }

  waitF8() {
    return new Promise((done) => { const off = this.cdp.on('Runtime.bindingCalled', (p) => { if (p.name === '__vdF8') { off(); done(); } }); });
  }

  /** Run one step. Returns 'stop' when a dry run ends the scene here. */
  async step(s) {
    if (s.skipInDry && this.opts.dry) { console.log(`  [dry] skipped: ${s.name ?? Object.keys(s)[0]}`); return; }
    if (s.optional) {
      const found = await this.waitFor(s.optional === true ? (s.click ?? s.move ?? s.scroll ?? s.wait) : s.optional, s.timeout ?? 2500).catch(() => null);
      if (found === null) { console.log(`  (not on screen, skipped: ${s.name ?? 'optional step'})`); return; }
    }
    if (s.dryStop !== undefined && this.opts.dry) { console.log(`  [dry] scene stops here: ${s.dryStop}`); return 'stop'; }
    if (s.goto !== undefined) await this.goto(typeof s.goto === 'function' ? s.goto(this.ctx) : s.goto);
    else if (s.wait !== undefined) await this.waitFor(s.wait, s.timeout);
    else if (s.move !== undefined) await this.reach(s.move, s.timeout);
    else if (s.click !== undefined) {
      await this.click(s.click, s.timeout);
      // `expect`: what the click should change. One calm retry if it did not (a click that landed mid-re-render).
      if (s.expect !== undefined && await this.waitFor(s.expect, 2500).catch(() => null) === null) {
        console.log('  (click did not take, once more)');
        await this.click(s.click, s.timeout);
        await this.waitFor(s.expect, 2500);
      }
    }
    else if (s.park !== undefined) await this.moveTo(s.park[0], s.park[1], s.ms ?? MOVE_MS);
    else if (s.scroll !== undefined) {
      const { targets } = await this.waitFor(s.scroll, s.timeout);
      await this.eval(`__vd.reveal(${JSON.stringify(targets)}, ${JSON.stringify(s.block ?? 'start')}, ${s.ms ?? 900}, ${s.offset ?? 16})`);
    } else if (s.pause !== undefined) await sleep(s.pause);
    else if (s.type !== undefined) await this.cdp.send('Input.insertText', { text: s.type });
    else if (s.shot !== undefined) await this.shot(s.shot);
    else if (s.run !== undefined) await s.run(this);
  }

  async scene(n) {
    const sc = SCENES[n - 1];
    console.log(`\n=== Scene ${n} armed: ${sc.title}`);
    console.log(`    First line: "${sc.firstLine}"`);
    if (!this.opts.auto) { console.log('    Press F8 in the app window to start.'); await this.waitF8(); }
    const t0 = Date.now();
    for (const [i, s] of sc.steps.entries()) {
      this.where = `scene ${n} step ${i + 1} (${s.name ?? Object.keys(s).find((k) => !['timeout', 'name'].includes(k))})`;
      if (await this.step(s) === 'stop') break;
    }
    const secs = (Date.now() - t0) / 1000;
    console.log(`    Scene ${n} done in ${secs.toFixed(1)} s (script: ${sc.scriptSecs} s).`);
    return { scene: n, title: sc.title, seconds: Number(secs.toFixed(1)), scriptSeconds: sc.scriptSecs };
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  console.log(`Kinetext scene driver: scenes ${opts.scenes.join(', ')}${opts.dry ? ' (dry rehearsal)' : ' (LIVE take)'}`);
  const page = await openChrome(`${BASE}/?welcome=0&tour=0&view=lessons`);
  const cdp = await connect(page.webSocketDebuggerUrl);
  const d = new Driver(cdp, opts);
  const timings = [];
  try {
    await d.setup();
    for (const n of opts.scenes) timings.push(await d.scene(n));
  } catch (e) {
    console.error(`\nFAILED: ${e.message}`);
    process.exitCode = 1;
  } finally {
    if (opts.shots !== null) {
      mkdirSync(opts.shots, { recursive: true });
      writeFileSync(join(opts.shots, `timings-${opts.scenes.join('-')}.json`), JSON.stringify({ dry: opts.dry, job: d.ctx.job, timings, blocked: d.blocked }, null, 2));
    }
    if (opts.dry) console.log(`\nWrites blocked by the dry guard: ${d.blocked.length === 0 ? 'none' : d.blocked.join('; ')}`);
    cdp.close();
    if (opts.close) await browserClose();
  }
}

await main();
