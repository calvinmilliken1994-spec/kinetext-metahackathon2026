// Stage 10c section 1 (docs/specs/STAGE-10c-first-launch-and-fixes.md), Welcome v2 (Calvin 2 Nov: more OOMPH). A first
// visit (or ?welcome=1, or "Show the welcome again") sees this inside the app window before the app itself: the
// statement, one Get started card, and the pinned demo run's figure with its stored model boxes as the centrepiece, over
// the page's own text drifting behind (components/WelcomeBackdrop.tsx). The card: the credential field (the judge
// access code today, lib/welcome.ts WELCOME_CREDENTIALS) with its button, an "or", one big button into the guide, and a
// line on what comes next. Its states and words are decided in lib/welcome.ts welcomeCard.
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import { api, describeError } from '../api.ts';
import type { Access } from '../lib/access.ts';
import { welcomeAccess, welcomeCard, welcomeNext } from '../lib/welcome.ts';
import type { CredentialField } from '../lib/welcome.ts';
import { welcomeStagger } from '../lib/welcomeBackdrop.ts';
import { useWelcomeBackdrop, WelcomeFigurePlate, WelcomePageText } from './WelcomeBackdrop.tsx';

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

/** Submit handlers by descriptor action. Only the access code is wired; the Meta key waits for the lead (no endpoint yet). */
const SUBMIT: Partial<Record<CredentialField['submit'], (value: string) => Promise<Access>>> = {
  access: (code) => api.postAccess(code),
};

export function WelcomeScreen({ access, live, library, onAccess, onContinue }: WelcomeScreenProps) {
  const uid = useId();
  const w = welcomeAccess(access, live);
  const card = welcomeCard(w, access.state === 'granted' || access.state === 'locked' ? access.info : null);
  const cred = card.credential;
  const headRef = useRef<HTMLHeadingElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { figure, sentences } = useWelcomeBackdrop();
  const [imgReady, setImgReady] = useState(false);
  const onImage = useCallback((r: boolean) => setImgReady(r), []);

  // Keyboard first: a judge lands in the code field; everyone else on the statement.
  useEffect(() => {
    if (card.field === 'enabled') inputRef.current?.focus({ preventScroll: true });
    else headRef.current?.focus({ preventScroll: true });
  }, [card.field]);

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    const run = SUBMIT[cred.submit];
    if (card.field !== 'enabled' || busy || run === undefined) return;
    if (value.trim() === '') { setError(cred.emptyError); return; }
    setBusy(true);
    setError(null);
    run(value.trim()).then(
      (a) => { setBusy(false); setValue(''); onAccess(a); },
      (err: unknown) => { setBusy(false); setError(describeError(err)); },
    );
  };

  const fig = figure.state === 'ready' ? figure.figure : null;
  const stagger = welcomeStagger(fig?.parts.length ?? 0);
  const noteId = `${uid}-note`;
  return (
    <div
      className="welcome" data-testid="welcome" data-access={w} data-figure={figure.state}
      data-img={fig !== null && imgReady ? 'ready' : 'loading'}
      style={{ '--wl-stagger': `${stagger}ms` } as CSSProperties}
    >
      <WelcomePageText sentences={sentences} />
      <div className="wl-inner">
        <div className="wl-main">
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

          <section className="wl-card" aria-labelledby={`${uid}-card`} data-testid="welcome-card">
            <h3 id={`${uid}-card`} className="wl-card-title">Get started</h3>
            {card.field !== 'none' ? (
              <form className="wl-code" onSubmit={submit} noValidate data-testid="welcome-access">
                <label htmlFor={`${uid}-code`} className="wl-label">{cred.label}</label>
                <div className="wl-code-row">
                  <input
                    id={`${uid}-code`} ref={inputRef} type="password" value={value} placeholder={card.placeholder}
                    disabled={card.field !== 'enabled'} autoComplete="off" spellCheck={false} autoCapitalize="none"
                    aria-invalid={error !== null} aria-describedby={noteId}
                    onChange={(e) => { setValue(e.target.value); setError(null); }}
                  />
                  <button type="submit" className={`btn wl-unlock${card.unlockPrimary ? ' btn-primary' : ''}`} disabled={card.field !== 'enabled' || busy}>
                    {busy ? cred.busyButton : cred.button}
                  </button>
                </div>
                {error !== null
                  ? <p id={noteId} className="wl-note wl-note-error" role="alert">{error}</p>
                  : <p id={noteId} className="wl-note">{card.note}</p>}
              </form>
            ) : (
              <p className="wl-status" data-testid="welcome-access">{card.note}</p>
            )}
            {card.divider && <p className="wl-or"><span>or</span></p>}
            <button type="button" className={`btn wl-go${card.go.primary ? ' btn-primary' : ''}`} onClick={onContinue} data-testid="welcome-continue">
              {card.go.label}
            </button>
            <p className="wl-next">{welcomeNext()}</p>
          </section>
        </div>

        {fig !== null && <WelcomeFigurePlate figure={fig} onImage={onImage} />}
        {figure.state === 'loading' && <div className="wl-figure wl-figure-hold" aria-hidden="true" />}
      </div>
    </div>
  );
}
