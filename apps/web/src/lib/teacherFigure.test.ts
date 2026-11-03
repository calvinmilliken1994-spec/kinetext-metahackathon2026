/// <reference types="node" />
// docs/specs/TEACHER-FIGURE.md section 4: a teacher may add ONE diagram with Your own source. The browser draws it to a
// canvas (long side at most 1600 px, re-encoded as PNG) and sends it after the text is saved. These are the pure parts:
// the scale maths, the payload, the clipboard rule, the error wording and the credit line choice.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  base64ByteLength, base64FromDataUrl, cleanCaption, encodeSizes, FIGURE_ACCEPT, FIGURE_MAX_BYTES, figureErrorMessage, figureInputProblem,
  figurePayload, figureSizeText, fitLongSide, isTeacherFigure, parseAddedFigure, parseFigureMap, pasteKeys, pastedImageIndex, sizeProblem,
  TEACHER_FIGURE_CREDIT, teacherFigureCaption,
} from './teacherFigure.ts';

// ---- scale maths ------------------------------------------------------------------------------------------------------

test('fitLongSide: a large landscape screenshot is scaled so the long side is 1600 px, aspect kept', () => {
  assert.deepEqual(fitLongSide(3200, 1800), { width: 1600, height: 900, scaled: true });
});

test('fitLongSide: a tall image scales on its height', () => {
  assert.deepEqual(fitLongSide(1000, 4000), { width: 400, height: 1600, scaled: true });
});

test('fitLongSide: an image already within the limit is never enlarged', () => {
  assert.deepEqual(fitLongSide(1200, 800), { width: 1200, height: 800, scaled: false });
  assert.deepEqual(fitLongSide(1600, 1600), { width: 1600, height: 1600, scaled: false });
});

test('fitLongSide: odd sizes round to whole pixels and never reach 0', () => {
  const r = fitLongSide(2001, 1001);
  assert.equal(r.width, 1600);
  assert.equal(r.height, Math.round(1001 * 1600 / 2001));
  assert.ok(Number.isInteger(r.height));
  assert.equal(fitLongSide(20000, 3).height, 1);
});

test('fitLongSide: a custom limit is honoured', () => {
  assert.deepEqual(fitLongSide(2000, 1000, 1000), { width: 1000, height: 500, scaled: true });
});

test('encodeSizes: tries 1600 first, then smaller long sides, never larger than the image', () => {
  assert.deepEqual(encodeSizes(3200, 1600).map((s) => s.width), [1600, 1280, 1024, 800]);
  assert.deepEqual(encodeSizes(1100, 500).map((s) => s.width), [1100, 1024, 800]);
  assert.deepEqual(encodeSizes(500, 300), [{ width: 500, height: 300, scaled: false }]);
});

test('sizeProblem: the server takes 64..4096 px on each side after scaling', () => {
  assert.equal(sizeProblem(1600, 900), null);
  assert.match(sizeProblem(40, 300) ?? '', /too small/i);
  assert.match(sizeProblem(0, 0) ?? '', /could not be read/i);
  // a very long strip scales its short side below 64
  const s = fitLongSide(8000, 200);
  assert.match(sizeProblem(s.width, s.height) ?? '', /too narrow|too small/i);
});

// ---- the input file --------------------------------------------------------------------------------------------------

test('FIGURE_ACCEPT lists PNG, JPEG and WebP for the file chooser', () => {
  assert.equal(FIGURE_ACCEPT, 'image/png,image/jpeg,image/webp');
});

test('figureInputProblem: PNG, JPEG, WebP and clipboard bitmaps are taken; other files are refused in plain words', () => {
  for (const type of ['image/png', 'image/jpeg', 'image/webp', 'image/bmp']) assert.equal(figureInputProblem({ type, size: 200_000 }), null, type);
  assert.match(figureInputProblem({ type: 'application/pdf', size: 1000 }) ?? '', /PNG, JPEG or WebP/);
  assert.match(figureInputProblem({ type: 'image/svg+xml', size: 1000 }) ?? '', /PNG, JPEG or WebP/);
  assert.match(figureInputProblem({ type: 'image/png', size: 60 * 1024 * 1024 }) ?? '', /too large/i);
  assert.match(figureInputProblem({ type: 'image/png', size: 0 }) ?? '', /empty/i);
});

// ---- payload ---------------------------------------------------------------------------------------------------------

test('base64FromDataUrl: takes the PNG data after the comma, refuses anything else', () => {
  assert.equal(base64FromDataUrl('data:image/png;base64,iVBORw0KGgo='), 'iVBORw0KGgo=');
  assert.equal(base64FromDataUrl('data:image/jpeg;base64,/9j/4AAQ'), null);
  assert.equal(base64FromDataUrl('not a data url'), null);
});

test('base64ByteLength: decoded size from the base64 length and padding', () => {
  assert.equal(base64ByteLength('TWFu'), 3);
  assert.equal(base64ByteLength('TWE='), 2);
  assert.equal(base64ByteLength('TQ=='), 1);
  assert.equal(base64ByteLength(''), 0);
});

test('cleanCaption: control characters removed, whitespace collapsed, trimmed', () => {
  assert.equal(cleanCaption('  The   water\tcycle\u0007\n diagram  '), 'The water cycle diagram');
});

test('figurePayload: the body the API expects, caption only when there is one', () => {
  assert.deepEqual(figurePayload({ base64: 'AAAA', caption: '   ', rights: true }), { ok: true, body: { mime: 'image/png', base64: 'AAAA', rights: true } });
  assert.deepEqual(figurePayload({ base64: 'AAAA', caption: ' Parts of a  cell ', rights: true }), { ok: true, body: { mime: 'image/png', base64: 'AAAA', rights: true, caption: 'Parts of a cell' } });
});

test('figurePayload: no rights tick, an over-long caption or an over-size image are refused before sending', () => {
  const noRights = figurePayload({ base64: 'AAAA', caption: '', rights: false });
  assert.equal(noRights.ok, false);
  assert.match(noRights.ok ? '' : noRights.problems.rights ?? '', /Tick the box/);
  const long = figurePayload({ base64: 'AAAA', caption: 'x'.repeat(301), rights: true });
  assert.match(long.ok ? '' : long.problems.caption ?? '', /300/);
  const big = figurePayload({ base64: 'A'.repeat(Math.ceil((FIGURE_MAX_BYTES + 3) / 3) * 4), caption: '', rights: true });
  assert.match(big.ok ? '' : big.problems.image ?? '', /4 MB/);
});

// ---- the clipboard ---------------------------------------------------------------------------------------------------

test('pastedImageIndex: an image file with no text goes to the diagram', () => {
  assert.equal(pastedImageIndex([{ kind: 'file', type: 'image/png' }], ''), 0);
  assert.equal(pastedImageIndex([{ kind: 'string', type: 'text/html' }, { kind: 'file', type: 'image/png' }], '  '), 1);
});

test('pastedImageIndex: text pastes stay text, even when the clipboard also holds a picture of it', () => {
  assert.equal(pastedImageIndex([{ kind: 'string', type: 'text/plain' }, { kind: 'file', type: 'image/png' }], 'Water evaporates'), null);
  assert.equal(pastedImageIndex([{ kind: 'string', type: 'text/plain' }], 'hello'), null);
  assert.equal(pastedImageIndex([{ kind: 'file', type: 'application/pdf' }], ''), null);
  assert.equal(pastedImageIndex([], ''), null);
});

test('pasteKeys: Ctrl+V, or Command-V on a Mac', () => {
  assert.equal(pasteKeys('Win32'), 'Ctrl+V');
  assert.equal(pasteKeys('MacIntel'), '⌘V');
  assert.equal(pasteKeys(''), 'Ctrl+V');
});

// ---- errors ----------------------------------------------------------------------------------------------------------

test('figureErrorMessage: the server\'s plain problems are listed; the text is said to be saved', () => {
  const m = figureErrorMessage({ status: 400, code: 'FIGURE_INVALID', problems: ['The image is smaller than 64 pixels on one side.'] });
  assert.match(m, /^Your text was saved, but the diagram was not added\./);
  assert.match(m, /smaller than 64 pixels/);
});

test('figureErrorMessage: known codes in plain words, unknown ones generic', () => {
  assert.match(figureErrorMessage({ status: 400, code: 'FIGURE_SOURCE_NOT_USER', problems: [] }), /only be added to your own text/);
  assert.match(figureErrorMessage({ status: 404, code: 'SOURCE_NOT_FOUND', problems: [] }), /could not be found/);
  assert.match(figureErrorMessage({ status: 404, code: 'NOT_FOUND', problems: [] }), /could not be found/);
  assert.match(figureErrorMessage({ status: 413, code: 'PAYLOAD_TOO_LARGE', problems: [] }), /too large/);
  assert.match(figureErrorMessage({ status: 400, code: 'FIGURE_INVALID', problems: [] }), /did not accept the image/);
  assert.match(figureErrorMessage({ status: 0, code: 'NETWORK', problems: [] }, 'Cannot reach the API.'), /Cannot reach the API\./);
});

test('figureErrorMessage: the API\'s FIGURE_INVALID problem codes become plain sentences, never raw codes', () => {
  const cases: Array<[string, RegExp]> = [
    ['RIGHTS_NOT_CONFIRMED', /right to use this image/],
    ['MIME_INVALID', /PNG or JPEG/],
    ['BASE64_INVALID', /could not be read/],
    ['IMAGE_TOO_LARGE', /4 MB/],
    ['IMAGE_TYPE_MISMATCH', /does not match/],
    ['IMAGE_DIMENSIONS', /64 and 4,096 pixels/],
    ['CAPTION_INVALID', /caption/],
    ['CAPTION_LENGTH', /300 characters/],
    ['NOT_AN_OBJECT', /Reload the page/],
  ];
  for (const [code, re] of cases) {
    const m = figureErrorMessage({ status: 400, code: 'FIGURE_INVALID', problems: [code] });
    assert.match(m, re, code);
    assert.doesNotMatch(m, new RegExp(code), code);
  }
  const unknown = figureErrorMessage({ status: 400, code: 'FIGURE_INVALID', problems: ['SOMETHING_NEW'] });
  assert.doesNotMatch(unknown, /SOMETHING_NEW/);
  assert.match(unknown, /did not accept the image/);
  const two = figureErrorMessage({ status: 400, code: 'FIGURE_INVALID', problems: ['IMAGE_TOO_LARGE', 'CAPTION_LENGTH'] });
  assert.match(two, /4 MB.*300 characters/);
});

// ---- the credit line -------------------------------------------------------------------------------------------------

test('isTeacherFigure: provided "teacher", or a uf- id from the user figure store', () => {
  assert.equal(isTeacherFigure({ id: 'noaa-hydrologic-cycle-1' }), false);
  assert.equal(isTeacherFigure({ id: 'uf-0123456789ab' }), true);
  assert.equal(isTeacherFigure({ id: 'x', provided: 'teacher' }), true);
  assert.equal(isTeacherFigure({ id: 'uf-nothex' }), false);
});

test('the teacher credit line names the teacher and Muse, marked beta', () => {
  assert.equal(TEACHER_FIGURE_CREDIT, 'Diagram provided by the teacher · printed labels read by Muse Spark (beta)');
});

test('teacherFigureCaption: the default caption is not repeated above the teacher credit', () => {
  assert.equal(teacherFigureCaption({ id: 'uf-0123456789ab', caption: 'Diagram provided by the teacher' }), '');
  assert.equal(teacherFigureCaption({ id: 'uf-0123456789ab', caption: 'Parts of a flower' }), 'Parts of a flower');
  assert.equal(teacherFigureCaption({ id: 'noaa-hydrologic-cycle-1', caption: ' The water cycle ' }), 'The water cycle');
});

// ---- what the New lesson page keeps -----------------------------------------------------------------------------------

test('parseAddedFigure: the 201/200 answer becomes the figure kept with the source', () => {
  assert.deepEqual(parseAddedFigure({ figureId: 'uf-0123456789ab', width: 1600, height: 900, created: true }, 'Parts of a flower'),
    { figureId: 'uf-0123456789ab', width: 1600, height: 900, caption: 'Parts of a flower' });
  assert.equal(parseAddedFigure({ figureId: 'noaa-1', width: 1, height: 1 }, ''), null);
  assert.equal(parseAddedFigure({ width: 10 }, ''), null);
  assert.equal(parseAddedFigure(null, ''), null);
});

test('parseFigureMap: the session copy is read defensively (bad entries dropped, junk gives an empty map)', () => {
  const ok = { figureId: 'uf-0123456789ab', width: 800, height: 600, caption: '' };
  assert.deepEqual(parseFigureMap(JSON.stringify({ 'user-a': ok, 'user-b': { figureId: 'nope' } })), { 'user-a': ok });
  assert.deepEqual(parseFigureMap('not json'), {});
  assert.deepEqual(parseFigureMap(null), {});
  assert.deepEqual(parseFigureMap('[1,2]'), {});
});

test('figureSizeText: pixels, then the PNG size', () => {
  assert.equal(figureSizeText(1600, 900), '1,600 × 900 px');
  assert.equal(figureSizeText(1600, 900, 420_000), '1,600 × 900 px · 410 KB');
  assert.equal(figureSizeText(1600, 1200, 3 * 1024 * 1024), '1,600 × 1,200 px · 3.0 MB');
});
