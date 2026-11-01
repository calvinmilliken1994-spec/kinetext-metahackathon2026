// Stage 9b: the first-run tour (docs/specs/STAGE-9b-onboarding-and-live-build-2.md). A short guided walk for a
// first-time teacher that doubles as the scripted path of the demo video. The middle steps watch a labelled REPLAY of
// a stored run, so the tour costs no credits; each of those steps is ready, and moves on, only when the replay has
// reached the matching recorded moment. Pure: no React, no DOM, no network.

import type { JobDetail } from '../api.ts';
import type { PartBuild, StripState } from './liveBuild.ts';

/** The stored run the tour plays: NOAA water cycle on Muse Spark 1.3 (label diagram, two SAM 3.1 calls, one natural repair, a sequence). */
export const TOUR_JOB_ID = 'job-20261031081105-910f3776';
export const TOUR_STORAGE_KEY = 'mki.tour';
export const TOUR_DEFAULT_SPEED = 2;
/** A step that moves on by itself stays up at least this long (wall time), so its card can be read. */
export const TOUR_MIN_DWELL_MS = 2600;

export type TourOutcome = 'done' | 'skipped';

/**
 * The replay to keep once the tour closes. Skipping stops the tour's own recorded build (the lesson then shows as it
 * finished); finishing keeps it, and a replay opened some other way is never touched.
 */
export function replayAfterTourClose<R extends { jobId: string }>(req: R | null, how: TourOutcome): R | null {
  return how === 'skipped' && req?.jobId === TOUR_JOB_ID ? null : req;
}

/**
 * The build view to keep once the tour closes: skipping mid-replay drops the tour run's build view too, so the lesson
 * shows at rest (activity first, one Present button); a finished tour keeps it (re-ordering at the end would jump).
 */
export function watchAfterTourClose(watched: string | null, how: TourOutcome): string | null {
  return how === 'skipped' && watched === TOUR_JOB_ID ? null : watched;
}

type LoadState = 'loading' | 'ready' | 'error';

/**
 * Whether the first tour card may open: not over an empty, loading app. It waits for the runs list, the page list and
 * the opening lesson ('none' when there is no lesson to wait for); an error never holds it back.
 */
export function tourReady(i: { jobs: LoadState; sources: LoadState; lesson: LoadState | 'none' }): boolean {
  return i.jobs !== 'loading' && i.sources !== 'loading' && i.lesson !== 'loading';
}

export interface TourRequest {
  /** `?tour=1`: start the tour whatever the stored flag says. */
  force: boolean;
  /** `?tour=0`: never start it by itself (deep links for evidence and other harnesses). */
  suppress: boolean;
  /** Replay speed for the tour's recorded run (`&speed=N`, 0.25 to 16). */
  speed: number;
}

export function tourRequest(search: string): TourRequest {
  const q = new URLSearchParams(search);
  const t = q.get('tour');
  const raw = Number(q.get('speed') ?? '');
  const speed = q.has('speed') && Number.isFinite(raw) && raw > 0 ? Math.min(16, Math.max(0.25, raw)) : TOUR_DEFAULT_SPEED;
  return { force: t === '1', suppress: t === '0', speed };
}

/**
 * Whether the tour opens by itself: forced by `?tour=1`; otherwise only on a first, plain visit (no stored outcome, no
 * deep link to a run, a presentation, a replay or a dev harness), so it never covers a page someone linked to on purpose.
 */
export function shouldAutoStart(stored: string | null, search: string): boolean {
  const req = tourRequest(search);
  if (req.force) return true;
  if (req.suppress) return false;
  if (stored === 'done' || stored === 'skipped') return false;
  const q = new URLSearchParams(search);
  return !['job', 'present', 'replay', 'lesson-demo', 'engine-demo'].some((k) => q.has(k));
}

// ---- what the app tells the tour --------------------------------------------------------------------------------

export interface TourSignals {
  /** The tour's recorded run is in the runs list (it can be replayed). */
  replayAvailable: boolean;
  /** The runs list has not loaded yet, so whether the run can be replayed is not known. */
  replayLoading: boolean;
  /** The view is playing the tour's replay. */
  replaying: boolean;
  /** The tour's recorded run was asked for but could not be read (the card offers Retry and Continue). */
  replayFailed: boolean;
  /** Muse's overview has landed in the lesson. */
  overview: boolean;
  /** A part has done something worth watching (SAM outlining, checks run, written), beyond being queued or first written. */
  partProgress: boolean;
  /** The part whose checks failed and which is being (or was) reworked, if any. */
  repairPart: string | null;
  /** The repaired part has passed its checks. */
  repairPassed: boolean;
  /** The revision the repair produced (2 for a first repair). */
  repairRevision: number;
  /** The part the "checking" step points at: the repaired one, else the first planned part. */
  watchPart: string | null;
  /** The run has finished (the replay reached its last event). */
  finished: boolean;
  /** The first part that passed, in plan order: the one the teacher tries. */
  firstPart: string | null;
  /** Without a replay: the first checked part of the lesson open on screen (the fallback for the try step). */
  openPart: string | null;
  /** A finished lesson that presentation mode can open. */
  canPresent: boolean;
  /** Pages and subjects in the library (active pages only), when the list has loaded. */
  library: { pages: number; subjects: number } | null;
  /** The run's model name ("Muse Spark 1.3"). */
  model: string;
  /** Replay speed. */
  speed: number;
}

export interface SignalInput {
  replayAvailable: boolean;
  replayLoading?: boolean;
  replaying: boolean;
  replayFailed?: boolean;
  detail: JobDetail | null;
  builds: Readonly<Record<string, PartBuild>>;
  strip: StripState | null;
  canPresent: boolean;
  library: { pages: number; subjects: number } | null;
  speed: number;
}

export function tourSignals(i: SignalInput): TourSignals {
  const d = i.replaying ? i.detail : null;
  const plan = (d?.lessonData?.analysis?.componentPlan ?? []).map((e) => e.componentId as string);
  const builds = Object.values(i.builds);
  const repair = plan.find((id) => i.builds[id]?.lines.some((l) => l.kind === 'checks-failed') === true) ?? null;
  const passed = (d?.lessonData?.lesson?.components ?? []).filter((c) => c.status === 'passed').map((c) => c.componentId as string);
  const progress = builds.some((b) => b.lines.some((l) => l.kind === 'outlining' || l.kind === 'checks-failed' || l.kind === 'checks-passed' || l.kind === 'unusable' || (l.kind === 'writing' && !l.open)));
  const finished = i.replaying && i.strip !== null && i.strip.finished;
  // The lesson on screen when nothing is replaying (W-08): its first checked part, in plan order.
  const open = i.replaying ? null : i.detail;
  const openPassed = (open?.lessonData?.lesson?.components ?? []).filter((c) => c.status === 'passed').map((c) => c.componentId as string);
  const openPlan = (open?.lessonData?.analysis?.componentPlan ?? []).map((e) => e.componentId as string);
  const openPart = openPlan.find((id) => openPassed.includes(id)) ?? openPassed[0] ?? null;
  const replayPart = plan.find((id) => passed.includes(id)) ?? passed[0] ?? null;
  return {
    replayAvailable: i.replayAvailable,
    replayLoading: i.replayLoading === true,
    replaying: i.replaying && d !== null,
    replayFailed: i.replayFailed === true,
    overview: d?.lessonData?.lesson?.overview != null,
    partProgress: progress,
    repairPart: repair,
    repairPassed: repair !== null && passed.includes(repair),
    repairRevision: repair === null ? 2 : Math.max(2, i.builds[repair]?.revision ?? 2),
    watchPart: repair ?? plan[0] ?? null,
    finished,
    // With a recording, the replay decides which part is tried; without one, the lesson on screen does.
    firstPart: i.replaying ? replayPart : i.replayAvailable ? null : openPart,
    openPart,
    canPresent: i.canPresent,
    library: i.library,
    model: i.strip?.model ?? 'Muse Spark',
    speed: i.speed,
  };
}

// ---- the steps ---------------------------------------------------------------------------------------------------

export type TourStepId = 'welcome' | 'library' | 'reading' | 'overview' | 'checking' | 'ready' | 'try' | 'present';

export interface TourStep {
  id: TourStepId;
  title: string;
  body: string;
  /** CSS selectors of the elements to cut out of the dim backdrop (none: a centred card). */
  targets: string[];
  /** Clicks reach the cut-out (the teacher tries the part). */
  interactive: boolean;
  /** The primary button: Next, start the replay, or open presentation mode. */
  primary: 'next' | 'replay' | 'present' | 'finish';
  primaryLabel: string;
  /** Plays the recorded run: skipped when it cannot be replayed. */
  needsReplay: boolean;
}

const part = (id: string | null): string[] => (id === null ? [] : [`.lesson [data-component="${id}"]`]);

function speedWords(speed: number): string {
  return speed === 1 ? 'at real speed' : `at ${Number.isInteger(speed) ? speed : speed.toFixed(2).replace(/0+$/, '')}× speed`;
}

/** The tour, worded from what is actually on screen (counts, model, whether this run had a repair). */
export function tourSteps(s: TourSignals): TourStep[] {
  const lib = s.library === null ? 'a library of licensed pages' : `${s.library.pages} licensed pages in ${s.library.subjects} subjects`;
  const step = (x: Omit<TourStep, 'interactive' | 'primary' | 'primaryLabel' | 'needsReplay'> & Partial<TourStep>): TourStep => ({
    interactive: false, primary: 'next', primaryLabel: 'Next', needsReplay: false, ...x,
  });
  return [
    step({
      id: 'welcome', title: 'Turn a page into a lesson you can teach',
      body: 'Pick a page from a licensed source, or paste your own. Muse Spark reads it, writes a short summary and builds interactive parts for your class, each checked against the page.',
      targets: [], primaryLabel: 'Show me',
    }),
    step({
      id: 'library', title: 'Start from a page',
      body: `Choose one of ${lib}, or paste your own text from New lesson. A real build calls Meta's models, so this tour plays back a recorded build instead. It costs nothing.`,
      targets: ['[data-tour="library"]', '[data-tour="new-lesson"]'],
      primary: s.replayAvailable ? 'replay' : 'next', primaryLabel: s.replayAvailable ? 'Watch a lesson being built' : 'Next',
    }),
    step({
      id: 'reading', title: `${s.model} is reading the page`,
      body: `This is a replay of a recorded run, ${speedWords(s.speed)}. The strip names the model, what it is doing and how long it has taken. Every step you see happened in that run.`,
      targets: ['[data-tour="live-strip"]'], needsReplay: true,
    }),
    step({
      id: 'overview', title: 'Muse writes the summary first',
      body: 'Each key point is tied to the sentence it came from: those sentences light up in the page on the left. Below, the parts Muse planned take shape while it writes them.',
      targets: ['.lesson .overview', '[data-tour="source-text"]'], needsReplay: true,
    }),
    step({
      id: 'checking', title: 'Code checks every part',
      body: s.repairPart === null
        ? 'Before a part appears, code checks its quotes, numbers and structure against the page. A part that fails is reworked or left out.'
        : s.repairPassed
          ? `A check failed on the first draft, so Muse reworked it. Revision ${s.repairRevision} passed every check. That mistake was the model’s own, caught by code, not a planted fault.`
          : `Code checks each draft against the page. A check failed on this one, so Muse is reworking it as revision ${s.repairRevision}.`,
      targets: part(s.watchPart), needsReplay: true,
    }),
    step({
      id: 'ready', title: 'Ready to teach',
      body: 'The strip now sums up the build: how long it took, the model calls it made and whether every part passed its checks.',
      targets: ['[data-tour="live-strip"]'], needsReplay: true,
    }),
    step({
      id: 'try', title: 'Try it as a student would',
      body: 'Parts ask for a prediction first: answers stay hidden until a choice is made. Have a go, then continue.',
      targets: part(s.firstPart), interactive: true,
    }),
    step({
      id: 'present', title: 'Run it with a class',
      body: 'Presentation mode shows the lesson one step at a time on the projector. Students predict, you press R to reveal.',
      // The strip's closing beat holds a Present button; without a watched build, the lesson's own button.
      targets: s.finished ? ['[data-tour="live-strip"]'] : ['[data-tour="present"]'], primary: s.canPresent ? 'present' : 'finish', primaryLabel: s.canPresent ? 'Open presentation mode' : 'Finish',
    }),
  ];
}

/** Whether step `id` can be shown now: its moment in the replay has happened (or its target exists). */
export function stepReady(id: TourStepId, s: TourSignals): boolean {
  switch (id) {
    case 'welcome': case 'library': return true;
    case 'reading': return s.replaying;
    case 'overview': return s.replaying && s.overview;
    case 'checking': return s.replaying && s.watchPart !== null && s.overview;
    case 'ready': return s.finished;
    case 'try': return s.firstPart !== null;
    case 'present': return true;
  }
}

/** Steps that move on by themselves once the replay passes their moment (after a minimum dwell). */
export function autoUntil(id: TourStepId, s: TourSignals): boolean {
  switch (id) {
    case 'reading': return s.overview;
    case 'overview': return s.partProgress;
    case 'checking': return s.finished;
    default: return false;
  }
}

export interface TourState { index: number; enteredAt: number }

/**
 * The steps that will actually be shown. Replay steps drop out when the recorded run is not available; without a replay
 * the try step needs a checked part on screen, so a tour with nothing to try still reaches its last step (W-08).
 */
export function activeSteps(s: TourSignals): TourStep[] {
  return tourSteps(s).filter((x) => (x.needsReplay ? s.replayAvailable : x.id !== 'try' || s.replayAvailable || s.firstPart !== null));
}

/** The signals with the replay set aside (the teacher pressed Continue after the recording failed to load). */
export function withoutReplay(s: TourSignals): TourSignals {
  return { ...s, replayAvailable: false, replaying: false, replayFailed: false, firstPart: s.firstPart ?? s.openPart };
}

const STEP_ORDER: readonly TourStepId[] = ['welcome', 'library', 'reading', 'overview', 'checking', 'ready', 'try', 'present'];

/** Where the tour stands in `after` once the steps changed: the same step when it survives, else the next one that does. */
export function indexAfterSkip(before: readonly TourStep[], index: number, after: readonly TourStep[]): number {
  const id = before[Math.min(index, before.length - 1)]?.id;
  if (id === undefined || after.length === 0) return 0;
  const same = after.findIndex((x) => x.id === id);
  if (same >= 0) return same;
  const at = STEP_ORDER.indexOf(id);
  const next = after.findIndex((x) => STEP_ORDER.indexOf(x.id) > at);
  return next >= 0 ? next : after.length - 1;
}

/** The index of the next step after `index`, or null at the end. */
export function nextIndex(steps: readonly TourStep[], index: number): number | null {
  return index + 1 < steps.length ? index + 1 : null;
}

/** Next is offered only when the next step's moment has come (the replay drives the middle of the tour). */
export function canGoNext(steps: readonly TourStep[], index: number, s: TourSignals): boolean {
  const n = nextIndex(steps, index);
  const next = n === null ? undefined : steps[n];
  return next === undefined ? false : stepReady(next.id, s);
}

/**
 * Auto-advance: a replay step moves on once the replay has passed its moment, it has been up for `minDwellMs`, and
 * the next step is ready. Returns the same state object when nothing changes.
 */
export function autoAdvance(state: TourState, steps: readonly TourStep[], s: TourSignals, now: number, minDwellMs = TOUR_MIN_DWELL_MS): TourState {
  const cur = steps[state.index];
  if (cur === undefined || !autoUntil(cur.id, s)) return state;
  if (now - state.enteredAt < minDwellMs) return state;
  if (!canGoNext(steps, state.index, s)) return state;
  return { index: state.index + 1, enteredAt: now };
}

// ---- where the card goes ----------------------------------------------------------------------------------------

export interface Rect { x: number; y: number; w: number; h: number }

export function unionRect(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null;
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const r = Math.max(...rects.map((q) => q.x + q.w));
  const b = Math.max(...rects.map((q) => q.y + q.h));
  return { x, y, w: r - x, h: b - y };
}

/** `r` clipped to `bounds`, or null when nothing of it is visible. */
export function clipRect(r: Rect, bounds: Rect): Rect | null {
  const x = Math.max(r.x, bounds.x);
  const y = Math.max(r.y, bounds.y);
  const right = Math.min(r.x + r.w, bounds.x + bounds.w);
  const bottom = Math.min(r.y + r.h, bounds.y + bounds.h);
  return right - x < 1 || bottom - y < 1 ? null : { x, y, w: right - x, h: bottom - y };
}

export type CardSide = 'right' | 'left' | 'below' | 'above' | 'center' | 'inside';

const overlaps = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Where the step card sits: beside the main cut-out where it fits (right, left, below, above, in that order), aligned
 * with its top and kept inside the viewport, never over another cut-out (`avoid`); with no target, centred; when
 * nothing fits, in the target's bottom-right corner, inside the cut-out.
 */
export function placeCard(target: Rect | null, viewport: { w: number; h: number }, card: { w: number; h: number }, avoid: readonly Rect[] = [], gap = 16, margin = 16): { x: number; y: number; side: CardSide } {
  const clampX = (x: number): number => Math.max(margin, Math.min(viewport.w - card.w - margin, x));
  const clampY = (y: number): number => Math.max(margin, Math.min(viewport.h - card.h - margin, y));
  if (target === null) return { x: Math.round((viewport.w - card.w) / 2), y: Math.round((viewport.h - card.h) / 2), side: 'center' };
  const free = (x: number, y: number): boolean => !avoid.some((r) => overlaps({ x, y, w: card.w, h: card.h }, r));
  const right = target.x + target.w + gap;
  if (right + card.w + margin <= viewport.w && free(right, clampY(target.y))) return { x: right, y: clampY(target.y), side: 'right' };
  const left = target.x - gap - card.w;
  if (left >= margin && free(left, clampY(target.y))) return { x: left, y: clampY(target.y), side: 'left' };
  const below = target.y + target.h + gap;
  if (below + card.h + margin <= viewport.h && free(clampX(target.x), below)) return { x: clampX(target.x), y: below, side: 'below' };
  const above = target.y - gap - card.h;
  if (above >= margin && free(clampX(target.x), above)) return { x: clampX(target.x), y: above, side: 'above' };
  return { x: clampX(target.x + target.w - card.w - gap), y: clampY(target.y + target.h - card.h - gap), side: 'inside' };
}
