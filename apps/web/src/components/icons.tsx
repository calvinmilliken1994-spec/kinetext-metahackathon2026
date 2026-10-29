/**
 * Small line icons, drawn here (no icon package), one stroke weight throughout. All are decorative: the control that
 * holds one carries the accessible name, so every icon is aria-hidden and not focusable. `Mark` is the exception: a
 * pass/fail mark that also names its meaning for screen readers when asked to.
 */
import type { ReactNode } from 'react';

function Icon({ children, size = 20, className = '' }: { children: ReactNode; size?: number; className?: string }) {
  return (
    <svg className={`icon${className === '' ? '' : ` ${className}`}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

interface P { size?: number; className?: string }

/** A page with a plus: start a new lesson. */
export function IconNewLesson(p: P) {
  return (
    <Icon {...p}>
      <path d="M13.5 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z" />
      <path d="M13.5 3v5.5H19" />
      <path d="M12 12v6M9 15h6" />
    </Icon>
  );
}

/** A lesson: a page with lines of text. */
export function IconLesson(p: P) {
  return (
    <Icon {...p}>
      <rect x="4.5" y="3.5" width="15" height="17" rx="2" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </Icon>
  );
}

/** Shield with a tick: the checks behind the lesson. */
export function IconChecks(p: P) {
  return (
    <Icon {...p}>
      <path d="M12 3 5 6v5.5c0 4.3 3 7.9 7 9.5 4-1.6 7-5.2 7-9.5V6z" />
      <path d="m9 12 2.2 2.2L15.5 10" />
    </Icon>
  );
}

/** Open book: the source page. */
export function IconSourcePanel(p: P) {
  return (
    <Icon {...p}>
      <path d="M12 6.5C10.3 5.2 8 4.5 4 4.5v13c4 0 6.3.7 8 2 1.7-1.3 4-2 8-2v-13c-4 0-6.3.7-8 2z" />
      <path d="M12 6.5v13" />
    </Icon>
  );
}

/** Stacked rows: runs and their steps. */
export function IconRuns(p: P) {
  return (
    <Icon {...p}>
      <circle cx="6" cy="6.5" r="1.6" />
      <circle cx="6" cy="12" r="1.6" />
      <circle cx="6" cy="17.5" r="1.6" />
      <path d="M10.5 6.5H20M10.5 12H20M10.5 17.5H16" />
    </Icon>
  );
}

export function IconSun(p: P) {
  return (
    <Icon size={18} {...p}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
    </Icon>
  );
}

export function IconMoon(p: P) {
  return (
    <Icon size={18} {...p}>
      <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
    </Icon>
  );
}

export function IconCheck(p: P) {
  return <Icon size={16} {...p}><path d="m5 12.5 4.5 4.5L19 7.5" /></Icon>;
}

export function IconCross(p: P) {
  return <Icon size={16} {...p}><path d="M6.5 6.5l11 11M17.5 6.5l-11 11" /></Icon>;
}

export function IconAlert(p: P) {
  return (
    <Icon size={16} {...p}>
      <path d="M12 4 2.8 19.5h18.4z" />
      <path d="M12 10v4.5M12 17.3v.2" />
    </Icon>
  );
}

export function IconInfo(p: P) {
  return (
    <Icon size={16} {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.5M12 7.8v.2" />
    </Icon>
  );
}

export function IconPlus(p: P) {
  return <Icon size={16} {...p}><path d="M12 5v14M5 12h14" /></Icon>;
}

export function IconMinus(p: P) {
  return <Icon size={16} {...p}><path d="M5 12h14" /></Icon>;
}

/** A long arrow: "yields" in a chemical equation, "becomes" in a before/after change. */
export function IconArrowRight(p: P) {
  return <Icon size={20} {...p}><path d="M3 12h17M14.5 6.5 20 12l-5.5 5.5" /></Icon>;
}

export function IconExternal(p: P) {
  return (
    <Icon size={14} {...p}>
      <path d="M14 4h6v6M20 4l-9 9" />
      <path d="M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10" />
    </Icon>
  );
}

export function IconPlay(p: P) {
  return <Icon size={16} {...p}><path d="M7 5v14l12-7z" /></Icon>;
}

export function IconReset(p: P) {
  return (
    <Icon size={16} {...p}>
      <path d="M4 12a8 8 0 1 0 2.5-5.8" />
      <path d="M4 3.5v5h5" />
    </Icon>
  );
}

export function IconPause(p: P) {
  return <Icon size={16} {...p}><path d="M8 5v14M16 5v14" /></Icon>;
}

export function IconReplay(p: P) {
  return (
    <Icon size={16} {...p}>
      <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" />
      <path d="M4.5 4.5v4h4" />
    </Icon>
  );
}

export function IconChevronUp(p: P) {
  return <Icon size={16} {...p}><path d="m6 15 6-6 6 6" /></Icon>;
}

export function IconChevronDown(p: P) {
  return <Icon size={16} {...p}><path d="m6 9 6 6 6-6" /></Icon>;
}

/** Six dots: a drag handle. */
export function IconGrip(p: P) {
  return (
    <Icon size={16} {...p}>
      <path d="M9 6v.01M15 6v.01M9 12v.01M15 12v.01M9 18v.01M15 18v.01" strokeWidth={2.6} />
    </Icon>
  );
}

export function IconClose(p: P) {
  return <Icon size={18} {...p}><path d="M6 6l12 12M18 6 6 18" /></Icon>;
}

/** Lines with a pointer: "show this quote in the source". */
export function IconLocate(p: P) {
  return (
    <Icon size={14} {...p}>
      <path d="M4 6h10M4 12h16M4 18h8" />
      <path d="m16 15 4 3-4 3" />
    </Icon>
  );
}

/** Step states in the runs drawer. */
export function IconPending(p: P) {
  return <Icon size={16} {...p}><circle cx="12" cy="12" r="6.5" /></Icon>;
}

export function IconRunning(p: P) {
  return (
    <Icon size={16} {...p}>
      <circle cx="12" cy="12" r="6.5" opacity="0.35" />
      <path d="M12 5.5a6.5 6.5 0 0 1 6.5 6.5" />
    </Icon>
  );
}

export function IconSkipped(p: P) {
  return <Icon size={16} {...p}><path d="M7 12h10" /></Icon>;
}

/** Pass/fail mark. With `label`, screen readers hear the label; without, it is decorative (the words say it). */
export function Mark({ kind, label }: { kind: 'ok' | 'bad' | 'info'; label?: string }) {
  const icon = kind === 'ok' ? <IconCheck /> : kind === 'bad' ? <IconCross /> : <IconInfo />;
  if (label === undefined) return <span className={`mark mark-${kind}`}>{icon}</span>;
  return <span className={`mark mark-${kind}`} role="img" aria-label={label}>{icon}</span>;
}
