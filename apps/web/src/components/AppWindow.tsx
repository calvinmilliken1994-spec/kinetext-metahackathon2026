import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { otherTheme, readStoredTheme, themeSwitchLabel, writeStoredTheme } from '../lib/theme.ts';
import type { Theme } from '../lib/theme.ts';
import { IconMoon, IconSun } from './icons.tsx';

function localStore(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; }
}

/** The theme lives on <html data-theme>; index.html sets it before first paint, this keeps React and storage in step. */
function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => readStoredTheme(localStore()));
  useEffect(() => { document.documentElement.dataset['theme'] = theme; }, [theme]);
  const toggle = useCallback(() => {
    setTheme((t) => {
      const next = otherTheme(t);
      writeStoredTheme(localStore(), next);
      return next;
    });
  }, []);
  return [theme, toggle];
}

export function ThemeSwitch({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  const label = themeSwitchLabel(theme);
  return (
    <button type="button" className="chrome-btn" onClick={onToggle} aria-label={label} title={label}>
      {theme === 'dark' ? <IconSun /> : <IconMoon />}
    </button>
  );
}

interface Props {
  /** Product name shown in the title bar. */
  title: string;
  /** Render the title as the page's <h1> (the workspace); the demo harness has its own heading. */
  titleIsHeading?: boolean;
  /** Extra items at the right of the title bar, before the theme switch (e.g. the API status). */
  titlebarExtra?: ReactNode;
  children: ReactNode;
}

/**
 * The desktop-app frame: a backdrop in a lighter shade of the app colour, and a window with a slim title bar
 * (decorative traffic lights), the app body, and a slim footer naming the hackathon this entry was built for.
 * The window always fits the viewport with a gap that scales with it; below 900 px the gap narrows and the traffic lights go away.
 */
export function AppWindow({ title, titleIsHeading = false, titlebarExtra, children }: Props) {
  const [theme, toggleTheme] = useTheme();
  return (
    <div className="desktop">
      <div className="app-window">
        <header className="titlebar">
          <span className="traffic" aria-hidden="true">
            <span className="traffic-dot traffic-close" />
            <span className="traffic-dot traffic-min" />
            <span className="traffic-dot traffic-max" />
          </span>
          {titleIsHeading ? <h1 className="titlebar-title">{title}</h1> : <p className="titlebar-title">{title}</p>}
          <div className="titlebar-right">
            {titlebarExtra}
            <ThemeSwitch theme={theme} onToggle={toggleTheme} />
          </div>
        </header>
        {children}
        <footer className="window-footer">
          <span className="footer-event">
            {/* Official Meta logo, unmodified; the variant matches the theme (the other one is display:none). */}
            <img className="footer-logo footer-logo-on-dark" src="/brand/meta-logo-with-text-dark.svg" alt="Meta" width={61} height={14} />
            <img className="footer-logo footer-logo-on-light" src="/brand/meta-logo-with-text.svg" alt="Meta" width={64} height={14} />
            <span className="footer-event-name">Global AI Developer Hackathon 2026</span>
          </span>
        </footer>
      </div>
    </div>
  );
}
