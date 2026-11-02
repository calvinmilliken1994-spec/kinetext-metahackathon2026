// Stage 10c Welcome v2 (docs/specs/STAGE-10c-first-launch-and-fixes.md section 1; Calvin 2 Nov: "a landing page with a
// little more OOMPH"). The Welcome's backdrop: the page's own sentences drifting behind everything, and the pinned demo
// run's figure as the centrepiece, where the boxes the models stored trace in part by part (Muse Spark located, SAM 3.1
// confirmed), the numbers land in page order, hold, fade and loop. Everything shown comes from the stored run and the
// stored page: no box is drawn by hand (Calvin's rule: glow boxes come from the models only). Pure: no React, no DOM.

import type { LabelDiagramSpec } from '../../../../packages/contracts/kit.ts';
import { DEMO_PINS } from './demoPins.ts';
import type { PctBox } from './labelDiagramView.ts';
import { markerSpots, MIN_REGION_CONFIDENCE, partViews, pixelBoxPct, regionDrawing } from './labelDiagramView.ts';
import { resolveJobModel } from './models.ts';
import { figureCredit } from './presentation.ts';

/** The run the Welcome shows: the plain-visit opening run, so the Welcome, the guide and the Demo show one lesson. */
export const WELCOME_FIGURE_JOB: string = DEMO_PINS.opening[0];

/** That run's page: its text still drifts behind the Welcome when the run itself cannot be loaded. */
export const WELCOME_SOURCE_ID = 'noaa-jetstream-hydrologic-cycle';

/** The slice of GET /api/jobs/:id (as api.job parses it) the Welcome reads. */
export interface WelcomeJob {
  summary: { jobId: string; sourceId: string; status: string; model?: string | undefined; provider?: string | undefined; providerModel?: string | undefined };
  lessonData?: {
    lesson: { components: ReadonlyArray<{ componentId: string; specId: string; status: string }> } | null;
    kitSpecs: Readonly<Record<string, { componentId: string }>>;
  } | null;
}

export interface WelcomePart {
  /** The number the lesson gives the part (page order, as the API serves it). */
  number: number;
  name: string;
  /** The page sentence the part was written from (it lights up in the backdrop). */
  quote: string;
  /** Percent of the figure: Muse's point for the part. */
  point: { left: number; top: number };
  /** The box that glows (labelDiagramView regionDrawing: SAM's box when sure, else Muse's), or null: no box at all. */
  glow: PctBox | null;
  /** The box Muse Spark's grounding call located, or null (older runs, or grounding found nothing for the part). */
  ground: PctBox | null;
  /** SAM 3.1's stored outline of the part (SVG path in figure pixels, see `viewBox`), or null when none was stored. */
  outline: string | null;
}

export interface WelcomeFigure {
  jobId: string;
  sourceId: string;
  figureId: string;
  /** width / height of the stored figure. */
  aspect: number;
  /** The figure's pixel grid ('0 0 W H'), for SAM's outlines. */
  viewBox: string;
  /** The figure's own caption, for the image's alt text. */
  caption: string;
  /** Credit line for the figure and its page. */
  credit: string;
  /** Printed labels on the figure (percent boxes): the numbers keep clear of them. */
  labelBoxes: PctBox[];
  parts: WelcomePart[];
  /** Caption segments, derived from the run: ["Recorded run", "Muse Spark 1.3 located 5 parts", "SAM 3.1 confirmed 5 of 5"]. */
  note: string[];
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/**
 * The centrepiece, or null when the run cannot show one (not loaded, unfinished, its diagram withheld or hidden, a
 * figure of unknown size, or no part with a model box): the Welcome then lays out without a figure.
 */
export function welcomeFigure(job: WelcomeJob | null): WelcomeFigure | null {
  if (job === null || job.summary.status !== 'succeeded') return null;
  const data = job.lessonData ?? null;
  if (data === null || data.lesson === null) return null;
  const entry = data.lesson.components.find((c) => c.componentId === 'label-diagram-v1' && c.status === 'passed');
  if (entry === undefined) return null;
  const raw = data.kitSpecs[entry.specId];
  if (raw === undefined || raw.componentId !== 'label-diagram-v1') return null;
  const spec = raw as unknown as LabelDiagramSpec;
  const fig = spec.figure;
  if (!Array.isArray(spec.parts) || !Array.isArray(spec.regions) || fig === undefined) return null;
  if (!(fig.width > 0) || !(fig.height > 0)) return null;

  const views = partViews(spec);
  const parts: WelcomePart[] = views.map((v) => ({
    number: v.number, name: v.name, quote: v.part.quote, point: v.point,
    glow: regionDrawing(v)?.box ?? null, ground: v.ground ?? null, outline: v.outline ?? null,
  }));
  if (!parts.some((p) => p.glow !== null)) return null;

  const located = parts.filter((p) => p.ground !== null).length;
  const confirmed = views.filter((v) => v.region !== null && (v.confidence === null || v.confidence >= MIN_REGION_CONFIDENCE)).length;
  const found = views.filter((v) => v.region !== null).length;
  const model = resolveJobModel(job.summary);
  const note = located > 0
    ? ['Recorded run', `${model.name} located ${plural(located, 'part', 'parts')}`, `SAM 3.1 confirmed ${confirmed} of ${parts.length}`]
    : ['Recorded run', `SAM 3.1 found ${found} of ${plural(parts.length, 'part', 'parts')}`];

  const labelBoxes = (fig.labelBoxes ?? []).map((b) => pixelBoxPct(b, fig)).filter((b): b is PctBox => b !== null);
  return {
    jobId: job.summary.jobId, sourceId: job.summary.sourceId, figureId: spec.figureId, aspect: fig.width / fig.height,
    viewBox: `0 0 ${fig.width} ${fig.height}`,
    caption: fig.caption.trim(), credit: figureCredit(fig), labelBoxes, parts, note,
  };
}

// ---- the page text behind everything ----------------------------------------------------------------------------------

export interface BackdropSentence {
  text: string;
  /** Index of the part (in `parts` order) whose quote this sentence is, or null. */
  cite: number | null;
}

const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();
const SENTENCE_END = /[.!?]["”’)]?$/;

/** The page's sentences: headings, figure captions, bullet lists and lines cut off before a list are left out. */
function pageSentences(text: string): string[] {
  const out: string[] = [];
  for (const para of text.replace(/\r\n?/g, '\n').split(/\n\s*\n/)) {
    const p = norm(para);
    if (p === '' || p.startsWith('#') || p.startsWith('•') || p.startsWith('- ') || p.startsWith('* ')) continue;
    for (const s of p.split(/(?<=[.!?]["”’)]?)\s+(?=["“‘(]?[A-Z])/)) {
      const t = s.trim();
      if (t.length >= 24 && SENTENCE_END.test(t)) out.push(t);
    }
  }
  return out;
}

/**
 * What the backdrop shows: the sentences each part was written from, then their neighbours on the page, taken evenly
 * round the cited ones until `budget` characters (a screenful); with no quotes, the page from the top. Page order, the
 * page's own words only; a quote not found in the page lights nothing.
 */
export function backdropSentences(text: string, quotes: readonly string[], budget: number): BackdropSentence[] {
  const all = pageSentences(text);
  if (all.length === 0) return [];
  const cite = new Map<number, number>();
  quotes.forEach((q, qi) => {
    const nq = norm(q);
    if (nq === '') return;
    const i = all.findIndex((s, si) => !cite.has(si) && (s.includes(nq) || nq.startsWith(s)));
    if (i >= 0) cite.set(i, qi);
  });
  const chosen = new Set<number>();
  let used = 0;
  const take = (i: number): boolean => {
    const cost = all[i]!.length + 1;
    if (used + cost > budget) return false;
    chosen.add(i);
    used += cost;
    return true;
  };
  if (cite.size === 0) {
    for (let i = 0; i < all.length && take(i); i++) { /* from the top until the budget */ }
  } else {
    for (const i of cite.keys()) { chosen.add(i); used += all[i]!.length + 1; }
    const open = [...cite.keys()].flatMap((c) => [{ c, dir: 1, k: 1, on: true }, { c, dir: -1, k: 1, on: true }]);
    while (open.some((o) => o.on)) {
      for (const o of open) {
        if (!o.on) continue;
        const i = o.c + o.dir * o.k;
        if (i < 0 || i >= all.length || chosen.has(i) || !take(i)) { o.on = false; continue; }
        o.k += 1;
      }
    }
  }
  return [...chosen].sort((a, b) => a - b).map((i) => ({ text: all[i]!, cite: cite.get(i) ?? null }));
}

// ---- the loop -------------------------------------------------------------------------------------------------------

/**
 * One loop of the centrepiece (styles/welcome.css keyframes are written as percentages of it). Each part runs the same
 * local timeline, started `welcomeStagger(n)` after the one before: Muse's box and the cited sentence at 5%, SAM's glow
 * from 13.5%, the number at 19%, hold, and gone by 73% (WELCOME_PART_SPAN_MS).
 */
export const WELCOME_CYCLE_MS = 14000;
/** One part's own timeline, from the loop start to its fade-out ending. */
export const WELCOME_PART_SPAN_MS = 10220;
/** Quiet time with only the dimmed figure before the loop starts again. */
export const WELCOME_END_GAP_MS = 800;
const MAX_STAGGER_MS = 650;

/** Delay between one part's start and the next, so the last part still fades out before the loop's quiet gap. */
export function welcomeStagger(n: number): number {
  if (n <= 1) return 0;
  return Math.min(MAX_STAGGER_MS, Math.floor((WELCOME_CYCLE_MS - WELCOME_END_GAP_MS - WELCOME_PART_SPAN_MS) / (n - 1)));
}

/** Where each number sits (percent of the figure): on its part's point, moved clear of the printed labels (lib markerSpots). */
export function welcomeMarkerSpots(f: Pick<WelcomeFigure, 'parts' | 'labelBoxes'>, width: number, height: number, marker: number): { left: number; top: number }[] {
  if (!(width > 0) || !(height > 0)) return f.parts.map((p) => p.point);
  const avoid = f.labelBoxes.map((b) => ({ x: (b.left * width) / 100, y: (b.top * height) / 100, w: (b.width * width) / 100, h: (b.height * height) / 100 }));
  const points = f.parts.map((p) => ({ x: (p.point.left * width) / 100, y: (p.point.top * height) / 100 }));
  return markerSpots({ width, height, marker, points, avoid }).map((p) => ({ left: (p.x * 100) / width, top: (p.y * 100) / height }));
}
