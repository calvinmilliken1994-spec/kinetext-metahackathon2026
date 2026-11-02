// Stage 9b: the first-run tour (docs/specs/STAGE-9b-onboarding-and-live-build-2.md). A short guided walk for a
// first-time teacher that doubles as the scripted path of the demo video. The middle steps watch a labelled REPLAY of
// a stored run, so the tour costs no credits. Demo v2 (docs/specs/DEMO-V2-follow-the-build.md): those middle steps are
// the run's beats (lib/demoBeats.ts). The replay leads and the card follows; Next and Back seek the replay to a beat.
// Pure: no React, no DOM, no network.

import type { JobDetail } from '../api.ts';
import type { PartBuild, StripState } from './liveBuild.ts';
import { DEMO_PINS } from './demoPins.ts';
import type { Beat } from './demoBeats.ts';
import { beatCard, beatLights, buildBeats } from './demoBeats.ts';
import type { WelcomeAccess } from './welcome.ts';
import { ownCardBody } from './welcome.ts';

/** The stored run the Demo plays (lib/demoPins.ts): NOAA water cycle on Muse Spark 1.3, grounded label diagram, one natural repair, a sequence. */
export const TOUR_JOB_ID = DEMO_PINS.tour;
export const TOUR_STORAGE_KEY = 'mki.tour';
export const TOUR_DEFAULT_SPEED = 4;
/** A beat of the build stays up at least this long (wall time), so its card can be read: the replay waits for it. */
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
  // Stage 10: ?demo= is the visible name; ?tour= keeps working.
  const t = q.get('demo') ?? q.get('tour');
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
  return !['job', 'present', 'replay', 'view', 'lesson-demo', 'engine-demo'].some((k) => q.has(k));
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
  /** Demo v2: the recorded run's beats (from its whole record; empty until that has loaded). */
  beats: Beat[];
  /** What building your own page needs here (the closing card). */
  own: WelcomeAccess;
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
  /** The tour run's whole stored detail: its beats are read from it, before the replay reaches them. */
  recording?: JobDetail | null;
  own?: WelcomeAccess;
}

export function tourSignals(i: SignalInput): TourSignals {
  const d = i.replaying ? i.detail : null;
  const plan = (d?.lessonData?.analysis?.componentPlan ?? []).map((e) => e.componentId as string);
  const passed = (d?.lessonData?.lesson?.components ?? []).filter((c) => c.status === 'passed').map((c) => c.componentId as string);
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
    finished,
    // With a recording, the replay decides which part is tried; without one, the lesson on screen does.
    firstPart: i.replaying ? replayPart : i.replayAvailable ? null : openPart,
    openPart,
    canPresent: i.canPresent,
    library: i.library,
    model: i.strip?.model ?? 'Muse Spark',
    speed: i.speed,
    // Known from the recording before the replay starts, so the step count holds still through the Demo.
    beats: buildBeats(i.recording ?? null),
    own: i.own ?? 'open',
  };
}

// ---- the steps ---------------------------------------------------------------------------------------------------

/** `build`: one step per beat of the recorded run (Demo v2). */
export type TourStepId = 'welcome' | 'library' | 'build' | 'try' | 'present' | 'own';

export interface TourStep {
  id: TourStepId;
  title: string;
  body: string;
  /** CSS selectors of the elements to cut out of the dim backdrop (none: a centred card). */
  targets: string[];
  /**
   * More elements the step talks about, cut out too when the card still fits clear of every cut-out; on a screen too
   * small for that they stay dimmed (the card may then sit over them, never over `targets`).
   */
  extras: string[];
  /** Clicks reach the cut-out (the teacher tries the part). */
  interactive: boolean;
  /** The primary button: Next, start the replay, finish, or (closing card) open New lesson on Your own source. */
  primary: 'next' | 'replay' | 'finish' | 'own';
  primaryLabel: string;
  /** A second choice on the card: open presentation mode (the Demo stays, and comes back after it), or All lessons. */
  secondary: { action: 'present' | 'lessons'; label: string } | null;
  /** Plays the recorded run: skipped when it cannot be replayed. */
  needsReplay: boolean;
  /** A build step: the beat it shows (its event time is where Next and Back seek the replay to). */
  beat: Beat | null;
}

const part = (id: string | null): string[] => (id === null ? [] : [`.lesson [data-component="${id}"]`]);

/** What the teacher does on the try step, worded for the kind of part it points at (a part id is its component id). */
function tryWords(partId: string | null): string {
  if (partId?.startsWith('label-diagram') === true) return 'Drag each name onto its number, then press Check. Nothing is marked until you do. Have a go, then continue.';
  if (partId !== null && /^(?:sequence|sort-groups|concept-map)/.test(partId)) return 'Have a go as a student would: answers stay hidden until you check. Then continue.';
  return 'Parts ask for a prediction first: answers stay hidden until a choice is made. Have a go, then continue.';
}

/** The tour, worded from what is actually on screen (counts, model, whether this run had a repair). */
export function tourSteps(s: TourSignals): TourStep[] {
  const lib = s.library === null ? 'a library of licensed pages' : `${s.library.pages} licensed pages in ${s.library.subjects} subjects`;
  const step = (x: Omit<TourStep, 'interactive' | 'primary' | 'primaryLabel' | 'needsReplay' | 'extras' | 'secondary' | 'beat'> & Partial<TourStep>): TourStep => ({
    interactive: false, primary: 'next', primaryLabel: 'Next', needsReplay: false, extras: [], secondary: null, beat: null, ...x,
  });
  // Until the recording has loaded, the build is its first beat alone (reading the page), so the Demo can start.
  const beats = s.beats.length > 0 ? s.beats : [PENDING_BEAT];
  const build = beats.map((b) => step({ id: 'build', ...beatCard(b, { model: s.model, speed: s.speed }), ...beatLights(b, b.tMs), needsReplay: true, beat: b }));
  return [
    step({
      id: 'welcome', title: 'Turn a page into a lesson you can teach',
      body: 'Pick a page from a licensed source, or paste your own. Muse Spark reads it, writes a short summary and builds interactive parts for your class, each checked against the page.',
      targets: [], primaryLabel: 'Show me',
    }),
    step({
      id: 'library', title: 'Start from a page',
      body: `Choose one of ${lib}, or paste your own text from New lesson. A real build calls Meta's models, so this demo plays back a recorded build instead. It costs nothing.`,
      targets: ['[data-tour="library"]', '[data-tour="new-lesson"]'],
      primary: s.replayAvailable ? 'replay' : 'next', primaryLabel: s.replayAvailable ? 'Watch a lesson being built' : 'Next',
    }),
    ...build,
    step({
      id: 'try', title: 'Try it as a student would',
      body: tryWords(s.firstPart),
      targets: part(s.firstPart), interactive: true,
    }),
    step({
      id: 'present', title: 'Run it with a class',
      body: 'Presentation mode shows the lesson one step at a time on the projector. Students predict, you press R to reveal.',
      // The strip's closing beat holds a Present button; without a watched build, the lesson's own button.
      // Stage 10c: Next goes on to the closing card; presentation mode is a side action the Demo comes back from.
      targets: s.finished ? ['[data-tour="live-strip"]'] : ['[data-tour="present"]'],
      secondary: s.canPresent ? { action: 'present', label: 'Open presentation mode' } : null,
    }),
    step({
      id: 'own', title: 'Try your own page', body: ownCardBody(s.own), targets: [],
      primary: 'own', primaryLabel: 'Try your own page', secondary: { action: 'lessons', label: 'Browse the lessons' },
    }),
  ];
}

/** Whether step `id` can be shown now. A build step always can: the replay brings its moment (Next seeks to it). */
export function stepReady(id: TourStepId, s: TourSignals): boolean {
  switch (id) {
    case 'welcome': case 'library': case 'build': case 'present': case 'own': return true;
    case 'try': return s.firstPart !== null;
  }
}

/**
 * The steps that will actually be shown. Replay steps drop out when the recorded run is not available; without a replay
 * the try step needs a checked part on screen, so a tour with nothing to try still reaches its last step (W-08).
 */
export function activeSteps(s: TourSignals, o: { intro: boolean } = { intro: true }): TourStep[] {
  return tourSteps(s).filter((x) => {
    // Started from the guide's prompt (Stage 10c), the Demo opens on the build: its own introduction is already done.
    if (!o.intro && (x.id === 'welcome' || x.id === 'library')) return false;
    return x.needsReplay ? s.replayAvailable : x.id !== 'try' || s.replayAvailable || s.firstPart !== null;
  });
}

/** The signals with the replay set aside (the teacher pressed Continue after the recording failed to load). */
export function withoutReplay(s: TourSignals): TourSignals {
  return { ...s, replayAvailable: false, replaying: false, replayFailed: false, firstPart: s.firstPart ?? s.openPart };
}

const STEP_ORDER: readonly TourStepId[] = ['welcome', 'library', 'build', 'try', 'present', 'own'];

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

/** Next is offered when the next step can be shown. During the build it always is: Next seeks the replay (Demo v2). */
export function canGoNext(steps: readonly TourStep[], index: number, s: TourSignals): boolean {
  const n = nextIndex(steps, index);
  const next = n === null ? undefined : steps[n];
  if (next === undefined) return false;
  return steps[index]?.id === 'build' || stepReady(next.id, s);
}

/**
 * Where Next (`dir` 1) or Back (-1) goes from step `index`: the step, and the replay time to seek to when both ends are
 * build steps (the target beat's event time). Leaving or entering the build seeks nothing: the replay starts with the
 * build, and has finished by the time the try step is reached. Null when there is no step there.
 */
export function tourMove(steps: readonly TourStep[], index: number, dir: 1 | -1): { index: number; seek: number | null } | null {
  const to = index + dir;
  const target = steps[to];
  if (target === undefined || to < 0) return null;
  const seek = steps[index]?.id === 'build' && target.id === 'build' && target.beat !== null ? target.beat.tMs : null;
  return { index: to, seek };
}

/** What a step lights at replay time `tMs`: a build step follows its beat (a checked part hands the light on). */
export function stepLights(step: TourStep, tMs: number): { targets: string[]; extras: string[] } {
  return step.beat === null ? { targets: step.targets, extras: step.extras } : beatLights(step.beat, tMs);
}

/** The build before the recording has loaded: the replay opens on reading the page. */
const PENDING_BEAT: Beat = {
  id: 'reading@pending', kind: 'reading', tMs: 0, part: null, label: null, revision: 1, parts: null, located: null, actor: 'Muse Spark',
  checks: null, failedCheck: null, revised: false, planted: false, alongside: [], follow: null, planned: 0, ok: false, untilMs: null,
};

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
/**
 * What of `r` shows below a sticky `cover` (the build strip) that overlaps its top: the part above the cover's bottom is
 * hidden behind it. A target beside or below the cover is unchanged; one wholly behind it has nothing visible (null).
 */
export function belowCover(r: Rect, cover: Rect): Rect | null {
  const across = Math.min(r.x + r.w, cover.x + cover.w) - Math.max(r.x, cover.x) >= 1;
  const coverBottom = cover.y + cover.h;
  // The strip sticks at the top of its scrolling column, so whatever of the target reaches up into it is hidden.
  if (!across || r.y >= coverBottom || r.y + r.h <= cover.y) return r;
  const bottom = r.y + r.h;
  return bottom - coverBottom < 1 ? null : { x: r.x, y: coverBottom, w: r.w, h: bottom - coverBottom };
}

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
  if (below + card.h + margin <= viewport.h) {
    // Left-aligned with the target first, then right-aligned (a wide target leaves room under its right end).
    for (const x of [clampX(target.x), clampX(target.x + target.w - card.w)]) if (free(x, below)) return { x, y: below, side: 'below' };
  }
  const above = target.y - gap - card.h;
  if (above >= margin) {
    for (const x of [clampX(target.x), clampX(target.x + target.w - card.w)]) if (free(x, above)) return { x, y: above, side: 'above' };
  }
  return { x: clampX(target.x + target.w - card.w - gap), y: clampY(target.y + target.h - card.h - gap), side: 'inside' };
}

/**
 * Where a step's card goes and which cut-outs are drawn. `groups` are the measured rects per selector: the step's
 * targets first (`required` of them; the first is the main target), then its extras. The card is placed clear of every
 * cut-out; when that leaves only a place inside the main target, the extras are dropped (left dimmed, the card may sit
 * over them) rather than covering a target.
 */
export function placeStep(groups: readonly (readonly Rect[])[], required: number, viewport: { w: number; h: number }, card: { w: number; h: number }): { x: number; y: number; side: CardSide; cut: Rect[] } {
  const all = groups.flat();
  const target = unionRect(groups[0] ?? []) ?? unionRect(all);
  const p = placeCard(target, viewport, card, all);
  if (p.side !== 'inside' || groups.length <= required) return { ...p, cut: all };
  const kept = groups.slice(0, required).flat();
  return { ...placeCard(target, viewport, card, kept), cut: kept };
}
