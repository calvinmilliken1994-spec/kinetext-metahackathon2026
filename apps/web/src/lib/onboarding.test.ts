/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { normaliseJobDetail } from './lessonJob.ts';
import type { JobDetail } from '../api.ts';
import { liveStrip, partBuilds } from './liveBuild.ts';
import { replaySnapshot } from './replay.ts';
import { fixtureFinalWire } from './liveBuildFixtures.ts';
import {
  activeSteps, autoAdvance, canGoNext, clipRect, placeCard, placeStep, shouldAutoStart, stepReady, tourRequest, tourSignals, tourSteps, unionRect,
  TOUR_MIN_DWELL_MS,
} from './onboarding.ts';
import type { TourSignals } from './onboarding.ts';

const at = (s: number): JobDetail => normaliseJobDetail(replaySnapshot(fixtureFinalWire(), s * 1000));
const LIB = { pages: 97, subjects: 9 };
const sig = (s: number | null, extra: Partial<Parameters<typeof tourSignals>[0]> = {}): TourSignals => {
  const d = s === null ? null : at(s);
  return tourSignals({
    replayAvailable: true, replaying: d !== null, detail: d, builds: d === null ? {} : partBuilds(d), strip: d === null ? null : liveStrip(d),
    canPresent: d !== null && d.summary.status === 'succeeded', library: LIB, speed: 2, ...extra,
  });
};
const ids = (s: TourSignals): string[] => activeSteps(s).map((x) => x.id);

test('tourRequest: ?tour=1 forces, ?tour=0 suppresses, speed defaults to 2 and is clamped', () => {
  assert.deepEqual(tourRequest(''), { force: false, suppress: false, speed: 2 });
  assert.deepEqual(tourRequest('?tour=1&speed=8'), { force: true, suppress: false, speed: 8 });
  assert.equal(tourRequest('?tour=1&speed=99').speed, 16);
  assert.equal(tourRequest('?tour=1&speed=0').speed, 2);
  assert.equal(tourRequest('?tour=1&speed=abc').speed, 2);
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
  // The figure step (Stage 10c, M4) joins once the replay shows the plan has a figure part.
  assert.deepEqual(ids(sig(null)), ['welcome', 'library', 'reading', 'overview', 'checking', 'ready', 'try', 'present', 'own']);
  assert.deepEqual(ids(sig(36)), ['welcome', 'library', 'reading', 'overview', 'figure', 'checking', 'ready', 'try', 'present', 'own']);
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
  assert.equal(tourSteps(sig(10)).find((x) => x.id === 'reading')?.title, 'Muse Spark 1.3 is reading the page');
  assert.match(tourSteps(sig(10)).find((x) => x.id === 'reading')?.body ?? '', /replay of a recorded run, at 2× speed/);
  // before the failed check, the checking step makes no repair claim; during the rework it says so; after, it passed
  const check = (s: number): string => tourSteps(sig(s)).find((x) => x.id === 'checking')?.body ?? '';
  assert.doesNotMatch(check(60), /failed/);
  assert.match(check(65), /reworking it as revision 2/);
  assert.match(check(90), /revision 2 passed every check.*not a planted fault/);
  // Calvin's rule: a natural repair is "revised by Muse after a failed check", never "the model's own mistake".
  for (const t of [60, 65, 90]) assert.doesNotMatch(check(t), /mistake|\bown\b/i, `at ${t} s`);
});

test('copy: the closing step does not clash with "Teacher review pending"; the try step fits the part', () => {
  const ready = tourSteps(sig(90)).find((x) => x.id === 'ready');
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
  assert.equal(r.overview, false);
  const o = sig(36);
  assert.equal(o.overview, true);
  assert.equal(o.partProgress, false, 'parts only being written are not yet progress');
  assert.equal(o.watchPart, 'label-diagram-v1');
  assert.equal(sig(60).partProgress, true, 'SAM outlining is');
  assert.equal(sig(65).repairPart, 'label-diagram-v1');
  assert.equal(sig(65).repairPassed, false);
  assert.equal(sig(72).firstPart, 'sequence-v1', 'the sequence passed first');
  const f = sig(90);
  assert.equal(f.finished, true);
  assert.equal(f.repairPassed, true);
  assert.equal(f.firstPart, 'label-diagram-v1', 'plan order once both passed');
  assert.equal(f.canPresent, true);
  const notReplaying = sig(90, { replaying: false });
  assert.equal(notReplaying.replaying, false);
  assert.equal(notReplaying.finished, false, 'a stored lesson at rest is not the tour replay');
});

test('readiness: each replay step waits for its recorded moment', () => {
  assert.equal(stepReady('reading', sig(null)), false);
  assert.equal(stepReady('reading', sig(5)), true);
  assert.equal(stepReady('overview', sig(5)), false);
  assert.equal(stepReady('overview', sig(36)), true);
  assert.equal(stepReady('ready', sig(70)), false);
  assert.equal(stepReady('ready', sig(90)), true);
  const steps = activeSteps(sig(5));
  assert.equal(canGoNext(steps, 2, sig(5)), false, 'Next waits for the overview');
  assert.equal(canGoNext(steps, 2, sig(36)), true);
  assert.equal(canGoNext(steps, steps.length - 1, sig(90)), false, 'nothing after the last step');
});

test('auto-advance: after the replay passes the moment, and only after the minimum dwell', () => {
  const steps = activeSteps(sig(36));
  const reading = { index: 2, enteredAt: 1000 };
  assert.equal(autoAdvance(reading, steps, sig(10), 99_999), reading, 'analysis still open: stays');
  assert.equal(autoAdvance(reading, steps, sig(36), 1000 + TOUR_MIN_DWELL_MS - 1), reading, 'too soon to read');
  assert.deepEqual(autoAdvance(reading, steps, sig(36), 1000 + TOUR_MIN_DWELL_MS), { index: 3, enteredAt: 1000 + TOUR_MIN_DWELL_MS });
  const overview = { index: 3, enteredAt: 0 };
  assert.equal(autoAdvance(overview, steps, sig(40), 10_000), overview, 'writing alone does not move on');
  assert.equal(autoAdvance(overview, steps, sig(60), 10_000).index, 4, 'on to the figure step once SAM starts');
  const figure = { index: 4, enteredAt: 0 };
  assert.equal(autoAdvance(figure, steps, sig(60), 10_000), figure, 'SAM still running');
  assert.equal(autoAdvance(figure, steps, sig(62), 10_000).index, 5, 'the first draft has its check result');
  const checking = { index: 5, enteredAt: 0 };
  assert.equal(autoAdvance(checking, steps, sig(80), 10_000), checking);
  assert.equal(autoAdvance(checking, steps, sig(90), 10_000).index, 6);
  const ready = { index: 6, enteredAt: 0 };
  assert.equal(autoAdvance(ready, steps, sig(90), 99_999), ready, 'from the closing beat on, the teacher moves on');
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
  const reading = tourSteps(sig(10)).find((x) => x.id === 'reading');
  assert.deepEqual(reading?.targets, ['[data-tour="live-strip"]', '[data-tour="source-text"]']);
  const overview = tourSteps(sig(36)).find((x) => x.id === 'overview');
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
