import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import type { Server, Socket } from 'node:net';
import { defaultLockPort, openLedger } from './ledger.ts';
import type { Ledger } from './ledger.ts';
import type { Usage } from '../contracts/index.ts';

const ledgerModuleUrl: string = new URL('./ledger.ts', import.meta.url).href;

function lineCount(filePath: string): number {
  if (!fs.existsSync(filePath)) {
    return 0;
  }
  const text: string = fs.readFileSync(filePath, 'utf8');
  const lines: string[] = text.split('\n');
  let count = 0;
  for (const line of lines) {
    if (line.trim() !== '') {
      count += 1;
    }
  }
  return count;
}

function makeHelpers(prefix: string): { now: () => Date; newId: () => string } {
  let nextId = 0;
  const newId = (): string => {
    nextId += 1;
    return `${prefix}-${nextId}`;
  };
  const now = (): Date => new Date('2026-10-27T00:00:00.000Z');
  return { now, newId };
}

function hasLockFile(dir: string): boolean {
  const names: string[] = fs.readdirSync(dir);
  for (const name of names) {
    if (name.endsWith('.lock')) {
      return true;
    }
  }
  return false;
}

function listenOn(port: number): Promise<Server> {
  const srv: Server = createServer();
  srv.on('connection', (s: Socket): void => {
    s.destroy();
  });
  return new Promise<Server>((resolve, reject): void => {
    const onListening = (): void => {
      srv.removeListener('error', onError);
      srv.unref();
      srv.on('error', (): void => {});
      resolve(srv);
    };
    const onError = (err: unknown): void => {
      srv.removeListener('listening', onListening);
      reject(err);
    };
    srv.once('listening', onListening);
    srv.once('error', onError);
    srv.listen({ host: '127.0.0.1', port, exclusive: true });
  });
}

function closeServer(srv: Server): Promise<void> {
  return new Promise<void>((resolve): void => {
    let done = false;
    const finish = (): void => {
      if (!done) {
        done = true;
        resolve();
      }
    };
    srv.once('close', finish);
    try {
      srv.close((): void => {
        finish();
      });
    } catch {
      finish();
    }
  });
}

async function freshLedgerPath(
  prefix: string,
  subPath = 'ledger.jsonl',
): Promise<{ dir: string; ledgerPath: string; port: number }> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const dir: string = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    const ledgerPath: string = path.join(dir, subPath);
    const port: number = defaultLockPort(ledgerPath);
    let probe: Server | null = null;
    try {
      probe = await listenOn(port);
    } catch (err: unknown) {
      lastErr = err;
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors on the discarded candidate dir
      }
      continue;
    }
    await closeServer(probe);
    return { dir, ledgerPath, port };
  }
  const detail: string =
    lastErr instanceof Error && lastErr.message.length > 0 ? `: ${lastErr.message}` : '';
  throw new Error('NO_FREE_LOCK_PORT' + detail);
}

function readFirstLine(child: ChildProcess, timeoutMs: number): Promise<string> {
  return new Promise<string>((resolve, reject): void => {
    let buf = '';
    let done = false;
    const timer: NodeJS.Timeout = setTimeout((): void => {
      if (!done) {
        done = true;
        cleanup();
        reject(new Error('TIMEOUT_WAITING_FOR_CHILD_LINE'));
      }
    }, timeoutMs);
    const cleanup = (): void => {
      clearTimeout(timer);
      if (child.stdout !== null) {
        child.stdout.removeListener('data', onData);
      }
    };
    const onData = (chunk: unknown): void => {
      if (done) {
        return;
      }
      buf += String(chunk);
      const idx: number = buf.indexOf('\n');
      if (idx >= 0) {
        done = true;
        cleanup();
        resolve(buf.slice(0, idx).trim());
      }
    };
    const onExit = (code: number | null): void => {
      if (!done) {
        if (buf.trim().length > 0) {
          done = true;
          cleanup();
          resolve(buf.trim());
        } else {
          done = true;
          cleanup();
          reject(new Error('CHILD_EXITED_BEFORE_LINE:' + String(code)));
        }
      }
    };
    const onErr = (err: Error): void => {
      if (!done) {
        done = true;
        cleanup();
        reject(err);
      }
    };
    if (child.stdout !== null) {
      child.stdout.on('data', onData);
    } else {
      clearTimeout(timer);
      reject(new Error('NO_CHILD_STDOUT'));
      return;
    }
    child.once('exit', onExit);
    child.once('error', onErr);
  });
}

function waitExit(child: ChildProcess, timeoutMs: number): Promise<number | null> {
  return new Promise<number | null>((resolve, reject): void => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve(child.exitCode);
      return;
    }
    const timer: NodeJS.Timeout = setTimeout((): void => {
      cleanup();
      reject(new Error('TIMEOUT_WAITING_FOR_EXIT'));
    }, timeoutMs);
    const cleanup = (): void => {
      clearTimeout(timer);
      child.removeListener('exit', onExit);
      child.removeListener('error', onErr);
    };
    const onExit = (code: number | null): void => {
      cleanup();
      resolve(code);
    };
    const onErr = (err: Error): void => {
      cleanup();
      reject(err);
    };
    child.once('exit', onExit);
    child.once('error', onErr);
  });
}

function sleepMs(ms: number): Promise<void> {
  return new Promise<void>((resolve): void => {
    setTimeout(resolve, ms);
  });
}

test('reserve and reconcile update committed totals', async (): Promise<void> => {
  const fresh = await freshLedgerPath('meta-ledger-');
  const dir: string = fresh.dir;
  const h = makeHelpers('test-id');
  const ledgerPath: string = fresh.ledgerPath;
  const ledger: Ledger = await openLedger({ path: ledgerPath, capUSD: 10, now: h.now, newId: h.newId });
  try {
    assert.strictEqual(ledger.committedUSD(), 0);
    const r1: string = ledger.reserve({ purpose: 'demo', model: 'muse-spark-1.3', estUSD: 2.5 });
    assert.strictEqual(r1, 'test-id-1');
    assert.strictEqual(ledger.committedUSD(), 2.5);
    const usage: Usage = { promptTokens: 1000, completionTokens: 500, reasoningTokens: 0, cachedTokens: 0 };
    ledger.reconcile(r1, { costUSD: 1.0, responseId: 'resp-1', usage });
    assert.strictEqual(ledger.committedUSD(), 1.0);
    const r2: string = ledger.reserve({ purpose: 'test-live', model: 'muse-spark-1.3', estUSD: 0.5 });
    assert.strictEqual(r2, 'test-id-3');
    assert.strictEqual(ledger.committedUSD(), 1.5);
    ledger.reconcile(r2, { costUSD: 0.25 });
    assert.strictEqual(ledger.committedUSD(), 1.25);
    assert.strictEqual(lineCount(ledgerPath), 4);
  } finally {
    ledger.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('reserve over cap throws BUDGET_EXCEEDED and writes nothing', async (): Promise<void> => {
  const fresh = await freshLedgerPath('meta-ledger-');
  const dir: string = fresh.dir;
  const h = makeHelpers('r');
  const ledgerPath: string = fresh.ledgerPath;
  const ledger: Ledger = await openLedger({ path: ledgerPath, capUSD: 1, now: h.now, newId: h.newId });
  try {
    ledger.reserve({ purpose: 'demo', model: 'muse-spark-1.3', estUSD: 0.6 });
    assert.strictEqual(lineCount(ledgerPath), 1);
    assert.throws(
      () => ledger.reserve({ purpose: 'demo', model: 'muse-spark-1.3', estUSD: 0.5 }),
      { message: 'BUDGET_EXCEEDED' },
    );
    assert.strictEqual(ledger.committedUSD(), 0.6);
    assert.strictEqual(lineCount(ledgerPath), 1);
  } finally {
    ledger.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('totals survive restarts by replaying the file', async (): Promise<void> => {
  const fresh = await freshLedgerPath('meta-ledger-');
  const dir: string = fresh.dir;
  const h = makeHelpers('id');
  const ledgerPath: string = fresh.ledgerPath;
  const first: Ledger = await openLedger({ path: ledgerPath, capUSD: 5, now: h.now, newId: h.newId });
  let r1 = '';
  try {
    r1 = first.reserve({ purpose: 'demo', model: 'muse-spark-1.3', estUSD: 2 });
    first.reconcile(r1, { costUSD: 1.5, note: 'first call' });
    assert.strictEqual(first.committedUSD(), 1.5);
  } finally {
    first.close();
  }
  const second: Ledger = await openLedger({ path: ledgerPath, capUSD: 5, now: h.now, newId: h.newId });
  try {
    assert.strictEqual(second.committedUSD(), 1.5);
    const r2: string = second.reserve({ purpose: 'demo', model: 'muse-spark-1.3', estUSD: 1 });
    assert.strictEqual(typeof r2, 'string');
    assert.strictEqual(second.committedUSD(), 2.5);
  } finally {
    second.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('unreconciled reservation stays counted after restart', async (): Promise<void> => {
  const fresh = await freshLedgerPath('meta-ledger-');
  const dir: string = fresh.dir;
  const h = makeHelpers('crashed');
  const ledgerPath: string = fresh.ledgerPath;
  const first: Ledger = await openLedger({ path: ledgerPath, capUSD: 5, now: h.now, newId: h.newId });
  try {
    first.reserve({ purpose: 'demo', model: 'muse-spark-1.3', estUSD: 2 });
    assert.strictEqual(first.committedUSD(), 2);
  } finally {
    first.close();
  }
  const second: Ledger = await openLedger({ path: ledgerPath, capUSD: 5, now: h.now, newId: h.newId });
  try {
    assert.strictEqual(second.committedUSD(), 2);
    assert.throws(
      () => second.reserve({ purpose: 'demo', model: 'muse-spark-1.3', estUSD: 4 }),
      { message: 'BUDGET_EXCEEDED' },
    );
  } finally {
    second.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('unknown and double reconcile throw UNKNOWN_RESERVATION', async (): Promise<void> => {
  const fresh = await freshLedgerPath('meta-ledger-');
  const dir: string = fresh.dir;
  const h = makeHelpers('k');
  const ledgerPath: string = fresh.ledgerPath;
  const ledger: Ledger = await openLedger({ path: ledgerPath, capUSD: 5, now: h.now, newId: h.newId });
  try {
    const r1: string = ledger.reserve({ purpose: 'demo', model: 'muse-spark-1.3', estUSD: 1 });
    ledger.reconcile(r1, { costUSD: 0.5 });
    assert.throws(() => ledger.reconcile(r1, { costUSD: 0.5 }), { message: 'UNKNOWN_RESERVATION' });
    assert.throws(() => ledger.reconcile('does-not-exist', { costUSD: 0.5 }), {
      message: 'UNKNOWN_RESERVATION',
    });
    assert.strictEqual(lineCount(ledgerPath), 2);
  } finally {
    ledger.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('creates the ledger parent directory when missing', async (): Promise<void> => {
  const fresh = await freshLedgerPath('meta-ledger-', path.join('nested', 'deep', 'ledger.jsonl'));
  const dir: string = fresh.dir;
  const h = makeHelpers('n');
  const ledgerPath: string = fresh.ledgerPath;
  assert.strictEqual(fs.existsSync(path.join(dir, 'nested')), false);
  const ledger: Ledger = await openLedger({ path: ledgerPath, capUSD: 5, now: h.now, newId: h.newId });
  try {
    const reservationId: string = ledger.reserve({ purpose: 'demo', model: 'muse-spark-1.3', estUSD: 1 });
    assert.strictEqual(typeof reservationId, 'string');
    assert.strictEqual(fs.existsSync(ledgerPath), true);
    assert.strictEqual(lineCount(ledgerPath), 1);
    assert.strictEqual(ledger.committedUSD(), 1);
  } finally {
    ledger.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('same process second open rejects, close/reopen succeeds, no .lock file', async (): Promise<void> => {
  const fresh = await freshLedgerPath('meta-ledger-');
  const dir: string = fresh.dir;
  const h = makeHelpers('ab');
  const ledgerPath: string = fresh.ledgerPath;
  const a: Ledger = await openLedger({ path: ledgerPath, capUSD: 1, now: h.now, newId: h.newId });
  let b: Ledger | null = null;
  try {
    a.reserve({ purpose: 'demo', model: 'muse-spark-1.3', estUSD: 0.6 });
    await assert.rejects(openLedger({ path: ledgerPath, capUSD: 1 }), { message: 'LEDGER_LOCKED' });
    assert.strictEqual(a.committedUSD(), 0.6);
    assert.strictEqual(lineCount(ledgerPath), 1);
    assert.strictEqual(hasLockFile(dir), false);
    a.close();
    b = await openLedger({ path: ledgerPath, capUSD: 1, now: h.now, newId: h.newId });
    assert.strictEqual(b.committedUSD(), 0.6);
    assert.strictEqual(hasLockFile(dir), false);
  } finally {
    a.close();
    if (b !== null) {
      b.close();
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('operations after close throw LEDGER_CLOSED', async (): Promise<void> => {
  const fresh = await freshLedgerPath('meta-ledger-');
  const dir: string = fresh.dir;
  const h = makeHelpers('cl');
  const ledgerPath: string = fresh.ledgerPath;
  const ledger: Ledger = await openLedger({ path: ledgerPath, capUSD: 5, now: h.now, newId: h.newId });
  ledger.reserve({ purpose: 'demo', model: 'muse-spark-1.3', estUSD: 1 });
  ledger.close();
  ledger.close();
  try {
    assert.throws(() => ledger.reserve({ purpose: 'demo', model: 'muse-spark-1.3', estUSD: 0.1 }), {
      message: 'LEDGER_CLOSED',
    });
    assert.throws(() => ledger.reconcile('cl-1', { costUSD: 0.1 }), { message: 'LEDGER_CLOSED' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('reserve re-reads the file before the cap check', async (): Promise<void> => {
  const fresh = await freshLedgerPath('meta-ledger-');
  const dir: string = fresh.dir;
  const h = makeHelpers('rr');
  const ledgerPath: string = fresh.ledgerPath;
  const ledger: Ledger = await openLedger({ path: ledgerPath, capUSD: 1, now: h.now, newId: h.newId });
  try {
    ledger.reserve({ purpose: 'demo', model: 'muse-spark-1.3', estUSD: 0.4 });
    const foreign = {
      id: 'foreign-1',
      at: '2026-10-27T00:00:00.000Z',
      kind: 'reserve',
      purpose: 'demo',
      model: 'muse-spark-1.3',
      amountUSD: 0.5,
      reservationId: 'foreign-1',
    };
    fs.appendFileSync(ledgerPath, JSON.stringify(foreign) + '\n');
    assert.throws(() => ledger.reserve({ purpose: 'demo', model: 'muse-spark-1.3', estUSD: 0.3 }), {
      message: 'BUDGET_EXCEEDED',
    });
    assert.strictEqual(lineCount(ledgerPath), 2);
  } finally {
    ledger.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('defaultLockPort is deterministic, in range and matches the formula', (): void => {
  const dir: string = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-ledger-'));
  try {
    const p: string = path.join(dir, 'ledger.jsonl');
    const port: number = defaultLockPort(p);
    assert.ok(Number.isInteger(port));
    assert.ok(port >= 49152 && port <= 65151);
    assert.strictEqual(port, defaultLockPort(p));
    const digest = createHash('sha256').update(path.resolve(p), 'utf8').digest();
    const expected: number = 49152 + (digest.readUInt32BE(0) % 16000);
    assert.strictEqual(port, expected);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('different paths with same explicit lockPort exclude each other', async (): Promise<void> => {
  const fresh = await freshLedgerPath('meta-ledger-');
  const dir: string = fresh.dir;
  const pathA: string = path.join(dir, 'a.jsonl');
  const pathB: string = path.join(dir, 'b.jsonl');
  const port: number = fresh.port;
  let first: Ledger | null = null;
  try {
    first = await openLedger({ path: pathA, capUSD: 5, lockPort: port });
    await assert.rejects(openLedger({ path: pathB, capUSD: 5, lockPort: port }), {
      message: 'LEDGER_LOCKED',
    });
  } finally {
    if (first !== null) {
      first.close();
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('foreign server on the ledger port makes openLedger fail closed', async (): Promise<void> => {
  const fresh = await freshLedgerPath('meta-ledger-');
  const dir: string = fresh.dir;
  const ledgerPath: string = fresh.ledgerPath;
  const port: number = fresh.port;
  const foreign: Server = await listenOn(port);
  try {
    await assert.rejects(openLedger({ path: ledgerPath, capUSD: 5 }), { message: 'LEDGER_LOCKED' });
  } finally {
    await closeServer(foreign);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('invalid lockPort rejects INVALID_LOCK_PORT', async (): Promise<void> => {
  const dir: string = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-ledger-'));
  try {
    const ledgerPath: string = path.join(dir, 'ledger.jsonl');
    await assert.rejects(openLedger({ path: ledgerPath, capUSD: 5, lockPort: 0 }), {
      message: 'INVALID_LOCK_PORT',
    });
    await assert.rejects(openLedger({ path: ledgerPath, capUSD: 5, lockPort: 70000 }), {
      message: 'INVALID_LOCK_PORT',
    });
    await assert.rejects(openLedger({ path: ledgerPath, capUSD: 5, lockPort: 1.5 }), {
      message: 'INVALID_LOCK_PORT',
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('invalid capUSD rejects and leaves the port free', async (): Promise<void> => {
  const fresh = await freshLedgerPath('meta-ledger-');
  const dir: string = fresh.dir;
  try {
    const ledgerPath: string = fresh.ledgerPath;
    const port: number = fresh.port;
    await assert.rejects(openLedger({ path: ledgerPath, capUSD: NaN }), { message: 'INVALID_AMOUNT' });
    await assert.rejects(openLedger({ path: ledgerPath, capUSD: -1 }), { message: 'INVALID_AMOUNT' });
    await assert.rejects(openLedger({ path: ledgerPath, capUSD: Infinity }), {
      message: 'INVALID_AMOUNT',
    });
    const probe: Server = await listenOn(port);
    await closeServer(probe);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('corrupt ledger line fails closed and releases the lock', async (): Promise<void> => {
  const fresh = await freshLedgerPath('meta-ledger-');
  const dir: string = fresh.dir;
  const ledgerPath: string = fresh.ledgerPath;
  try {
    fs.writeFileSync(ledgerPath, 'not json\n');
    await assert.rejects(openLedger({ path: ledgerPath, capUSD: 5 }), { message: 'LEDGER_CORRUPT' });
    const probe: Server = await listenOn(fresh.port);
    await closeServer(probe);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('truncated last line fails closed and releases the lock', async (): Promise<void> => {
  const fresh = await freshLedgerPath('meta-ledger-');
  const dir: string = fresh.dir;
  const ledgerPath: string = fresh.ledgerPath;
  try {
    const good = {
      id: 't-1',
      at: '2026-10-27T00:00:00.000Z',
      kind: 'reserve',
      purpose: 'demo',
      model: 'muse-spark-1.3',
      amountUSD: 1,
      reservationId: 't-1',
    };
    fs.writeFileSync(ledgerPath, JSON.stringify(good) + '\n{"kind":"reserve",');
    await assert.rejects(openLedger({ path: ledgerPath, capUSD: 5 }), { message: 'LEDGER_CORRUPT' });
    const probe: Server = await listenOn(fresh.port);
    await closeServer(probe);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('unknown kind fails closed and releases the lock', async (): Promise<void> => {
  const fresh = await freshLedgerPath('meta-ledger-');
  const dir: string = fresh.dir;
  const ledgerPath: string = fresh.ledgerPath;
  try {
    const bad = {
      id: 'u-1',
      at: '2026-10-27T00:00:00.000Z',
      kind: 'bogus',
      purpose: 'demo',
      model: 'muse-spark-1.3',
      amountUSD: 1,
      reservationId: 'u-1',
    };
    fs.writeFileSync(ledgerPath, JSON.stringify(bad) + '\n');
    await assert.rejects(openLedger({ path: ledgerPath, capUSD: 5 }), { message: 'LEDGER_CORRUPT' });
    const probe: Server = await listenOn(fresh.port);
    await closeServer(probe);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('negative amount fails closed and releases the lock', async (): Promise<void> => {
  const fresh = await freshLedgerPath('meta-ledger-');
  const dir: string = fresh.dir;
  const ledgerPath: string = fresh.ledgerPath;
  try {
    const bad = {
      id: 'neg-1',
      at: '2026-10-27T00:00:00.000Z',
      kind: 'reserve',
      purpose: 'demo',
      model: 'muse-spark-1.3',
      amountUSD: -1,
      reservationId: 'neg-1',
    };
    fs.writeFileSync(ledgerPath, JSON.stringify(bad) + '\n');
    await assert.rejects(openLedger({ path: ledgerPath, capUSD: 5 }), { message: 'LEDGER_CORRUPT' });
    const probe: Server = await listenOn(fresh.port);
    await closeServer(probe);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('null amount fails closed and releases the lock', async (): Promise<void> => {
  const fresh = await freshLedgerPath('meta-ledger-');
  const dir: string = fresh.dir;
  const ledgerPath: string = fresh.ledgerPath;
  try {
    fs.writeFileSync(
      ledgerPath,
      '{"id":"nan-1","at":"2026-10-27T00:00:00.000Z","kind":"reserve","purpose":"demo","model":"muse-spark-1.3","amountUSD":null,"reservationId":"nan-1"}\n',
    );
    await assert.rejects(openLedger({ path: ledgerPath, capUSD: 5 }), { message: 'LEDGER_CORRUPT' });
    const probe: Server = await listenOn(fresh.port);
    await closeServer(probe);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('reconcile of unknown id fails closed and releases the lock', async (): Promise<void> => {
  const fresh = await freshLedgerPath('meta-ledger-');
  const dir: string = fresh.dir;
  const ledgerPath: string = fresh.ledgerPath;
  try {
    const bad = {
      id: 'rec-1',
      at: '2026-10-27T00:00:00.000Z',
      kind: 'reconcile',
      purpose: 'demo',
      model: 'muse-spark-1.3',
      amountUSD: 0.5,
      reservationId: 'does-not-exist',
    };
    fs.writeFileSync(ledgerPath, JSON.stringify(bad) + '\n');
    await assert.rejects(openLedger({ path: ledgerPath, capUSD: 5 }), { message: 'LEDGER_CORRUPT' });
    const probe: Server = await listenOn(fresh.port);
    await closeServer(probe);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('duplicate reserve id fails closed and releases the lock', async (): Promise<void> => {
  const fresh = await freshLedgerPath('meta-ledger-');
  const dir: string = fresh.dir;
  const ledgerPath: string = fresh.ledgerPath;
  try {
    const first = {
      id: 'dup-1',
      at: '2026-10-27T00:00:00.000Z',
      kind: 'reserve',
      purpose: 'demo',
      model: 'muse-spark-1.3',
      amountUSD: 1,
      reservationId: 'dup-1',
    };
    const second = {
      id: 'dup-1',
      at: '2026-10-27T00:00:00.000Z',
      kind: 'reserve',
      purpose: 'demo',
      model: 'muse-spark-1.3',
      amountUSD: 1,
      reservationId: 'dup-1',
    };
    fs.writeFileSync(ledgerPath, JSON.stringify(first) + '\n' + JSON.stringify(second) + '\n');
    await assert.rejects(openLedger({ path: ledgerPath, capUSD: 5 }), { message: 'LEDGER_CORRUPT' });
    const probe: Server = await listenOn(fresh.port);
    await closeServer(probe);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('reserve and reconcile with invalid amounts throw INVALID_AMOUNT and write nothing', async (): Promise<void> => {
  const fresh = await freshLedgerPath('meta-ledger-');
  const dir: string = fresh.dir;
  const h = makeHelpers('inv');
  const ledgerPath: string = fresh.ledgerPath;
  const ledger: Ledger = await openLedger({ path: ledgerPath, capUSD: 5, now: h.now, newId: h.newId });
  try {
    assert.throws(() => ledger.reserve({ purpose: 'demo', model: 'muse-spark-1.3', estUSD: NaN }), {
      message: 'INVALID_AMOUNT',
    });
    assert.throws(() => ledger.reserve({ purpose: 'demo', model: 'muse-spark-1.3', estUSD: -0.5 }), {
      message: 'INVALID_AMOUNT',
    });
    assert.throws(() => ledger.reserve({ purpose: 'demo', model: 'muse-spark-1.3', estUSD: Infinity }), {
      message: 'INVALID_AMOUNT',
    });
    assert.strictEqual(lineCount(ledgerPath), 0);
    const r: string = ledger.reserve({ purpose: 'demo', model: 'muse-spark-1.3', estUSD: 1 });
    assert.strictEqual(lineCount(ledgerPath), 1);
    assert.throws(() => ledger.reconcile(r, { costUSD: NaN }), { message: 'INVALID_AMOUNT' });
    assert.throws(() => ledger.reconcile(r, { costUSD: -1 }), { message: 'INVALID_AMOUNT' });
    assert.throws(() => ledger.reconcile(r, { costUSD: Infinity }), { message: 'INVALID_AMOUNT' });
    assert.strictEqual(lineCount(ledgerPath), 1);
    ledger.reconcile(r, { costUSD: 0.5 });
    assert.strictEqual(lineCount(ledgerPath), 2);
  } finally {
    ledger.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('two simultaneous child processes yield exactly one owner (N-01)', async (): Promise<void> => {
  const fresh = await freshLedgerPath('meta-ledger-');
  const dir: string = fresh.dir;
  const ledgerPath: string = fresh.ledgerPath;
  const childPath: string = path.join(dir, 'child.mjs');
  const script: string = [
    'const ledgerUrl = process.argv[2];',
    'const ledgerPath = process.argv[3];',
    'const startAt = Number(process.argv[4]);',
    'const mod = await import(ledgerUrl);',
    'const waitMs = startAt - Date.now();',
    'if (waitMs > 0) { await new Promise((r) => setTimeout(r, waitMs)); }',
    'let ledger;',
    'try { ledger = await mod.openLedger({ path: ledgerPath, capUSD: 1 }); }',
    'catch (err) {',
    "  const msg = err && err.message ? err.message : String(err);",
    "  if (msg === 'LEDGER_LOCKED') { console.log('LOCKED'); process.exit(0); }",
    "  console.log('ERROR ' + msg); process.exit(1);",
    '}',
    'try { ledger.reserve({ purpose: \'demo\', model: \'muse-spark-1.3\', estUSD: 0.6 }); console.log(\'ACQUIRED\'); }',
    'catch (err) { console.log(\'ERROR \' + (err && err.message ? err.message : String(err))); process.exit(1); }',
    'setInterval(() => {}, 1000);',
    '',
  ].join('\n');
  fs.writeFileSync(childPath, script, 'utf8');
  const startAt: number = Date.now() + 1200;
  let childA: ChildProcess | null = null;
  let childB: ChildProcess | null = null;
  let reopened: Ledger | null = null;
  try {
    childA = spawn(process.execPath, [childPath, ledgerModuleUrl, ledgerPath, String(startAt)], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    childB = spawn(process.execPath, [childPath, ledgerModuleUrl, ledgerPath, String(startAt)], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const lineA: string = await readFirstLine(childA, 20000);
    const lineB: string = await readFirstLine(childB, 20000);
    const sorted: string[] = [lineA, lineB].sort();
    assert.deepStrictEqual(sorted, ['ACQUIRED', 'LOCKED']);
    const owner: ChildProcess | null = lineA === 'ACQUIRED' ? childA : childB;
    const locked: ChildProcess | null = lineA === 'ACQUIRED' ? childB : childA;
    assert.ok(owner !== null && locked !== null);
    await waitExit(locked, 10000);
    await assert.rejects(openLedger({ path: ledgerPath, capUSD: 1 }), { message: 'LEDGER_LOCKED' });
    try {
      owner.kill();
    } catch {
      // ignore kill errors
    }
    await waitExit(owner, 10000);
    const deadline: number = Date.now() + 2000;
    let lastErr: unknown = null;
    while (reopened === null && Date.now() <= deadline) {
      try {
        reopened = await openLedger({ path: ledgerPath, capUSD: 1 });
      } catch (err: unknown) {
        lastErr = err;
        const msg: unknown = (err as { message?: unknown }).message;
        if (msg !== 'LEDGER_LOCKED') {
          throw err;
        }
        await sleepMs(50);
      }
    }
    assert.ok(reopened !== null, 'reopen after owner exit should succeed, last=' + String(lastErr));
    if (reopened === null) {
      throw new Error('UNREACHABLE_REOPEN_NULL');
    }
    const activeLedger: Ledger = reopened;
    assert.strictEqual(activeLedger.committedUSD(), 0.6);
    assert.throws(
      () => activeLedger.reserve({ purpose: 'demo', model: 'muse-spark-1.3', estUSD: 0.6 }),
      { message: 'BUDGET_EXCEEDED' },
    );
  } finally {
    if (childA !== null) {
      try {
        childA.kill();
      } catch {
        // ignore
      }
    }
    if (childB !== null) {
      try {
        childB.kill();
      } catch {
        // ignore
      }
    }
    if (childA !== null) {
      try {
        await waitExit(childA, 5000);
      } catch {
        // ignore timeout on cleanup
      }
    }
    if (childB !== null) {
      try {
        await waitExit(childB, 5000);
      } catch {
        // ignore timeout on cleanup
      }
    }
    if (reopened !== null) {
      reopened.close();
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('lock does not keep a process alive', async (): Promise<void> => {
  const fresh = await freshLedgerPath('meta-ledger-');
  const dir: string = fresh.dir;
  const ledgerPath: string = fresh.ledgerPath;
  const childPath: string = path.join(dir, 'open-child.mjs');
  const script: string = [
    'const ledgerUrl = process.argv[2];',
    'const ledgerPath = process.argv[3];',
    'const mod = await import(ledgerUrl);',
    'try { await mod.openLedger({ path: ledgerPath, capUSD: 5 }); }',
    'catch (err) { console.log(\'ERROR \' + (err && err.message ? err.message : String(err))); process.exit(1); }',
    "console.log('OPEN');",
    '',
  ].join('\n');
  fs.writeFileSync(childPath, script, 'utf8');
  let child: ChildProcess | null = null;
  try {
    child = spawn(process.execPath, [childPath, ledgerModuleUrl, ledgerPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const line: string = await readFirstLine(child, 15000);
    assert.strictEqual(line, 'OPEN');
    const code: number | null = await waitExit(child, 10000);
    assert.strictEqual(code, 0);
  } finally {
    if (child !== null) {
      try {
        child.kill();
      } catch {
        // ignore
      }
      try {
        await waitExit(child, 5000);
      } catch {
        // ignore
      }
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
