/// <reference types="node" />
// Stage 10c (docs/specs/STAGE-10c-first-launch-and-fixes.md): the Demo's new steps. M4 the figure step (Muse Spark
// locates each part, SAM 3.1 confirms it), the repair step worded from the run's own failed check, the present step
// that no longer ends the Demo, and the closing "Try your own page" card.
import test from 'node:test';
import assert from 'node:assert/strict';
import { lessonCheckName, normaliseJobDetail } from './lessonJob.ts';
import type { JobDetail } from '../api.ts';
import { liveStrip, partBuilds } from './liveBuild.ts';
import { replaySnapshot } from './replay.ts';
import { fixtureFinalWire } from './liveBuildFixtures.ts';
import { activeSteps, autoAdvance, autoUntil, stepReady, tourSignals, tourSteps, TOUR_MIN_DWELL_MS } from './onboarding.ts';
import type { SignalInput, TourSignals } from './onboarding.ts';

// The fixture copies the 31 Oct run (no grounding, LD-04). The grounded wire swaps in the 2 Nov run's recorded wording:
// "muse-spark-1.3 located 5 of 5 part(s) for SAM" on both SAM calls, and a first draft that failed LD-06.
const grounded = (): Record<string, unknown> => {
  const w = JSON.parse(JSON.stringify(fixtureFinalWire())) as { events: Array<Record<string, unknown>>; [k: string]: unknown };
  for (const e of w.events) {
    if (e['stage'] === 'segment' && e['status'] === 'succeeded') e['detail'] = 'sam-3.1 returned 5 of 5 region(s); muse-spark-1.3 located 5 of 5 part(s) for SAM; sam-3.1 sure of 5 of 5 part(s)';
    if (typeof e['detail'] === 'string') e['detail'] = (e['detail'] as string).replace('LD-04', 'LD-06');
  }
  return w;
};
const noFigure = (): Record<string, unknown> => {
  const w = JSON.parse(JSON.stringify(fixtureFinalWire())) as { events: Array<Record<string, unknown>>; analysisV2: { componentPlan: Array<{ componentId: string }> }; [k: string]: unknown };
  w.events = w.events.filter((e) => e['componentId'] !== 'label-diagram-v1');
  w.analysisV2.componentPlan = w.analysisV2.componentPlan.filter((p) => p.componentId !== 'label-diagram-v1');
  for (const r of w['analysisV2Revisions'] as Array<{ analysis: { componentPlan: Array<{ componentId: string }> } }>) {
    r.analysis.componentPlan = r.analysis.componentPlan.filter((p) => p.componentId !== 'label-diagram-v1');
  }
  return w;
};

const snap = (wire: Record<string, unknown>, s: number): JobDetail => normaliseJobDetail(replaySnapshot(wire, s * 1000));
const full = (wire: Record<string, unknown>): JobDetail => normaliseJobDetail(wire);
const LIB = { pages: 97, subjects: 10 };
const sig = (wire: Record<string, unknown> | null, s: number | null, extra: Partial<SignalInput> = {}): TourSignals => {
  const d = wire === null || s === null ? null : snap(wire, s);
  return tourSignals({
    replayAvailable: true, replaying: d !== null, detail: d, builds: d === null ? {} : partBuilds(d), strip: d === null ? null : liveStrip(d),
    canPresent: d !== null && d.summary.status === 'succeeded', library: LIB, speed: 2,
    recording: wire === null ? null : full(wire), ...extra,
  });
};
const ids = (s: TourSignals, o?: { intro: boolean }): string[] => activeSteps(s, o).map((x) => x.id);

test('M4: the figure step sits between the summary and the checks once the plan has a figure part', () => {
  assert.deepEqual(ids(sig(grounded(), 36)), ['welcome', 'library', 'reading', 'overview', 'figure', 'checking', 'ready', 'try', 'present', 'own']);
  assert.ok(!ids(sig(noFigure(), 36)).includes('figure'), 'a run with no figure has no figure step');
});

test('M4: on a grounded run it names both models: Muse Spark locates, SAM 3.1 confirms', () => {
  const s = sig(grounded(), 60);
  assert.equal(s.figurePart, 'label-diagram-v1');
  assert.deepEqual(s.figureGrounding, { located: 5, of: 5 }, 'read from the recording, so it is known while SAM is still running');
  const step = tourSteps(s).find((x) => x.id === 'figure');
  assert.match(step?.title ?? '', /Muse Spark finds the parts/);
  assert.match(step?.body ?? '', /Muse Spark locates each of the 5 parts/);
  assert.match(step?.body ?? '', /SAM 3\.1, Meta’s segmentation model,/);
  assert.doesNotMatch(step?.body ?? '', /Newer lessons/, 'no age caveat on a grounded run');
  assert.deepEqual(step?.targets, ['.lesson [data-component="label-diagram-v1"]']);
});

test('M4: a run whose grounding is recorded only as a locate event (current worker) still counts as grounded', () => {
  const w = JSON.parse(JSON.stringify(fixtureFinalWire())) as { events: Array<Record<string, unknown>> };
  const seg = w.events.findIndex((e) => e['stage'] === 'segment' && e['status'] === 'started');
  const at = w.events[seg]?.['at'];
  w.events.splice(seg + 1, 0, { ...w.events[seg], at, stage: 'locate', status: 'succeeded', detail: 'muse-spark-1.3 located 5 of 5 part(s) for SAM' });
  w.events.forEach((e, i) => { e['seq'] = i; });
  assert.deepEqual(sig(w, 62).figureGrounding, { located: 5, of: 5 });
});

test('M4: on an older run with no grounding call it says so in one honest line', () => {
  const step = tourSteps(sig(fixtureFinalWire(), 60)).find((x) => x.id === 'figure');
  assert.match(step?.title ?? '', /SAM 3\.1 outlines the parts/);
  assert.match(step?.body ?? '', /Newer lessons add a step first: Muse Spark locates each part, then SAM 3\.1 confirms it\./);
});

test('M4: the figure step waits for SAM to start, then moves on once that part has its check result', () => {
  assert.equal(stepReady('figure', sig(grounded(), 50)), false, 'before SAM starts');
  assert.equal(stepReady('figure', sig(grounded(), 60)), true, 'SAM is running');
  assert.equal(autoUntil('figure', sig(grounded(), 60)), false);
  assert.equal(autoUntil('figure', sig(grounded(), 62)), true, 'the first draft has been checked');
  const steps = activeSteps(sig(grounded(), 62));
  const at = steps.findIndex((x) => x.id === 'figure');
  const moved = autoAdvance({ index: at, enteredAt: 0 }, steps, sig(grounded(), 62), TOUR_MIN_DWELL_MS);
  assert.equal(steps[moved.index]?.id, 'checking');
});

test('the repair step names the check that failed, from the run itself (never a hard-coded check)', () => {
  const name = lessonCheckName('LD-06');
  assert.ok(name !== null);
  const check = (wire: Record<string, unknown>, s: number): string => tourSteps(sig(wire, s)).find((x) => x.id === 'checking')?.body ?? '';
  assert.equal(sig(grounded(), 65).repairCheck, name);
  assert.ok(check(grounded(), 65).includes(`“${name}”`), check(grounded(), 65));
  assert.ok(check(grounded(), 90).includes(`“${name}”`));
  assert.match(check(grounded(), 90), /revision 2 passed every check/);
  assert.ok(check(fixtureFinalWire(), 90).includes(`“${lessonCheckName('LD-04')}”`), 'the older run names its own check');
  for (const t of [65, 90]) assert.doesNotMatch(check(grounded(), t), /mistake|\bown\b/i);
});

test('the present step no longer ends the Demo: Next goes on, presentation mode is a side action', () => {
  const present = tourSteps(sig(grounded(), 90)).find((x) => x.id === 'present');
  assert.equal(present?.primary, 'next');
  assert.deepEqual(present?.secondary, { action: 'present', label: 'Open presentation mode' });
  const none = tourSteps(sig(grounded(), null, { replayAvailable: false })).find((x) => x.id === 'present');
  assert.equal(none?.secondary, null, 'nothing to present: no side action');
});

test('the Demo ends on Try your own page, with Browse the lessons as the second choice', () => {
  const steps = activeSteps(sig(grounded(), 90));
  const own = steps.at(-1);
  assert.equal(own?.id, 'own');
  assert.equal(own?.title, 'Try your own page');
  assert.equal(own?.primary, 'own');
  assert.equal(own?.primaryLabel, 'Try your own page');
  assert.deepEqual(own?.secondary, { action: 'lessons', label: 'Browse the lessons' });
  assert.deepEqual(own?.targets, []);
  assert.equal(stepReady('own', sig(grounded(), 90)), true);
  assert.match(tourSteps(sig(grounded(), 90, { own: 'locked' })).at(-1)?.body ?? '', /access code/);
  assert.doesNotMatch(tourSteps(sig(grounded(), 90, { own: 'open' })).at(-1)?.body ?? '', /access code/);
  assert.deepEqual(ids(sig(grounded(), null, { replayAvailable: false })), ['welcome', 'library', 'present', 'own']);
});

test('started from the guide\u2019s prompt, the Demo skips its own introduction and opens on the build', () => {
  assert.deepEqual(ids(sig(grounded(), 36), { intro: false }), ['reading', 'overview', 'figure', 'checking', 'ready', 'try', 'present', 'own']);
});
