// Stage 10 (docs/specs/STAGE-10-navigation-and-access.md, section B): the always-expanded, labelled sidebar. It replaces
// the icon rail. Sections and entries come from lib/navigation.ts; this file draws them, handles arrow keys, and shows
// the judge access status at the bottom. Below 1100 px it folds into a top bar with a Menu button.
import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import type { AccessFooter } from '../lib/access.ts';
import type { MainView, NavId, NavItem, NavSection } from '../lib/navigation.ts';
import { VIEW_TITLES } from '../lib/navigation.ts';
import { IconChecks, IconLesson, IconNewLesson, IconSourcePanel } from './icons.tsx';
import { IconDemo, IconHelp, IconKey, IconLessons, IconMenu, IconResults, IconReview } from './navIcons.tsx';
import { IconPresent } from './presentation/icons.tsx';

const ICONS: Partial<Record<NavId, ReactNode>> = {
  'new-lesson': <IconNewLesson size={18} />,
  'all-lessons': <IconLessons />,
  lesson: <IconLesson size={18} />,
  source: <IconSourcePanel size={18} />,
  present: <IconPresent size={18} />,
  checks: <IconChecks size={18} />,
  review: <IconReview />,
  results: <IconResults />,
  demo: <IconDemo />,
  how: <IconHelp />,
};

export interface SidebarProps {
  sections: NavSection[];
  view: MainView;
  onItem: (id: NavId) => void;
  /** The access status at the bottom; null shows nothing (gate off). */
  footer: AccessFooter | null;
  onEnterCode: () => void;
  onSignOut: () => void;
  signingOut: boolean;
}

function SidebarItem({ item, onItem }: { item: NavItem; onItem: (id: NavId) => void }) {
  const hintId = useId();
  const nested = item.id === 'open-lesson';
  return (
    <li>
      <button
        type="button"
        className={`sb-item${nested ? ' sb-item-lesson' : ''}`}
        aria-current={item.current === false ? undefined : item.current}
        aria-pressed={item.pressed === null ? undefined : item.pressed}
        aria-disabled={item.disabled ? 'true' : undefined}
        aria-describedby={item.hint !== null && item.disabled ? hintId : undefined}
        title={item.hint ?? (nested ? item.label : undefined)}
        data-nav={item.id}
        data-tour={item.tour ?? undefined}
        onClick={() => { if (!item.disabled) onItem(item.id); }}
      >
        {nested ? <span className="sb-dot" aria-hidden="true" /> : <span className="sb-icon">{ICONS[item.id]}</span>}
        <span className="sb-label">{item.label}</span>
        {item.badge !== null && <span className="sb-badge">{item.badge}</span>}
        {item.kind === 'toggle' && <span className={`sb-switch${item.pressed === true ? ' is-on' : ''}`} aria-hidden="true" />}
      </button>
      {item.hint !== null && item.disabled && <span id={hintId} className="sr-only">{item.hint}</span>}
    </li>
  );
}

/** "Judge access · $47.12 of $50 left": the amount gets its own line in the narrow sidebar (the separator stays for screen readers). */
function FooterTitle({ text }: { text: string }) {
  const at = text.indexOf(' · ');
  if (at < 0) return <p className="sb-footer-title">{text}</p>;
  return (
    <p className="sb-footer-title">
      <span>{text.slice(0, at)}</span><span className="sr-only"> · </span><span className="sb-footer-amount">{text.slice(at + 3)}</span>
    </p>
  );
}

/** Up/Down/Home/End move between entries (Tab still walks them in order). */
function moveFocus(e: ReactKeyboardEvent<HTMLElement>): void {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>('.sb-item')];
  const at = items.indexOf(document.activeElement as HTMLElement);
  if (at < 0) return;
  e.preventDefault();
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
  items[next]?.focus();
}

export function Sidebar({ sections, view, onItem, footer, onEnterCode, onSignOut, signingOut }: SidebarProps) {
  const listId = useId();
  // Narrow windows (≤ 1100 px): the sections fold behind a Menu button; any entry closes it again.
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      setOpen(false);
      menuRef.current?.focus({ preventScroll: true });
    };
    // A press outside the open menu closes it.
    const onDown = (e: PointerEvent): void => {
      const nav = menuRef.current?.closest('.sidebar');
      if (nav !== null && nav !== undefined && e.target instanceof Node && !nav.contains(e.target)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onDown); };
  }, [open]);
  const pick = (id: NavId): void => { setOpen(false); onItem(id); };

  return (
    <nav className="sidebar" aria-label="App" data-open={open ? 'true' : 'false'}>
      <button
        ref={menuRef} type="button" className="sb-menu" aria-expanded={open} aria-controls={listId}
        onClick={() => setOpen((v) => !v)}
      >
        <IconMenu />
        <span className="sb-menu-label">Menu</span>
        <span className="sb-menu-view">{VIEW_TITLES[view]}</span>
      </button>
      <div className="sb-body" id={listId} onKeyDown={moveFocus}>
        <div className="sb-sections">
          {sections.map((s) => (
            <section key={s.id} className={`sb-section sb-${s.id}`} aria-labelledby={`${listId}-${s.id}`}>
              <h2 className="sb-heading" id={`${listId}-${s.id}`}>{s.heading}</h2>
              <ul className="sb-list">
                {s.items.map((it) => <SidebarItem key={it.id} item={it} onItem={pick} />)}
              </ul>
            </section>
          ))}
        </div>
        {footer !== null && (
          <div className={`sb-footer tone-${footer.tone}`} data-testid="access-footer" role="status">
            <FooterTitle text={footer.title} />
            {footer.detail !== null && <p className="sb-footer-detail">{footer.detail}</p>}
            {footer.action === 'enter' ? (
              <button type="button" className="sb-footer-btn" onClick={() => { setOpen(false); onEnterCode(); }}>
                <IconKey size={16} />Enter access code
              </button>
            ) : (
              <button type="button" className="sb-footer-btn is-quiet" onClick={onSignOut} disabled={signingOut}>
                {signingOut ? 'Signing out…' : 'Sign out'}
              </button>
            )}
          </div>
        )}
      </div>
    </nav>
  );
}
