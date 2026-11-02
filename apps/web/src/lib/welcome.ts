// Stage 10c section 1 (docs/specs/STAGE-10c-first-launch-and-fixes.md): the first launch. A first visit shows the
// Welcome screen (access code or read-only), then a short guide that moves the main view round the pages, then a
// prompt to watch the recorded Demo. Deep links skip all of it. Pure: no React, no DOM, no network.

import type { Access, AccessInfo } from './access.ts';
import { formatUSD } from './access.ts';
import type { MainView } from './navigation.ts';

/** The product's name: ONE constant (the window title and the Welcome's panel). Provisional until Calvin picks a name. */
export const APP_NAME = 'Make knowledge interactive';

/** The Welcome's one-line statement under the name (Welcome v3, docs/specs/WELCOME-V3-split.md). */
export const WELCOME_STATEMENT = 'Turn a page into a lesson you can teach.';

/** Stored as 'done' once the visitor has left the Welcome screen. */
export const WELCOME_STORAGE_KEY = 'mki.welcome';

/** Links that open something on purpose: they never land on the Welcome (an explicit ?welcome=1 still does). */
const DEEP_LINKS = ['job', 'present', 'replay', 'view', 'tour', 'demo', 'lesson-demo', 'engine-demo'];

export function shouldShowWelcome(stored: string | null, search: string): boolean {
  const q = new URLSearchParams(search);
  const w = q.get('welcome');
  if (w === '1') return true;
  if (w === '0') return false;
  if (DEEP_LINKS.some((k) => q.has(k))) return false;
  return stored !== 'done';
}

/**
 * What a page load opens: the Welcome (first plain visit, or ?welcome=1), and whether the Demo opens by itself. The
 * Welcome replaces the old first-visit Demo auto-start; the Demo opens by itself only when forced (?demo=1 / ?tour=1,
 * the scripted film path), and otherwise from the guide's prompt or the sidebar.
 */
export function firstLaunch(i: { welcome: string | null; search: string }): { welcome: boolean; demo: boolean } {
  const q = new URLSearchParams(i.search);
  const t = q.get('demo') ?? q.get('tour');
  const welcome = shouldShowWelcome(i.welcome, i.search);
  return { welcome, demo: !welcome && t === '1' };
}

// ---- the access half of the Welcome ------------------------------------------------------------------------------

export type WelcomeAccess = 'checking' | 'locked' | 'granted' | 'open' | 'live-off' | 'unknown';

/** `live` is /api/health's flag (null while unknown). With the gate off, builds are only "open" when live generation is on. */
export function welcomeAccess(a: Access, live: boolean | null): WelcomeAccess {
  switch (a.state) {
    case 'loading': return 'checking';
    case 'locked': return 'locked';
    case 'granted': return 'granted';
    case 'error': return 'unknown';
    case 'off': return live === null ? 'checking' : live ? 'open' : 'live-off';
  }
}

/**
 * The credential the Get started card asks for, as one descriptor: the field's words and which submit action it runs.
 * `accessCode` is wired to POST /api/access today. `metaKey` (a judge's own key, held by their local server) is defined
 * but NOT wired: there is no server endpoint for it yet, and the lead wires it once Calvin decides.
 */
export interface CredentialField {
  label: string;
  placeholder: string;
  button: string;
  /** The button while the submit is in flight. */
  busyButton: string;
  /** One line under the field when it can be used. */
  helper: string;
  /** Asked for when submitting an empty field. */
  emptyError: string;
  /** Which submit handler the card runs ('access': api.postAccess). */
  submit: 'access' | 'meta-key';
}

export const WELCOME_CREDENTIALS = {
  accessCode: {
    label: 'Judge access code', placeholder: 'Enter your access code', button: 'Unlock', busyButton: 'Checking…',
    helper: 'For judges: it unlocks live builds on Meta’s models.', emptyError: 'Enter the access code you were given.', submit: 'access',
  },
  metaKey: {
    label: 'Meta API key', placeholder: 'Paste your Meta API key', button: 'Turn on live builds', busyButton: 'Checking…',
    helper: 'Kept on this computer, used only by your local server', emptyError: 'Paste your Meta API key first.', submit: 'meta-key',
  },
} as const satisfies Record<string, CredentialField>;

/**
 * The Welcome's one Get started card (Welcome v2, Calvin 2 Nov): the judge access-code field with an Unlock button, an
 * "or", then one big button into the guide, and a line on what comes next. The field keeps its place on a server where
 * there is no code to enter (disabled, with the reason), so the card looks the same locally and on the judged server.
 */
export interface WelcomeCard {
  /** The credential the field asks for (its label, button, helper and submit action). */
  credential: CredentialField;
  /** The code field: usable (gate on, locked), shown disabled with a reason, or left out (access already settled). */
  field: 'enabled' | 'disabled' | 'none';
  placeholder: string;
  /** One line under the field (or in its place): what the code does here, or why there is none to enter. */
  note: string;
  /** Unlock is the blue button (locked); otherwise the big button below is. */
  unlockPrimary: boolean;
  /** The "or" between the field and the big button. */
  divider: boolean;
  /** The big button: always continues to the guide. */
  go: { label: string; primary: boolean };
}

const EXPLORE = 'Explore read-only';

export function welcomeCard(w: WelcomeAccess, info: AccessInfo | null, credential: CredentialField = WELCOME_CREDENTIALS.accessCode): WelcomeCard {
  const settled = { credential, field: 'none' as const, placeholder: '', unlockPrimary: false, divider: false, go: { label: 'Continue', primary: true } };
  const waiting = { credential, field: 'disabled' as const, unlockPrimary: false, divider: true, go: { label: EXPLORE, primary: true } };
  switch (w) {
    case 'locked':
      return {
        credential, field: 'enabled', placeholder: credential.placeholder, note: credential.helper,
        unlockPrimary: true, divider: true, go: { label: EXPLORE, primary: false },
      };
    case 'live-off':
      return { ...waiting, placeholder: 'No code needed here', note: 'Live builds are off on this server.' };
    case 'checking':
      return { ...waiting, placeholder: 'Checking access…', note: '' };
    case 'unknown':
      return { ...waiting, placeholder: credential.label, note: 'Access could not be checked. Read-only works either way.' };
    case 'granted':
      return {
        ...settled,
        note: info === null ? 'Judge access is on in this browser.' : `Judge access is on: ${formatUSD(info.remainingUSD)} of ${formatUSD(info.capUSD)} left.`,
      };
    case 'open':
      return { ...settled, note: 'Builds are open on this server. No access code is needed.' };
  }
}

/** The card's last line. The guide's step count comes from the guide itself. */
export function welcomeNext(): string {
  const steps = guideSteps({ library: null, access: 'locked', demo: { available: true, length: '' } }).filter((s) => s.counted).length;
  return `Next: a ${steps}-step guide round the pages, then a recorded demo of a build if you want one.`;
}

/** The recorded build's length at the Demo's replay speed, for the Demo prompt ("about 1 minute"). */
export function demoLengthWords(createdAt: string | undefined, finishedAt: string | undefined, speed: number): string {
  const ms = createdAt === undefined || finishedAt === undefined ? NaN : Date.parse(finishedAt) - Date.parse(createdAt);
  if (!Number.isFinite(ms) || ms <= 0 || !(speed > 0)) return 'about 1 minute';
  const minutes = Math.max(1, Math.round(ms / speed / 60000));
  return minutes === 1 ? 'about 1 minute' : `about ${minutes} minutes`;
}

// ---- the guide -----------------------------------------------------------------------------------------------------

export type GuideStepId = 'new' | 'lesson' | 'present' | 'checks' | 'review' | 'results' | 'demo' | 'own';
export type GuideAction = 'next' | 'watch' | 'own' | 'not-now' | 'lessons';

export interface GuideStep {
  id: GuideStepId;
  title: string;
  body: string;
  /** The main view this step opens. */
  view: MainView;
  /** The step opens the lesson's "Checks and run details" drawer. */
  drawer: boolean;
  /** Elements cut out of the dim layer (none: a centred card); the first is the one the card sits beside. */
  targets: string[];
  /** Also lit when the card still fits clear of them. */
  extras: string[];
  /** Counted in "Step N of M" (the closing prompt is not a step). */
  counted: boolean;
  /** Shown while the targets are not on screen yet (a page or lesson still loading). */
  wait: string;
  primary: { label: string; action: GuideAction };
  secondary: { label: string; action: GuideAction } | null;
}

export interface GuideInput {
  library: { pages: number; subjects: number } | null;
  access: WelcomeAccess;
  /** The recorded Demo run can be played, and how long it takes at the Demo speed. */
  demo: { available: boolean; length: string };
}

/** The last card when the Demo cannot play, and the Demo's own closing card. */
export function ownCardBody(access: WelcomeAccess): string {
  const base = 'Paste the text of a page you have the rights to use, and Muse Spark builds a lesson from it.';
  if (access === 'locked') return `${base} Building needs the judge access code; you can enter it right there.`;
  if (access === 'live-off') return `${base} Live builds are off on this server, so this copy cannot build it.`;
  return base;
}

export function guideSteps(i: GuideInput): GuideStep[] {
  const lib = i.library === null ? 'a library of licensed pages' : `${i.library.pages} licensed pages in ${i.library.subjects} subjects`;
  const next = { label: 'Next', action: 'next' as const };
  const step = (x: Omit<GuideStep, 'drawer' | 'extras' | 'counted' | 'wait' | 'primary' | 'secondary'> & Partial<GuideStep>): GuideStep => ({
    drawer: false, extras: [], counted: true, wait: 'Opening the page…', primary: next, secondary: null, ...x,
  });
  const locked = i.access === 'locked';
  const steps: GuideStep[] = [
    step({
      id: 'new', title: 'Start a lesson from a page', view: 'new',
      body: `Pick one of ${lib}, or paste your own source. Muse Spark reads it and builds the lesson.${locked ? ' Building needs the judge access code; everything else works without it.' : ''}`,
      targets: ['[data-tour="nl-paths"]'], extras: ['[data-tour="new-lesson"]'],
    }),
    step({
      id: 'lesson', title: 'A finished lesson', view: 'lesson', wait: 'Opening the lesson…',
      body: 'It opens on its most visual part for students to try. Below sits a short AI-written summary, each point tied to the sentence it came from: hover a point to light that sentence in the page.',
      targets: ['main.activity-panel'],
    }),
    step({
      id: 'present', title: 'Present it to a class', view: 'lesson', wait: 'Opening the lesson…',
      body: 'Present shows the lesson on a projector one step at a time. Students predict first; you press R to reveal the answer.',
      targets: ['[data-tour="present"]'], extras: ['[data-nav="present"]'],
    }),
    step({
      id: 'checks', title: 'What was checked', view: 'lesson', drawer: true, wait: 'Opening the details…',
      body: 'Checks and run details shows each model call and what code checked before a part appeared. Code matches every quote to the page and recomputes every number it calculates; it does not check whether the page itself is right.',
      // The drawer opens on the runs list; the step brings its checks section into view and lights that.
      targets: ['[data-testid="runs-drawer"] #drawer-checks'], extras: ['[data-nav="checks"]'],
    }),
    step({
      id: 'review', title: 'Review and publish', view: 'review',
      body: 'The teacher’s step. Read each part, hide any you do not want, then publish. Until then the lesson says “Needs review”; it always says AI-written.',
      targets: ['[data-testid="review-page"] .page-head'], extras: ['[data-nav="review"]'],
    }),
    step({
      id: 'results', title: 'How the models did', view: 'results',
      body: 'Results compares Muse Spark 1.3 and Muse Spark Open on a pre-registered evaluation of real pages, part type by part type, and names the committed files every number comes from.',
      targets: ['.page-results .rs-hl-grid'], extras: ['.page-results .page-head', '[data-nav="results"]'],
    }),
  ];
  if (i.demo.available) {
    steps.push(step({
      id: 'demo', title: 'Watch a lesson being built', view: 'lesson', counted: false,
      body: `Recorded, ${i.demo.length}. Muse Spark reads a page, writes the summary and builds the parts; for a figure, Muse Spark locates each part and SAM 3.1 confirms it; code checks each part. It replays stored events, so it costs nothing.`,
      targets: [], primary: { label: 'Watch the demo', action: 'watch' }, secondary: { label: 'Not now', action: 'not-now' },
    }));
  } else {
    steps.push(step({
      id: 'own', title: 'Try your own page', view: 'lesson', counted: false, body: ownCardBody(i.access),
      targets: [], primary: { label: 'Try your own page', action: 'own' }, secondary: { label: 'Browse the lessons', action: 'lessons' },
    }));
  }
  return steps;
}

/** L5: Next is ignored this long after a step change, so a click aimed at the old step never skips the new one. */
export const NEXT_GUARD_MS = 400;

export function nextAllowed(enteredAt: number, now: number): boolean {
  return now - enteredAt >= NEXT_GUARD_MS;
}
