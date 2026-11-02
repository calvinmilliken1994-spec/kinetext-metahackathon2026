// Welcome v3 (docs/specs/WELCOME-V3-split.md, Calvin's split draft, 3 Nov). A first visit (or ?welcome=1, or "Show the
// welcome again") sees this inside the app window before the app itself. Left half: a solid panel in the app's blue with
// the app name (APP_NAME), one statement and a minimal sign-in: the credential field (the judge access code today,
// lib/welcome.ts WELCOME_CREDENTIALS) with its button, an "or", "Explore read-only", and the helper lines. Its states and
// words are decided in lib/welcome.ts welcomeCard, unchanged from v2. Right half: the "page becomes lesson" montage over
// the published lessons (components/WelcomeMontage.tsx). What the Welcome does is unchanged; only the design is new.
import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { api, describeError } from '../api.ts';
import type { Access } from '../lib/access.ts';
import { APP_NAME, WELCOME_STATEMENT, welcomeAccess, welcomeCard, welcomeNext } from '../lib/welcome.ts';
import type { CredentialField } from '../lib/welcome.ts';
import { IconAlert } from './icons.tsx';
import { WelcomeMontage } from './WelcomeMontage.tsx';

export interface WelcomeScreenProps {
  access: Access;
  /** /api/health's live flag (null while unknown). */
  live: boolean | null;
  onAccess: (a: Access) => void;
  /** Leave the Welcome for the guide. */
  onContinue: () => void;
}

/** Submit handlers by descriptor action. Only the access code is wired; the Meta key waits for the lead (no endpoint yet). */
const SUBMIT: Partial<Record<CredentialField['submit'], (value: string) => Promise<Access>>> = {
  access: (code) => api.postAccess(code),
};

export function WelcomeScreen({ access, live, onAccess, onContinue }: WelcomeScreenProps) {
  const uid = useId();
  const w = welcomeAccess(access, live);
  const card = welcomeCard(w, access.state === 'granted' || access.state === 'locked' ? access.info : null);
  const cred = card.credential;
  const headRef = useRef<HTMLHeadingElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keyboard first: a judge lands in the code field; everyone else on the name.
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

  const noteId = `${uid}-note`;
  return (
    <div className="welcome" data-testid="welcome" data-access={w}>
      <section className="wl-panel" aria-labelledby={`${uid}-name`}>
        <header className="wl-head">
          <h2 id={`${uid}-name`} className="wl-name" ref={headRef} tabIndex={-1}>{APP_NAME}</h2>
          <p className="wl-statement">{WELCOME_STATEMENT}</p>
        </header>

        <div className="wl-signin" data-testid="welcome-card">
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
                <button type="submit" className={`wl-btn wl-unlock${card.unlockPrimary ? ' wl-btn-solid' : ''}`} disabled={card.field !== 'enabled' || busy}>
                  {busy ? cred.busyButton : cred.button}
                </button>
              </div>
              {error !== null
                ? <p id={noteId} className="wl-note wl-note-error" role="alert"><IconAlert size={16} />{error}</p>
                : <p id={noteId} className="wl-note">{card.note}</p>}
            </form>
          ) : (
            <p className="wl-status" data-testid="welcome-access">{card.note}</p>
          )}
          {card.divider && <p className="wl-or"><span>or</span></p>}
          <button type="button" className={`wl-btn wl-go${card.go.primary ? ' wl-btn-solid' : ''}`} onClick={onContinue} data-testid="welcome-continue">
            {card.go.label}
          </button>
          <p className="wl-next">{welcomeNext()}</p>
        </div>
      </section>

      <WelcomeMontage />
    </div>
  );
}
