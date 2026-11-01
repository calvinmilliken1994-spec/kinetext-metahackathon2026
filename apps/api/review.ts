// Stage 10b slice R: teacher review and publish (docs/specs/STAGE-10b-review-and-results.md, section R).
//
// Storage: `<storageDir>/runs/<jobId>/review.json` = { status: 'published', publishedAt: ISO, hiddenParts: string[],
// checkedParts: string[] } (part ids are lesson component ids). No file means not reviewed. A rebuild is a new job
// directory, so it starts unreviewed. The file is written atomically (temp file in the same directory, then rename), and
// a damaged or unrecognised file reads as "not reviewed": a half-written review never shows a lesson as published.
//
// Pure helpers (no HTTP, no clock): the server wires them to POST /api/jobs/:id/review.

import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface ReviewRecord {
  status: 'published';
  publishedAt: string;
  hiddenParts: string[];
  checkedParts: string[];
}

/** A publish request is two short id lists; anything bigger is refused before it is parsed (413). */
export const MAX_REVIEW_BODY_BYTES = 4 * 1024;

const JOB_ID = /^[a-z0-9-]{1,80}$/;

/** Where a job's review lives. The id must be a bare job id (the caller has already validated it). */
export function reviewFilePath(storageDir: string, jobId: string): string {
  if (!JOB_ID.test(jobId)) throw new Error('JOB_ID_INVALID');
  return join(storageDir, 'runs', jobId, 'review.json');
}

const isStringList = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string');

/** The stored review, or null when there is none or the file is damaged or not a published review. */
export function readReview(storageDir: string, jobId: string): ReviewRecord | null {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(reviewFilePath(storageDir, jobId), 'utf8')) as unknown;
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r['status'] !== 'published' || typeof r['publishedAt'] !== 'string' || Number.isNaN(Date.parse(r['publishedAt']))) return null;
  if (!isStringList(r['hiddenParts']) || !isStringList(r['checkedParts'])) return null;
  return { status: 'published', publishedAt: r['publishedAt'], hiddenParts: r['hiddenParts'], checkedParts: r['checkedParts'] };
}

/** Atomic write: the temp file sits beside review.json, so the rename stays on one volume. */
export function writeReview(storageDir: string, jobId: string, review: ReviewRecord): void {
  const target = reviewFilePath(storageDir, jobId);
  const temp = `${target}.${process.pid}.tmp`;
  try {
    writeFileSync(temp, `${JSON.stringify(review, null, 2)}\n`, 'utf8');
    renameSync(temp, target);
  } catch (err: unknown) {
    rmSync(temp, { force: true });
    throw err;
  }
}

/** Unpublish: delete the file (nothing to do when there is none). */
export function deleteReview(storageDir: string, jobId: string): void {
  const target = reviewFilePath(storageDir, jobId);
  if (existsSync(target)) rmSync(target, { force: true });
}

/**
 * The ids a teacher can review: every part that passed when the lesson was built and still passes today (the
 * detail route marks parts that today's re-check or a human review withheld with `recheck.publishable: false`; those
 * are not in the lesson, so they are not reviewable). Call after recheckLesson and applyContentHolds.
 */
export function publishedPartIds(job: { lesson?: unknown }): string[] {
  const lesson = job.lesson as { components?: unknown } | null | undefined;
  if (lesson === null || lesson === undefined || !Array.isArray(lesson.components)) return [];
  const out: string[] = [];
  for (const c of lesson.components as Array<{ componentId?: unknown; status?: unknown; recheck?: { publishable?: unknown } }>) {
    if (typeof c?.componentId !== 'string' || c.status !== 'passed') continue;
    if (c.recheck?.publishable === false) continue;
    if (!out.includes(c.componentId)) out.push(c.componentId);
  }
  return out;
}

export type PublishCheck =
  | { ok: true; value: { checkedParts: string[]; hiddenParts: string[] } }
  | { ok: false; status: 400; code: 'BAD_REQUEST' | 'REVIEW_INCOMPLETE' | 'NOTHING_TO_PUBLISH' };

const bad = (code: 'BAD_REQUEST' | 'REVIEW_INCOMPLETE' | 'NOTHING_TO_PUBLISH'): PublishCheck => ({ ok: false, status: 400, code });

/**
 * Validate a `{ action: 'publish', checkedParts, hiddenParts }` body against the lesson's published part ids.
 * Shapes and unknown ids are BAD_REQUEST; then at least one part must stay visible (NOTHING_TO_PUBLISH); then every
 * visible part must be ticked (REVIEW_INCOMPLETE). Both lists come back deduplicated, in the lesson's order.
 */
export function validatePublishBody(body: unknown, published: readonly string[]): PublishCheck {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return bad('BAD_REQUEST');
  const b = body as Record<string, unknown>;
  if (b['action'] !== 'publish' || !isStringList(b['checkedParts']) || !isStringList(b['hiddenParts'])) return bad('BAD_REQUEST');
  const known = new Set(published);
  if (![...b['checkedParts'], ...b['hiddenParts']].every(id => known.has(id))) return bad('BAD_REQUEST');
  const checked = new Set(b['checkedParts']);
  const hidden = new Set(b['hiddenParts']);
  const visible = published.filter(id => !hidden.has(id));
  if (visible.length === 0) return bad('NOTHING_TO_PUBLISH');
  if (!visible.every(id => checked.has(id))) return bad('REVIEW_INCOMPLETE');
  return {
    ok: true,
    value: { checkedParts: published.filter(id => checked.has(id)), hiddenParts: published.filter(id => hidden.has(id)) },
  };
}
