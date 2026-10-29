/**
 * Small line icons for the window chrome, drawn here (no icon package). All are decorative: the button that holds one
 * carries the accessible name, so every icon is aria-hidden and not focusable.
 */
import type { ReactNode } from 'react';

function Icon({ children, size = 20 }: { children: ReactNode; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

/** A page with a plus: start a new lesson by picking a source page. */
export function IconNewLesson() {
  return (
    <Icon>
      <path d="M13.5 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z" />
      <path d="M13.5 3v5.5H19" />
      <path d="M12 12v6M9 15h6" />
    </Icon>
  );
}

/** Four-point sparkle: the lesson Muse built. */
export function IconLesson() {
  return (
    <Icon>
      <path d="M12 3.5c.6 3.9 2.6 5.9 6.5 6.5-3.9.6-5.9 2.6-6.5 6.5-.6-3.9-2.6-5.9-6.5-6.5 3.9-.6 5.9-2.6 6.5-6.5z" />
      <path d="M18.5 15.5c.25 1.6 1 2.35 2.5 2.5-1.5.25-2.25 1-2.5 2.5-.25-1.5-1-2.25-2.5-2.5 1.5-.15 2.25-.9 2.5-2.5z" />
    </Icon>
  );
}

/** Shield with a tick: the deterministic checks. */
export function IconChecks() {
  return (
    <Icon>
      <path d="M12 3 5 6v5.5c0 4.3 3 7.9 7 9.5 4-1.6 7-5.2 7-9.5V6z" />
      <path d="m9 12 2.2 2.2L15.5 10" />
    </Icon>
  );
}

/** Open book: the source page panel. */
export function IconSourcePanel() {
  return (
    <Icon>
      <path d="M12 6.5C10.3 5.2 8 4.5 4 4.5v13c4 0 6.3.7 8 2 1.7-1.3 4-2 8-2v-13c-4 0-6.3.7-8 2z" />
      <path d="M12 6.5v13" />
    </Icon>
  );
}

/** Stacked rows with a clock-like dot: runs and their steps. */
export function IconRuns() {
  return (
    <Icon>
      <circle cx="6" cy="6.5" r="1.6" />
      <circle cx="6" cy="12" r="1.6" />
      <circle cx="6" cy="17.5" r="1.6" />
      <path d="M10.5 6.5H20M10.5 12H20M10.5 17.5H16" />
    </Icon>
  );
}

export function IconSun() {
  return (
    <Icon size={18}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
    </Icon>
  );
}

export function IconMoon() {
  return (
    <Icon size={18}>
      <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
    </Icon>
  );
}
