/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { normaliseJobDetail } from './lessonJob.ts';
import type { JobDetail } from '../api.ts';
import { liveStrip, partBuilds } from './liveBuild.ts';
import { replaySnapshot } from './replay.ts';
import { fixtureFinalWire } from './liveBuildFixtures.ts';
import {
  activeSteps, canGoNext, clipRect, placeCard, placeStep, shouldAutoStart, stepReady, tourRequest, tourSignals, tourSteps, unionRect,
} from './onboarding.ts';
import type { TourSignals } from './onboarding.ts';

const at = (s: number): JobDetail => normaliseJobDetail(replaySnapshot(fixtureFinalWire(), s * 1000));
const LIB = { pages: 97, subjects: 9 };
const sig = (s: number | null, extra: Partial<Parameters<typeof tourSignals>[0]> = {}): TourSignals => {
  const d = s === null ? null : at(s);
  return tourSignals({
    replayAvailable: true, replaying: d !== null, detail: d, builds: d === null ? {} : partBuilds(d), strip: d === null ? null : liveStrip(d),
    canPresent: d !== null && d.summary.status === 'succeeded', library: LIB, speed: 2, recording: normaliseJobDetail(fixtureFinalWire()), ...extra,
  });
};
// Demo v2: the build steps are the recorded run's beats (lib/demoBeats.ts); this fixture run has 10.
const BUILD = Array.from({ length: 10 }, () => 'build');
const beatStep = (s: TourSignals, kind: string) => tourSteps(s).find((x) => x.beat?.kind === kind);
const ids = (s: TourSignals): string[] => activeSteps(s).map((x) => x.id);

test('tourRequest: ?tour=1 forces, ?tour=0 suppresses, speed defaults to 4 (Demo v2) and is clamped', () => {
  assert.deepEqual(tourRequest(''), { force: false, suppress: false, speed: 4 });
  assert.deepEqual(tourRequest('?tour=1&speed=8'), { force: true, suppress: false, speed: 8 });
  assert.equal(tourRequest('?tour=1&speed=99').speed, 16);
  assert.equal(tourRequest('?tour=1&speed=0').speed, 4);
  assert.equal(tourRequest('?tour=1&speed=abc').speed, 4);
  assert.equal(tourRequest('?tour=0').suppress, true);
});

test('shouldAutoStart: once on a plain first visit, never over a deep link, always when forced', () => {
  assert.equal(shouldAutoStart(null, ''), true);
  assert.equal(shouldAutoStart('done', ''), false);
  assert.equal(shouldAutoStart('skipped', ''), false);
  for (const q of ['?job=x', '?present=x', '?replay=x', '?lesson-demo=1', '?engine-demo=c']) assert.equal(shouldAutoStart(null, q), false, q);
  assert.equal(shouldAutoStart('done', '?tour=1'), true);
  assert.equal(shouldAutoStart(null, '?tour=0'), false);
  assert.equal(shouldAutoStart('done', '?job=x&tour=1'), true);
});

test('steps in order; the replay steps drop out when the recorded run is missing', () => {
  // Demo v2: one build step per beat, known from the recording before the replay starts (the count holds still).
  assert.deepEqual(ids(sig(null)), ['welcome', 'library', ...BUILD, 'try', 'present', 'own']);
  assert.deepEqual(ids(sig(36)), ids(sig(null)));
  assert.deepEqual(ids(sig(null, { recording: null })), ['welcome', 'library', 'build', 'try', 'present', 'own'], 'one reading step until the recording loads');
  // W-08 (Set A): without the recording and with nothing on screen to try, the try step drops out too.
  const none = sig(null, { replayAvailable: false });
  assert.deepEqual(ids(none), ['welcome', 'library', 'present', 'own']);
  assert.equal(activeSteps(none)[1]?.primary, 'next', 'no replay button when nothing can be replayed');
  assert.equal(activeSteps(sig(null))[1]?.primary, 'replay');
  assert.equal(activeSteps(sig(null))[1]?.primaryLabel, 'Watch a lesson being built');
});

test('steps read real counts and the run’s own model, and only claim a repair the run had', () => {
  const lib = tourSteps(sig(null)).find((x) => x.id === 'library');
  assert.match(lib?.body ?? '', /97 licensed pages in 9 subjects/);
  assert.match(tourSteps(sig(null, { library: null })).find((x) => x.id === 'library')?.body ?? '', /a library of licensed pages/);
  assert.equal(beatStep(sig(10), 'reading')?.title, 'Muse Spark 1.3 is reading the page');
  assert.match(beatStep(sig(10), 'reading')?.body ?? '', /replay of a recorded run, at 2× speed/);
  // Demo v2: the failed check has its own beat (reworking), and the repaired part's checked beat says it passed.
  assert.match(beatStep(sig(65), 'failed')?.body ?? '', /reworking it as revision 2/);
  const revised = tourSteps(sig(90)).find((x) => x.beat?.kind === 'passed' && x.beat.revised);
  assert.equal(revised?.title, 'Revised by Muse after a failed check');
  assert.match(revised?.body ?? '', /revision 2 passed 11 of 11 checks\..*not a planted fault/);
  // Calvin's rule: a natural repair is "revised by Muse after a failed check", never "the model's own mistake".
  for (const x of tourSteps(sig(90)).filter((y) => y.beat !== null)) assert.doesNotMatch(x.body, /mistake|\bown\b/i, x.title);
});

test('copy: the closing step does not clash with "Needs review"; the try step fits the part', () => {
  const ready = beatStep(sig(90), 'done');
  assert.equal(ready?.title, 'Ready for your review');
  assert.doesNotMatch(`${ready?.title} ${ready?.body}`, /ready to teach/i);
  // The tour run's first part is a label diagram: no "prediction first" over a drag-and-name task.
  const tryDiagram = tourSteps(sig(90)).find((x) => x.id === 'try')?.body ?? '';
  assert.match(tryDiagram, /Drag each name onto its number, then press Check/);
  assert.doesNotMatch(tryDiagram, /prediction/);
  const trySequence = tourSteps(sig(72)).find((x) => x.id === 'try')?.body ?? '';
  assert.doesNotMatch(trySequence, /prediction|numbered/, 'a sequence is not a prediction either');
  const quizSignals: TourSignals = { ...sig(90), firstPart: 'quiz-cards-v1' };
  assert.match(tourSteps(quizSignals).find((x) => x.id === 'try')?.body ?? '', /prediction first/);
});

test('signals follow the recorded run moment by moment', () => {
  const r = sig(10);
  assert.equal(r.replaying, true);
  assert.equal(r.finished, false);
  assert.equal(r.beats.length, 10, 'the beats come from the whole recording, not from what the replay has reached');
  assert.equal(sig(72).firstPart, 'sequence-v1', 'the sequence passed first');
  const f = sig(90);
  assert.equal(f.finished, true);
  assert.equal(f.firstPart, 'label-diagram-v1', 'plan order once both passed');
  assert.equal(f.canPresent, true);
  const notReplaying = sig(90, { replaying: false });
  assert.equal(notReplaying.replaying, false);
  assert.equal(notReplaying.finished, false, 'a stored lesson at rest is not the tour replay');
});

test('readiness (Demo v2): a build step never waits on the replay; only the try step needs a part to try', () => {
  for (const t of [null, 5, 36, 70]) {
    const steps = activeSteps(sig(t));
    steps.forEach((x, i) => { if (x.id === 'build') assert.equal(canGoNext(steps, i, sig(t)), true, `${x.beat?.id} at ${t}`); });
  }
  assert.equal(stepReady('build', sig(null)), true);
  assert.equal(stepReady('try', sig(5)), false);
  assert.equal(stepReady('try', sig(90)), true);
  const steps = activeSteps(sig(90));
  assert.equal(canGoNext(steps, steps.length - 1, sig(90)), false, 'nothing after the last step');
});

test('card placement: beside the target where it fits, else below/above, else inside; centred without a target', () => {
  const vp = { w: 1920, h: 1080 };
  const card = { w: 360, h: 220 };
  assert.deepEqual(placeCard(null, vp, card), { x: 780, y: 430, side: 'center' });
  assert.deepEqual(placeCard({ x: 100, y: 100, w: 400, h: 60 }, vp, card), { x: 516, y: 100, side: 'right' });
  assert.equal(placeCard({ x: 1300, y: 100, w: 580, h: 60 }, vp, card).side, 'left');
  assert.equal(placeCard({ x: 10, y: 100, w: 1900, h: 200 }, vp, card).side, 'below');
  assert.equal(placeCard({ x: 10, y: 700, w: 1900, h: 360 }, vp, card).side, 'above');
  const inside = placeCard({ x: 10, y: 10, w: 1900, h: 1060 }, vp, card);
  assert.equal(inside.side, 'inside');
  assert.ok(inside.x + card.w <= vp.w - 16 && inside.y + card.h <= vp.h - 16);
  // kept inside the viewport vertically when the target sits low
  const low = placeCard({ x: 100, y: 1000, w: 300, h: 40 }, vp, card);
  assert.equal(low.side, 'right');
  assert.equal(low.y, 1080 - 220 - 16);
  // never over a second cut-out: the overview step (overview + source text on its left) puts the card below
  const overview = { x: 712, y: 392, w: 1072, h: 204 };
  const source = { x: 140, y: 150, w: 500, h: 880 };
  assert.equal(placeCard(overview, vp, card).side, 'left', 'without the second hole, left would do');
  const both = placeCard(overview, vp, card, [overview, source]);
  assert.equal(both.side, 'below');
  assert.ok(both.x >= source.x + source.w, 'clear of the source text');
});

test('the reading and summary steps light what they talk about, so the card sits clear of it (demo pair review #4, #5)', () => {
  const reading = beatStep(sig(10), 'reading');
  assert.deepEqual(reading?.targets, ['[data-tour="live-strip"]', '[data-tour="source-text"]']);
  const overview = beatStep(sig(36), 'summary');
  assert.deepEqual(overview?.targets, ['.lesson .overview', '[data-tour="source-text"]']);
  assert.deepEqual(overview?.extras, ['.lesson [data-component]']);
  for (const x of tourSteps(sig(36))) assert.ok(Array.isArray(x.extras), x.id);
});

// Measured at 1920 × 1080 on the tour run (padded cut-outs), with the larger ≥ 1600 px card.
const VP = { w: 1920, h: 1080 };
const CARD = { w: 460, h: 300 };
const STRIP = { x: 719, y: 93, w: 1055, h: 129 };
const SOURCE = { x: 145, y: 158, w: 494, h: 846 };
const OVERVIEW = { x: 719, y: 390, w: 1055, h: 172 };
const FRAMES = [{ x: 719, y: 571, w: 1055, h: 428 }];
const hits = (p: { x: number; y: number }, rs: readonly { x: number; y: number; w: number; h: number }[]): number =>
  rs.filter((r) => p.x < r.x + r.w && r.x < p.x + CARD.w && p.y < r.y + r.h && r.y < p.y + CARD.h).length;

test('placeStep: the reading card drops below the strip into the empty lesson column, off the page being read', () => {
  const p = placeStep([[STRIP], [SOURCE]], 2, VP, CARD);
  assert.equal(p.side, 'below');
  assert.equal(hits(p, [STRIP, SOURCE]), 0);
  assert.equal(p.cut.length, 2);
});

test('placeStep: the summary card stays off the overview, the page and the part frames below', () => {
  const p = placeStep([[OVERVIEW], [SOURCE], FRAMES], 2, VP, CARD);
  assert.equal(hits(p, [OVERVIEW, SOURCE, ...FRAMES]), 0);
  assert.equal(p.side, 'above');
  assert.equal(p.cut.length, 3, 'the frames are lit too');
});

test('placeStep: on a screen too small for that, extras are dropped before a target is covered', () => {
  const vp = { w: 1366, h: 768 };
  const card = { w: 380, h: 300 };
  const overview = { x: 520, y: 200, w: 760, h: 150 };
  const source = { x: 100, y: 120, w: 400, h: 600 };
  const frames = [{ x: 520, y: 366, w: 760, h: 390 }];
  const p = placeStep([[overview], [source], frames], 2, vp, card);
  assert.notEqual(p.side, 'inside');
  assert.equal(p.cut.length, 2, 'frames left dimmed');
  const ov = (r: { x: number; y: number; w: number; h: number }): boolean => p.x < r.x + r.w && r.x < p.x + card.w && p.y < r.y + r.h && r.y < p.y + card.h;
  assert.equal(ov(overview) || ov(source), false);
});

test('placeCard: a below card that would cover a second cut-out under the target’s left end moves to its right end', () => {
  const target = { x: 600, y: 100, w: 1200, h: 100 };
  const blocker = { x: 500, y: 200, w: 500, h: 600 };
  const p = placeCard(target, VP, { w: 460, h: 300 }, [target, blocker]);
  assert.equal(p.side, 'below');
  assert.equal(p.x, 1800 - 460);
});

test('the present step points at the closing beat once the replay has finished, else at the lesson’s Present button', () => {
  const present = (s: TourSignals) => tourSteps(s).find((x) => x.id === 'present');
  assert.deepEqual(present(sig(90))?.targets, ['[data-tour="live-strip"]']);
  assert.equal(present(sig(90))?.primary, 'next', 'Stage 10c: the Demo goes on to Try your own page');
  assert.deepEqual(present(sig(90))?.secondary, { action: 'present', label: 'Open presentation mode' });
  assert.deepEqual(present(sig(null))?.targets, ['[data-tour="present"]']);
  assert.equal(present(sig(null))?.secondary, null, 'nothing to present: no side action');
  assert.equal(sig(null, { replayLoading: true }).replayLoading, true);
});

test('rect helpers: union and clipping to the visible panel', () => {
  assert.equal(unionRect([]), null);
  assert.deepEqual(unionRect([{ x: 10, y: 10, w: 10, h: 10 }, { x: 30, y: 0, w: 5, h: 50 }]), { x: 10, y: 0, w: 25, h: 50 });
  assert.deepEqual(clipRect({ x: 0, y: 900, w: 500, h: 400 }, { x: 0, y: 0, w: 1920, h: 1000 }), { x: 0, y: 900, w: 500, h: 100 });
  assert.equal(clipRect({ x: 0, y: 1100, w: 10, h: 10 }, { x: 0, y: 0, w: 1920, h: 1080 }), null);
});
