// TASK-023b: pure evaluation-metrics module (no I/O). Consumed by scripts/evaluation-report.ts
// and tested by tests/evaluation-metrics.test.ts. Classifies one results.jsonl line per evaluation
// page against its manifest expectation and aggregates honest rates, repair, cost and timing stats.
//
// Outcome classes:
//   correct-first-try   published revision 1 with the expected (or acceptable) engine
//   correct-after-repair published revision > 1 with the expected (or acceptable) engine
//   correct-decline     unsupported while decline was expected or acceptable
//   wrong-engine        published with an engine outside expected/acceptable
//   wrong-decline       declined a page whose expectation is an engine and decline is not acceptable
//   false-accept        published a page whose expectation is decline
//   failed              the job ended in an error status (error code recorded)
//   not-applicable      S6R-12: a lesson-flow page that published its overview (+ kit components)
//                       WITHOUT a premium engine: the legacy engine-class decision does not apply,
//                       so it is excluded from the accuracy denominator (never 'unknown')
//   unknown             anything else (interrupted, malformed line) — never counted as correct

export type Subject = 'physics' | 'finance' | 'chemistry-earth' | 'biology' | 'history';
export type Difficulty = 'easy' | 'medium' | 'hard';

export interface ManifestEntry {
  sourceId: string;
  candidate: number;
  subject: Subject;
  expected: string; // engine id or 'decline'
  acceptable: string[]; // other acceptable outcomes ('decline' or a second engine id)
  difficulty: Difficulty;
  note?: string;
}

export interface RepairSummary {
  revision?: number;
  targeted?: string[];
  fixed?: string[];
  remaining?: string[];
}

/** One analysis-stage repair attempt (TASK-024b), as recorded by scripts/evaluation-run.ts. */
export interface AnalysisRepairSummary {
  attempt?: number | null;
  revision?: number | null;
  targeted?: string[];
  fixed?: string[];
  remaining?: string[];
  passed?: boolean;
}

/** S6R-12: one lesson-flow COMPONENT repair attempt (BUG-006 driver field `componentRepairs`). */
export interface ComponentRepairSummary {
  componentId?: string | null;
  attempt?: number | null;
  revision?: number | null;
  targeted?: string[];
  fixed?: string[];
  remaining?: string[];
  passed?: boolean;
  /** S6R-11: true when the component's baseline carried a system-injected demo fault (never a natural repair). */
  afterInjectedFault?: boolean;
}

/** One JSON line of docs/evidence/stage-5b/evaluation/results.jsonl. */
export interface EvalResultLine {
  sourceId: string;
  candidate?: number;
  subject?: Subject;
  expected?: string;
  acceptable?: string[];
  difficulty?: Difficulty;
  jobId?: string | null;
  /** OW-2: the model/provider the job actually ran on; absent on pre-OW-2 records. */
  model?: string | null;
  provider?: string | null;
  /** S6-W: the flow the job ran ('lesson' | 'activity'); absent on pre-Stage-6 records. */
  flow?: string | null;
  /** S6-W: lesson-flow component counts; null on activity-flow records. */
  componentsPlanned?: number | null;
  componentsPublished?: number | null;
  componentsFailed?: number | null;
  /** S6-W: whether the page got an overview / at least one interactive component; partial publish. */
  overviewPublished?: boolean | null;
  interactivePublished?: boolean | null;
  partialPublish?: boolean | null;
  /** S6-W: the v2 decline code for a declined lesson page; null otherwise. */
  declineCode?: string | null;
  status?: string | null;
  engine?: string | null;
  publishedRevision?: number | null;
  revisions?: number | null;
  repairs?: RepairSummary[] | null;
  /** TASK-024b (additive): absent on records written before analysis repair existed. */
  analysisRepairs?: AnalysisRepairSummary[] | null;
  /** S6R-12: lesson-flow component repairs; absent on lesson records written before BUG-006 (= not recorded, never 0). */
  componentRepairs?: ComponentRepairSummary[] | null;
  failedChecks?: string[] | null;
  firstRevisionFailedChecks?: string[] | null;
  error?: string | null;
  unsupportedReason?: string | null;
  totalCostUSD?: number | null;
  wallS?: number | null;
  at?: string | null;
}

export type OutcomeClass =
  | 'correct-first-try' | 'correct-after-repair' | 'correct-decline'
  | 'wrong-engine' | 'wrong-decline' | 'false-accept' | 'failed' | 'not-applicable' | 'unknown';

export const OUTCOME_CLASSES: readonly OutcomeClass[] = [
  'correct-first-try', 'correct-after-repair', 'correct-decline',
  'wrong-engine', 'wrong-decline', 'false-accept', 'failed', 'not-applicable', 'unknown',
] as const;

export interface ClassCounts {
  'correct-first-try': number; 'correct-after-repair': number; 'correct-decline': number;
  'wrong-engine': number; 'wrong-decline': number; 'false-accept': number; failed: number;
  /** S6R-12: kit-only lesson outcomes — the engine-class decision does not apply. */
  'not-applicable': number;
  unknown: number;
}

export interface GroupMetrics {
  total: number;
  byClass: ClassCounts;
  /** (correct-first-try + correct-after-repair + correct-decline) / (total − not-applicable); null when that is 0. */
  accuracyRate: number | null;
}

export interface PageOutcome {
  sourceId: string;
  candidate?: number;
  subject?: string;
  difficulty?: string;
  expected?: string;
  class: OutcomeClass;
  engine?: string | null;
  publishedRevision?: number | null;
  revisions?: number | null;
  status?: string | null;
  error?: string | null;
  totalCostUSD?: number | null;
  wallS?: number | null;
}

/**
 * S6-W: lesson-flow metrics over the results lines that recorded flow 'lesson' (pure).
 * Rates are over lesson jobs only; counts are the recorded per-job component numbers
 * (null counts contribute 0 to totals but the job still counts in the rate denominators).
 * Demo-fault jobs never reach an evaluation run (the driver submits no faults), so no
 * fault exclusion is needed here; a line without the lesson fields counts as no overview.
 */
export interface LessonMetricsSummary {
  lessonJobs: number;
  declined: number;
  failed: number;
  overviewPublished: number;
  /** overviewPublished / lessonJobs; null when there are no lesson jobs. */
  overviewRate: number | null;
  interactivePublished: number;
  /** interactivePublished / lessonJobs; null when there are no lesson jobs. */
  interactiveRate: number | null;
  componentsPlanned: number;
  componentsPublished: number;
  componentsFailed: number;
  partialPublishJobs: number;
  declinesByCode: Record<string, number>;
}

export function computeLessonMetrics(results: readonly EvalResultLine[]): LessonMetricsSummary {
  const lines = results.filter(r => r.flow === 'lesson');
  const out: LessonMetricsSummary = {
    lessonJobs: lines.length,
    declined: 0,
    failed: 0,
    overviewPublished: 0,
    overviewRate: null,
    interactivePublished: 0,
    interactiveRate: null,
    componentsPlanned: 0,
    componentsPublished: 0,
    componentsFailed: 0,
    partialPublishJobs: 0,
    declinesByCode: {},
  };
  for (const r of lines) {
    if (r.status === 'unsupported') {
      out.declined += 1;
      const code = typeof r.declineCode === 'string' && r.declineCode !== '' ? r.declineCode : 'unknown';
      out.declinesByCode[code] = (out.declinesByCode[code] ?? 0) + 1;
    }
    if (r.status === 'failed') out.failed += 1;
    if (r.overviewPublished === true) out.overviewPublished += 1;
    if (r.interactivePublished === true) out.interactivePublished += 1;
    if (r.partialPublish === true) out.partialPublishJobs += 1;
    out.componentsPlanned += typeof r.componentsPlanned === 'number' ? r.componentsPlanned : 0;
    out.componentsPublished += typeof r.componentsPublished === 'number' ? r.componentsPublished : 0;
    out.componentsFailed += typeof r.componentsFailed === 'number' ? r.componentsFailed : 0;
  }
  out.overviewRate = rate(out.overviewPublished, out.lessonJobs);
  out.interactiveRate = rate(out.interactivePublished, out.lessonJobs);
  return out;
}

/** S6R-12: cost per job over one named publication denominator (mean/max null when there are no such jobs). */
export interface CostStat {
  jobs: number;
  meanUSD: number | null;
  maxUSD: number | null;
}

export interface MetricsSummary {
  total: number;
  byClass: ClassCounts;
  /** Correct decisions over the engine-class-applicable lines (S6R-12: kit-only lessons excluded). */
  accuracyRate: number | null;
  /** S6R-12: lines the engine-class decision applies to (total − not-applicable). */
  engineClassApplicable: number;
  bySubject: Record<string, GroupMetrics>;
  byDifficulty: Record<string, GroupMetrics>;
  /** S6-W: lesson-flow metrics over the flow==='lesson' lines (lessonJobs 0 when none). */
  lesson: LessonMetricsSummary;
  repairs: {
    total: number;
    jobsWithRepairs: number;
    /** TASK-024b: analysis-stage repair attempts (included in `total`). */
    analysisTotal: number;
    /** TASK-024b: jobs with at least one analysis repair (included in `jobsWithRepairs`). */
    jobsWithAnalysisRepairs: number;
    /** S6R-12: natural lesson COMPONENT repair attempts (included in `total`). */
    componentTotal: number;
    /** S6R-12: jobs with at least one natural component repair (included in `jobsWithRepairs`). */
    jobsWithComponentRepairs: number;
    /** S6R-12: component repairs after a system-injected demo fault — excluded from every natural count. */
    componentAfterInjectedFault: number;
    /** S6R-12: lesson-flow lines recorded before componentRepairs existed — their component repairs are unknown, not 0. */
    componentRepairsNotRecorded: number;
    /** How many repair attempts targeted each check id (component repairs as `<componentId>:<checkId>`). */
    byTargetedCheck: Record<string, number>;
    /** In how many jobs each check id failed on revision 1 (the natural trigger). */
    byFirstRevisionCheck: Record<string, number>;
  };
  cost: {
    /** Activity flow: a published activity revision. Lesson flow (S6R-12): the overview was published. */
    publishedLessons: number;
    meanPerPublishedUSD: number | null;
    maxPerPublishedUSD: number | null;
    totalUSD: number;
    /** S6R-12: lesson-flow lines only, by separately named publication denominator. */
    lesson: { overview: CostStat; interactive: CostStat; premium: CostStat };
  };
  timing: { meanWallS: number | null };
  pages: PageOutcome[];
}

/** S6R-12: frozen lesson semantics — a lesson is published when its overview is (succeeded ⇔ overview published). */
function lessonOverviewPublished(r: EvalResultLine): boolean {
  return typeof r.overviewPublished === 'boolean' ? r.overviewPublished : r.status === 'succeeded';
}

export function classifyResult(r: EvalResultLine): OutcomeClass {
  const expected = r.expected ?? 'decline';
  const acceptable = r.acceptable ?? [];
  if (r.status === 'failed' || (r.error != null && r.error !== '')) return 'failed';
  if (r.status === 'unsupported') {
    return expected === 'decline' || acceptable.includes('decline') ? 'correct-decline' : 'wrong-decline';
  }
  // S6R-12: a lesson that published its overview (+ kit components) but no premium engine is
  // outside the legacy engine-class decision — labelled not applicable, never 'unknown'.
  if (r.flow === 'lesson' && r.status === 'succeeded' && r.publishedRevision == null && lessonOverviewPublished(r)) {
    return 'not-applicable';
  }
  if (r.status === 'succeeded' && r.engine != null && r.publishedRevision != null) {
    // TASK-024b: an analysis repair counts as a repair too — a job that published
    // revision 1 only after its analysis was repaired is correct-after-repair.
    const repaired = r.publishedRevision > 1 || (r.analysisRepairs ?? []).length > 0;
    if (expected === 'decline') {
      return acceptable.includes(r.engine) ? (repaired ? 'correct-after-repair' : 'correct-first-try') : 'false-accept';
    }
    if (r.engine === expected || acceptable.includes(r.engine)) {
      return repaired ? 'correct-after-repair' : 'correct-first-try';
    }
    return 'wrong-engine';
  }
  return 'unknown';
}

export function parseResultsJsonl(text: string): EvalResultLine[] {
  const out: EvalResultLine[] = [];
  for (const raw of text.split('\n')) {
    const l = raw.trim();
    if (l === '') continue;
    out.push(JSON.parse(l) as EvalResultLine);
  }
  return out;
}

function emptyCounts(): ClassCounts {
  return {
    'correct-first-try': 0, 'correct-after-repair': 0, 'correct-decline': 0,
    'wrong-engine': 0, 'wrong-decline': 0, 'false-accept': 0, failed: 0, 'not-applicable': 0, unknown: 0,
  };
}

/** S6R-12: correct decisions over the engine-class-applicable lines; null when none apply. */
function accuracyOf(total: number, byClass: ClassCounts): number | null {
  const applicable = total - byClass['not-applicable'];
  const correct = byClass['correct-first-try'] + byClass['correct-after-repair'] + byClass['correct-decline'];
  return applicable <= 0 ? null : correct / applicable;
}

function finishGroup(total: number, byClass: ClassCounts): GroupMetrics {
  return { total, byClass, accuracyRate: accuracyOf(total, byClass) };
}

interface CostAcc { jobs: number; sum: number; max: number | null }
const emptyCostAcc = (): CostAcc => ({ jobs: 0, sum: 0, max: null });
function addCost(acc: CostAcc, cost: number): void {
  acc.jobs += 1;
  acc.sum += cost;
  if (acc.max === null || cost > acc.max) acc.max = cost;
}
function costStat(acc: CostAcc): CostStat {
  return { jobs: acc.jobs, meanUSD: acc.jobs === 0 ? null : Math.round((acc.sum / acc.jobs) * 1e6) / 1e6, maxUSD: acc.max };
}

function rate(n: number, d: number): number | null {
  return d === 0 ? null : Math.round((n / d) * 1e6) / 1e6;
}

export function computeMetrics(results: EvalResultLine[], manifest: ManifestEntry[]): MetricsSummary {
  const bySource = new Map(manifest.map(m => [m.sourceId, m]));
  const total = results.length;
  const byClass = emptyCounts();
  const subjectTotals = new Map<string, number>();
  const subjectCounts = new Map<string, ClassCounts>();
  const diffTotals = new Map<string, number>();
  const diffCounts = new Map<string, ClassCounts>();
  const pages: PageOutcome[] = [];

  let repairsTotal = 0;
  let jobsWithRepairs = 0;
  let analysisRepairsTotal = 0;
  let jobsWithAnalysisRepairs = 0;
  let componentRepairsTotal = 0;
  let jobsWithComponentRepairs = 0;
  let componentAfterInjectedFault = 0;
  let componentRepairsNotRecorded = 0;
  const byTargetedCheck: Record<string, number> = {};
  const byFirstRevisionCheck: Record<string, number> = {};

  let publishedLessons = 0;
  let publishedCostSum = 0;
  let publishedCostMax: number | null = null;
  let costSum = 0;
  const lessonCost = { overview: emptyCostAcc(), interactive: emptyCostAcc(), premium: emptyCostAcc() };
  let wallSum = 0;
  let wallN = 0;

  for (const r of results) {
    const m = bySource.get(r.sourceId);
    const cls = classifyResult(r);
    byClass[cls] += 1;
    const subject = r.subject ?? m?.subject;
    const difficulty = r.difficulty ?? m?.difficulty;
    if (subject) {
      subjectTotals.set(subject, (subjectTotals.get(subject) ?? 0) + 1);
      const c = subjectCounts.get(subject) ?? emptyCounts();
      c[cls] += 1;
      subjectCounts.set(subject, c);
    }
    if (difficulty) {
      diffTotals.set(difficulty, (diffTotals.get(difficulty) ?? 0) + 1);
      const c = diffCounts.get(difficulty) ?? emptyCounts();
      c[cls] += 1;
      diffCounts.set(difficulty, c);
    }
    pages.push({
      sourceId: r.sourceId, candidate: r.candidate ?? m?.candidate, subject, difficulty,
      expected: r.expected ?? m?.expected, class: cls, engine: r.engine ?? null,
      publishedRevision: r.publishedRevision ?? null, revisions: r.revisions ?? null,
      status: r.status ?? null, error: r.error ?? null,
      totalCostUSD: r.totalCostUSD ?? null, wallS: r.wallS ?? null,
    });

    const repairs = r.repairs ?? [];
    // TASK-024b: analysis-stage repairs are natural repairs too (old records simply have none).
    const analysisRepairs = r.analysisRepairs ?? [];
    // S6R-12: lesson COMPONENT repairs are natural repairs too, unless they ran against a
    // system-injected demo fault. A lesson line without the field predates its recording:
    // counted as "not recorded", never as zero repairs.
    if (r.flow === 'lesson' && !Array.isArray(r.componentRepairs)) componentRepairsNotRecorded += 1;
    const allComponentRepairs = Array.isArray(r.componentRepairs) ? r.componentRepairs : [];
    const componentRepairs = allComponentRepairs.filter(c => c?.afterInjectedFault !== true);
    componentAfterInjectedFault += allComponentRepairs.length - componentRepairs.length;
    if (repairs.length > 0 || analysisRepairs.length > 0 || componentRepairs.length > 0) jobsWithRepairs += 1;
    repairsTotal += repairs.length + analysisRepairs.length + componentRepairs.length;
    if (analysisRepairs.length > 0) jobsWithAnalysisRepairs += 1;
    analysisRepairsTotal += analysisRepairs.length;
    if (componentRepairs.length > 0) jobsWithComponentRepairs += 1;
    componentRepairsTotal += componentRepairs.length;
    for (const rep of repairs) {
      for (const id of rep.targeted ?? []) byTargetedCheck[id] = (byTargetedCheck[id] ?? 0) + 1;
    }
    for (const rep of analysisRepairs) {
      for (const id of rep.targeted ?? []) byTargetedCheck[id] = (byTargetedCheck[id] ?? 0) + 1;
    }
    for (const rep of componentRepairs) {
      const scope = typeof rep.componentId === 'string' && rep.componentId !== '' ? rep.componentId : 'unknown-component';
      for (const id of rep.targeted ?? []) {
        const key = `${scope}:${id}`;
        byTargetedCheck[key] = (byTargetedCheck[key] ?? 0) + 1;
      }
    }
    for (const id of r.firstRevisionFailedChecks ?? []) byFirstRevisionCheck[id] = (byFirstRevisionCheck[id] ?? 0) + 1;

    const cost = typeof r.totalCostUSD === 'number' ? r.totalCostUSD : 0;
    costSum += cost;
    // S6R-12: activity flow publishes a revision; lesson flow publishes its overview (frozen
    // lesson semantics), with the overview / interactive / premium denominators kept apart.
    const isLesson = r.flow === 'lesson';
    const published = isLesson ? lessonOverviewPublished(r) : r.publishedRevision != null;
    if (published) {
      publishedLessons += 1;
      publishedCostSum += cost;
      if (publishedCostMax === null || cost > publishedCostMax) publishedCostMax = cost;
    }
    if (isLesson) {
      if (lessonOverviewPublished(r)) addCost(lessonCost.overview, cost);
      if (r.interactivePublished === true) addCost(lessonCost.interactive, cost);
      if (r.publishedRevision != null) addCost(lessonCost.premium, cost);
    }
    if (typeof r.wallS === 'number') { wallSum += r.wallS; wallN += 1; }
  }

  const bySubject: Record<string, GroupMetrics> = {};
  for (const [s, t] of subjectTotals) bySubject[s] = finishGroup(t, subjectCounts.get(s) ?? emptyCounts());
  const byDifficulty: Record<string, GroupMetrics> = {};
  for (const [d, t] of diffTotals) byDifficulty[d] = finishGroup(t, diffCounts.get(d) ?? emptyCounts());

  return {
    total,
    byClass,
    accuracyRate: accuracyOf(total, byClass),
    engineClassApplicable: total - byClass['not-applicable'],
    bySubject,
    byDifficulty,
    lesson: computeLessonMetrics(results),
    repairs: {
      total: repairsTotal, jobsWithRepairs, analysisTotal: analysisRepairsTotal, jobsWithAnalysisRepairs,
      componentTotal: componentRepairsTotal, jobsWithComponentRepairs, componentAfterInjectedFault, componentRepairsNotRecorded,
      byTargetedCheck, byFirstRevisionCheck,
    },
    cost: {
      publishedLessons,
      meanPerPublishedUSD: publishedLessons === 0 ? null : Math.round((publishedCostSum / publishedLessons) * 1e6) / 1e6,
      maxPerPublishedUSD: publishedCostMax,
      totalUSD: Math.round(costSum * 1e6) / 1e6,
      lesson: { overview: costStat(lessonCost.overview), interactive: costStat(lessonCost.interactive), premium: costStat(lessonCost.premium) },
    },
    timing: { meanWallS: rate(wallSum, wallN) },
    pages,
  };
}

function pct(x: number | null): string {
  return x === null ? 'n/a' : `${(x * 100).toFixed(1)}%`;
}

function usd(x: number | null): string {
  return x === null ? 'n/a' : `$${x.toFixed(2)}`;
}

function groupTable(groups: Record<string, GroupMetrics>, label: string): string[] {
  const rows = Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0]));
  if (rows.length === 0) return [`_No results with a recorded ${label}._`, ''];
  // S6R-12: the not-applicable column appears only when kit-only lessons exist (v1 tables unchanged).
  const na = rows.some(([, g]) => g.byClass['not-applicable'] > 0);
  const out = [`| ${label} | n | correct first try | correct after repair | correct decline | wrong engine | wrong decline | false accept | failed |${na ? ' not applicable (kit-only lesson) |' : ''} accuracy |`,
    `|---|---|---|---|---|---|---|---|---|${na ? '---|' : ''}---|`];
  for (const [name, g] of rows) {
    const c = g.byClass;
    out.push(`| ${name} | ${g.total} | ${c['correct-first-try']} | ${c['correct-after-repair']} | ${c['correct-decline']} | ${c['wrong-engine']} | ${c['wrong-decline']} | ${c['false-accept']} | ${c.failed} |${na ? ` ${c['not-applicable']} |` : ''} ${pct(g.accuracyRate)} |`);
  }
  out.push('');
  return out;
}

/** Plain-language markdown for docs/evidence/stage-5b/evaluation/summary.md. States the sample size; no claims beyond the data. */
export function renderSummaryMarkdown(m: MetricsSummary, opts: { manifestTotal: number; generatedAt?: string; resultsFile?: string }): string {
  const c = m.byClass;
  const L: string[] = [];
  L.push('# Stage 5b evaluation — results summary');
  L.push('');
  L.push(`Sample: **${m.total} of ${opts.manifestTotal}** planned evaluation pages have results${opts.generatedAt ? ` (report generated ${opts.generatedAt})` : ''}. Everything below is computed only from the ${m.total} completed job${m.total === 1 ? '' : 's'} in \`${opts.resultsFile ?? 'docs/evidence/stage-5b/evaluation/results.jsonl'}\`; pages without a result are simply absent, not failures.`);
  L.push('');
  L.push('## Outcome classes');
  L.push('');
  L.push('| Class | Count | Share of sample |');
  L.push('|---|---|---|');
  for (const cls of OUTCOME_CLASSES) {
    if (cls === 'not-applicable' && c[cls] === 0) continue; // S6R-12: v1-only reports keep their table
    L.push(`| ${cls} | ${c[cls]} | ${m.total === 0 ? 'n/a' : pct(c[cls] / m.total)} |`);
  }
  L.push('');
  const correctN = c['correct-first-try'] + c['correct-after-repair'] + c['correct-decline'];
  if (c['not-applicable'] === 0) {
    L.push(`Correct decisions (first try + after repair + correct decline): **${correctN} of ${m.total}** (${pct(m.accuracyRate)}).`);
  } else {
    L.push(`Correct decisions (first try + after repair + correct decline): **${correctN} of ${m.engineClassApplicable}** engine-class-applicable pages (${pct(m.accuracyRate)}). The engine-class decision is not applicable to **${c['not-applicable']}** lesson page(s) that published an overview and kit components without a premium engine; they are excluded from this denominator and reported in the lesson section below.`);
  }
  L.push('');
  L.push(`Class meanings: _correct-first-try_ = published revision 1 with the expected or an acceptable engine; _correct-after-repair_ = published a later revision after natural (non-injected) repairs; _correct-decline_ = honestly declined when decline was expected or acceptable; _wrong-engine_ = published an engine outside expected/acceptable; _wrong-decline_ = declined a supported page; _false-accept_ = published a page that should have been declined; _failed_ = job ended with an error code; ${c['not-applicable'] > 0 ? '_not-applicable_ = a lesson page that published an overview (+ kit components) without a premium engine, where the engine-class decision does not apply (excluded from the accuracy denominator); ' : ''}_unknown_ = anything else (never counted as correct).`);
  L.push('');
  L.push('## By subject');
  L.push('');
  L.push(...groupTable(m.bySubject, 'subject'));
  L.push('## By difficulty');
  L.push('');
  L.push(...groupTable(m.byDifficulty, 'difficulty'));
  L.push('## Natural repairs');
  L.push('');
  L.push('No demo faults are injected in evaluation runs, so every repair below is a natural model failure repaired by Muse.');
  L.push('');
  L.push(`- Repair attempts: **${m.repairs.total}** across **${m.repairs.jobsWithRepairs}** job(s).`);
  L.push(`- Analysis repair attempts: **${m.repairs.analysisTotal}** across **${m.repairs.jobsWithAnalysisRepairs}** job(s) (source-analysis stage, TASK-024b; included in the totals above).`);
  // S6R-12: lesson component repairs (only shown when lesson results exist).
  if (m.lesson.lessonJobs > 0) {
    L.push(`- Component repair attempts: **${m.repairs.componentTotal}** across **${m.repairs.jobsWithComponentRepairs}** job(s) (lesson components; included in the totals above; checks counted as \`<componentId>:<checkId>\`).`);
    if (m.repairs.componentRepairsNotRecorded > 0) {
      L.push(`- ${m.repairs.componentRepairsNotRecorded} lesson result line(s) predate component-repair recording: their component repairs are not recorded (unknown, not zero).`);
    }
    if (m.repairs.componentAfterInjectedFault > 0) {
      L.push(`- ${m.repairs.componentAfterInjectedFault} component repair attempt(s) after a system-injected demo fault are excluded from every natural-repair count.`);
    }
  }
  const targeted = Object.entries(m.repairs.byTargetedCheck).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (targeted.length > 0) {
    L.push('- Checks targeted by repairs:');
    L.push('');
    L.push('| Check id | Repair attempts targeting it |');
    L.push('|---|---|');
    for (const [id, n] of targeted) L.push(`| \`${id}\` | ${n} |`);
    L.push('');
  }
  const first = Object.entries(m.repairs.byFirstRevisionCheck).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (first.length > 0) {
    L.push('- Checks that failed on revision 1 (per job, the natural trigger):');
    L.push('');
    L.push('| Check id | Jobs where it failed on revision 1 |');
    L.push('|---|---|');
    for (const [id, n] of first) L.push(`| \`${id}\` | ${n} |`);
    L.push('');
  }
  // S6-W: lesson-flow section, only when the results file contains lesson jobs.
  const lm = m.lesson;
  if (lm.lessonJobs > 0) {
    L.push('## Lesson flow (Stage 6)');
    L.push('');
    L.push(`Lesson-flow jobs in this results file: **${lm.lessonJobs}** (the classes above still apply to every line; this section adds the Stage 6 lesson outcomes).`);
    L.push('');
    L.push(`- Pages that got an overview: **${lm.overviewPublished} of ${lm.lessonJobs}** (${pct(lm.overviewRate)})`);
    L.push(`- Pages that got an overview plus at least one interactive component: **${lm.interactivePublished} of ${lm.lessonJobs}** (${pct(lm.interactiveRate)})`);
    L.push(`- Components: **${lm.componentsPublished} published**, **${lm.componentsFailed} failed/skipped**, of **${lm.componentsPlanned} planned**`);
    L.push(`- Partial publishes (some components published, some not): **${lm.partialPublishJobs}**`);
    L.push(`- Declined pages: **${lm.declined}**; failed jobs (overview never published): **${lm.failed}**`);
    const declineCodes = Object.entries(lm.declinesByCode).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    if (declineCodes.length > 0) {
      L.push(`- Decline codes: ${declineCodes.map(([c, n]) => `\`${c}\` ×${n}`).join(', ')}`);
    }
    L.push('');
  }
  L.push('## Cost and timing');
  L.push('');
  L.push(`- Published lessons: **${m.cost.publishedLessons}**${m.lesson.lessonJobs > 0 ? ' (activity flow: a published activity revision; lesson flow: the overview was published)' : ''}`);
  L.push(`- Mean cost per published lesson: **${usd(m.cost.meanPerPublishedUSD)}**; max: **${usd(m.cost.maxPerPublishedUSD)}**`);
  L.push(`- Total cost of all ${m.total} recorded job(s): **${usd(m.cost.totalUSD)}** (includes declines and failures)`);
  if (m.lesson.lessonJobs > 0) {
    const lc = m.cost.lesson;
    const stat = (name: string, s: CostStat): string => `${name}: **${s.jobs}** job(s), mean **${usd(s.meanUSD)}**, max **${usd(s.maxUSD)}**`;
    L.push(`- Lesson-flow cost per job by what was published — ${stat('overview', lc.overview)}; ${stat('overview + interactive component', lc.interactive)}; ${stat('premium activity', lc.premium)}`);
  }
  L.push(`- Mean wall time per job: **${m.timing.meanWallS === null ? 'n/a' : `${m.timing.meanWallS.toFixed(1)} s`}**`);
  L.push('');
  L.push('## Per-page outcomes');
  L.push('');
  if (m.pages.length === 0) {
    L.push('_No results yet._');
  } else {
    L.push('| # | Source | Subject | Difficulty | Expected | Class | Engine | Published rev | Cost | Wall |');
    L.push('|---|---|---|---|---|---|---|---|---|---|');
    for (const p of [...m.pages].sort((a, b) => (a.candidate ?? 0) - (b.candidate ?? 0) || a.sourceId.localeCompare(b.sourceId))) {
      L.push(`| ${p.candidate ?? '?'} | \`${p.sourceId}\` | ${p.subject ?? '?'} | ${p.difficulty ?? '?'} | ${p.expected ?? '?'} | ${p.class} | ${p.engine ?? '—'} | ${p.publishedRevision ?? '—'} | ${usd(p.totalCostUSD ?? null)} | ${p.wallS == null ? 'n/a' : `${p.wallS}s`} |`);
    }
  }
  L.push('');
  return L.join('\n');
}

/* ------------------------------------------------------------------ */
/* OW-2: hosted vs open-weights comparison (pure)                       */
/* ------------------------------------------------------------------ */

/** Exact median of the finite entries; null when there are none (never 0 by assumption). */
export function median(values: readonly number[]): number | null {
  const finite = values
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
    .sort((x, y) => x - y);
  if (finite.length === 0) {
    return null;
  }
  const mid = Math.floor(finite.length / 2);
  return finite.length % 2 === 0 ? (finite[mid - 1] + finite[mid]) / 2 : finite[mid];
}

/** The newest line per sourceId (a --rerun supersedes), in first-seen order. */
export function latestPerSource(results: readonly EvalResultLine[]): EvalResultLine[] {
  const latest = new Map<string, EvalResultLine>();
  for (const r of results) {
    latest.set(r.sourceId, r);
  }
  return [...latest.values()];
}

function distinctStrings(values: readonly (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((v): v is string => typeof v === 'string' && v !== ''))].sort();
}

/** One side of the comparison: everything the side-by-side report shows for one run. */
export interface ComparisonSide {
  label: string;
  dir: string;
  total: number;
  /** Distinct recorded model ids (pre-OW-2 records have none → empty). */
  models: string[];
  providers: string[];
  byClass: ClassCounts;
  accuracyRate: number | null;
  /** Jobs that published revision 1 (whatever the engine correctness class). */
  publishedFirstTry: number;
  publishedFirstTryRate: number | null;
  repairsTotal: number;
  jobsWithRepairs: number;
  analysisRepairsTotal: number;
  /** S6R-12: natural lesson component repair attempts (included in repairsTotal). */
  componentRepairsTotal: number;
  /** S6R-12: lesson lines recorded before componentRepairs existed (their component repairs are unknown). */
  componentRepairsNotRecorded: number;
  /** S6R-12: kit-only lesson pages outside the engine-class decision. */
  notApplicable: number;
  /** Jobs whose revision 1 had at least one failing check. */
  jobsWithFirstTryFailures: number;
  firstTryFailedChecksTotal: number;
  publishedLessons: number;
  costTotalUSD: number;
  meanPerPublishedUSD: number | null;
  maxPerPublishedUSD: number | null;
  medianWallS: number | null;
  meanWallS: number | null;
}

/**
 * Compute one comparison side from its (already deduplicated) results lines.
 * Reuses computeMetrics so class definitions, repair counting and cost rules
 * stay IDENTICAL to the single-run summary — the comparison never re-defines a
 * metric. Pass [] as the manifest: every field falls back to the recorded line.
 */
export function comparisonSide(
  results: readonly EvalResultLine[],
  opts: { label: string; dir?: string },
): ComparisonSide {
  const m = computeMetrics([...results], []);
  const publishedFirstTry = results.filter(r => r.publishedRevision === 1).length;
  let jobsWithFirstTryFailures = 0;
  let firstTryFailedChecksTotal = 0;
  for (const r of results) {
    const failed = r.firstRevisionFailedChecks ?? [];
    if (failed.length > 0) {
      jobsWithFirstTryFailures += 1;
    }
    firstTryFailedChecksTotal += failed.length;
  }
  return {
    label: opts.label,
    dir: opts.dir ?? '',
    total: m.total,
    models: distinctStrings(results.map(r => r.model)),
    providers: distinctStrings(results.map(r => r.provider)),
    byClass: m.byClass,
    accuracyRate: m.accuracyRate,
    publishedFirstTry,
    publishedFirstTryRate: m.total === 0 ? null : publishedFirstTry / m.total,
    repairsTotal: m.repairs.total,
    jobsWithRepairs: m.repairs.jobsWithRepairs,
    analysisRepairsTotal: m.repairs.analysisTotal,
    componentRepairsTotal: m.repairs.componentTotal,
    componentRepairsNotRecorded: m.repairs.componentRepairsNotRecorded,
    notApplicable: m.byClass['not-applicable'],
    jobsWithFirstTryFailures,
    firstTryFailedChecksTotal,
    publishedLessons: m.cost.publishedLessons,
    costTotalUSD: m.cost.totalUSD,
    meanPerPublishedUSD: m.cost.meanPerPublishedUSD,
    maxPerPublishedUSD: m.cost.maxPerPublishedUSD,
    medianWallS: median(results.map(r => r.wallS).filter((v): v is number => typeof v === 'number')),
    meanWallS: m.timing.meanWallS,
  };
}

function countOrNa(n: number): string {
  return String(n);
}

function secondsOrNull(s: number | null): string {
  return s === null ? 'n/a' : `${s.toFixed(1)} s`;
}

function listOrDash(values: readonly string[]): string {
  return values.length === 0 ? '—' : values.map(v => `\`${v}\``).join(', ');
}

/**
 * Side-by-side markdown of two runs of the SAME pre-registered manifest. States
 * sample sizes and computes nothing beyond the two results files; unknown money
 * or timing stays 'n/a', never 0.
 */
export function renderComparisonMarkdown(
  a: ComparisonSide,
  b: ComparisonSide,
  opts: { generatedAt?: string } = {},
): string {
  const L: string[] = [];
  L.push(`# Evaluation comparison — ${a.label} vs ${b.label}`);
  L.push('');
  L.push(
    `Two runs of the SAME pre-registered manifest (\`data/evaluation/manifest.json\`) with the same prompts, ` +
      `checks and repair loop; the intended difference is the model/provider only. No demo faults are ` +
      `injected in evaluation runs, so every repair below is a natural model failure repaired by Muse. ` +
      `Generated ${opts.generatedAt ?? new Date().toISOString()}.`,
  );
  L.push('');
  L.push(`- **${a.label}** — results: \`${a.dir === '' ? '(directory A)' : a.dir}\` (${a.total} result line(s))`);
  L.push(`- **${b.label}** — results: \`${b.dir === '' ? '(directory B)' : b.dir}\` (${b.total} result line(s))`);
  L.push('');
  const row = (metric: string, va: string, vb: string): void => {
    L.push(`| ${metric} | ${va} | ${vb} |`);
  };
  L.push(`| Metric | ${a.label} | ${b.label} |`);
  L.push('|---|---|---|');
  row('Result lines', countOrNa(a.total), countOrNa(b.total));
  row('Model(s)', listOrDash(a.models), listOrDash(b.models));
  row('Provider(s)', listOrDash(a.providers), listOrDash(b.providers));
  // S6R-12: over the engine-class-applicable lines (kit-only lessons are not applicable).
  const correct = (s: ComparisonSide): string =>
    `${s.byClass['correct-first-try'] + s.byClass['correct-after-repair'] + s.byClass['correct-decline']} of ${s.total - s.notApplicable} (${pct(s.accuracyRate)})`;
  row('Correct decisions', correct(a), correct(b));
  for (const cls of OUTCOME_CLASSES) {
    // S6R-12: the not-applicable row only when a side has kit-only lessons (v1 comparisons unchanged).
    if (cls === 'not-applicable' && a.byClass[cls] === 0 && b.byClass[cls] === 0) continue;
    row(cls, countOrNa(a.byClass[cls]), countOrNa(b.byClass[cls]));
  }
  const firstTry = (s: ComparisonSide): string => `${s.publishedFirstTry} (${pct(s.publishedFirstTryRate)})`;
  row('Published first try', firstTry(a), firstTry(b));
  row('Repair attempts', countOrNa(a.repairsTotal), countOrNa(b.repairsTotal));
  row('Jobs with repairs', countOrNa(a.jobsWithRepairs), countOrNa(b.jobsWithRepairs));
  row('Analysis repair attempts', countOrNa(a.analysisRepairsTotal), countOrNa(b.analysisRepairsTotal));
  const componentRepairs = (s: ComparisonSide): string =>
    s.componentRepairsNotRecorded > 0
      ? `${s.componentRepairsTotal} (+ ${s.componentRepairsNotRecorded} lesson line(s) not recorded)`
      : countOrNa(s.componentRepairsTotal);
  row('Component repair attempts', componentRepairs(a), componentRepairs(b));
  row('Jobs with a first-try check failure', countOrNa(a.jobsWithFirstTryFailures), countOrNa(b.jobsWithFirstTryFailures));
  row('First-try check failures (total)', countOrNa(a.firstTryFailedChecksTotal), countOrNa(b.firstTryFailedChecksTotal));
  row('Published lessons', countOrNa(a.publishedLessons), countOrNa(b.publishedLessons));
  row('Total cost', usd(a.costTotalUSD), usd(b.costTotalUSD));
  row('Mean cost per published lesson', usd(a.meanPerPublishedUSD), usd(b.meanPerPublishedUSD));
  row('Max cost per published lesson', usd(a.maxPerPublishedUSD), usd(b.maxPerPublishedUSD));
  row('Median wall time', secondsOrNull(a.medianWallS), secondsOrNull(b.medianWallS));
  row('Mean wall time', secondsOrNull(a.meanWallS), secondsOrNull(b.meanWallS));
  L.push('');
  L.push(
    'Class meanings are the ones used by the single-run summary (`scripts/evaluation-metrics.ts`): ' +
      'correct-first-try, correct-after-repair, correct-decline count as correct decisions; ' +
      'wrong-engine, wrong-decline, false-accept and failed do not; unknown is never counted as correct.',
  );
  L.push('');
  return L.join('\n');
}
