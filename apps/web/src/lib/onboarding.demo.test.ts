/// <reference types="node" />
// Stage 10 (Calvin: "Tour should also be renamed demo"): ?demo= is the new alias of ?tour=, and nothing the visitor
// reads calls it a tour any more. Internal names and the storage key stay.
import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldAutoStart, tourRequest, tourSteps, tourSignals } from './onboarding.ts';
import { shownSearch } from './jobUrl.ts';

test('?demo=1 forces the demo and ?demo=0 suppresses it, like ?tour=', () => {
  assert.deepEqual(tourRequest('?demo=1&speed=4'), { force: true, suppress: false, speed: 4 });
  assert.equal(tourRequest('?demo=0').suppress, true);
  assert.equal(shouldAutoStart('done', '?demo=1'), true);
  assert.equal(shouldAutoStart(null, '?demo=0'), false);
  assert.equal(tourRequest('?tour=1').force, true, '?tour= keeps working');
});

test('a ?view= link to another page does not start the demo by itself', () => {
  assert.equal(shouldAutoStart(null, '?view=new'), false);
  assert.equal(shouldAutoStart(null, '?view=how'), false);
  assert.equal(shouldAutoStart(null, ''), true);
});

test('a forced demo keeps its replay speed when the address bar is rewritten', () => {
  assert.equal(shownSearch('?demo=1&replay=job-a&speed=4', 'job-b', { replaying: false, presenting: false, opened: true }), '?demo=1&speed=4&job=job-b');
});

test('no step of the demo calls itself a tour', () => {
  const s = tourSignals({ replayAvailable: true, replaying: false, detail: null, builds: {}, strip: null, canPresent: true, library: { pages: 97, subjects: 10 }, speed: 2 });
  for (const step of tourSteps(s)) {
    assert.equal(/\btour\b/i.test(`${step.title} ${step.body} ${step.primaryLabel}`), false, step.id);
  }
  const lib = tourSteps(s).find((x) => x.id === 'library');
  assert.match(lib?.body ?? '', /this demo plays back a recorded build/);
});
