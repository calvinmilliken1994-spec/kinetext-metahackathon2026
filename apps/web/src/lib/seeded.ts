// Seeded, reproducible orderings for the Stage 6 views (pure). The same seed always gives the same order, so a lecture
// demo starts the same way every time; the start is never the answer order.

import { hash32, mulberry32 } from './timeline.ts';

export interface SeededOptions<T> {
  /** An item that must not come first (for example the right answer of a quiz card). */
  avoidFirst?: T;
}

/**
 * A seeded shuffle of `items` that is never the original order (for two or more items) and, when `avoidFirst` is given,
 * never starts with that item. Returns a new array.
 */
export function seededOrder<T>(items: readonly T[], seed: string, opts: SeededOptions<T> = {}): T[] {
  const n = items.length;
  if (n < 2) return [...items];
  const avoid = opts.avoidFirst === undefined ? -1 : items.indexOf(opts.avoidFirst);
  const accept = (perm: number[]): boolean => !perm.every((v, i) => v === i) && (avoid < 0 || perm[0] !== avoid);
  for (let attempt = 0; attempt < 64; attempt++) {
    const rng = mulberry32(hash32(`${seed}#${attempt}`));
    const perm = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [perm[i], perm[j]] = [perm[j] as number, perm[i] as number];
    }
    if (accept(perm)) return perm.map((i) => items[i] as T);
  }
  // Practically unreachable: a rotation by one is never the identity, and swapping handles the avoided first item.
  const rotated = Array.from({ length: n }, (_, i) => (i + 1) % n);
  if (avoid >= 0 && rotated[0] === avoid) [rotated[0], rotated[1]] = [rotated[1] as number, rotated[0] as number];
  return rotated.map((i) => items[i] as T);
}
