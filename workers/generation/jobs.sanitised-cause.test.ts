// S5B-08 (Stage 5b review, Wave C) — INTERNAL diagnostics use a FIXED enumerated
// cause vocabulary; everything else maps to 'unknown'. The last-resort stderr line
// prints only the job id, stage and that same safe code — never the exception object,
// its message or its stack — unless MKI_DEBUG_INTERNAL=1 is set, and even then only
// the exception's own name/message/stack strings (never source or provider payloads,
// and nothing richer is ever persisted).
//
// Reviewer evidence (extra-results.json, 'cause-not-fixed-vocabulary'): a serializer
// throwing Error('PRIVATE_EXCEPTION_MESSAGE') with code 'PRIVATE_MARKER_TOKEN' (both
// regex-valid) had the marker persisted in the event detail and the raw exception
// printed to stderr.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sanitisedCause, startJob } from './jobs.ts';
import { readJob } from './jobs.ts';
import type { CompleteRequest, MetaClient } from '../../packages/meta/client.ts';
import type { MetaReceipt, StageEvent } from '../../packages/contracts/index.ts';

/* ------------------------------------------------------------------ */
/* Unit: the fixed vocabulary                                           */
/* ------------------------------------------------------------------ */

const VOCABULARY_CASES: [string, unknown, string][] = [
  // errno-style codes on the allow-list
  ['EPERM', Object.assign(new Error('x'), { code: 'EPERM' }), 'EPERM'],
  ['EACCES', Object.assign(new Error('x'), { code: 'EACCES' }), 'EACCES'],
  ['EBUSY', Object.assign(new Error('x'), { code: 'EBUSY' }), 'EBUSY'],
  ['ENOENT', Object.assign(new Error('x'), { code: 'ENOENT' }), 'ENOENT'],
  ['ENOSPC', Object.assign(new Error('x'), { code: 'ENOSPC' }), 'ENOSPC'],
  ['EMFILE', Object.assign(new Error('x'), { code: 'EMFILE' }), 'EMFILE'],
  ['EEXIST', Object.assign(new Error('x'), { code: 'EEXIST' }), 'EEXIST'],
  ['EISDIR', Object.assign(new Error('x'), { code: 'EISDIR' }), 'EISDIR'],
  ['ENOTDIR', Object.assign(new Error('x'), { code: 'ENOTDIR' }), 'ENOTDIR'],
  ['ETIMEDOUT', Object.assign(new Error('x'), { code: 'ETIMEDOUT' }), 'ETIMEDOUT'],
  // built-in error classes
  ['TypeError', new TypeError('x'), 'TypeError'],
  ['RangeError', new RangeError('x'), 'RangeError'],
  ['SyntaxError', new SyntaxError('x'), 'SyntaxError'],
  ['ReferenceError', new ReferenceError('x'), 'ReferenceError'],
  ['Error', new Error('x'), 'Error'],
  ['AbortError', new DOMException('x', 'AbortError'), 'AbortError'],
  // a vocabulary code wins even with an odd name
  ['code precedence', Object.assign(new Error('x'), { code: 'EPERM', name: 'WeirdName' }), 'EPERM'],
  // regex-valid but NOT enumerated → unknown (the reviewer's marker)
  ['arbitrary marker code', Object.assign(new Error('PRIVATE_EXCEPTION_MESSAGE'), { code: 'PRIVATE_MARKER_TOKEN' }), 'unknown'],
  ['marker code + Error name', Object.assign(new Error('x'), { code: 'PRIVATE_MARKER_TOKEN', name: 'Error' }), 'unknown'],
  ['arbitrary class name', Object.assign(new Error('x'), { name: 'EvilCustomError' }), 'unknown'],
  ['arbitrary errno shape', Object.assign(new Error('x'), { code: 'EXXXNOTREAL' }), 'unknown'],
  // non-objects and empty objects
  ['string', 'EPERM', 'unknown'],
  ['null', null, 'unknown'],
  ['undefined', undefined, 'unknown'],
  ['number', 42, 'unknown'],
  ['empty object', {}, 'unknown'],
  ['numeric DOMException code falls to name', new DOMException('x', 'TimeoutError'), 'TimeoutError'],
];

for (const [label, err, expected] of VOCABULARY_CASES) {
  test(`S5B-08 sanitisedCause: ${label} → ${expected}`, () => {
    assert.equal(sanitisedCause(err), expected);
  });
}

/* ------------------------------------------------------------------ */
/* End-to-end: the reviewer's exact probe case                          */
/* ------------------------------------------------------------------ */

const analysisFixture = JSON.parse(
  readFileSync(new URL('../../tests/fixtures/nasa-analysis.recorded.json', import.meta.url), 'utf8'),
) as Record<string, unknown>;

/** usage whose toJSON throws a regex-valid marker — the extra-probes.mjs serializer fault. */
function dangerousUsage(): unknown {
  return {
    toJSON(): never {
      const err = new Error('PRIVATE_EXCEPTION_MESSAGE') as Error & { code: string };
      err.code = 'PRIVATE_MARKER_TOKEN';
      throw err;
    },
  };
}

function breakingClient(): MetaClient {
  return {
    complete: <T>(_req: CompleteRequest): Promise<{ data: T; receipt: MetaReceipt }> => {
      const receipt = {
        purpose: 'test-live',
        requestedModel: 'muse-spark-1.3',
        returnedModel: 'muse-spark-1.3',
        responseId: 'fake-marker',
        usage: dangerousUsage(),
        latencyMs: 1,
        estCostUSD: 0.01,
        finishReason: 'stop',
        attempts: 1,
      } as unknown as MetaReceipt;
      return Promise.resolve({ data: analysisFixture as T, receipt });
    },
  };
}

interface Captured {
  events: StageEvent[];
  eventsBlob: string;
  jobJsonBlob: string;
  stderr: string;
  cost: number;
  status: string;
  code: string | undefined;
}

async function runMarkerJob(): Promise<Captured> {
  const storageDir = mkdtempSync(join(tmpdir(), 's5b08-cause-'));
  const stderrLines: string[] = [];
  const realError = console.error;
  console.error = (...args: unknown[]): void => {
    stderrLines.push(args.map(a => String(a)).join(' '));
  };
  try {
    const { jobId, done } = startJob('nasa-grc-equations-of-motion', {
      client: breakingClient(),
      storageDir,
      purpose: 'test-live',
      newJobId: () => 's5b08-job',
    });
    const summary = await done;
    const view = readJob(storageDir, jobId);
    assert.ok(view !== null, 'the job is readable back');
    return {
      events: view.events,
      eventsBlob: JSON.stringify(view.events),
      jobJsonBlob: readFileSync(join(storageDir, 'runs', jobId, 'job.json'), 'utf8'),
      stderr: stderrLines.join('\n'),
      cost: summary.totalCostUSD,
      status: summary.status,
      code: summary.error?.code,
    };
  } finally {
    console.error = realError;
  }
}

test('S5B-08: a regex-valid arbitrary marker maps to unknown and leaks nowhere (default mode)', async () => {
  const r = await runMarkerJob();
  assert.equal(r.status, 'failed');
  assert.equal(r.code, 'INTERNAL');
  assert.equal(r.cost, 0.01, 'the billed success receipt stays accounted');

  const last = r.events[r.events.length - 1];
  assert.ok(last !== undefined);
  assert.equal(last.stage, 'done');
  assert.equal(last.status, 'failed');
  assert.equal(last.detail, 'INTERNAL; during analyze; cause unknown', 'fixed vocabulary, never the marker');
  assert.ok(!r.eventsBlob.includes('PRIVATE_MARKER_TOKEN'), 'marker absent from events');
  assert.ok(!r.eventsBlob.includes('PRIVATE_EXCEPTION_MESSAGE'), 'message absent from events');
  assert.ok(!r.jobJsonBlob.includes('PRIVATE_MARKER_TOKEN'), 'marker absent from job.json');
  assert.ok(!r.jobJsonBlob.includes('PRIVATE_EXCEPTION_MESSAGE'), 'message absent from job.json');

  // Default stderr: job id, stage and the same safe code — no exception object, message or stack.
  assert.ok(r.stderr.includes('s5b08-job'), `stderr names the job: ${r.stderr}`);
  assert.ok(r.stderr.includes('analyze'), 'stderr names the stage');
  assert.ok(r.stderr.includes('cause unknown'), 'stderr carries the same safe code');
  assert.ok(!r.stderr.includes('PRIVATE_MARKER_TOKEN'), 'marker absent from stderr');
  assert.ok(!r.stderr.includes('PRIVATE_EXCEPTION_MESSAGE'), 'exception message absent from stderr');
  assert.ok(!r.stderr.includes('Error:'), 'no raw exception rendering on stderr');
  assert.ok(!/at .*jobs\.ts/.test(r.stderr), 'no stack frames on stderr');
});

test('S5B-08: MKI_DEBUG_INTERNAL=1 adds local-only detail but persisted artifacts stay clean', async () => {
  process.env.MKI_DEBUG_INTERNAL = '1';
  try {
    const r = await runMarkerJob();
    assert.equal(r.status, 'failed');
    assert.equal(r.code, 'INTERNAL');
    // Opt-in local diagnostics: the exception's own name/message/stack strings.
    assert.ok(r.stderr.includes('cause unknown'), 'the safe code is printed in both modes');
    assert.ok(r.stderr.includes('PRIVATE_EXCEPTION_MESSAGE'), 'opt-in mode may print the message locally');
    // Persisted state NEVER carries the marker or the message, even in debug mode.
    assert.ok(!r.eventsBlob.includes('PRIVATE_MARKER_TOKEN'));
    assert.ok(!r.eventsBlob.includes('PRIVATE_EXCEPTION_MESSAGE'));
    assert.ok(!r.jobJsonBlob.includes('PRIVATE_MARKER_TOKEN'));
    assert.ok(!r.jobJsonBlob.includes('PRIVATE_EXCEPTION_MESSAGE'));
    const last = r.events[r.events.length - 1];
    assert.equal(last?.detail, 'INTERNAL; during analyze; cause unknown');
  } finally {
    delete process.env.MKI_DEBUG_INTERNAL;
  }
});

test('S5B-08: built-in errors map correctly through the last-resort path (regression: TypeError stays named)', async () => {
  // jobs.internal.test.ts covers the circular-usage TypeError end-to-end; this asserts
  // the vocabulary keeps ordinary built-ins diagnosable (they are on the allow-list).
  assert.equal(sanitisedCause(new TypeError('Converting circular structure to JSON')), 'TypeError');
  assert.equal(sanitisedCause(Object.assign(new Error('x'), { code: 'EISDIR' })), 'EISDIR');
});
