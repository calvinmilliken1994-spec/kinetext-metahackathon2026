// Teacher diagram (beta), docs/specs/TEACHER-FIGURE.md section 1: one diagram a teacher uploads with their own source.
// Validation reads the image size straight from the PNG IHDR chunk or the JPEG SOF0/SOF2 marker (no image library, no
// decoding of untrusted pixels on the server), and the store keeps the EXACT validated bytes plus a FigureMeta sidecar
// in the library's shape, so every figure loader and the label-diagram flow treat it like a library figure.
// Server-side only: uses node:crypto/node:fs.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { userFigureId, writeAtomic } from './index.ts';
import type { UserSourceMeta } from './index.ts';
import type { FigureMeta } from './figures.ts';

export const USER_FIGURE_MIMES = ['image/png', 'image/jpeg'] as const;
export type UserFigureMime = (typeof USER_FIGURE_MIMES)[number];

export const USER_FIGURE_LIMITS = {
  /** Decoded image bytes (the raw JSON body may be up to 6 MB: base64 grows the bytes by a third). */
  maxBytes: 4 * 1024 * 1024,
  minSide: 64,
  maxSide: 4096,
  captionMax: 300,
} as const;

/** Caption stored when the teacher gives none (also the alt text). */
export const USER_FIGURE_DEFAULT_CAPTION = 'Diagram provided by the teacher';

/** Plain problem codes of a 400 FIGURE_INVALID answer, in a fixed order. */
export type UserFigureProblem =
  | 'NOT_AN_OBJECT'
  | 'RIGHTS_NOT_CONFIRMED'
  | 'MIME_INVALID'
  | 'BASE64_INVALID'
  | 'IMAGE_TOO_LARGE'
  | 'IMAGE_TYPE_MISMATCH'
  | 'IMAGE_DIMENSIONS'
  | 'CAPTION_INVALID'
  | 'CAPTION_LENGTH';

/** A validated upload: the decoded bytes, their size as read from the header, and the normalised caption ('' = none). */
export interface UserFigureInput {
  mime: UserFigureMime;
  bytes: Uint8Array;
  width: number;
  height: number;
  caption: string;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function hasPrefix(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return bytes.length >= prefix.length && prefix.every((b, i) => bytes[i] === b);
}

const be16 = (b: Uint8Array, at: number): number => ((b[at] as number) << 8) | (b[at + 1] as number);
const be32 = (b: Uint8Array, at: number): number =>
  (((b[at] as number) << 24) >>> 0) + ((b[at + 1] as number) << 16) + ((b[at + 2] as number) << 8) + (b[at + 3] as number);

/** PNG: the first chunk must be IHDR (length 13); width and height are its first two big-endian words. */
function pngDimensions(b: Uint8Array): { width: number; height: number } | null {
  if (!hasPrefix(b, PNG_SIGNATURE) || b.length < 24) return null;
  if (be32(b, 8) !== 13 || b[12] !== 0x49 || b[13] !== 0x48 || b[14] !== 0x44 || b[15] !== 0x52) return null;
  return { width: be32(b, 16), height: be32(b, 20) };
}

/**
 * JPEG: walk the marker segments from SOI until SOF0 (baseline) or SOF2 (progressive) and read its height and width.
 * Any other frame type, a scan (SOS) or EOI before a frame, or a segment running past the end is unreadable.
 */
function jpegDimensions(b: Uint8Array): { width: number; height: number } | null {
  if (!hasPrefix(b, [0xff, 0xd8])) return null;
  let at = 2;
  while (at < b.length) {
    if (b[at] !== 0xff) return null;
    // Fill bytes: any number of 0xFF may precede a marker.
    while (at < b.length && b[at] === 0xff) at += 1;
    if (at >= b.length) return null;
    const marker = b[at] as number;
    at += 1;
    // Stand-alone markers carry no length (TEM, RSTn, a stray SOI).
    if (marker === 0x01 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (marker === 0xd9 || marker === 0xda) return null;
    if (at + 2 > b.length) return null;
    const length = be16(b, at);
    if (length < 2 || at + length > b.length) return null;
    if (marker === 0xc0 || marker === 0xc2) {
      if (length < 7) return null;
      return { height: be16(b, at + 3), width: be16(b, at + 5) };
    }
    // Every other SOFn (C1, C3, C5-C7, C9-CB, CD-CF) is a frame type we do not read.
    if (marker >= 0xc1 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return null;
    at += length;
  }
  return null;
}

/** True when the bytes start with the signature of `mime` (PNG signature / JPEG SOI). */
function magicMatches(bytes: Uint8Array, mime: UserFigureMime): boolean {
  return mime === 'image/png' ? hasPrefix(bytes, PNG_SIGNATURE) : hasPrefix(bytes, [0xff, 0xd8, 0xff]);
}

/** Width and height read from the header of a PNG or JPEG, or null when unreadable or not of that type. */
export function imageDimensions(bytes: Uint8Array, mime: UserFigureMime): { width: number; height: number } | null {
  if (!magicMatches(bytes, mime)) return null;
  return mime === 'image/png' ? pngDimensions(bytes) : jpegDimensions(bytes);
}

/**
 * The stored caption: whitespace runs (newlines and tabs included) become one space, the remaining control, zero-width
 * and bidi-control characters are removed (the caption is shown to students and listed to Muse), then trimmed.
 */
export function normaliseFigureCaption(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/g, '')
    .replace(/ {2,}/g, ' ')
    .trim();
}

/** Strict standard base64 (no data: prefix, no URL alphabet, padded); whitespace is ignored. Null when it does not decode. */
function decodeBase64(raw: unknown): Uint8Array | null {
  if (typeof raw !== 'string') return null;
  const text = raw.replace(/\s+/g, '');
  if (text === '' || text.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(text)) return null;
  const bytes = Buffer.from(text, 'base64');
  return bytes.length === 0 ? null : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length);
}

/**
 * Validate an upload body `{mime, base64, rights: true, caption?}`. Every problem found is listed (in a fixed order);
 * the image checks after decoding run only once the mime is known and the bytes decode, so one bad field gives one
 * problem rather than a cascade.
 */
export function validateUserFigureInput(raw: unknown): { ok: true; value: UserFigureInput } | { ok: false; problems: UserFigureProblem[] } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, problems: ['NOT_AN_OBJECT'] };
  const r = raw as Record<string, unknown>;
  const L = USER_FIGURE_LIMITS;
  const problems: UserFigureProblem[] = [];
  if (r['rights'] !== true) problems.push('RIGHTS_NOT_CONFIRMED');
  const mime = (USER_FIGURE_MIMES as readonly unknown[]).includes(r['mime']) ? (r['mime'] as UserFigureMime) : null;
  if (mime === null) problems.push('MIME_INVALID');
  const bytes = decodeBase64(r['base64']);
  if (bytes === null) problems.push('BASE64_INVALID');
  let size: { width: number; height: number } | null = null;
  if (bytes !== null && bytes.length > L.maxBytes) {
    problems.push('IMAGE_TOO_LARGE');
  } else if (bytes !== null && mime !== null) {
    if (!magicMatches(bytes, mime)) {
      problems.push('IMAGE_TYPE_MISMATCH');
    } else {
      size = imageDimensions(bytes, mime);
      const inRange = (n: number): boolean => Number.isInteger(n) && n >= L.minSide && n <= L.maxSide;
      if (size === null || !inRange(size.width) || !inRange(size.height)) problems.push('IMAGE_DIMENSIONS');
    }
  }
  let caption = '';
  const rawCaption = r['caption'];
  if (rawCaption !== undefined && rawCaption !== null) {
    if (typeof rawCaption !== 'string') problems.push('CAPTION_INVALID');
    else {
      caption = normaliseFigureCaption(rawCaption);
      if (caption.length > L.captionMax) problems.push('CAPTION_LENGTH');
    }
  }
  if (problems.length > 0 || mime === null || bytes === null || size === null) {
    return { ok: false, problems: problems.length > 0 ? problems : ['IMAGE_DIMENSIONS'] };
  }
  return { ok: true, value: { mime, bytes, width: size.width, height: size.height, caption } };
}

/**
 * Store a validated upload for a teacher source. Idempotent: the id is derived from the source and the image hash, and
 * an existing figure is returned unchanged (created: false); nothing is ever rewritten. The image lands first so the
 * sidecar never points at missing bytes; both writes are atomic.
 */
export function saveUserFigure(
  input: UserFigureInput,
  source: UserSourceMeta,
  dir: string,
  opts?: { now?: () => Date },
): { figureId: string; width: number; height: number; created: boolean } {
  const imageSha256 = createHash('sha256').update(input.bytes).digest('hex');
  const figureId = userFigureId(source.id, imageSha256);
  mkdirSync(dir, { recursive: true });
  const metaPath = join(dir, `${figureId}.json`);
  if (existsSync(metaPath)) {
    // The id binds source + bytes, so the stored figure IS this upload; answer with its stored size.
    return { figureId, width: input.width, height: input.height, created: false };
  }
  const at = (opts?.now ?? ((): Date => new Date()))();
  const file = `${figureId}.${input.mime === 'image/png' ? 'png' : 'jpg'}`;
  const caption = input.caption !== '' ? input.caption : USER_FIGURE_DEFAULT_CAPTION;
  const link = /^https?:\/\/\S+$/i.test(source.locator) ? source.locator : '';
  const meta: FigureMeta = {
    id: figureId,
    sourceId: source.id,
    file,
    mime: input.mime,
    sha256: imageSha256,
    width: input.width,
    height: input.height,
    imageUrl: '',
    pageUrl: link,
    caption,
    altText: caption,
    credit: source.attribution,
    license: source.licenseLabel,
    licenseEvidence: `Teacher confirmed the rights to use this image when adding it (${at.toISOString().slice(0, 10)})`,
    labelsInImage: true,
    retrievedAt: at.toISOString(),
    provided: 'teacher',
  };
  writeAtomic(join(dir, file), input.bytes);
  writeAtomic(metaPath, `${JSON.stringify(meta, null, 2)}\n`);
  return { figureId, width: input.width, height: input.height, created: true };
}
