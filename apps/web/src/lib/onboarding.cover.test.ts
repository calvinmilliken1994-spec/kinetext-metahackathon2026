/// <reference types="node" />
// Calvin, 2 Nov: on "Muse writes the summary first" the ring sat off-centre around the build strip. The summary had
// scrolled up behind the sticky strip, and the ring framed the sliver of it hidden there. A target's visible box now
// stops at the bottom of a sticky cover above it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { belowCover } from './onboarding.ts';

const strip = { x: 574, y: 84, w: 605, h: 114 }; // 84..198

test('a target partly behind the sticky strip is cut to start below it', () => {
  assert.deepEqual(belowCover({ x: 574, y: 70, w: 605, h: 300 }, strip), { x: 574, y: 198, w: 605, h: 172 });
});

test('a target wholly behind the strip has nothing visible', () => {
  assert.equal(belowCover({ x: 574, y: 70, w: 605, h: 117 }, strip), null);
});

test('targets below, beside or the strip itself are unchanged', () => {
  const below = { x: 574, y: 409, w: 605, h: 181 };
  assert.deepEqual(belowCover(below, strip), below);
  const beside = { x: 270, y: 60, w: 273, h: 330 };
  assert.deepEqual(belowCover(beside, strip), beside);
});
