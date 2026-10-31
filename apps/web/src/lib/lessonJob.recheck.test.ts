/// <reference types="node" />
// Set A item 2: a stored part that passed when it was built but fails TODAY's validators (the API's `recheck` field on a
// passed lesson component) is withheld: it reads as a failed part with a plain reason, its spec is not served to the
// lesson or presentation views, and the checks list shows which of today's checks it fails. No `recheck` = unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { JobDetail } from '../api.ts';
import { HELD_BACK_REASON, buildLessonSteps, buildLessonStream, heldBackChecks, lessonCheckSections, normaliseJobDetail, stage6CheckName } from './lessonJob.ts';
import { lessonWire } from './lessonJobFixtures.ts';
import type { WireObject } from './lessonJobFixtures.ts';
import { lessonCards } from './lesson.ts';
import { collectLessonQuotes } from './lesson.ts';
import { deckFromLesson } from './presentation.ts';

type Entry = { componentId: string; specId: string; status: string; reason: string; revision: number; recheck?: unknown };

/** The complete fixture lesson with `recheck` set on the named component entries. */
function withRecheck(rechecks: Record<string, unknown>): WireObject {
  const wire = lessonWire('complete');
  const lesson = wire.lesson as { components: Entry[] };
  for (const c of lesson.components) if (Object.hasOwn(rechecks, c.componentId)) c.recheck = rechecks[c.componentId];
  return wire;
}

const detailOf = (w: WireObject): JobDetail => normaliseJobDetail(w);
const deckOf = (d: JobDetail) => {
  const stream = buildLessonStream(d);
  return deckFromLesson({
    jobId: d.summary.jobId, source: null, disclosure: '', checks: null, quotes: null,
    lesson: stream.lesson, specs: d.lessonData?.kitSpecs ?? {}, premium: null, analysis: d.lessonData?.analysis ?? null, fallbackTitle: 'Lesson',
  });
};

test('no recheck field: a passed part stays passed and keeps its spec (unchanged behaviour)', () => {
  const d = detailOf(lessonWire('complete'));
  assert.deepEqual(d.lessonData?.lesson?.components.map((c) => c.status), ['passed', 'passed', 'passed']);
  assert.equal(Object.keys(d.lessonData?.kitSpecs ?? {}).length, 3);
  for (const c of d.lessonData?.lesson?.components ?? []) assert.equal(heldBackChecks(c), null);
});

test('recheck publishable: true leaves the part passed', () => {
  const d = detailOf(withRecheck({ 'quiz-cards-v1': { publishable: true, failedChecks: [] } }));
  const quiz = d.lessonData?.lesson?.components.find((c) => c.componentId === 'quiz-cards-v1');
  assert.equal(quiz?.status, 'passed');
  assert.equal(quiz === undefined ? 'missing' : heldBackChecks(quiz), null);
});

test('recheck publishable: false withholds the part: failed, plain reason, failed check ids kept, spec dropped', () => {
  const d = detailOf(withRecheck({ 'quiz-cards-v1': { publishable: false, failedChecks: ['Q-02', 'Q-06'] } }));
  const comps = d.lessonData?.lesson?.components ?? [];
  const quiz = comps.find((c) => c.componentId === 'quiz-cards-v1');
  assert.ok(quiz);
  assert.equal(quiz.status, 'failed');
  assert.equal(quiz.reason, HELD_BACK_REASON);
  const held = heldBackChecks(quiz);
  assert.deepEqual(held?.map((x) => x.id), ['Q-02', 'Q-06']);
  assert.deepEqual(held?.map((x) => x.name), [stage6CheckName('Q-02'), stage6CheckName('Q-06')]);
  assert.equal(held?.every((x) => x.name !== '' && x.name !== x.id), true, 'each id has a plain name');
  assert.equal(Object.values(d.lessonData?.kitSpecs ?? {}).some((s) => s.componentId === 'quiz-cards-v1'), false, 'its spec is not served');
  // the other parts are untouched
  assert.deepEqual(comps.filter((c) => c.componentId !== 'quiz-cards-v1').map((c) => c.status), ['passed', 'passed']);
});

test('a withheld part renders as a failed card whose teacher sentence is the held-back reason', () => {
  const d = detailOf(withRecheck({ 'quiz-cards-v1': { publishable: false, failedChecks: ['Q-02'] } }));
  const stream = buildLessonStream(d);
  const cards = lessonCards(stream.lesson, d.lessonData?.kitSpecs ?? {}, false);
  const quiz = cards.find((c) => c.componentId === 'quiz-cards-v1');
  assert.equal(quiz?.status, 'failed');
  assert.equal(quiz?.spec, null);
  assert.equal(quiz?.explain?.sentence, HELD_BACK_REASON);
  assert.equal(stream.slots.find((s) => s.componentId === 'quiz-cards-v1')?.state, 'failed');
});

test('presentation mode skips a withheld part without any presentation change', () => {
  const before = deckOf(detailOf(lessonWire('complete')));
  const after = deckOf(detailOf(withRecheck({ 'quiz-cards-v1': { publishable: false, failedChecks: ['Q-02'] } })));
  assert.equal(before.parts.length, 3);
  assert.equal(after.parts.length, 2);
  assert.equal(after.parts.some((p) => p.kind === 'kit' && p.spec.componentId === 'quiz-cards-v1'), false);
});

test('a withheld part contributes no page highlights (its quotes are not linked)', () => {
  const d = detailOf(withRecheck({ 'quiz-cards-v1': { publishable: false, failedChecks: ['Q-02'] } }));
  const keys = collectLessonQuotes('src', null, d.lessonData?.kitSpecs ?? {}).map((q) => q.key);
  assert.equal(keys.some((k) => k.startsWith('quiz-cards-v1')), false);
});

test('the steps list and the checks list say the part is held back today and which checks it fails', () => {
  const d = detailOf(withRecheck({ 'quiz-cards-v1': { publishable: false, failedChecks: ['Q-02', 'NEW-99'] } }));
  const step = buildLessonSteps(d).find((s) => s.key === 'component-quiz-cards-v1');
  assert.equal(step?.status, 'failed');
  assert.equal(step?.detail, HELD_BACK_REASON);
  const section = lessonCheckSections(d).find((s) => s.key === 'component-quiz-cards-v1');
  assert.ok(section);
  assert.equal(section.checks.find((c) => c.id === 'Q-02')?.passed, false);
  // a check id the stored report never ran is added as failed
  assert.equal(section.checks.find((c) => c.id === 'NEW-99')?.passed, false);
  assert.equal(section.passed, section.total - 2);
  assert.match(section.label, /held back/i);
});

test('malformed recheck values are ignored (only an explicit publishable: false withholds)', () => {
  for (const bad of [null, 5, 'no', { publishable: 'false' }, { failedChecks: ['Q-02'] }, []]) {
    const d = detailOf(withRecheck({ 'quiz-cards-v1': bad }));
    assert.equal(d.lessonData?.lesson?.components.find((c) => c.componentId === 'quiz-cards-v1')?.status, 'passed', JSON.stringify(bad));
  }
  // publishable false with garbage failedChecks still withholds, with no names
  const d = detailOf(withRecheck({ 'quiz-cards-v1': { publishable: false, failedChecks: 'Q-02' } }));
  const quiz = d.lessonData?.lesson?.components.find((c) => c.componentId === 'quiz-cards-v1');
  assert.equal(quiz?.status, 'failed');
  assert.deepEqual(quiz === undefined ? null : heldBackChecks(quiz), []);
});

test('recheck on a part that was already failed or skipped changes nothing', () => {
  const wire = lessonWire('partial');
  const fe = (wire.lesson as { components: Entry[] }).components.find((c) => c.componentId === 'formula-explorer-v1');
  assert.ok(fe);
  fe.recheck = { publishable: false, failedChecks: ['FE-01'] };
  const d = detailOf(wire);
  const entry = d.lessonData?.lesson?.components.find((c) => c.componentId === 'formula-explorer-v1');
  assert.equal(entry?.status, 'failed');
  assert.match(entry?.reason ?? '', /^FE-08/);
  assert.equal(entry === undefined ? 'x' : heldBackChecks(entry), null);
});
