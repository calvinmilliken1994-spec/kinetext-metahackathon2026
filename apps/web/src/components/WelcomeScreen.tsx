// Stage 10c section 1 (docs/specs/STAGE-10c-first-launch-and-fixes.md): the Welcome screen. A first visit (or
// ?welcome=1, or "Show the welcome again") sees this inside the app window before the app itself: one statement of what
// the app does, then two equal choices: enter the judge access code, or continue read-only. With the gate off there is
// no code to enter, so the access side says what builds can do here and Continue is the only button. The wording is
// decided in lib/welcome.ts.
import { useEffect, useId, useRef } from 'react';
import type { Access } from '../lib/access.ts';
import { welcomeAccess, welcomeChoice } from '../lib/welcome.ts';
import { AccessForm } from './AccessForm.tsx';

export interface WelcomeScreenProps {
  access: Access;
  /** /api/health's live flag (null while unknown). */
  live: boolean | null;
  /** Active library pages and subjects, once the list has loaded. */
  library: { pages: number; subjects: number } | null;
  onAccess: (a: Access) => void;
  /** Leave the Welcome for the guide. */
  onContinue: () => void;
}

export function WelcomeScreen({ access, live, library, onAccess, onContinue }: WelcomeScreenProps) {
  const uid = useId();
  const w = welcomeAccess(access, live);
  const c = welcomeChoice(w, access.state === 'granted' || access.state === 'locked' ? access.info : null);
  const headRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { headRef.current?.focus({ preventScroll: true }); }, []);

  return (
    <div className="welcome" data-testid="welcome" data-access={w}>
      <div className="wl-inner">
        <header className="wl-head">
          <h2 className="wl-title" ref={headRef} tabIndex={-1}>Turn a page into a lesson you can teach.</h2>
          <p className="wl-lede">
            For teachers of numerical and structured subjects. Pick a licensed page or paste your own: Muse Spark writes a short
            AI-written summary, then builds interactive parts, each tied to the sentence it came from and checked against the page.
          </p>
          <p className="wl-facts">
            <span>{library === null ? 'A library of licensed pages' : `${library.pages} licensed pages in ${library.subjects} subjects`}</span>
            <span>Muse Spark 1.3 and Muse Spark Open</span>
            <span>SAM 3.1 for figures</span>
          </p>
        </header>

        <div className="wl-side">
          <div className="wl-choices">
            <section className="wl-choice wl-choice-access" aria-labelledby={`${uid}-a`} data-testid="welcome-access">
              <h3 id={`${uid}-a`} className="wl-choice-title">{c.title}</h3>
              {c.body !== '' && <p className="wl-choice-body">{c.body}</p>}
              {c.form && (
                <div className="wl-choice-action">
                  <AccessForm onAccess={onAccess} intro="" submitLabel="Unlock builds" />
                </div>
              )}
            </section>
            <section className="wl-choice wl-choice-read" aria-labelledby={`${uid}-r`} data-testid="welcome-read">
              <h3 id={`${uid}-r`} className="wl-choice-title">{c.readTitle}</h3>
              <p className="wl-choice-body">{c.readBody}</p>
              <div className="wl-choice-action">
                <button type="button" className="btn btn-primary wl-go" onClick={onContinue} data-testid="welcome-continue">{c.continueLabel}</button>
              </div>
            </section>
          </div>
          <p className="wl-next">Next: a short guide round the pages in six steps, then a recorded demo of a build if you want one.</p>
        </div>
      </div>
    </div>
  );
}
