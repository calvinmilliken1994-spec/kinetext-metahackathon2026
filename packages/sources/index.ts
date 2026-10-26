// Licensed source registry — owned by the lead. Loads stored source texts and refuses any whose bytes
// no longer match the recorded sha256 (so a spec can never cite a silently changed source).
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import type { SourceDocument } from '../contracts/index.ts';

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
