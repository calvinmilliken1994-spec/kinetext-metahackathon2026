// Teacher diagram (beta), docs/specs/TEACHER-FIGURE.md section 1: the teacher-figure store. Covers the id derivation
// (uf- + 12 hex of sha256(sourceId:imageSha256)) and its idempotence, the dependency-free PNG IHDR / JPEG SOF0/SOF2
// size readers on tiny hand-built byte fixtures, every FIGURE_INVALID problem, the FigureMeta sidecar values and
// figureDirFor. Temp directories only; nothing under data/ is touched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  saveUserSource,
  loadUserSourceMeta,
  USER_FIGURE_ID_PATTERN,
  userFigureId,
  userFiguresDirOf,
} from './index.ts';
import { FIGURES_DIR, figureDirFor, loadFigure, listFigures } from './figures.ts';
import {
  imageDimensions,
  normaliseFigureCaption,
  saveUserFigure,
  USER_FIGURE_DEFAULT_CAPTION,
  USER_FIGURE_LIMITS,
  validateUserFigureInput,
} from './user-figures.ts';
import { jpeg, png } from './testing/image-fixtures.ts';

const b64 = (b: Buffer): string => b.toString('base64');
const good = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  mime: 'image/png',
  base64: b64(png(640, 480)),
  rights: true,
  ...over,
});
const problemsOf = (raw: unknown): string[] => {
  const r = validateUserFigureInput(raw);
  return r.ok ? [] : r.problems;
};

/* ------------------------------------------------------------------ */
/* Dimension readers                                                    */
/* ------------------------------------------------------------------ */

test('imageDimensions reads the PNG IHDR width and height', () => {
  assert.deepEqual(imageDimensions(png(640, 480), 'image/png'), { width: 640, height: 480 });
  assert.deepEqual(imageDimensions(png(4096, 64), 'image/png'), { width: 4096, height: 64 });
  // a truncated PNG or a first chunk that is not IHDR is unreadable
  assert.equal(imageDimensions(png(640, 480).subarray(0, 20), 'image/png'), null);
  const notIhdr = png(640, 480);
  notIhdr[12] = 0x58; // 'XHDR'
  assert.equal(imageDimensions(notIhdr, 'image/png'), null);
});

test('imageDimensions reads JPEG SOF0 and SOF2 (after APP segments and fill bytes), never past SOS', () => {
  assert.deepEqual(imageDimensions(jpeg(800, 600, 0xc0), 'image/jpeg'), { width: 800, height: 600 });
  assert.deepEqual(imageDimensions(jpeg(1024, 300, 0xc2), 'image/jpeg'), { width: 1024, height: 300 });
  assert.deepEqual(imageDimensions(jpeg(100, 200, 0xc0, { fill: true }), 'image/jpeg'), { width: 100, height: 200 });
  // no SOF before the scan, another SOF type (SOF1 / SOF3) and a truncated file are unreadable
  assert.equal(imageDimensions(jpeg(800, 600, 0xc0, { sosFirst: true }), 'image/jpeg'), null);
  assert.equal(imageDimensions(jpeg(800, 600, 0xc1), 'image/jpeg'), null);
  assert.equal(imageDimensions(jpeg(800, 600, 0xc3), 'image/jpeg'), null);
  assert.equal(imageDimensions(jpeg(800, 600).subarray(0, 25), 'image/jpeg'), null);
});

test('imageDimensions refuses bytes whose magic does not match the mime', () => {
  assert.equal(imageDimensions(jpeg(800, 600), 'image/png'), null);
  assert.equal(imageDimensions(png(800, 600), 'image/jpeg'), null);
});

/* ------------------------------------------------------------------ */
/* validateUserFigureInput: every FIGURE_INVALID problem                 */
/* ------------------------------------------------------------------ */

test('validateUserFigureInput accepts a PNG and a JPEG at the size bounds and returns the decoded bytes', () => {
  const r = validateUserFigureInput(good({ caption: '  The   water\tcycle  ' }));
  assert.ok(r.ok);
  assert.equal(r.value.mime, 'image/png');
  assert.equal(r.value.width, 640);
  assert.equal(r.value.height, 480);
  assert.ok(Buffer.from(r.value.bytes).equals(png(640, 480)));
  assert.equal(r.value.caption, 'The water cycle');
  for (const [w, h] of [[64, 64], [4096, 4096], [64, 4096]] as const) {
    assert.ok(validateUserFigureInput(good({ base64: b64(png(w, h)) })).ok, `${w}x${h}`);
    assert.ok(validateUserFigureInput(good({ mime: 'image/jpeg', base64: b64(jpeg(w, h, 0xc2)) })).ok, `jpeg ${w}x${h}`);
  }
  const noCaption = validateUserFigureInput(good());
  assert.ok(noCaption.ok);
  assert.equal(noCaption.value.caption, '');
});

test('validateUserFigureInput: rights must be literally true', () => {
  for (const rights of [false, 'true', 1, undefined, null]) {
    assert.deepEqual(problemsOf(good({ rights })), ['RIGHTS_NOT_CONFIRMED'], String(rights));
  }
});

test('validateUserFigureInput: only image/png and image/jpeg', () => {
  for (const mime of ['image/gif', 'image/webp', 'image/svg+xml', 'text/html', '', undefined, 7]) {
    assert.deepEqual(problemsOf(good({ mime })), ['MIME_INVALID'], String(mime));
  }
});

test('validateUserFigureInput: base64 that does not decode', () => {
  for (const base64 of ['', '!!!!', 'abc', 'iVBORw0KGgo=====', 12, undefined, 'data:image/png;base64,iVBO']) {
    assert.deepEqual(problemsOf(good({ base64 })), ['BASE64_INVALID'], String(base64));
  }
});

test('validateUserFigureInput: decoded bytes over 4 MB', () => {
  assert.equal(USER_FIGURE_LIMITS.maxBytes, 4 * 1024 * 1024);
  assert.deepEqual(problemsOf(good({ base64: b64(png(640, 480, USER_FIGURE_LIMITS.maxBytes + 1)) })), ['IMAGE_TOO_LARGE']);
  assert.deepEqual(problemsOf(good({ base64: b64(png(640, 480, USER_FIGURE_LIMITS.maxBytes)) })), []);
});

test('validateUserFigureInput: the magic bytes must match the mime', () => {
  assert.deepEqual(problemsOf(good({ mime: 'image/jpeg', base64: b64(png(640, 480)) })), ['IMAGE_TYPE_MISMATCH']);
  assert.deepEqual(problemsOf(good({ mime: 'image/png', base64: b64(jpeg(640, 480)) })), ['IMAGE_TYPE_MISMATCH']);
  assert.deepEqual(problemsOf(good({ base64: b64(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')) })), ['IMAGE_TYPE_MISMATCH']);
});

test('validateUserFigureInput: width or height outside 64..4096, or unreadable', () => {
  for (const [w, h] of [[63, 100], [100, 63], [4097, 100], [100, 4097], [0, 0]] as const) {
    assert.deepEqual(problemsOf(good({ base64: b64(png(w, h)) })), ['IMAGE_DIMENSIONS'], `${w}x${h}`);
  }
  assert.deepEqual(problemsOf(good({ mime: 'image/jpeg', base64: b64(jpeg(800, 600, 0xc1)) })), ['IMAGE_DIMENSIONS'], 'SOF1 is not read');
  assert.deepEqual(problemsOf(good({ mime: 'image/jpeg', base64: b64(jpeg(5000, 600, 0xc2)) })), ['IMAGE_DIMENSIONS']);
});

test('validateUserFigureInput: caption over 300 characters after collapse, control characters removed', () => {
  assert.equal(USER_FIGURE_LIMITS.captionMax, 300);
  assert.deepEqual(problemsOf(good({ caption: 'x'.repeat(301) })), ['CAPTION_LENGTH']);
  // whitespace runs collapse before counting, so 300 letters wrapped in spaces still fit
  assert.deepEqual(problemsOf(good({ caption: `   ${'x'.repeat(300)}  \n ` })), []);
  assert.deepEqual(problemsOf(good({ caption: 42 })), ['CAPTION_INVALID']);
  assert.equal(normaliseFigureCaption('  A\u0007 b\n\n\tc \u200b\u202e'), 'A b c', 'zero-width and bidi controls go too');
  assert.equal(normaliseFigureCaption('Line\u0000one\r\nline two'), 'Lineone line two');
});

test('validateUserFigureInput: a non-object body, and several problems at once', () => {
  for (const raw of [null, 'x', [], 3]) assert.deepEqual(problemsOf(raw), ['NOT_AN_OBJECT']);
  assert.deepEqual(problemsOf({ mime: 'image/gif', base64: '!!', rights: false, caption: 'y'.repeat(400) }), [
    'RIGHTS_NOT_CONFIRMED',
    'MIME_INVALID',
    'BASE64_INVALID',
    'CAPTION_LENGTH',
  ]);
});

/* ------------------------------------------------------------------ */
/* Store: id, idempotence, sidecar, figureDirFor                          */
/* ------------------------------------------------------------------ */

const PAGE = 'The water cycle moves water between the oceans, the air and the land. '.repeat(6);

function userSource(locator?: string): { storage: string; sourceId: string } {
  const storage = mkdtempSync(join(tmpdir(), 'tf-store-'));
  const { id } = saveUserSource(
    {
      title: 'Water cycle notes',
      text: PAGE + (locator ?? ''),
      license: 'cc-by',
      attribution: 'Ms Example, Example School',
      rightsConfirmed: true,
      ...(locator !== undefined ? { locator } : {}),
    },
    join(storage, 'user-sources'),
  );
  return { storage, sourceId: id };
}

const sha = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');

test('userFigureId: uf- + the first 12 hex of sha256(sourceId:imageSha256); the pattern and the store dir', () => {
  const img = sha(png(640, 480));
  const id = userFigureId('user-0123456789ab', img);
  assert.equal(id, `uf-${sha(`user-0123456789ab:${img}`).slice(0, 12)}`);
  assert.match(id, USER_FIGURE_ID_PATTERN);
  assert.notEqual(userFigureId('user-0123456789ac', img), id, 'the same image for another source is another id');
  for (const bad of ['uf-0123456789a', 'uf-0123456789abc', 'uf-0123456789AB', 'xf-0123456789ab', 'uf-0123456789ab.json']) {
    assert.doesNotMatch(bad, USER_FIGURE_ID_PATTERN, bad);
  }
  assert.equal(userFiguresDirOf('/x/storage'), join('/x/storage', 'user-figures'));
});

test('saveUserFigure writes the exact bytes and a FigureMeta sidecar; the same image again is created:false and untouched', () => {
  const { storage, sourceId } = userSource();
  const source = loadUserSourceMeta(sourceId, join(storage, 'user-sources'));
  const dir = userFiguresDirOf(storage);
  const bytes = png(640, 480);
  const at = new Date('2026-11-03T05:06:07.000Z');
  const first = saveUserFigure({ mime: 'image/png', bytes, width: 640, height: 480, caption: '' }, source, dir, { now: () => at });
  const id = userFigureId(sourceId, sha(bytes));
  assert.deepEqual(first, { figureId: id, width: 640, height: 480, created: true });
  assert.ok(readFileSync(join(dir, `${id}.png`)).equals(bytes), 'exact uploaded bytes');
  const meta = JSON.parse(readFileSync(join(dir, `${id}.json`), 'utf8'));
  assert.deepEqual(meta, {
    id,
    sourceId,
    file: `${id}.png`,
    mime: 'image/png',
    sha256: sha(bytes),
    width: 640,
    height: 480,
    imageUrl: '',
    pageUrl: '',
    caption: USER_FIGURE_DEFAULT_CAPTION,
    altText: USER_FIGURE_DEFAULT_CAPTION,
    credit: 'Ms Example, Example School',
    license: 'CC BY 4.0',
    licenseEvidence: 'Teacher confirmed the rights to use this image when adding it (2026-11-03)',
    labelsInImage: true,
    retrievedAt: '2026-11-03T05:06:07.000Z',
    provided: 'teacher',
  });
  assert.equal(USER_FIGURE_DEFAULT_CAPTION, 'Diagram provided by the teacher');
  // the library loaders read it through figureDirFor, sha256-verified
  const loaded = loadFigure(id, figureDirFor(id, dir));
  assert.equal(loaded.meta.provided, 'teacher');
  assert.ok(Buffer.from(loaded.bytes).equals(bytes));
  assert.deepEqual(listFigures(sourceId, figureDirFor(id, dir)).map(f => f.id), [id]);

  const mtime = statSync(join(dir, `${id}.json`)).mtimeMs;
  const again = saveUserFigure(
    { mime: 'image/png', bytes, width: 640, height: 480, caption: 'A new caption that is not stored' },
    source,
    dir,
    { now: () => new Date('2027-01-01T00:00:00Z') },
  );
  assert.deepEqual(again, { figureId: id, width: 640, height: 480, created: false });
  assert.equal(statSync(join(dir, `${id}.json`)).mtimeMs, mtime, 'nothing is ever rewritten');
  assert.equal(JSON.parse(readFileSync(join(dir, `${id}.json`), 'utf8')).caption, USER_FIGURE_DEFAULT_CAPTION);

  // a new image is a new id (a JPEG gets .jpg)
  const jpg = jpeg(800, 600, 0xc2);
  const second = saveUserFigure({ mime: 'image/jpeg', bytes: jpg, width: 800, height: 600, caption: 'Water cycle' }, source, dir);
  assert.notEqual(second.figureId, id);
  assert.equal(second.created, true);
  assert.ok(existsSync(join(dir, `${second.figureId}.jpg`)));
  const meta2 = JSON.parse(readFileSync(join(dir, `${second.figureId}.json`), 'utf8'));
  assert.equal(meta2.caption, 'Water cycle');
  assert.equal(meta2.altText, 'Water cycle');
  assert.equal(meta2.mime, 'image/jpeg');
});

test('saveUserFigure: pageUrl is the source link when it has one, else empty', () => {
  const { storage, sourceId } = userSource('https://example.org/water-cycle');
  const source = loadUserSourceMeta(sourceId, join(storage, 'user-sources'));
  const dir = userFiguresDirOf(storage);
  const { figureId } = saveUserFigure({ mime: 'image/png', bytes: png(100, 100), width: 100, height: 100, caption: '' }, source, dir);
  assert.equal(JSON.parse(readFileSync(join(dir, `${figureId}.json`), 'utf8')).pageUrl, 'https://example.org/water-cycle');
});

test('figureDirFor: uf- ids resolve to the user dir, every other id to FIGURES_DIR', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'tf-dir-')), 'user-figures');
  const u = figureDirFor('uf-0123456789ab', dir);
  assert.ok(u.href.endsWith('/'), 'a directory URL (relative lookups stay inside it)');
  assert.equal(resolve(fileURLToPath(u)), resolve(dir));
  assert.equal(figureDirFor('medlineplus-dna-structure-1', dir).href, FIGURES_DIR.href);
  assert.equal(figureDirFor('uf-0123456789abc', dir).href, FIGURES_DIR.href, 'a near-miss id is not a user figure');
});
