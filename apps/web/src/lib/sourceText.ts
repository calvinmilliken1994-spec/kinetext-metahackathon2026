// Source pane rendering (pure): the stored source texts keep their light markdown ('# Title', '## Section', pipe
// tables) because their sha256 is pinned. The pane hides the markers and styles headings without changing a single
// character offset, so quote highlights and "Show in source" keep working on the exact stored text.

export interface Decoration {
  start: number;
  end: number;
  /** 'hide' removes the characters from view; the others are CSS classes for the visible text. */
  kind: 'hide' | 'md-h1' | 'md-h2' | 'md-pipe' | 'md-row';
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
