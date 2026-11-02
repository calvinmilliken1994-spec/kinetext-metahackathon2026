/// <reference types="node" />
// Stage 10c (docs/specs/STAGE-10c-first-launch-and-fixes.md): the Demo's new steps. M4 the figure (Muse Spark locates
// each part, SAM 3.1 confirms it), the repair worded from the run's own failed check, the present step that no longer
// ends the Demo, and the closing "Try your own page" card. Demo v2: the figure and repair are beats of the build.
import test from 'node:test';
import assert from 'node:assert/strict';
import { lessonCheckName, normaliseJobDetail } from './lessonJob.ts';
import type { JobDetail } from '../api.ts';
import { liveStrip, partBuilds } from './liveBuild.ts';
import { replaySnapshot } from './replay.ts';
import { fixtureFinalWire } from './liveBuildFixtures.ts';
import { activeSteps, stepReady, tourSignals, tourSteps } from './onboarding.ts';
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

// Demo v2: the figure's Meta moment is now its own beats (lib/demoBeats.ts): Muse Spark locating, SAM 3.1 confirming.
const build = (s: TourSignals) => tourSteps(s).filter((x) => x.id === 'build');
const kinds = (s: TourSignals): string[] => build(s).map((x) => x.beat?.kind ?? '');

test('M4: the figure beats sit between the part starts and the checks once the plan has a figure part', () => {
  assert.deepEqual(kinds(sig(grounded(), 36)), ['reading', 'summary', 'writing', 'writing', 'locating', 'failed', 'passed', 'locating', 'passed', 'done']);
  assert.ok(!kinds(sig(noFigure(), 36)).some((k) => k === 'locating' || k === 'confirming' || k === 'outlining'), 'a run with no figure has no figure beat');
});

test('M4: on a grounded run it names both models: Muse Spark locates, SAM 3.1 confirms', () => {
  const step = build(sig(grounded(), 60)).find((x) => x.beat?.kind === 'locating');
  assert.equal(step?.title, 'Muse Spark locates the parts on the figure');
  assert.match(step?.body ?? '', /Muse Spark finds each of the 5 parts on the page’s figure/);
  assert.match(step?.body ?? '', /SAM 3\.1, Meta’s segmentation model,/);
  assert.deepEqual(step?.targets, ['.lesson [data-component="label-diagram-v1"]']);
});

test('M4: a run whose grounding is recorded as a locate event (current worker) gets the SAM confirming beat with its counts', () => {
  const w = JSON.parse(JSON.stringify(fixtureFinalWire())) as { events: Array<Record<string, unknown>> };
  const seg = w.events.findIndex((e) => e['stage'] === 'segment' && e['status'] === 'started');
  const at = w.events[seg]?.['at'];
  w.events.splice(seg + 1, 0, { ...w.events[seg], at, stage: 'locate', status: 'succeeded', detail: 'muse-spark-1.3 located 5 of 5 part(s) for SAM' });
  w.events.forEach((e, i) => { e['seq'] = i; });
  const conf = build(sig(w, 62)).find((x) => x.beat?.kind === 'confirming');
  assert.equal(conf?.title, 'SAM 3.1 confirms what Muse Spark located');
  assert.match(conf?.body ?? '', /^Muse Spark located 5 of 5 parts\. SAM 3\.1/);
});

test('M4: on an older run with no grounding call, SAM 3.1 outlines the parts (no Muse locating beat is invented)', () => {
  const steps = build(sig(fixtureFinalWire(), 60));
  assert.ok(!steps.some((x) => x.beat?.kind === 'locating' || x.beat?.kind === 'confirming'));
  const step = steps.find((x) => x.beat?.kind === 'outlining');
  assert.equal(step?.title, 'SAM 3.1 outlines the parts of the figure');
  assert.match(step?.body ?? '', /from the point Muse marked on the figure/);
});

test('the repair beats name the check that failed, from the run itself (never a hard-coded check)', () => {
  const name = lessonCheckName('LD-06');
  assert.ok(name !== null);
  const failed = build(sig(grounded(), 65)).find((x) => x.beat?.kind === 'failed');
  const revised = build(sig(grounded(), 90)).find((x) => x.beat?.kind === 'passed' && x.beat.revised);
  assert.ok(failed?.body.includes(`“${name}”`), failed?.body ?? '');
  assert.ok(revised?.body.includes(`“${name}”`), revised?.body ?? '');
  assert.equal(revised?.title, 'Revised by Muse after a failed check');
  assert.match(revised?.body ?? '', /revision 2 passed 11 of 11 checks/);
  const old = build(sig(fixtureFinalWire(), 90)).find((x) => x.beat?.kind === 'failed');
  assert.ok(old?.body.includes(`“${lessonCheckName('LD-04')}”`), 'the older run names its own check');
  for (const x of [failed, revised]) assert.doesNotMatch(x?.body ?? '', /mistake|\bown\b/i);
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
  const n = build(sig(grounded(), 36)).length;
  assert.deepEqual(ids(sig(grounded(), 36), { intro: false }), [...Array.from({ length: n }, () => 'build'), 'try', 'present', 'own']);
});
