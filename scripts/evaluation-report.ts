// TASK-023b evaluation report. Reads docs/evidence/stage-5b/evaluation/results.jsonl (written by
// scripts/evaluation-run.ts) and data/evaluation/manifest.json, computes the metrics with the pure
// module scripts/evaluation-metrics.ts, and writes summary.md + summary.json next to the results.
// Usage: node scripts/evaluation-report.ts
//
// OW-2 comparison mode:
//   node scripts/evaluation-report.ts --compare <dirA> <dirB>
// reads <dirA>/results.jsonl and <dirB>/results.jsonl (absolute paths, or relative to the repo
// root — e.g. docs/evidence/stage-5b/evaluation and docs/evidence/open-weights/evaluation) and
// writes ONLY <dirB>/comparison.md: a side-by-side markdown of decisions, published-first-try,
// repairs, first-try check failures, cost and median latency, computed by the pure functions in
// scripts/evaluation-metrics.ts. Compare mode never writes summary.md/summary.json anywhere and
// never touches a directory it was not given — the pre-registered stage-5b evidence stays
// read-only even when it is passed as <dirA>.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  comparisonSide,
  computeMetrics,
  latestPerSource,
  parseResultsJsonl,
  renderComparisonMarkdown,
  renderSummaryMarkdown,
} from './evaluation-metrics.ts';
import type { EvalResultLine, ManifestEntry } from './evaluation-metrics.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ------------------------------------------------------------------ */
/* OW-2: --compare <dirA> <dirB>                                        */
/* ------------------------------------------------------------------ */

function resolveDir(p: string): string {
  return isAbsolute(p) ? p : join(ROOT, p);
}

function displayDir(p: string): string {
  const rel = relative(ROOT, p);
  return rel === '' || rel.startsWith('..') ? p : rel.replaceAll('\\', '/');
}

function readResults(dir: string): EvalResultLine[] {
  const file = join(dir, 'results.jsonl');
  if (!existsSync(file)) {
    console.error(
      `No results file at ${file} — run scripts/evaluation-run.ts against the live API first ` +
        `(with EVAL_OUT_DIR pointing at that directory); this report never invents data.`,
    );
    process.exit(1);
  }
  // A --rerun line supersedes the earlier attempt for the same source, exactly
  // like the single-run summary.
  return latestPerSource(parseResultsJsonl(readFileSync(file, 'utf8')));
}

const compareAt = process.argv.indexOf('--compare');
if (compareAt >= 0) {
  const rawA = process.argv[compareAt + 1];
  const rawB = process.argv[compareAt + 2];
  if (rawA === undefined || rawB === undefined) {
    console.error(
      'Usage: node scripts/evaluation-report.ts --compare <dirA> <dirB> — two directories each ' +
        'containing a results.jsonl (absolute, or relative to the repo root). Writes <dirB>/comparison.md only.',
    );
    process.exit(2);
  }
  const dirA = resolveDir(rawA);
  const dirB = resolveDir(rawB);
  const resultsA = readResults(dirA);
  const resultsB = readResults(dirB);
  // Label each side with what its lines actually recorded (never assumed); a
  // pre-OW-2 results file records no model, so fall back to the directory name.
  const labelOf = (results: EvalResultLine[], dir: string): string => {
    const models = [...new Set(results.map(r => r.model).filter((m): m is string => typeof m === 'string' && m !== ''))].sort();
    return models.length > 0 ? models.join(' + ') : basename(dir);
  };
  const sideA = comparisonSide(resultsA, { label: labelOf(resultsA, dirA), dir: displayDir(dirA) });
  const sideB = comparisonSide(resultsB, { label: labelOf(resultsB, dirB), dir: displayDir(dirB) });
  const md = renderComparisonMarkdown(sideA, sideB, { generatedAt: new Date().toISOString() });
  mkdirSync(dirB, { recursive: true });
  const outPath = join(dirB, 'comparison.md');
  writeFileSync(outPath, md);
  console.log(
    `Wrote ${outPath} — ${sideA.label} (${resultsA.length} line(s)) vs ${sideB.label} (${resultsB.length} line(s)). ` +
      'No summary.md/summary.json was written; both results directories are otherwise untouched.',
  );
  process.exit(0);
}

/* ------------------------------------------------------------------ */
/* Single-run summary (unchanged TASK-023b behaviour)                   */
/* ------------------------------------------------------------------ */

// EVAL_OUT_DIR (relative to the repo root) keeps follow-up runs apart from the pre-registered evaluation.
const OUT_DIR = process.env.EVAL_OUT_DIR ? join(ROOT, process.env.EVAL_OUT_DIR) : join(ROOT, 'docs', 'evidence', 'stage-5b', 'evaluation');
const RESULTS = join(OUT_DIR, 'results.jsonl');
const MANIFEST = join(ROOT, 'data', 'evaluation', 'manifest.json');

if (!existsSync(RESULTS)) {
  console.error(`No results file at docs/evidence/stage-5b/evaluation/results.jsonl — run scripts/evaluation-run.ts against the live API first (this report never invents data).`);
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as { pages: ManifestEntry[] };
const results = parseResultsJsonl(readFileSync(RESULTS, 'utf8'));

// Later lines win if a source was re-run with --rerun: report the newest attempt per source,
// but keep every attempt in summary.json for provenance.
const latest = new Map<string, (typeof results)[number]>();
for (const r of results) latest.set(r.sourceId, r);
const deduped = [...latest.values()].sort((a, b) => (a.candidate ?? 0) - (b.candidate ?? 0));

const metrics = computeMetrics(deduped, manifest.pages);
const generatedAt = new Date().toISOString();
mkdirSync(OUT_DIR, { recursive: true });

const md = renderSummaryMarkdown(metrics, {
  manifestTotal: manifest.pages.length,
  generatedAt,
  resultsFile: 'docs/evidence/stage-5b/evaluation/results.jsonl',
});
writeFileSync(join(OUT_DIR, 'summary.md'), md);

const dupes = results.length - deduped.length;
writeFileSync(join(OUT_DIR, 'summary.json'), JSON.stringify({
  generatedAt,
  resultsFile: 'docs/evidence/stage-5b/evaluation/results.jsonl',
  manifestFile: 'data/evaluation/manifest.json',
  manifestTotal: manifest.pages.length,
  resultLines: results.length,
  reportedJobs: deduped.length,
  supersededDuplicateLines: dupes,
  metrics,
}, null, 2) + '\n');

console.log(`Wrote docs/evidence/stage-5b/evaluation/summary.md and summary.json (${deduped.length} reported job(s) of ${manifest.pages.length} planned${dupes > 0 ? `, ${dupes} superseded duplicate line(s) excluded` : ''}).`);
