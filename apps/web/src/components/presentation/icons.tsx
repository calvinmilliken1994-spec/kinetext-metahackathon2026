/**
 * Line icons for presentation mode, drawn in the same 24-unit grid and 1.75 stroke as components/icons.tsx. Decorative:
 * the control that holds one carries the accessible name.
 */
import type { ReactNode } from 'react';

function Icon({ children, size = 20 }: { children: ReactNode; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

interface P { size?: number }

/** A projection screen on its stand: present the lesson. */
export function IconPresent(p: P) {
  return (
    <Icon {...p}>
      <path d="M3 4.5h18" />
      <rect x="4.5" y="4.5" width="15" height="10.5" rx="1" />
      <path d="M12 15v3.5M8.5 21l3.5-2.5 3.5 2.5" />
      <path d="M10.5 8v4l3.25-2z" />
    </Icon>
  );
}

export function IconPrev(p: P) { return <Icon {...p}><path d="M14.5 6l-6 6 6 6" /></Icon>; }
export function IconNext(p: P) { return <Icon {...p}><path d="M9.5 6l6 6-6 6" /></Icon>; }

/** Lines beside a card: presenter notes. */
export function IconNotes(p: P) {
  return (
    <Icon {...p}>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M8 9h8M8 12.5h8M8 16h5" />
    </Icon>
  );
}

/** A screen with a slash: black screen. */
export function IconBlank(p: P) {
  return (
    <Icon {...p}>
      <rect x="3.5" y="5" width="17" height="12" rx="1.5" />
      <path d="M5 19.5L19 3.5" />
    </Icon>
  );
}

/** Four corners: full screen. */
export function IconFullscreen(p: P) {
  return (
    <Icon {...p}>
      <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />
    </Icon>
  );
}

/** Keyboard: the keyboard map. */
export function IconKeys(p: P) {
  return (
    <Icon {...p}>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" />
    </Icon>
  );
}

/** A door with an arrow out: leave presentation. */
export function IconExit(p: P) {
  return (
    <Icon {...p}>
      <path d="M14 4H6.5A1.5 1.5 0 0 0 5 5.5v13A1.5 1.5 0 0 0 6.5 20H14" />
      <path d="M10 12h10M16.5 8.5L20 12l-3.5 3.5" />
    </Icon>
  );
}
