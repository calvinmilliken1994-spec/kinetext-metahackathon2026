// Cold-start skeletons for the lesson and the source page (pure). UX pair review 2, M7: the first frame of a lesson
// used to be empty dark panels with "Loading the lesson…" and "Loading the page…". The sketches have the lesson's shape
// (the title, the status line, the first part with a figure beside its controls, then the notes) and the page's text as
// bars, so the wait reads as the lesson arriving. Bar widths are fixed per seed, so the sketch never jitters.

/** Widths (percent) of a paragraph's lines: long lines with a little variation, the last line the shortest. */
export function paragraphLines(count: number, seed: number): number[] {
  if (count <= 0) return [];
  // A small fixed sequence stepped by the seed: deterministic, no Math.random (a re-render must draw the same sketch).
  const steps = [96, 91, 98, 88, 94, 90, 97, 86];
  const lines: number[] = [];
  for (let i = 0; i < count - 1; i++) lines.push(steps[(seed * 3 + i) % steps.length] as number);
  const shortest = lines.length === 0 ? 98 : Math.min(...lines);
  // The last line: 45–78%, and always shorter than every full line above it.
  lines.push(Math.min(shortest - 8, 45 + ((seed * 11) % 34)));
  return lines;
}

/** The source page: lines per paragraph (a heading-like single line, then text paragraphs). */
export const SOURCE_SKELETON: readonly (readonly number[])[] = [
  paragraphLines(1, 0),
  paragraphLines(4, 1),
  paragraphLines(5, 2),
  paragraphLines(3, 3),
  paragraphLines(5, 4),
  paragraphLines(4, 5),
];

/** The lesson: the first part's controls beside its figure, and the notes' key points. */
export const LESSON_SKELETON = {
  controls: 4,
  notes: [paragraphLines(1, 6), paragraphLines(1, 7), paragraphLines(1, 8)].map((l) => l[0] as number),
} as const;
