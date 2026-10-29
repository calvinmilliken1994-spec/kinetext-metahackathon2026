import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createServer } from 'node:net';
import type { Server, Socket } from 'node:net';
import { defaultLockPort, openLedger } from './ledger.ts';
import type { Ledger } from './ledger.ts';
import type { MetaProvider } from './pricing.ts';

function makeHelpers(prefix: string): { now: () => Date; newId: () => string } {
  let nextId = 0;
  const newId = (): string => {
    nextId += 1;
    return `${prefix}-${nextId}`;
  };
  const now = (): Date => new Date('2026-10-27T00:00:00.000Z');
  return { now, newId };
}

function lineCount(filePath: string): number {
  if (!fs.existsSync(filePath)) {
    return 0;
  }
  const text: string = fs.readFileSync(filePath, 'utf8');
  let count = 0;
  for (const line of text.split('\n')) {
    if (line.trim() !== '') {
      count += 1;
    }
  }
  return count;
}

function readEntries(filePath: string): Array<Record<string, unknown>> {
  const text: string = fs.readFileSync(filePath, 'utf8');
  const out: Array<Record<string, unknown>> = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') {
      continue;
    }
    out.push(JSON.parse(line) as Record<string, unknown>);
  }
  return out;
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
  const detail: string = lastErr instanceof Error && lastErr.message.length > 0 ? `: ${lastErr.message}` : '';
  throw new Error('NO_FREE_LOCK_PORT' + detail);
}

test('entries carry provider on reserve and reconcile lines', async (): Promise<void> => {
  const fresh = await freshLedgerPath('meta-ledger-p-');
  const h = makeHelpers('prov');
  const ledger: Ledger = await openLedger({
    path: fresh.ledgerPath,
    capUSD: 100,
    now: h.now,
    newId: h.newId,
    lockPort: fresh.port,
  });
  try {
    const r1: string = ledger.reserve({ purpose: 'demo', model: 'muse-spark-1.3', estUSD: 5 });
    const r2: string = ledger.reserve({ purpose: 'demo', model: 'muse-spark-open', estUSD: 7, provider: 'modal' });
    ledger.reconcile(r1, { costUSD: 4 });
    ledger.reconcile(r2, { costUSD: 6, responseId: 'resp-modal' });
    const entries = readEntries(fresh.ledgerPath);
    assert.strictEqual(entries.length, 4);
    assert.strictEqual(entries[0]['provider'], 'meta-api');
    assert.strictEqual(entries[1]['provider'], 'modal');
    assert.strictEqual(entries[2]['provider'], 'meta-api');
    assert.strictEqual(entries[2]['reservationId'], r1);
    assert.strictEqual(entries[3]['provider'], 'modal');
    assert.strictEqual(entries[3]['reservationId'], r2);
  } finally {
    ledger.close();
    fs.rmSync(fresh.dir, { recursive: true, force: true });
  }
});

test('reserve with invalid provider throws INVALID_PROVIDER and writes nothing', async (): Promise<void> => {
  const fresh = await freshLedgerPath('meta-ledger-p-');
  const h = makeHelpers('invp');
  const ledger: Ledger = await openLedger({
    path: fresh.ledgerPath,
    capUSD: 10,
    now: h.now,
    newId: h.newId,
    lockPort: fresh.port,
  });
  try {
    assert.throws(
      () => ledger.reserve({ purpose: 'demo', model: 'muse-spark-1.3', estUSD: 1, provider: 'bogus' as unknown as MetaProvider }),
      { message: 'INVALID_PROVIDER' },
    );
    assert.throws(
      () => ledger.reserve({ purpose: 'demo', model: 'x', estUSD: 1, provider: '__proto__' as unknown as MetaProvider }),
      { message: 'INVALID_PROVIDER' },
    );
    assert.strictEqual(lineCount(fresh.ledgerPath), 0);
    assert.strictEqual(ledger.committedUSD(), 0);
    ledger.reserve({ purpose: 'demo', model: 'muse-spark-1.3', estUSD: 1 });
    assert.strictEqual(lineCount(fresh.ledgerPath), 1);
  } finally {
    ledger.close();
    fs.rmSync(fresh.dir, { recursive: true, force: true });
  }
});

test('legacy lines without provider replay as meta-api', async (): Promise<void> => {
  const fresh = await freshLedgerPath('meta-ledger-p-');
  const legacy = {
    id: 'leg-1',
    at: '2026-10-27T00:00:00.000Z',
    kind: 'reserve',
    purpose: 'demo',
    model: 'muse-spark-1.3',
    amountUSD: 2,
    reservationId: 'leg-1',
  };
  fs.mkdirSync(path.dirname(fresh.ledgerPath), { recursive: true });
  fs.writeFileSync(fresh.ledgerPath, JSON.stringify(legacy) + '\n');
  const ledger: Ledger = await openLedger({ path: fresh.ledgerPath, capUSD: 10, lockPort: fresh.port });
  try {
    assert.strictEqual(ledger.committedUSD(), 2);
    assert.strictEqual(ledger.committedUSD('meta-api'), 2);
    assert.strictEqual(ledger.committedUSD('modal'), 0);
  } finally {
    ledger.close();
    fs.rmSync(fresh.dir, { recursive: true, force: true });
  }
});

test('bad provider value in file fails LEDGER_CORRUPT and releases lock', async (): Promise<void> => {
  const fresh = await freshLedgerPath('meta-ledger-p-');
  const bad = {
    id: 'b-1',
    at: '2026-10-27T00:00:00.000Z',
    kind: 'reserve',
    purpose: 'demo',
    model: 'muse-spark-1.3',
    amountUSD: 1,
    reservationId: 'b-1',
    provider: 'bogus',
  };
  fs.mkdirSync(path.dirname(fresh.ledgerPath), { recursive: true });
  fs.writeFileSync(fresh.ledgerPath, JSON.stringify(bad) + '\n');
  try {
    await assert.rejects(openLedger({ path: fresh.ledgerPath, capUSD: 5, lockPort: fresh.port }), {
      message: 'LEDGER_CORRUPT',
    });
    const probe: Server = await listenOn(fresh.port);
    await closeServer(probe);
  } finally {
    fs.rmSync(fresh.dir, { recursive: true, force: true });
  }
});

test('reconcile/reservation provider mismatch fails LEDGER_CORRUPT', async (): Promise<void> => {
  const freshA = await freshLedgerPath('meta-ledger-p-');
  try {
    const reserveModal = {
      id: 'm-1',
      at: '2026-10-27T00:00:00.000Z',
      kind: 'reserve',
      purpose: 'demo',
      model: 'muse-spark-open',
      provider: 'modal',
      amountUSD: 1,
      reservationId: 'm-1',
    };
    const reconcileLegacy = {
      id: 'm-2',
      at: '2026-10-27T00:00:00.000Z',
      kind: 'reconcile',
      purpose: 'demo',
      model: 'muse-spark-open',
      amountUSD: 1,
      reservationId: 'm-1',
    };
    fs.writeFileSync(freshA.ledgerPath, JSON.stringify(reserveModal) + '\n' + JSON.stringify(reconcileLegacy) + '\n');
    await assert.rejects(openLedger({ path: freshA.ledgerPath, capUSD: 5, lockPort: freshA.port }), {
      message: 'LEDGER_CORRUPT',
    });
  } finally {
    fs.rmSync(freshA.dir, { recursive: true, force: true });
  }
  const freshB = await freshLedgerPath('meta-ledger-p-');
  try {
    const reserveLegacy = {
      id: 'l-1',
      at: '2026-10-27T00:00:00.000Z',
      kind: 'reserve',
      purpose: 'demo',
      model: 'muse-spark-1.3',
      amountUSD: 1,
      reservationId: 'l-1',
    };
    const reconcileModal = {
      id: 'l-2',
      at: '2026-10-27T00:00:00.000Z',
      kind: 'reconcile',
      purpose: 'demo',
      model: 'muse-spark-1.3',
      provider: 'modal',
      amountUSD: 1,
      reservationId: 'l-1',
    };
    fs.writeFileSync(freshB.ledgerPath, JSON.stringify(reserveLegacy) + '\n' + JSON.stringify(reconcileModal) + '\n');
    await assert.rejects(openLedger({ path: freshB.ledgerPath, capUSD: 5, lockPort: freshB.port }), {
      message: 'LEDGER_CORRUPT',
    });
  } finally {
    fs.rmSync(freshB.dir, { recursive: true, force: true });
  }
});

test('providerCapsUSD validation rejects bad config without holding the port', async (): Promise<void> => {
  const cases: Array<{ caps: unknown; message: string }> = [
    { caps: { 'meta-api': -1 }, message: 'INVALID_AMOUNT' },
    { caps: { 'meta-api': NaN }, message: 'INVALID_AMOUNT' },
    { caps: { 'meta-api': Infinity }, message: 'INVALID_AMOUNT' },
    { caps: { bogus: 10 }, message: 'INVALID_PROVIDER' },
  ];
  for (const c of cases) {
    const fresh = await freshLedgerPath('meta-ledger-p-');
    try {
      await assert.rejects(
        openLedger({
          path: fresh.ledgerPath,
          capUSD: 10,
          lockPort: fresh.port,
          providerCapsUSD: c.caps as Readonly<Partial<Record<MetaProvider, number>>>,
        }),
        { message: c.message },
      );
      const ok: Ledger = await openLedger({
        path: fresh.ledgerPath,
        capUSD: 10,
        lockPort: fresh.port,
        providerCapsUSD: { 'meta-api': 10, modal: 10 },
      });
      ok.close();
    } finally {
      fs.rmSync(fresh.dir, { recursive: true, force: true });
    }
  }
});

test('legacy mode caps total across providers including modal', async (): Promise<void> => {
  const fresh = await freshLedgerPath('meta-ledger-p-');
  const h = makeHelpers('leg');
  const ledger: Ledger = await openLedger({
    path: fresh.ledgerPath,
    capUSD: 5,
    now: h.now,
    newId: h.newId,
    lockPort: fresh.port,
  });
  try {
    ledger.reserve({ purpose: 'demo', model: 'muse-spark-1.3', estUSD: 2 });
    ledger.reserve({ purpose: 'demo', model: 'muse-spark-open', estUSD: 2, provider: 'modal' });
    assert.strictEqual(ledger.committedUSD(), 4);
    assert.throws(() => ledger.reserve({ purpose: 'demo', model: 'muse-spark-1.3', estUSD: 2 }), {
      message: 'BUDGET_EXCEEDED',
    });
    assert.strictEqual(lineCount(fresh.ledgerPath), 2);
  } finally {
    ledger.close();
    fs.rmSync(fresh.dir, { recursive: true, force: true });
  }
});

test('per-provider mode: modal capped by own cap, not capUSD', async (): Promise<void> => {
  const fresh = await freshLedgerPath('meta-ledger-p-');
  const h = makeHelpers('mod');
  const ledger: Ledger = await openLedger({
    path: fresh.ledgerPath,
    capUSD: 1,
    now: h.now,
    newId: h.newId,
    lockPort: fresh.port,
    providerCapsUSD: { 'meta-api': 1, modal: 50 },
  });
  try {
    ledger.reserve({ purpose: 'demo', model: 'muse-spark-open', estUSD: 10, provider: 'modal' });
    assert.strictEqual(ledger.committedUSD('modal'), 10);
    assert.strictEqual(ledger.committedUSD('meta-api'), 0);
    assert.strictEqual(ledger.committedUSD(), 10);
    assert.throws(
      () => ledger.reserve({ purpose: 'demo', model: 'muse-spark-open', estUSD: 45, provider: 'modal' }),
      { message: 'BUDGET_EXCEEDED' },
    );
  } finally {
    ledger.close();
    fs.rmSync(fresh.dir, { recursive: true, force: true });
  }
});

test('per-provider mode: meta-api capped by min of provider cap and capUSD', async (): Promise<void> => {
  const freshA = await freshLedgerPath('meta-ledger-p-');
  const hA = makeHelpers('mina');
  const ledgerA: Ledger = await openLedger({
    path: freshA.ledgerPath,
    capUSD: 50,
    now: hA.now,
    newId: hA.newId,
    lockPort: freshA.port,
    providerCapsUSD: { 'meta-api': 5, modal: 50 },
  });
  try {
    ledgerA.reserve({ purpose: 'demo', model: 'muse-spark-1.3', estUSD: 4 });
    assert.throws(() => ledgerA.reserve({ purpose: 'demo', model: 'muse-spark-1.3', estUSD: 2 }), {
      message: 'BUDGET_EXCEEDED',
    });
  } finally {
    ledgerA.close();
    fs.rmSync(freshA.dir, { recursive: true, force: true });
  }
  const freshB = await freshLedgerPath('meta-ledger-p-');
  const hB = makeHelpers('minb');
  const ledgerB: Ledger = await openLedger({
    path: freshB.ledgerPath,
    capUSD: 5,
    now: hB.now,
    newId: hB.newId,
    lockPort: freshB.port,
    providerCapsUSD: { 'meta-api': 50, modal: 50 },
  });
  try {
    ledgerB.reserve({ purpose: 'demo', model: 'muse-spark-1.3', estUSD: 4 });
    assert.throws(() => ledgerB.reserve({ purpose: 'demo', model: 'muse-spark-1.3', estUSD: 2 }), {
      message: 'BUDGET_EXCEEDED',
    });
  } finally {
    ledgerB.close();
    fs.rmSync(freshB.dir, { recursive: true, force: true });
  }
});

test('provider without configured cap fails closed', async (): Promise<void> => {
  const fresh = await freshLedgerPath('meta-ledger-p-');
  const h = makeHelpers('nocap');
  const ledger: Ledger = await openLedger({
    path: fresh.ledgerPath,
    capUSD: 100,
    now: h.now,
    newId: h.newId,
    lockPort: fresh.port,
    providerCapsUSD: { 'meta-api': 100 },
  });
  try {
    ledger.reserve({ purpose: 'demo', model: 'muse-spark-1.3', estUSD: 1 });
    assert.throws(
      () => ledger.reserve({ purpose: 'demo', model: 'muse-spark-open', estUSD: 1, provider: 'modal' }),
      { message: 'BUDGET_EXCEEDED' },
    );
  } finally {
    ledger.close();
    fs.rmSync(fresh.dir, { recursive: true, force: true });
  }
});

test('exact-boundary reservation allowed in per-provider mode', async (): Promise<void> => {
  const fresh = await freshLedgerPath('meta-ledger-p-');
  const h = makeHelpers('edge');
  const ledger: Ledger = await openLedger({
    path: fresh.ledgerPath,
    capUSD: 10,
    now: h.now,
    newId: h.newId,
    lockPort: fresh.port,
    providerCapsUSD: { 'meta-api': 10, modal: 10 },
  });
  try {
    ledger.reserve({ purpose: 'demo', model: 'muse-spark-open', estUSD: 6, provider: 'modal' });
    ledger.reserve({ purpose: 'demo', model: 'muse-spark-open', estUSD: 4, provider: 'modal' });
    assert.strictEqual(ledger.committedUSD('modal'), 10);
    assert.throws(
      () => ledger.reserve({ purpose: 'demo', model: 'muse-spark-open', estUSD: 1, provider: 'modal' }),
      { message: 'BUDGET_EXCEEDED' },
    );
  } finally {
    ledger.close();
    fs.rmSync(fresh.dir, { recursive: true, force: true });
  }
});

test('committedUSD per provider vs total', async (): Promise<void> => {
  const fresh = await freshLedgerPath('meta-ledger-p-');
  const h = makeHelpers('com');
  const ledger: Ledger = await openLedger({
    path: fresh.ledgerPath,
    capUSD: 100,
    now: h.now,
    newId: h.newId,
    lockPort: fresh.port,
  });
  try {
    const r1: string = ledger.reserve({ purpose: 'demo', model: 'muse-spark-1.3', estUSD: 2 });
    ledger.reserve({ purpose: 'demo', model: 'muse-spark-open', estUSD: 3, provider: 'modal' });
    assert.strictEqual(ledger.committedUSD(), 5);
    assert.strictEqual(ledger.committedUSD('meta-api'), 2);
    assert.strictEqual(ledger.committedUSD('modal'), 3);
    ledger.reconcile(r1, { costUSD: 1 });
    assert.strictEqual(ledger.committedUSD('meta-api'), 1);
    assert.strictEqual(ledger.committedUSD(), 4);
  } finally {
    ledger.close();
    fs.rmSync(fresh.dir, { recursive: true, force: true });
  }
});

test('per-provider caps applied after restart', async (): Promise<void> => {
  const fresh = await freshLedgerPath('meta-ledger-p-');
  const h = makeHelpers('rst');
  const caps = { 'meta-api': 10, modal: 10 } as const;
  const first: Ledger = await openLedger({
    path: fresh.ledgerPath,
    capUSD: 10,
    now: h.now,
    newId: h.newId,
    lockPort: fresh.port,
    providerCapsUSD: { ...caps },
  });
  try {
    first.reserve({ purpose: 'demo', model: 'muse-spark-1.3', estUSD: 3 });
    first.reserve({ purpose: 'demo', model: 'muse-spark-open', estUSD: 4, provider: 'modal' });
    assert.strictEqual(first.committedUSD('meta-api'), 3);
    assert.strictEqual(first.committedUSD('modal'), 4);
  } finally {
    first.close();
  }
  const second: Ledger = await openLedger({
    path: fresh.ledgerPath,
    capUSD: 10,
    now: h.now,
    newId: h.newId,
    lockPort: fresh.port,
    providerCapsUSD: { ...caps },
  });
  try {
    assert.strictEqual(second.committedUSD('meta-api'), 3);
    assert.strictEqual(second.committedUSD('modal'), 4);
    assert.strictEqual(second.committedUSD(), 7);
    assert.throws(
      () => second.reserve({ purpose: 'demo', model: 'muse-spark-open', estUSD: 7, provider: 'modal' }),
      { message: 'BUDGET_EXCEEDED' },
    );
    second.reserve({ purpose: 'demo', model: 'muse-spark-open', estUSD: 6, provider: 'modal' });
  } finally {
    second.close();
    fs.rmSync(fresh.dir, { recursive: true, force: true });
  }
});

test('reconcile lowering actual frees per-provider headroom', async (): Promise<void> => {
  const fresh = await freshLedgerPath('meta-ledger-p-');
  const h = makeHelpers('free');
  const ledger: Ledger = await openLedger({
    path: fresh.ledgerPath,
    capUSD: 10,
    now: h.now,
    newId: h.newId,
    lockPort: fresh.port,
    providerCapsUSD: { 'meta-api': 10, modal: 5 },
  });
  try {
    const r: string = ledger.reserve({ purpose: 'demo', model: 'muse-spark-open', estUSD: 4.5, provider: 'modal' });
    assert.throws(
      () => ledger.reserve({ purpose: 'demo', model: 'muse-spark-open', estUSD: 1, provider: 'modal' }),
      { message: 'BUDGET_EXCEEDED' },
    );
    ledger.reconcile(r, { costUSD: 1 });
    ledger.reserve({ purpose: 'demo', model: 'muse-spark-open', estUSD: 4, provider: 'modal' });
    assert.strictEqual(ledger.committedUSD('modal'), 5);
  } finally {
    ledger.close();
    fs.rmSync(fresh.dir, { recursive: true, force: true });
  }
});
