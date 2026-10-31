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

/** One printed-label box in image pixels (x2/y2 exclusive). */
export interface FigureLabelBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * Stage 8b (lead): the lead-verified positions of EVERY printed label in a figure
 * (`<id>.labels.json`), so the lesson covers them all regardless of the boxes Muse writes.
 * Missing file, a different image hash or a malformed box gives [] (the view then falls back to Muse's boxes).
 */
export function loadFigureLabelBoxes(figureId: string, dir: URL = FIGURES_DIR): FigureLabelBox[] {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(figureId)) return [];
  try {
    const meta = readMeta(figureId, dir);
    const raw = JSON.parse(readFileSync(new URL(`${figureId}.labels.json`, dir), 'utf8')) as {
      figureId?: unknown; imageSha256?: unknown; boxes?: unknown;
    };
    if (raw.figureId !== figureId || raw.imageSha256 !== meta.sha256 || !Array.isArray(raw.boxes)) return [];
    const ok = (b: unknown): b is FigureLabelBox => {
      const o = b as Record<string, unknown>;
      return [o?.['x1'], o?.['y1'], o?.['x2'], o?.['y2']].every((n) => Number.isInteger(n)) &&
        (o['x1'] as number) >= 0 && (o['y1'] as number) >= 0 &&
        (o['x1'] as number) < (o['x2'] as number) && (o['y1'] as number) < (o['y2'] as number) &&
        (o['x2'] as number) <= meta.width && (o['y2'] as number) <= meta.height;
    };
    if (!raw.boxes.every(ok)) return [];
    return (raw.boxes as FigureLabelBox[]).map(({ x1, y1, x2, y2 }) => ({ x1, y1, x2, y2 }));
  } catch {
    return [];
  }
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
