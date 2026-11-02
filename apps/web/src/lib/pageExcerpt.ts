// Welcome v3 (docs/specs/WELCOME-V3-split.md): a clean excerpt of a source page with the sentence a lesson part was
// written from lit. Only the page's own words, in page order: the cited sentence (whole, even when the part quoted a
// fragment of it), a little of what comes before it in its section, and a little of what follows. Headings bound the
// excerpt, markdown table rows are never shown or lit, and a quote the page does not contain lights nothing (null).
// Pure: no React, no DOM, no network. Kept free of montage specifics so a later wall of lesson previews can reuse it.

export interface ExcerptPiece { text: string; lit: boolean }
export interface ExcerptBlock { kind: 'heading' | 'text' | 'item'; pieces: ExcerptPiece[] }
export interface PageExcerpt {
  blocks: ExcerptBlock[];
  /** The lit run: the whole page sentence (or adjacent sentences) the quote sits in. */
  lit: string;
}

/** Characters of context before and after the lit run (whole sentences only). */
export interface ExcerptBudget { before: number; after: number }
export const EXCERPT_BUDGET: ExcerptBudget = { before: 170, after: 230 };

type BlockKind = ExcerptBlock['kind'] | 'table';
interface Block { kind: BlockKind; text: string }

const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();

function classify(raw: string): Block | null {
  const text = norm(raw);
  if (text === '') return null;
  if (text.startsWith('#')) return { kind: 'heading', text: text.replace(/^#+\s*/, '') };
  if (text.startsWith('|')) return { kind: 'table', text };
  if (/^(?:[•\-*]|\d+[.)])\s/.test(text)) return { kind: 'item', text };
  const words = text.split(' ').length;
  if (text.length <= 80 && words < 12 && /^[A-Z]/.test(text) && !/[.!?:;,"”’)]$/.test(text) && !/[=*^]/.test(text)) {
    return { kind: 'heading', text };
  }
  return { kind: 'text', text };
}

function blocksOf(page: string): Block[] {
  return page.replace(/\r\n?/g, '\n').split(/\n\s*\n/).map(classify).filter((b): b is Block => b !== null);
}

/** A fragment that ends a sentence only by appearance: a list number ("1."), an initial or an abbreviation ("U.S."). */
const FALSE_END = /(?:^\d+[.)]|(?:^|[\s(])(?:[A-Z]\.)+|\b(?:Mr|Mrs|Ms|Dr|St|No|vs|etc|e\.g|i\.e|approx)\.)$/;

/** The block's sentences with their offsets in the (normalised) block text. */
function sentencesOf(text: string): { text: string; start: number; end: number }[] {
  const raw = text.split(/(?<=[.!?]["”’)]?)\s+(?=["“‘(]?[A-Z0-9])/);
  const merged: string[] = [];
  for (const s of raw) {
    const prev = merged[merged.length - 1];
    if (prev !== undefined && FALSE_END.test(prev)) merged[merged.length - 1] = `${prev} ${s}`;
    else merged.push(s);
  }
  const out: { text: string; start: number; end: number }[] = [];
  let from = 0;
  for (const s of merged) {
    const start = text.indexOf(s, from);
    const at = start < 0 ? from : start;
    out.push({ text: s, start: at, end: at + s.length });
    from = at + s.length;
  }
  return out;
}

/**
 * The excerpt round `quote`, or null when the page does not contain it (whitespace-insensitive), the quote is empty,
 * or it sits in a markdown table. Context is taken in whole sentences, never across a heading (a heading directly above
 * the cited block is kept as the excerpt's first line).
 */
export function pageExcerpt(page: string, quote: string, budget: ExcerptBudget = EXCERPT_BUDGET): PageExcerpt | null {
  const q = norm(quote);
  if (q === '' || page.trim() === '') return null;
  const blocks = blocksOf(page);
  const bi = blocks.findIndex((b) => b.text.includes(q));
  if (bi < 0) return null;
  const home = blocks[bi]!;
  if (home.kind === 'table') return null;

  const sents = sentencesOf(home.text);
  const qs = home.text.indexOf(q);
  const qe = qs + q.length;
  const litIdx = sents.map((s, i) => (s.start < qe && s.end > qs ? i : -1)).filter((i) => i >= 0);
  const first = litIdx[0]!;
  const last = litIdx[litIdx.length - 1]!;
  const litText = sents.slice(first, last + 1).map((s) => s.text).join(' ');

  // Before: same block backwards, then earlier blocks, until a heading (kept) or the budget.
  const before: ExcerptBlock[] = [];
  let room = budget.before;
  const homeBefore: ExcerptPiece[] = [];
  let open = true;
  for (let i = first - 1; i >= 0 && open; i--) {
    const t = sents[i]!.text;
    if (t.length + 1 > room) { open = false; break; }
    homeBefore.unshift({ text: t, lit: false });
    room -= t.length + 1;
  }
  if (open && homeBefore.length === first) {
    for (let b = bi - 1; b >= 0; b--) {
      const blk = blocks[b]!;
      if (blk.kind === 'heading') { before.unshift({ kind: 'heading', pieces: [{ text: blk.text, lit: false }] }); break; }
      if (blk.kind === 'table') break;
      const ss = sentencesOf(blk.text);
      const pieces: ExcerptPiece[] = [];
      let full = true;
      for (let i = ss.length - 1; i >= 0; i--) {
        const t = ss[i]!.text;
        if (t.length + 1 > room) { full = false; break; }
        pieces.unshift({ text: t, lit: false });
        room -= t.length + 1;
      }
      if (pieces.length > 0) before.unshift({ kind: blk.kind, pieces });
      if (!full) break;
    }
  }

  // After: same block forwards, then later blocks, until a heading (not kept) or the budget.
  const after: ExcerptBlock[] = [];
  room = budget.after;
  const homeAfter: ExcerptPiece[] = [];
  open = true;
  for (let i = last + 1; i < sents.length; i++) {
    const t = sents[i]!.text;
    if (t.length + 1 > room) { open = false; break; }
    homeAfter.push({ text: t, lit: false });
    room -= t.length + 1;
  }
  if (open) {
    for (let b = bi + 1; b < blocks.length; b++) {
      const blk = blocks[b]!;
      if (blk.kind === 'heading' || blk.kind === 'table') break;
      const ss = sentencesOf(blk.text);
      const pieces: ExcerptPiece[] = [];
      let full = true;
      for (const s of ss) {
        if (s.text.length + 1 > room) { full = false; break; }
        pieces.push({ text: s.text, lit: false });
        room -= s.text.length + 1;
      }
      if (pieces.length > 0) after.push({ kind: blk.kind, pieces });
      if (!full) break;
    }
  }

  const homeBlock: ExcerptBlock = { kind: home.kind, pieces: [...homeBefore, { text: litText, lit: true }, ...homeAfter] };
  return { blocks: [...before, homeBlock, ...after], lit: litText };
}
