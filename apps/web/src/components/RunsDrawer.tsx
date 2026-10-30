import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { IconClose } from './icons.tsx';

export type DrawerMode = 'new' | 'runs';

interface Props {
  mode: DrawerMode;
  onClose: () => void;
  /** "Show technical details" (persisted by the app; off on a first visit). */
  tech: boolean;
  onTech: (on: boolean) => void;
  children: ReactNode;
}

export const DRAWER_TITLES: Record<DrawerMode, string> = { new: 'New lesson', runs: 'Runs and checks' };

/**
 * The pipeline drawer. The rail is its only switch: "New lesson" (page, model, Generate, run options) or "Runs"
 * (the runs for this page, their steps, repairs and checks) — the drawer itself shows just its title, no second tab
 * strip. On wide windows it sits beside the lesson; on narrower ones it slides over it. Esc or the close button
 * dismisses it, and focus returns to whatever opened it.
 */
export function RunsDrawer({ mode, onClose, tech, onTech, children }: Props) {
  const headingId = useId();
  const ref = useRef<HTMLElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  // Remember what had focus when the drawer opened, and give it back on close.
  useEffect(() => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      const back = opener.current;
      if (back !== null && back.isConnected) back.focus({ preventScroll: true });
    };
  }, []);

  // Each time the drawer opens or switches mode, focus its heading (the first field for "New lesson").
  useEffect(() => {
    const root = ref.current;
    if (root === null) return;
    root.querySelector<HTMLElement>('.drawer-body')?.scrollTo({ top: 0 });
    const first = mode === 'new' ? root.querySelector<HTMLElement>('#new-lesson-source') : null;
    (first ?? root.querySelector<HTMLElement>('.drawer-title'))?.focus({ preventScroll: true });
  }, [mode]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <div className="drawer-scrim" aria-hidden="true" onClick={onClose} />
      <aside ref={ref} className={`drawer${tech ? ' show-tech' : ''}`} aria-labelledby={headingId} data-testid="runs-drawer">
        <header className="drawer-head">
          <h2 id={headingId} className="drawer-title" tabIndex={-1}>{DRAWER_TITLES[mode]}</h2>
          <button type="button" className="chrome-btn" onClick={onClose} aria-label="Close panel (Esc)" title="Close (Esc)"><IconClose /></button>
        </header>
        {mode === 'runs' && (
          <label className="tech-toggle">
            <input type="checkbox" checked={tech} onChange={(e) => onTech(e.target.checked)} />
            Show technical details (ids, tokens, model strings)
          </label>
        )}
        <div className="drawer-body">{children}</div>
      </aside>
    </>
  );
}
