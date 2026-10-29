// Grade lines from the pure graders start with '✓ ' or '✗ ' (their tests pin that wording). The views draw an SVG mark
// instead of the glyph: this splits the glyph off so the words stay exactly as graded.

export type MarkKind = 'ok' | 'bad';

export function splitMark(text: string): { mark: MarkKind | null; text: string } {
  if (text.startsWith('✓')) return { mark: 'ok', text: text.slice(1).trimStart() };
  if (text.startsWith('✗')) return { mark: 'bad', text: text.slice(1).trimStart() };
  return { mark: null, text };
}
