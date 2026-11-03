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
  /** A quieter line after the name (hidden on narrow screens). */
  tagline?: string;
  /** Render the title as the page's <h1> (the workspace); the demo harness has its own heading. */
  titleIsHeading?: boolean;
  /** Extra items at the right of the title bar, before the theme switch (e.g. the API status). */
  titlebarExtra?: ReactNode;
  children: ReactNode;
}

/**
 * The app frame: it fills the viewport (Calvin, 3 Nov), with a slim title bar (the name and tagline on the left, the
 * status and theme switch on the right), the app body, and a slim footer naming the hackathon this entry was built for.
 * No decorative window buttons: in a browser tab they read as a mock-up (Calvin, 4 Nov).
 */
export function AppWindow({ title, tagline, titleIsHeading = false, titlebarExtra, children }: Props) {
  const [theme, toggleTheme] = useTheme();
  return (
    <div className="desktop">
      <div className="app-window">
        <header className="titlebar">
          {(() => {
            const inner = (
              <>
                <span className="titlebar-name">{title}</span>
                {tagline !== undefined && <span className="titlebar-tagline"><span className="titlebar-sep" aria-hidden="true">·</span>{tagline}</span>}
              </>
            );
            return titleIsHeading ? <h1 className="titlebar-title">{inner}</h1> : <p className="titlebar-title">{inner}</p>;
          })()}
          <div className="titlebar-right">
            {titlebarExtra}
            <ThemeSwitch theme={theme} onToggle={toggleTheme} />
          </div>
        </header>
        {children}
        <footer className="window-footer">
          {/* Text only: Meta's brand guidelines require approval for any use of the Meta logo. */}
          <span className="footer-event">
            <span className="footer-event-name">Built for the Meta Global AI Developer Hackathon 2026</span>
          </span>
        </footer>
      </div>
    </div>
  );
}
