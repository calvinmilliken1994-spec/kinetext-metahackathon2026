// The address bar follows the lesson on screen (demo pair review #12): when another lesson opens (tour, Skip, a library
// pick, the runs list), its id replaces whatever run the URL named, so a refresh or a shared link opens that lesson and
// never another one. `?present=` (presentation mode rewrites it on exit) and a `?replay=` of the lesson being replayed
// are left as they are. Pure: no React, no DOM.

export interface ShownState {
  /** The lesson on screen is being replayed (a `?replay=` link or the tour's recording). */
  replaying: boolean;
  /** Presentation mode is open. */
  presenting: boolean;
  /** The shown lesson was opened in the app (not the one the page first opened on). */
  opened: boolean;
}

/** The search string for the lesson shown (`shown`), or `search` itself when nothing needs to change. */
export function shownSearch(search: string, shown: string | null, s: ShownState): string {
  if (shown === null || s.presenting) return search;
  const q = new URLSearchParams(search);
  const replay = q.get('replay');
  if (replay !== null && replay === shown && s.replaying) return search;
  const present = q.get('present');
  const job = q.get('job');
  const namesOther = (replay !== null) || (present !== null && present !== shown) || (job !== null && job !== shown);
  if (!namesOther && (job === shown || present === shown || !s.opened)) return search;
  if (replay !== null) {
    q.delete('replay');
    // speed only means something to a replay, or to a forced tour's replay
    if (q.get('tour') !== '1' && q.get('demo') !== '1') q.delete('speed');
  }
  if (present !== null) { q.delete('present'); q.delete('beat'); }
  q.set('job', shown);
  const out = q.toString();
  return out === '' ? '' : `?${out}`;
}
