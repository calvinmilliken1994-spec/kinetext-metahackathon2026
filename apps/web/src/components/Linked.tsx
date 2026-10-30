import { createElement, useEffect, useId, useSyncExternalStore } from 'react';
import type { FocusEvent, HTMLAttributes, ReactNode } from 'react';
import { isLit, linkStore } from '../lib/linking.ts';

export interface LinkedProps {
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  onFocus?: () => void;
  onBlur?: (e: FocusEvent<HTMLElement>) => void;
}

/**
 * Hover / keyboard-focus linking for one lesson element that cites the page (Stage 7 item 3). Hovering or focusing it
 * (or anything inside it) makes its link keys active, so its quote lights up in the source panel; it lights up itself
 * whenever one of its keys is active (a hovered source quote, or another element citing the same words).
 */
export function useLinked(keys: readonly string[]): { lit: boolean; props: LinkedProps } {
  const owner = useId();
  const sig = keys.join(' ');
  const lit = useSyncExternalStore(linkStore.subscribe, () => isLit(linkStore.get(), keys));
  // An element that unmounts while hovered or focused must not leave its quote lit.
  useEffect(() => () => { linkStore.leave(`${owner}:hover`); linkStore.leave(`${owner}:focus`); }, [owner, sig]);
  if (sig === '') return { lit: false, props: {} };
  return {
    lit,
    props: {
      onMouseEnter: () => linkStore.enter(`${owner}:hover`, keys, 'lesson'),
      onMouseLeave: () => linkStore.leave(`${owner}:hover`),
      onFocus: () => linkStore.enter(`${owner}:focus`, keys, 'lesson'),
      onBlur: (e) => {
        if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
        linkStore.leave(`${owner}:focus`);
      },
    },
  };
}

type LinkedTag = 'div' | 'li' | 'td' | 'figure' | 'section' | 'p';

/** An element that takes part in hover linking; `links` are its quotes' link keys (lib/linking.ts linkKey). */
export function Linked({ as = 'div', links, className, children, ...rest }: { as?: LinkedTag; links: readonly string[]; className?: string; children?: ReactNode } & HTMLAttributes<HTMLElement>) {
  const { lit, props } = useLinked(links);
  const cls = [className, links.length > 0 ? 'linkable' : '', lit ? 'is-linked' : ''].filter((c) => c !== undefined && c !== '').join(' ');
  return createElement(as, { ...rest, ...props, className: cls === '' ? undefined : cls, 'data-link-keys': links.length > 0 ? links.join(' ') : undefined, 'data-linked': lit ? 'true' : undefined }, children);
}
