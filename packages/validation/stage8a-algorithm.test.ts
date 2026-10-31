// Stage 8a V-A — algorithm-trace-v1 validator tests (ALG-01..ALG-07, frozen in
// docs/specs/STAGE-8a-subject-engines.md §1a). Positive vectors are REAL library pages
// (NIST Dictionary of Algorithms and Data Structures: binary search, bubble sort, merge sort,
// quicksort) with realistic gens quoting them exactly; every check also has a negative vector.
// Run: node --test packages/validation/stage8a-algorithm.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';

import { checkIdsFor, KIT_LIMITS } from '../contracts/kit.ts';
import type { AlgorithmTraceGen } from '../contracts/kit.ts';
import { validateKitComponent } from './kit/index.ts';
import { validateAlgorithmTrace } from './kit/algorithm.ts';
import { loadSource } from '../sources/index.ts';
import { checkOf, clone, failedIds, failureDetail, stage6Fixture } from './fixtures/stage6.ts';

const binarySource = (): ReturnType<typeof loadSource> => loadSource('nist-dads-binary-search');
const bubbleSource = (): ReturnType<typeof loadSource> => loadSource('nist-dads-bubble-sort');
const mergeSource = (): ReturnType<typeof loadSource> => loadSource('nist-dads-merge-sort');
const quickSource = (): ReturnType<typeof loadSource> => loadSource('nist-dads-quicksort');

const goldenGen = (): AlgorithmTraceGen => stage6Fixture<AlgorithmTraceGen>('algorithm-trace.gen.json');

/** A realistic bubble-sort gen quoting the real NIST bubble-sort page exactly. */
function bubbleSortGen(): AlgorithmTraceGen {
  return {
    schemaVersion: 'algorithm-trace-v1',
    title: 'Bubble sort trace',
    algorithm: 'bubble-sort',
    algorithmName: 'bubble sort',
    sourceId: 'nist-dads-bubble-sort',
    quote: 'Bidirectional bubble sort usually does better since at least one item is moved forward or backward to its place in the list with each pass.',
    input: [31, 7, 44, 2, 58, 11],
    hasTarget: false,
    target: 0,
    claims: [
      {
        id: 'complexity',
        kind: 'running-time',
        text: 'Complexity is O(n^2) for arbitrary data',
        sourceId: 'nist-dads-bubble-sort',
        quote: 'Note: Complexity is O(n^2) for arbitrary data, but approaches Θ(n) if the list is nearly in order at the beginning.',
      },
    ],
  };
}

/** A realistic merge-sort gen quoting the real NIST merge-sort page exactly. */
function mergeSortGen(): AlgorithmTraceGen {
  return {
    schemaVersion: 'algorithm-trace-v1',
    title: 'Merge sort trace',
    algorithm: 'merge-sort',
    algorithmName: 'merge sort',
    sourceId: 'nist-dads-merge-sort',
    quote: 'Specialization (... is a kind of me.) k-way merge sort, balanced k-way merge sort, polyphase merge sort.',
    input: [44, 7, 31, 2, 58, 11, 23, 5],
    hasTarget: false,
    target: 0,
    claims: [
      {
        id: 'run-time',
        kind: 'running-time',
        text: 'Run time is Θ(n log n).',
        sourceId: 'nist-dads-merge-sort',
        quote: 'recursively sorts each group, and merges them into a final, sorted sequence. Run time is Θ(n log n).',
      },
    ],
  };
}

/** A realistic quicksort gen quoting the real NIST quicksort page exactly. */
function quicksortGen(): AlgorithmTraceGen {
  return {
    schemaVersion: 'algorithm-trace-v1',
    title: 'Quicksort trace',
    algorithm: 'quicksort',
    algorithmName: 'quicksort',
    sourceId: 'nist-dads-quicksort',
    quote: 'Quicksort has running time Θ(n²) in the worst case, but it is typically O(n log n).',
    input: [9, 3, 7, 1, 5, 8, 2, 6],
    hasTarget: false,
    target: 0,
    claims: [
      {
        id: 'typical-run-time',
        kind: 'running-time',
        text: 'it is typically O(n log n)',
        sourceId: 'nist-dads-quicksort',
        quote: 'Quicksort has running time Θ(n²) in the worst case, but it is typically O(n log n).',
      },
    ],
  };
}

function validate(gen: AlgorithmTraceGen, sources: ReturnType<typeof loadSource>[]) {
  return validateKitComponent('algorithm-trace-v1', gen, sources);
}

/* ------------------------------------------------------------------ */
/* Positive: the golden and real library pages                          */
/* ------------------------------------------------------------------ */

test('golden algorithm-trace passes every check', () => {
  const report = validate(goldenGen(), [binarySource()]);
  assert.deepEqual(report.checks.map(c => c.id), ['schema.gen', ...checkIdsFor('algorithm-trace-v1')]);
  assert.deepEqual(failedIds(report), [], failureDetail(report));
  assert.equal(report.publishable, true);
  assert.match(checkOf(report, 'ALG-04').message, /frame/);
});

test('bubble sort on the real NIST page passes every check', () => {
  const report = validate(bubbleSortGen(), [bubbleSource()]);
  assert.deepEqual(failedIds(report), [], failureDetail(report));
  assert.equal(report.publishable, true);
  assert.match(checkOf(report, 'ALG-04').message, /2, 7, 11, 31, 44, 58/);
});

test('merge sort on the real NIST page passes every check', () => {
  const report = validate(mergeSortGen(), [mergeSource()]);
  assert.deepEqual(failedIds(report), [], failureDetail(report));
  assert.equal(report.publishable, true);
});

test('quicksort on the real NIST page passes every check', () => {
  const report = validate(quicksortGen(), [quickSource()]);
  assert.deepEqual(failedIds(report), [], failureDetail(report));
  assert.equal(report.publishable, true);
});

test('a search whose target is not in the list passes (the tracer proves "not found")', () => {
  const gen = goldenGen();
  gen.target = 30;
  const report = validate(gen, [binarySource()]);
  assert.deepEqual(failedIds(report), [], failureDetail(report));
  assert.match(checkOf(report, 'ALG-04').message, /not in the list|not found/i);
});

/* ------------------------------------------------------------------ */
/* Negative: one vector per check                                       */
/* ------------------------------------------------------------------ */

test('schema.gen: a malformed claim id fails the structural gate with its pointer', () => {
  const gen = goldenGen();
  gen.claims[0]!.id = 'Claim One';
  const report = validate(gen, [binarySource()]);
  assert.equal(checkOf(report, 'schema.gen').passed, false);
  assert.ok((checkOf(report, 'schema.gen').affected ?? []).includes('/claims/0/id'));
  assert.equal(report.publishable, false);
});

test('ALG-01: a fabricated quote fails and names the quote pointer', () => {
  const gen = goldenGen();
  gen.quote = 'binary search halves the interval each step';
  const report = validate(gen, [binarySource()]);
  assert.deepEqual(failedIds(report), ['ALG-01'], failureDetail(report));
  assert.ok((checkOf(report, 'ALG-01').affected ?? []).includes('/quote'));
  assert.match(checkOf(report, 'ALG-01').message, /verbatim/);
});

test('ALG-01: an unresolvable claim sourceId unlocks the sourceId and the quote', () => {
  const gen = goldenGen();
  gen.claims[0]!.sourceId = 'no-such-source';
  const report = validate(gen, [binarySource()]);
  assert.deepEqual(failedIds(report), ['ALG-01'], failureDetail(report));
  const affected = checkOf(report, 'ALG-01').affected ?? [];
  assert.ok(affected.includes('/claims/0/sourceId'));
  assert.ok(affected.includes('/claims/0/quote'));
});

test('ALG-02: a name that is not a whole phrase in the quote fails', () => {
  const gen = goldenGen();
  gen.algorithmName = 'binary searches';
  const report = validate(gen, [binarySource()]);
  assert.deepEqual(failedIds(report), ['ALG-02'], failureDetail(report));
  assert.ok((checkOf(report, 'ALG-02').affected ?? []).includes('/algorithmName'));
});

test('ALG-02: a name in the quote that does not match the algorithm id pattern fails', () => {
  const gen = goldenGen();
  gen.algorithmName = 'search';
  const report = validate(gen, [binarySource()]);
  assert.deepEqual(failedIds(report), ['ALG-02'], failureDetail(report));
  assert.match(checkOf(report, 'ALG-02').message, /pattern|name for/i);
});

test('ALG-03: an unsorted search input fails', () => {
  const gen = goldenGen();
  gen.input = [44, 2, 79, 11, 23, 31, 58];
  const report = validate(gen, [binarySource()]);
  assert.deepEqual(failedIds(report), ['ALG-03'], failureDetail(report));
  assert.ok((checkOf(report, 'ALG-03').affected ?? []).includes('/input'));
  assert.match(checkOf(report, 'ALG-03').message, /ascending/);
});

test('ALG-03: a target on a sort (hasTarget true) fails', () => {
  const gen = quicksortGen();
  gen.hasTarget = true;
  gen.target = 9;
  const report = validate(gen, [quickSource()]);
  assert.deepEqual(failedIds(report), ['ALG-03'], failureDetail(report));
  assert.ok((checkOf(report, 'ALG-03').affected ?? []).includes('/hasTarget'));
});

test('ALG-03: a nonzero target while hasTarget is false fails', () => {
  const gen = quicksortGen();
  gen.target = 31;
  const report = validate(gen, [quickSource()]);
  assert.deepEqual(failedIds(report), ['ALG-03'], failureDetail(report));
  assert.ok((checkOf(report, 'ALG-03').affected ?? []).includes('/target'));
  assert.match(checkOf(report, 'ALG-03').message, /0/);
});

test('ALG-03: an input value outside 0-99 fails with the element pointer', () => {
  const gen = goldenGen();
  gen.input = [2, 11, 23, 31, 44, 500];
  const report = validate(gen, [binarySource()]);
  assert.equal(checkOf(report, 'ALG-03').passed, false);
  assert.ok((checkOf(report, 'ALG-03').affected ?? []).includes('/input/5'));
});

test('ALG-04: an input the tracer cannot run fails cleanly (no crash message)', () => {
  const gen = goldenGen();
  gen.input = [2, 11, 23, 31.5] as number[];
  const report = validateAlgorithmTrace(gen, [binarySource()]);
  assert.equal(checkOf(report, 'ALG-04').passed, false);
  assert.doesNotMatch(checkOf(report, 'ALG-04').message, /crashed/);
  assert.ok((checkOf(report, 'ALG-04').affected ?? []).includes('/input'));
});

test('ALG-05: a claim text that is not in its quote fails', () => {
  const gen = goldenGen();
  gen.claims[0]!.text = 'Run time is O(n log n).';
  const report = validate(gen, [binarySource()]);
  assert.deepEqual(failedIds(report), ['ALG-05'], failureDetail(report));
  const affected = checkOf(report, 'ALG-05').affected ?? [];
  assert.ok(affected.includes('/claims/0/text'));
  assert.ok(affected.includes('/claims/0/quote'));
});

test('ALG-06: a number in the title that is not on the page fails', () => {
  const gen = goldenGen();
  gen.title = 'Binary search trace: 47 comparisons';
  const report = validate(gen, [binarySource()]);
  assert.deepEqual(failedIds(report), ['ALG-06'], failureDetail(report));
  assert.ok((checkOf(report, 'ALG-06').affected ?? []).includes('/title'));
  assert.match(checkOf(report, 'ALG-06').message, /47/);
});

test('ALG-06: a number in a claim text that is not on the page fails', () => {
  const gen = goldenGen();
  gen.claims[0]!.text = 'Run time is O(ln n) after 12 steps.';
  gen.claims[0]!.quote = 'Note: Run time is O(ln n).';
  const report = validate(gen, [binarySource()]);
  assert.ok(failedIds(report).includes('ALG-06'), failureDetail(report));
  assert.ok((checkOf(report, 'ALG-06').affected ?? []).includes('/claims/0/text'));
});

test('ALG-07: four claims exceed the frozen 0-3 limit', () => {
  const gen = goldenGen();
  const claim = gen.claims[0]!;
  gen.claims = [1, 2, 3, 4].map(i => ({ ...clone(claim), id: `claim-${i}` }));
  const report = validate(gen, [binarySource()]);
  assert.deepEqual(failedIds(report), ['ALG-07'], failureDetail(report));
  assert.ok((checkOf(report, 'ALG-07').affected ?? []).includes('/claims'));
  assert.match(checkOf(report, 'ALG-07').message, /0-3|0 to 3/);
});

test('ALG-07: three input values are too few (4-10 frozen)', () => {
  const gen = goldenGen();
  gen.input = [2, 11, 23];
  const report = validate(gen, [binarySource()]);
  assert.ok(failedIds(report).includes('ALG-07'), failureDetail(report));
  assert.ok((checkOf(report, 'ALG-07').affected ?? []).includes('/input'));
});

test('malformed gen input never throws and emits every check id', () => {
  const report = validateAlgorithmTrace({} as AlgorithmTraceGen, []);
  assert.deepEqual(report.checks.map(c => c.id), ['schema.gen', ...checkIdsFor('algorithm-trace-v1')]);
  assert.equal(report.publishable, false);
  for (const c of report.checks) assert.doesNotMatch(c.message, /crashed/);
  const gated = validateKitComponent('algorithm-trace-v1', null, []);
  assert.equal(gated.publishable, false);
});

test('the trace limit is the frozen KIT_LIMITS.algorithm.maxFrames', () => {
  assert.equal(KIT_LIMITS.algorithm.maxFrames, 400);
  const report = validate(bubbleSortGen(), [bubbleSource()]);
  assert.match(checkOf(report, 'ALG-04').message, /400/);
});
