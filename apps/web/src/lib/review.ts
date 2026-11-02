// Stage 10b slice R: the Review page's rules (docs/specs/STAGE-10b-review-and-results.md, section R). Which parts a teacher
// reviews, what ticking and hiding mean, the body the API takes, who may publish, and two small hand-offs between views
// (a published/unpublished lesson reloads wherever it is shown; "Open" scrolls the lesson to a part). Pure: no React, no
// DOM, no network. What a published lesson changes on screen lives with the views that show it (see reviewState.ts).

import type { JobDetail } from '../api.ts';
import type { Access } from './access.ts';
import { lessonCards } from './lesson.ts';
import type { LessonCard } from './lesson.ts';
import { heldBackChecks } from './lessonJob.ts';
import { lessonPartKind, mostVisualFirst } from './partOrder.ts';
import { partWording } from './partWording.ts';
import type { WordingLine } from './partWording.ts';
import { REVISED_LABEL } from './repairStory.ts';
import type { ReviewState } from './reviewState.ts';

export * from './reviewState.ts';

// ---- what can be reviewed ------------------------------------------------------------------------------------------

/** ready: a finished lesson with a working part. building: still running. activity: a single-activity run. nothing: no part to review. */
export type ReviewAvailability = 'ready' | 'building' | 'activity' | 'nothing';

export function reviewAvailability(detail: JobDetail): ReviewAvailability {
  const data = detail.lessonData;
  if (data === undefined) return 'activity';
  if (detail.summary.status === 'running') return 'building';
  if (detail.summary.status !== 'succeeded') return 'nothing';
  const working = (data.lesson?.components ?? []).some((c) => c.status === 'passed') || data.hiddenParts.length > 0;
  return working ? 'ready' : 'nothing';
}

export interface ReviewRow {
  /** The part's component id: what the API and `review.json` call it. */
  id: string;
  /** The part's own title, else its kind. */
  title: string;
  /** The kind of part ("Quiz cards"). */
  label: string;
  /** "Checked against the page", "Checked, some items left out", plus the repair when there was one. */
  status: string;
  /** Muse revised it after a failed check and the revision passed. */
  repaired: boolean;
  /** Hidden from the published lesson. */
  hidden: boolean;
  /** What a student reads in this part (questions, steps, labels), for the teacher to read before ticking it. Stage 10c, M3. */
  wording: WordingLine[];
}

export interface ReviewHeld {
  id: string;
  title: string;
  label: string;
  /** The plain sentence: why it is not in the lesson. */
  sentence: string;
}

export interface ReviewModel {
  /** Working parts: the ones in the lesson (most visual first, as the lesson shows them), then the hidden ones. */
  parts: ReviewRow[];
  /** Parts the checks held back: read-only, not in the lesson. */
  held: ReviewHeld[];
  review: ReviewState | null;
}

const statusText = (card: Pick<LessonCard, 'note'>): string => (card.note === '' ? 'Checked against the page' : 'Checked, some items left out');

/**
 * The Review page's rows for one lesson. `review` defaults to the stored one; the page passes its own just after a
 * publish or unpublish so the rows are right before the lesson has been read again.
 */
export function reviewModel(detail: JobDetail, review: ReviewState | null = detail.lessonData?.review ?? null): ReviewModel {
  const data = detail.lessonData;
  if (data === undefined || data.lesson === null) return { parts: [], held: [], review };
  const hasPremium = detail.spec !== undefined;
  const hiddenIds = new Set(review?.hiddenParts ?? []);
  const shownCards = lessonCards(data.lesson, data.kitSpecs, hasPremium);
  const hiddenLesson = { ...data.lesson, components: data.hiddenParts.map((h) => h.entry) };
  const hiddenSpecs = Object.fromEntries(data.hiddenParts.flatMap((h) => (h.spec === null ? [] : [[h.entry.specId, h.spec] as const])));
  const hiddenCards = lessonCards(hiddenLesson, hiddenSpecs, hasPremium);
  const repair = (id: string): ReviewRow['repaired'] => data.componentRepairs.some((r) => r.componentId === id && r.passed);
  const repairNote = (id: string): string => {
    const r = data.componentRepairs.find((x) => x.componentId === id && x.passed);
    if (r === undefined) return '';
    return r.afterInjectedFault === true ? ' · Revised by Muse after a system-made demo fault' : ` · ${REVISED_LABEL}`;
  };
  const row = (card: LessonCard): ReviewRow => ({
    id: card.componentId, title: card.title, label: card.label, status: `${statusText(card)}${repairNote(card.componentId)}`,
    repaired: repair(card.componentId), hidden: hiddenIds.has(card.componentId),
    wording: partWording(card.spec, card.premium ? detail.spec ?? null : null),
  });
  const working = [...shownCards, ...hiddenCards].filter((c) => c.status === 'passed').map(row);
  const inLesson = mostVisualFirst(working.filter((r) => !r.hidden), (r) => lessonPartKind(r.id));
  const held = shownCards.filter((c) => c.status === 'failed').map((card): ReviewHeld => {
    const entry = data.lesson?.components.find((e) => `${e.componentId}:${e.specId}` === card.key);
    const hold = entry === undefined ? null : heldBackChecks(entry)?.find((h) => h.review === true);
    return { id: card.componentId, title: card.title, label: card.label, sentence: hold?.name ?? card.explain?.sentence ?? card.message };
  });
  return { parts: [...inLesson, ...working.filter((r) => r.hidden)], held, review };
}

/** The state line of a lesson that has not been published (the status under the lesson's title on the Review page). */
export const NOT_REVIEWED_LINE = 'Not reviewed yet';

// ---- the draft: ticks and hides, before publishing -----------------------------------------------------------------------

export interface ReviewDraft { checked: readonly string[]; hidden: readonly string[] }

export const EMPTY_DRAFT: ReviewDraft = Object.freeze({ checked: Object.freeze([] as string[]), hidden: Object.freeze([] as string[]) });

const flip = (list: readonly string[], id: string): string[] => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
export const toggleChecked = (d: ReviewDraft, id: string): ReviewDraft => ({ ...d, checked: flip(d.checked, id) });
export const toggleHidden = (d: ReviewDraft, id: string): ReviewDraft => ({ ...d, hidden: flip(d.hidden, id) });

export interface PublishReadiness {
  /** Parts that would stay in the lesson. */
  visible: number;
  /** Of those, how many are ticked as read. */
  ticked: number;
  canPublish: boolean;
  /** Why not: every part hidden ('nothing') or a part still to read ('unticked'). */
  why: 'nothing' | 'unticked' | null;
}

/** Publish unlocks when every part that stays in the lesson is ticked, and at least one stays. */
export function publishReadiness(parts: ReadonlyArray<{ id: string }>, draft: ReviewDraft): PublishReadiness {
  const visible = parts.filter((p) => !draft.hidden.includes(p.id));
  const ticked = visible.filter((p) => draft.checked.includes(p.id)).length;
  if (visible.length === 0) return { visible: 0, ticked: 0, canPublish: false, why: 'nothing' };
  return ticked === visible.length ? { visible: visible.length, ticked, canPublish: true, why: null } : { visible: visible.length, ticked, canPublish: false, why: 'unticked' };
}

export interface PublishBody { action: 'publish'; checkedParts: string[]; hiddenParts: string[] }

/** The API body: only this lesson's part ids, in the order the page lists them. */
export function publishBody(parts: ReadonlyArray<{ id: string }>, draft: ReviewDraft): PublishBody {
  const ids = parts.map((p) => p.id);
  return { action: 'publish', checkedParts: ids.filter((id) => draft.checked.includes(id)), hiddenParts: ids.filter((id) => draft.hidden.includes(id)) };
}

// Ticks survive going to the lesson to read a part ("Open") and coming back; they end on publish.
const drafts = new Map<string, ReviewDraft>();
export const getDraft = (jobId: string): ReviewDraft => drafts.get(jobId) ?? EMPTY_DRAFT;
export const setDraft = (jobId: string, draft: ReviewDraft): void => { drafts.set(jobId, draft); };
export const clearDraft = (jobId: string): void => { drafts.delete(jobId); };

// ---- who may publish ----------------------------------------------------------------------------------------------------

/**
 * open: publish and unpublish work (the gate is off, or a judge is signed in; an unreadable answer lets the server decide).
 * locked: read-only, with the access form. checking: the answer has not arrived. Publishing is free, so a spent build
 * budget or paused builds do not matter.
 */
export function reviewAccess(a: Access): 'open' | 'locked' | 'checking' {
  if (a.state === 'locked') return 'locked';
  return a.state === 'loading' ? 'checking' : 'open';
}

/** The sentence beside the access form on the Review page (the build wording does not fit). */
export const REVIEW_ACCESS_INTRO = 'Read-only for now: publishing is open to judges with an access code. Reading every part, opening it in the lesson, trying it and presenting it work without one.';

const MESSAGES: Readonly<Record<string, string>> = {
  ACCESS_REQUIRED: 'Publishing needs the judge access code. Everything else (browsing, replays, presenting) works without one.',
  REVIEW_INCOMPLETE: 'Tick every part you keep in the lesson before publishing.',
  NOTHING_TO_PUBLISH: 'Keep at least one part in the lesson. Hiding every part leaves nothing to publish.',
  NOT_REVIEWABLE: 'Only a finished lesson can be reviewed. This one is still being built or was not built.',
  NOT_FOUND: 'This lesson is no longer on the server.',
  BAD_REQUEST: 'The server did not understand that review. Reload the lesson and try again.',
  NETWORK: 'Cannot reach the API. Is it running on port 8787?',
  HOST_NOT_ALLOWED: 'The API refused this host. Open the app at http://127.0.0.1:5173.',
  ORIGIN_NOT_ALLOWED: 'The API refused this origin. Open the app at http://127.0.0.1:5173.',
  PAYLOAD_TOO_LARGE: 'The review was too large for the server.',
};

export function reviewErrorMessage(e: unknown): string {
  const code = typeof e === 'object' && e !== null ? (e as { code?: unknown }).code : undefined;
  return (typeof code === 'string' ? MESSAGES[code] : undefined) ?? 'The review could not be saved. Try again.';
}

// ---- hand-offs between views ----------------------------------------------------------------------------------------------

type Listener = (jobId: string) => void;
const listeners = new Set<Listener>();

/** Whoever shows a job's detail or the lessons list reloads when a review is published or removed. Returns the unsubscribe. */
export function subscribeReviewChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function notifyReviewChanged(jobId: string): void {
  for (const l of [...listeners]) l(jobId);
}

let focusRequest: string | null = null;
/** "Open" on the Review page: the lesson, once it is on screen, scrolls to this part (taken once). */
export function requestPartFocus(componentId: string): void { focusRequest = componentId; }
/** Looks without taking (an effect may run twice in development before its timer fires). */
export function peekPartFocus(): string | null { return focusRequest; }
export function takePartFocus(): string | null {
  const id = focusRequest;
  focusRequest = null;
  return id;
}
