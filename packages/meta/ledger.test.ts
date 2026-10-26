import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createLedger } from './ledger.ts';
import type { Usage } from '../contracts/index.ts';

function lineCount(filePath: string): number {
  const text: string = fs.readFileSync(filePath, 'utf8');
  const lines: string[] = text.split('\n');
  let count: number = 0;
  for (const line of lines) {
    if (line.trim() !== '') {
      count += 1;
    }
  }
  return count;
}

test('reserve and reconcile update committed totals', () => {
  const dir: string = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-ledger-'));
  try {
    let nextId: number = 0;
    const newId = (): string => {
      nextId += 1;
      return `test-id-${nextId}`;
    };
    const now = (): Date => new Date('2026-10-27T00:00:00.000Z');
    const ledgerPath: string = path.join(dir, 'ledger.jsonl');
    const ledger = createLedger({ path: ledgerPath, capUSD: 10, now, newId });
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
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('reserve over cap throws BUDGET_EXCEEDED and writes nothing', () => {
  const dir: string = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-ledger-'));
  try {
    let nextId: number = 0;
    const newId = (): string => {
      nextId += 1;
      return `r-${nextId}`;
    };
    const now = (): Date => new Date('2026-10-27T00:00:00.000Z');
    const ledgerPath: string = path.join(dir, 'ledger.jsonl');
    const ledger = createLedger({ path: ledgerPath, capUSD: 1, now, newId });
    ledger.reserve({ purpose: 'demo', model: 'muse-spark-1.3', estUSD: 0.6 });
    assert.strictEqual(lineCount(ledgerPath), 1);
    try {
      ledger.reserve({ purpose: 'demo', model: 'muse-spark-1.3', estUSD: 0.5 });
      assert.fail('expected BUDGET_EXCEEDED');
    } catch (err) {
      assert.ok(err instanceof Error);
      assert.strictEqual(err.message, 'BUDGET_EXCEEDED');
    }
    assert.strictEqual(ledger.committedUSD(), 0.6);
    assert.strictEqual(lineCount(ledgerPath), 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('totals survive restarts by replaying the file', () => {
  const dir: string = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-ledger-'));
  try {
    let nextId: number = 0;
    const newId = (): string => {
      nextId += 1;
      return `id-${nextId}`;
    };
    const now = (): Date => new Date('2026-10-27T00:00:00.000Z');
    const ledgerPath: string = path.join(dir, 'ledger.jsonl');
    const first = createLedger({ path: ledgerPath, capUSD: 5, now, newId });
    const r1: string = first.reserve({ purpose: 'demo', model: 'muse-spark-1.3', estUSD: 2 });
    first.reconcile(r1, { costUSD: 1.5, note: 'first call' });
    assert.strictEqual(first.committedUSD(), 1.5);
    const second = createLedger({ path: ledgerPath, capUSD: 5, now, newId });
    assert.strictEqual(second.committedUSD(), 1.5);
    const r2: string = second.reserve({ purpose: 'demo', model: 'muse-spark-1.3', estUSD: 1 });
    assert.strictEqual(typeof r2, 'string');
    assert.strictEqual(second.committedUSD(), 2.5);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('unreconciled reservation stays counted after restart', () => {
  const dir: string = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-ledger-'));
  try {
    let nextId: number = 0;
    const newId = (): string => {
      nextId += 1;
      return `crashed-${nextId}`;
    };
    const now = (): Date => new Date('2026-10-27T00:00:00.000Z');
    const ledgerPath: string = path.join(dir, 'ledger.jsonl');
    const first = createLedger({ path: ledgerPath, capUSD: 5, now, newId });
    first.reserve({ purpose: 'demo', model: 'muse-spark-1.3', estUSD: 2 });
    assert.strictEqual(first.committedUSD(), 2);
    const second = createLedger({ path: ledgerPath, capUSD: 5, now, newId });
    assert.strictEqual(second.committedUSD(), 2);
    try {
      second.reserve({ purpose: 'demo', model: 'muse-spark-1.3', estUSD: 4 });
      assert.fail('expected BUDGET_EXCEEDED for crashed reservation still counted');
    } catch (err) {
      assert.ok(err instanceof Error);
      assert.strictEqual(err.message, 'BUDGET_EXCEEDED');
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('unknown and double reconcile throw UNKNOWN_RESERVATION', () => {
  const dir: string = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-ledger-'));
  try {
    let nextId: number = 0;
    const newId = (): string => {
      nextId += 1;
      return `k-${nextId}`;
    };
    const now = (): Date => new Date('2026-10-27T00:00:00.000Z');
    const ledgerPath: string = path.join(dir, 'ledger.jsonl');
    const ledger = createLedger({ path: ledgerPath, capUSD: 5, now, newId });
    const r1: string = ledger.reserve({ purpose: 'demo', model: 'muse-spark-1.3', estUSD: 1 });
    ledger.reconcile(r1, { costUSD: 0.5 });
    try {
      ledger.reconcile(r1, { costUSD: 0.5 });
      assert.fail('expected UNKNOWN_RESERVATION on double reconcile');
    } catch (err) {
      assert.ok(err instanceof Error);
      assert.strictEqual(err.message, 'UNKNOWN_RESERVATION');
    }
    try {
      ledger.reconcile('does-not-exist', { costUSD: 0.5 });
      assert.fail('expected UNKNOWN_RESERVATION on unknown id');
    } catch (err) {
      assert.ok(err instanceof Error);
      assert.strictEqual(err.message, 'UNKNOWN_RESERVATION');
    }
    assert.strictEqual(lineCount(ledgerPath), 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('creates the ledger parent directory when missing', () => {
  const dir: string = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-ledger-'));
  try {
    let nextId: number = 0;
    const newId = (): string => {
      nextId += 1;
      return `n-${nextId}`;
    };
    const now = (): Date => new Date('2026-10-27T00:00:00.000Z');
    const ledgerPath: string = path.join(dir, 'nested', 'deep', 'ledger.jsonl');
    assert.strictEqual(fs.existsSync(path.join(dir, 'nested')), false);
    const ledger = createLedger({ path: ledgerPath, capUSD: 5, now, newId });
    const reservationId: string = ledger.reserve({ purpose: 'demo', model: 'muse-spark-1.3', estUSD: 1 });
    assert.strictEqual(typeof reservationId, 'string');
    assert.strictEqual(fs.existsSync(ledgerPath), true);
    assert.strictEqual(lineCount(ledgerPath), 1);
    assert.strictEqual(ledger.committedUSD(), 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
