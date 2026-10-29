import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { IconClose } from './icons.tsx';

export type DrawerMode = 'new' | 'runs';

interface Props {
  mode: DrawerMode;
  onMode: (mode: DrawerMode) => void;
  onClose: () => void;
  children: ReactNode;
}

const TITLES: Record<DrawerMode, string> = { new: 'New lesson', runs: 'Runs and checks' };

/**
 * The pipeline drawer, opened from the rail: "New lesson" (page, model, Generate, run options) or "Runs and checks"
 * (the runs for this page, their steps, repairs and checks). On wide windows it sits beside the lesson; on narrower
 * ones it slides over it. Esc or the close button dismisses it, and focus returns to whatever opened it.
 */
export function RunsDrawer({ mode, onMode, onClose, children }: Props) {
  const headingId = useId();
  const ref = useRef<HTMLElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const [tech, setTech] = useState(false);

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
    (first ?? root.querySelector<HTMLElement>('.seg[aria-pressed="true"]'))?.focus({ preventScroll: true });
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
          <h2 id={headingId} className="sr-only">{TITLES[mode]}</h2>
          <div className="drawer-tabs" role="group" aria-label="Panel">
            <button type="button" className="seg" aria-pressed={mode === 'new'} onClick={() => onMode('new')}>New lesson</button>
            <button type="button" className="seg" aria-pressed={mode === 'runs'} onClick={() => onMode('runs')}>Runs and checks</button>
          </div>
          <button type="button" className="chrome-btn" onClick={onClose} aria-label="Close panel (Esc)" title="Close (Esc)"><IconClose /></button>
        </header>
        {mode === 'runs' && (
          <label className="tech-toggle">
            <input type="checkbox" checked={tech} onChange={(e) => setTech(e.target.checked)} />
            Show technical details (ids, tokens, model strings)
          </label>
        )}
        <div className="drawer-body">{children}</div>
      </aside>
    </>
  );
}
