// Stage 10b slice S: builds apps/web/src/data/results.json for the Results page from COMMITTED evidence only.
//   node scripts/build-results.ts          writes the JSON
//   tests/results-data.test.ts             checks the committed JSON equals this script's output, and REPORT.md totals
// Inputs (never storage/, which is not in Git):
//   docs/evidence/final-eval/{summary.json, jobs.csv, manifest.json, PREREGISTRATION.md, REPORT.md, results-muse-spark-open.jsonl}
//   docs/evidence/timeout-retest/{results.jsonl, plan.json, README.md}
//   docs/evidence/stage-8c/live/results*.jsonl, docs/evidence/stage-8d/live/results*.jsonl (+ README), the Stage 8c spec
// Deterministic: no clock, no randomness; the output depends only on those files.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  parseComponents, dateFromJobId,
  type DiagramRun, type EnginePath, type ModelId, type ModelResult, type Rate, type ResultsData, type RetestSide, type SourceRef,
} from '../apps/web/src/lib/results.ts';

const FE = 'docs/evidence/final-eval';
const RT = 'docs/evidence/timeout-retest';
const S8C = 'docs/evidence/stage-8c/live';
const S8D = 'docs/evidence/stage-8d/live';
const S8C_SPEC = 'docs/specs/STAGE-8c-label-coverage-and-outlines.md';
export const OUT_PATH = 'apps/web/src/data/results.json';

const MODEL_LABEL: Record<ModelId, string> = { 'muse-spark-1.3': 'Muse Spark 1.3', 'muse-spark-open': 'Muse Spark Open' };
const MODEL_ROUTE: Record<ModelId, string> = { 'muse-spark-1.3': 'Meta Model API', 'muse-spark-open': 'Open weights on Modal' };
const MODELS: ModelId[] = ['muse-spark-1.3', 'muse-spark-open'];

// Labels exactly as scripts/final-eval-report.py writes them into REPORT.md.
const SUBJECT_LABEL: Record<string, string> = {
  physics: 'Physics', chemistry: 'Chemistry', biology: 'Biology', 'earth-science': 'Earth & space', maths: 'Maths',
  computing: 'Computing & AI', finance: 'Finance', civics: 'Civics', history: 'History',
};
const ENGINE_LABEL: Record<string, string> = {
  'quiz-cards-v1': 'Quiz cards', 'sequence-v1': 'Sequence', 'sort-groups-v1': 'Sort', 'concept-map-v1': 'Concept map',
  'compare-table-v1': 'Compare table', 'formula-explorer-v1': 'Formula explorer', 'balance-equation-v1': 'Balance equation',
  'algorithm-trace-v1': 'Algorithm tracer', 'log-ladder-v1': 'Log-scale ladder', 'threshold-v1': 'Vote threshold',
  'data-table-v1': 'Data table', 'label-diagram-v1': 'Label the diagram', 'timeline-v1': 'Timeline',
  'forces-1d-v1': 'Forces sim', 'speed-of-sound-v1': 'Speed of sound sim', 'projectile-v1': 'Projectile sim', 'lift-equation-v1': 'Lift sim',
  'half-life-v1': 'Half-life sim', 'hardy-weinberg-v1': 'Hardy-Weinberg sim', 'compound-interest-v1': 'Compound interest sim',
};

/**
 * Facts about single diagram runs that the results lines do not carry (SAM confidence, why a diagram was held back),
 * each quoted from a committed note. The test checks that every quoted range occurs in the cited file.
 */
const DIAGRAM_NOTES: Record<string, { sam?: { min: number; max: number; scope: string }; note?: string; path: string; date: string; what: string }> = {
  'job-20261101211438-e741b91a': {
    sam: { min: 0.78, max: 0.92, scope: 'all 6 parts' }, note: 'Spark Open located all 6 parts and SAM 3.1 confirmed each one.',
    path: `${S8D}/README.md`, date: '2026-11-01', what: 'Stage 8d live-run notes',
  },
  'job-20261101211438-87fa1e93': {
    note: 'Held back: SAM’s retry kept a runoff region that covered the whole landscape, and the agreement check caught it. Fixed in the next round.',
    path: `${S8D}/README.md`, date: '2026-11-01', what: 'Stage 8d live-run notes',
  },
  'job-20261101212123-3e4734fe': {
    sam: { min: 0.61, max: 0.88, scope: 'all 5 parts' },
    path: `${S8D}/README.md`, date: '2026-11-01', what: 'Stage 8d live-run notes',
  },
  'job-20261101194027-0082b239': {
    sam: { min: 0.59, max: 0.95, scope: 'every part on both figures this round' },
    note: 'Held back: the runoff number sat beside the stream, not on it. From the next round each number is placed on the part the models located.',
    path: S8C_SPEC, date: '2026-11-02', what: 'Stage 8c spec, Addendum B (live round 3)',
  },
  'job-20261101194027-4b4aec38': {
    sam: { min: 0.59, max: 0.95, scope: 'every part on both figures this round' },
    note: 'Held back: the guanine and cytosine numbers sat on the printed words. From the next round each number is placed on the part the models located.',
    path: S8C_SPEC, date: '2026-11-02', what: 'Stage 8c spec, Addendum B (live round 3)',
  },
};

function makeReader(root: URL) {
  return (path: string): string => readFileSync(new URL(path, root), 'utf8');
}

const lines = (text: string): string[] => text.split(/\r?\n/).filter((l) => l.trim() !== '');

function csvRows(text: string): Record<string, string>[] {
  const [head, ...rest] = lines(text);
  if (head === undefined) return [];
  const cols = head.split(',');
  return rest.map((l) => {
    const cells = l.split(',');
    if (cells.length !== cols.length) throw new Error(`jobs.csv: ${cells.length} cells, expected ${cols.length}`);
    return Object.fromEntries(cols.map((c, i) => [c, cells[i]!]));
  });
}

interface SummaryRate { k: number; n: number; rate: number | null; ci95: [number | null, number | null] }
const asRate = (r: SummaryRate): Rate => ({ k: r.k, n: r.n, rate: r.rate, ci95: [r.ci95[0], r.ci95[1]] });

interface DriverLine { sourceId: string; model: ModelId; run: number; jobId: string; status: string; wallS: number; costUSD: number; planned: number; published: number; components: string[] }

function retestSide(rows: readonly DriverLine[], timeouts: number): RetestSide {
  const walls = rows.map((r) => r.wallS).sort((a, b) => a - b);
  const mid = walls.length / 2;
  const p50 = walls.length % 2 === 0 ? (walls[mid - 1]! + walls[mid]!) / 2 : walls[Math.floor(mid)]!;
  const ok = rows.filter((r) => r.status === 'succeeded');
  return {
    jobs: rows.length,
    lessons: ok.filter((r) => r.published > 0).length,
    timeouts,
    partsPublished: ok.reduce((a, r) => a + r.published, 0),
    partsPlanned: rows.reduce((a, r) => a + r.planned, 0),
    wallP50S: p50,
    wallMaxS: walls[walls.length - 1] ?? 0,
    costUSD: Number(rows.reduce((a, r) => a + r.costUSD, 0).toFixed(6)),
  };
}

const shortTitle = (title: string): string => title.split(' — ')[0]!.trim();

export function buildResults(root: URL): ResultsData {
  const read = makeReader(root);
  const summary = JSON.parse(read(`${FE}/summary.json`));
  const manifest = JSON.parse(read(`${FE}/manifest.json`));
  const prereg = read(`${FE}/PREREGISTRATION.md`);
  const jobs = csvRows(read(`${FE}/jobs.csv`));
  const evalDate: string = manifest.preRegisteredAt;
  if (!/Spark Open jobs get no figures/.test(prereg)) throw new Error('PREREGISTRATION.md no longer states the figure rule');

  const models: ModelResult[] = MODELS.map((id) => {
    const s = summary.models[id];
    const o = s.overall;
    const rows = jobs.filter((j) => j.model === id);
    const paths = parseComponents(rows.map((r) => r.components!));
    // The csv must tell the same story as the summary, part type by part type.
    for (const [eng, c] of paths) {
      const se = s.engines[eng];
      if (se === undefined || se.planned !== c.planned || se.published !== c.firstTry + c.repaired) throw new Error(`${id} ${eng}: jobs.csv and summary.json disagree`);
    }
    const tally = [...paths.values()].reduce((a, c) => ({ firstTry: a.firstTry + c.firstTry, repaired: a.repaired + c.repaired, failed: a.failed + c.failed }), { firstTry: 0, repaired: 0, failed: 0 });
    if (tally.firstTry !== o.outcomePaths.firstTry || tally.repaired !== o.outcomePaths.repaired || tally.failed !== o.outcomePaths.failed) throw new Error(`${id}: outcome paths disagree`);
    const totalPlanned = (eng: string) => MODELS.reduce((a, m) => a + (summary.models[m].engines[eng]?.planned ?? 0), 0);
    const engines: EnginePath[] = [...paths.entries()]
      .map(([eng, c]) => ({ id: eng, label: ENGINE_LABEL[eng] ?? eng, ...c }))
      .sort((a, b) => totalPlanned(b.id) - totalPlanned(a.id) || a.label.localeCompare(b.label, 'en'));
    const passedInFailedJobs = parseComponents(rows.filter((r) => r.status !== 'succeeded').map((r) => r.components!));
    const subjects = Object.keys(s.bySubject)
      .map((sub) => ({ id: sub, label: SUBJECT_LABEL[sub] ?? sub, jobs: s.bySubject[sub].jobs as number, lessons: asRate(s.bySubject[sub].lessonWithPart), parts: asRate(s.bySubject[sub].partsRate) }))
      .sort((a, b) => a.label.localeCompare(b.label, 'en'));
    const providerModel = (manifest.models as { model: string; providerModel?: string }[]).find((m) => m.model === id)?.providerModel ?? null;
    return {
      id, label: MODEL_LABEL[id], route: MODEL_ROUTE[id], providerModel,
      jobs: o.jobs,
      lessons: asRate(o.lessonWithPart), lessonsOfUsable: asRate(o.lessonWithPartOfUsable), declined: asRate(o.declined), failed: asRate(o.failed),
      errorCodes: Object.entries(o.errorCodes as Record<string, number>).map(([code, count]) => ({ code, count })),
      parts: {
        planned: o.partsPlanned, published: o.partsPublished, rate: asRate(o.partsRate), perLesson: o.publishedPerJob,
        firstTry: asRate(o.firstTry), naturalRepair: asRate(o.naturalRepair),
        passedInFailedJobs: [...passedInFailedJobs.values()].reduce((a, c) => a + c.firstTry + c.repaired, 0),
      },
      analysisRepairs: o.analysisRepairs,
      wallS: { p50: o.wallS.p50, p90: o.wallS.p90, max: o.wallS.max },
      cost: { totalUSD: o.costUSD, perLessonUSD: o.costPerJob, perPublishedPartUSD: o.costPerPublishedPart, failedPartsUSD: o.failedPartCostUSD },
      sam: { calls: o.sam.calls, usd: o.sam.usd },
      consistency: {
        pages: s.consistency.pages, sameOutcome: asRate(s.consistency.sameOutcome), samePlan: asRate(s.consistency.samePlan),
        samePublishedCount: asRate(s.consistency.samePublishedCount),
      },
      engines,
      subjects,
    };
  });

  // ---- timeout retest (not pre-registered) ----
  const plan = JSON.parse(read(`${RT}/plan.json`)) as { sourceId: string }[];
  const retestPages = new Set(plan.map((p) => p.sourceId));
  const after = lines(read(`${RT}/results.jsonl`)).map((l) => JSON.parse(l) as DriverLine);
  const beforeLines = lines(read(`${FE}/results-muse-spark-open.jsonl`)).map((l) => JSON.parse(l) as DriverLine).filter((r) => retestPages.has(r.sourceId));
  const beforeTimeouts = jobs.filter((j) => j.model === 'muse-spark-open' && retestPages.has(j.sourceId!) && j.errorCode === 'TIMEOUT').length;
  const afterTimeouts = after.filter((r) => (r as unknown as { failureCode: string | null }).failureCode === 'TIMEOUT').length;
  const retestReadme = read(`${RT}/README.md`);
  const slowest = /The slowest was ([\d.]+) s/.exec(retestReadme);
  if (slowest === null) throw new Error('timeout-retest README: slowest call not found');

  // ---- diagram runs ----
  const diagramFiles = [
    ...['results.jsonl', 'results-r2.jsonl', 'results-r3.jsonl', 'results-r4.jsonl', 'results-r5.jsonl'].map((f) => ({ path: `${S8C}/${f}`, stage: '8c' as const })),
    ...['results.jsonl', 'results-r2.jsonl'].map((f) => ({ path: `${S8D}/${f}`, stage: '8d' as const })),
  ];
  const diagramSources: SourceRef[] = [];
  const runs: DiagramRun[] = [];
  for (const f of diagramFiles) {
    const rows = lines(read(f.path)).map((l) => JSON.parse(l) as DriverLine);
    const date = dateFromJobId(rows[0]!.jobId);
    diagramSources.push({ path: f.path, date, what: `Stage ${f.stage} live runs, round ${rows[0]!.run}` });
    for (const r of rows) {
      const ld = r.components.find((c) => c.startsWith('label-diagram-v1:'));
      if (ld === undefined) throw new Error(`${r.jobId}: no Label the diagram part`);
      const meta = JSON.parse(read(`data/sources/${r.sourceId}.json`)) as { title: string };
      const n = DIAGRAM_NOTES[r.jobId];
      const ref = n === undefined ? null : { path: n.path, date: n.date, what: n.what };
      runs.push({
        jobId: r.jobId, date: dateFromJobId(r.jobId), stage: f.stage, round: r.run,
        model: r.model, modelLabel: MODEL_LABEL[r.model], sourceId: r.sourceId, page: shortTitle(meta.title),
        labelDiagram: ld.endsWith(':passed') ? 'published' : 'held-back',
        planned: r.planned, published: r.published, wallS: r.wallS, costUSD: r.costUSD,
        sam: n?.sam === undefined || ref === null ? null : { ...n.sam, source: ref },
        note: n?.note === undefined || ref === null ? null : { text: n.note, source: ref },
        source: { path: f.path, date: dateFromJobId(r.jobId), what: `Stage ${f.stage} live runs, round ${r.run}` },
      });
    }
  }
  runs.sort((a, b) => (a.jobId < b.jobId ? 1 : a.jobId > b.jobId ? -1 : 0));
  diagramSources.push(
    { path: `${S8D}/README.md`, date: '2026-11-01', what: 'Stage 8d notes: SAM confidence and why a diagram was held back' },
    { path: S8C_SPEC, date: '2026-11-02', what: 'Stage 8c spec, Addendum B: SAM confidence in round 3' },
  );

  return {
    version: 1,
    evaluation: {
      title: 'Final evaluation', preRegisteredAt: evalDate, reportGeneratedAt: summary.generatedAt,
      pages: manifest.pages.length, runsPerPage: manifest.runsPerPage, jobsPerModel: models[0]!.jobs,
      promptVersion: manifest.promptVersion, maxRepairAttempts: manifest.maxRepairAttempts,
      subjects: new Set((manifest.pages as { subject: string }[]).map((p) => p.subject)).size,
      figurePages: manifest.pagesWithFigures.length, figuresGivenTo: 'muse-spark-1.3',
      paired: { pages: summary.paired.pages, sparkAhead: summary.paired.sparkAhead, openAhead: summary.paired.openAhead, tied: summary.paired.tied },
      models,
      sources: [
        { path: `${FE}/PREREGISTRATION.md`, date: evalDate, what: 'Measures, pages and models, committed before the first job' },
        { path: `${FE}/manifest.json`, date: evalDate, what: 'The 97 pages with their hashes, both models, prompt version' },
        { path: `${FE}/summary.json`, date: evalDate, what: 'Every rate, interval, time and cost on this page' },
        { path: `${FE}/jobs.csv`, date: evalDate, what: 'One row per job; each part’s result and revision' },
        { path: `${FE}/REPORT.md`, date: evalDate, what: 'The written report these numbers are checked against' },
      ],
    },
    timeoutRetest: {
      title: 'Spark Open timeout retest', date: dateFromJobId(after[0]!.jobId), preRegistered: false,
      pages: retestPages.size, model: 'muse-spark-open',
      before: retestSide(beforeLines, beforeTimeouts), after: retestSide(after, afterTimeouts),
      slowestCallS: Number(slowest[1]),
      sources: [
        { path: `${RT}/README.md`, date: '2026-10-31', what: 'Why it was run, and an honest reading of the result' },
        { path: `${RT}/plan.json`, date: '2026-10-31', what: 'The 9 pages × 2 runs' },
        { path: `${RT}/results.jsonl`, date: '2026-10-31', what: 'One line per retest job' },
        { path: `${FE}/results-muse-spark-open.jsonl`, date: evalDate, what: 'The same pages in the evaluation, for the before column' },
      ],
    },
    diagramRuns: { runs, sources: diagramSources },
  };
}

export function serialise(data: ResultsData): string {
  return `${JSON.stringify(data, null, 2)}\n`;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = new URL('../', import.meta.url);
  mkdirSync(new URL('./', new URL(OUT_PATH, root)), { recursive: true });
  writeFileSync(new URL(OUT_PATH, root), serialise(buildResults(root)));
  console.log(`wrote ${OUT_PATH}`);
}
