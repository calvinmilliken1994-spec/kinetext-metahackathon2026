// Licensed source registry — owned by the lead. Loads stored source texts and refuses any whose bytes
// no longer match the recorded sha256 (so a spec can never cite a silently changed source).
// Stage 5 (TASK-015) adds teacher-provided ('user') sources: pasted text stored under
// `<storageDir>/user-sources/user-<sha12>.{json,txt}` with the same hash verification on load.
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeUserText } from '../contracts/index.ts';
import type { SourceDocument, UserLicense, UserSourceInput } from '../contracts/index.ts';

export const SOURCES_DIR = new URL('../../data/sources/', import.meta.url);

interface SourceMeta extends Omit<SourceDocument, 'text'> { textFile: string; retrievedAt: string; transcription: string; purpose: string }

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function listSourceIds(dir: URL = SOURCES_DIR): string[] {
  return readdirSync(dir).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)).sort();
}

export function loadSourceMeta(id: string, dir: URL = SOURCES_DIR): SourceMeta {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) throw new Error('SOURCE_ID_INVALID');
  return JSON.parse(readFileSync(new URL(`${id}.json`, dir), 'utf8'));
}

export function loadSource(id: string, dir: URL = SOURCES_DIR): SourceDocument {
  const meta = loadSourceMeta(id, dir);
  const text = readFileSync(new URL(meta.textFile, dir), 'utf8');
  if (sha256(text) !== meta.sha256) throw new Error(`SOURCE_HASH_MISMATCH:${id}`);
  const doc: SourceDocument = {
    id: meta.id, title: meta.title, locator: meta.locator, license: meta.license,
    attribution: meta.attribution, sha256: meta.sha256, text,
  };
  if (meta.page !== undefined) doc.page = meta.page;
  return doc;
}

/* ------------------------------------------------------------------ */
/* Teacher-provided ('user') sources — Stage 5, TASK-015                */
/* ------------------------------------------------------------------ */

/** Stored metadata for a teacher source: SourceDocument fields minus `text`, plus storage/label fields. */
export interface UserSourceMeta {
  id: string;
  title: string;
  locator: string;
  license: string;
  /** Human-readable label for the selected licence id. */
  licenseLabel: string;
  attribution: string;
  sha256: string;
  textFile: string;
  createdAt: string;
  kind: 'user';
}

/** User source ids are system-derived: `user-` + the first 12 hex chars of sha256(normalised text). */
export const USER_SOURCE_ID_PATTERN = /^user-[0-9a-f]{12}$/;

/** Hard cap on stored teacher sources (409 SOURCE_LIMIT past this). */
export const MAX_USER_SOURCES = 200;

/** Locator used when the teacher did not provide one. */
export const DEFAULT_USER_LOCATOR = 'Provided by a teacher (pasted text)';

export const USER_LICENSE_LABELS: Readonly<Record<UserLicense, string>> = {
  'public-domain': 'Public domain',
  'cc-by': 'CC BY 4.0',
  'cc-by-sa': 'CC BY-SA 4.0',
  'own-work': "Teacher's own work",
  'permission-granted': 'Permission granted by the rights holder',
};

/** The default user-source store for a given job/API storage directory. */
export function userSourcesDirOf(storageDir: string): string {
  return join(storageDir, 'user-sources');
}

/** Deterministic id for a pasted text (hash of the NORMALISED form). */
export function userSourceId(text: string): string {
  return `user-${sha256(normalizeUserText(text)).slice(0, 12)}`;
}

export function listUserSourceIds(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries
    .filter(f => f.endsWith('.json'))
    .map(f => f.slice(0, -5))
    .filter(id => USER_SOURCE_ID_PATTERN.test(id))
    .sort();
}

export function loadUserSourceMeta(id: string, dir: string): UserSourceMeta {
  if (!USER_SOURCE_ID_PATTERN.test(id)) throw new Error('SOURCE_ID_INVALID');
  return JSON.parse(readFileSync(join(dir, `${id}.json`), 'utf8')) as UserSourceMeta;
}

/** Load a teacher source, refusing any whose stored text no longer matches its recorded sha256. */
export function loadUserSource(id: string, dir: string): SourceDocument {
  const meta = loadUserSourceMeta(id, dir);
  const text = readFileSync(join(dir, meta.textFile), 'utf8');
  if (sha256(text) !== meta.sha256) throw new Error(`SOURCE_HASH_MISMATCH:${id}`);
  return {
    id: meta.id, title: meta.title, locator: meta.locator, license: meta.license,
    attribution: meta.attribution, sha256: meta.sha256, text,
  };
}

function writeAtomic(path: string, data: string): void {
  const tmpPath = `${path}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  writeFileSync(tmpPath, data);
  renameSync(tmpPath, path);
}

/**
 * Store a validated teacher source (input.text must already be normalised by
 * validateUserSourceInput). Idempotent: identical text maps to the same id and
 * an existing store is returned unchanged (created: false). Writes are atomic;
 * the text file lands first so metadata never points at a missing text.
 */
export function saveUserSource(
  input: UserSourceInput,
  dir: string,
  opts?: { now?: () => Date },
): { id: string; created: boolean } {
  const id = userSourceId(input.text);
  mkdirSync(dir, { recursive: true });
  if (existsSync(join(dir, `${id}.json`))) {
    return { id, created: false };
  }
  const textFile = `${id}.txt`;
  const meta: UserSourceMeta = {
    id,
    title: input.title,
    locator: input.locator ?? DEFAULT_USER_LOCATOR,
    license: input.license,
    licenseLabel: USER_LICENSE_LABELS[input.license] ?? input.license,
    attribution: input.attribution,
    sha256: sha256(input.text),
    textFile,
    createdAt: (opts?.now ?? ((): Date => new Date()))().toISOString(),
    kind: 'user',
  };
  writeAtomic(join(dir, textFile), input.text);
  writeAtomic(join(dir, `${id}.json`), `${JSON.stringify(meta, null, 2)}\n`);
  return { id, created: true };
}
