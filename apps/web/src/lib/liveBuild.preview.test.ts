/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { normaliseJobDetail } from './lessonJob.ts';
import type { JobDetail } from '../api.ts';
import { KIT_GEN_COMPONENT_IDS } from '../../../../packages/contracts/kit.ts';
import { closingBeat, FRAME_HEAD_PX, followFocus, liveStrip, partBuilds, previewOf, previewPhase, progressFacts, reserveHeight } from './liveBuild.ts';
import type { StripState } from './liveBuild.ts';
import { replaySnapshot } from './replay.ts';
import { fixtureFinalWire } from './liveBuildFixtures.ts';

const at = (s: number): JobDetail => normaliseJobDetail(replaySnapshot(fixtureFinalWire(), s * 1000));
const ORDER = ['label-diagram-v1', 'sequence-v1'];

test('every kit kind has its own skeleton shape; premium activities a scene; unknown ids a few lines', () => {
  const kinds = KIT_GEN_COMPONENT_IDS.map((id) => previewOf(id).kind);
  assert.ok(!kinds.includes('lines'), 'no kit part falls back to the generic preview');
  assert.equal(previewOf('quiz-cards-v1').kind, 'quiz');
  assert.equal(previewOf('sequence-v1').kind, 'sequence');
  assert.equal(previewOf('data-table-v1').kind, 'grid');
  assert.equal(previewOf('formula-explorer-v1').kind, 'explorer');
  assert.equal(previewOf('label-diagram-v1').kind, 'figure');
  assert.equal(previewOf('forces-1d-v1').kind, 'scene');
  assert.equal(previewOf('timeline-v1').kind, 'scene');
  assert.equal(previewOf('nonsense-v9').kind, 'lines');
});

test('the reserve is sized from the preview: frame head plus preview body', () => {
  for (const id of [...KIT_GEN_COMPONENT_IDS, 'forces-1d-v1', 'nonsense-v9']) {
    assert.equal(reserveHeight(id), FRAME_HEAD_PX + previewOf(id).bodyPx, id);
    assert.ok(reserveHeight(id) >= 280, id);
  }
  // measured medians of stored published parts (1920 and 1366): within ~15 %
  const measured: Record<string, number> = { 'quiz-cards-v1': 1250, 'formula-explorer-v1': 1360, 'sequence-v1': 580, 'label-diagram-v1': 680, 'concept-map-v1': 900, 'compare-table-v1': 300 };
  for (const [id, h] of Object.entries(measured)) assert.ok(Math.abs(reserveHeight(id) - h) / h < 0.15, `${id}: ${reserveHeight(id)} vs ${h}`);
});

test('the label diagram preview shows one label chip per part SAM was asked to outline, once that call is recorded', () => {
  assert.equal(previewOf('label-diagram-v1', partBuilds(at(40))['label-diagram-v1']).rows, 5, 'default before SAM');
  assert.equal(previewOf('label-diagram-v1', partBuilds(at(60))['label-diagram-v1']).rows, 5);
  const wire = fixtureFinalWire() as { events: Array<Record<string, unknown>> };
  for (const e of wire.events) if (e.stage === 'segment' && e.status === 'started') e.detail = 'sam-3.1 point segmentation of 7 part(s)';
  const d = normaliseJobDetail(replaySnapshot(wire, 60_000));
  assert.equal(previewOf('label-diagram-v1', partBuilds(d)['label-diagram-v1']).rows, 7);
  assert.equal(previewOf('label-diagram-v1', partBuilds(d)['label-diagram-v1']).bodyPx, previewOf('label-diagram-v1').bodyPx, 'chips never change the reserve');
});

test('preview phase follows the part log', () => {
  assert.equal(previewPhase(undefined), 'waiting');
  assert.equal(previewPhase(partBuilds(at(40))['sequence-v1']), 'writing');
  assert.equal(previewPhase(partBuilds(at(60))['label-diagram-v1']), 'outlining');
  assert.equal(previewPhase(partBuilds(at(65))['label-diagram-v1']), 'reworking');
  assert.equal(previewPhase(partBuilds(at(90))['label-diagram-v1']), 'checked');
});

test('follow: only watchable moments move the view, and a busy focus is kept', () => {
  assert.equal(followFocus(null, partBuilds(at(40)), ORDER, []), null, 'plain writing keeps the overview in view');
  assert.equal(followFocus(null, partBuilds(at(60)), ORDER, []), 'label-diagram-v1', 'SAM outlining');
  assert.equal(followFocus('label-diagram-v1', partBuilds(at(65)), ORDER, []), 'label-diagram-v1', 'reworking keeps it');
  assert.equal(followFocus('label-diagram-v1', partBuilds(at(72)), ORDER, ['sequence-v1']), 'sequence-v1', 'an arrival wins');
  assert.equal(followFocus('sequence-v1', partBuilds(at(82.5)), ORDER, []), 'label-diagram-v1', 'SAM outlining again pulls it back');
  assert.equal(followFocus('sequence-v1', partBuilds(at(75)), ORDER, []), 'label-diagram-v1', 'the reworked part is the only busy one');
  assert.equal(followFocus('x', {}, ORDER, []), 'x', 'nothing busy: stay');
});

test('strip progress facts while running, from recorded events only', () => {
  assert.deepEqual(progressFacts(liveStrip(at(10))), ['No call finished yet']);
  assert.deepEqual(progressFacts(liveStrip(at(40))), ['1 Muse Spark 1.3 call done', '0 of 2 parts checked']);
  assert.deepEqual(progressFacts(liveStrip(at(72))), ['3 Muse Spark 1.3 calls done', '1 SAM 3.1 call', '1 of 2 parts checked']);
});

test('closing beat: lesson ready, real call counts, and "every part checked" only when every planned part passed', () => {
  const s = liveStrip(at(90));
  assert.deepEqual(closingBeat(s), {
    headline: 'Lesson ready · built in 1 min 22 s', ready: true,
    facts: ['4 Muse Spark 1.3 calls', '2 SAM 3.1 calls', 'every part checked', '$0.144 est.'],
  });
  const partial: StripState = { ...s, partsPassed: 1, partsLeftOut: 1 };
  assert.deepEqual(closingBeat(partial).facts.slice(2, 4), ['1 of 2 parts checked', '1 left out']);
  assert.equal(closingBeat({ ...s, failed: true }).headline, 'The run stopped after 1 min 22 s');
  assert.equal(closingBeat({ ...s, failed: true }).ready, false);
  assert.equal(closingBeat({ ...s, partsPlanned: 0, partsPassed: 0 }).headline, 'Finished in 1 min 22 s');
});
