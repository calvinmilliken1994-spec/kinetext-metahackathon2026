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
  /** In-memory only (never in the sidecar JSON): the stored printed-label boxes, attached by the lesson worker. */
  labelBoxes?: FigureLabelBox[];
  /** In-memory only: the Stage 8c lead-curated label groups that name drawn parts (labels.json `partLabelGroups`), attached by the lesson worker. */
  partLabelGroups?: number[];
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

/** Longest printed-label text a stored box may carry (matches the label name limit family). */
export const FIGURE_LABEL_TEXT_MAX = 80;

/**
 * One printed-label box in image pixels (x2/y2 exclusive).
 * `text` (Set A, B-06/W-01) is the printed word(s) inside the box, in reading order; `group` is a
 * non-negative integer shared by the boxes that are lines or pieces of ONE printed label
 * ("Sugar phosphate" over "backbone"). Both are optional: a box without `text` carries no known
 * words (a drawing, or a word nobody has transcribed yet) and the label-identity check ignores it.
 */
export interface FigureLabelBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  text?: string;
  group?: number;
}

/**
 * Stage 8b (lead): the lead-verified positions of EVERY printed label in a figure
 * (`<id>.labels.json`), so the lesson covers them all regardless of the boxes Muse writes.
 * Missing file, a different image hash or a malformed box gives [] (the view then falls back to Muse's boxes).
 */
export function loadFigureLabelBoxes(figureId: string, dir: URL = FIGURES_DIR): FigureLabelBox[] {
  return readLabelsFile(figureId, dir)?.boxes ?? [];
}

interface LabelsFile {
  boxes: FigureLabelBox[];
  partLabelGroups?: number[];
}

/** Validated contents of `<id>.labels.json`, or null when the file is missing, stale (different image hash) or malformed. */
function readLabelsFile(figureId: string, dir: URL): LabelsFile | null {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(figureId)) return null;
  try {
    const meta = readMeta(figureId, dir);
    const raw = JSON.parse(readFileSync(new URL(`${figureId}.labels.json`, dir), 'utf8')) as {
      figureId?: unknown; imageSha256?: unknown; boxes?: unknown; partLabelGroups?: unknown;
    };
    if (raw.figureId !== figureId || raw.imageSha256 !== meta.sha256 || !Array.isArray(raw.boxes)) return null;
    const ok = (b: unknown): b is FigureLabelBox => {
      const o = b as Record<string, unknown>;
      return [o?.['x1'], o?.['y1'], o?.['x2'], o?.['y2']].every((n) => Number.isInteger(n)) &&
        (o['x1'] as number) >= 0 && (o['y1'] as number) >= 0 &&
        (o['x1'] as number) < (o['x2'] as number) && (o['y1'] as number) < (o['y2'] as number) &&
        (o['x2'] as number) <= meta.width && (o['y2'] as number) <= meta.height;
    };
    const extrasOk = (b: unknown): boolean => {
      const o = b as Record<string, unknown>;
      const text = o['text'];
      const group = o['group'];
      return (text === undefined || (typeof text === 'string' && text.length >= 1 && text.length <= FIGURE_LABEL_TEXT_MAX)) &&
        (group === undefined || (Number.isInteger(group) && (group as number) >= 0));
    };
    if (!raw.boxes.every(ok) || !raw.boxes.every(extrasOk)) return null;
    const boxes = (raw.boxes as FigureLabelBox[]).map(({ x1, y1, x2, y2, text, group }) => ({
      x1, y1, x2, y2,
      ...(text !== undefined ? { text } : {}),
      ...(group !== undefined ? { group } : {}),
    }));
    // Stage 8c: absent or malformed means "not curated" (LD-10 is skipped), never a partial list.
    const g = raw.partLabelGroups;
    const groupsOk = Array.isArray(g) && g.length > 0 && g.every((n) => Number.isInteger(n) && (n as number) >= 0);
    return {
      boxes,
      ...(groupsOk ? { partLabelGroups: [...new Set(g as number[])].sort((a, b) => a - b) } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * Stage 8c: the label `group` numbers that name drawn parts of the figure (lead-curated in
 * `<id>.labels.json` as `partLabelGroups`, ascending, de-duplicated). undefined = not curated, in
 * which case LD-10 is skipped and no printed-label list is sent to Muse.
 */
export function loadFigurePartLabelGroups(figureId: string, dir: URL = FIGURES_DIR): number[] | undefined {
  return readLabelsFile(figureId, dir)?.partLabelGroups;
}

/**
 * Stage 8c: one string per printed-label group, in ascending group order. A group's text boxes are joined
 * with a single space in file (reading) order; boxes without text or group are skipped, and so is a group
 * with no text at all. `groups` limits the result to those group numbers (the order stays ascending).
 */
export function printedLabelsOf(boxes: readonly FigureLabelBox[], groups?: readonly number[]): string[] {
  const wanted = groups === undefined ? null : new Set(groups);
  const byGroup = new Map<number, string[]>();
  for (const b of boxes) {
    if (b.group === undefined || b.text === undefined) continue;
    if (wanted !== null && !wanted.has(b.group)) continue;
    const text = b.text.trim().replace(/\s+/g, ' ');
    if (text === '') continue;
    const lines = byGroup.get(b.group);
    if (lines === undefined) byGroup.set(b.group, [text]);
    else lines.push(text);
  }
  return [...byGroup.keys()].sort((a, b) => a - b).map((g) => (byGroup.get(g) as string[]).join(' '));
}

/**
 * Stage 8c: the printed labels sent to Muse for a figure: the curated `partLabelGroups` only, one string per
 * group in group order (e.g. ["Condensation", "Precipitation", ...]). [] when the figure is not curated.
 */
export function loadFigurePrintedLabels(figureId: string, dir: URL = FIGURES_DIR): string[] {
  const file = readLabelsFile(figureId, dir);
  if (file === null || file.partLabelGroups === undefined) return [];
  return printedLabelsOf(file.boxes, file.partLabelGroups);
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
