/// <reference types="node" />
// Lesson-first slice L: the source pane renders form-like pages (label line, blank line, short value) as one line and
// collapses runs of blank lines — by CSS classes on character ranges only, never by changing the stored characters.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHighlights } from './highlight.ts';
import { layoutDecorations, markdownDecorations, sourceDecorations, sourcePieces } from './sourceText.ts';
import type { Piece } from './sourceText.ts';

const join = (text: string, pieces: readonly Piece[]): string => pieces.map((p) => text.slice(p.start, p.end)).join('');
/** What a reader sees: hidden pieces dropped, a 'md-join' piece (white-space: normal) collapsed to one space. */
const rendered = (text: string, pieces: readonly Piece[]): string => pieces
  .filter((p) => !p.hidden)
  .map((p) => (p.classes.includes('md-join') ? text.slice(p.start, p.end).replace(/\s+/g, ' ') : text.slice(p.start, p.end)))
  .join('');

const NOAA = '## Overview\n\nTOPIC:\n\nChemosynthesis\n\nFOCUS: Students analyze and compare the chemicals.\n\nGRADE LEVEL:\n\n9th-12th (Chemistry)\n\nTIME NEEDED:\n\nTwo 50-minute class period\n\nMATERIALS:\n\n• Fueling Life on Earth Slides (project for the class)\n';

test('a short ALL-CAPS label line and its short value line render as one line', () => {
  const pieces = sourcePieces(NOAA, null, sourceDecorations(NOAA));
  assert.equal(join(NOAA, pieces), NOAA, 'every stored character is still there, in order');
  const out = rendered(NOAA, pieces);
  assert.match(out, /TOPIC: Chemosynthesis\n\nFOCUS:/);
  assert.match(out, /GRADE LEVEL: 9th-12th \(Chemistry\)\n\nTIME NEEDED: Two 50-minute class period\n\n/);
});

test('a label followed by a bullet list keeps the list on its own line, but the label is still styled', () => {
  const pieces = sourcePieces(NOAA, null, sourceDecorations(NOAA));
  assert.match(rendered(NOAA, pieces), /MATERIALS:\n\n• Fueling Life/);
  const label = pieces.find((p) => NOAA.slice(p.start, p.end) === 'MATERIALS:');
  assert.ok(label?.classes.includes('md-label'));
});

test('an inline label at the start of a line is styled; its sentence is untouched', () => {
  const decorations = layoutDecorations(NOAA);
  const focus = NOAA.indexOf('FOCUS:');
  assert.ok(decorations.some((d) => d.kind === 'md-label' && d.start === focus && d.end === focus + 'FOCUS:'.length));
  // Mixed-case words and ordinary sentences are never treated as labels.
  assert.deepEqual(layoutDecorations('Note: this is a sentence.\n\nThe Moon: a rock.\n'), []);
  // Codes such as "LS2.B:" are not labels.
  assert.deepEqual(layoutDecorations('LS2.B: Cycles of Matter\n'), []);
});

test('a long value line is not pulled up beside its label', () => {
  const long = `NOTE:\n\n${'A long paragraph that keeps going well past one line of text, '.repeat(3)}\n`;
  const pieces = sourcePieces(long, null, sourceDecorations(long));
  assert.match(rendered(long, pieces), /^NOTE:\n\nA long/);
});

test('runs of three or more line breaks render as one blank line', () => {
  const text = 'First paragraph.\n\n\n\nSecond paragraph.\r\n\r\n\r\n\r\nThird.\n \n\t\n\nFourth.';
  const pieces = sourcePieces(text, null, sourceDecorations(text));
  assert.equal(join(text, pieces), text);
  assert.equal(rendered(text, pieces), 'First paragraph.\n\nSecond paragraph.\r\n\r\nThird.\n \nFourth.');
});

test('a quote that spans a joined label and value is highlighted on every character, the join included', () => {
  const hl = buildHighlights(NOAA, [{ key: 'q1', quote: 'TOPIC: Chemosynthesis' }, { key: 'q2', quote: 'Two 50-minute class period' }]);
  assert.deepEqual(hl.missing, []);
  const pieces = sourcePieces(NOAA, hl.segments, sourceDecorations(NOAA));
  const range = hl.ranges['q1'];
  assert.ok(range !== undefined);
  const inside = pieces.filter((p) => p.start >= range.start && p.end <= range.end);
  assert.equal(inside.map((p) => NOAA.slice(p.start, p.end)).join(''), NOAA.slice(range.start, range.end));
  assert.ok(inside.every((p) => p.keys.includes('q1')), 'every piece inside the quote carries its key');
  assert.ok(inside.some((p) => p.classes.includes('md-join')), 'the label-value gap is part of the mark');
  // the quote's offsets still point at the exact stored characters
  assert.equal(NOAA.slice(hl.ranges['q2']?.start, hl.ranges['q2']?.end), 'Two 50-minute class period');
});

test('sourceDecorations keeps the markdown decorations and adds the layout ones', () => {
  const md = markdownDecorations(NOAA);
  const all = sourceDecorations(NOAA);
  for (const d of md) assert.ok(all.some((a) => a.start === d.start && a.end === d.end && a.kind === d.kind));
  assert.ok(all.length > md.length);
});

test('plain prose with ordinary paragraphs gets no layout decorations', () => {
  const prose = 'Throwing a ball on the Moon\n\nThis note was written by the project team.\n\nOn the Moon there is no air.';
  assert.deepEqual(layoutDecorations(prose), []);
});
