/// <reference types="node" />
// Stage 10b slice R: teacher review and publish, as the web app sees it (docs/specs/STAGE-10b-review-and-results.md).
// The API owns review.json; this file covers parsing it, what a published lesson changes on screen (status line, part
// tags, hidden parts, slides, All lessons) and the Review page's checklist rules. Pure: no React, no DOM, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLessonStream, lessonCheckSections, normaliseJobDetail } from './lessonJob.ts';
import { lessonWire } from './lessonJobFixtures.ts';
import type { WireObject } from './lessonJobFixtures.ts';
import { lessonStatusLine, partCounts } from './partOrder.ts';
import { creditLine, deckFromLesson, planBeats } from './presentation.ts';
import { browseLessons } from './browse.ts';
import { lessonCards } from './lesson.ts';
import {
  PART_PENDING_TAG, PART_REVIEWED_TAG, publishBody, publishReadiness, parseReview, partReviewTag, requestPartFocus, reviewAccess,
  reviewAvailability, reviewDate, reviewedStatus, reviewErrorMessage, reviewModel, reviewOfLesson, subscribeReviewChanged,
  notifyReviewChanged, peekPartFocus, takePartFocus, toggleChecked, toggleHidden, EMPTY_DRAFT, getDraft, setDraft, clearDraft,
} from './review.ts';
import type { ReviewState } from './review.ts';
import type { JobDetail } from '../api.ts';

const NOON = '2026-11-02T12:30:00.000Z';
const PUBLISHED: ReviewState = { status: 'published', publishedAt: NOON, hiddenParts: [], checkedParts: [] };

function withReview(review: unknown, scenario: Parameters<typeof lessonWire>[0] = 'complete'): JobDetail {
  const wire: WireObject = lessonWire(scenario);
  if (review !== undefined) wire.review = review;
  return normaliseJobDetail(wire);
}
const ids = (d: JobDetail): string[] => (d.lessonData?.lesson?.components ?? []).map((c) => c.componentId);

// ---- the wire value -------------------------------------------------------------------------------------------------

test('parseReview: a published review is read as stored; anything else is not a review', () => {
  assert.deepEqual(parseReview({ status: 'published', publishedAt: NOON, hiddenParts: ['a'], checkedParts: ['b', 'c'] }),
    { status: 'published', publishedAt: NOON, hiddenParts: ['a'], checkedParts: ['b', 'c'] });
  assert.equal(parseReview(undefined), null);
  assert.equal(parseReview(null), null);
  assert.equal(parseReview('published'), null);
  assert.equal(parseReview({ status: 'draft', publishedAt: NOON, hiddenParts: [], checkedParts: [] }), null);
  assert.equal(parseReview({ status: 'published', publishedAt: 'yesterday', hiddenParts: [], checkedParts: [] }), null);
  assert.equal(parseReview({ status: 'published', publishedAt: NOON, hiddenParts: 'a', checkedParts: [] }), null);
  assert.equal(parseReview({ status: 'published', publishedAt: NOON, hiddenParts: [1], checkedParts: [] }), null);
  assert.equal(parseReview({ status: 'published', publishedAt: NOON }), null);
});

test('reviewDate and the status wording: "Reviewed by a teacher · published 2 Nov 2026"', () => {
  assert.equal(reviewDate(NOON, true), '2 Nov 2026');
  assert.equal(reviewDate('2026-09-05T00:10:00.000Z', true), '5 Sep 2026', 'September is Sep, never Sept');
  assert.equal(reviewDate('2027-01-31T23:59:00.000Z', true), '31 Jan 2027');
  assert.equal(reviewDate('not a date', true), '');
  assert.equal(reviewedStatus({ ...PUBLISHED, publishedAt: NOON }, true), 'Reviewed by a teacher · published 2 Nov 2026');
});

test('part tags: "needs teacher review" until published, then "teacher-reviewed"; AI-written is never touched', () => {
  assert.equal(PART_PENDING_TAG, 'needs teacher review');
  assert.equal(PART_REVIEWED_TAG, 'teacher-reviewed');
  assert.equal(partReviewTag(null), 'needs teacher review');
  assert.equal(partReviewTag(PUBLISHED), 'teacher-reviewed');
});

// ---- the lesson's status line -----------------------------------------------------------------------------------------

test('status line: published replaces "Needs review" and keeps the part counts', () => {
  assert.equal(lessonStatusLine({ ready: 2, heldBack: 1 }), 'Needs review · 2 parts ready · 1 held back');
  assert.equal(lessonStatusLine({ ready: 2, heldBack: 1 }, PUBLISHED, true), 'Reviewed by a teacher · published 2 Nov 2026 · 2 parts ready · 1 held back');
  assert.equal(lessonStatusLine({ ready: 1, heldBack: 0 }, PUBLISHED, true), 'Reviewed by a teacher · published 2 Nov 2026 · 1 part ready');
  assert.equal(lessonStatusLine(null, PUBLISHED, true), 'Reviewed by a teacher · published 2 Nov 2026');
  assert.equal(lessonStatusLine(null, null), 'Needs review');
});

// ---- hidden parts leave the lesson, the checks list and the slides -----------------------------------------------------

test('no review file: the lesson is exactly what it was', () => {
  const plain = normaliseJobDetail(lessonWire('complete'));
  assert.equal(plain.lessonData?.review, null);
  assert.deepEqual(plain.lessonData?.hiddenParts, []);
  assert.equal(reviewOfLesson(buildLessonStream(plain).lesson), null);
  assert.equal('review' in buildLessonStream(plain).lesson, false, 'an unreviewed lesson object is unchanged');
});

test('a published lesson hides its hidden parts everywhere the lesson is built from', () => {
  const all = ids(normaliseJobDetail(lessonWire('complete')));
  assert.equal(all.length, 3);
  const hidden = all[1] as string;
  const d = withReview({ status: 'published', publishedAt: NOON, hiddenParts: [hidden], checkedParts: all.filter((x) => x !== hidden) });
  assert.deepEqual(ids(d), all.filter((x) => x !== hidden), 'the stored list loses it');
  assert.equal(Object.values(d.lessonData?.kitSpecs ?? {}).some((s) => s.componentId === hidden), false, 'so do its quotes (source highlights)');
  assert.deepEqual(d.lessonData?.hiddenParts.map((h) => h.entry.componentId), [hidden], 'kept for the review page');
  assert.ok(d.lessonData?.hiddenParts[0]?.spec, 'with its spec, for its title');

  const stream = buildLessonStream(d);
  assert.equal(stream.order.includes(hidden as never), false, 'no slot or placeholder for it');
  assert.equal(stream.slots.some((s) => s.componentId === hidden), false);
  assert.equal(stream.pending.length, 0);
  assert.equal(reviewOfLesson(stream.lesson)?.publishedAt, NOON, 'the lesson carries the review to its status line and tags');

  const cards = lessonCards(stream.lesson, d.lessonData?.kitSpecs ?? {}, false);
  assert.deepEqual(cards.map((c) => c.componentId), all.filter((x) => x !== hidden));
  assert.deepEqual(partCounts(cards), { ready: 2, heldBack: 0 });
  assert.equal(lessonCheckSections(d).some((s) => s.key === `component-${hidden}`), false, 'not in the checks list either');
});

test('a hidden id the lesson does not have changes nothing', () => {
  const d = withReview({ status: 'published', publishedAt: NOON, hiddenParts: ['made-up-v1'], checkedParts: [] });
  assert.equal(ids(d).length, 3);
  assert.deepEqual(d.lessonData?.hiddenParts, []);
});

test('the slides: hidden parts are not in the deck, and the deck knows the lesson is reviewed', () => {
  const all = ids(normaliseJobDetail(lessonWire('complete')));
  const hidden = all[0] as string;
  const d = withReview({ status: 'published', publishedAt: NOON, hiddenParts: [hidden], checkedParts: all.slice(1) });
  const stream = buildLessonStream(d);
  const common = { jobId: 'j1', source: null, disclosure: 'AI-generated with Muse Spark 1.3 (Meta).', checks: null, quotes: null };
  const deck = deckFromLesson({ ...common, lesson: stream.lesson, specs: d.lessonData?.kitSpecs ?? {}, premium: null, analysis: null, fallbackTitle: 'Lesson' });
  assert.equal(deck.parts.length, 2);
  assert.equal(deck.parts.some((p) => p.kind === 'kit' && p.spec.componentId === hidden), false);
  assert.equal(deck.review?.publishedAt, NOON);
  assert.equal(deck.leftOut, 0, 'a hidden part is not "left out by the checks"');
  const labels = planBeats(deck).map((b) => b.label).join('|');
  assert.ok(labels.length > 0);
  // the unreviewed deck of the same lesson has all three
  const plain = normaliseJobDetail(lessonWire('complete'));
  const plainDeck = deckFromLesson({ ...common, lesson: buildLessonStream(plain).lesson, specs: plain.lessonData?.kitSpecs ?? {}, premium: null, analysis: null, fallbackTitle: 'Lesson' });
  assert.equal(plainDeck.parts.length, 3);
  assert.equal(plainDeck.review, undefined);
});

test('the slide credit line: "teacher review pending" becomes "reviewed by a teacher" for a published deck only', () => {
  const source = { id: 's', title: 'pH scale', locator: 'https://example.org/ph', license: 'U.S. Government work', attribution: 'Source material: U.S. Geological Survey, pH scale.', sha256: 'x' };
  const base = { source, disclosure: 'AI-generated with Muse Spark 1.3 (Meta). Includes material from U.S. Geological Survey, which has not reviewed or endorsed this lesson.', parts: [] };
  assert.match(creditLine(base) ?? '', /AI-written with Muse Spark 1\.3 \(Meta\), teacher review pending$/);
  const line = creditLine({ ...base, review: PUBLISHED }) ?? '';
  assert.match(line, /AI-written with Muse Spark 1\.3 \(Meta\), reviewed by a teacher$/);
  assert.doesNotMatch(line, /pending/);
});

// ---- All lessons ---------------------------------------------------------------------------------------------------

test('All lessons marks published lessons and no others', () => {
  const jobs = [
    { jobId: 'a', sourceId: 's1', createdAt: '2026-11-02T10:00:00Z', status: 'succeeded', reviewPublishedAt: NOON },
    { jobId: 'b', sourceId: 's2', createdAt: '2026-11-02T09:00:00Z', status: 'succeeded' },
  ];
  const byId = new Map([['s1', { title: 'One', subject: 'physics' }], ['s2', { title: 'Two', subject: 'physics' }]]);
  const rows = browseLessons(jobs, byId as never, { query: '', subject: null, scope: 'lessons' });
  assert.deepEqual(rows.map((r) => [r.jobId, r.published]), [['a', NOON], ['b', null]]);
});

// ---- the Review page's model -----------------------------------------------------------------------------------------

test('availability: only a finished lesson with a working part can be reviewed', () => {
  assert.equal(reviewAvailability(normaliseJobDetail(lessonWire('complete'))), 'ready');
  assert.equal(reviewAvailability(normaliseJobDetail(lessonWire('building'))), 'building');
  assert.equal(reviewAvailability(normaliseJobDetail(lessonWire('declined'))), 'nothing');
  assert.equal(reviewAvailability(normaliseJobDetail(lessonWire('failed'))), 'nothing');
});

test('a draft review lists every working part with its title, kind and check status; held-back parts are separate', () => {
  const d = normaliseJobDetail(lessonWire('partial'));
  const m = reviewModel(d);
  assert.ok(m.parts.length >= 1);
  for (const p of m.parts) {
    assert.ok(p.title.length > 0);
    assert.ok(p.label.length > 0);
    assert.match(p.status, /^Checked/);
    assert.equal(p.hidden, false);
  }
  const passed = (d.lessonData?.lesson?.components ?? []).filter((c) => c.status === 'passed').map((c) => c.componentId).sort();
  assert.deepEqual(m.parts.map((p) => p.id).sort(), passed);
  const failed = (d.lessonData?.lesson?.components ?? []).filter((c) => c.status === 'failed').map((c) => c.componentId).sort();
  assert.deepEqual(m.held.map((h) => h.id).sort(), failed);
  assert.ok(m.held.length > 0, 'the partial scenario has a part the checks left out');
  for (const h of m.held) assert.ok(h.sentence.length > 0);
  assert.equal(m.review, null);
});

test('a repaired part says so in its status', () => {
  const m = reviewModel(normaliseJobDetail(lessonWire('repaired')));
  assert.ok(m.parts.some((p) => p.repaired && /Revised by Muse after a failed check/.test(p.status)));
});

test('a published review lists hidden parts after the visible ones, marked hidden', () => {
  const all = ids(normaliseJobDetail(lessonWire('complete')));
  const hidden = all[0] as string;
  const d = withReview({ status: 'published', publishedAt: NOON, hiddenParts: [hidden], checkedParts: all.slice(1) });
  const m = reviewModel(d);
  assert.equal(m.parts.length, 3);
  assert.deepEqual(m.parts.filter((p) => p.hidden).map((p) => p.id), [hidden]);
  assert.equal(m.parts[m.parts.length - 1]?.id, hidden, 'hidden parts come last');
  assert.equal(m.review?.publishedAt, NOON);
});

test('the draft: tick parts, hide parts; publishing needs every visible part ticked and at least one visible', () => {
  const m = reviewModel(normaliseJobDetail(lessonWire('complete')));
  const [a, b, c] = m.parts.map((p) => p.id) as [string, string, string];
  let draft = EMPTY_DRAFT;
  assert.deepEqual(publishReadiness(m.parts, draft), { visible: 3, ticked: 0, canPublish: false, why: 'unticked' });
  draft = toggleChecked(toggleChecked(draft, a), b);
  assert.deepEqual(publishReadiness(m.parts, draft), { visible: 3, ticked: 2, canPublish: false, why: 'unticked' });
  draft = toggleChecked(draft, c);
  assert.deepEqual(publishReadiness(m.parts, draft), { visible: 3, ticked: 3, canPublish: true, why: null });
  // untick again, then hide it instead: the rest is enough
  draft = toggleChecked(draft, c);
  draft = toggleHidden(draft, c);
  assert.deepEqual(publishReadiness(m.parts, draft), { visible: 2, ticked: 2, canPublish: true, why: null });
  // hide everything: nothing to publish
  draft = toggleHidden(toggleHidden(draft, a), b);
  assert.deepEqual(publishReadiness(m.parts, draft), { visible: 0, ticked: 0, canPublish: false, why: 'nothing' });
  assert.equal(toggleChecked(toggleChecked(EMPTY_DRAFT, a), a).checked.length, 0, 'ticking twice unticks');
});

test('publishBody is the API body: both lists in lesson order, hidden parts never need a tick', () => {
  const m = reviewModel(normaliseJobDetail(lessonWire('complete')));
  const [a, b, c] = m.parts.map((p) => p.id) as [string, string, string];
  const draft = toggleHidden(toggleChecked(toggleChecked(EMPTY_DRAFT, b), a), c);
  assert.deepEqual(publishBody(m.parts, draft), { action: 'publish', checkedParts: [a, b], hiddenParts: [c] });
  // a tick left on a part that was then hidden is still sent as checked (it was read), and never invents unknown ids
  const ticked = toggleChecked(toggleHidden(toggleChecked(EMPTY_DRAFT, a), a), 'made-up-v1');
  assert.deepEqual(publishBody(m.parts, ticked).checkedParts, [a]);
  assert.deepEqual(publishBody(m.parts, ticked).hiddenParts, [a]);
});

test('drafts survive leaving the page to read a part, and are dropped on publish', () => {
  clearDraft('job-x');
  assert.deepEqual(getDraft('job-x'), EMPTY_DRAFT);
  setDraft('job-x', toggleChecked(EMPTY_DRAFT, 'quiz-cards-v1'));
  assert.deepEqual(getDraft('job-x').checked, ['quiz-cards-v1']);
  assert.deepEqual(getDraft('job-y'), EMPTY_DRAFT, 'per job');
  clearDraft('job-x');
  assert.deepEqual(getDraft('job-x'), EMPTY_DRAFT);
});

// ---- access and errors ---------------------------------------------------------------------------------------------------

test('access: gate off or signed in publishes; no session is read-only; an unreadable answer lets the server decide', () => {
  const info = { gate: true, granted: false, capUSD: 50, spentUSD: 0, remainingUSD: 50, buildsEnabled: true };
  assert.equal(reviewAccess({ state: 'off' }), 'open');
  assert.equal(reviewAccess({ state: 'granted', info: { ...info, granted: true } }), 'open');
  assert.equal(reviewAccess({ state: 'locked', info }), 'locked');
  assert.equal(reviewAccess({ state: 'loading' }), 'checking');
  assert.equal(reviewAccess({ state: 'error' }), 'open');
  // a spent judge budget or paused builds do not stop publishing: it is free
  assert.equal(reviewAccess({ state: 'granted', info: { ...info, granted: true, remainingUSD: 0, buildsEnabled: false } }), 'open');
});

test('error codes become plain sentences', () => {
  const msg = (code: string): string => reviewErrorMessage({ code });
  assert.match(msg('ACCESS_REQUIRED'), /access code/i);
  assert.doesNotMatch(msg('ACCESS_REQUIRED'), /build/i, 'publishing is not a build');
  assert.match(msg('REVIEW_INCOMPLETE'), /every part/i);
  assert.match(msg('NOTHING_TO_PUBLISH'), /at least one part/i);
  assert.match(msg('NOT_REVIEWABLE'), /finished lesson/i);
  assert.match(msg('NOT_FOUND'), /no longer/i);
  assert.match(msg('BAD_REQUEST'), /try again|did not understand/i);
  assert.match(msg('NETWORK'), /reach the API/i);
  assert.ok(reviewErrorMessage(new Error('x')).length > 0);
  assert.ok(msg('WHATEVER').length > 0);
});

// ---- small cross-view helpers ---------------------------------------------------------------------------------------------

test('review changes reach every listener once, with the job id', () => {
  const seen: string[] = [];
  const off = subscribeReviewChanged((jobId) => seen.push(jobId));
  notifyReviewChanged('job-1');
  notifyReviewChanged('job-2');
  off();
  notifyReviewChanged('job-3');
  assert.deepEqual(seen, ['job-1', 'job-2']);
});

test('"Open" asks the lesson to scroll to a part once', () => {
  assert.equal(takePartFocus(), null);
  requestPartFocus('quiz-cards-v1');
  assert.equal(peekPartFocus(), 'quiz-cards-v1', 'looking does not take it');
  assert.equal(peekPartFocus(), 'quiz-cards-v1');
  assert.equal(takePartFocus(), 'quiz-cards-v1');
  assert.equal(takePartFocus(), null, 'taken once');
  assert.equal(peekPartFocus(), null);
});
