// Teacher diagram (beta), docs/specs/TEACHER-FIGURE.md section 4: the pure parts of adding ONE diagram to Your own
// source. The browser draws the image to a canvas (components/figureImage.ts) at the size `fitLongSide` gives and
// re-encodes it as PNG; this file holds the maths, the request body, the clipboard rule, the error wording and the
// credit line choice, so node tests cover them without a DOM. The server re-checks everything (64..4096 px, 4 MB,
// magic bytes, caption length).

/** The long side the browser scales a diagram down to (never up). */
export const FIGURE_MAX_LONG_SIDE = 1600;
/** The server's limits on the image it stores. */
export const FIGURE_MIN_SIDE = 64;
export const FIGURE_MAX_BYTES = 4 * 1024 * 1024;
export const FIGURE_CAPTION_MAX = 300;
/** Files larger than this are not even decoded (a phone photo is ~5–15 MB; the PNG we send must end under 4 MB). */
export const FIGURE_INPUT_MAX_BYTES = 40 * 1024 * 1024;

/** The file chooser's filter. Clipboard bitmaps arrive as image/png (or image/bmp in some apps). */
export const FIGURE_ACCEPT = 'image/png,image/jpeg,image/webp';
const DECODABLE: ReadonlySet<string> = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/bmp']);

// ---- wording (one place, so the form, the preview and the lesson say the same) -----------------------------------------

export const FIGURE_FIELD_LABEL = 'Diagram';
export const FIGURE_NOTE =
  'Muse reads the printed labels and builds a Label the diagram part when the page supports it. Beta: check the covered labels before you publish.';
export const FIGURE_RIGHTS_LABEL = 'I have the right to use this image';
export const DEFAULT_TEACHER_CAPTION = 'Diagram provided by the teacher';
export const TEACHER_FIGURE_CREDIT = 'Diagram provided by the teacher · printed labels read by Muse Spark (beta)';
/** The build strip's line while Muse reads the diagram (spec section 4). */
export const LABELS_OP_TEXT = 'Reading the diagram’s labels';

// ---- scale maths ------------------------------------------------------------------------------------------------------

export interface FitSize { width: number; height: number; scaled: boolean }

/** The size to draw an image at so its long side is at most `max` px (aspect kept, whole pixels, never enlarged). */
export function fitLongSide(width: number, height: number, max = FIGURE_MAX_LONG_SIDE): FitSize {
  const w = Math.max(0, Math.round(width));
  const h = Math.max(0, Math.round(height));
  const long = Math.max(w, h);
  if (long <= max || long === 0) return { width: w, height: h, scaled: false };
  const k = max / long;
  return {
    width: w >= h ? max : Math.max(1, Math.round(w * k)),
    height: h > w ? max : Math.max(1, Math.round(h * k)),
    scaled: true,
  };
}

/** Long sides tried in turn when a PNG comes out over the server's 4 MB (a photo, not a diagram, usually). */
const STEP_DOWN = [1280, 1024, 800] as const;

/** The sizes to try encoding at: the 1600 px fit first, then smaller long sides below it, never larger than the image. */
export function encodeSizes(width: number, height: number): FitSize[] {
  const first = fitLongSide(width, height);
  const long = Math.max(first.width, first.height);
  return [first, ...STEP_DOWN.filter((m) => m < long).map((m) => fitLongSide(width, height, m))];
}

/** A plain problem with the drawn size, or null when the server will take it. */
export function sizeProblem(width: number, height: number): string | null {
  if (!(width > 0) || !(height > 0)) return 'The image could not be read. Try another file or screenshot.';
  // `width`/`height` are the drawn size, so a long thin strip scaled to 1600 px counts by its scaled short side.
  if (Math.min(width, height) < FIGURE_MIN_SIDE) return `The image is too small or too narrow: each side must be at least ${FIGURE_MIN_SIDE} pixels.`;
  return null;
}

/** A plain problem with the chosen or pasted file, or null when the browser can try to read it. */
export function figureInputProblem(file: { type: string; size: number }): string | null {
  if (!DECODABLE.has(file.type)) return 'Use a PNG, JPEG or WebP image, or paste a screenshot.';
  if (file.size <= 0) return 'The image is empty. Try another file or screenshot.';
  if (file.size > FIGURE_INPUT_MAX_BYTES) return `The file is too large to read here (over ${FIGURE_INPUT_MAX_BYTES / (1024 * 1024)} MB). Use a smaller image.`;
  return null;
}

// ---- payload ---------------------------------------------------------------------------------------------------------

/** The base64 data of a PNG data URL (what canvas.toDataURL / FileReader give), or null for anything else. */
export function base64FromDataUrl(dataUrl: string): string | null {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]*)$/.exec(dataUrl);
  return m === null ? null : (m[1] as string);
}

/** Bytes the base64 string decodes to. */
export function base64ByteLength(b64: string): number {
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - pad);
}

/** Like the server: control characters removed, runs of whitespace collapsed, trimmed. */
export function cleanCaption(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\s+/g, ' ').trim();
}

export interface FigureBody { mime: 'image/png'; base64: string; rights: true; caption?: string }
export type FigureProblems = Partial<Record<'image' | 'caption' | 'rights', string>>;

/** The POST /api/sources/:id/figure body, or the problems that stop it being sent. */
export function figurePayload(v: { base64: string; caption: string; rights: boolean }): { ok: true; body: FigureBody } | { ok: false; problems: FigureProblems } {
  const problems: FigureProblems = {};
  const caption = cleanCaption(v.caption);
  if (base64ByteLength(v.base64) > FIGURE_MAX_BYTES) problems.image = 'The image is still over 4 MB after scaling. Use a smaller or simpler image.';
  if (caption.length > FIGURE_CAPTION_MAX) problems.caption = `The caption must be at most ${FIGURE_CAPTION_MAX} characters.`;
  if (v.rights !== true) problems.rights = 'Tick the box to confirm you have the right to use this image.';
  if (Object.keys(problems).length > 0) return { ok: false, problems };
  return { ok: true, body: { mime: 'image/png', base64: v.base64, rights: true, ...(caption === '' ? {} : { caption }) } };
}

// ---- the clipboard ---------------------------------------------------------------------------------------------------

/**
 * Which clipboard item to take as the diagram, or null to let the paste go on as usual: only when the clipboard holds
 * an image file and NO text. Copying from a document often carries a picture of the text too; that paste stays text.
 */
export function pastedImageIndex(items: readonly { kind: string; type: string }[], text: string): number | null {
  if (text.trim() !== '') return null;
  const i = items.findIndex((it) => it.kind === 'file' && DECODABLE.has(it.type));
  return i < 0 ? null : i;
}

/** The paste shortcut as this computer writes it. */
export function pasteKeys(platform: string): string {
  return /mac|iphone|ipad/i.test(platform) ? '⌘V' : 'Ctrl+V';
}

/** "1,600 × 900 px · 412 KB" */
export function figureSizeText(width: number, height: number, bytes?: number): string {
  const px = `${width.toLocaleString('en-US')} × ${height.toLocaleString('en-US')} px`;
  if (bytes === undefined) return px;
  const size = bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${px} · ${size}`;
}

// ---- errors ----------------------------------------------------------------------------------------------------------

const SAVED = 'Your text was saved, but the diagram was not added.';

/** Plain words for the API's FIGURE_INVALID problem codes (docs/specs/TEACHER-FIGURE.md, As built (backend)). */
const FIGURE_PROBLEMS: Readonly<Record<string, string>> = {
  NOT_AN_OBJECT: 'The request was not understood. Reload the page and try again.',
  RIGHTS_NOT_CONFIRMED: 'Tick the box to confirm you have the right to use this image.',
  MIME_INVALID: 'Only PNG or JPEG images can be stored.',
  BASE64_INVALID: 'The image data could not be read. Try the image again.',
  IMAGE_TOO_LARGE: 'The image is over 4 MB. Use a smaller or simpler image.',
  IMAGE_TYPE_MISMATCH: 'The image data does not match its type. Try the image again.',
  IMAGE_DIMENSIONS: `Each side of the image must be between ${FIGURE_MIN_SIDE} and 4,096 pixels.`,
  CAPTION_INVALID: 'The caption could not be read. Retype it.',
  CAPTION_LENGTH: `The caption must be at most ${FIGURE_CAPTION_MAX} characters.`,
};

/**
 * The inline message after a failed figure upload. The text source is already stored, so the message says so. The
 * API's FIGURE_INVALID problem codes are put in plain words; an unknown bare code is never shown raw.
 */
export function figureErrorMessage(err: { status: number; code: string; problems: readonly string[] }, fallback?: string): string {
  // Known codes in plain words; a plain sentence (an older or newer server) as it is; an unknown bare code never raw.
  const plain = [...new Set(err.problems.map((p) => p.trim()).map((p) => FIGURE_PROBLEMS[p] ?? p).filter((p) => p !== '' && !/^[A-Z][A-Z0-9_]+$/.test(p)))];
  switch (err.code) {
    case 'FIGURE_INVALID':
      return plain.length > 0 ? `${SAVED} ${plain.map((p) => (/[.!?]$/.test(p) ? p : `${p}.`)).join(' ')}` : `${SAVED} The server did not accept the image. Try a PNG or JPEG screenshot.`;
    case 'FIGURE_SOURCE_NOT_USER': return `${SAVED} A diagram can only be added to your own text.`;
    case 'SOURCE_NOT_FOUND':
    case 'NOT_FOUND': return `${SAVED} The saved text could not be found. Try again.`;
    case 'PAYLOAD_TOO_LARGE': return `${SAVED} The image is too large for the server. Use a smaller one.`;
    default: return `${SAVED} ${fallback ?? `The request failed (${err.code}).`}`;
  }
}

// ---- what the New lesson page keeps with an own source ----------------------------------------------------------------

/** A diagram the server stored for a teacher source: sent as `figureId` with Build, shown under the preview. */
export interface AddedFigure { figureId: string; width: number; height: number; caption: string }

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const posInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0;

/** The POST /api/sources/:id/figure answer ({ figureId, width, height, created }) as the figure to keep, or null. */
export function parseAddedFigure(raw: unknown, caption: string): AddedFigure | null {
  if (!isRec(raw) || typeof raw.figureId !== 'string' || !USER_FIGURE_ID.test(raw.figureId) || !posInt(raw.width) || !posInt(raw.height)) return null;
  return { figureId: raw.figureId, width: raw.width, height: raw.height, caption: cleanCaption(caption) };
}

/** The per-source figures kept for this browser session (sessionStorage), read defensively. */
export function parseFigureMap(raw: string | null): Record<string, AddedFigure> {
  if (raw === null) return {};
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return {}; }
  if (!isRec(data)) return {};
  const out: Record<string, AddedFigure> = {};
  for (const [sourceId, v] of Object.entries(data)) {
    const f = isRec(v) ? parseAddedFigure(v, typeof v.caption === 'string' ? v.caption : '') : null;
    if (f !== null) out[sourceId] = f;
  }
  return out;
}

// ---- the lesson's credit line ------------------------------------------------------------------------------------------

/** The user-figure id the API gives teacher diagrams (`USER_FIGURE_ID_PATTERN`). */
export const USER_FIGURE_ID = /^uf-[0-9a-f]{12}$/;

/** A diagram the teacher added: the stored meta says `provided: "teacher"`, or its id is from the user figure store. */
export function isTeacherFigure(fig: { id?: string | undefined; provided?: string | undefined }): boolean {
  return fig.provided === 'teacher' || (typeof fig.id === 'string' && USER_FIGURE_ID.test(fig.id));
}

/** The caption shown above the credit: a teacher diagram's default caption would only repeat the credit line. */
export function teacherFigureCaption(fig: { id?: string | undefined; provided?: string | undefined; caption: string }): string {
  const caption = fig.caption.trim();
  return isTeacherFigure(fig) && caption === DEFAULT_TEACHER_CAPTION ? '' : caption;
}
