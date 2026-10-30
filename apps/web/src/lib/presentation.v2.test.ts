/// <reference types="node" />
// Presentation mode pass 2: the white screen (W), the predict beat's visual kind, its verdict line, and the projectile
// ask frame (a height scale chosen from the class's guess alone, so the scene never gives the answer away before R).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  acceptsNumber, deckFromActivity, initialPresent, KEY_MAP, keyAction, planBeats, predictVerdict, predictVisual, presentReducer, revealDelayMs,
} from './presentation.ts';
import type { Beat, PresentAction, PresentState } from './presentation.ts';
import { makeMoonSpec } from './moon-fixture.ts';
import { askFrame, heightTicks, PROJECTILE_FRAME, projectileScene } from './geometry.ts';
import { loadDemoLessons } from './stage6-fixtures.ts';
import { deckFromLesson } from './presentation.ts';

const k = (key: string) => ({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false });
const run = (beats: readonly Beat[], s: PresentState, ...as: PresentAction[]): PresentState => as.reduce(presentReducer(beats), s);

function moonBeats(): Beat[] {
  const deck = deckFromActivity({ jobId: 'job-moon', spec: makeMoonSpec(), source: null, disclosure: 'x', checks: null, quotes: null });
  return planBeats(deck);
}

test('W turns the screen white; W again brings the picture back', () => {
  assert.deepEqual(keyAction(k('w'), 'none'), { type: 'blank', tone: 'white' });
  assert.deepEqual(keyAction(k('W'), 'none'), { type: 'blank', tone: 'white' });
  assert.equal(keyAction(k('w'), 'text'), null, 'typing a w into a field stays in the field');
  const beats = moonBeats();
  let s = run(beats, initialPresent(beats), { type: 'blank', tone: 'white' });
  assert.deepEqual([s.blank, s.blankTone], [true, 'white']);
  s = run(beats, s, { type: 'blank', tone: 'white' });
  assert.equal(s.blank, false);
});

test('B and W swap the blank colour; any move key only brings the picture back', () => {
  const beats = moonBeats();
  let s = run(beats, initialPresent(beats), { type: 'blank', tone: 'white' }, { type: 'blank' });
  assert.deepEqual([s.blank, s.blankTone], [true, 'black'], 'B on a white screen turns it black, it does not unblank');
  s = run(beats, s, { type: 'blank', tone: 'white' });
  assert.deepEqual([s.blank, s.blankTone], [true, 'white']);
  s = run(beats, s, { type: 'next' });
  assert.deepEqual([s.blank, s.beat], [false, 0]);
  assert.equal(initialPresent(beats).blankTone, 'black');
});

test('on an open number question the keys type the class prediction (no field to click into)', () => {
  assert.deepEqual(keyAction(k('7'), 'numeric'), { type: 'type', key: '7' });
  assert.deepEqual(keyAction(k('.'), 'numeric'), { type: 'type', key: '.' }, 'a decimal point, not the black screen');
  assert.deepEqual(keyAction(k(','), 'numeric'), { type: 'type', key: '.' }, 'a decimal comma');
  assert.deepEqual(keyAction(k('-'), 'numeric'), { type: 'type', key: '-' });
  assert.deepEqual(keyAction(k('Backspace'), 'numeric'), { type: 'type', key: 'Backspace' });
  assert.deepEqual(keyAction(k('r'), 'numeric'), { type: 'reveal' }, 'R still reveals');
  assert.deepEqual(keyAction(k('ArrowRight'), 'numeric'), { type: 'next' }, 'a clicker still moves on');
  assert.deepEqual(keyAction(k('PageDown'), 'numeric'), { type: 'next' });
  assert.deepEqual(keyAction(k('b'), 'numeric'), { type: 'blank' });
  assert.deepEqual(keyAction(k('7'), 'none'), { type: 'jump', beat: 6 }, 'elsewhere digits still jump');
});

test('typing builds the class prediction on the open predict beat only', () => {
  const beats = moonBeats();
  const at = beats.findIndex((b) => b.kind === 'predict');
  const id = beats[at]?.id as string;
  assert.ok(acceptsNumber(beats[at] as Beat, 0));
  assert.ok(!acceptsNumber(beats[at] as Beat, 1), 'not once revealed');
  assert.ok(!acceptsNumber(beats[0] as Beat, 0), 'not on the title');
  const type = (...keys: string[]): PresentAction[] => keys.map((key) => ({ type: 'type', key }));
  let s = run(beats, initialPresent(beats, at), ...type('1', '2', '.', '5'));
  assert.equal(s.answers[id], '12.5');
  s = run(beats, s, ...type('Backspace', 'Backspace'));
  assert.equal(s.answers[id], '12');
  s = run(beats, s, ...type('.', '.', '3'));
  assert.equal(s.answers[id], '12.3', 'one decimal point');
  s = run(beats, initialPresent(beats, at), ...type('-', '4', '-'));
  assert.equal(s.answers[id], '-4', 'a minus only first');
  s = run(beats, s, { type: 'reveal' }, ...type('9'));
  assert.equal(s.answers[id], '-4', 'locked after the reveal');
  s = run(beats, initialPresent(beats, 0), ...type('9'));
  assert.deepEqual(s.answers, {}, 'ignored on other beats');
  s = run(beats, initialPresent(beats, at), ...type(...'12345678901234'.split('')));
  assert.equal(s.answers[id]?.length, 12, 'kept to a sensible length');
});

test('the key list names W', () => {
  assert.ok(KEY_MAP.some((m) => m.keys.split('  ').includes('W') && /white/i.test(m.does)));
});

test('predictVisual: projectile shows its scene with the guess line, a formula its graph, other engines their scene', () => {
  const beats = moonBeats();
  const p = beats.find((b) => b.kind === 'predict');
  assert.ok(p !== undefined && p.kind === 'predict');
  assert.equal(predictVisual(p.target), 'projectile');

  const drag = loadDemoLessons().find((l) => l.id === 'drag');
  assert.ok(drag !== undefined);
  const deck = deckFromLesson({ jobId: 'j', lesson: drag.lesson, specs: drag.specs, premium: null, analysis: drag.analysis, source: null, disclosure: 'x', checks: null, quotes: null, fallbackTitle: 'L' });
  const fp = planBeats(deck).find((b) => b.kind === 'predict');
  assert.ok(fp !== undefined && fp.kind === 'predict');
  assert.equal(predictVisual(fp.target), 'graph');
});

test('revealDelayMs: the numbers wait for the scene: a projectile’s until the ball reaches the top', () => {
  const beats = moonBeats();
  const p = beats.find((b) => b.kind === 'predict');
  assert.ok(p !== undefined && p.kind === 'predict' && p.target.kind === 'engine');
  const first = p.target.prediction as unknown as { horizontalSpeedMps: number; verticalSpeedMps: number; gravityMps2: number };
  const apexS = first.verticalSpeedMps / first.gravityMps2;
  const flightS = 2 * apexS;
  const wall = Math.min(8, Math.max(2, flightS)); // the playback plan plays a flight in 2–8 s of wall time
  const expected = (apexS / flightS) * wall * 1000;
  assert.ok(Math.abs(revealDelayMs(p.target) - expected) < 60, `${revealDelayMs(p.target)} vs ${expected}`);
  const drag = loadDemoLessons().find((l) => l.id === 'drag');
  assert.ok(drag !== undefined);
  const deck = deckFromLesson({ jobId: 'j', lesson: drag.lesson, specs: drag.specs, premium: null, analysis: drag.analysis, source: null, disclosure: 'x', checks: null, quotes: null, fallbackTitle: 'L' });
  const fp = planBeats(deck).find((b) => b.kind === 'predict');
  assert.ok(fp !== undefined && fp.kind === 'predict');
  assert.ok(revealDelayMs(fp.target) > 0 && revealDelayMs(fp.target) <= 900, 'a graph: just the settle of its point');
});

test('predictVerdict: the class number against the engine, with units and three significant figures', () => {
  const answer = { value: 19.753086, display: '19.753', unit: 'm', label: 'Maximum height' };
  assert.equal(predictVerdict(answer, '', 0.01), null, 'no class prediction, no verdict');
  assert.equal(predictVerdict(answer, 'abc', 0.01), null);
  const miss = predictVerdict(answer, '12', 0.01);
  assert.deepEqual(miss, { within: false, text: 'Class prediction 12 m · off by 7.75 m, too low', headline: 'Off by 7.75 m', detail: 'Too low' });
  const high = predictVerdict(answer, '25', 0.01);
  assert.equal(high?.text, 'Class prediction 25 m · off by 5.25 m, too high');
  const ok = predictVerdict(answer, '19.6', 0.01);
  assert.deepEqual(ok, { within: true, text: 'Class prediction 19.6 m · inside the ±0.395 m margin', headline: 'Close enough', detail: 'Inside the ±0.395 m margin' });
  const graph = predictVerdict({ value: 6250, display: '6250', unit: '', label: 'D' }, '9000', null);
  assert.equal(graph?.text, 'Class prediction 9,000 · off by 2,750, too high');
});

test('askFrame: before R the height scale comes from the guess alone, never from the answer', () => {
  const { box } = PROJECTILE_FRAME;
  const none = askFrame(null);
  assert.equal(none.guessPy, null);
  assert.deepEqual(none.ticks, [], 'no guess: an unnumbered scale');
  const a = askFrame(12);
  assert.ok(a.guessPy !== null && a.guessPy > box.top && a.guessPy < box.bottom, 'the guess line sits inside the plot');
  // the guess sits well up the plot but not at its top, so either outcome can still surprise
  const frac = (box.bottom - (a.guessPy as number)) / (box.bottom - box.top);
  assert.ok(frac > 0.5 && frac < 0.75, `guess at ${frac.toFixed(2)} of the height`);
  assert.ok(a.ticks.length >= 3 && a.ticks[0]?.m === 0, 'numbered from the ground');
  assert.ok(a.ticks.every((t) => t.py >= box.top - 1e-9 && t.py <= box.bottom + 1e-9));
  assert.deepEqual(askFrame(12), a, 'pure');
  const b = askFrame(1200);
  assert.ok(Math.abs((b.guessPy as number) - (a.guessPy as number)) < 1e-9, 'the guess line sits at the same height for any guess');
  assert.equal(b.ticks.find((t) => t.m === 1000)?.label, '1,000', 'large ticks are grouped');
  const zero = askFrame(0);
  assert.equal(zero.guessPy, box.bottom, 'a zero guess lies on the ground');
  const neg = askFrame(-4);
  assert.equal(neg.guessPy, box.bottom, 'a negative guess is drawn on the ground');
});

test('heightTicks: a numbered height scale on the scene’s own metres-per-pixel scale', () => {
  const { box } = PROJECTILE_FRAME;
  const scene = projectileScene({ horizontalSpeedMps: 8, verticalSpeedMps: 6, gravityMps2: 1.62 }, [], '');
  assert.ok(scene !== null);
  const ticks = heightTicks(scene.layout.scale);
  assert.equal(ticks[0]?.m, 0);
  assert.equal(ticks[0]?.py, box.bottom);
  assert.ok(ticks.length >= 3 && ticks.length <= 8);
  for (const t of ticks) assert.ok(Math.abs(t.py - scene.layout.toPx(0, t.m).py) < 1e-9, 'same scale as the arc');
});

test('the projectile reveal can say whose guess it is', () => {
  const scene = projectileScene({ horizontalSpeedMps: 8, verticalSpeedMps: 6, gravityMps2: 1.62 }, [], '', { guessM: 12, toleranceM: 0.22, who: 'class' });
  assert.ok(scene?.reveal !== null && scene?.reveal !== undefined);
  assert.match(scene.reveal.label.text, /^class guess 12 m/);
  const yours = projectileScene({ horizontalSpeedMps: 8, verticalSpeedMps: 6, gravityMps2: 1.62 }, [], '', { guessM: 12, toleranceM: 0.22 });
  assert.match(yours?.reveal?.label.text ?? '', /^your guess 12 m/, 'the lesson keeps its wording');
});
