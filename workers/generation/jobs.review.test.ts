// Stage 5 review regressions — S5-01 (immutable baseline: a rejected weakening
// can never become the next baseline), S5-02 (rename/replace/scoped-exception
// bypasses at the worker level), S5-04 (demo faults must demonstrably fail) and
// S5-06 (the ≤2 repair bound fails closed at the worker boundary).
// Every case reproduces a reviewer probe (launder-tolerance, launder-range,
// rename-tolerance, replace-case, exception.mjs, fault-negative-two,
// fault-normalized-quote) through the REAL worker with fake MetaClients.
// No network, no credits, no .env access, no live Meta calls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { applyDemoFault, readJob, startJob } from './jobs.ts';
import type { JobSummary } from './jobs.ts';
import type { CompleteRequest, MetaClient } from '../../packages/meta/client.ts';
import {
  liftSourceDoc,
  makeLiftSpec,
  makeProjectileSpec,
  projectileSourceDoc,
} from '../../packages/validation/fixtures/engine-specs.ts';
import { normalizeWhitespace } from '../../packages/validation/validate.ts';
import { loadSource, saveUserSource, sha256, userSourcesDirOf } from '../../packages/sources/index.ts';
import { validateUserSourceInput } from '../../packages/contracts/index.ts';
import type {
  ActivitySpec,
  GeneratedSpec,
  MetaReceipt,
  SourceAnalysis,
  StageEvent,
  ValidationReport,
} from '../../packages/contracts/index.ts';

const analysisFixture = JSON.parse(
  readFileSync(new URL('../../tests/fixtures/nasa-analysis.recorded.json', import.meta.url), 'utf8'),
) as SourceAnalysis;
const genFixture = JSON.parse(
  readFileSync(new URL('../../tests/fixtures/nasa-gen.recorded.json', import.meta.url), 'utf8'),
) as GeneratedSpec;

function fakeReceipt(responseId: string): MetaReceipt {
  return {
    purpose: 'test-live',
    requestedModel: 'muse-spark-1.3',
    returnedModel: 'muse-spark-1.3',
    responseId,
    usage: { promptTokens: 1200, completionTokens: 800, reasoningTokens: 300, cachedTokens: 0 },
    latencyMs: 42,
    estCostUSD: 0.01,
    finishReason: 'stop',
    attempts: 1,
  };
}

interface StagedOptions {
  analysis?: unknown;
  rev1?: unknown;
  /** One payload per 'activity_spec_repair' call (shifted); falls back to rev1/genFixture. */
  repairs?: unknown[];
}

function stagedClient(opts: StagedOptions = {}): { client: MetaClient; repairCount: () => number } {
  let repairCalls = 0;
  const client: MetaClient = {
    complete: <T>(req: CompleteRequest): Promise<{ data: T; receipt: MetaReceipt }> => {
      if (req.schemaName === 'source_analysis') {
        return Promise.resolve({ data: (opts.analysis ?? analysisFixture) as T, receipt: fakeReceipt('fake-analysis-1') });
      }
      if (req.schemaName === 'activity_spec') {
        return Promise.resolve({ data: (opts.rev1 ?? genFixture) as T, receipt: fakeReceipt('fake-gen-1') });
      }
      repairCalls += 1;
      const fallback = opts.rev1 ?? genFixture;
      const data: unknown = opts.repairs !== undefined && opts.repairs.length > 0 ? opts.repairs.shift() : fallback;
      return Promise.resolve({ data: data as T, receipt: fakeReceipt(`fake-repair-${repairCalls}`) });
    },
  };
  return { client, repairCount: (): number => repairCalls };
}

function tempStorage(): string {
  return mkdtempSync(join(tmpdir(), 's5-review-jobs-'));
}

function readEvents(storageDir: string, jobId: string): StageEvent[] {
  return readFileSync(join(storageDir, 'runs', jobId, 'events.jsonl'), 'utf8')
    .split('\n')
    .filter(line => line.trim() !== '')
    .map(line => JSON.parse(line) as StageEvent);
}

function readReport(storageDir: string, jobId: string, n: number): ValidationReport {
  return JSON.parse(
    readFileSync(join(storageDir, 'runs', jobId, `report.r${n}.json`), 'utf8'),
  ) as ValidationReport;
}

function failedIds(report: ValidationReport): string[] {
  return report.checks.filter(c => !c.passed).map(c => c.id);
}

function noWeakening(report: ValidationReport): { passed: boolean; message: string } {
  const check = report.checks.find(c => c.id === 'repair.no-weakening');
  assert.ok(check !== undefined, 'the repair report carries repair.no-weakening');
  return { passed: check.passed, message: check.message };
}

type GenTests = GeneratedSpec & { behavioralTests: Record<string, unknown>[]; predictions: Record<string, unknown>[] };

function cloneGen(gen: GeneratedSpec = genFixture): GenTests {
  return structuredClone(gen) as GenTests;
}

/** genFixture with the first expected acceleration moved 0.005 away (behavior.tests fails at tolerance 0.001). */
function wrongBy005(): GenTests {
  const bad = cloneGen();
  bad.behavioralTests[0]['expectedAccelerationMps2'] = 5.005;
  return bad;
}

/** The reviewer's laundering "repair": same wrong answer, tolerance widened 0.001 → 0.01. */
function widenedStillWrong(): GenTests {
  const bad = wrongBy005();
  bad.behavioralTests[0]['tolerance'] = 0.01;
  return bad;
}

/* ------------------------------------------------------------------ */
/* S5-01 — the baseline is revision 1, forever                          */
/* ------------------------------------------------------------------ */

test('S5-01 launder-tolerance: r1 → weakened r2 (rejected) → identical r3 must still be rejected', async () => {
  const storageDir = tempStorage();
  const { client, repairCount } = stagedClient({
    rev1: wrongBy005(),
    repairs: [widenedStillWrong(), structuredClone(widenedStillWrong())],
  });
  const { jobId, done } = startJob('nasa-grc-equations-of-motion', { client, storageDir, purpose: 'test-live' });
  const summary: JobSummary = await done;

  assert.equal(summary.status, 'failed');
  assert.deepEqual(summary.error, { code: 'VALIDATION_FAILED', message: 'generated spec failed validation' });
  assert.equal(summary.publishedRevision, undefined, 'the repeated rejected weakening is never published');
  assert.equal(summary.publishable, undefined);
  assert.equal(repairCount(), 2, 'both repair attempts ran');
  assert.equal(summary.revisions, 3);
  assert.equal(summary.bestRevision, 1, 'the tie resolves to the earliest revision');
  assert.equal(summary.repairs.length, 2);
  assert.equal(summary.repairs[0]?.publishable, false);
  assert.equal(summary.repairs[1]?.publishable, false);

  // r2 fails ONLY the guard: the widened tolerance hides the wrong answer from behavior.tests.
  const report2 = readReport(storageDir, jobId, 2);
  assert.ok(!failedIds(report2).includes('behavior.tests'), 'the widened tolerance masks the wrong answer');
  assert.deepEqual(failedIds(report2), ['repair.no-weakening']);
  assert.match(noWeakening(report2).message, /tolerance increased from 0\.001 to 0\.01/);

  // r3 is byte-identical to the rejected r2 — against the immutable baseline it fails again.
  const report3 = readReport(storageDir, jobId, 3);
  assert.deepEqual(failedIds(report3), ['repair.no-weakening']);
  assert.match(noWeakening(report3).message, /tolerance increased from 0\.001 to 0\.01/);
  assert.equal(readJob(storageDir, jobId)?.summary.status, 'failed');
});

test('S5-01 launder-range: r1 → narrowed-range r2 (rejected) → identical r3 must still be rejected', async () => {
  const storageDir = tempStorage();
  const shrink = cloneGen();
  const mass = (shrink.simulation as unknown as Record<string, { min: number; max: number; default: number }>)['massKg'];
  assert.ok(mass !== undefined);
  mass.max -= 1; // honest answers, narrower mass slider
  const { client } = stagedClient({ rev1: wrongBy005(), repairs: [shrink, structuredClone(shrink)] });
  const { jobId, done } = startJob('nasa-grc-equations-of-motion', { client, storageDir, purpose: 'test-live' });
  const summary = await done;

  assert.equal(summary.status, 'failed');
  assert.equal(summary.error?.code, 'VALIDATION_FAILED');
  assert.equal(summary.publishedRevision, undefined);
  assert.equal(summary.revisions, 3);

  const report2 = readReport(storageDir, jobId, 2);
  assert.deepEqual(failedIds(report2), ['repair.no-weakening'], 'the shrink is the only violation');
  assert.match(noWeakening(report2).message, /simulation\.massKg range width shrank from 19\.5 to 18\.5/);
  const report3 = readReport(storageDir, jobId, 3);
  assert.deepEqual(failedIds(report3), ['repair.no-weakening'], 'the identical shrink stays rejected against revision 1');
  assert.match(noWeakening(report3).message, /range width shrank/);
});

test('S5-02 rename-tolerance: renaming the failing case never removes the comparison obligation', async () => {
  const storageDir = tempStorage();
  const renamed = widenedStillWrong();
  renamed.behavioralTests[0]['name'] = `${String(renamed.behavioralTests[0]['name'])} renamed`;
  const { client } = stagedClient({ rev1: wrongBy005(), repairs: [renamed, cloneGen()] });
  const { jobId, done } = startJob('nasa-grc-equations-of-motion', { client, storageDir, purpose: 'test-live' });
  const summary = await done;

  assert.equal(summary.status, 'succeeded');
  assert.equal(summary.publishedRevision, 3, 'only the honest r3 publishes');
  const report2 = readReport(storageDir, jobId, 2);
  assert.deepEqual(failedIds(report2), ['repair.no-weakening']);
  assert.match(
    noWeakening(report2).message,
    /"positive net force accelerates forward" from the baseline is missing from the repair/,
  );
});

test('S5-02 replace-case: deleting the failing case and duplicating a passing one under a new name fails', async () => {
  const storageDir = tempStorage();
  const replace = cloneGen(); // honest values — but the failing baseline case is gone
  const cases = replace.behavioralTests;
  assert.ok(cases[1] !== undefined);
  cases[0] = structuredClone(cases[1]);
  cases[0]['name'] = 'Replacement case';
  const { client } = stagedClient({ rev1: wrongBy005(), repairs: [replace, cloneGen()] });
  const { jobId, done } = startJob('nasa-grc-equations-of-motion', { client, storageDir, purpose: 'test-live' });
  const summary = await done;

  assert.equal(summary.status, 'succeeded');
  assert.equal(summary.publishedRevision, 3, 'the unchanged case count does not launder the replacement');
  const report2 = readReport(storageDir, jobId, 2);
  assert.deepEqual(failedIds(report2), ['repair.no-weakening']);
  assert.match(
    noWeakening(report2).message,
    /"positive net force accelerates forward" from the baseline is missing from the repair/,
  );
});

test('S5-02 predictions: renaming a baseline prediction id is rejected like a renamed test', async () => {
  const storageDir = tempStorage();
  const renamedPred = cloneGen();
  renamedPred.predictions[0]['id'] = 'pred-renamed';
  const { client } = stagedClient({ rev1: wrongBy005(), repairs: [renamedPred, cloneGen()] });
  const { jobId, done } = startJob('nasa-grc-equations-of-motion', { client, storageDir, purpose: 'test-live' });
  const summary = await done;

  assert.equal(summary.status, 'succeeded');
  assert.equal(summary.publishedRevision, 3);
  const report2 = readReport(storageDir, jobId, 2);
  assert.deepEqual(failedIds(report2), ['repair.no-weakening']);
  assert.match(noWeakening(report2).message, /predictions "pred-1" from the baseline is missing from the repair/);
});

/* ------------------------------------------------------------------ */
/* S5-02 — exception.mjs reproduced end-to-end on the projectile engine */
/* ------------------------------------------------------------------ */

/** A temp library dir holding the CC0 projectile fixture source (real files, hash-consistent). */
function writeProjectileSourceDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 's5-review-projsrc-'));
  const doc = projectileSourceDoc();
  writeFileSync(join(dir, 'fixture-projectile-source.txt'), doc.text);
  writeFileSync(
    join(dir, 'fixture-projectile-source.json'),
    JSON.stringify(
      {
        id: doc.id,
        title: doc.title,
        locator: doc.locator,
        license: doc.license,
        attribution: doc.attribution,
        sha256: doc.sha256,
        textFile: 'fixture-projectile-source.txt',
        retrievedAt: '2026-10-28T00:00:00.000Z',
        transcription: 'verbatim',
        purpose: 'test-fixture',
      },
      null,
      2,
    ),
  );
  return dir;
}

const projectileAnalysis: SourceAnalysis = {
  supported: true,
  activity: 'projectile-v1',
  unsupportedReason: '',
  concepts: [
    {
      id: 'max-height',
      name: 'Maximum height of a ballistic arc',
      evidence: [
        {
          sourceId: 'fixture-projectile-source',
          quote: 'the maximum height equals the vertical speed squared divided by twice the gravity',
        },
      ],
    },
  ],
  objectives: ['Predict the maximum height from the launch speed and gravity.'],
};

function toGen(full: ActivitySpec): GeneratedSpec {
  const sim = full.simulation as unknown as Record<string, unknown>;
  const genSim: Record<string, unknown> = {};
  for (const key of Object.keys(sim)) {
    if (key === 'engine' || key === 'equation') continue;
    const v: unknown = sim[key];
    if (
      typeof v === 'object' && v !== null &&
      'min' in (v as Record<string, unknown>) &&
      'max' in (v as Record<string, unknown>) &&
      'default' in (v as Record<string, unknown>)
    ) {
      const r = v as Record<string, unknown>;
      genSim[key] = { min: r.min, max: r.max, default: r.default };
    } else {
      genSim[key] = structuredClone(v);
    }
  }
  return {
    title: full.title,
    learningObjectives: [...full.learningObjectives],
    explanations: structuredClone(full.explanations),
    simulation: genSim,
    behavioralTests: structuredClone(full.behavioralTests),
    predictions: structuredClone(full.predictions),
  } as unknown as GeneratedSpec;
}

test('S5-02 exception.mjs: one invalid tolerance must not permit an unrelated tolerance increase', async () => {
  const storageDir = tempStorage();
  const sourcesDir = writeProjectileSourceDir();

  // Baseline r1: case 0 states a wrong answer (tolerance 0.001), case 1 has an
  // excessive tolerance (0.5) → behavior.tests AND semantic.tolerance fail.
  const r1 = toGen(makeProjectileSpec()) as GenTests;
  const c0 = r1.behavioralTests[0];
  const c1 = r1.behavioralTests[1];
  assert.ok(c0 !== undefined && c1 !== undefined);
  c0['expectedMaxHeightM'] = (c0['expectedMaxHeightM'] as number) + 0.05;
  c1['tolerance'] = 0.5;

  // The bypass "repair": case 1's tolerance is fixed, but case 0's tolerance is
  // widened 0.001 → 0.1, masking its unchanged wrong answer. r2 passes EVERY
  // plain validator check — only repair.no-weakening may stop it.
  const r2 = toGen(makeProjectileSpec()) as GenTests;
  const d0 = r2.behavioralTests[0];
  const d1 = r2.behavioralTests[1];
  assert.ok(d0 !== undefined && d1 !== undefined);
  d0['expectedMaxHeightM'] = (d0['expectedMaxHeightM'] as number) + 0.05;
  d0['tolerance'] = 0.1;
  d1['tolerance'] = 0.01;

  const { client } = stagedClient({ analysis: projectileAnalysis, rev1: r1, repairs: [r2] });
  const { jobId, done } = startJob('fixture-projectile-source', {
    client,
    storageDir,
    sourcesDir: pathToFileURL(`${sourcesDir}/`),
    purpose: 'test-live',
    limits: { maxRepairAttempts: 1 },
  });
  const summary = await done;

  assert.equal(summary.status, 'failed');
  assert.equal(summary.error?.code, 'VALIDATION_FAILED');
  assert.equal(summary.publishedRevision, undefined, 'the masking repair never publishes');

  const report1 = readReport(storageDir, jobId, 1);
  assert.deepEqual(failedIds(report1).sort(), ['behavior.tests', 'semantic.tolerance'].sort());
  const report2 = readReport(storageDir, jobId, 2);
  assert.ok(!failedIds(report2).includes('behavior.tests'), 'the widened tolerance masks the wrong answer');
  assert.ok(!failedIds(report2).includes('semantic.tolerance'), 'the invalid tolerance was fixed');
  assert.deepEqual(failedIds(report2), ['repair.no-weakening']);
  assert.match(noWeakening(report2).message, /"earth launch" tolerance increased from 0\.001 to 0\.1/);
});

/* ------------------------------------------------------------------ */
/* S5-04 — demo faults must demonstrably fail the intended check        */
/* ------------------------------------------------------------------ */

function forcesCaseStub(massKg: number, netForceN: number, expected: number): GeneratedSpec {
  return {
    behavioralTests: [{ name: 'stub', massKg, netForceN, expectedAccelerationMps2: expected, tolerance: 0.001 }],
    explanations: [{ id: 'e', text: 't', evidence: [{ sourceId: 's', quote: 'F = m * a' }] }],
  } as unknown as GeneratedSpec;
}

test('S5-04 applyDemoFault: original -2 moves to -1 (the old transform mapped -2 to itself)', () => {
  const gen = forcesCaseStub(2, -4, -2);
  const fault = applyDemoFault('wrong-answer', gen, 'forces-1d-v1', 'job-20260101000000-abcd1234', '');
  assert.deepEqual(fault, {
    kind: 'wrong-answer',
    path: 'behavioralTests[0].expectedAccelerationMps2',
    original: -2,
    injected: -1,
    revision: 1,
  });
  const cases = (gen as unknown as { behavioralTests: Record<string, unknown>[] }).behavioralTests;
  assert.equal(cases[0]?.['expectedAccelerationMps2'], -1, 'the clone carries the injected value');
});

test('S5-04 applyDemoFault: original 0 moves far enough to exceed any allowed tolerance', () => {
  const fault = applyDemoFault('wrong-answer', forcesCaseStub(10, 0, 0), 'forces-1d-v1', 'job-20260101000000-abcd1234', '');
  assert.equal(fault.original, 0);
  assert.equal(fault.injected, 1, 'delta = max(1, 0.5*|0|, 10*maxTolerance) = 1');
});

test('S5-04 applyDemoFault: near the output hard bound the fault subtracts instead', () => {
  // massKg 0.01, netForceN 1000 → computed 100000 = forces hardMax.
  const fault = applyDemoFault('wrong-answer', forcesCaseStub(0.01, 1000, 100000), 'forces-1d-v1', 'job-20260101000000-abcd1234', '');
  assert.equal(fault.original, 100000);
  assert.equal(fault.injected, 50000, 'delta = max(1, 50000, 0.1) = 50000; adding would exceed hardMax so it subtracts');
});

test('S5-04 applyDemoFault: lift scales with the value (12250 → 18375)', () => {
  const gen = {
    behavioralTests: [
      { name: 'cruise lift', liftCoefficient: 0.5, airDensityKgM3: 1.225, airspeedMps: 50, wingAreaM2: 16, expectedLiftN: 12250, tolerance: 0.5 },
    ],
    explanations: [],
  } as unknown as GeneratedSpec;
  const fault = applyDemoFault('wrong-answer', gen, 'lift-equation-v1', 'job-20260101000000-abcd1234', '');
  assert.equal(fault.original, 12250);
  assert.equal(fault.injected, 18375, 'delta = max(1, 6125, 10*maxTolerance(lift, 12250) = 612.5) = 6125');
});

test('S5-04 applyDemoFault: quote absence is checked with the validator whitespace normalisation', () => {
  const jobId = 'job-20260101000000-abcd1234';
  const quoteGen = (): GeneratedSpec =>
    ({
      behavioralTests: [],
      explanations: [{ id: 'e', text: 't', evidence: [{ sourceId: 's', quote: 'F = m * a' }] }],
    }) as unknown as GeneratedSpec;

  // No collision: the nonce comes from the job id.
  const clean = applyDemoFault('fabricated-quote', quoteGen(), 'forces-1d-v1', jobId, 'ordinary source text');
  assert.equal(clean.injected, 'Muse confirmed this result in a controlled laboratory trial (ref abcd1234).');

  // fault-normalized-quote probe: the source contains the sentence with an
  // internal newline. A raw includes() check would miss it and the injected
  // quote would pass whitespace-normalised grounding — the nonce must be re-derived.
  const collidingText = [
    'Ordinary licensed physics text.',
    'Muse confirmed this result in a controlled',
    'laboratory trial (ref abcd1234).',
    'More ordinary text.',
  ].join('\n');
  const gen = quoteGen();
  const fault = applyDemoFault('fabricated-quote', gen, 'forces-1d-v1', jobId, collidingText);
  const injected = String(fault.injected);
  assert.notEqual(injected, 'Muse confirmed this result in a controlled laboratory trial (ref abcd1234).');
  const nonce = /\(ref ([0-9a-f]{8})\)/.exec(injected)?.[1];
  assert.equal(nonce, sha256('abcd1234').slice(0, 8), 'the nonce is re-derived by hashing the colliding one');
  assert.ok(
    !normalizeWhitespace(collidingText).includes(normalizeWhitespace(injected)),
    'the injected sentence is absent from the source even after normalisation',
  );
});

test('S5-04 fault-negative-two: a wrong-answer fault on a negative original is caught and repaired', async () => {
  const storageDir = tempStorage();
  // The probe's revision 1: a fully honest spec whose first answer is -2 — the
  // old transform (x*1.5+1) mapped -2 to itself and the "fault" changed nothing.
  const negative = cloneGen();
  negative.behavioralTests[0]['massKg'] = 2;
  negative.behavioralTests[0]['netForceN'] = -4;
  negative.behavioralTests[0]['expectedAccelerationMps2'] = -2;
  const honest = structuredClone(negative);
  const { client } = stagedClient({ rev1: negative, repairs: [honest] });
  const { jobId, done } = startJob('nasa-grc-equations-of-motion', {
    client,
    storageDir,
    purpose: 'demo',
    demoFault: 'wrong-answer',
  });
  const summary = await done;

  assert.equal(summary.status, 'succeeded');
  assert.equal(summary.publishedRevision, 2, 'the injected fault is caught, so a repair runs');
  assert.deepEqual(summary.demoFault, {
    kind: 'wrong-answer',
    path: 'behavioralTests[0].expectedAccelerationMps2',
    original: -2,
    injected: -1,
    revision: 1,
    effective: true,
  });
  assert.deepEqual(failedIds(readReport(storageDir, jobId, 1)), ['behavior.tests']);
  const inject = readEvents(storageDir, jobId).find(e => e.stage === 'inject');
  assert.equal(inject?.status, 'succeeded');
  assert.equal(
    inject?.detail,
    'demo fault injected by the system: wrong-answer at behavioralTests[0].expectedAccelerationMps2',
  );
});

test('S5-04: an ineffective injected fault is reported honestly and the job proceeds', async () => {
  const storageDir = tempStorage();
  // Model-made r1 whose first answer is already wrong LOW by exactly the fault
  // delta: original 10/3, computed 5, delta = 0.5*|10/3| = 5/3 → injected lands
  // on 5, the honest value. behavior.tests passes → the demo did NOT demonstrate
  // a catch, and the record must say so instead of pretending.
  const inefficient = cloneGen();
  inefficient.behavioralTests[0]['expectedAccelerationMps2'] = 10 / 3;
  const { client, repairCount } = stagedClient({ rev1: inefficient });
  const { jobId, done } = startJob('nasa-grc-equations-of-motion', {
    client,
    storageDir,
    purpose: 'demo',
    demoFault: 'wrong-answer',
  });
  const summary = await done;

  assert.equal(summary.status, 'succeeded', 'the job proceeds honestly on the publishable revision 1');
  assert.equal(summary.publishedRevision, 1);
  assert.equal(repairCount(), 0);
  const fault = summary.demoFault;
  assert.ok(fault !== undefined);
  assert.equal(fault.effective, false, 'the intended check did not fail');
  assert.equal(fault.original, 10 / 3);
  assert.equal(fault.injected, 5);
  const inject = readEvents(storageDir, jobId).find(e => e.stage === 'inject');
  assert.equal(inject?.status, 'succeeded');
  assert.equal(
    inject?.detail,
    'demo fault injected by the system but NOT caught by behavior.tests: wrong-answer at behavioralTests[0].expectedAccelerationMps2',
  );
});

test('S5-04 fault-normalized-quote: a source containing the nonce sentence with an internal newline still yields an effective fault', async () => {
  const storageDir = tempStorage();
  const library = loadSource('nasa-grc-equations-of-motion');
  const sentence = 'Muse confirmed this result in a controlled laboratory trial (ref 1234abcd).';
  const text = `${library.text}\n${sentence.replace('confirmed this', 'confirmed\nthis')}`;
  const validated = validateUserSourceInput({
    title: 'Synthetic review source',
    text,
    license: 'own-work',
    attribution: 'Synthetic review data',
    rightsConfirmed: true,
  });
  assert.ok(validated.ok);
  const sourceId = saveUserSource(validated.value, userSourcesDirOf(storageDir)).id;
  const analysis = JSON.parse(JSON.stringify(analysisFixture).replaceAll(library.id, sourceId)) as SourceAnalysis;
  const gen = JSON.parse(JSON.stringify(genFixture).replaceAll(library.id, sourceId)) as GeneratedSpec;

  const { client } = stagedClient({ analysis, rev1: gen, repairs: [structuredClone(gen)] });
  const { jobId, done } = startJob(sourceId, {
    client,
    storageDir,
    purpose: 'demo',
    demoFault: 'fabricated-quote',
    newJobId: () => 'job-20260101000000-1234abcd',
  });
  const summary = await done;

  assert.equal(summary.status, 'succeeded');
  assert.equal(summary.publishedRevision, 2, 'the effective fault is caught and repaired');
  const fault = summary.demoFault;
  assert.ok(fault !== undefined);
  assert.equal(fault.kind, 'fabricated-quote');
  assert.equal(fault.effective, true);
  const injected = String(fault.injected);
  const nonce = /^Muse confirmed this result in a controlled laboratory trial \(ref ([0-9a-f]{8})\)\.$/.exec(injected)?.[1];
  assert.ok(nonce !== undefined, `injected quote keeps the fixed sentence shape: ${injected}`);
  assert.notEqual(nonce, '1234abcd', 'the colliding job-id nonce is re-derived');
  assert.equal(nonce, sha256('1234abcd').slice(0, 8));
  assert.ok(!normalizeWhitespace(text).includes(normalizeWhitespace(injected)), 'the injected sentence is absent after normalisation');
  assert.deepEqual(failedIds(readReport(storageDir, jobId, 1)), ['grounding.quotes']);
});

/* ------------------------------------------------------------------ */
/* S5-06 — the worker boundary fails closed                             */
/* ------------------------------------------------------------------ */

test('S5-06: startJob throws MAX_REPAIR_ATTEMPTS_INVALID outside integer [0, 2]', () => {
  for (const invalid of [3, 1.5, Number.NaN, -1, Number.POSITIVE_INFINITY, '2' as unknown as number]) {
    const storageDir = tempStorage();
    assert.throws(
      () =>
        startJob('nasa-grc-equations-of-motion', {
          client: stagedClient().client,
          storageDir,
          purpose: 'test-live',
          limits: { maxRepairAttempts: invalid },
        }),
      /MAX_REPAIR_ATTEMPTS_INVALID/,
      `maxRepairAttempts=${String(invalid)} must fail closed`,
    );
  }
});

test('S5-06: startJob accepts integer maxRepairAttempts 0, 1 and 2', async () => {
  for (const valid of [0, 1, 2]) {
    const storageDir = tempStorage();
    const { client } = stagedClient(); // publishable genFixture → no repair needed
    const { done } = startJob('nasa-grc-equations-of-motion', {
      client,
      storageDir,
      purpose: 'test-live',
      limits: { maxRepairAttempts: valid },
    });
    const summary = await done;
    assert.equal(summary.status, 'succeeded', `maxRepairAttempts=${valid} is accepted`);
    assert.equal(summary.publishedRevision, 1);
  }
});

/* ------------------------------------------------------------------ */
/* Lift sanity: the wrong-answer transform on a second engine end-to-end */
/* ------------------------------------------------------------------ */

test('S5-04: lift wrong-answer fault stays effective end-to-end with the bounded transform', async () => {
  const storageDir = tempStorage();
  const dir = mkdtempSync(join(tmpdir(), 's5-review-liftsrc-'));
  const doc = liftSourceDoc();
  writeFileSync(join(dir, 'fixture-lift-source.txt'), doc.text);
  writeFileSync(
    join(dir, 'fixture-lift-source.json'),
    JSON.stringify(
      {
        id: doc.id, title: doc.title, locator: doc.locator, license: doc.license,
        attribution: doc.attribution, sha256: doc.sha256, textFile: 'fixture-lift-source.txt',
        retrievedAt: '2026-10-28T00:00:00.000Z', transcription: 'verbatim', purpose: 'test-fixture',
      },
      null,
      2,
    ),
  );
  const liftAnalysis: SourceAnalysis = {
    supported: true,
    activity: 'lift-equation-v1',
    unsupportedReason: '',
    concepts: [
      {
        id: 'lift-equation',
        name: 'The lift equation',
        evidence: [
          {
            sourceId: 'fixture-lift-source',
            quote: 'lift equals the lift coefficient times the air density times half the velocity squared times the wing area',
          },
        ],
      },
    ],
    objectives: ['Predict lift from coefficient, density, speed and wing area.'],
  };
  const liftGen = toGen(makeLiftSpec());
  const { client } = stagedClient({ analysis: liftAnalysis, rev1: liftGen, repairs: [toGen(makeLiftSpec())] });
  const { done } = startJob('fixture-lift-source', {
    client,
    storageDir,
    sourcesDir: pathToFileURL(`${dir}/`),
    purpose: 'demo',
    demoFault: 'wrong-answer',
  });
  const summary = await done;
  assert.equal(summary.status, 'succeeded');
  assert.equal(summary.publishedRevision, 2);
  assert.deepEqual(summary.demoFault, {
    kind: 'wrong-answer',
    path: 'behavioralTests[0].expectedLiftN',
    original: 12250,
    injected: 18375,
    revision: 1,
    effective: true,
  });
});

/* ------------------------------------------------------------------ */
/* S5-08 — duplicate baseline names/ids through the real worker         */
/* (reviewer probe duplicates.mjs: all four jobs published r2 before    */
/* the fix)                                                             */
/* ------------------------------------------------------------------ */

/** genFixture with behavioralTests[1] renamed to behavioralTests[0]'s name (both numerically correct). */
function duplicateNameGen(): GenTests {
  const dup = cloneGen();
  dup.behavioralTests[1]['name'] = dup.behavioralTests[0]['name'];
  return dup;
}

test('S5-08 duplicate-name-drops-correct-case: deleting the second occurrence of a duplicated name never publishes', async () => {
  const storageDir = tempStorage();
  const dropped = duplicateNameGen();
  dropped.behavioralTests.splice(1, 1); // tests 4 → 3
  const { client, repairCount } = stagedClient({ rev1: duplicateNameGen(), repairs: [dropped, duplicateNameGen()] });
  const { jobId, done } = startJob('nasa-grc-equations-of-motion', { client, storageDir, purpose: 'test-live' });
  const summary: JobSummary = await done;

  assert.equal(summary.status, 'failed');
  assert.equal(summary.error?.code, 'VALIDATION_FAILED');
  assert.equal(summary.publishedRevision, undefined, 'the reviewer probe published this r2 before the fix');
  assert.equal(summary.revisions, 3);
  assert.equal(repairCount(), 2);
  assert.deepEqual(failedIds(readReport(storageDir, jobId, 1)), ['semantic.unique-ids']);
  const report2 = readReport(storageDir, jobId, 2);
  assert.deepEqual(failedIds(report2), ['repair.no-weakening'], 'the shrunken revision passes every plain check; only the guard can stop it');
  assert.match(
    noWeakening(report2).message,
    /"positive net force accelerates forward" \(occurrence 2 of 2\) from the baseline is missing from the repair/,
  );
});

test('S5-08 duplicate-name-drops-wrong-case: deleting a failing duplicate never publishes', async () => {
  const storageDir = tempStorage();
  const wrong = duplicateNameGen();
  wrong.behavioralTests[1]['expectedAccelerationMps2'] = 999; // wrong: -20 N / 5 kg = -4
  const dropped = structuredClone(wrong);
  dropped.behavioralTests.splice(1, 1);
  const { client } = stagedClient({ rev1: wrong, repairs: [dropped, structuredClone(wrong)] });
  const { jobId, done } = startJob('nasa-grc-equations-of-motion', { client, storageDir, purpose: 'test-live' });
  const summary = await done;

  assert.equal(summary.status, 'failed');
  assert.equal(summary.publishedRevision, undefined, 'deletion removed both the uniqueness and the behavioral failure before the fix');
  assert.deepEqual(failedIds(readReport(storageDir, jobId, 1)).sort(), ['behavior.tests', 'semantic.unique-ids']);
  const report2 = readReport(storageDir, jobId, 2);
  assert.deepEqual(failedIds(report2), ['repair.no-weakening']);
  assert.match(noWeakening(report2).message, /\(occurrence 2 of 2\) from the baseline is missing/);
});

test('S5-08 duplicate-name-replaced-same-count: an easy replacement case does not preserve the dropped obligation', async () => {
  const storageDir = tempStorage();
  const wrong = duplicateNameGen();
  wrong.behavioralTests[1]['expectedAccelerationMps2'] = 999;
  const replaced = structuredClone(wrong);
  replaced.behavioralTests.splice(1, 1);
  replaced.behavioralTests.push({
    name: 'easy replacement',
    massKg: 1,
    netForceN: 0,
    expectedAccelerationMps2: 0,
    tolerance: 0.001,
  });
  assert.equal(replaced.behavioralTests.length, 4, 'the test count is unchanged');
  const { client } = stagedClient({ rev1: wrong, repairs: [replaced, structuredClone(wrong)] });
  const { jobId, done } = startJob('nasa-grc-equations-of-motion', { client, storageDir, purpose: 'test-live' });
  const summary = await done;

  assert.equal(summary.status, 'failed');
  assert.equal(summary.publishedRevision, undefined, 'the reviewer probe published this same-count replacement before the fix');
  const report2 = readReport(storageDir, jobId, 2);
  assert.deepEqual(failedIds(report2), ['repair.no-weakening'], 'the replacement passes every plain check');
  assert.match(noWeakening(report2).message, /\(occurrence 2 of 2\) from the baseline is missing/);
});

test('S5-08 duplicate-id-drops-correct-prediction: deleting the second occurrence of a duplicated prediction id never publishes', async () => {
  const storageDir = tempStorage();
  const dup = cloneGen();
  dup.predictions[1]['id'] = 'pred-1'; // both predictions share one id; both numerically correct
  const dropped = structuredClone(dup);
  dropped.predictions.splice(1, 1); // predictions 2 → 1
  const { client } = stagedClient({ rev1: dup, repairs: [dropped, structuredClone(dup)] });
  const { jobId, done } = startJob('nasa-grc-equations-of-motion', { client, storageDir, purpose: 'test-live' });
  const summary = await done;

  assert.equal(summary.status, 'failed');
  assert.equal(summary.publishedRevision, undefined, 'the reviewer probe published this r2 before the fix');
  assert.deepEqual(failedIds(readReport(storageDir, jobId, 1)), ['semantic.unique-ids']);
  const report2 = readReport(storageDir, jobId, 2);
  assert.deepEqual(failedIds(report2), ['repair.no-weakening']);
  assert.match(noWeakening(report2).message, /predictions "pred-1" \(occurrence 2 of 2\) from the baseline is missing/);
});

test('S5-08 duplicate-name reordering: swapping content between the two occurrences of one name fails', async () => {
  const storageDir = tempStorage();
  const swapped = duplicateNameGen();
  const first = swapped.behavioralTests[0];
  const second = swapped.behavioralTests[1];
  assert.ok(first !== undefined && second !== undefined);
  swapped.behavioralTests[0] = second;
  swapped.behavioralTests[1] = first;
  const { client } = stagedClient({ rev1: duplicateNameGen(), repairs: [swapped, duplicateNameGen()] });
  const { jobId, done } = startJob('nasa-grc-equations-of-motion', { client, storageDir, purpose: 'test-live' });
  const summary = await done;

  assert.equal(summary.status, 'failed');
  assert.equal(summary.publishedRevision, undefined);
  const report2 = readReport(storageDir, jobId, 2);
  assert.deepEqual(failedIds(report2).sort(), ['repair.no-weakening', 'semantic.unique-ids'].sort());
  const message = noWeakening(report2).message;
  assert.match(message, /"positive net force accelerates forward" changed \(/);
  assert.match(message, /passed its own checks on the baseline/);
  assert.ok(!message.includes('appears 2 times'), 'both occurrences are preserved; the swap is the violation');
});

/* ------------------------------------------------------------------ */
/* S5-09 — a publisher-policy-violating name is repairable              */
/* (reviewer probe policy-name-repair: the job burned both attempts     */
/* before the fix because no valid repair existed)                      */
/* ------------------------------------------------------------------ */

test('S5-09 policy-name-repair: renaming the NASA test name with identical numbers publishes r2', async () => {
  const storageDir = tempStorage();
  const r1 = cloneGen();
  r1.behavioralTests[0]['name'] = 'NASA predicts this acceleration';
  const { client, repairCount } = stagedClient({ rev1: r1, repairs: [cloneGen()] });
  const { jobId, done } = startJob('nasa-grc-equations-of-motion', { client, storageDir, purpose: 'test-live' });
  const summary = await done;

  assert.equal(summary.status, 'succeeded');
  assert.equal(summary.publishedRevision, 2, 'a policy-name correction with identical numbers is a legitimate repair');
  assert.equal(repairCount(), 1);
  assert.deepEqual(failedIds(readReport(storageDir, jobId, 1)), ['policy.no-publisher-attribution']);
  const report2 = readReport(storageDir, jobId, 2);
  assert.deepEqual(failedIds(report2), []);
  assert.equal(noWeakening(report2).passed, true);

  // Only the name changed; every number carries over from r1 to r2.
  const disk = readJob(storageDir, jobId);
  assert.ok(disk !== null);
  const spec1 = disk.revisions[0]?.spec as { behavioralTests: Record<string, unknown>[] };
  const spec2 = disk.revisions[1]?.spec as { behavioralTests: Record<string, unknown>[] };
  const c1 = spec1.behavioralTests[0];
  const c2 = spec2.behavioralTests[0];
  assert.ok(c1 !== undefined && c2 !== undefined);
  assert.equal(c1['name'], 'NASA predicts this acceleration');
  assert.equal(c2['name'], 'positive net force accelerates forward');
  assert.deepEqual({ ...c2, name: c1['name'] }, c1, 'every field except the name is identical');
});
