import test from 'node:test';
import assert from 'node:assert/strict';
import { pointMoves, pointsOnLabels, repairStory, storyView } from './repairStory.ts';
import type { HistoryEntry, StoryFigure, StoryInput } from './repairStory.ts';
import { parseComponentHistory } from './lessonJob.ts';

// The stored DNA job job-20261031081105-21355f66 (GET /api/jobs/:id componentHistory and the published figure).
const DNA_HISTORY: HistoryEntry[] = [
  { revision: 1, publishable: false, failedChecks: ['LD-04'], labelPoints: [
    { id: 'base-pairs', x: 250, y: 500 }, { id: 'sugar-phosphate-backbone', x: 395, y: 720 }, { id: 'adenine', x: 635, y: 354 },
    { id: 'thymine', x: 800, y: 354 }, { id: 'guanine', x: 630, y: 515 }, { id: 'cytosine', x: 795, y: 515 }] },
  { revision: 2, publishable: true, failedChecks: [], labelPoints: [
    { id: 'base-pairs', x: 250, y: 500 }, { id: 'sugar-phosphate-backbone', x: 395, y: 720 }, { id: 'adenine', x: 642, y: 321 },
    { id: 'thymine', x: 800, y: 321 }, { id: 'guanine', x: 640, y: 502 }, { id: 'cytosine', x: 800, y: 502 }] },
];
const DNA_FIGURE: StoryFigure = {
  id: 'medlineplus-dna-structure-1', width: 600, height: 600,
  labelBoxes: [
    { x1: 235, y1: 180, x2: 327, y2: 203 }, { x1: 454, y1: 209, x2: 528, y2: 233 }, { x1: 354, y1: 210, x2: 426, y2: 230 },
    { x1: 354, y1: 304, x2: 427, y2: 324 }, { x1: 454, y1: 304, x2: 530, y2: 327 }, { x1: 304, y1: 401, x2: 448, y2: 441 }, { x1: 304, y1: 421, x2: 387, y2: 440 },
  ],
};
const dnaInput = (over: Partial<StoryInput> = {}): StoryInput => ({
  label: 'Label the diagram', origin: 'natural', state: 'passed', attempts: 1,
  targeted: [{ id: 'LD-04', name: 'Each part point is valid and off its printed label' }],
  history: DNA_HISTORY, figure: DNA_FIGURE, finalChecks: { passed: 11, total: 11, noWeakening: true }, ...over,
});

test('DNA r1: 4 of 6 points sit on printed labels; r2: none do', () => {
  assert.equal(pointsOnLabels(DNA_HISTORY[0]?.labelPoints ?? [], DNA_FIGURE), 4);
  assert.equal(pointsOnLabels(DNA_HISTORY[1]?.labelPoints ?? [], DNA_FIGURE), 0);
});

test('DNA story: four steps in plain words, no check id, no part name', () => {
  const s = repairStory(dnaInput());
  assert.equal(s.heading, 'Label the diagram · revised once by Muse');
  assert.deepEqual(s.steps.map((x) => x.title), ['Check found an issue', 'Revised by Muse', 'Rechecked', 'Published']);
  assert.equal(s.steps[0]?.sentence, '4 of 6 points sat on the figure’s printed labels, not on the parts they name.');
  assert.equal(s.steps[1]?.sentence, 'Muse moved 4 points onto the parts they mark.');
  assert.equal(s.steps[2]?.sentence, 'All 11 checks pass, and no check was loosened to get there.');
  assert.equal(s.steps[3]?.sentence, 'The revised part is the one in this lesson.');
  // Calvin's rule: a natural repair is "Revised by Muse after a failed check", never "Muse's own mistake".
  assert.equal(s.originNote, 'Found in Muse’s draft by the checks; not a planted test fault.');
  assert.doesNotMatch(s.originNote, /mistake|\bown\b/i);
  const all = JSON.stringify(s);
  assert.doesNotMatch(all, /LD-04|adenine|guanine|thymine|cytosine/i);
});

test('DNA moves: the four bases moved, base pairs and backbone did not; the crop holds them', () => {
  const s = repairStory(dnaInput());
  assert.equal(s.moves.length, 4);
  assert.deepEqual(s.moves[0], { from: { x: 635, y: 354 }, to: { x: 642, y: 321 } });
  const v = s.view;
  assert.ok(v !== null);
  for (const m of s.moves) for (const p of [m.from, m.to]) {
    assert.ok(p.x > v.x && p.x < v.x + v.w && p.y > v.y && p.y < v.y + v.h);
  }
  assert.ok(v.x >= 0 && v.y >= 0 && v.x + v.w <= 1000 && v.y + v.h <= 1000);
  assert.equal(s.figureId, 'medlineplus-dna-structure-1');
});

test('a system-made fault says so; never claims Muse’s own mistake', () => {
  const s = repairStory(dnaInput({ origin: 'system' }));
  assert.match(s.heading, /planted fault/);
  assert.equal(s.steps[0]?.tone, 'fault');
  assert.match(s.originNote, /planted on purpose/);
  assert.doesNotMatch(s.originNote, /Muse’s own/);
});

test('a revision that still fails is withheld', () => {
  const s = repairStory(dnaInput({ state: 'still-failing', attempts: 2, finalChecks: { passed: 9, total: 11, noWeakening: true } }));
  assert.equal(s.heading, 'Label the diagram · revised twice by Muse');
  assert.equal(s.steps[2]?.sentence, '2 of 11 checks still fail.');
  assert.equal(s.steps[3]?.title, 'Withheld');
});

test('a text part: plain check names, no points, no figure', () => {
  const s = repairStory({ label: 'Quiz cards', origin: 'natural', state: 'passed', attempts: 1, targeted: [{ id: 'Q-06', name: 'Numbers in the cards can be found on the page' }], history: [], figure: null, finalChecks: null });
  assert.equal(s.steps[0]?.sentence, 'The check “Numbers in the cards can be found on the page” did not pass on Muse’s first version.');
  assert.equal(s.steps[1]?.sentence, 'Muse got the failed check back and rewrote the part.');
  assert.equal(s.steps[2]?.sentence, 'Every check passes.');
  assert.deepEqual(s.moves, []);
  assert.equal(s.view, null);
});

test('pointMoves ignores jitter; storyView is null without moves', () => {
  assert.deepEqual(pointMoves([{ id: 'a', x: 10, y: 10 }], [{ id: 'a', x: 12, y: 11 }]), []);
  assert.equal(storyView([]), null);
});

test('parseComponentHistory keeps the frozen shape and drops malformed parts', () => {
  const h = parseComponentHistory({
    'label-diagram-v1': [{ revision: 2, publishable: true, failedChecks: [], labelPoints: [{ id: 'a', x: 1, y: 2 }, { id: 'b', x: 'no' }] }, { revision: 1, publishable: false, failedChecks: ['LD-04', 7] }],
    'quiz-cards-v1': [{ revision: 1, publishable: true, failedChecks: [] }],
    bad: 'x',
  });
  assert.deepEqual(h['label-diagram-v1']?.map((e) => e.revision), [1, 2]);
  assert.deepEqual(h['label-diagram-v1']?.[0]?.failedChecks, ['LD-04']);
  assert.deepEqual(h['label-diagram-v1']?.[1]?.labelPoints, [{ id: 'a', x: 1, y: 2 }]);
  assert.equal(h['quiz-cards-v1']?.[0]?.labelPoints, undefined);
  assert.equal(h.bad, undefined);
  assert.deepEqual(parseComponentHistory(undefined), {});
});

// Demo review #7: the before/after crop cut a printed label in half ("…irs" of "Base pairs"). A label box the crop
// touches is now taken in whole (boxes are in image pixels; the crop is on the 0..1000 grid).
test('storyView widens the crop to take in every printed label it touches, whole', () => {
  const figure = { id: 'medlineplus-dna-structure-1', width: 600, height: 600, labelBoxes: [{ x1: 235, y1: 180, x2: 327, y2: 203 }] };
  const moves = [{ n: 1, from: { x: 300, y: 300 }, to: { x: 320, y: 320 } }];
  const plain = storyView(moves);
  assert.ok(plain && plain.x + plain.w < 545, 'without boxes the crop cuts through "Base pairs" (x 392..545)');
  const v = storyView(moves, 120, 340, figure);
  assert.ok(v);
  assert.ok(v.x <= 392 && v.x + v.w >= 545, `label taken in whole horizontally (${v.x}..${v.x + v.w})`);
  assert.ok(v.y <= 300 && v.y + v.h >= 339, `and vertically (${v.y}..${v.y + v.h})`);
  const far = storyView(moves, 120, 340, { ...figure, labelBoxes: [{ x1: 560, y1: 560, x2: 590, y2: 590 }] });
  assert.deepEqual(far, plain, 'a label the crop does not touch changes nothing');
});
