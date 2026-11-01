/**
 * Stage 10 sidebar icons, drawn in the same 24-unit grid and 1.75 stroke as icons.tsx. Decorative: the sidebar entry
 * carries the name, so every icon is aria-hidden and not focusable.
 */
import type { ReactNode } from 'react';

function Icon({ children, size = 18 }: { children: ReactNode; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

interface P { size?: number }

/** Two stacked pages: every lesson. */
export function IconLessons(p: P) {
  return (
    <Icon {...p}>
      <rect x="7.5" y="3.5" width="12" height="14" rx="2" />
      <path d="M4.5 7v11.5a2 2 0 0 0 2 2h9" />
      <path d="M11 8h5M11 11.5h5" />
    </Icon>
  );
}

/** A clipboard with a tick: teacher review. */
export function IconReview(p: P) {
  return (
    <Icon {...p}>
      <path d="M9 4.5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-12a2 2 0 0 0-2-2h-2" />
      <rect x="9" y="3" width="6" height="3" rx="1" />
      <path d="m9 13 2 2 4-4.5" />
    </Icon>
  );
}

/** Three bars on a baseline: results. */
export function IconResults(p: P) {
  return (
    <Icon {...p}>
      <path d="M4 20h16" />
      <path d="M7 16.5V11M12 16.5V6.5M17 16.5v-3.5" />
    </Icon>
  );
}

/** A play triangle in a circle: the recorded demo. */
export function IconDemo(p: P) {
  return (
    <Icon {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M10.2 8.8v6.4l5-3.2z" />
    </Icon>
  );
}

/** A question mark in a circle: how it works. */
export function IconHelp(p: P) {
  return (
    <Icon {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.6 9.5a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.6" />
      <path d="M12 16.9v.1" />
    </Icon>
  );
}

/** A key: the judge access code. */
export function IconKey(p: P) {
  return (
    <Icon {...p}>
      <circle cx="8" cy="15" r="3.5" />
      <path d="m10.5 12.5 8-8M15.5 7.5l2.5 2.5M17.5 5.5 19 7" />
    </Icon>
  );
}

/** A magnifier: search. */
export function IconSearch(p: P) {
  return (
    <Icon {...p}>
      <circle cx="11" cy="11" r="6" />
      <path d="m15.5 15.5 4 4" />
    </Icon>
  );
}

/** Lines of text with a caret: your own text. */
export function IconPaste(p: P) {
  return (
    <Icon {...p}>
      <path d="M4.5 6.5h15M4.5 10.5h15M4.5 14.5h8" />
      <path d="M16.5 13v6M15 13h3M15 19h3" />
    </Icon>
  );
}

/** Books on a shelf: the licensed library. */
export function IconLibrary(p: P) {
  return (
    <Icon {...p}>
      <rect x="4" y="4.5" width="4" height="15" rx="1" />
      <rect x="9.5" y="4.5" width="4" height="15" rx="1" />
      <path d="m15.4 6.2 3.7-1 3 13.4-3.7 1z" />
    </Icon>
  );
}

/** Three lines: the narrow-window menu. */
export function IconMenu(p: P) {
  return (
    <Icon {...p}>
      <path d="M4.5 7h15M4.5 12h15M4.5 17h15" />
    </Icon>
  );
}
