// Serve-time sentence case for part titles (Calvin, 3 Nov). A few older runs stored titles such as "merge sort"; the
// stored files stay as they are, the API capitalises what it serves. Only an all-lowercase first word is changed, so
// a mixed-case word the model chose on purpose ("pH acidity ladder") is kept.

/** The title with its first letter capitalised when its first word is written all in lower case. */
export function capitaliseTitle(title: string): string {
  const first = /^\S+/.exec(title)?.[0] ?? '';
  if (first === '' || first !== first.toLowerCase() || first === first.toUpperCase()) return title;
  return title.charAt(0).toUpperCase() + title.slice(1);
}

/** Capitalises a served spec's `title` in place; anything that is not an object with a string title is ignored. */
export function capitaliseSpecTitle(spec: unknown): void {
  if (typeof spec !== 'object' || spec === null) return;
  const s = spec as { title?: unknown };
  if (typeof s.title === 'string') s.title = capitaliseTitle(s.title);
}
