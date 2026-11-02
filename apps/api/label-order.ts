// A label diagram's numbers follow the order its page describes the parts: part 1 is the one whose quote comes first in
// the page text. Muse lists parts in whatever order it was given the figure's printed labels (top to bottom since Stage
// 8c), which numbered the water cycle "Condensation 1 … Evaporation 4". Applied when a lesson is served, so every stored
// lesson gets it; the stored run is never rewritten. Positions, regions and checks are per part id and do not change.

const squash = (s: string): string => s.replace(/\s+/g, ' ').trim().toLowerCase();

/** Sorts a label-diagram spec's parts by where each quote sits in `pageText` (stable; quotes not found go last). */
export function orderLabelPartsByPage(spec: unknown, pageText: string): void {
  const s = spec as { componentId?: unknown; parts?: unknown } | null;
  if (s === null || typeof s !== 'object' || s.componentId !== 'label-diagram-v1' || !Array.isArray(s.parts)) return;
  const page = squash(pageText);
  const at = (p: unknown): number => {
    const q = (p as { quote?: unknown } | null)?.quote;
    const i = typeof q === 'string' && q.trim() !== '' ? page.indexOf(squash(q)) : -1;
    return i < 0 ? Number.POSITIVE_INFINITY : i;
  };
  s.parts = s.parts.map((p, i) => ({ p, i, at: at(p) }))
    .sort((a, b) => (a.at === b.at ? a.i - b.i : a.at - b.at))
    .map((x) => x.p);
}
