// Licence-checked figure library for Stage 8b label-the-diagram. Image bytes live under
// data/figures/ next to their Part 1 JSON sidecars; every load re-verifies the sha256 so a
// lesson can never label a silently changed figure. Server-side only: uses node:crypto/node:fs.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';

export const FIGURES_DIR = new URL('../../data/figures/', import.meta.url);

/** Part 1 JSON sidecar for one library figure. */
export interface FigureMeta {
  id: string;
  sourceId: string;
  file: string;
  mime: string;
  sha256: string;
  width: number;
  height: number;
  imageUrl: string;
  pageUrl: string;
  caption: string;
  altText: string;
  credit: string;
  license: string;
  licenseEvidence: string;
  labelsInImage: boolean;
  retrievedAt: string;
}

function readMeta(id: string, dir: URL): FigureMeta {
  return JSON.parse(readFileSync(new URL(`${id}.json`, dir), 'utf8')) as FigureMeta;
}

/** Every figure belonging to a library source, sorted by id. Empty when the source has no figures. */
export function listFigures(sourceId: string, dir: URL = FIGURES_DIR): FigureMeta[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const out: FigureMeta[] = [];
  for (const f of entries) {
    if (!f.endsWith('.json')) continue;
    const id = f.slice(0, -5);
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) continue;
    let meta: FigureMeta;
    try {
      meta = readMeta(id, dir);
    } catch {
      continue;
    }
    if (meta.sourceId === sourceId) out.push(meta);
  }
  out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}

/** Load a figure's meta plus its exact stored bytes, refusing any whose bytes no longer match the recorded sha256. */
export function loadFigure(figureId: string, dir: URL = FIGURES_DIR): { meta: FigureMeta; bytes: Uint8Array } {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(figureId)) throw new Error('FIGURE_NOT_FOUND');
  let meta: FigureMeta;
  try {
    meta = readMeta(figureId, dir);
  } catch {
    throw new Error('FIGURE_NOT_FOUND');
  }
  let bytes: Uint8Array;
  try {
    bytes = readFileSync(new URL(meta.file, dir));
  } catch {
    throw new Error('FIGURE_NOT_FOUND');
  }
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (hash !== meta.sha256) throw new Error('FIGURE_HASH_MISMATCH');
  return { meta, bytes };
}
