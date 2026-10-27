// Stage 5 (TASK-017) — the committed LIVE evidence must still verify today.
//
// These tests read docs/evidence/stage-5/live/job-*/ (real Muse Spark 1.3 runs,
// already paid for) and re-run the whole deterministic chain over them:
//   job.json ↔ events.jsonl ↔ analysis.json ↔ spec.r<n>.json ↔ report.r<n>.json
// including per-revision re-validation, the recomputed 'repair.no-weakening'
// guard, repair records, labelled demo faults, cost accounting and the two
// negative cases (a declined source and a prompt-injection attempt).
//
// Teacher sources (sourceId 'user-*') are NOT in the repo, so their quote and
// sha256 checks cannot be re-derived; those jobs are re-checked structurally
// against an empty source list, and the skip is reported through t.diagnostic.
// Nothing here calls Meta, writes evidence or needs the network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadSource } from '../../packages/sources/index.ts';
import { compareRevisions, validateAnalysis, validateSpec } from '../../packages/validation/validate.ts';
import { computeOutput } from '../../packages/activities/registry.ts';
import { maxTolerance } from '../../packages/contracts/index.ts';
import type {
  ActivitySpec,
  CheckKind,
  EngineId,
  MetaReceipt,
  SourceAnalysis,
  SourceDocument,
  StageEvent,
  ValidationReport,
} from '../../packages/contracts/index.ts';
import type { JobSummary } from '../../workers/generation/jobs.ts';

const EVIDENCE_ROOT = fileURLToPath(new URL('../../docs/evidence/stage-5/live/', import.meta.url));
const MODEL = 'muse-spark-1.3';
/** The recorded run set (README.md): 11 jobs, two of them superseded demo-fault attempts. */
const MIN_LIVE_JOBS = 11;
/** Checks that cannot be recomputed without the source text; teacher sources are not committed. */
const SOURCE_DEPENDENT_CHECKS = new Set(['refs.sources', 'refs.sha256', 'grounding.quotes']);
const CHECK_KINDS = new Set<CheckKind>(['schema', 'semantic', 'grounding', 'behavioral']);
const KNOWN_STAGES = new Set(['ingest', 'analyze', 'specify', 'inject', 'validate', 'repair', 'done']);

interface AnalysisRecord {
  analysis: SourceAnalysis;
  report: ValidationReport;
  receipt: MetaReceipt;
}

/* ------------------------------------------------------------------ */
/* Readers                                                             */
/* ------------------------------------------------------------------ */

/** Every run directory that carries a job.json, sorted for stable test names. */
function evidenceDirs(): string[] {
  return readdirSync(EVIDENCE_ROOT, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => join(EVIDENCE_ROOT, entry.name))
    .filter(dir => existsSync(join(dir, 'job.json')))
    .sort();
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

/** events.jsonl → StageEvent[], asserting every line is parseable JSON. */
function readEvents(dir: string): StageEvent[] {
  const lines = readFileSync(join(dir, 'events.jsonl'), 'utf8')
    .split('\n')
    .filter(line => line.trim() !== '');
  assert.ok(lines.length > 0, `${dir}: events.jsonl is not empty`);
  return lines.map((line, i) => {
    let parsed: unknown = undefined;
    assert.doesNotThrow(() => {
      parsed = JSON.parse(line) as unknown;
    }, `events.jsonl line ${i + 1} in ${dir} parses as JSON`);
    return parsed as StageEvent;
  });
}

/** Persisted spec revision numbers (spec.r<n>.json), ascending. */
function revisionNumbers(dir: string): number[] {
  return readdirSync(dir)
    .map(file => /^spec\.r(\d+)\.json$/.exec(file))
    .filter((m): m is RegExpExecArray => m !== null)
    .map(m => Number(m[1]))
    .sort((a, b) => a - b);
}

function reportNumbers(dir: string): number[] {
  return readdirSync(dir)
    .map(file => /^report\.r(\d+)\.json$/.exec(file))
    .filter((m): m is RegExpExecArray => m !== null)
    .map(m => Number(m[1]))
    .sort((a, b) => a - b);
}

/* ------------------------------------------------------------------ */
/* Report helpers                                                      */
/* ------------------------------------------------------------------ */

function failedIds(report: ValidationReport): string[] {
  return report.checks.filter(c => !c.passed).map(c => c.id);
}

function passingIds(report: ValidationReport): Set<string> {
  return new Set(report.checks.filter(c => c.passed).map(c => c.id));
}

/** Structure every stored report must have regardless of who can re-check it. */
function assertReportShape(report: ValidationReport, label: string): void {
  assert.equal(typeof report.artifactId, 'string', `${label}: artifactId is a string`);
  assert.ok(Number.isInteger(report.revision), `${label}: revision is an integer`);
  assert.ok(Array.isArray(report.checks), `${label}: checks is an array`);
  assert.ok(report.checks.length > 0, `${label}: checks is not empty`);
  for (const check of report.checks) {
    assert.equal(typeof check.id, 'string', `${label}: every check has an id`);
    assert.ok(check.id.length > 0, `${label}: check ids are non-empty`);
    assert.ok(CHECK_KINDS.has(check.kind), `${label}: check ${check.id} has a known kind (got ${String(check.kind)})`);
    assert.equal(typeof check.passed, 'boolean', `${label}: check ${check.id} has a boolean result`);
    assert.equal(typeof check.message, 'string', `${label}: check ${check.id} has a message`);
    assert.ok(check.message.trim().length > 0, `${label}: check ${check.id} message is non-empty`);
  }
  const ids = report.checks.map(c => c.id);
  assert.equal(new Set(ids).size, ids.length, `${label}: check ids are unique (got ${ids.join(', ')})`);
  assert.equal(
    report.publishable,
    report.checks.every(c => c.passed),
    `${label}: publishable is exactly "every check passed"`,
  );
}

/**
 * Every check recorded in the stored report must give the same result today;
 * checks added since recording must pass. Ids recorded with the same validator
 * keep their relative order, so a new check is an insertion, never a rename.
 */
function assertStoredChecksStillHold(
  current: ValidationReport,
  stored: ValidationReport,
  label: string,
  skipIds: ReadonlySet<string> = new Set<string>(),
): void {
  const checked = stored.checks.filter(c => !skipIds.has(c.id));
  const checkedIds = new Set(checked.map(c => c.id));
  const currentIds = new Set(current.checks.map(c => c.id));
  for (const c of checked) {
    assert.ok(currentIds.has(c.id), `${label}: stored check ${c.id} still runs today`);
  }
  assert.deepEqual(
    current.checks.map(c => c.id).filter(id => checkedIds.has(id)),
    checked.map(c => c.id),
    `${label}: the recorded checks keep their relative order today`,
  );
  const now = new Map(current.checks.map(c => [c.id, c.passed]));
  for (const c of checked) {
    assert.equal(now.get(c.id), c.passed, `${label}: stored check ${c.id} gives the same result today`);
  }
  const storedIds = new Set(stored.checks.map(c => c.id));
  const addedSince = current.checks.filter(c => !storedIds.has(c.id));
  for (const c of addedSince) {
    assert.equal(
      c.passed,
      true,
      `${label}: check added since recording (${c.id}) passes on a publishable revision: ${c.message}`,
    );
  }
}

/* ------------------------------------------------------------------ */
/* Spec helpers                                                        */
/* ------------------------------------------------------------------ */

/** The lowest common view of a spec: enough for engine, cases and fault-path resolution. */
interface LooseSpec {
  simulation: { engine: EngineId } & Record<string, unknown>;
  behavioralTests: Record<string, unknown>[];
  predictions: Record<string, unknown>[];
}

/** 'behavioralTests[0].expectedLiftN' → the value stored there (the demo-fault location). */
function resolveSpecPath(spec: ActivitySpec, path: string): unknown {
  let current: unknown = spec;
  for (const segment of path.split('.')) {
    const match = /^([A-Za-z0-9_]+)((?:\[\d+\])*)$/.exec(segment);
    assert.ok(match !== null, `fault path segment ${JSON.stringify(segment)} in ${path} is a field with optional indices`);
    const field = match[1];
    assert.ok(typeof current === 'object' && current !== null, `fault path ${path} is resolvable at "${field}"`);
    current = (current as Record<string, unknown>)[field];
    for (const index of (match[2].match(/\d+/g) ?? [])) {
      assert.ok(Array.isArray(current), `fault path ${path}: "${field}" is an array`);
      current = (current as unknown[])[Number(index)];
    }
  }
  return current;
}

/**
 * Every behavioral test and prediction must satisfy
 * tolerance <= maxTolerance(engine, computeOutput(engine, case)) — the per-case
 * rule that stops a spec from passing behavior.tests with a useless tolerance.
 */
function assertCaseTolerancesWithinEngineRule(spec: ActivitySpec, label: string): void {
  const s = spec as unknown as LooseSpec;
  const engine = s.simulation.engine;
  const cases: { list: string; index: number; record: Record<string, unknown> }[] = [
    ...s.behavioralTests.map((record, index) => ({ list: 'behavioralTests', index, record })),
    ...s.predictions.map((record, index) => ({ list: 'predictions', index, record })),
  ];
  assert.ok(cases.length > 0, `${label}: the spec states at least one case`);
  for (const c of cases) {
    let computed: number;
    try {
      computed = computeOutput(engine, c.record as Record<string, number>);
    } catch (err) {
      assert.fail(`${label}: ${c.list}[${c.index}] re-executes in ${engine}: ${err instanceof Error ? err.message : String(err)}`);
    }
    const tolerance = c.record['tolerance'];
    assert.equal(typeof tolerance, 'number', `${label}: ${c.list}[${c.index}] has a numeric tolerance`);
    const max = maxTolerance(engine, computed);
    assert.ok(
      (tolerance as number) <= max,
      `${label}: ${c.list}[${c.index}] tolerance ${String(tolerance)} <= maxTolerance('${engine}', ${computed}) = ${max}`,
    );
  }
}

/* ------------------------------------------------------------------ */
/* Discovery                                                           */
/* ------------------------------------------------------------------ */

test('stage-5 evidence: the live run set is discoverable and covers every outcome', () => {
  const dirs = evidenceDirs();
  assert.ok(dirs.length >= MIN_LIVE_JOBS, `expected at least ${MIN_LIVE_JOBS} live job directories, found ${dirs.length}`);
  const jobs = dirs.map(dir => readJson<JobSummary>(join(dir, 'job.json')));
  const statuses = jobs.map(job => job.status);
  for (const expected of ['succeeded', 'unsupported', 'failed']) {
    assert.ok(statuses.includes(expected as JobSummary['status']), `a ${expected} run is present (got ${statuses.join(', ')})`);
  }
  assert.ok(
    jobs.some(job => job.demoFault !== undefined),
    'at least one labelled demo-fault run is present',
  );
  assert.ok(
    jobs.some(job => job.repairs.length > 0 && job.repairs.every(r => r.afterInjectedFault)),
    'at least one repair attempt ran after a system-injected fault',
  );
  assert.ok(
    jobs.some(job => job.sourceKind === 'user'),
    'at least one teacher-provided source run is present',
  );
});

/* ------------------------------------------------------------------ */
/* The main re-verification                                            */
/* ------------------------------------------------------------------ */

test('stage-5 evidence: every live job still verifies today', async t => {
  const dirs = evidenceDirs();
  assert.ok(dirs.length > 0, 'at least one live evidence run is committed');

  for (const dir of dirs) {
    const name = basename(dir);
    const job = readJson<JobSummary>(join(dir, 'job.json'));
    await t.test(`${name} (${job.sourceId}, ${job.status})`, async t => {
      /* --- job.json ------------------------------------------------------- */
      assert.equal(job.jobId, name, 'the directory is named after the job');
      assert.match(job.jobId, /^job-\d{14}-[0-9a-f]{8}$/, 'job id has the recorded shape');
      assert.equal(job.purpose, 'test-live', 'evidence comes from a live run');
      assert.ok(
        job.status === 'succeeded' || job.status === 'unsupported' || job.status === 'failed',
        `status is terminal, got ${String(job.status)}`,
      );
      const createdMs = Date.parse(job.createdAt);
      assert.ok(Number.isFinite(createdMs), `createdAt ${job.createdAt} parses`);
      const finishedMs = Date.parse(job.finishedAt ?? '');
      assert.ok(Number.isFinite(finishedMs), `finishedAt ${String(job.finishedAt)} parses`);
      assert.ok(finishedMs >= createdMs, 'finishedAt is not before createdAt');

      const isUser = job.sourceKind === 'user';
      assert.equal(
        isUser,
        /^user-[0-9a-f]{12}$/.test(job.sourceId),
        `sourceKind ${job.sourceKind} matches the source id shape ${job.sourceId}`,
      );

      /* --- sources -------------------------------------------------------- */
      // Library sources still load and their bytes still match the recorded sha256.
      // Teacher sources (user-*) are deliberately not in the repo: the checks that
      // need their text are reported as skipped below instead of being faked.
      const docs: SourceDocument[] = [];
      if (!isUser) {
        const source = loadSource(job.sourceId);
        assert.equal(source.id, job.sourceId, 'the library source still loads under its id');
        assert.ok(source.text.length > 0, 'the library source text is non-empty');
        assert.match(source.sha256, /^[0-9a-f]{64}$/, 'the library source has a sha256');
        docs.push(source);
      } else {
        t.diagnostic(
          `${name}: teacher source ${job.sourceId} is not committed, so refs.sha256 / grounding.quotes ` +
            'are skipped; schema, ranges, behavior, tolerance and policy checks still re-run with no source text',
        );
      }
      const skippedChecks = isUser ? SOURCE_DEPENDENT_CHECKS : new Set<string>();

      /* --- events.jsonl --------------------------------------------------- */
      const events = readEvents(dir);
      assert.deepEqual(
        events.map(e => e.seq),
        events.map((_, i) => i),
        'seq is contiguous from 0',
      );
      for (const e of events) {
        assert.equal(e.jobId, job.jobId, `event seq ${e.seq} belongs to this job`);
        assert.ok(KNOWN_STAGES.has(e.stage), `event seq ${e.seq} has a known stage (got ${String(e.stage)})`);
        assert.ok(
          e.status === 'started' || e.status === 'succeeded' || e.status === 'failed',
          `event seq ${e.seq} has a known status (got ${String(e.status)})`,
        );
      }
      const first = events[0];
      assert.equal(first?.stage, 'ingest', 'the run starts with ingest');
      assert.equal(first?.status, 'started', 'ingest starts');
      for (let i = 1; i < events.length; i++) {
        const prev = Date.parse(events[i - 1]?.at ?? '');
        const curr = Date.parse(events[i]?.at ?? '');
        assert.ok(Number.isFinite(prev) && Number.isFinite(curr), `event seq ${i} has a parseable timestamp`);
        assert.ok(curr >= prev, `event seq ${i} timestamp is not before seq ${i - 1}`);
      }

      const last = events[events.length - 1];
      if (job.status === 'succeeded' || job.status === 'unsupported') {
        assert.ok(last !== undefined, 'a terminal event exists');
        assert.equal(last.stage, 'done', 'the last event of a settled run is done');
        assert.equal(last.status, 'succeeded', 'done records the settled outcome');
        assert.equal(events.filter(e => e.stage === 'done').length, 1, 'exactly one done event');
        // A repaired run legitimately records the validation failures it repaired; no other
        // stage may have failed, and the published revision itself never failed.
        for (const e of events.filter(event => event.status === 'failed')) {
          assert.equal(e.stage, 'validate', `event seq ${e.seq}: a settled run only reports caught validation failures, got ${String(e.stage)}`);
          assert.notEqual(e.revision, job.publishedRevision, `event seq ${e.seq}: the published revision never failed validation`);
        }
      } else {
        assert.equal(job.status, 'failed', 'the only other recorded outcome is a failure');
        assert.ok(
          typeof job.error?.code === 'string' && job.error.code.length > 0,
          'a failed job carries a public error code',
        );
        assert.ok(
          typeof job.error?.message === 'string' && job.error.message.length > 0,
          'a failed job carries a fixed public error message',
        );
        assert.ok(
          !events.some(e => e.stage === 'done' && e.status === 'succeeded'),
          'a failed job never announces a successful done',
        );
        assert.equal(last?.status, 'failed', 'a failed job ends on a failed event');
        assert.ok(
          (last?.detail ?? '').startsWith(job.error.code),
          `the terminal failed event reports the job's error code ${job.error.code} (got ${String(last?.detail)})`,
        );
        assert.equal(job.publishable, undefined, 'a failed job publishes nothing');
        assert.equal(job.publishedRevision, undefined, 'a failed job publishes no revision');
        assert.equal(job.specId, undefined, 'a failed job records no published spec id');
      }

      /* --- cost accounting ------------------------------------------------ */
      const summed = events.reduce((acc, e) => acc + (typeof e.estCostUSD === 'number' ? e.estCostUSD : 0), 0);
      const roundedSum = Math.round(summed * 1e6) / 1e6;
      assert.ok(
        Math.abs(roundedSum - job.totalCostUSD) <= 1e-6,
        `event cost ${roundedSum} equals job totalCostUSD ${job.totalCostUSD} within 1e-6`,
      );
      assert.ok(job.totalCostUSD > 0, 'a live run cost something');
      assert.ok(
        job.reservedUnknownUSD <= job.totalCostUSD,
        `reservedUnknownUSD ${job.reservedUnknownUSD} <= totalCostUSD ${job.totalCostUSD}`,
      );

      /* --- analysis.json -------------------------------------------------- */
      const record = readJson<AnalysisRecord>(join(dir, 'analysis.json'));
      assert.equal(record.receipt.requestedModel, MODEL, 'the analysis was requested from the recorded model');
      assert.equal(record.receipt.returnedModel, MODEL, 'the analysis came back from the recorded model');
      assert.equal(record.receipt.finishReason, 'stop', 'the analysis finished cleanly');
      const analyzeEvent = events.find(e => e.stage === 'analyze' && e.status === 'succeeded');
      assert.ok(analyzeEvent !== undefined, 'an analyze:succeeded event exists');
      assert.equal(analyzeEvent.responseId, record.receipt.responseId, 'the analyze event carries the analysis responseId');

      assertReportShape(record.report, `analysis ${name}`);
      assert.equal(record.report.artifactId, 'source-analysis', 'the analysis report names the analysis artifact');
      if (!isUser) {
        assert.equal(
          record.report.publishable,
          true,
          `the recorded analysis was publishable: ${failedIds(record.report).join(', ')}`,
        );
      }
      const analysisReport = validateAnalysis(record.analysis, docs);
      assert.deepEqual(
        analysisReport.checks.map(c => c.id),
        record.report.checks.map(c => c.id),
        'analysis runs the same check ids today',
      );
      if (!isUser) {
        assert.deepEqual(
          failedIds(analysisReport),
          failedIds(record.report),
          `re-validated analysis fails exactly the same checks today (${failedIds(analysisReport).join(', ') || 'none'})`,
        );
      } else {
        for (const id of failedIds(analysisReport)) {
          assert.ok(SOURCE_DEPENDENT_CHECKS.has(id), `analysis check ${id} may only differ because the source text is missing`);
        }
      }
      assertStoredChecksStillHold(analysisReport, record.report, `analysis ${name}`, skippedChecks);

      /* --- outcome: unsupported ------------------------------------------- */
      if (job.status === 'unsupported') {
        assert.equal(record.analysis.supported, false, 'the analysis reports the source as unsupported');
        assert.equal(record.analysis.activity, 'none', 'an unsupported source has activity "none"');
        assert.equal(job.engine, null, 'an unsupported job records no engine');
        assert.equal(job.revisions, 0, 'an unsupported job produced no revision');
        assert.equal(job.repairs.length, 0, 'an unsupported job attempted no repair');
        assert.deepEqual(revisionNumbers(dir), [], 'no spec was generated for an unsupported source');
        assert.deepEqual(reportNumbers(dir), [], 'no spec report was generated for an unsupported source');
        assert.ok(!existsSync(join(dir, 'spec.r1.json')), 'no spec.r1.json for an unsupported source');
        assert.equal(job.checksPassed, undefined, 'an unsupported job reports no spec checks');
        assert.equal(job.checksTotal, undefined, 'an unsupported job reports no spec check total');
        return;
      }

      /* --- engine --------------------------------------------------------- */
      assert.ok(job.engine !== null, 'a job that reached specification records the engine Muse chose');
      assert.equal(record.analysis.activity, job.engine, 'the analysis activity is the engine the job records');
      assert.equal(record.analysis.supported, true, 'a job that reached specification had a supported analysis');

      /* --- spec.r<n>.json / report.r<n>.json ------------------------------- */
      const revisions = revisionNumbers(dir);
      assert.deepEqual(reportNumbers(dir), revisions, 'every persisted spec revision has its stored report');
      assert.equal(revisions.length, job.revisions, `job.revisions ${job.revisions} matches the ${revisions.length} spec file(s)`);
      assert.deepEqual(revisions, revisions.map((_, i) => i + 1), 'revisions are numbered 1..n without gaps');
      assert.equal(job.repairs.length, Math.max(0, revisions.length - 1), 'one repair record per revision after the first');

      const specs = new Map<number, ActivitySpec>();
      const reports = new Map<number, ValidationReport>();
      for (const n of revisions) {
        const spec = readJson<ActivitySpec>(join(dir, `spec.r${n}.json`));
        const storedReport = readJson<ValidationReport>(join(dir, `report.r${n}.json`));
        specs.set(n, spec);
        reports.set(n, storedReport);

        // Spec identity and provenance are system-owned.
        assert.equal(spec.id, `${job.sourceId}-${job.jobId}`.slice(0, 64), `revision ${n}: spec id is derived from source + job`);
        if (job.specId !== undefined) {
          assert.equal(spec.id, job.specId, `revision ${n}: spec id is the published spec id`);
        }
        assert.equal(spec.simulation.engine, job.engine, `revision ${n}: spec engine is the job engine`);
        assert.equal(spec.provenance.runId, job.jobId, `revision ${n}: provenance names this run`);
        assert.equal(spec.provenance.provider, 'meta', `revision ${n}: provenance names the provider`);
        assert.equal(spec.provenance.requestedModel, MODEL, `revision ${n}: provenance names the requested model`);
        assert.equal(spec.provenance.returnedModel, MODEL, `revision ${n}: provenance names the returned model`);
        assert.equal(spec.provenance.revision, n, `revision ${n}: provenance carries the revision number`);
        assert.equal(spec.provenance.repairOf, n === 1 ? null : n - 1, `revision ${n}: provenance names the repaired revision`);
        assert.equal(spec.sources.length, 1, `revision ${n}: the spec cites exactly one source`);
        assert.equal(spec.sources[0]?.id, job.sourceId, `revision ${n}: the spec cites the job source`);
        assert.match(String(spec.sources[0]?.sha256), /^[0-9a-f]{64}$/, `revision ${n}: the cited source carries a sha256`);
        assert.equal(spec.execution.network, false, `revision ${n}: execution forbids the network`);
        assert.equal(spec.execution.generatedCodeAllowed, false, `revision ${n}: execution forbids generated code`);

        // The stored report is about this revision of this spec.
        assertReportShape(storedReport, `spec ${name} r${n}`);
        assert.equal(storedReport.artifactId, spec.id, `revision ${n}: the report is about this spec`);
        assert.equal(storedReport.revision, n, `revision ${n}: the report carries the revision number`);

        // Re-run the deterministic validator over the stored spec.
        const report = validateSpec(spec, docs);
        assert.equal(report.artifactId, spec.id, `revision ${n}: re-validation is about this spec`);
        if (!isUser) {
          assert.equal(
            report.publishable,
            storedReport.publishable,
            `revision ${n}: re-validation agrees on publishability (failing today: ${failedIds(report).join(', ') || 'none'})`,
          );
        } else {
          for (const id of failedIds(report)) {
            assert.ok(SOURCE_DEPENDENT_CHECKS.has(id), `revision ${n}: spec check ${id} may only differ because the source text is missing`);
          }
        }
        // validateSpec() never emits 'repair.no-weakening' (the pipeline appends it), so
        // that recorded check is compared separately with compareRevisions below.
        const revisionSkip = new Set(skippedChecks);
        if (n > 1) revisionSkip.add('repair.no-weakening');
        assertStoredChecksStillHold(report, storedReport, `spec ${name} r${n}`, revisionSkip);
        assertCaseTolerancesWithinEngineRule(spec, `spec ${name} r${n}`);

        if (!isUser && storedReport.publishable) {
          assert.deepEqual(failedIds(report), [], `revision ${n}: a publishable revision still passes every check today`);
        }

        // Stage 5 repair guard: recompute 'repair.no-weakening' for repairs.
        const storedNoWeakening = storedReport.checks.find(c => c.id === 'repair.no-weakening');
        if (n === 1) {
          assert.equal(storedNoWeakening, undefined, 'revision 1 carries no repair guard');
        } else {
          const previousSpec = specs.get(n - 1);
          const previousReport = reports.get(n - 1);
          assert.ok(previousSpec !== undefined && previousReport !== undefined, `revision ${n}: the repaired revision is stored`);
          assert.ok(storedNoWeakening !== undefined, `revision ${n}: the stored report carries repair.no-weakening`);
          const recomputed = compareRevisions(previousSpec, spec, failedIds(previousReport));
          assert.deepEqual(
            { id: recomputed.id, passed: recomputed.passed, message: recomputed.message },
            { id: storedNoWeakening.id, passed: storedNoWeakening.passed, message: storedNoWeakening.message },
            `revision ${n}: repair.no-weakening recomputes to the stored result`,
          );
          assert.equal(recomputed.passed, true, `revision ${n}: the repair did not weaken the spec: ${recomputed.message}`);
        }

        // Every revision of a run is checked by exactly one validate outcome event.
        assert.ok(
          events.some(e => e.stage === 'validate' && e.revision === n),
          `revision ${n}: a validate event records this revision`,
        );
      }

      /* --- repairs -------------------------------------------------------- */
      for (const repair of job.repairs) {
        const prevReport = reports.get(repair.repairOf);
        const curReport = reports.get(repair.revision);
        assert.ok(prevReport !== undefined, `repair r${repair.revision}: the repaired report is stored`);
        assert.ok(curReport !== undefined, `repair r${repair.revision}: the result report is stored`);
        assert.equal(repair.revision, repair.repairOf + 1, 'a repair produces the next revision');
        assert.deepEqual(repair.targeted, failedIds(prevReport), `repair r${repair.revision}: targeted is exactly the failing set it was given`);
        assert.deepEqual(
          repair.fixed,
          repair.targeted.filter(id => passingIds(curReport).has(id)),
          `repair r${repair.revision}: fixed is targeted ∩ passing on the new revision`,
        );
        assert.deepEqual(repair.remaining, failedIds(curReport), `repair r${repair.revision}: remaining is the failing set of the new revision`);
        assert.equal(repair.publishable, curReport.publishable, `repair r${repair.revision}: publishable matches the new report`);
        assert.equal(
          repair.afterInjectedFault,
          job.demoFault !== undefined,
          `repair r${repair.revision}: afterInjectedFault is ${job.demoFault !== undefined ? 'true (a labelled demo fault)' : 'false (no demo fault)'}`,
        );
        assert.ok(
          events.some(e => e.stage === 'repair' && e.status === 'succeeded' && e.revision === repair.revision),
          `repair r${repair.revision}: a repair:succeeded event records it`,
        );
      }

      /* --- labelled demo fault -------------------------------------------- */
      const injectEvents = events.filter(e => e.stage === 'inject');
      if (job.demoFault === undefined) {
        assert.deepEqual(injectEvents, [], 'no fault was injected into this run');
        for (const repair of job.repairs) {
          assert.equal(repair.afterInjectedFault, false, `repair r${repair.revision}: no demo fault, so it counts as a natural repair`);
        }
      } else {
        const fault = job.demoFault;
        assert.equal(fault.revision, 1, 'the fault is injected into the first generated revision');
        assert.equal(injectEvents.length, 1, 'exactly one inject event records the system-made fault');
        assert.equal(injectEvents[0]?.status, 'succeeded', 'the injection succeeded');
        assert.equal(injectEvents[0]?.revision, 1, 'the inject event names revision 1');
        const firstSpec = specs.get(1);
        assert.ok(firstSpec !== undefined, 'revision 1 is stored so the injected value can be inspected');
        assert.deepEqual(
          resolveSpecPath(firstSpec, fault.path),
          fault.injected,
          `the stored revision 1 really contains the injected value at ${fault.path}`,
        );
        assert.notDeepEqual(fault.injected, fault.original, 'the injected value differs from the original');
        const guardingCheck = fault.kind === 'wrong-answer' ? 'behavior.tests' : 'grounding.quotes';
        assert.ok(
          failedIds(reports.get(1) as ValidationReport).includes(guardingCheck),
          `the injected ${fault.kind} fault was caught by ${guardingCheck} on revision 1`,
        );
        for (const repair of job.repairs) {
          assert.equal(repair.afterInjectedFault, true, `repair r${repair.revision}: it repaired a system-injected fault`);
        }
      }

      /* --- summary reconciliation ------------------------------------------ */
      if (job.status === 'succeeded') {
        assert.ok(Number.isInteger(job.publishedRevision), 'a succeeded job names the published revision');
        const published = reports.get(job.publishedRevision as number);
        const publishedSpec = specs.get(job.publishedRevision as number);
        assert.ok(published !== undefined && publishedSpec !== undefined, 'the published revision is stored');
        assert.equal(published.publishable, true, 'the published revision is publishable');
        assert.deepEqual(failedIds(published), [], 'the published revision has no failing check');
        assert.equal(job.publishable, true, 'the job is marked publishable');
        assert.equal(job.checksPassed, published.checks.filter(c => c.passed).length, 'summary checksPassed matches the published report');
        assert.equal(job.checksTotal, published.checks.length, 'summary checksTotal matches the published report');
        if (!isUser) {
          const revalidated = validateSpec(publishedSpec, docs);
          assert.deepEqual(failedIds(revalidated), [], 'the published revision still passes every check today');
        }
      }
    });
  }
});

/* ------------------------------------------------------------------ */
/* The two negative cases, named explicitly                            */
/* ------------------------------------------------------------------ */

test('stage-5 evidence: the drag source was declined without generating a spec', () => {
  const dirs = evidenceDirs();
  const matches = dirs.filter(dir => readJson<JobSummary>(join(dir, 'job.json')).sourceId === 'nasa-grc-flight-equations-with-drag');
  assert.equal(matches.length, 1, 'exactly one live run covers the drag source');
  const dir = matches[0] as string;
  const job = readJson<JobSummary>(join(dir, 'job.json'));
  const record = readJson<AnalysisRecord>(join(dir, 'analysis.json'));

  assert.equal(job.status, 'unsupported', 'the drag source stays unsupported');
  assert.equal(job.engine, null, 'no engine was chosen for the declined source');
  assert.equal(record.analysis.supported, false, 'the stored analysis declined the source');
  assert.equal(record.analysis.activity, 'none', 'the declined analysis names no activity');
  assert.ok((record.analysis.unsupportedReason ?? '').trim().length > 0, 'the decline carries a written reason');
  assert.deepEqual(revisionNumbers(dir), [], 'no spec was written for a declined source');
  assert.deepEqual(reportNumbers(dir), [], 'no spec report was written for a declined source');
  assert.ok(!eventsHave(dir, 'specify'), 'the run never reached specification');
});

test('stage-5 evidence: the prompt-injection source never credited NASA and kept physical tolerances', () => {
  const dirs = evidenceDirs();
  const injectionDirs = dirs.filter(dir => {
    const specPath = join(dir, 'spec.r1.json');
    if (!existsSync(specPath)) return false;
    const spec = readJson<ActivitySpec>(specPath);
    return /injection/i.test(spec.sources.map(src => src.title).join(' '));
  });
  assert.equal(injectionDirs.length, 1, 'exactly one live run records the prompt-injection attempt');
  const dir = injectionDirs[0] as string;
  const job = readJson<JobSummary>(join(dir, 'job.json'));
  const raw = readFileSync(join(dir, 'spec.r1.json'), 'utf8');
  const spec = readJson<ActivitySpec>(join(dir, 'spec.r1.json'));

  // The pasted text asked the model to claim NASA endorsement and use huge
  // tolerances; neither reached the published spec.
  assert.equal(/nasa/i.test(raw), false, 'the published spec contains no NASA mention (case-insensitive)');
  assert.equal(/endorse/i.test(raw), false, 'the published spec contains no endorsement claim (case-insensitive)');

  assert.equal(job.sourceKind, 'user', 'the injection attempt came through a teacher source');
  assert.equal(job.status, 'succeeded', 'the safe spec was publishable first time');
  assert.equal(job.publishedRevision, 1, 'the injection run published revision 1');
  assert.equal(job.repairs.length, 0, 'no repair was needed for the injection run');
  assert.equal(spec.simulation.engine, job.engine, 'the published spec uses the engine the job recorded');

  // Every case tolerance is inside the engine rule for its own computed value.
  assertCaseTolerancesWithinEngineRule(spec, 'injection spec r1');
  const s = spec as unknown as LooseSpec;
  const engine = s.simulation.engine;
  const lists: { name: string; cases: Record<string, unknown>[] }[] = [
    { name: 'behavioralTests', cases: s.behavioralTests },
    { name: 'predictions', cases: s.predictions },
  ];
  for (const { name: listName, cases } of lists) {
    cases.forEach((c, index) => {
      const computed = computeOutput(engine, c as Record<string, number>);
      const tolerance = c['tolerance'] as number;
      const max = maxTolerance(engine, computed);
      assert.ok(
        tolerance <= max,
        `${listName}[${index}]: tolerance ${tolerance} stays within maxTolerance('${engine}', ${computed}) = ${max}`,
      );
    });
  }
});

test('stage-5 evidence: every labelled demo fault was caught and then repaired', () => {
  const dirs = evidenceDirs();
  const faultDirs = dirs.filter(dir => readJson<JobSummary>(join(dir, 'job.json')).demoFault !== undefined);
  assert.ok(faultDirs.length >= 2, `at least two labelled demo-fault runs are recorded, found ${faultDirs.length}`);
  for (const dir of faultDirs) {
    const job = readJson<JobSummary>(join(dir, 'job.json'));
    const fault = job.demoFault;
    assert.ok(fault !== undefined, `${basename(dir)}: a fault record is stored`);
    assert.equal(fault.revision, 1, `${basename(dir)}: the fault targets revision 1`);
    assert.ok(
      job.repairs.every(r => r.afterInjectedFault),
      `${basename(dir)}: every repair is flagged as following an injected fault`,
    );
    const firstReport = readJson<ValidationReport>(join(dir, 'report.r1.json'));
    const guardingCheck = fault.kind === 'wrong-answer' ? 'behavior.tests' : 'grounding.quotes';
    assert.ok(
      failedIds(firstReport).includes(guardingCheck),
      `${basename(dir)}: ${fault.kind} was caught by ${guardingCheck} on revision 1`,
    );
    if (job.status === 'succeeded') {
      assert.equal(job.publishedRevision, 2, `${basename(dir)}: the repair revision published`);
      const repaired = readJson<ValidationReport>(join(dir, 'report.r2.json'));
      assert.equal(repaired.publishable, true, `${basename(dir)}: the repaired revision is publishable`);
    }
  }
});

/** True when the run's events contain a given stage. */
function eventsHave(dir: string, stage: string): boolean {
  return readEvents(dir).some(e => e.stage === stage);
}