// Source pane rendering (pure): the stored source texts keep their light markdown ('# Title', '## Section', pipe
// tables) because their sha256 is pinned. The pane hides the markers and styles headings without changing a single
// character offset, so quote highlights and "Show in source" keep working on the exact stored text.

export interface Decoration {
  start: number;
  end: number;
  /**
   * 'hide' removes the characters from view; the others are CSS classes for the visible text. 'md-label' styles a short
   * ALL-CAPS label ("TOPIC:"); 'md-join' marks the whitespace between a label line and its short value, which the pane
   * renders with `white-space: normal` so it collapses to one space (the characters stay in the DOM).
   */
  kind: 'hide' | 'md-h1' | 'md-h2' | 'md-pipe' | 'md-row' | 'md-label' | 'md-join';
}

export interface Segment { start: number; end: number; keys: readonly string[] }

export interface Piece {
  start: number;
  end: number;
  keys: readonly string[];
  classes: string[];
  hidden: boolean;
}

const HEADING = /^(#{1,6})[ \t]+/;
const TABLE_ROW = /^[ \t]*\|.*\|[ \t]*\r?$/;
const TABLE_SEPARATOR = /^[ \t]*\|?[ \t]*:?-{3,}:?[ \t]*(\|[ \t]*:?-{3,}:?[ \t]*)*\|?[ \t]*\r?$/;

/** Markdown markers and heading/table styling, as character ranges of the original text. */
export function markdownDecorations(text: string): Decoration[] {
  const out: Decoration[] = [];
  let lineStart = 0;
  while (lineStart <= text.length) {
    const nl = text.indexOf('\n', lineStart);
    const lineEnd = nl < 0 ? text.length : nl;
    const line = text.slice(lineStart, lineEnd);
    const heading = HEADING.exec(line);
    if (heading !== null) {
      const marker = heading[0].length;
      out.push({ start: lineStart, end: lineStart + marker, kind: 'hide' });
      const level = (heading[1] as string).length;
      const textEnd = line.endsWith('\r') ? lineEnd - 1 : lineEnd;
      if (textEnd > lineStart + marker) out.push({ start: lineStart + marker, end: textEnd, kind: level === 1 ? 'md-h1' : 'md-h2' });
    } else if (TABLE_SEPARATOR.test(line) && line.includes('-')) {
      // The |---|---| row carries no text: hide it with its line break.
      out.push({ start: lineStart, end: nl < 0 ? lineEnd : nl + 1, kind: 'hide' });
    } else if (TABLE_ROW.test(line)) {
      out.push({ start: lineStart, end: lineEnd, kind: 'md-row' });
      for (let i = 0; i < line.length; i += 1) {
        if (line[i] === '|') out.push({ start: lineStart + i, end: lineStart + i + 1, kind: 'md-pipe' });
      }
    }
    if (nl < 0) break;
    lineStart = nl + 1;
  }
  return out;
}

// ---- form-like pages (slice L) ------------------------------------------------------------------------------------
// Lesson-plan pages often arrive as "TOPIC:" / blank line / "Chemosynthesis", which reads like a broken form. The pane
// joins such a label and its short value on one line and shows at most one blank line between blocks — by styling
// character ranges only, so every quote offset and hover link still points at the exact stored characters.

interface Line { start: number; end: number; text: string }

function linesOf(text: string): Line[] {
  const out: Line[] = [];
  let start = 0;
  while (start <= text.length) {
    const nl = text.indexOf('\n', start);
    const end = nl < 0 ? text.length : nl;
    out.push({ start, end, text: text.slice(start, end) });
    if (nl < 0) break;
    start = nl + 1;
  }
  return out;
}

const LABEL_BODY = String.raw`[A-Z][A-Z0-9 &/()'’,-]*[A-Z0-9)]`;
/** A line that is only an ALL-CAPS label and its colon ("GRADE LEVEL:"). */
const LABEL_LINE = new RegExp(String.raw`^([ \t]*)(${LABEL_BODY}):[ \t]*\r?$`);
/** An ALL-CAPS label at the start of a line, followed by its text on the same line ("FOCUS: Students analyze…"). */
const INLINE_LABEL = new RegExp(String.raw`^([ \t]*)(${LABEL_BODY}):(?=[ \t]+\S)`);
const BLANK = /^[ \t\r]*$/;
/** A value that starts a list, a heading or a table stays on its own line. */
const BLOCK_START = /^[ \t]*([•▪◦·*–—-]|#|\||\d+[.)][ \t])/;
const MAX_LABEL = 48;
const MAX_VALUE = 80;
/** At most this many blank lines may sit between a label and the value it is joined with. */
const MAX_GAP_LINES = 2;

const isLabel = (label: string): boolean => label.length <= MAX_LABEL && (label.match(/[A-Z]/g) ?? []).length >= 2;

/** Label styling, label–value joins and blank-line collapsing, as character ranges of the original text. */
export function layoutDecorations(text: string): Decoration[] {
  const out: Decoration[] = [];
  const lines = linesOf(text);
  const joinedGapLines = new Set<number>();

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] as Line;
    const only = LABEL_LINE.exec(line.text);
    if (only !== null && isLabel(only[2] as string)) {
      const labelStart = line.start + (only[1] as string).length;
      const colonEnd = labelStart + (only[2] as string).length + 1;
      out.push({ start: labelStart, end: colonEnd, kind: 'md-label' });
      let j = i + 1;
      while (j < lines.length && BLANK.test((lines[j] as Line).text)) j += 1;
      const value = lines[j];
      const gapLines = j - i - 1;
      if (value !== undefined && gapLines <= MAX_GAP_LINES) {
        const trimmed = value.text.trim();
        const plain = trimmed.length > 0 && trimmed.length <= MAX_VALUE && !BLOCK_START.test(value.text)
          && !LABEL_LINE.test(value.text) && !INLINE_LABEL.test(value.text);
        if (plain) {
          const valueStart = value.start + (value.text.length - value.text.trimStart().length);
          out.push({ start: colonEnd, end: valueStart, kind: 'md-join' });
          for (let k = i + 1; k < j; k += 1) joinedGapLines.add(k);
        }
      }
      continue;
    }
    const inline = INLINE_LABEL.exec(line.text);
    if (inline !== null && isLabel(inline[2] as string)) {
      const labelStart = line.start + (inline[1] as string).length;
      out.push({ start: labelStart, end: labelStart + (inline[2] as string).length + 1, kind: 'md-label' });
    }
  }

  // Runs of two or more blank lines: keep the first blank line, hide the rest with their line breaks.
  for (let i = 0; i < lines.length; i += 1) {
    if (!BLANK.test((lines[i] as Line).text) || i === 0) continue;
    let j = i;
    while (j < lines.length && BLANK.test((lines[j] as Line).text)) j += 1;
    const run = j - i;
    if (run >= 2 && !joinedGapLines.has(i)) {
      const from = (lines[i + 1] as Line).start;
      const to = j < lines.length ? (lines[j] as Line).start : text.length;
      if (to > from) out.push({ start: from, end: to, kind: 'hide' });
    }
    i = j - 1;
  }
  return out.sort((a, b) => a.start - b.start || a.end - b.end);
}

/** Every decoration the source pane draws: markdown markers and headings, then the form-like page layout. */
export function sourceDecorations(text: string): Decoration[] {
  return [...markdownDecorations(text), ...layoutDecorations(text)];
}

/**
 * Split the text into pieces at every highlight and decoration boundary. Each piece knows its quote keys (for the
 * <mark>), its classes, and whether it is hidden. Concatenating every piece gives back the exact text.
 */
export function sourcePieces(text: string, segments: readonly Segment[] | null, decorations: readonly Decoration[]): Piece[] {
  const segs: readonly Segment[] = segments === null || segments.length === 0 ? [{ start: 0, end: text.length, keys: [] }] : segments;
  const cuts = new Set<number>([0, text.length]);
  for (const s of segs) { cuts.add(s.start); cuts.add(s.end); }
  for (const d of decorations) { cuts.add(d.start); cuts.add(d.end); }
  const points = [...cuts].filter((p) => p >= 0 && p <= text.length).sort((a, b) => a - b);
  const pieces: Piece[] = [];
  let si = 0;
  for (let i = 0; i + 1 < points.length; i += 1) {
    const start = points[i] as number;
    const end = points[i + 1] as number;
    if (end <= start) continue;
    while (si < segs.length && (segs[si] as Segment).end <= start) si += 1;
    const seg = segs[si];
    const keys = seg !== undefined && seg.start <= start && seg.end >= end ? seg.keys : [];
    const covering = decorations.filter((d) => d.start <= start && d.end >= end);
    pieces.push({
      start,
      end,
      keys,
      classes: covering.filter((d) => d.kind !== 'hide').map((d) => d.kind),
      hidden: covering.some((d) => d.kind === 'hide'),
    });
  }
  return pieces;
}
