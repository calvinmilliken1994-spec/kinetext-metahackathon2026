// Stage 10c section 1 (docs/specs/STAGE-10c-first-launch-and-fixes.md): the first launch. A first visit shows the
// Welcome screen (access code or read-only), then a short guide that moves the main view round the pages, then a
// prompt to watch the recorded Demo. Deep links skip all of it. Pure: no React, no DOM, no network.

import type { Access, AccessInfo } from './access.ts';
import { formatUSD } from './access.ts';
import type { MainView } from './navigation.ts';

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

export interface WelcomeChoice {
  /** The access panel's heading and sentence. */
  title: string;
  body: string;
  /** The access-code form is shown (gate on, no session yet). */
  form: boolean;
  /** The other panel: its heading, sentence and button. */
  readTitle: string;
  readBody: string;
  continueLabel: string;
}

const READ_ONLY_BODY = 'Browse the finished lessons, watch a recorded build and present them. No code needed.';
const GUIDE_BODY = 'A short guide shows you round the pages first. You can skip it at any point.';

export function welcomeChoice(w: WelcomeAccess, info: AccessInfo | null): WelcomeChoice {
  const go = { readTitle: 'Get started', readBody: GUIDE_BODY, continueLabel: 'Continue' };
  switch (w) {
    case 'locked':
      return {
        title: 'Enter access code', body: 'For judges. It unlocks live builds on Meta’s models, from a library page or your own.', form: true,
        readTitle: 'Continue read-only', readBody: READ_ONLY_BODY, continueLabel: 'Continue read-only',
      };
    case 'granted':
      return {
        title: 'Judge access is on',
        body: info === null ? 'Live builds are unlocked in this browser.' : `Live builds are unlocked in this browser: ${formatUSD(info.remainingUSD)} of ${formatUSD(info.capUSD)} left.`,
        form: false, ...go,
      };
    case 'open':
      return { title: 'Builds are open on this server', body: 'No access code is needed here. Pick a page or paste your own, then build.', form: false, ...go };
    case 'live-off':
      return { title: 'Live builds are off on this server', body: 'Recorded lessons, replays of recorded builds and presenting all work.', form: false, ...go };
    case 'unknown':
      return { title: 'Access could not be checked', body: 'You can still go on. The New lesson page says whether builds work.', form: false, ...go };
    case 'checking':
      return { title: 'Checking access…', body: '', form: false, ...go };
  }
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
      body: 'The teacher’s step. Read each part, hide any you do not want, then publish. Until then the lesson says “Teacher review pending”; it always says AI-written.',
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
