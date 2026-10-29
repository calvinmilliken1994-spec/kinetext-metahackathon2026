import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { createServer } from 'node:net';
import type { Server, Socket } from 'node:net';
import type { Usage } from '../contracts/index.ts';
import { isMetaProvider } from './pricing.ts';
import type { MetaProvider } from './pricing.ts';

export interface LedgerEntry {
  id: string;
  at: string;
  kind: 'reserve' | 'reconcile';
  purpose: 'test-live' | 'demo';
  model: string;
  provider: MetaProvider;
  amountUSD: number;
  reservationId?: string;
  responseId?: string;
  usage?: Usage | null;
  note?: string;
}

export interface Ledger {
  readonly capUSD: number;
  readonly providerCapsUSD?: Readonly<Partial<Record<MetaProvider, number>>>;
  reserve(req: { purpose: 'test-live' | 'demo'; model: string; estUSD: number; provider?: MetaProvider }): string;
  reconcile(
    reservationId: string,
    actual: { costUSD: number; responseId?: string; usage?: Usage | null; note?: string },
  ): void;
  committedUSD(provider?: MetaProvider): number;
  close(): void;
}

interface ReservationState {
  purpose: 'test-live' | 'demo';
  model: string;
  provider: MetaProvider;
  estUSD: number;
  reconciled: boolean;
  actualUSD: number;
}

export function defaultLockPort(ledgerPath: string): number {
  const digest = createHash('sha256').update(resolve(ledgerPath), 'utf8').digest();
  const u32: number = digest.readUInt32BE(0);
  return 49152 + (u32 % 16000);
}

function replayLedgerFile(ledgerPath: string): Map<string, ReservationState> {
  const reservations: Map<string, ReservationState> = new Map<string, ReservationState>();
  const seenEntryIds: Set<string> = new Set<string>();
  if (!existsSync(ledgerPath)) {
    return reservations;
  }
  const text: string = readFileSync(ledgerPath, 'utf8');
  const lines: string[] = text.split('\n');
  for (const line of lines) {
    if (line.trim() === '') {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch {
      throw new Error('LEDGER_CORRUPT');
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('LEDGER_CORRUPT');
    }
    const entry = parsed as Record<string, unknown>;
    const kind: unknown = entry['kind'];
    if (kind !== 'reserve' && kind !== 'reconcile') {
      throw new Error('LEDGER_CORRUPT');
    }
    const purpose: unknown = entry['purpose'];
    if (purpose !== 'test-live' && purpose !== 'demo') {
      throw new Error('LEDGER_CORRUPT');
    }
    const model: unknown = entry['model'];
    if (typeof model !== 'string' || model.length === 0) {
      throw new Error('LEDGER_CORRUPT');
    }
    const amountUSD: unknown = entry['amountUSD'];
    if (typeof amountUSD !== 'number' || !Number.isFinite(amountUSD) || amountUSD < 0) {
      throw new Error('LEDGER_CORRUPT');
    }
    const id: unknown = entry['id'];
    if (typeof id !== 'string' || id.length === 0) {
      throw new Error('LEDGER_CORRUPT');
    }
    if (seenEntryIds.has(id)) {
      throw new Error('LEDGER_CORRUPT');
    }
    seenEntryIds.add(id);
    let provider: MetaProvider;
    if (!Object.hasOwn(entry, 'provider')) {
      provider = 'meta-api';
    } else {
      const providerRaw: unknown = entry['provider'];
      if (!isMetaProvider(providerRaw)) {
        throw new Error('LEDGER_CORRUPT');
      }
      provider = providerRaw;
    }
    if (kind === 'reserve') {
      const reservationIdRaw: unknown = entry['reservationId'];
      const key: string =
        typeof reservationIdRaw === 'string' && reservationIdRaw.length > 0 ? reservationIdRaw : id;
      if (reservations.has(key)) {
        throw new Error('LEDGER_CORRUPT');
      }
      reservations.set(key, {
        purpose: purpose as 'test-live' | 'demo',
        model,
        provider,
        estUSD: amountUSD,
        reconciled: false,
        actualUSD: 0,
      });
    } else {
      const reservationId: unknown = entry['reservationId'];
      if (typeof reservationId !== 'string' || reservationId.length === 0) {
        throw new Error('LEDGER_CORRUPT');
      }
      const existing: ReservationState | undefined = reservations.get(reservationId);
      if (existing === undefined || existing.reconciled) {
        throw new Error('LEDGER_CORRUPT');
      }
      if (existing.provider !== provider) {
        throw new Error('LEDGER_CORRUPT');
      }
      existing.reconciled = true;
      existing.actualUSD = amountUSD;
    }
  }
  return reservations;
}

// Lock notes: openLedger holds an OS-backed exclusive lock by listening on
// 127.0.0.1:<port> (default defaultLockPort(resolved path)). This guarantees one
// owner per ledger path among processes on this host that use openLedger with the
// same port derivation; the OS releases the listening socket automatically when the
// process exits or crashes, so stale locks cannot exist. It does NOT guarantee:
// a foreign program already bound to that port makes openLedger fail closed with
// LEDGER_LOCKED/LEDGER_LOCK_FAILED; two different path spellings of one file
// (e.g. letter case on Windows, symlinks, relative vs absolute) derive different
// ports and are not mutually excluded; writers that do not use openLedger are not
// excluded, which is why the re-read before each reserve stays.
export async function openLedger(opts: {
  path: string;
  capUSD: number;
  now?: () => Date;
  newId?: () => string;
  lockPort?: number;
  providerCapsUSD?: Readonly<Partial<Record<MetaProvider, number>>>;
}): Promise<Ledger> {
  const ledgerPath: string = opts.path;
  const capUSD: number = opts.capUSD;
  if (typeof capUSD !== 'number' || !Number.isFinite(capUSD) || capUSD < 0) {
    throw new Error('INVALID_AMOUNT');
  }
  let frozenCaps: Readonly<Partial<Record<MetaProvider, number>>> | undefined;
  if (opts.providerCapsUSD !== undefined) {
    const raw: unknown = opts.providerCapsUSD;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new Error('INVALID_PROVIDER');
    }
    const rec = raw as Record<string, unknown>;
    const copy: Partial<Record<MetaProvider, number>> = {};
    for (const key of Object.keys(rec)) {
      if (!isMetaProvider(key)) {
        throw new Error('INVALID_PROVIDER');
      }
      const v: unknown = rec[key];
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
        throw new Error('INVALID_AMOUNT');
      }
      copy[key] = v;
    }
    frozenCaps = Object.freeze(copy);
  } else {
    frozenCaps = undefined;
  }
  let port: number;
  if (opts.lockPort !== undefined) {
    if (!Number.isInteger(opts.lockPort) || opts.lockPort < 1 || opts.lockPort > 65535) {
      throw new Error('INVALID_LOCK_PORT');
    }
    port = opts.lockPort;
  } else {
    port = defaultLockPort(ledgerPath);
  }
  const now: () => Date = opts.now ?? (() => new Date());
  const newId: () => string = opts.newId ?? (() => randomUUID());
  mkdirSync(dirname(ledgerPath), { recursive: true });

  const server: Server = createServer();
  server.on('connection', (s: Socket): void => {
    s.destroy();
  });
  await new Promise<void>((resolveListen, rejectListen): void => {
    const onListening = (): void => {
      server.removeListener('error', onError);
      resolveListen();
    };
    const onError = (err: unknown): void => {
      server.removeListener('listening', onListening);
      const code: unknown = (err as { code?: unknown }).code;
      if (code === 'EADDRINUSE') {
        rejectListen(new Error('LEDGER_LOCKED'));
      } else {
        rejectListen(new Error('LEDGER_LOCK_FAILED'));
      }
    };
    server.once('listening', onListening);
    server.once('error', onError);
    server.listen({ host: '127.0.0.1', port, exclusive: true });
  });
  server.unref();
  server.on('error', (): void => {});

  let reservations: Map<string, ReservationState>;
  try {
    reservations = replayLedgerFile(ledgerPath);
  } catch (err: unknown) {
    await new Promise<void>((resolveClose): void => {
      let settled = false;
      const done = (): void => {
        if (!settled) {
          settled = true;
          resolveClose();
        }
      };
      server.once('close', done);
      try {
        server.close((): void => {
          done();
        });
      } catch {
        done();
      }
    });
    throw err;
  }

  let closed = false;

  function ensureOpen(): void {
    if (closed) {
      throw new Error('LEDGER_CLOSED');
    }
  }

  function committedUSD(provider?: MetaProvider): number {
    if (provider !== undefined && !isMetaProvider(provider)) {
      throw new Error('INVALID_PROVIDER');
    }
    let total = 0;
    for (const state of reservations.values()) {
      if (provider !== undefined && state.provider !== provider) {
        continue;
      }
      total += state.reconciled ? state.actualUSD : state.estUSD;
    }
    return total;
  }

  function appendEntry(entry: LedgerEntry): void {
    mkdirSync(dirname(ledgerPath), { recursive: true });
    appendFileSync(ledgerPath, JSON.stringify(entry) + '\n');
  }

  function reserve(req: { purpose: 'test-live' | 'demo'; model: string; estUSD: number; provider?: MetaProvider }): string {
    ensureOpen();
    let provider: MetaProvider = 'meta-api';
    if (req.provider !== undefined) {
      if (!isMetaProvider(req.provider)) {
        throw new Error('INVALID_PROVIDER');
      }
      provider = req.provider;
    }
    if (typeof req.estUSD !== 'number' || !Number.isFinite(req.estUSD) || req.estUSD < 0) {
      throw new Error('INVALID_AMOUNT');
    }
    const fresh: Map<string, ReservationState> = replayLedgerFile(ledgerPath);
    reservations.clear();
    for (const [key, state] of fresh) {
      reservations.set(key, state);
    }
    if (frozenCaps === undefined) {
      if (committedUSD() + req.estUSD > capUSD) {
        throw new Error('BUDGET_EXCEEDED');
      }
    } else {
      const capForP: number | undefined = frozenCaps[provider];
      if (capForP === undefined) {
        throw new Error('BUDGET_EXCEEDED');
      }
      if (committedUSD(provider) + req.estUSD > capForP) {
        throw new Error('BUDGET_EXCEEDED');
      }
      if (provider === 'meta-api') {
        if (committedUSD('meta-api') + req.estUSD > capUSD) {
          throw new Error('BUDGET_EXCEEDED');
        }
      }
    }
    const reservationId: string = newId();
    const entry: LedgerEntry = {
      id: reservationId,
      at: now().toISOString(),
      kind: 'reserve',
      purpose: req.purpose,
      model: req.model,
      provider,
      amountUSD: req.estUSD,
      reservationId,
    };
    appendEntry(entry);
    reservations.set(reservationId, {
      purpose: req.purpose,
      model: req.model,
      provider,
      estUSD: req.estUSD,
      reconciled: false,
      actualUSD: 0,
    });
    return reservationId;
  }

  function reconcile(
    reservationId: string,
    actual: { costUSD: number; responseId?: string; usage?: Usage | null; note?: string },
  ): void {
    ensureOpen();
    if (typeof actual.costUSD !== 'number' || !Number.isFinite(actual.costUSD) || actual.costUSD < 0) {
      throw new Error('INVALID_AMOUNT');
    }
    const state: ReservationState | undefined = reservations.get(reservationId);
    if (state === undefined || state.reconciled) {
      throw new Error('UNKNOWN_RESERVATION');
    }
    const entry: LedgerEntry = {
      id: newId(),
      at: now().toISOString(),
      kind: 'reconcile',
      purpose: state.purpose,
      model: state.model,
      provider: state.provider,
      amountUSD: actual.costUSD,
      reservationId,
    };
    if (actual.responseId !== undefined) {
      entry.responseId = actual.responseId;
    }
    if (actual.usage !== undefined) {
      entry.usage = actual.usage;
    }
    if (actual.note !== undefined) {
      entry.note = actual.note;
    }
    appendEntry(entry);
    state.reconciled = true;
    state.actualUSD = actual.costUSD;
  }

  function close(): void {
    if (closed) {
      return;
    }
    closed = true;
    try {
      server.close();
    } catch {
      // ignore close errors
    }
  }

  return {
    capUSD,
    providerCapsUSD: frozenCaps,
    reserve,
    reconcile,
    committedUSD,
    close,
  };
}
