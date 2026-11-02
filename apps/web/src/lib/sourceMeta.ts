// The source header's quote count (pure). It used to share the credit's one line and was cut at 1920 ("21 of 21 qu…"),
// so it now has a quiet line of its own under the credit.

/** "21 of 21 quotes found on the page", or null while the text is not loaded or the lesson cites nothing. */
export function quoteCountLine({ found, total }: { found: number | null; total: number }): string | null {
  if (found === null || total === 0) return null;
  return `${found} of ${total} ${total === 1 ? 'quote' : 'quotes'} found on the page`;
}
