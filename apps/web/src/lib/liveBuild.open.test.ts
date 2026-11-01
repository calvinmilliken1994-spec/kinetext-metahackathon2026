/// <reference types="node" />
// Stage 8d: the label diagram's build line names the model that located the parts. Spark Open (Modal) jobs record
// `muse-spark-open located K of N part(s) for SAM` in the `segment succeeded` detail; Spark 1.3 keeps its wording.
import test from 'node:test';
import assert from 'node:assert/strict';
import { normaliseJobDetail } from './lessonJob.ts';
import type { JobDetail } from '../api.ts';
import { figureNote, parseGrounding, parseGroundingActor, parseSegmentGot, partBuilds } from './liveBuild.ts';
import { replaySnapshot } from './replay.ts';
import { fixtureFinalWire } from './liveBuildFixtures.ts';

const LD = 'label-diagram-v1';
const OPEN = 'sam-3.1 returned 5 of 5 region(s); muse-spark-open located 5 of 5 part(s) for SAM; sam-3.1 sure of 4 of 5 part(s); placed 4 number(s) on the located parts';
const OPEN_FEWER = 'sam-3.1 returned 5 of 5 region(s); muse-spark-open located 4 of 5 part(s) for SAM; sam-3.1 sure of 5 of 5 part(s)';
const OPEN_FAILED = 'sam-3.1 returned 5 of 5 region(s); muse-spark-open grounding failed (TIMEOUT); used the generation areas; sam-3.1 sure of 5 of 5 part(s)';
const SPARK13 = 'sam-3.1 returned 5 of 5 region(s); muse-spark-1.3 located 5 of 5 part(s) for SAM; sam-3.1 sure of 4 of 5 part(s)';
const OLD = 'sam-3.1 returned 5 of 5 region(s)';

function withSegmentDetail(detail: string, s: number): JobDetail {
  const wire = fixtureFinalWire() as { events: Array<Record<string, unknown>> };
  const events = wire.events.map((e) => (e.stage === 'segment' && e.status === 'succeeded' ? { ...e, detail } : e));
  return normaliseJobDetail(replaySnapshot({ ...wire, events }, s * 1000));
}
const samLines = (d: JobDetail): string[] => (partBuilds(d)[LD]?.lines ?? []).filter((l) => l.kind === 'outlining').map((l) => l.text);

test('parseGrounding reads the count for either model id; parseGroundingActor names who located the parts', () => {
  assert.deepEqual(parseGrounding(OPEN), { located: 5, of: 5 });
  assert.deepEqual(parseGrounding(OPEN_FEWER), { located: 4, of: 5 });
  assert.equal(parseGrounding(OPEN_FAILED), 'failed');
  assert.deepEqual(parseSegmentGot(OPEN), { got: 5, of: 5 });
  assert.equal(parseGroundingActor(OPEN), 'Muse Spark Open');
  assert.equal(parseGroundingActor(OPEN_FEWER), 'Muse Spark Open');
  assert.equal(parseGroundingActor(SPARK13), 'Muse Spark');
  assert.equal(parseGroundingActor(OLD), 'Muse Spark', 'older runs were all Spark 1.3');
  assert.equal(parseGroundingActor(undefined), 'Muse Spark');
});

test('an open-weights run: “Muse Spark Open located 5 parts · SAM 3.1 confirmed 4 of 5 in 1.9 s”', () => {
  const [r1, r2] = samLines(withSegmentDetail(OPEN, 90));
  assert.equal(r1, 'Muse Spark Open located 5 parts · SAM 3.1 confirmed 4 of 5 in 1.9 s');
  assert.equal(r2, 'Muse Spark Open located 5 parts · SAM 3.1 confirmed 4 of 5 in 0.8 s');
  assert.equal(samLines(withSegmentDetail(OPEN_FEWER, 90))[0], 'Muse Spark Open located 4 of 5 parts · SAM 3.1 confirmed 5 of 5 in 1.9 s');
});

test('a Spark 1.3 run keeps “Muse Spark located …”; a failed Spark Open grounding call keeps the SAM-only wording', () => {
  assert.equal(samLines(withSegmentDetail(SPARK13, 90))[0], 'Muse Spark located 5 parts · SAM 3.1 confirmed 4 of 5 in 1.9 s');
  assert.equal(samLines(withSegmentDetail(OPEN_FAILED, 90))[0], 'SAM 3.1 outlined 5 of 5 parts in 1.9 s');
});

test('figure frame: the Muse half names Muse Spark Open on an open-weights run, Muse Spark on 1.3', () => {
  assert.deepEqual(figureNote(partBuilds(withSegmentDetail(OPEN, 62))[LD]), {
    actor: 'SAM 3.1', text: 'confirmed 4 of 5 in 1.9 s', working: false, muse: { actor: 'Muse Spark Open', text: 'located 5 parts' },
  });
  assert.deepEqual(figureNote(partBuilds(withSegmentDetail(SPARK13, 62))[LD]), {
    actor: 'SAM 3.1', text: 'confirmed 4 of 5 in 1.9 s', working: false, muse: { actor: 'Muse Spark', text: 'located 5 parts' },
  });
  // while the call is open nothing is known about the grounding yet
  assert.deepEqual(figureNote(partBuilds(withSegmentDetail(OPEN, 60))[LD]), { actor: 'SAM 3.1', text: 'is outlining 5 parts of the figure', working: true });
});
