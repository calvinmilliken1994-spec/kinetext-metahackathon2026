// TASK-023b evaluation report. Reads docs/evidence/stage-5b/evaluation/results.jsonl (written by
// scripts/evaluation-run.ts) and data/evaluation/manifest.json, computes the metrics with the pure
// module scripts/evaluation-metrics.ts, and writes summary.md + summary.json next to the results.
// Usage: node scripts/evaluation-report.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeMetrics, parseResultsJsonl, renderSummaryMarkdown } from './evaluation-metrics.ts';
import type { ManifestEntry } from './evaluation-metrics.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'docs', 'evidence', 'stage-5b', 'evaluation');
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
