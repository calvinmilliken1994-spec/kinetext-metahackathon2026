// A tiny Chrome DevTools Protocol client over Node 24's built-in WebSocket (no dependencies).

export async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error(`CDP: cannot connect to ${wsUrl}`)), { once: true });
  });
  let nextId = 1;
  const pending = new Map();
  const listeners = new Map();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(String(ev.data));
    if (msg.id !== undefined) {
      const p = pending.get(msg.id);
      if (p === undefined) return;
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`CDP ${p.method}: ${msg.error.message}`));
      else p.resolve(msg.result);
      return;
    }
    for (const fn of listeners.get(msg.method) ?? []) fn(msg.params);
  });
  ws.addEventListener('close', () => {
    for (const p of pending.values()) p.reject(new Error(`CDP ${p.method}: connection closed`));
    pending.clear();
  });
  return {
    send(method, params = {}) {
      const id = nextId++;
      ws.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject, method }));
    },
    on(method, fn) {
      if (!listeners.has(method)) listeners.set(method, new Set());
      listeners.get(method).add(fn);
      return () => listeners.get(method).delete(fn);
    },
    /** Resolves with the params of the next `method` event that passes `test`. */
    once(method, test = () => true, timeoutMs = 30_000) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { off(); reject(new Error(`CDP: no ${method} within ${timeoutMs} ms`)); }, timeoutMs);
        const off = this.on(method, (p) => { if (test(p)) { clearTimeout(timer); off(); resolve(p); } });
      });
    },
    close() { ws.close(); },
  };
}

/** GET a DevTools HTTP endpoint (/json/version, /json/list) on the debugging port; null when nothing listens. */
export async function devtoolsJson(port, path) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`);
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}
