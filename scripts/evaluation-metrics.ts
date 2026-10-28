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

/** One JSON line of docs/evidence/stage-5b/evaluation/results.jsonl. */
export interface EvalResultLine {
  sourceId: string;
  candidate?: number;
  subject?: Subject;
  expected?: string;
  acceptable?: string[];
  difficulty?: Difficulty;
  jobId?: string | null;
  status?: string | null;
  engine?: string | null;
  publishedRevision?: number | null;
  revisions?: number | null;
  repairs?: RepairSummary[] | null;
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
  | 'wrong-engine' | 'wrong-decline' | 'false-accept' | 'failed' | 'unknown';

export const OUTCOME_CLASSES: readonly OutcomeClass[] = [
  'correct-first-try', 'correct-after-repair', 'correct-decline',
  'wrong-engine', 'wrong-decline', 'false-accept', 'failed', 'unknown',
] as const;

export interface ClassCounts {
  'correct-first-try': number; 'correct-after-repair': number; 'correct-decline': number;
  'wrong-engine': number; 'wrong-decline': number; 'false-accept': number; failed: number; unknown: number;
}

export interface GroupMetrics {
  total: number;
  byClass: ClassCounts;
  /** (correct-first-try + correct-after-repair + correct-decline) / total; null when total is 0. */
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

export interface MetricsSummary {
  total: number;
  byClass: ClassCounts;
  accuracyRate: number | null;
  bySubject: Record<string, GroupMetrics>;
  byDifficulty: Record<string, GroupMetrics>;
  repairs: {
    total: number;
    jobsWithRepairs: number;
    /** How many repair attempts targeted each check id. */
    byTargetedCheck: Record<string, number>;
    /** In how many jobs each check id failed on revision 1 (the natural trigger). */
    byFirstRevisionCheck: Record<string, number>;
  };
  cost: {
    publishedLessons: number;
    meanPerPublishedUSD: number | null;
    maxPerPublishedUSD: number | null;
    totalUSD: number;
  };
  timing: { meanWallS: number | null };
  pages: PageOutcome[];
}

export function classifyResult(r: EvalResultLine): OutcomeClass {
  const expected = r.expected ?? 'decline';
  const acceptable = r.acceptable ?? [];
  if (r.status === 'failed' || (r.error != null && r.error !== '')) return 'failed';
  if (r.status === 'unsupported') {
    return expected === 'decline' || acceptable.includes('decline') ? 'correct-decline' : 'wrong-decline';
  }
  if (r.status === 'succeeded' && r.engine != null && r.publishedRevision != null) {
    if (expected === 'decline') {
      return acceptable.includes(r.engine) ? (r.publishedRevision > 1 ? 'correct-after-repair' : 'correct-first-try') : 'false-accept';
    }
    if (r.engine === expected || acceptable.includes(r.engine)) {
      return r.publishedRevision > 1 ? 'correct-after-repair' : 'correct-first-try';
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
    'wrong-engine': 0, 'wrong-decline': 0, 'false-accept': 0, failed: 0, unknown: 0,
  };
}

function finishGroup(total: number, byClass: ClassCounts): GroupMetrics {
  const correct = byClass['correct-first-try'] + byClass['correct-after-repair'] + byClass['correct-decline'];
  return { total, byClass, accuracyRate: total === 0 ? null : correct / total };
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
  const byTargetedCheck: Record<string, number> = {};
  const byFirstRevisionCheck: Record<string, number> = {};

  let publishedLessons = 0;
  let publishedCostSum = 0;
  let publishedCostMax: number | null = null;
  let costSum = 0;
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
    if (repairs.length > 0) jobsWithRepairs += 1;
    repairsTotal += repairs.length;
    for (const rep of repairs) {
      for (const id of rep.targeted ?? []) byTargetedCheck[id] = (byTargetedCheck[id] ?? 0) + 1;
    }
    for (const id of r.firstRevisionFailedChecks ?? []) byFirstRevisionCheck[id] = (byFirstRevisionCheck[id] ?? 0) + 1;

    const cost = typeof r.totalCostUSD === 'number' ? r.totalCostUSD : 0;
    costSum += cost;
    if (r.publishedRevision != null) {
      publishedLessons += 1;
      publishedCostSum += cost;
      if (publishedCostMax === null || cost > publishedCostMax) publishedCostMax = cost;
    }
    if (typeof r.wallS === 'number') { wallSum += r.wallS; wallN += 1; }
  }

  const bySubject: Record<string, GroupMetrics> = {};
  for (const [s, t] of subjectTotals) bySubject[s] = finishGroup(t, subjectCounts.get(s) ?? emptyCounts());
  const byDifficulty: Record<string, GroupMetrics> = {};
  for (const [d, t] of diffTotals) byDifficulty[d] = finishGroup(t, diffCounts.get(d) ?? emptyCounts());

  const correct = byClass['correct-first-try'] + byClass['correct-after-repair'] + byClass['correct-decline'];
  return {
    total,
    byClass,
    accuracyRate: total === 0 ? null : correct / total,
    bySubject,
    byDifficulty,
    repairs: { total: repairsTotal, jobsWithRepairs, byTargetedCheck, byFirstRevisionCheck },
    cost: {
      publishedLessons,
      meanPerPublishedUSD: publishedLessons === 0 ? null : Math.round((publishedCostSum / publishedLessons) * 1e6) / 1e6,
      maxPerPublishedUSD: publishedCostMax,
      totalUSD: Math.round(costSum * 1e6) / 1e6,
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
  const out = [`| ${label} | n | correct first try | correct after repair | correct decline | wrong engine | wrong decline | false accept | failed | accuracy |`,
    '|---|---|---|---|---|---|---|---|---|---|'];
  for (const [name, g] of rows) {
    const c = g.byClass;
    out.push(`| ${name} | ${g.total} | ${c['correct-first-try']} | ${c['correct-after-repair']} | ${c['correct-decline']} | ${c['wrong-engine']} | ${c['wrong-decline']} | ${c['false-accept']} | ${c.failed} | ${pct(g.accuracyRate)} |`);
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
    L.push(`| ${cls} | ${c[cls]} | ${m.total === 0 ? 'n/a' : pct(c[cls] / m.total)} |`);
  }
  L.push('');
  L.push(`Correct decisions (first try + after repair + correct decline): **${c['correct-first-try'] + c['correct-after-repair'] + c['correct-decline']} of ${m.total}** (${pct(m.accuracyRate)}).`);
  L.push('');
  L.push('Class meanings: _correct-first-try_ = published revision 1 with the expected or an acceptable engine; _correct-after-repair_ = published a later revision after natural (non-injected) repairs; _correct-decline_ = honestly declined when decline was expected or acceptable; _wrong-engine_ = published an engine outside expected/acceptable; _wrong-decline_ = declined a supported page; _false-accept_ = published a page that should have been declined; _failed_ = job ended with an error code; _unknown_ = anything else (never counted as correct).');
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
  L.push('## Cost and timing');
  L.push('');
  L.push(`- Published lessons: **${m.cost.publishedLessons}**`);
  L.push(`- Mean cost per published lesson: **${usd(m.cost.meanPerPublishedUSD)}**; max: **${usd(m.cost.maxPerPublishedUSD)}**`);
  L.push(`- Total cost of all ${m.total} recorded job(s): **${usd(m.cost.totalUSD)}** (includes declines and failures)`);
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
