// Welcome v3 (docs/specs/WELCOME-V3-split.md; Calvin 3 Nov: "page becomes lesson", "fast paced with jumps"). The right
// half of the Welcome: a fast montage over the published lessons, real stored runs only. Each beat is one lesson: a clean
// excerpt of its page with the one sentence a part was written from lit, then that part snapping out beside it as a
// small preview, then a hard cut to a lesson of another subject. This file holds the run list, the beat list (which
// lessons, which order, which part and sentence each), the captions and the timing. Pure: no React, no DOM, no network.
//
// The job ids live here and nowhere else in apps/web/src (config/pinned-runs.json must list them: apps/api pinned-runs test).

import { lessonPreviewParts } from './partPreview.ts';
import type { PartPreview, PreviewJob, PreviewKind, PreviewPart } from './partPreview.ts';
import { pageExcerpt } from './pageExcerpt.ts';
import type { PageExcerpt } from './pageExcerpt.ts';
import { resolveJobModel } from './models.ts';
import { subjectLabel, subjectOf } from './subjects.ts';
import type { SubjectKey } from './subjects.ts';

/** The published lessons the montage plays, volcano first (the spec's list; not the retired airplane page). */
export const MONTAGE_JOBS: readonly string[] = [
  'job-20261102050029-1ebd79c6', // volcano hazards (USGS)
  'job-20261101235049-c31ad262', // the water cycle (NOAA)
  'job-20261101211438-e741b91a', // what is DNA (MedlinePlus)
  'job-20261031154139-c6facfdb', // radioactive waste (NRC)
  'job-20261031152958-aa411e2f', // saving for education (CFPB)
  'job-20261031110323-8979fdcd', // branches of government (USA.gov)
  'job-20261031103341-bac931f2', // free fall (NASA Glenn)
  'job-20261031100603-3a2687b8', // phishing (FTC)
  'job-20261031094943-7234f176', // Voting Rights Act (National Archives)
];

/** The montage's standing label: these are recorded lessons, never a live build. */
export const MONTAGE_LABEL = 'From published lessons';

/** One beat (one lesson) and, inside it, when the part snaps out. CSS reads both (WelcomeMontage sets them as vars). */
export const BEAT_MS = 1800;
export const PART_AT_MS = 560;

export function nextBeat(i: number, n: number): number {
  return n <= 0 ? 0 : (i + 1) % n;
}

/**
 * The beat to show after `i`: the next one that can play (its figure has loaded), wrapping round; `i` itself when no
 * other can. A beat whose figure is still loading is passed over this time round, never waited on mid-montage.
 */
export function nextPlayable(i: number, playable: readonly boolean[]): number {
  const n = playable.length;
  for (let k = 1; k <= n; k++) {
    const j = (i + k) % n;
    if (playable[j] === true) return j;
  }
  return i;
}

/** Where a beat sits: the page on the start or end side, at one of three heights. Every cut changes at least one. */
export interface BeatFrame { side: 'start' | 'end'; drop: 0 | 1 | 2 }

export function beatFrame(i: number, n: number): BeatFrame {
  const side = i % 2 === 0 ? 'start' : 'end';
  let drop = (i % 3) as BeatFrame['drop'];
  // An odd count wraps start → start: make sure the height still jumps.
  if (n > 1 && i === n - 1 && side === 'start' && drop === 0) drop = 1;
  return { side, drop };
}

// ---- one lesson ---------------------------------------------------------------------------------------------------

/** The slice of GET /api/jobs/:id (as api.job parses it) the montage reads. */
export interface MontageJob extends PreviewJob {
  summary: { jobId: string; sourceId: string; status: string; model?: string | undefined; provider?: string | undefined; providerModel?: string | undefined };
  lessonData?: (NonNullable<PreviewJob['lessonData']> & { review?: { status: string } | null }) | null;
}

/** The slice of GET /api/sources/:id the montage reads. */
export interface MontageSource { title: string; text: string; subject?: unknown }

export interface MontageLesson {
  jobId: string;
  subject: SubjectKey;
  /** The model that wrote it ("Muse Spark 1.3"). */
  model: string;
  pageTitle: string;
  publisher: string;
  text: string;
  parts: PreviewPart[];
}

/** A published, finished lesson with its page and at least one part that has a preview; else null (skipped). */
export function montageLesson(job: MontageJob | null, source: MontageSource | null): MontageLesson | null {
  if (job === null || source === null || job.summary.status !== 'succeeded') return null;
  if (job.lessonData?.review?.status !== 'published') return null;
  if (typeof source.text !== 'string' || source.text.trim() === '') return null;
  const parts = lessonPreviewParts(job);
  if (parts.length === 0) return null;
  const [pageTitle = '', ...rest] = (source.title ?? '').split(/\s+[—–]\s+/);
  return {
    jobId: job.summary.jobId, subject: subjectOf(source), model: resolveJobModel(job.summary).name,
    pageTitle: pageTitle.trim(), publisher: rest.join(' — ').trim(), text: source.text, parts,
  };
}

// ---- the beat list -----------------------------------------------------------------------------------------------

export interface MontageBeat {
  jobId: string;
  subject: SubjectKey;
  pageTitle: string;
  publisher: string;
  excerpt: PageExcerpt;
  preview: PartPreview;
  /** Subject · model (· "SAM 3.1 outlined" for a figure with SAM's stored outlines). */
  caption: string[];
  frame: BeatFrame;
}

interface Choice { kind: PreviewKind; excerpt: PageExcerpt; preview: PartPreview }
interface Ready { lesson: MontageLesson; choices: Choice[] }

/** Each part's first option whose quote the page contains; parts with none are dropped. */
function choicesOf(l: MontageLesson): Choice[] {
  const out: Choice[] = [];
  for (const part of l.parts) {
    for (const o of part.options) {
      const excerpt = pageExcerpt(l.text, o.quote);
      if (excerpt !== null) { out.push({ kind: part.kind, excerpt, preview: o.preview }); break; }
    }
  }
  return out;
}

/** Figures can repeat (each is another figure); other kinds are not repeated while the lesson has an unused one. */
const REPEATS: ReadonlySet<PreviewKind> = new Set(['label-diagram']);

/**
 * The montage, one beat per lesson that can show one: opens on the first listed run (the volcano), then each next beat
 * is the first remaining lesson (in MONTAGE_JOBS order) of another subject and another leading part kind, falling back
 * to another subject, then to anything. Each lesson shows its most visual part, unless that kind already played and the
 * lesson has a kind that has not.
 */
export function montageBeats(lessons: readonly (MontageLesson | null)[]): MontageBeat[] {
  const rank = (id: string): number => { const i = MONTAGE_JOBS.indexOf(id); return i < 0 ? MONTAGE_JOBS.length : i; };
  const pool: Ready[] = lessons
    .filter((l): l is MontageLesson => l !== null)
    .map((lesson) => ({ lesson, choices: choicesOf(lesson) }))
    .filter((r) => r.choices.length > 0)
    .sort((a, b) => rank(a.lesson.jobId) - rank(b.lesson.jobId));

  const ordered: Ready[] = [];
  while (pool.length > 0) {
    const prev = ordered[ordered.length - 1];
    let at = 0;
    if (prev !== undefined) {
      const lead = prev.choices[0]!.kind;
      const both = pool.findIndex((r) => r.lesson.subject !== prev.lesson.subject && r.choices[0]!.kind !== lead);
      const subj = pool.findIndex((r) => r.lesson.subject !== prev.lesson.subject);
      at = both >= 0 ? both : subj >= 0 ? subj : 0;
    }
    ordered.push(pool.splice(at, 1)[0]!);
  }

  const used = new Set<PreviewKind>();
  return ordered.map((r, i): MontageBeat => {
    const pick = r.choices.find((c) => REPEATS.has(c.kind) || !used.has(c.kind)) ?? r.choices[0]!;
    used.add(pick.kind);
    const l = r.lesson;
    const sam = pick.preview.kind === 'label-diagram' && pick.preview.outlined ? ['SAM 3.1 outlined'] : [];
    // The sheet already shows the page title: a heading that repeats it is left out.
    const blocks = pick.excerpt.blocks.filter((b) => !(b.kind === 'heading' && b.pieces[0]?.text === l.pageTitle));
    return {
      jobId: l.jobId, subject: l.subject, pageTitle: l.pageTitle, publisher: l.publisher, excerpt: { ...pick.excerpt, blocks }, preview: pick.preview,
      caption: [subjectLabel(l.subject), l.model, ...sam], frame: beatFrame(i, ordered.length),
    };
  });
}
