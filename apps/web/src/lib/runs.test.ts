/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import type { JobSummary } from '../api.ts';
import { runLine, toTone } from './runs.ts';
import { activityRepairCounts, lessonRepairCounts, repairPhrases } from './provenance.ts';

const fmt = (iso: string): string => `T(${iso})`;
const base: JobSummary = {
  jobId: 'job-1', sourceId: 's', status: 'succeeded', purpose: 'p', createdAt: '2026-10-29T10:00:00Z', totalCostUSD: 0.0412,
};

test('a recorded lesson run is one line: date/time · model · status, nothing marked live', () => {
  const r = runLine({ ...base, flow: 'lesson', lesson: { overviewReady: true, componentsPlanned: 2, componentsPublished: 2, partialPublish: false } } as JobSummary, { liveJobIds: new Set(), serverBusy: false, fmt });
  assert.equal(r.when, 'T(2026-10-29T10:00:00Z)');
  assert.equal(r.model, 'Muse Spark 1.3');
  assert.equal(r.modelHow, 'Meta API');
  assert.deepEqual(r.status, { text: 'Lesson ready', tone: 'ok' });
  assert.equal(r.live, false);
  assert.equal(r.systemFault, false);
  assert.equal(r.cost, '$0.0412');
  assert.equal(r.note, null);
  assert.deepEqual(r.tags, [{ text: 'Lesson · 2 components', tone: 'neutral' }]);
});

test('a partly published lesson says so in plain words, without amber', () => {
  const r = runLine({ ...base, flow: 'lesson', lesson: { overviewReady: true, componentsPlanned: 3, componentsPublished: 2, partialPublish: true } } as JobSummary, { liveJobIds: new Set(), serverBusy: false, fmt });
  assert.deepEqual(r.status, { text: 'Some parts left out', tone: 'neutral' });
});

test('a run started in this session is live; an open-weights run names Modal', () => {
  const r = runLine({ ...base, model: 'muse-spark-open', provider: 'modal' }, { liveJobIds: new Set(['job-1']), serverBusy: true, fmt });
  assert.equal(r.live, true);
  assert.equal(r.model, 'Muse Spark Open');
  assert.equal(r.modelHow, 'Open weights · Modal');
});

test('a demo-fault run keeps its system-made label in the fault tone', () => {
  const r = runLine({
    ...base, demoFault: { kind: 'value', path: '/x', original: 1, injected: 2, revision: 1, effective: true } as unknown as JobSummary['demoFault'],
  }, { liveJobIds: new Set(), serverBusy: false, fmt });
  assert.equal(r.systemFault, true);
  assert.ok(r.tags.some((t) => t.text === 'Demo fault (system-made)' && t.tone === 'fault'));
});

test('an interrupted run carries the plain note and a cost that may be incomplete', () => {
  const r = runLine({ ...base, status: 'failed', error: { code: 'INTERRUPTED', message: '' } }, { liveJobIds: new Set(), serverBusy: false, fmt });
  assert.equal(r.status.text, 'Interrupted');
  assert.equal(r.status.tone, 'neutral');
  assert.match(r.note ?? '', /^Interrupted/);
  assert.match(r.cost, /may be incomplete/);
});

test('old tones collapse onto the semantic set', () => {
  assert.equal(toTone('natural'), 'neutral');
  assert.equal(toTone('warn'), 'neutral');
  assert.equal(toTone('lesson'), 'neutral');
  assert.equal(toTone('running'), 'accent');
  assert.equal(toTone('fault'), 'fault');
  assert.equal(toTone('bad'), 'bad');
});

test('lesson repair counts use each component’s latest attempt and keep natural and system-made apart', () => {
  const counts = lessonRepairCounts([
    { componentId: 'quiz', attempt: 1, origin: 'natural', state: 'still-failing' },
    { componentId: 'quiz', attempt: 2, origin: 'natural', state: 'passed' },
    { componentId: 'map', attempt: 1, origin: 'system', state: 'passed' },
    { componentId: 'sort', attempt: 1, origin: 'natural', state: 'still-failing' },
  ], 'passed');
  assert.deepEqual(counts, { natural: 2, system: 1, failed: 1 });
  assert.deepEqual(repairPhrases(counts).map((p) => p.tone), ['neutral', 'fault', 'bad']);
  assert.equal(repairPhrases(counts)[1]?.text, '1 system-made fault (planted on purpose, not a model error)');
  assert.equal(repairPhrases(counts)[0]?.text, '2 natural repairs (Muse’s own mistake)');
  assert.deepEqual(repairPhrases({ natural: 0, system: 0, failed: 0 }), []);
});

test('classic activity counts: analysis repair, a published repair, a planted fault', () => {
  assert.deepEqual(activityRepairCounts({ analysis: 'passed', repaired: 'natural', demoFault: false }), { natural: 2, system: 0, failed: 0 });
  assert.deepEqual(activityRepairCounts({ analysis: 'none', repaired: 'system', demoFault: true }), { natural: 0, system: 1, failed: 0 });
  assert.deepEqual(activityRepairCounts({ analysis: 'failed', repaired: null, demoFault: false }), { natural: 0, system: 0, failed: 1 });
});
