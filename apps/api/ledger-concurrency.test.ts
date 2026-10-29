// Concurrency (BUG-006 wave, part B) — the spending ledger stays safe when several jobs
// run at once in the process that owns it: reserve()/reconcile() are SYNCHRONOUS (the
// event loop serialises them; appendFileSync never interleaves partial lines) and every
// reserve RE-READS the ledger file first, so outstanding reservations of OTHER in-flight
// jobs count against the stage cap (stageCapsUSD → openLedger capUSD) before a new one is
// admitted — no overshoot under concurrency, no lost reservation, and the file replay
// equals the per-job totals. Real openLedger in a temp dir with an explicit free lockPort
// (never the shared configured 47853); no network, no credits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer as createNetServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { openLedger } from '../../packages/meta/ledger.ts';
import type { Ledger } from '../../packages/meta/ledger.ts';

function freeLockPort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const probe = createNetServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (address === null || typeof address !== 'object') {
        probe.close();
        reject(new Error('NO_PORT'));
        return;
      }
      const port: number = (address as AddressInfo).port;
      probe.close(() => resolve(port));
    });
  });
}

interface LedgerLine {
  kind: string;
  amountUSD: number;
  reservationId?: string;
  provider?: string;
}

function readLines(path: string): LedgerLine[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(l => l.trim() !== '')
    .map(l => JSON.parse(l) as LedgerLine);
}

const tick = (ms = 0): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

test('ledger concurrency: interleaved fake jobs — committed total equals the per-job totals and no reservation is lost', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ledger-concurrency-'));
  const path = join(dir, 'ledger.jsonl');
  const lockPort = await freeLockPort();
  const ledger: Ledger = await openLedger({ path, capUSD: 50, lockPort });
  try {
    // Three fake "jobs", each making two paid calls with different interleavings
    // (reserve → other jobs run → reconcile). Every amount distinct so a mix-up shows.
    async function fakeJob(tag: string, calls: [number, number][], jitter: number): Promise<number> {
      let total = 0;
      for (const [estUSD, actualUSD] of calls) {
        const rid = ledger.reserve({ purpose: 'test-live', model: 'muse-spark-1.3', estUSD });
        await tick(jitter);
        ledger.reconcile(rid, { costUSD: actualUSD, responseId: `${tag}-resp` });
        total += actualUSD;
      }
      return total;
    }
    const [a, b, c] = await Promise.all([
      fakeJob('a', [[0.2, 0.11], [0.2, 0.12]], 5),
      fakeJob('b', [[0.2, 0.09], [0.2, 0.1]], 1),
      fakeJob('c', [[0.2, 0.13], [0.2, 0.07]], 3),
    ]);
    const perJobTotal = a + b + c;
    assert.ok(Math.abs(perJobTotal - 0.62) < 1e-9, `per-job totals ${perJobTotal}`);
    assert.ok(
      Math.abs(ledger.committedUSD() - perJobTotal) < 1e-9,
      `committed ${ledger.committedUSD()} must equal the sum of per-job totals ${perJobTotal}`,
    );
    // The file holds every reservation exactly once and every reconcile exactly once.
    const lines = readLines(path);
    const reserves = lines.filter(l => l.kind === 'reserve');
    const reconciles = lines.filter(l => l.kind === 'reconcile');
    assert.equal(reserves.length, 6, 'no reservation lost, none duplicated');
    assert.equal(reconciles.length, 6);
    assert.equal(new Set(reserves.map(l => l.reservationId)).size, 6, 'reservation ids unique');
    for (const rec of reconciles) {
      assert.ok(
        reserves.some(r => r.reservationId === rec.reservationId),
        'every reconcile pairs with a persisted reserve',
      );
    }
    // A fresh replay of the file agrees with the in-memory committed total.
    const replayTotal = reconciles.reduce((s, l) => s + l.amountUSD, 0);
    assert.ok(Math.abs(replayTotal - perJobTotal) < 1e-9, 'file replay equals the per-job totals');
  } finally {
    ledger.close();
  }
});

test('ledger concurrency: the stage cap reserves for ALL in-flight jobs — an outstanding reservation blocks an overshooting reserve (BUDGET_EXCEEDED)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ledger-cap-concurrency-'));
  const path = join(dir, 'ledger.jsonl');
  const lockPort = await freeLockPort();
  // Cap 1.00: two concurrent jobs each reserving 0.40 leave only 0.20 of headroom.
  const ledger: Ledger = await openLedger({ path, capUSD: 1, lockPort });
  try {
    // Job 1 reserves 0.40 and stays IN FLIGHT (not reconciled yet).
    const rid1 = ledger.reserve({ purpose: 'test-live', model: 'muse-spark-1.3', estUSD: 0.4 });
    await tick(2);
    // Job 2 reserves 0.40 concurrently — admitted: 0.40 (outstanding) + 0.40 <= 1.00.
    const rid2 = ledger.reserve({ purpose: 'test-live', model: 'muse-spark-1.3', estUSD: 0.4 });
    await tick(2);
    assert.ok(Math.abs(ledger.committedUSD() - 0.8) < 1e-9, 'both outstanding reservations count at their estimates');
    // A third job trying to reserve 0.25 would overshoot (0.8 + 0.25 > 1.0) and is REFUSED
    // while the first two are still in flight — the cap reserved for all in-flight jobs.
    assert.throws(
      () => ledger.reserve({ purpose: 'test-live', model: 'muse-spark-1.3', estUSD: 0.25 }),
      (err: unknown) => err instanceof Error && err.message === 'BUDGET_EXCEEDED',
      'no overshoot under concurrency: outstanding reservations are held against the cap',
    );
    // Exactly 0.20 still fits (boundary inclusive).
    const rid3 = ledger.reserve({ purpose: 'test-live', model: 'muse-spark-1.3', estUSD: 0.2 });
    assert.throws(
      () => ledger.reserve({ purpose: 'test-live', model: 'muse-spark-1.3', estUSD: 0.001 }),
      (err: unknown) => err instanceof Error && err.message === 'BUDGET_EXCEEDED',
    );
    // Settling releases headroom: real costs replace the estimates.
    ledger.reconcile(rid1, { costUSD: 0.3 });
    ledger.reconcile(rid2, { costUSD: 0.35 });
    ledger.reconcile(rid3, { costUSD: 0.1 });
    assert.ok(Math.abs(ledger.committedUSD() - 0.75) < 1e-9);
    // Now 0.25 fits again (0.75 + 0.25 <= 1.00) — no reservation was lost on the way.
    const rid4 = ledger.reserve({ purpose: 'test-live', model: 'muse-spark-1.3', estUSD: 0.25 });
    ledger.reconcile(rid4, { costUSD: 0.25 });
    assert.ok(Math.abs(ledger.committedUSD() - 1.0) < 1e-9);
    const lines = readLines(path);
    assert.equal(lines.filter(l => l.kind === 'reserve').length, 4);
    assert.equal(lines.filter(l => l.kind === 'reconcile').length, 4);
  } finally {
    ledger.close();
  }
});

test('ledger concurrency: a second process is still excluded by the OS-backed lock (LEDGER_LOCKED)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ledger-lock-concurrency-'));
  const path = join(dir, 'ledger.jsonl');
  const lockPort = await freeLockPort();
  const first: Ledger = await openLedger({ path, capUSD: 1, lockPort });
  try {
    await assert.rejects(
      () => openLedger({ path, capUSD: 1, lockPort }),
      (err: unknown) => err instanceof Error && err.message === 'LEDGER_LOCKED',
      'one owner per ledger path — concurrent SERVERS are impossible, concurrent JOBS share the owner',
    );
  } finally {
    first.close();
  }
});
