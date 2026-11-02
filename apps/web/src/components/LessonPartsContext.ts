import { createContext } from 'react';
import type { PartCounts } from '../lib/partOrder.ts';
import type { ReviewState } from '../lib/reviewState.ts';

/**
 * Set B: the lesson's part counts (ready / held back), provided by LessonView to the provenance block it is handed, so the
 * one status line can say "Needs review · 2 parts ready · 1 held back" without App wiring. Null while a build
 * is watched (the counts are still moving) and outside a lesson (classic activities).
 */
export const LessonPartsContext = createContext<PartCounts | null>(null);

/**
 * Stage 10b: the teacher's published review of the lesson on screen (null until published). LessonView and presentation
 * mode provide it; the status line and each part's tag read it, so "needs teacher review" becomes "teacher-reviewed" for
 * that one lesson without App wiring.
 */
export const LessonReviewContext = createContext<ReviewState | null>(null);
