// Stage 10b slice R: the teacher review of one lesson, as the web app reads it (docs/specs/STAGE-10b-review-and-results.md).
// The API stores `review.json` (apps/api/review.ts) and GET /api/jobs/:id adds it as `review`. These are the small pure
// pieces every view shares: parsing, the date, and the wording that replaces "needs teacher review" for ONE published
// lesson. "AI-written" is never touched. No React, no DOM, no network; kept free of other lib imports so any lib file can use it.

export interface ReviewState {
  status: 'published';
  /** ISO time the teacher published the lesson. */
  publishedAt: string;
  /** Component ids the teacher hid from the lesson and the slides. */
  hiddenParts: string[];
  /** Component ids the teacher ticked as read. */
  checkedParts: string[];
}

const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

/** The wire `review`, or null when it is absent or not a published review (never a half-read one). */
export function parseReview(raw: unknown): ReviewState | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.status !== 'published' || typeof r.publishedAt !== 'string' || Number.isNaN(Date.parse(r.publishedAt))) return null;
  if (!isStrings(r.hiddenParts) || !isStrings(r.checkedParts)) return null;
  return { status: 'published', publishedAt: r.publishedAt, hiddenParts: [...r.hiddenParts], checkedParts: [...r.checkedParts] };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** "2 Nov 2026" in the teacher's own time zone (`utc` pins it for tests); empty for a time that does not parse. */
export function reviewDate(iso: string, utc = false): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return utc
    ? `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
    : `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** The lesson's status line once published, in place of "Teacher review pending". */
export function reviewedStatus(review: ReviewState, utc = false): string {
  const date = reviewDate(review.publishedAt, utc);
  return date === '' ? 'Reviewed by a teacher' : `Reviewed by a teacher · published ${date}`;
}

/** The per-part tag words that follow "AI-written ·". */
export const PART_PENDING_TAG = 'needs teacher review';
export const PART_REVIEWED_TAG = 'teacher-reviewed';

export function partReviewTag(review: ReviewState | null): string {
  return review === null ? PART_PENDING_TAG : PART_REVIEWED_TAG;
}

/**
 * The review a lesson object carries. The lesson built from a job detail gets `review` attached only when the lesson is
 * published, so views that are handed just the lesson (the lesson view, the slide deck) can say so without App wiring.
 */
export function reviewOfLesson(lesson: object | null | undefined): ReviewState | null {
  return parseReview((lesson as { review?: unknown } | null | undefined)?.review);
}
