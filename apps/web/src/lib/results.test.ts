import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  wilson, rate, pct, rateText, ciText, reportCell, seconds, usd, dateText, dateFromJobId, parseComponents,
  funnelRows, FUNNEL_SORTS, subjectRows, plotPosition, PLOT_DOMAIN, diagramSummary, lessonLink, errorCodeText,
  type ResultsData, type ModelResult, type EnginePath,
} from './results.ts';

const root = new URL('../../../../', import.meta.url);
const data = JSON.parse(readFileSync(new URL('apps/web/src/data/results.json', root), 'utf8')) as ResultsData;
const [spark, open] = data.evaluation.models as [ModelResult, ModelResult];

test('wilson matches the Python report to 4 decimals (summary.json ci95)', () => {
  assert.deepEqual(wilson(189, 194), [0.9411, 0.9889]);
  assert.deepEqual(wilson(178, 194), [0.8702, 0.9486]);
  assert.deepEqual(wilson(0, 0), [null, null]);
  assert.deepEqual(wilson(0, 22), [0, 0.1487]);
  assert.deepEqual(wilson(22, 22), [0.8513, 1]);
});

test('wilson reproduces every interval the Python report stored (all rates in the committed data)', () => {
  const rates: { k: number; n: number; rate: number | null; ci95: [number | null, number | null] }[] = [];
  for (const m of data.evaluation.models) {
    rates.push(m.lessons, m.lessonsOfUsable, m.declined, m.failed, m.parts.rate, m.parts.firstTry, m.parts.naturalRepair,
      m.consistency.sameOutcome, m.consistency.samePlan, m.consistency.samePublishedCount);
    for (const s of m.subjects) rates.push(s.lessons, s.parts);
  }
  assert.equal(rates.length, 2 * (10 + 18));
  for (const r of rates) assert.deepEqual(rate(r.k, r.n), r, `${r.k}/${r.n}`);
});

test('rate builds k/n with a Wilson interval; n = 0 has no rate', () => {
  assert.deepEqual(rate(45, 76), { k: 45, n: 76, rate: 0.5921, ci95: [0.4798, 0.6956] });
  assert.deepEqual(rate(0, 0), { k: 0, n: 0, rate: null, ci95: [null, null] });
});

test('percent, rate and interval text read like the report', () => {
  const r = rate(189, 194);
  assert.equal(pct(r.rate), '97%');
  assert.equal(pct(null), '–');
  assert.equal(rateText(r), '97% (189/194)');
  assert.equal(ciText(r), '94–99%');
  assert.equal(reportCell(r), '97% (189/194) [94–99%]');
  assert.equal(ciText(rate(0, 0)), '–');
});

test('seconds, dollars and dates', () => {
  assert.equal(seconds(75.286), '75 s');
  assert.equal(seconds(144.82), '145 s');
  assert.equal(usd(0.1502, 3), '$0.150');
  assert.equal(usd(29.1409, 2), '$29.14');
  assert.equal(dateText('2026-10-31'), '31 Oct 2026');
  assert.equal(dateText('2026-11-02'), '2 Nov 2026');
  assert.equal(dateFromJobId('job-20261101182353-097482c0'), '2026-11-01');
  assert.throws(() => dateFromJobId('job-x'));
});

test('components grammar: engine:passed@rN | engine:failed@rN, first try is r1', () => {
  const paths = parseComponents(['quiz-cards-v1:passed@r1 formula-explorer-v1:failed@r3', 'quiz-cards-v1:passed@r2', '']);
  assert.deepEqual(paths.get('quiz-cards-v1'), { planned: 2, firstTry: 1, repaired: 1, failed: 0 });
  assert.deepEqual(paths.get('formula-explorer-v1'), { planned: 1, firstTry: 0, repaired: 0, failed: 1 });
  assert.throws(() => parseComponents(['quiz-cards-v1:passed']), /component token/);
  assert.throws(() => parseComponents(['quiz-cards-v1:skipped@r1']), /component token/);
});

test('error codes read as plain words', () => {
  assert.equal(errorCodeText('TIMEOUT'), 'ran out of time');
  assert.equal(errorCodeText('NETWORK_ERROR'), 'connection dropped');
  assert.equal(errorCodeText('ANALYSIS_INVALID'), 'page reading failed its checks');
  assert.equal(errorCodeText('SOMETHING_NEW'), 'SOMETHING_NEW');
});

const eng = (id: string, label: string, planned: number, firstTry: number, repaired: number): EnginePath =>
  ({ id, label, planned, firstTry, repaired, failed: planned - firstTry - repaired });
const two = [
  { id: 'a', label: 'A', engines: [eng('q', 'Quiz cards', 10, 9, 1), eng('f', 'Formula explorer', 8, 2, 2), eng('d', 'Label the diagram', 4, 1, 0)] },
  { id: 'b', label: 'B', engines: [eng('q', 'Quiz cards', 12, 12, 0), eng('f', 'Formula explorer', 6, 3, 1)] },
];

test('funnel: one row per part type, both models, missing type = 0 planned; count scale shares one max', () => {
  const rows = funnelRows(two, 'planned', 'count');
  assert.deepEqual(rows.map((r) => r.id), ['q', 'f', 'd']);
  const d = rows[2]!;
  assert.equal(d.byModel[1]!.planned, 0);
  assert.equal(d.byModel[1]!.published, 0);
  assert.deepEqual(d.byModel[1]!.segments.map((s) => s.width), [0, 0, 0]);
  const q = rows[0]!.byModel[1]!; // 12 of max 12
  assert.equal(q.segments[0]!.width, 100);
  const f = rows[1]!.byModel[0]!; // 8 planned: 2 first, 2 repaired, 4 left out, scale 12
  assert.deepEqual(f.segments.map((s) => [s.kind, s.count]), [['firstTry', 2], ['repaired', 2], ['failed', 4]]);
  assert.ok(Math.abs(f.segments.reduce((a, s) => a + s.width, 0) - (8 / 12) * 100) < 1e-9);
  assert.equal(f.segments[1]!.start, f.segments[0]!.width);
  assert.equal(f.published, 4);
});

test('funnel: share scale makes every planned bar full width', () => {
  const rows = funnelRows(two, 'planned', 'share');
  for (const r of rows) for (const m of r.byModel) {
    const total = m.segments.reduce((a, s) => a + s.width, 0);
    assert.ok(m.planned === 0 ? total === 0 : Math.abs(total - 100) < 1e-9);
  }
});

test('funnel sorts: most planned, most left out, A to Z', () => {
  assert.deepEqual(FUNNEL_SORTS.map((s) => s.id), ['planned', 'leftOut', 'name']);
  assert.deepEqual(funnelRows(two, 'name', 'count').map((r) => r.label), ['Formula explorer', 'Label the diagram', 'Quiz cards']);
  // left out share over both models: f 6/14, d 3/4, q 1/22
  assert.deepEqual(funnelRows(two, 'leftOut', 'count').map((r) => r.id), ['d', 'f', 'q']);
});

test('funnel from the committed data reproduces the report totals', () => {
  const rows = funnelRows(data.evaluation.models, 'planned', 'count');
  const sum = (i: number, k: 'planned' | 'published' | 'firstTry' | 'repaired') => rows.reduce((a, r) => a + r.byModel[i]![k], 0);
  assert.equal(sum(0, 'planned'), 379); assert.equal(sum(0, 'published'), 348); assert.equal(sum(0, 'firstTry'), 303);
  assert.equal(sum(1, 'planned'), 374); assert.equal(sum(1, 'published'), 342); assert.equal(sum(1, 'firstTry'), 272);
  assert.equal(rows[0]!.label, 'Quiz cards');
  const ld = rows.find((r) => r.id === 'label-diagram-v1')!;
  assert.equal(ld.byModel[0]!.planned, 11); assert.equal(ld.byModel[0]!.published, 4);
  assert.equal(ld.byModel[1]!.planned, 0);
});

test('subject rows pair the two models by subject, in the report order', () => {
  const rows = subjectRows(data.evaluation.models);
  assert.equal(rows.length, 9);
  assert.equal(rows[0]!.label, 'Biology');
  const hist = rows.find((r) => r.id === 'history')!;
  assert.equal(rateText(hist.byModel[1]!.lessons), '68% (15/22)');
});

test('dot-plot position: the axis starts at 40%, clamps outside the domain', () => {
  assert.deepEqual(PLOT_DOMAIN, [0.4, 1]);
  assert.equal(plotPosition(1), 100);
  assert.equal(plotPosition(0.4), 0);
  assert.equal(plotPosition(0.7), 50);
  assert.equal(plotPosition(0.1), 0);
  assert.equal(plotPosition(null), null);
});

test('every subject interval sits inside the plotted domain (nothing is cut off silently)', () => {
  for (const m of data.evaluation.models) for (const s of m.subjects) {
    assert.ok((s.lessons.ci95[0] ?? 1) >= PLOT_DOMAIN[0], `${m.id} ${s.id}`);
  }
});

test('diagram summary: per model runs, published diagrams, and whether the latest run of each figure published', () => {
  const s = diagramSummary(data.diagramRuns.runs);
  const sp = s.find((x) => x.model === 'muse-spark-1.3')!;
  const op = s.find((x) => x.model === 'muse-spark-open')!;
  assert.deepEqual([sp.runs, sp.published, sp.latestAllPublished], [9, 4, true]);
  assert.deepEqual([op.runs, op.published, op.latestAllPublished], [3, 2, true]);
});

test('lesson link: open when the job is on this server, missing when the list says no, unknown while loading', () => {
  assert.equal(lessonLink('job-1', null), 'unknown');
  assert.equal(lessonLink('job-1', [{ jobId: 'job-1' }]), 'open');
  assert.equal(lessonLink('job-2', [{ jobId: 'job-1' }]), 'missing');
});

test('committed data: headline per model and the Open diagram gap are stated', () => {
  assert.equal(reportCell(spark.lessons), '97% (189/194) [94–99%]');
  assert.equal(reportCell(open.lessons), '92% (178/194) [87–95%]');
  assert.equal(data.evaluation.figuresGivenTo, 'muse-spark-1.3');
});
