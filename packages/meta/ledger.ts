import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
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
}

interface ReservationState {
  purpose: 'test-live' | 'demo';
  model: string;
  estUSD: number;
  reconciled: boolean;
  actualUSD: number;
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

export function createLedger(opts: {
  path: string;
  capUSD: number;
  now?: () => Date;
  newId?: () => string;
}): Ledger {
  const ledgerPath: string = opts.path;
  const capUSD: number = opts.capUSD;
  const now: () => Date = opts.now ?? (() => new Date());
  const newId: () => string = opts.newId ?? (() => randomUUID());
  const reservations: Map<string, ReservationState> = new Map<string, ReservationState>();

  if (existsSync(ledgerPath)) {
    const text: string = readFileSync(ledgerPath, 'utf8');
    const lines: string[] = text.split('\n');
    for (const line of lines) {
      if (line.trim() === '') {
        continue;
      }
      const parsed: unknown = JSON.parse(line);
      const entry: LedgerEntry = parsed as LedgerEntry;
      if (entry.kind === 'reserve') {
        const key: string = entry.reservationId ?? entry.id;
        reservations.set(key, {
          purpose: entry.purpose,
          model: entry.model,
          estUSD: entry.amountUSD,
          reconciled: false,
          actualUSD: 0,
        });
      } else if (entry.kind === 'reconcile') {
        const key: string = entry.reservationId ?? '';
        const existing: ReservationState | undefined = reservations.get(key);
        if (existing !== undefined) {
          existing.reconciled = true;
          existing.actualUSD = entry.amountUSD;
        } else if (key !== '') {
          reservations.set(key, {
            purpose: entry.purpose,
            model: entry.model,
            estUSD: 0,
            reconciled: true,
            actualUSD: entry.amountUSD,
          });
        }
      }
    }
  }

  function committedUSD(): number {
    let total: number = 0;
    for (const state of reservations.values()) {
      total += state.reconciled ? state.actualUSD : state.estUSD;
    }
    return total;
  }

  function appendEntry(entry: LedgerEntry): void {
    const dir: string = parentDir(ledgerPath);
    if (dir !== '') {
      mkdirSync(dir, { recursive: true });
    }
    appendFileSync(ledgerPath, JSON.stringify(entry) + '\n');
  }

  function reserve(req: { purpose: 'test-live' | 'demo'; model: string; estUSD: number }): string {
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

  return {
    capUSD,
    reserve,
    reconcile,
    committedUSD,
  };
}
