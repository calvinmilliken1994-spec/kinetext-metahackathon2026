import { createContext } from 'react';
import type { PartCounts } from '../lib/partOrder.ts';

/**
 * Set B: the lesson's part counts (ready / held back), provided by LessonView to the provenance block it is handed, so the
 * one status line can say "Teacher review pending · 2 parts ready · 1 held back" without App wiring. Null while a build
 * is watched (the counts are still moving) and outside a lesson (classic activities).
 */
export const LessonPartsContext = createContext<PartCounts | null>(null);
