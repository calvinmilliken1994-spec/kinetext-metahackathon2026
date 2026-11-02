// When an order board ("Put these steps / events in order") shows the page's order (pure). UX pair review 2, H1, and
// Calvin's Q4: a wrong check shows only which cards are out of place, so trying again still means something. The page's
// order (a sequence's step track and card quotes, a timeline's dates and quotes) is revealed when the order is right, or
// when the learner asks for it with "Show the page's order", offered from the first wrong check on.

export const SHOW_ORDER_LABEL = 'Show the page’s order';

/** The sequence board's last hint sentence (lesson view). */
export const ORDER_HINT = 'Drag a step along the track, or use its up and down arrows. The page’s order and words stay hidden until your order is right, or until you choose to see them.';

/** The timeline board's hint (lesson view). */
export const TIMELINE_ORDER_HINT = 'Earliest first. Drag a card, or use its up and down arrows. The dates stay hidden until your order is right, or until you choose to see them.';

/** What one "Check order" does: whether to reveal the page's order now, and whether a miss has happened yet. */
export function afterOrderCheck({ correct, revealed, missed }: { correct: boolean; revealed: boolean; missed: boolean }): { reveal: boolean; missed: boolean } {
  return { reveal: correct && !revealed, missed: missed || !correct };
}

/** "Show the page's order" is offered after the first wrong check, until the order is revealed. */
export function offerShowOrder({ missed, revealed }: { missed: boolean; revealed: boolean }): boolean {
  return missed && !revealed;
}

/** The note that points at the revealed order ("drawn on the track below") is shown only once it is revealed. */
export function resultNoteShown({ revealed }: { revealed: boolean }): boolean {
  return revealed;
}
