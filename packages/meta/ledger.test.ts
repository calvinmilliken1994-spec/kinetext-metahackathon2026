import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createLedger } from './ledger.ts';
import type { Ledger } from './ledger.ts';
import type { Usage } from '../contracts/index.ts';

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

test('reserve and reconcile update committed totals', () => {
  const dir: string = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-ledger-'));
  const h = makeHelpers('test-id');
  const ledgerPath: string = path.join(dir, 'ledger.jsonl');
  const ledger = createLedger({ path: ledgerPath, capUSD: 10, now: h.now, newId: h.newId });
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

test('reserve over cap throws BUDGET_EXCEEDED and writes nothing', () => {
  const dir: string = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-ledger-'));
  const h = makeHelpers('r');
  const ledgerPath: string = path.join(dir, 'ledger.jsonl');
  const ledger = createLedger({ path: ledgerPath, capUSD: 1, now: h.now, newId: h.newId });
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

test('totals survive restarts by replaying the file', () => {
  const dir: string = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-ledger-'));
  const h = makeHelpers('id');
  const ledgerPath: string = path.join(dir, 'ledger.jsonl');
  const first = createLedger({ path: ledgerPath, capUSD: 5, now: h.now, newId: h.newId });
  let r1 = '';
  try {
    r1 = first.reserve({ purpose: 'demo', model: 'muse-spark-1.3', estUSD: 2 });
    first.reconcile(r1, { costUSD: 1.5, note: 'first call' });
    assert.strictEqual(first.committedUSD(), 1.5);
  } finally {
    first.close();
  }
  const second = createLedger({ path: ledgerPath, capUSD: 5, now: h.now, newId: h.newId });
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

test('unreconciled reservation stays counted after restart', () => {
  const dir: string = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-ledger-'));
  const h = makeHelpers('crashed');
  const ledgerPath: string = path.join(dir, 'ledger.jsonl');
  const first = createLedger({ path: ledgerPath, capUSD: 5, now: h.now, newId: h.newId });
  try {
    first.reserve({ purpose: 'demo', model: 'muse-spark-1.3', estUSD: 2 });
    assert.strictEqual(first.committedUSD(), 2);
  } finally {
    first.close();
  }
  const second = createLedger({ path: ledgerPath, capUSD: 5, now: h.now, newId: h.newId });
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

test('unknown and double reconcile throw UNKNOWN_RESERVATION', () => {
  const dir: string = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-ledger-'));
  const h = makeHelpers('k');
  const ledgerPath: string = path.join(dir, 'ledger.jsonl');
  const ledger = createLedger({ path: ledgerPath, capUSD: 5, now: h.now, newId: h.newId });
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

test('creates the ledger parent directory when missing', () => {
  const dir: string = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-ledger-'));
  const h = makeHelpers('n');
  const ledgerPath: string = path.join(dir, 'nested', 'deep', 'ledger.jsonl');
  assert.strictEqual(fs.existsSync(path.join(dir, 'nested')), false);
  const ledger = createLedger({ path: ledgerPath, capUSD: 5, now: h.now, newId: h.newId });
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

test('second live instance on the same file throws LEDGER_LOCKED', () => {
  const dir: string = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-ledger-'));
  const h = makeHelpers('ab');
  const ledgerPath: string = path.join(dir, 'ledger.jsonl');
  const a: Ledger = createLedger({ path: ledgerPath, capUSD: 1, now: h.now, newId: h.newId });
  try {
    a.reserve({ purpose: 'demo', model: 'muse-spark-1.3', estUSD: 0.6 });
    assert.throws(() => createLedger({ path: ledgerPath, capUSD: 1 }), { message: 'LEDGER_LOCKED' });
    assert.strictEqual(a.committedUSD(), 0.6);
    assert.strictEqual(lineCount(ledgerPath), 1);
  } finally {
    a.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('stale-lock takeover succeeds and lock holds the current PID', () => {
  const dir: string = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-ledger-'));
  const ledgerPath: string = path.join(dir, 'ledger.jsonl');
  const lockPath: string = `${ledgerPath}.lock`;
  let ledger: Ledger | null = null;
  try {
    const child = spawnSync(process.execPath, ['-e', '']);
    const deadPid: number = typeof child.pid === 'number' ? child.pid : 0;
    assert.ok(deadPid > 0);
    fs.writeFileSync(lockPath, String(deadPid));
    const h = makeHelpers('stale');
    ledger = createLedger({ path: ledgerPath, capUSD: 5, now: h.now, newId: h.newId });
    assert.strictEqual(fs.readFileSync(lockPath, 'utf8').trim(), String(process.pid));
    assert.strictEqual(ledger.committedUSD(), 0);
    const r: string = ledger.reserve({ purpose: 'demo', model: 'muse-spark-1.3', estUSD: 1 });
    assert.strictEqual(typeof r, 'string');
  } finally {
    if (ledger !== null) {
      ledger.close();
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('close and reopen keeps totals and removes the lock file', () => {
  const dir: string = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-ledger-'));
  const h = makeHelpers('re');
  const ledgerPath: string = path.join(dir, 'ledger.jsonl');
  const lockPath: string = `${ledgerPath}.lock`;
  const first = createLedger({ path: ledgerPath, capUSD: 5, now: h.now, newId: h.newId });
  try {
    const r: string = first.reserve({ purpose: 'demo', model: 'muse-spark-1.3', estUSD: 2 });
    first.reconcile(r, { costUSD: 1.25 });
    assert.strictEqual(first.committedUSD(), 1.25);
    assert.strictEqual(fs.existsSync(lockPath), true);
  } finally {
    first.close();
  }
  assert.strictEqual(fs.existsSync(lockPath), false);
  const second = createLedger({ path: ledgerPath, capUSD: 5, now: h.now, newId: h.newId });
  try {
    assert.strictEqual(second.committedUSD(), 1.25);
    assert.strictEqual(fs.existsSync(lockPath), true);
  } finally {
    second.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('operations after close throw LEDGER_CLOSED', () => {
  const dir: string = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-ledger-'));
  const h = makeHelpers('cl');
  const ledgerPath: string = path.join(dir, 'ledger.jsonl');
  const ledger = createLedger({ path: ledgerPath, capUSD: 5, now: h.now, newId: h.newId });
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

test('reserve re-reads the file before the cap check', () => {
  const dir: string = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-ledger-'));
  const h = makeHelpers('rr');
  const ledgerPath: string = path.join(dir, 'ledger.jsonl');
  const ledger = createLedger({ path: ledgerPath, capUSD: 1, now: h.now, newId: h.newId });
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

test('corrupt ledger line fails closed and releases the lock', () => {
  const dir: string = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-ledger-'));
  const ledgerPath: string = path.join(dir, 'ledger.jsonl');
  const lockPath: string = `${ledgerPath}.lock`;
  try {
    fs.writeFileSync(ledgerPath, 'not json\n');
    assert.throws(() => createLedger({ path: ledgerPath, capUSD: 5 }), { message: 'LEDGER_CORRUPT' });
    assert.strictEqual(fs.existsSync(lockPath), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('truncated last line fails closed and releases the lock', () => {
  const dir: string = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-ledger-'));
  const ledgerPath: string = path.join(dir, 'ledger.jsonl');
  const lockPath: string = `${ledgerPath}.lock`;
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
    assert.throws(() => createLedger({ path: ledgerPath, capUSD: 5 }), { message: 'LEDGER_CORRUPT' });
    assert.strictEqual(fs.existsSync(lockPath), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('unknown kind fails closed and releases the lock', () => {
  const dir: string = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-ledger-'));
  const ledgerPath: string = path.join(dir, 'ledger.jsonl');
  const lockPath: string = `${ledgerPath}.lock`;
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
    assert.throws(() => createLedger({ path: ledgerPath, capUSD: 5 }), { message: 'LEDGER_CORRUPT' });
    assert.strictEqual(fs.existsSync(lockPath), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('negative amount fails closed and releases the lock', () => {
  const dir: string = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-ledger-'));
  const ledgerPath: string = path.join(dir, 'ledger.jsonl');
  const lockPath: string = `${ledgerPath}.lock`;
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
    assert.throws(() => createLedger({ path: ledgerPath, capUSD: 5 }), { message: 'LEDGER_CORRUPT' });
    assert.strictEqual(fs.existsSync(lockPath), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('null amount fails closed and releases the lock', () => {
  const dir: string = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-ledger-'));
  const ledgerPath: string = path.join(dir, 'ledger.jsonl');
  const lockPath: string = `${ledgerPath}.lock`;
  try {
    fs.writeFileSync(
      ledgerPath,
      '{"id":"nan-1","at":"2026-10-27T00:00:00.000Z","kind":"reserve","purpose":"demo","model":"muse-spark-1.3","amountUSD":null,"reservationId":"nan-1"}\n',
    );
    assert.throws(() => createLedger({ path: ledgerPath, capUSD: 5 }), { message: 'LEDGER_CORRUPT' });
    assert.strictEqual(fs.existsSync(lockPath), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('reconcile of unknown id fails closed and releases the lock', () => {
  const dir: string = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-ledger-'));
  const ledgerPath: string = path.join(dir, 'ledger.jsonl');
  const lockPath: string = `${ledgerPath}.lock`;
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
    assert.throws(() => createLedger({ path: ledgerPath, capUSD: 5 }), { message: 'LEDGER_CORRUPT' });
    assert.strictEqual(fs.existsSync(lockPath), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('invalid capUSD throws INVALID_AMOUNT', () => {
  const dir: string = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-ledger-'));
  try {
    const ledgerPath: string = path.join(dir, 'ledger.jsonl');
    assert.throws(() => createLedger({ path: ledgerPath, capUSD: NaN }), { message: 'INVALID_AMOUNT' });
    assert.throws(() => createLedger({ path: ledgerPath, capUSD: -1 }), { message: 'INVALID_AMOUNT' });
    assert.throws(() => createLedger({ path: ledgerPath, capUSD: Infinity }), {
      message: 'INVALID_AMOUNT',
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('reserve and reconcile with invalid amounts throw INVALID_AMOUNT and write nothing', () => {
  const dir: string = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-ledger-'));
  const h = makeHelpers('inv');
  const ledgerPath: string = path.join(dir, 'ledger.jsonl');
  const ledger = createLedger({ path: ledgerPath, capUSD: 5, now: h.now, newId: h.newId });
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
