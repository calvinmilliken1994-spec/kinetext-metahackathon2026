/// <reference types="node" />
// STAGE-8c Addendum A: the label diagram's SAM line names Muse's grounding call when the worker recorded it in the
// `segment succeeded` detail ("; muse-spark-1.3 located K of N part(s) for SAM"). Grounding failures and older runs keep
// the SAM-only wording.
import test from 'node:test';
import assert from 'node:assert/strict';
import { normaliseJobDetail } from './lessonJob.ts';
import type { JobDetail } from '../api.ts';
import { figureNote, parseGrounding, parseSegmentGot, partBuilds } from './liveBuild.ts';
import { replaySnapshot } from './replay.ts';
import { fixtureFinalWire } from './liveBuildFixtures.ts';

const LD = 'label-diagram-v1';
const GROUNDED = 'sam-3.1 returned 5 of 5 region(s); muse-spark-1.3 located 5 of 5 part(s) for SAM';
const RETRIED = `${GROUNDED}; sam-3.1 retried 1 weak part(s): x 0.40 -> 0.81`;
const RETRY_FIRST = 'sam-3.1 returned 5 of 5 region(s); sam-3.1 retried 1 weak part(s): x 0.40 -> 0.81; muse-spark-1.3 located 4 of 5 part(s) for SAM';
const FAILED = 'sam-3.1 returned 5 of 5 region(s); muse-spark-1.3 grounding failed (TIMEOUT); used the generation areas';
const OLD = 'sam-3.1 returned 5 of 5 region(s)';

/** The fixture run with every `segment succeeded` detail replaced (both SAM calls: revision 1 and 2). */
function withSegmentDetail(detail: string, s: number): JobDetail {
  const wire = fixtureFinalWire() as { events: Array<Record<string, unknown>> };
  const events = wire.events.map((e) => (e.stage === 'segment' && e.status === 'succeeded' ? { ...e, detail } : e));
  return normaliseJobDetail(replaySnapshot({ ...wire, events }, s * 1000));
}
const samLines = (d: JobDetail): string[] => (partBuilds(d)[LD]?.lines ?? []).filter((l) => l.kind === 'outlining').map((l) => l.text);

test('parseGrounding reads Muse’s located count, a failed grounding call, or nothing (older runs)', () => {
  assert.deepEqual(parseGrounding(GROUNDED), { located: 5, of: 5 });
  assert.deepEqual(parseGrounding(RETRIED), { located: 5, of: 5 }, 'an appended SAM retry note does not hide it');
  assert.deepEqual(parseGrounding(RETRY_FIRST), { located: 4, of: 5 }, 'order of the appended notes does not matter');
  assert.equal(parseGrounding(FAILED), 'failed');
  assert.equal(parseGrounding(OLD), null);
  assert.equal(parseGrounding(undefined), null);
});

test('parseSegmentGot still reads SAM’s count with the grounding and retry notes appended', () => {
  assert.deepEqual(parseSegmentGot(GROUNDED), { got: 5, of: 5 });
  assert.deepEqual(parseSegmentGot(RETRIED), { got: 5, of: 5 });
  assert.deepEqual(parseSegmentGot('sam-3.1 returned 4 of 5 region(s); muse-spark-1.3 located 5 of 5 part(s) for SAM'), { got: 4, of: 5 });
});

test('a grounded run: “Muse Spark located 5 parts · SAM 3.1 confirmed 5 of 5 in 1.9 s”', () => {
  const [r1, r2] = samLines(withSegmentDetail(GROUNDED, 90));
  assert.equal(r1, 'Muse Spark located 5 parts · SAM 3.1 confirmed 5 of 5 in 1.9 s');
  assert.equal(r2, 'Muse Spark located 5 parts · SAM 3.1 confirmed 5 of 5 in 0.8 s');
  assert.equal(samLines(withSegmentDetail(RETRIED, 90))[0], 'Muse Spark located 5 parts · SAM 3.1 confirmed 5 of 5 in 1.9 s');
});

test('Muse located fewer parts than were asked: the count says so', () => {
  assert.equal(samLines(withSegmentDetail(RETRY_FIRST, 90))[0], 'Muse Spark located 4 of 5 parts · SAM 3.1 confirmed 5 of 5 in 1.9 s');
  const one = 'sam-3.1 returned 1 of 1 region(s); muse-spark-1.3 located 1 of 1 part(s) for SAM';
  assert.equal(samLines(withSegmentDetail(one, 90))[0], 'Muse Spark located 1 part · SAM 3.1 confirmed 1 of 1 in 1.9 s');
});

test('a failed grounding call and older runs keep today’s SAM wording', () => {
  assert.equal(samLines(withSegmentDetail(FAILED, 90))[0], 'SAM 3.1 outlined 5 of 5 parts in 1.9 s');
  assert.equal(samLines(withSegmentDetail(OLD, 90))[0], 'SAM 3.1 outlined 5 of 5 parts in 1.9 s');
});

test('figure frame: a grounded call names Muse first, then what SAM confirmed', () => {
  assert.deepEqual(figureNote(partBuilds(withSegmentDetail(GROUNDED, 62))[LD]), {
    actor: 'SAM 3.1', text: 'confirmed 5 of 5 in 1.9 s', working: false, muse: { actor: 'Muse Spark', text: 'located 5 parts' },
  });
  // while the call is open nothing is known about the grounding yet: the SAM-only working text
  assert.deepEqual(figureNote(partBuilds(withSegmentDetail(GROUNDED, 60))[LD]), { actor: 'SAM 3.1', text: 'is outlining 5 parts of the figure', working: true });
  assert.deepEqual(figureNote(partBuilds(withSegmentDetail(FAILED, 62))[LD]), { actor: 'SAM 3.1', text: 'outlined 5 of 5 parts in 1.9 s', working: false });
});
