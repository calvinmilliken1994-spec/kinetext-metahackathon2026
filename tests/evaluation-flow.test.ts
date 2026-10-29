// S6-W — evaluation driver flow support: `--flow lesson|activity` parsing (default activity,
// so the PRE-REGISTERED evaluation stays v1), the lesson admission arithmetic, and the
// no-drift guarantee for the mirrored Stage 6 output caps. Pure functions; no I/O, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  admissionLimitsFromConfig,
  DEFAULT_EVAL_FLOW,
  evalFlowFromArgv,
  LESSON_ANALYSIS_MAX_OUTPUT_TOKENS,
  LESSON_COMPONENT_MAX_OUTPUT_TOKENS,
  LESSON_MAX_KIT_COMPONENTS,
  perJobAdmissionUSD,
  perJobLessonAdmissionUSD,
  recoveredRecord,
} from '../scripts/evaluation-budget.ts';
import {
  ANALYSIS_V2_MAX_OUTPUT_TOKENS,
  KIT_CALL_MAX_OUTPUT_TOKENS,
} from '../packages/meta/pipeline-v2.ts';
import { reservationUSD } from '../packages/meta/pricing.ts';

test('evalFlowFromArgv: default activity, explicit flows, everything else throws EVAL_FLOW_INVALID', () => {
  assert.equal(DEFAULT_EVAL_FLOW, 'activity');
  assert.equal(evalFlowFromArgv(['node', 'run.ts']), 'activity');
  assert.equal(evalFlowFromArgv(['node', 'run.ts', '--flow', 'lesson']), 'lesson');
  assert.equal(evalFlowFromArgv(['node', 'run.ts', '--flow', 'activity']), 'activity');
  for (const bad of [
    ['--flow'],
    ['--flow', 'v2'],
    ['--flow', ''],
    ['--flow', 'LESSON'],
    ['--flow', '--model'],
  ]) {
    assert.throws(
      () => evalFlowFromArgv(['node', 'run.ts', ...bad]),
      (err: unknown) => err instanceof Error && err.message === 'EVAL_FLOW_INVALID',
      `--flow ${JSON.stringify(bad)} must fail closed`,
    );
  }
});

test('the mirrored Stage 6 caps never drift from the Muse pipeline constants', () => {
  assert.equal(LESSON_ANALYSIS_MAX_OUTPUT_TOKENS, ANALYSIS_V2_MAX_OUTPUT_TOKENS);
  assert.equal(LESSON_COMPONENT_MAX_OUTPUT_TOKENS, KIT_CALL_MAX_OUTPUT_TOKENS);
  assert.equal(LESSON_MAX_KIT_COMPONENTS, 3);
});

test('perJobLessonAdmissionUSD: the conservative lesson worst case, fail-closed without maxInputTokensV2', () => {
  const limits = {
    maxInputTokens: 32000,
    maxOutputTokens: 32000,
    analysisMaxOutputTokens: 16000,
    maxRepairAttempts: 2,
    maxRetries: 1,
    maxInputTokensV2: 72000,
  };
  const lesson = perJobLessonAdmissionUSD(limits, 'muse-spark-1.3');
  const expected =
    (reservationUSD('muse-spark-1.3', 72000, 16000) +
      3 * reservationUSD('muse-spark-1.3', 72000, 12000) +
      reservationUSD('muse-spark-1.3', 72000, 32000)) *
    3 *
    2;
  assert.ok(Math.abs(lesson - expected) < 1e-12, `lesson admission ${lesson} != ${expected}`);
  assert.ok(lesson > perJobAdmissionUSD(limits, 'muse-spark-1.3'), 'a lesson can cost more than one v1 job');
  const { maxInputTokensV2: _drop, ...withoutV2 } = limits;
  assert.throws(
    () => perJobLessonAdmissionUSD(withoutV2, 'muse-spark-1.3'),
    (err: unknown) => err instanceof Error && err.message === 'ADMISSION_LIMITS_INVALID',
  );
});

test('admissionLimitsFromConfig passes maxInputTokensV2 through when present', () => {
  const parsed = admissionLimitsFromConfig({
    maxInputTokens: 32000,
    maxOutputTokens: 32000,
    analysisMaxOutputTokens: 16000,
    maxRepairAttempts: 2,
    maxRetries: 1,
    maxInputTokensV2: 72000,
  });
  assert.equal(parsed.maxInputTokensV2, 72000);
  const legacy = admissionLimitsFromConfig({
    maxInputTokens: 32000,
    maxOutputTokens: 32000,
    analysisMaxOutputTokens: 16000,
    maxRepairAttempts: 2,
    maxRetries: 1,
  });
  assert.equal(legacy.maxInputTokensV2, undefined, 'a pre-Stage-6 config still parses for v1 runs');
});

test('recoveredRecord carries flow and the lesson progress fields through', () => {
  const page = {
    sourceId: 'src', candidate: 1, subject: 'physics', expected: 'x', acceptable: [], difficulty: 'easy',
  };
  const lessonRecord = recoveredRecord(
    page,
    {
      jobId: 'j1',
      status: 'succeeded',
      totalCostUSD: 0.07,
      flow: 'lesson',
      lesson: {
        overviewReady: true,
        componentsPlanned: 2,
        componentsPublished: 1,
        componentsFailed: 1,
        partialPublish: true,
      },
    },
    '2026-10-30T01:00:00.000Z',
  );
  assert.equal(lessonRecord['flow'], 'lesson');
  assert.equal(lessonRecord['componentsPlanned'], 2);
  assert.equal(lessonRecord['componentsPublished'], 1);
  assert.equal(lessonRecord['componentsFailed'], 1);
  assert.equal(lessonRecord['overviewPublished'], true);
  assert.equal(lessonRecord['interactivePublished'], true);
  assert.equal(lessonRecord['partialPublish'], true);

  const legacy = recoveredRecord(page, { jobId: 'j2', status: 'failed', totalCostUSD: 0.1 }, '2026-10-30T01:00:00.000Z');
  assert.equal(legacy['flow'], null, 'never invented for a summary that predates the field');
  assert.equal(legacy['componentsPlanned'], null);
  assert.equal(legacy['overviewPublished'], false);
  assert.equal(legacy['interactivePublished'], false);
});
