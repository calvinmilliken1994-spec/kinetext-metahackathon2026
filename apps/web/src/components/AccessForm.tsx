// Stage 10: the judge access-code form, shown inline where a build would start (never a dead Build button).
import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { api, describeError } from '../api.ts';
import { ACCESS_INTRO } from '../lib/access.ts';
import type { Access } from '../lib/access.ts';
import { IconKey } from './navIcons.tsx';

export const ACCESS_INPUT_ID = 'access-code';

export function AccessForm({ onAccess, intro = ACCESS_INTRO, submitLabel = 'Unlock builds' }: { onAccess: (a: Access) => void; intro?: string; submitLabel?: string }) {
  const uid = useId();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = (e: FormEvent): void => {
    e.preventDefault();
    if (code.trim() === '' || busy) {
      if (code.trim() === '') setError('Enter the access code you were given.');
      return;
    }
    setBusy(true);
    setError(null);
    api.postAccess(code.trim()).then(
      (a) => { setBusy(false); setCode(''); onAccess(a); },
      (err: unknown) => { setBusy(false); setError(describeError(err)); },
    );
  };
  return (
    <form className="access-form" onSubmit={submit} noValidate aria-labelledby={`${uid}-h`} data-testid="access-form">
      <p className="access-head" id={`${uid}-h`}><IconKey size={16} />Judge access</p>
      <p className="access-intro">{intro}</p>
      <label htmlFor={ACCESS_INPUT_ID} className="field-label">Access code</label>
      <div className="access-row">
        <input
          id={ACCESS_INPUT_ID} type="password" value={code} autoComplete="off" spellCheck={false} autoCapitalize="none"
          aria-invalid={error !== null} aria-describedby={error !== null ? `${uid}-err` : undefined}
          onChange={(e) => { setCode(e.target.value); setError(null); }}
        />
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Checking…' : submitLabel}</button>
      </div>
      {error !== null && <p id={`${uid}-err`} className="field-error" role="alert">{error}</p>}
    </form>
  );
}
