// Stage 10 (docs/specs/STAGE-10-navigation-and-access.md): the judge access code, as the web app sees it. The API owns
// the gate (section A); this file turns its answers into plain states and words. Pure: no React, no DOM, no network.
// GET /api/access answers 404 on an API without the route: that is "gate off", today's local behaviour.

export interface AccessInfo {
  gate: boolean;
  granted: boolean;
  capUSD: number;
  spentUSD: number;
  remainingUSD: number;
  buildsEnabled: boolean;
}

export type Access =
  | { state: 'loading' }
  /** No gate: builds work as they always have (subject to /api/health). */
  | { state: 'off' }
  /** Gate on, no session: read-only. */
  | { state: 'locked'; info: AccessInfo }
  /** Gate on, signed in with the code. */
  | { state: 'granted'; info: AccessInfo }
  /** The answer could not be read; nothing is claimed either way. */
  | { state: 'error' };

/** Below this, the API refuses new judge builds (`judgeMinHeadroomUSD` in section A). */
export const JUDGE_MIN_HEADROOM_USD = 1;

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function parseAccessInfo(raw: unknown): AccessInfo | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const { gate, granted, capUSD, spentUSD, remainingUSD, buildsEnabled } = r;
  if (typeof gate !== 'boolean' || typeof granted !== 'boolean' || typeof buildsEnabled !== 'boolean') return null;
  if (!num(capUSD) || !num(spentUSD) || !num(remainingUSD)) return null;
  return { gate, granted, capUSD, spentUSD, remainingUSD, buildsEnabled };
}

export function accessFromInfo(info: AccessInfo): Access {
  if (!info.gate) return { state: 'off' };
  return info.granted ? { state: 'granted', info } : { state: 'locked', info };
}

export function accessFromResponse(status: number, body: unknown): Access {
  if (status === 404) return { state: 'off' };
  if (status !== 200) return { state: 'error' };
  const info = parseAccessInfo(body);
  return info === null ? { state: 'error' } : accessFromInfo(info);
}

/** "$50", "$47.12", "$0.40"; never negative. */
export function formatUSD(usd: number): string {
  const v = Math.max(0, usd);
  const cents = Math.round(v * 100);
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}

export interface AccessFooter {
  title: string;
  detail: string | null;
  /** The footer's one button. */
  action: 'enter' | 'sign-out';
  tone: 'neutral' | 'warn';
}

const budgetUsed = (i: AccessInfo): boolean => i.remainingUSD < JUDGE_MIN_HEADROOM_USD;

/** The sidebar footer: nothing while the gate is off; read-only or judge access otherwise. `live` is /api/health's flag. */
export function accessFooter(a: Access, live: boolean | null): AccessFooter | null {
  if (a.state === 'locked') {
    return { title: 'Read-only demo', detail: 'Browse, replay and present. Builds need an access code.', action: 'enter', tone: 'neutral' };
  }
  if (a.state !== 'granted') return null;
  const i = a.info;
  const title = `Judge access · ${formatUSD(i.remainingUSD)} of ${formatUSD(i.capUSD)} left`;
  if (i.buildsEnabled) return { title, detail: null, action: 'sign-out', tone: 'neutral' };
  const detail = budgetUsed(i)
    ? 'The judges’ build budget is used up.'
    : live === false ? 'Live builds are off on this server.' : 'Builds are paused right now.';
  return { title, detail, action: 'sign-out', tone: 'warn' };
}

export type BuildGate = 'open' | 'needs-code' | 'budget' | 'paused';

/** What the New lesson build area shows: the Build button, the access-code form, or why builds are stopped. */
export function buildGate(a: Access): BuildGate {
  if (a.state === 'locked') return 'needs-code';
  if (a.state !== 'granted' || a.info.buildsEnabled) return 'open';
  return budgetUsed(a.info) ? 'budget' : 'paused';
}

/** Plain sentences for the API's access refusals (merged into api.ts describeError). */
export const ACCESS_MESSAGES: Readonly<Record<string, string>> = {
  ACCESS_REQUIRED: 'Builds need a judge access code. Everything else (browsing, recorded builds, presenting) works without one.',
  JUDGE_BUDGET_REACHED: 'The judges’ build budget is used up. Recorded lessons, replays and presenting still work.',
  BUILDS_PAUSED: 'Builds are paused right now. Recorded lessons, replays and presenting still work.',
  ACCESS_CODE_INVALID: 'That access code is not right. Check it and try again.',
  TOO_MANY_ATTEMPTS: 'Too many tries. Wait a minute, then try again.',
};

/** The sentence shown beside the access-code form (spec wording). */
export const ACCESS_INTRO = 'Builds are open to judges with an access code. Everything else (browsing, recorded builds, presenting) works without one.';
