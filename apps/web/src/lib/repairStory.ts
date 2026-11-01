// Set B (repair story), pure: a repaired lesson part told as four short steps a teacher can read without the transcript:
// Check found an issue → Revised by Muse → Rechecked → Published (or withheld). For a label-diagram repair it also gives
// the stored BEFORE (failed revision) and AFTER point positions, so the view can draw them on the real figure as dots and
// arrows. Only positions are used: the failed revision's names and text are never shown. Check ids and validator text
// stay out of these sentences (they live behind the technical-details toggle).

/** One stored revision of a part, as `GET /api/jobs/:id` sends it in `componentHistory[componentId]`. */
export interface HistoryPoint { id: string; x: number; y: number }
export interface HistoryEntry {
  revision: number;
  publishable: boolean;
  failedChecks: string[];
  /** label-diagram-v1 only: each part's point on the 0..1000 grid. */
  labelPoints?: HistoryPoint[];
}

/** The figure of a published label diagram: pixel size and the stored printed-label boxes (image pixels, x2/y2 exclusive). */
export interface StoryFigure {
  id: string;
  width: number;
  height: number;
  labelBoxes: ReadonlyArray<{ x1: number; y1: number; x2: number; y2: number }>;
}

export interface StoryInput {
  /** The part's kind in words ("Label the diagram"). */
  label: string;
  origin: 'natural' | 'system';
  state: 'passed' | 'still-failing' | 'running';
  /** The latest repair attempt number (1 = revised once). */
  attempts: number;
  /** The checks the FIRST version failed, with plain names. */
  targeted: ReadonlyArray<{ id: string; name: string }>;
  history: readonly HistoryEntry[];
  figure: StoryFigure | null;
  /** The latest revision's checks: how many pass of how many, and whether the no-loosening guard passed (null: not run). */
  finalChecks: { passed: number; total: number; noWeakening: boolean | null } | null;
}

export type StepTone = 'bad' | 'ok' | 'neutral' | 'pending' | 'fault';
export interface StoryStep { key: 'found' | 'revised' | 'rechecked' | 'published'; title: string; sentence: string; tone: StepTone }
export interface StoryMove { from: { x: number; y: number }; to: { x: number; y: number } }
export interface StoryView { x: number; y: number; w: number; h: number }

export interface RepairStory {
  heading: string;
  steps: StoryStep[];
  /** Points that moved between the failed revision and the latest one (0..1000 grid); [] when not a diagram. */
  moves: StoryMove[];
  /** The crop of the figure (0..1000 grid) that holds every move, or null when there is nothing to draw. */
  view: StoryView | null;
  figureId: string | null;
  /** The figure's width / height (1 when there is no figure), so a crop is drawn undistorted. */
  figureAspect: number;
  /** Who caused the first failure, in one sentence (never omitted). */
  originNote: string;
}

export const REVISED_LABEL = 'Revised by Muse after a failed check';
// Calvin's rule: a natural repair is "Revised by Muse after a failed check"; never call it Muse's mistake.
const NATURAL_ORIGIN = 'Found in Muse’s draft by the checks; not a planted test fault.';
const SYSTEM_ORIGIN = 'The first version carried a fault the system planted on purpose to show the repair; it is not a model error.';

const times = (n: number): string => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`);
const nPoints = (n: number): string => `${n} ${n === 1 ? 'point' : 'points'}`;

function quoteList(names: readonly string[]): string {
  const q = names.map((n) => `“${n}”`);
  if (q.length <= 1) return q[0] ?? '';
  return `${q.slice(0, -1).join(', ')} and ${q[q.length - 1] as string}`;
}

/** How many stored points fall inside one of the figure's printed-label boxes (points 0..1000, boxes in image pixels). */
export function pointsOnLabels(points: readonly HistoryPoint[], figure: StoryFigure): number {
  if (!(figure.width > 0) || !(figure.height > 0)) return 0;
  return points.filter((p) => {
    const px = (p.x * figure.width) / 1000;
    const py = (p.y * figure.height) / 1000;
    return figure.labelBoxes.some((b) => px >= b.x1 && px < b.x2 && py >= b.y1 && py < b.y2);
  }).length;
}

const MOVE_MIN = 3;

/** Points (matched by part id) that moved by more than a few grid units between two revisions. */
export function pointMoves(before: readonly HistoryPoint[], after: readonly HistoryPoint[]): StoryMove[] {
  const out: StoryMove[] = [];
  for (const b of before) {
    const a = after.find((p) => p.id === b.id);
    if (a === undefined) continue;
    if (Math.hypot(a.x - b.x, a.y - b.y) <= MOVE_MIN) continue;
    out.push({ from: { x: b.x, y: b.y }, to: { x: a.x, y: a.y } });
  }
  return out;
}

/**
 * A crop of the 0..1000 figure that holds every move with room around it (at least `min` units wide and tall). With a
 * figure, any printed label the crop touches is taken in whole, so no label is cut ("…irs" of "Base pairs").
 */
export function storyView(moves: readonly StoryMove[], pad = 120, min = 340, figure: StoryFigure | null = null): StoryView | null {
  const base = cropOf(moves, pad, min);
  if (base === null || figure === null || !(figure.width > 0) || !(figure.height > 0)) return base;
  const boxes = figure.labelBoxes.map((b) => ({
    x1: (b.x1 * 1000) / figure.width, x2: (b.x2 * 1000) / figure.width, y1: (b.y1 * 1000) / figure.height, y2: (b.y2 * 1000) / figure.height,
  }));
  let { x, y, w, h } = base;
  for (let round = 0; round < 4; round += 1) { // taking a label in can touch another one
    let x1 = x; let y1 = y; let x2 = x + w; let y2 = y + h;
    for (const b of boxes) {
      const touches = b.x1 < x + w && b.x2 > x && b.y1 < y + h && b.y2 > y;
      if (!touches) continue;
      x1 = Math.min(x1, b.x1 - 8); y1 = Math.min(y1, b.y1 - 8); x2 = Math.max(x2, b.x2 + 8); y2 = Math.max(y2, b.y2 + 8);
    }
    const next = { x: Math.max(0, Math.floor(x1)), y: Math.max(0, Math.floor(y1)), w: 0, h: 0 };
    next.w = Math.min(1000, Math.ceil(x2)) - next.x;
    next.h = Math.min(1000, Math.ceil(y2)) - next.y;
    if (next.x === x && next.y === y && next.w === w && next.h === h) break;
    ({ x, y, w, h } = next);
  }
  return { x, y, w, h };
}

function cropOf(moves: readonly StoryMove[], pad: number, min: number): StoryView | null {
  if (moves.length === 0) return null;
  const xs = moves.flatMap((m) => [m.from.x, m.to.x]);
  const ys = moves.flatMap((m) => [m.from.y, m.to.y]);
  const fit = (lo: number, hi: number): [number, number] => {
    let a = lo - pad;
    let b = hi + pad;
    if (b - a < min) { const c = (a + b) / 2; a = c - min / 2; b = c + min / 2; }
    if (a < 0) { b -= a; a = 0; }
    if (b > 1000) { a -= b - 1000; b = 1000; }
    return [Math.max(0, Math.round(a)), Math.min(1000, Math.round(b))];
  };
  const [x1, x2] = fit(Math.min(...xs), Math.max(...xs));
  const [y1, y2] = fit(Math.min(...ys), Math.max(...ys));
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

const withPoints = (h: HistoryEntry): h is HistoryEntry & { labelPoints: HistoryPoint[] } => Array.isArray(h.labelPoints) && h.labelPoints.length > 0;

export function repairStory(input: StoryInput): RepairStory {
  const history = [...input.history].sort((a, b) => a.revision - b.revision);
  const firstFailed = history.find((h) => !h.publishable);
  const latest = history[history.length - 1];
  const system = input.origin === 'system';

  // the diagram's points: the failed revision against the latest one (positions only)
  let moves: StoryMove[] = [];
  let onLabels = 0;
  let pointTotal = 0;
  if (firstFailed !== undefined && latest !== undefined && latest !== firstFailed && withPoints(firstFailed) && withPoints(latest)) {
    moves = pointMoves(firstFailed.labelPoints, latest.labelPoints);
    if (input.figure !== null && firstFailed.failedChecks.includes('LD-04')) {
      onLabels = pointsOnLabels(firstFailed.labelPoints, input.figure);
      pointTotal = firstFailed.labelPoints.length;
    }
  }

  const names = input.targeted.map((c) => c.name);
  const found = system
    ? 'The check caught the fault the system planted in the first version.'
    : onLabels > 0
      ? `${onLabels} of ${nPoints(pointTotal)} sat on the figure’s printed labels, not on the parts they name.`
      : names.length === 0
        ? 'A check did not pass on Muse’s first version.'
        : names.length === 1
          ? `The check ${quoteList(names)} did not pass on Muse’s first version.`
          : `${names.length} checks did not pass on Muse’s first version: ${quoteList(names)}.`;

  const running = input.state === 'running';
  const tries = input.attempts > 1 ? ` (${input.attempts} tries)` : '';
  const revised = running
    ? 'Muse is revising the part now.'
    : moves.length > 0
      ? `Muse moved ${nPoints(moves.length)} onto the parts they mark${tries}.`
      : `Muse got the failed check back and rewrote the part${tries}.`;

  const fc = input.finalChecks;
  const rechecked: StoryStep = running
    ? { key: 'rechecked', title: 'Rechecked', sentence: 'Waiting for the revised part.', tone: 'pending' }
    : input.state === 'passed'
      ? {
        key: 'rechecked', title: 'Rechecked', tone: 'ok',
        sentence: `${fc === null ? 'Every check passes' : `All ${fc.total} checks pass`}${fc?.noWeakening === true ? ', and no check was loosened to get there' : ''}.`,
      }
      : { key: 'rechecked', title: 'Rechecked', tone: 'bad', sentence: fc === null ? 'The revision still fails a check.' : `${fc.total - fc.passed} of ${fc.total} checks still fail.` };

  const published: StoryStep = running
    ? { key: 'published', title: 'Published', sentence: 'Not yet.', tone: 'pending' }
    : input.state === 'passed'
      ? { key: 'published', title: 'Published', sentence: 'The revised part is the one in this lesson.', tone: 'ok' }
      : { key: 'published', title: 'Withheld', sentence: 'The revision did not pass, so this part is left out of the lesson.', tone: 'bad' };

  const heading = system
    ? `${input.label} · planted fault, revised by Muse`
    : `${input.label} · revised ${times(Math.max(1, input.attempts))} by Muse`;

  return {
    heading,
    steps: [
      { key: 'found', title: 'Check found an issue', sentence: found, tone: system ? 'fault' : 'bad' },
      { key: 'revised', title: 'Revised by Muse', sentence: revised, tone: running ? 'pending' : 'neutral' },
      rechecked,
      published,
    ],
    moves,
    view: input.figure === null ? null : storyView(moves, 120, 340, input.figure),
    figureId: input.figure?.id ?? null,
    figureAspect: input.figure !== null && input.figure.height > 0 ? input.figure.width / input.figure.height : 1,
    originNote: system ? SYSTEM_ORIGIN : NATURAL_ORIGIN,
  };
}
