/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { markdownDecorations, sourcePieces } from './sourceText.ts';

const join = (text: string, pieces: ReturnType<typeof sourcePieces>): string => pieces.map((p) => text.slice(p.start, p.end)).join('');
const visible = (text: string, pieces: ReturnType<typeof sourcePieces>): string => pieces.filter((p) => !p.hidden).map((p) => text.slice(p.start, p.end)).join('');

test('heading markers are hidden and the heading text is styled', () => {
  const text = '# Weight Equation\r\n\r\nWeight is a force.\r\n## Overview\r\nMore.';
  const pieces = sourcePieces(text, null, markdownDecorations(text));
  assert.equal(join(text, pieces), text);
  assert.equal(visible(text, pieces), 'Weight Equation\r\n\r\nWeight is a force.\r\nOverview\r\nMore.');
  assert.deepEqual(pieces.find((p) => text.slice(p.start, p.end) === 'Weight Equation')?.classes, ['md-h1']);
  assert.deepEqual(pieces.find((p) => text.slice(p.start, p.end) === 'Overview')?.classes, ['md-h2']);
});

test('a "#" inside a sentence is left alone', () => {
  const text = 'Item #3 is here.';
  assert.deepEqual(markdownDecorations(text), []);
});

test('table rows keep their text, pipes are marked faint, a separator row disappears', () => {
  const text = 'Intro\n| A | B |\n|---|---|\n| 1 | 2 |\nEnd';
  const pieces = sourcePieces(text, null, markdownDecorations(text));
  assert.equal(join(text, pieces), text);
  assert.equal(visible(text, pieces), 'Intro\n| A | B |\n| 1 | 2 |\nEnd');
  const pipes = pieces.filter((p) => p.classes.includes('md-pipe'));
  assert.equal(pipes.length, 6);
});

test('highlight keys survive the extra cuts, so a quote that crosses a heading marker still maps to its marks', () => {
  const text = '# Title\nThe quote spans here.';
  const segments = [
    { start: 0, end: 10, keys: [] },
    { start: 10, end: 19, keys: ['q1'] },
    { start: 19, end: text.length, keys: [] },
  ];
  const pieces = sourcePieces(text, segments, markdownDecorations(text));
  assert.equal(join(text, pieces), text);
  const marked = pieces.filter((p) => p.keys.includes('q1')).map((p) => text.slice(p.start, p.end)).join('');
  assert.equal(marked, text.slice(10, 19));
  // a highlight inside a heading is split at the hidden marker, never lost
  const inHeading = sourcePieces(text, [{ start: 0, end: 5, keys: ['h'] }, { start: 5, end: text.length, keys: [] }], markdownDecorations(text));
  assert.equal(inHeading.filter((p) => p.keys.includes('h')).map((p) => text.slice(p.start, p.end)).join(''), '# Tit');
});

test('a lowercase page heading gets its first letter shown as a capital (CSS only; the stored text is unchanged)', () => {
  const caps = markdownDecorations('# hash table\nbody').filter(d => d.kind === 'md-cap');
  assert.deepEqual(caps, [{ start: 2, end: 3, kind: 'md-cap' }]);
  assert.deepEqual(markdownDecorations('# pH and Water\nbody').filter(d => d.kind === 'md-cap'), []);
  assert.deepEqual(markdownDecorations('# Drag\nbody').filter(d => d.kind === 'md-cap'), []);
});
