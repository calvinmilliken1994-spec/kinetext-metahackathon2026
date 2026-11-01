// Stage 10b slice S (docs/specs/STAGE-10b-review-and-results.md, section S): the Results page's types, number formatting
// and chart shaping. Pure: the page (components/ResultsPage.tsx) and the data script (scripts/build-results.ts) share it,
// so the numbers on screen are formatted by the same code the tests compare with the pre-registered REPORT.md.

export type ModelId = 'muse-spark-1.3' | 'muse-spark-open';

/** A share k/n with its Wilson 95% interval (4 decimals, as in docs/evidence/final-eval/summary.json). */
export interface Rate { k: number; n: number; rate: number | null; ci95: [number | null, number | null] }

/** Where a number comes from: a committed file and the date it describes (ISO yyyy-mm-dd). */
export interface SourceRef { path: string; date: string; what: string }

/** One part type's path through checks for one model: planned = firstTry + repaired + failed. */
export interface EnginePath { id: string; label: string; planned: number; firstTry: number; repaired: number; failed: number }

export interface SubjectResult { id: string; label: string; jobs: number; lessons: Rate; parts: Rate }

export interface ModelResult {
  id: ModelId; label: string; route: string; providerModel: string | null;
  jobs: number;
  lessons: Rate; lessonsOfUsable: Rate; declined: Rate; failed: Rate;
  errorCodes: { code: string; count: number }[];
  parts: {
    planned: number; published: number; rate: Rate; perLesson: number; firstTry: Rate; naturalRepair: Rate;
    /** Parts that passed their checks inside jobs that later failed (counted as published by the report). */
    passedInFailedJobs: number;
  };
  analysisRepairs: number;
  wallS: { p50: number; p90: number; max: number };
  cost: { totalUSD: number; perLessonUSD: number; perPublishedPartUSD: number; failedPartsUSD: number };
  sam: { calls: number; usd: number };
  consistency: { pages: number; sameOutcome: Rate; samePlan: Rate; samePublishedCount: Rate };
  engines: EnginePath[];
  subjects: SubjectResult[];
}

export interface RetestSide { jobs: number; lessons: number; timeouts: number; partsPublished: number; partsPlanned: number; wallP50S: number; wallMaxS: number; costUSD: number }

export interface DiagramRun {
  jobId: string; date: string; stage: '8c' | '8d'; round: number;
  model: ModelId; modelLabel: string; sourceId: string; page: string;
  labelDiagram: 'published' | 'held-back';
  planned: number; published: number; wallS: number; costUSD: number;
  /** SAM 3.1 confidence over the figure's parts, only where a committed note states it. */
  sam: { min: number; max: number; scope: string; source: SourceRef } | null;
  note: { text: string; source: SourceRef } | null;
  source: SourceRef;
}

export interface ResultsData {
  version: 1;
  evaluation: {
    title: string; preRegisteredAt: string; reportGeneratedAt: string;
    pages: number; runsPerPage: number; jobsPerModel: number; promptVersion: string; maxRepairAttempts: number;
    subjects: number; figurePages: number; figuresGivenTo: ModelId;
    paired: { pages: number; sparkAhead: number; openAhead: number; tied: number };
    models: ModelResult[];
    sources: SourceRef[];
  };
  timeoutRetest: {
    title: string; date: string; preRegistered: false; pages: number; model: ModelId;
    before: RetestSide; after: RetestSide; slowestCallS: number;
    sources: SourceRef[];
  };
  diagramRuns: { runs: DiagramRun[]; sources: SourceRef[] };
}

// ---- numbers -------------------------------------------------------------------------------------------------------

/** Python's round() to an integer (ties to even), so percentages match the Python-written report digit for digit. */
export function pyRound(x: number): number {
  const f = Math.floor(x);
  const d = x - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

const round4 = (x: number): number => Number(x.toFixed(4));

/** Wilson score interval, 95%, rounded to 4 decimals like scripts/final-eval-report.py. */
export function wilson(k: number, n: number, z = 1.96): [number | null, number | null] {
  if (n === 0) return [null, null];
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [round4(Math.max(0, c - h)), round4(Math.min(1, c + h))];
}

export function rate(k: number, n: number): Rate {
  return { k, n, rate: n === 0 ? null : round4(k / n), ci95: wilson(k, n) };
}

const DASH = '–';

export function pct(x: number | null): string {
  return x === null ? DASH : `${pyRound(100 * x)}%`;
}

/** "97% (189/194)" */
export function rateText(r: Rate): string {
  return r.rate === null ? DASH : `${pct(r.rate)} (${r.k}/${r.n})`;
}

/** "94–99%" */
export function ciText(r: Rate): string {
  const [lo, hi] = r.ci95;
  return lo === null || hi === null ? DASH : `${pyRound(100 * lo)}–${pyRound(100 * hi)}%`;
}

/** The report's cell form, "97% (189/194) [94–99%]". */
export function reportCell(r: Rate): string {
  return r.rate === null ? 'n/a' : `${rateText(r)} [${ciText(r)}]`;
}

export function seconds(s: number): string {
  return `${pyRound(s)} s`;
}

export function usd(x: number, digits = 2): string {
  return `$${x.toFixed(digits)}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-10-31" → "31 Oct 2026" */
export function dateText(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (m === null) return iso;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}

/** Job ids carry their UTC start time: job-YYYYMMDDhhmmss-xxxxxxxx → "YYYY-MM-DD". */
export function dateFromJobId(jobId: string): string {
  const m = /^job-(\d{4})(\d{2})(\d{2})\d{6}-[0-9a-f]+$/.exec(jobId);
  if (m === null) throw new Error(`not a job id: ${jobId}`);
  return `${m[1]}-${m[2]}-${m[3]}`;
}

const ERROR_WORDS: Record<string, string> = {
  TIMEOUT: 'ran out of time',
  NETWORK_ERROR: 'connection dropped',
  ANALYSIS_INVALID: 'page reading failed its checks',
};

export function errorCodeText(code: string): string {
  return ERROR_WORDS[code] ?? code;
}

// ---- jobs.csv components column ---------------------------------------------------------------------------------------

export type PathCounts = Omit<EnginePath, 'id' | 'label'>;

const TOKEN = /^([a-z0-9-]+):(passed|failed)@r(\d+)$/;

/**
 * Tally the `components` cells of docs/evidence/final-eval/jobs.csv. Grammar (checked over all 388 rows): space-separated
 * `engine:passed@rN` or `engine:failed@rN`; an empty cell is a job with no planned parts. Passed at r1 = first try,
 * passed at r2+ = passed after repair.
 */
export function parseComponents(cells: readonly string[]): Map<string, PathCounts> {
  const out = new Map<string, PathCounts>();
  for (const cell of cells) {
    for (const tok of cell.split(/\s+/).filter((t) => t !== '')) {
      const m = TOKEN.exec(tok);
      if (m === null) throw new Error(`unexpected component token: ${tok}`);
      const c = out.get(m[1]!) ?? { planned: 0, firstTry: 0, repaired: 0, failed: 0 };
      c.planned += 1;
      if (m[2] === 'failed') c.failed += 1;
      else if (m[3] === '1') c.firstTry += 1;
      else c.repaired += 1;
      out.set(m[1]!, c);
    }
  }
  return out;
}

// ---- "What reaches the live lesson" -----------------------------------------------------------------------------------

export type SegmentKind = 'firstTry' | 'repaired' | 'failed';
export interface Segment { kind: SegmentKind; count: number; start: number; width: number }
export interface FunnelCell { model: ModelId | string; modelLabel: string; planned: number; firstTry: number; repaired: number; failed: number; published: number; segments: Segment[] }
export interface FunnelRow { id: string; label: string; byModel: FunnelCell[] }

export type FunnelSort = 'planned' | 'leftOut' | 'name';
export type FunnelScale = 'count' | 'share';

export const FUNNEL_SORTS: readonly { id: FunnelSort; label: string }[] = [
  { id: 'planned', label: 'Most planned' },
  { id: 'leftOut', label: 'Most left out' },
  { id: 'name', label: 'A to Z' },
];

export const SEGMENT_LABELS: Readonly<Record<SegmentKind, string>> = {
  firstTry: 'Passed its checks first try',
  repaired: 'Passed after a repair',
  failed: 'Left out (still failed after repair)',
};

interface FunnelModel { id: string; label: string; engines: readonly EnginePath[] }

/**
 * One row per part type that either model planned, with both models' paths in model order. Bars are percentages of
 * the widest planned count (count scale, so a row's length shows how often the type was chosen) or of the row's own
 * planned count (share scale). Default order is the report's: most planned over both models.
 */
export function funnelRows(models: readonly FunnelModel[], sort: FunnelSort, scale: FunnelScale): FunnelRow[] {
  const ids: string[] = [];
  const labels = new Map<string, string>();
  for (const m of models) for (const e of m.engines) { if (!labels.has(e.id)) { ids.push(e.id); labels.set(e.id, e.label); } }
  const max = Math.max(1, ...models.flatMap((m) => m.engines.map((e) => e.planned)));
  const rows: FunnelRow[] = ids.map((id) => ({
    id,
    label: labels.get(id)!,
    byModel: models.map((m) => {
      const e = m.engines.find((x) => x.id === id) ?? { planned: 0, firstTry: 0, repaired: 0, failed: 0 };
      const denom = scale === 'count' ? max : Math.max(1, e.planned);
      let start = 0;
      const segments = (['firstTry', 'repaired', 'failed'] as const).map((kind) => {
        const width = (e[kind] / denom) * 100;
        const s = { kind, count: e[kind], start, width };
        start += width;
        return s;
      });
      return { model: m.id, modelLabel: m.label, planned: e.planned, firstTry: e.firstTry, repaired: e.repaired, failed: e.failed, published: e.firstTry + e.repaired, segments };
    }),
  }));
  const planned = (r: FunnelRow) => r.byModel.reduce((a, c) => a + c.planned, 0);
  const leftOut = (r: FunnelRow) => r.byModel.reduce((a, c) => a + c.failed, 0) / Math.max(1, planned(r));
  const byName = (a: FunnelRow, b: FunnelRow) => a.label.localeCompare(b.label, 'en');
  const stable = (a: FunnelRow, b: FunnelRow) => ids.indexOf(a.id) - ids.indexOf(b.id);
  if (sort === 'name') return rows.sort(byName);
  if (sort === 'leftOut') return rows.sort((a, b) => leftOut(b) - leftOut(a) || planned(b) - planned(a) || stable(a, b));
  return rows.sort((a, b) => planned(b) - planned(a) || stable(a, b));
}

// ---- pass rate by subject -------------------------------------------------------------------------------------------

export interface SubjectRow { id: string; label: string; byModel: { model: string; modelLabel: string; jobs: number; lessons: Rate; parts: Rate }[] }

/** Subjects in the first model's order (the report's alphabetical order), each with every model's result. */
export function subjectRows(models: readonly Pick<ModelResult, 'id' | 'label' | 'subjects'>[]): SubjectRow[] {
  const first = models[0];
  if (first === undefined) return [];
  return first.subjects.map((s) => ({
    id: s.id,
    label: s.label,
    byModel: models.map((m) => {
      const x = m.subjects.find((y) => y.id === s.id);
      const none = rate(0, 0);
      return { model: m.id, modelLabel: m.label, jobs: x?.jobs ?? 0, lessons: x?.lessons ?? none, parts: x?.parts ?? none };
    }),
  }));
}

/** The subject dot plot's axis: 40% to 100% (every subject's interval starts above 40%; the page says so). */
export const PLOT_DOMAIN: readonly [number, number] = [0.4, 1];
export const PLOT_TICKS: readonly number[] = [0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];

/** Position (0–100, % of the plot width) of a share on the dot-plot axis, clamped to the axis. */
export function plotPosition(x: number | null): number | null {
  if (x === null) return null;
  const [lo, hi] = PLOT_DOMAIN;
  const t = (Math.min(hi, Math.max(lo, x)) - lo) / (hi - lo);
  return Math.round(t * 1e6) / 1e4;
}

// ---- diagram runs ---------------------------------------------------------------------------------------------------

export interface DiagramSummary { model: ModelId; modelLabel: string; runs: number; published: number; latestAllPublished: boolean; figures: number }

/** Per model: how many runs, how many published their diagram, and whether the latest run of every figure did. */
export function diagramSummary(runs: readonly DiagramRun[]): DiagramSummary[] {
  const models: ModelId[] = [];
  for (const r of runs) if (!models.includes(r.model)) models.push(r.model);
  return models.map((model) => {
    const mine = runs.filter((r) => r.model === model);
    const latest = new Map<string, DiagramRun>();
    for (const r of mine) {
      const prev = latest.get(r.sourceId);
      if (prev === undefined || r.jobId > prev.jobId) latest.set(r.sourceId, r);
    }
    return {
      model,
      modelLabel: mine[0]!.modelLabel,
      runs: mine.length,
      published: mine.filter((r) => r.labelDiagram === 'published').length,
      latestAllPublished: [...latest.values()].every((r) => r.labelDiagram === 'published'),
      figures: latest.size,
    };
  });
}

/** Whether a recorded run can be opened here: the server's job list decides (stored runs are not in Git). */
export function lessonLink(jobId: string, jobs: readonly { jobId: string }[] | null): 'open' | 'missing' | 'unknown' {
  if (jobs === null) return 'unknown';
  return jobs.some((j) => j.jobId === jobId) ? 'open' : 'missing';
}
