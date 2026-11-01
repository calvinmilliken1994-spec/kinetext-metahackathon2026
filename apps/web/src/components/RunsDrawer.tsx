import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { IconClose } from './icons.tsx';
import { scrollTopToReveal } from '../lib/scroll.ts';

/** Stage 10: the drawer only holds the open lesson's details; New lesson is a page in the main area. */
export type DrawerMode = 'runs';

interface Props {
  mode: DrawerMode;
  onClose: () => void;
  /** "Show technical details" (persisted by the app; off on a first visit). */
  tech: boolean;
  onTech: (on: boolean) => void;
  children: ReactNode;
  /** A selector inside the drawer to open at (the lesson's repair story), instead of the top. */
  openAt?: string | null;
}

export const DRAWER_TITLES: Record<DrawerMode, string> = { runs: 'Checks and run details' };

/** Below this width the drawer overlays the lesson (styles.css), so it behaves as a modal dialog. */
export const DRAWER_OVERLAY_QUERY = '(max-width: 1439.98px)';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

function useOverlay(): boolean {
  const [on, setOn] = useState(() => typeof window !== 'undefined' && window.matchMedia(DRAWER_OVERLAY_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(DRAWER_OVERLAY_QUERY);
    const sync = (): void => setOn(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  return on;
}

/** The drawer's controls a keyboard can reach right now (visible ones only, in DOM order). */
function tabbables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0 && el.closest('[inert]') === null);
}

/**
 * The open lesson's details drawer (Stage 10: "Checks and run details" in the sidebar, or the lesson's own links): the
 * runs for this page, their steps, repairs and checks. On wide windows it sits beside the lesson; on narrower ones it slides over it. Esc or the close button
 * dismisses it, and focus returns to whatever opened it. While it overlays the lesson it is a modal dialog (W2-04): the
 * covered rail and workspace are inert and Tab cycles inside the drawer.
 */
export function RunsDrawer({ mode, onClose, tech, onTech, children, openAt = null }: Props) {
  const headingId = useId();
  const ref = useRef<HTMLElement>(null);
  // What had focus when the drawer opened, read during the first render (before any effect moves focus into the drawer).
  const [opener] = useState<HTMLElement | null>(() => (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : null));
  const covered = useRef<HTMLElement[]>([]);
  const overlay = useOverlay();

  // Give focus back to the opener on close (its rail stops being inert first, so the focus call can land).
  useEffect(() => () => {
    for (const el of covered.current) el.removeAttribute('inert');
    covered.current = [];
    if (opener !== null && opener.isConnected && opener !== document.body) opener.focus({ preventScroll: true });
  }, [opener]);

  // Each time the drawer opens or switches mode, focus its heading (the first field for "New lesson"). "Runs" for a
  // lesson that Muse revised opens on that story (it sat two screens down, under the run list); otherwise at the top.
  useEffect(() => {
    const root = ref.current;
    if (root === null) return;
    const body = root.querySelector<HTMLElement>('.drawer-body');
    const story = mode === 'runs' && openAt !== null ? root.querySelector<HTMLElement>(openAt) : null;
    if (body !== null && story !== null) {
      const b = body.getBoundingClientRect();
      const t = story.getBoundingClientRect();
      body.scrollTo({ top: scrollTopToReveal({ top: b.top + body.clientTop, height: body.clientHeight, scrollTop: body.scrollTop, scrollHeight: body.scrollHeight }, { top: t.top, height: t.height }, 'start', 12) });
    } else {
      body?.scrollTo({ top: 0 });
    }
    root.querySelector<HTMLElement>('.drawer-title')?.focus({ preventScroll: true });
  }, [mode]);

  // Overlay mode: what the drawer covers (the rail and the workspace beside it) cannot be reached or clicked.
  useEffect(() => {
    const root = ref.current;
    const body = root?.parentElement;
    if (!overlay || root === null || body === null || body === undefined) return undefined;
    const els = [...body.children].filter((el): el is HTMLElement => el instanceof HTMLElement && el !== root && !el.classList.contains('drawer-scrim') && !el.hasAttribute('inert'));
    for (const el of els) el.setAttribute('inert', '');
    covered.current = els;
    if (!root.contains(document.activeElement)) root.querySelector<HTMLElement>('.drawer-title')?.focus({ preventScroll: true });
    return () => { for (const el of els) el.removeAttribute('inert'); covered.current = []; };
  }, [overlay]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Tab' && overlay && !e.defaultPrevented) {
        const root = ref.current;
        if (root === null) return;
        const items = tabbables(root);
        const first = items[0];
        const last = items[items.length - 1];
        if (first === undefined || last === undefined) return;
        const active = document.activeElement;
        const inside = active !== null && root.contains(active);
        if (e.shiftKey && (!inside || active === first || active === root.querySelector('.drawer-title'))) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && (!inside || active === last)) { e.preventDefault(); first.focus(); }
        return;
      }
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, overlay]);

  return (
    <>
      <div className="drawer-scrim" aria-hidden="true" onClick={onClose} />
      <aside
        ref={ref} className={`drawer${tech ? ' show-tech' : ''}`} aria-labelledby={headingId} data-testid="runs-drawer"
        role={overlay ? 'dialog' : 'complementary'} aria-modal={overlay ? 'true' : undefined}
      >
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
