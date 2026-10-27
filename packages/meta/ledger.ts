import { appendFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { Usage } from '../contracts/index.ts';

export interface LedgerEntry {
  id: string;
  at: string;
  kind: 'reserve' | 'reconcile';
  purpose: 'test-live' | 'demo';
  model: string;
  amountUSD: number;
  reservationId?: string;
  responseId?: string;
  usage?: Usage | null;
  note?: string;
}

export interface Ledger {
  readonly capUSD: number;
  reserve(req: { purpose: 'test-live' | 'demo'; model: string; estUSD: number }): string;
  reconcile(
    reservationId: string,
    actual: { costUSD: number; responseId?: string; usage?: Usage | null; note?: string },
  ): void;
  committedUSD(): number;
  close(): void;
}

interface ReservationState {
  purpose: 'test-live' | 'demo';
  model: string;
  estUSD: number;
  reconciled: boolean;
  actualUSD: number;
}

const heldLockPaths: Set<string> = new Set<string>();
let exitListenerInstalled = false;

function installExitListener(): void {
  if (exitListenerInstalled) {
    return;
  }
  exitListenerInstalled = true;
  process.on('exit', () => {
    for (const lockPath of Array.from(heldLockPaths)) {
      try {
        const content: string = readFileSync(lockPath, 'utf8');
        if (content.trim() === String(process.pid)) {
          try {
            unlinkSync(lockPath);
          } catch {
            // ignore cleanup errors on exit
          }
        }
      } catch {
        // lock already gone
      }
      heldLockPaths.delete(lockPath);
    }
  });
}

function parentDir(filePath: string): string {
  const slash: number = filePath.lastIndexOf('/');
  const backslash: number = filePath.lastIndexOf('\\');
  const idx: number = slash > backslash ? slash : backslash;
  if (idx <= 0) {
    return '';
  }
  return filePath.slice(0, idx);
}

function releaseLockIfOwned(lockPath: string): void {
  try {
    const content: string = readFileSync(lockPath, 'utf8');
    if (content.trim() === String(process.pid)) {
      try {
        unlinkSync(lockPath);
      } catch {
        // ignore
      }
    }
  } catch {
    // already gone
  }
  heldLockPaths.delete(lockPath);
}

function acquireLock(lockPath: string): void {
  try {
    writeFileSync(lockPath, String(process.pid), { flag: 'wx' });
    heldLockPaths.add(lockPath);
    installExitListener();
    return;
  } catch (err: unknown) {
    const code: unknown = (err as { code?: unknown }).code;
    if (code !== 'EEXIST') {
      throw new Error('LEDGER_LOCKED');
    }
  }
  let content: string;
  try {
    content = readFileSync(lockPath, 'utf8');
  } catch {
    throw new Error('LEDGER_LOCKED');
  }
  const trimmed: string = content.trim();
  if (!/^[1-9][0-9]*$/.test(trimmed)) {
    throw new Error('LEDGER_LOCKED');
  }
  const pid: number = Number(trimmed);
  let alive: boolean;
  try {
    process.kill(pid, 0);
    alive = true;
  } catch (err: unknown) {
    const code: unknown = (err as { code?: unknown }).code;
    if (code === 'EPERM') {
      alive = true;
    } else if (code === 'ESRCH') {
      alive = false;
    } else {
      throw new Error('LEDGER_LOCKED');
    }
  }
  if (alive) {
    throw new Error('LEDGER_LOCKED');
  }
  try {
    unlinkSync(lockPath);
  } catch {
    throw new Error('LEDGER_LOCKED');
  }
  try {
    writeFileSync(lockPath, String(process.pid), { flag: 'wx' });
    heldLockPaths.add(lockPath);
    installExitListener();
  } catch {
    throw new Error('LEDGER_LOCKED');
  }
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
      existing.reconciled = true;
      existing.actualUSD = amountUSD;
    }
  }
  return reservations;
}

export function createLedger(opts: {
  path: string;
  capUSD: number;
  now?: () => Date;
  newId?: () => string;
}): Ledger {
  const ledgerPath: string = opts.path;
  const capUSD: number = opts.capUSD;
  if (typeof capUSD !== 'number' || !Number.isFinite(capUSD) || capUSD < 0) {
    throw new Error('INVALID_AMOUNT');
  }
  const now: () => Date = opts.now ?? (() => new Date());
  const newId: () => string = opts.newId ?? (() => randomUUID());
  const lockPath: string = `${ledgerPath}.lock`;
  const dir: string = parentDir(ledgerPath);
  if (dir !== '') {
    mkdirSync(dir, { recursive: true });
  }
  acquireLock(lockPath);
  let reservations: Map<string, ReservationState>;
  try {
    reservations = replayLedgerFile(ledgerPath);
  } catch (err: unknown) {
    releaseLockIfOwned(lockPath);
    throw err;
  }

  let closed = false;

  function ensureOpen(): void {
    if (closed) {
      throw new Error('LEDGER_CLOSED');
    }
  }

  function committedUSD(): number {
    let total = 0;
    for (const state of reservations.values()) {
      total += state.reconciled ? state.actualUSD : state.estUSD;
    }
    return total;
  }

  function appendEntry(entry: LedgerEntry): void {
    const parent: string = parentDir(ledgerPath);
    if (parent !== '') {
      mkdirSync(parent, { recursive: true });
    }
    appendFileSync(ledgerPath, JSON.stringify(entry) + '\n');
  }

  function reserve(req: { purpose: 'test-live' | 'demo'; model: string; estUSD: number }): string {
    ensureOpen();
    if (typeof req.estUSD !== 'number' || !Number.isFinite(req.estUSD) || req.estUSD < 0) {
      throw new Error('INVALID_AMOUNT');
    }
    const fresh: Map<string, ReservationState> = replayLedgerFile(ledgerPath);
    reservations.clear();
    for (const [key, state] of fresh) {
      reservations.set(key, state);
    }
    if (committedUSD() + req.estUSD > capUSD) {
      throw new Error('BUDGET_EXCEEDED');
    }
    const reservationId: string = newId();
    const entry: LedgerEntry = {
      id: reservationId,
      at: now().toISOString(),
      kind: 'reserve',
      purpose: req.purpose,
      model: req.model,
      amountUSD: req.estUSD,
      reservationId,
    };
    appendEntry(entry);
    reservations.set(reservationId, {
      purpose: req.purpose,
      model: req.model,
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
    releaseLockIfOwned(lockPath);
  }

  return {
    capUSD,
    reserve,
    reconcile,
    committedUSD,
    close,
  };
}
