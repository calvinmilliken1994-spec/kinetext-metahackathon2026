/// <reference types="node" />
// Demo pair review #12: the address bar's ?job= follows the lesson actually shown, so a refresh or a shared link opens
// that lesson, never another one. ?present= and ?replay= keep working while they describe what is on screen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { shownSearch } from './jobUrl.ts';

const DRAG = 'job-drag';
const WATER = 'job-water';
const base = { replaying: false, presenting: false, opened: true };

test('a lesson opened in the app rewrites another lesson\'s ?job=', () => {
  assert.equal(shownSearch(`?job=${DRAG}`, WATER, base), `?job=${WATER}`);
});

test('other parameters stay (tour, theme-free extras), and job sits where it was', () => {
  assert.equal(shownSearch(`?tour=1&job=${DRAG}&speed=4`, WATER, base), `?tour=1&job=${WATER}&speed=4`);
});

test('the URL already names the shown lesson: unchanged (same string, no history write)', () => {
  const s = `?job=${WATER}`;
  assert.equal(shownSearch(s, WATER, base), s);
});

test('a plain first visit keeps its plain URL (the tour may still open by itself on reload)', () => {
  assert.equal(shownSearch('', WATER, { ...base, opened: false }), '');
  assert.equal(shownSearch('?tour=1', WATER, { ...base, opened: false }), '?tour=1');
});

test('once another lesson is opened in the app, a plain URL gains its ?job=', () => {
  assert.equal(shownSearch('', WATER, base), `?job=${WATER}`);
});

test('nothing shown (a not-found notice holds the column): the link stays as written', () => {
  assert.equal(shownSearch('?job=job-missing', null, base), '?job=job-missing');
});

test('presentation mode leaves the URL alone (its exit path rewrites it)', () => {
  assert.equal(shownSearch(`?present=${WATER}&beat=3`, WATER, { ...base, presenting: true }), `?present=${WATER}&beat=3`);
});

test('a replay of the shown lesson keeps ?replay= and its speed', () => {
  const s = `?replay=${WATER}&speed=2&tour=0`;
  assert.equal(shownSearch(s, WATER, { ...base, replaying: true, opened: false }), s);
});

test('leaving a replay for another lesson turns the link into that lesson\'s ?job=', () => {
  assert.equal(shownSearch(`?replay=${WATER}&speed=2&tour=0`, DRAG, base), `?tour=0&job=${DRAG}`);
});

test('a stale ?present= of another lesson after presenting ended is replaced', () => {
  assert.equal(shownSearch(`?present=${DRAG}&beat=2`, WATER, base), `?job=${WATER}`);
});
