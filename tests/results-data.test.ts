// Stage 10b slice S: the Results page data (apps/web/src/data/results.json) is exactly what scripts/build-results.ts
// builds from committed evidence, and its key totals match the pre-registered report (docs/evidence/final-eval/REPORT.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildResults } from '../scripts/build-results.ts';
import { reportCell, seconds, type ResultsData } from '../apps/web/src/lib/results.ts';

const root = new URL('../', import.meta.url);
const read = (p: string): string => readFileSync(new URL(p, root), 'utf8').replace(/\r\n/g, '\n');
const committed = JSON.parse(read('apps/web/src/data/results.json')) as ResultsData;
const report = read('docs/evidence/final-eval/REPORT.md');

test('the script output equals the committed JSON (rebuild with node scripts/build-results.ts)', () => {
  assert.deepEqual(buildResults(root), committed);
});

test('the script is deterministic: two builds serialise identically', () => {
  assert.equal(JSON.stringify(buildResults(root)), JSON.stringify(buildResults(root)));
});

test('key totals match REPORT.md (spec: 189/194, 178/194, 348/379, 342/374, first try 303/379 and 272/374)', () => {
  const [s, o] = committed.evaluation.models;
  assert.ok(s !== undefined && o !== undefined);
  assert.equal(s.id, 'muse-spark-1.3'); assert.equal(o.id, 'muse-spark-open');
  assert.deepEqual([s.lessons.k, s.lessons.n, o.lessons.k, o.lessons.n], [189, 194, 178, 194]);
  assert.deepEqual([s.parts.rate.k, s.parts.rate.n, o.parts.rate.k, o.parts.rate.n], [348, 379, 342, 374]);
  assert.deepEqual([s.parts.firstTry.k, s.parts.firstTry.n, o.parts.firstTry.k, o.parts.firstTry.n], [303, 379, 272, 374]);
  const line = (label: string, a: string, b: string) => `| ${label} | ${a} | ${b} |`;
  for (const [label, key] of [
    ['Lesson with at least one interactive part', 'lessons'], ['Same, among pages not declined', 'lessonsOfUsable'],
    ['Honest declines', 'declined'], ['Failures (job failed or no part published)', 'failed'],
  ] as const) assert.ok(report.includes(line(label, reportCell(s[key]), reportCell(o[key]))), label);
  assert.ok(report.includes(line('Parts published / planned', reportCell(s.parts.rate), reportCell(o.parts.rate))));
  assert.ok(report.includes(line('Parts passing first try', reportCell(s.parts.firstTry), reportCell(o.parts.firstTry))));
  assert.ok(report.includes(line('Natural repair (fixed / failed first try)', reportCell(s.parts.naturalRepair), reportCell(o.parts.naturalRepair))));
  assert.ok(report.includes(line('Time p50 / p90', `${seconds(s.wallS.p50)} / ${seconds(s.wallS.p90)}`, `${seconds(o.wallS.p50)} / ${seconds(o.wallS.p90)}`)));
  for (const [label, key] of [['Same outcome', 'sameOutcome'], ['Same set of parts planned', 'samePlan'], ['Same number of parts published', 'samePublishedCount']] as const) {
    assert.ok(report.includes(line(label, reportCell(s.consistency[key]), reportCell(o.consistency[key]))), label);
  }
});

test('every part-type row and every subject row matches REPORT.md', () => {
  const [s, o] = committed.evaluation.models;
  assert.ok(s !== undefined && o !== undefined);
  for (const e of s.engines) {
    const oe = o.engines.find((x) => x.id === e.id) ?? { planned: 0, firstTry: 0, repaired: 0 };
    const pub = (x: { firstTry: number; repaired: number }) => x.firstTry + x.repaired;
    assert.ok(report.includes(`| ${e.label} | ${pub(e)}/${e.planned} | ${pub(oe)}/${oe.planned} |`), e.label);
  }
  for (const sub of s.subjects) {
    const os = o.subjects.find((x) => x.id === sub.id);
    assert.ok(os !== undefined);
    assert.ok(report.includes(`| ${sub.label} | ${reportCell(sub.lessons)} / ${reportCell(sub.parts)} | ${reportCell(os.lessons)} / ${reportCell(os.parts)} |`), sub.label);
  }
});

test('timeout retest numbers match its README, and it is marked as not pre-registered', () => {
  const t = committed.timeoutRetest;
  assert.equal(t.preRegistered, false);
  assert.deepEqual([t.before.jobs, t.before.lessons, t.before.timeouts, t.before.partsPublished, t.before.wallP50S, t.before.wallMaxS], [18, 7, 11, 14, 170, 296]);
  assert.deepEqual([t.after.jobs, t.after.lessons, t.after.timeouts, t.after.partsPublished, t.after.partsPlanned, t.after.wallP50S, t.after.wallMaxS], [18, 18, 0, 30, 37, 135, 271]);
  assert.equal(t.before.costUSD.toFixed(2), '4.72'); assert.equal(t.after.costUSD.toFixed(2), '4.14');
});

test('diagram runs: every committed 8c/8d line, each with its source file; quoted SAM ranges occur in the cited note', () => {
  const runs = committed.diagramRuns.runs;
  assert.equal(runs.length, 12);
  for (const r of runs) {
    assert.ok(read(r.source.path).includes(r.jobId), r.jobId);
    if (r.sam !== null) {
      const text = read(r.sam.source.path);
      assert.ok(text.includes(`${r.sam.min.toFixed(2)}-${r.sam.max.toFixed(2)}`), `${r.jobId} ${r.sam.min}-${r.sam.max}`);
    }
    if (r.note !== null) assert.ok(read(r.note.source.path).length > 0);
  }
});

test('every block names its committed source path and date', () => {
  const refs = [...committed.evaluation.sources, ...committed.timeoutRetest.sources, ...committed.diagramRuns.sources];
  for (const r of refs) {
    assert.match(r.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(read(r.path).length > 0, r.path);
    assert.ok(!r.path.startsWith('storage/'), r.path);
  }
});
