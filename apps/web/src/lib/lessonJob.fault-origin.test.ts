/// <reference types="node" />
// S6R-11 — the origin of a component repair is immutable per component and comes from an
// ACTUAL injection (an inject 'succeeded' event carrying the componentId, or the worker's
// per-record afterInjectedFault), never from the attempt number or from the mere presence
// of summary.demoFault. Three fault states stay distinct: requested-but-not-injected,
// injected-but-not-caught, injected-and-caught. Fixture data only (no model output).
import test from 'node:test';
import assert from 'node:assert/strict';
import type { JobDetail } from '../api.ts';
import {
  SYSTEM_REPAIR_LABEL, SYSTEM_UNCAUGHT_REPAIR_LABEL, buildLessonRepairs, buildLessonSteps, faultComponent, lessonFaultState, normaliseJobDetail,
} from './lessonJob.ts';
import { lessonWire } from './lessonJobFixtures.ts';
import type { WireObject } from './lessonJobFixtures.ts';
import { lessonRepairCounts } from './provenance.ts';

type Ev = Record<string, unknown>;
const events = (w: WireObject): Ev[] => w.events as Ev[];
const summaryOf = (w: WireObject): Record<string, unknown> => w.summary as Record<string, unknown>;

function addEvents(w: WireObject, extra: Ev[]): void {
  const list = events(w);
  const doneEv = list.pop() as Ev; // keep 'done' last
  for (const e of extra) list.push({ jobId: summaryOf(w).jobId, at: doneEv.at, model: 'muse-spark-1.3', ...e });
  list.push(doneEv);
  list.forEach((e, i) => { e.seq = i + 1; });
}

/** The review recipe: the injected component's repair attempt 1 FAILS and attempt 2 / revision 3 passes. */
function faultRepairedOnSecondAttempt(): WireObject {
  const w = lessonWire('system-fault');
  w.componentRepairs = [
    { componentId: 'quiz-cards-v1', attempt: 1, revision: 2, targeted: ['Q-01'], fixed: [], remaining: ['Q-01'], passed: false },
    { componentId: 'quiz-cards-v1', attempt: 2, revision: 3, targeted: ['Q-01'], fixed: ['Q-01'], remaining: [], passed: true },
  ];
  addEvents(w, [
    { stage: 'repair', status: 'started', target: 'component', componentId: 'quiz-cards-v1', revision: 3 },
    { stage: 'repair', status: 'succeeded', target: 'component', componentId: 'quiz-cards-v1', revision: 3, estCostUSD: 0.0151 },
    { stage: 'component', status: 'succeeded', componentId: 'quiz-cards-v1', revision: 3 },
  ]);
  return w;
}

/** A natural quiz repair on a job whose requested fault could NOT be injected (no component). */
function requestedNotInjected(): WireObject {
  const w = lessonWire('repaired');
  summaryOf(w).demoFault = { kind: 'fabricated-quote', path: '', original: '', injected: '', revision: 1, effective: false };
  addEvents(w, [{ stage: 'inject', status: 'failed', detail: 'demo fault requested by the system but NOT injected: the plan has no quiz-cards-v1 component' }]);
  return w;
}

const d = (w: WireObject): JobDetail => normaliseJobDetail(w);

test('S6R-11: attempt 2 of the injected component stays system-made; the provenance line never claims a natural repair', () => {
  const detail = d(faultRepairedOnSecondAttempt());
  assert.equal(faultComponent(detail), 'quiz-cards-v1');
  assert.equal(lessonFaultState(detail), 'injected-caught');
  const cards = buildLessonRepairs(detail);
  assert.deepEqual(cards.map((c) => [c.attempt, c.revision, c.origin, c.state]), [
    [1, 2, 'system', 'still-failing'],
    [2, 3, 'system', 'passed'],
  ]);
  assert.equal(cards[1]?.badge.text, SYSTEM_REPAIR_LABEL);
  assert.deepEqual(lessonRepairCounts(cards, 'none'), { natural: 0, system: 1, failed: 0 });
  const step = buildLessonSteps(detail).find((s) => s.key === 'component-quiz-cards-v1');
  assert.deepEqual(step?.tags.map((t) => t.text), ['System-made fault']);
});

test('S6R-11: a running repair of the injected component (any revision) is system-made', () => {
  const w = lessonWire('system-fault');
  addEvents(w, [{ stage: 'repair', status: 'started', target: 'component', componentId: 'quiz-cards-v1', revision: 3 }]);
  const running = buildLessonRepairs(d(w)).find((c) => c.state === 'running');
  assert.equal(running?.revision, 3);
  assert.equal(running?.origin, 'system');
});

test('S6R-11: a requested-but-not-injected fault never turns a natural repair into a system-made one', () => {
  const detail = d(requestedNotInjected());
  assert.equal(faultComponent(detail), null, 'no component carries a fault: nothing was injected');
  assert.equal(lessonFaultState(detail), 'requested-not-injected');
  const cards = buildLessonRepairs(detail);
  assert.deepEqual(cards.map((c) => [c.componentId, c.origin, c.state]), [['quiz-cards-v1', 'natural', 'passed']]);
  assert.deepEqual(lessonRepairCounts(cards, 'none'), { natural: 1, system: 0, failed: 0 });
});

test('S6R-11: injected-but-not-caught stays system-made and says the fault was not caught', () => {
  const w = lessonWire('system-fault');
  (summaryOf(w).demoFault as Record<string, unknown>).effective = false;
  const detail = d(w);
  assert.equal(lessonFaultState(detail), 'injected-not-caught');
  const c = buildLessonRepairs(detail)[0];
  assert.equal(c?.origin, 'system', 'its baseline carries a planted change: never a natural-repair claim');
  assert.equal(c?.badge.text, SYSTEM_UNCAUGHT_REPAIR_LABEL);
  assert.deepEqual(lessonRepairCounts(buildLessonRepairs(detail), 'none'), { natural: 0, system: 1, failed: 0 });
});

test('S6R-11: no demo fault at all → state none; the worker record flag alone also marks system-made', () => {
  assert.equal(lessonFaultState(d(lessonWire('repaired'))), 'none');
  const w = lessonWire('repaired');
  (w.componentRepairs as Record<string, unknown>[])[0]!.afterInjectedFault = true;
  summaryOf(w).demoFault = { kind: 'fabricated-quote', path: '/cards/0/quote', original: 'a', injected: 'b', revision: 1, effective: true };
  assert.equal(buildLessonRepairs(d(w))[0]?.origin, 'system');
  // ...and the record flag false with no inject event keeps it natural
  const n = lessonWire('repaired');
  (n.componentRepairs as Record<string, unknown>[])[0]!.afterInjectedFault = false;
  assert.equal(buildLessonRepairs(d(n))[0]?.origin, 'natural');
});

test('S6R-11: lessonRepairCounts keeps a component system-made even when a later card is (wrongly) labelled natural', () => {
  const counts = lessonRepairCounts([
    { componentId: 'quiz', attempt: 1, origin: 'system', state: 'still-failing' },
    { componentId: 'quiz', attempt: 2, origin: 'natural', state: 'passed' },
    { componentId: 'map', attempt: 1, origin: 'natural', state: 'passed' },
  ], 'none');
  assert.deepEqual(counts, { natural: 1, system: 1, failed: 0 });
});
