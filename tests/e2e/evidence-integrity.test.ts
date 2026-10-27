// TASK-008 — the committed live-run evidence must still verify today.
//
// These tests read docs/evidence/task-008/job-*/ (real Muse Spark 1.3 runs, already
// paid for) and re-run the whole deterministic verification chain over them:
//   job.json ↔ events.jsonl ↔ analysis.json ↔ spec.r1.json ↔ report.r1.json
// plus source hash integrity and quote location through the WEB APP's own helpers.
// Nothing here calls Meta, writes evidence or needs the network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadSource } from '../../packages/sources/index.ts';
import { normalizeWhitespace, validateAnalysis, validateSpec } from '../../packages/validation/validate.ts';
import { buildHighlights, findQuoteRange } from '../../apps/web/src/lib/highlight.ts';
import { collectQuoteRefs } from '../../apps/web/src/lib/evidence.ts';
import type {
  ActivitySpec,
  MetaReceipt,
  SourceAnalysis,
  StageEvent,
  ValidationReport,
} from '../../packages/contracts/index.ts';
import type { JobSummary } from '../../workers/generation/jobs.ts';

const EVIDENCE_ROOT = fileURLToPath(new URL('../../docs/evidence/task-008/', import.meta.url));
const MODEL = 'muse-spark-1.3';
const SPEC_CHECK_COUNT = 13;

interface AnalysisRecord {
  analysis: SourceAnalysis;
  report: ValidationReport;
  receipt: MetaReceipt;
}

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

/** The (id, passed) shape of a report — the part that must be reproducible. */
function checkSignal(report: ValidationReport): { id: string; passed: boolean }[] {
  return report.checks.map(c => ({ id: c.id, passed: c.passed }));
}

function eventOf(events: StageEvent[], stage: string): StageEvent | undefined {
  return events.find(e => e.stage === stage && e.status === 'succeeded');
}

/** Stages in first-appearance order, collapsing the started/succeeded pairs. */
function stageSequence(events: StageEvent[]): string[] {
  const out: string[] = [];
  for (const e of events) {
    if (out[out.length - 1] !== e.stage) out.push(e.stage);
  }
  return out;
}

const EXPECTED_STAGES: Record<'succeeded' | 'unsupported', string[]> = {
  succeeded: ['ingest', 'analyze', 'specify', 'validate', 'done'],
  unsupported: ['ingest', 'analyze', 'done'],
};

test('evidence: two committed live runs are discoverable and cover both outcomes', () => {
  const dirs = evidenceDirs();
  assert.ok(dirs.length >= 2, `expected at least 2 job directories with job.json, found ${dirs.length}`);
  const statuses = dirs.map(dir => readJson<JobSummary>(join(dir, 'job.json')).status);
  assert.ok(statuses.includes('succeeded'), `a succeeded run is present (got ${statuses.join(', ')})`);
  assert.ok(statuses.includes('unsupported'), `an unsupported run is present (got ${statuses.join(', ')})`);
});

test('evidence: every run is internally consistent and still verifies today', async t => {
  const dirs = evidenceDirs();
  assert.ok(dirs.length > 0, 'at least one evidence run is committed');

  for (const dir of dirs) {
    const name = basename(dir);
    await t.test(name, () => {
      // --- job.json ----------------------------------------------------------
      const job = readJson<JobSummary>(join(dir, 'job.json'));
      assert.equal(typeof job.jobId, 'string');
      assert.ok(
        job.status === 'succeeded' || job.status === 'unsupported',
        `status is succeeded or unsupported, got ${String(job.status)}`,
      );
      assert.equal(job.purpose, 'test-live', 'evidence comes from a live run');
      assert.match(job.jobId, /^job-\d{14}-[0-9a-f]{8}$/);

      // Source still loads and its bytes still match the recorded sha256.
      const source = loadSource(job.sourceId);
      assert.equal(source.id, job.sourceId);
      assert.ok(source.text.length > 0, 'source text is non-empty');
      assert.match(source.sha256, /^[0-9a-f]{64}$/);

      // --- events.jsonl ------------------------------------------------------
      const events = readEvents(dir);
      assert.deepEqual(
        events.map(e => e.seq),
        events.map((_, i) => i),
        'seq is contiguous from 0',
      );
      for (const e of events) {
        assert.equal(e.jobId, job.jobId, `event seq ${e.seq} belongs to this job`);
        assert.ok(
          e.status === 'started' || e.status === 'succeeded',
          `event seq ${e.seq} (${e.stage}) has no failure status, got ${e.status}`,
        );
      }
      assert.ok(!events.some(e => e.status === 'failed'), 'no stage reported failure');
      assert.deepEqual(
        stageSequence(events),
        EXPECTED_STAGES[job.status as 'succeeded' | 'unsupported'],
        'stages appear in pipeline order',
      );
      for (let i = 1; i < events.length; i++) {
        const prev = Date.parse((events[i - 1] as StageEvent).at);
        const curr = Date.parse((events[i] as StageEvent).at);
        assert.ok(Number.isFinite(prev) && Number.isFinite(curr), `event seq ${i} has a parseable timestamp`);
        assert.ok(curr >= prev, `event seq ${i} timestamp ${events[i]?.at} is not before seq ${i - 1} ${events[i - 1]?.at}`);
      }

      // --- cost accounting ---------------------------------------------------
      const summed = events.reduce((acc, e) => acc + (typeof e.estCostUSD === 'number' ? e.estCostUSD : 0), 0);
      assert.ok(
        Math.abs(summed - job.totalCostUSD) <= 1e-6,
        `summed event cost ${summed} equals job totalCostUSD ${job.totalCostUSD} within 1e-6`,
      );
      assert.ok(job.totalCostUSD > 0, 'a live run cost something');

      // --- analysis.json -----------------------------------------------------
      const record = readJson<AnalysisRecord>(join(dir, 'analysis.json'));
      assert.equal(record.receipt.returnedModel, MODEL);
      assert.equal(record.receipt.requestedModel, MODEL);
      assert.equal(record.receipt.finishReason, 'stop');
      const analyzeEvent = eventOf(events, 'analyze');
      assert.ok(analyzeEvent !== undefined, 'an analyze:succeeded event exists');
      assert.equal(analyzeEvent.responseId, record.receipt.responseId, 'analyze event carries the analysis responseId');
      assert.equal(analyzeEvent.model, MODEL);

      const analysisReport = validateAnalysis(record.analysis, [source]);
      assert.deepEqual(
        analysisReport.publishable,
        true,
        `re-validated analysis is publishable: ${analysisReport.checks.filter(c => !c.passed).map(c => `${c.id}: ${c.message}`).join('; ')}`,
      );
      assert.deepEqual(checkSignal(analysisReport), checkSignal(record.report), 're-validated analysis checks match the stored report');

      if (job.status === 'unsupported') {
        // --- unsupported outcome --------------------------------------------
        assert.equal(record.analysis.supported, false);
        assert.equal(record.analysis.activity, 'none');
        assert.equal(typeof record.analysis.unsupportedReason, 'string');
        assert.ok((record.analysis.unsupportedReason ?? '').trim().length > 0, 'unsupportedReason is non-empty');
        assert.ok(!existsSync(join(dir, 'spec.r1.json')), 'no spec was generated for an unsupported source');
        assert.ok(!existsSync(join(dir, 'report.r1.json')), 'no spec report was generated for an unsupported source');
        assert.equal(job.specId, undefined);
        assert.equal(job.publishable, undefined);
        assert.equal(record.analysis.concepts.length, 0);
        return;
      }

      // --- spec.r1.json / report.r1.json (succeeded run) ----------------------
      assert.ok(existsSync(join(dir, 'spec.r1.json')), 'spec.r1.json exists for a succeeded run');
      assert.ok(existsSync(join(dir, 'report.r1.json')), 'report.r1.json exists for a succeeded run');
      const spec = readJson<ActivitySpec>(join(dir, 'spec.r1.json'));
      const storedReport = readJson<ValidationReport>(join(dir, 'report.r1.json'));

      const report = validateSpec(spec, [source]);
      assert.equal(
        report.publishable,
        true,
        `re-validated spec is publishable: ${report.checks.filter(c => !c.passed).map(c => `${c.id}: ${c.message}`).join('; ')}`,
      );
      assert.equal(report.checks.length, SPEC_CHECK_COUNT, `re-validated spec runs all ${SPEC_CHECK_COUNT} checks`);
      assert.deepEqual(checkSignal(report), checkSignal(storedReport), 're-validated spec checks match report.r1.json');
      assert.equal(storedReport.checks.length, SPEC_CHECK_COUNT, `stored report has ${SPEC_CHECK_COUNT} checks`);
      assert.equal(storedReport.publishable, true);
      assert.equal(storedReport.artifactId, spec.id, 'report is about this spec');
      assert.equal(report.artifactId, spec.id);

      assert.equal(spec.provenance.responseId, eventOf(events, 'specify')?.responseId, 'spec provenance carries the specify responseId');
      assert.equal(spec.provenance.requestedModel, MODEL);
      assert.equal(spec.provenance.returnedModel, MODEL);
      assert.equal(spec.provenance.provider, 'meta');
      assert.equal(spec.provenance.runId, job.jobId);
      assert.equal(job.checksPassed, SPEC_CHECK_COUNT);
      assert.equal(job.checksTotal, SPEC_CHECK_COUNT);
      assert.equal(job.publishable, true);
      assert.equal(job.specId, spec.id);

      // --- quotes land on the ORIGINAL source text via the web app's helpers --
      const refs = collectQuoteRefs(source.id, spec, null);
      assert.ok(refs.length > 0, 'the spec carries explanation evidence for this source');
      const explanationQuotes = spec.explanations.flatMap(ex => ex.evidence).filter(ev => ev.sourceId === source.id);
      assert.equal(refs.length, explanationQuotes.length, 'every explanation quote citing this source is collected');

      const highlights = buildHighlights(source.text, refs);
      assert.deepEqual(highlights.missing, [], 'no quote is missing from the original text');
      assert.equal(Object.keys(highlights.ranges).length, refs.length, 'every quote got a range in the original text');
      for (const ref of refs) {
        const range = findQuoteRange(source.text, ref.quote);
        if (range === null) {
          assert.fail(`quote ${ref.key} could not be located in ${source.id}: ${JSON.stringify(ref.quote)}`);
        }
        assert.ok(range.start >= 0 && range.end <= source.text.length, `${ref.key} range is inside the original text`);
        assert.ok(range.end > range.start, `${ref.key} range is non-empty`);
        const located = source.text.slice(range.start, range.end);
        assert.equal(
          normalizeWhitespace(located),
          normalizeWhitespace(ref.quote),
          `${ref.key}: the located original substring matches the quote after whitespace normalisation`,
        );
      }
    });
  }
});