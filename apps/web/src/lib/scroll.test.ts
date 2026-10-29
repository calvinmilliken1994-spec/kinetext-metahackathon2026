/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { isScrollableOverflow, scrollTopToReveal } from './scroll.ts';

const box = (over: Partial<{ top: number; height: number; scrollTop: number; scrollHeight: number }> = {}) => ({
  top: 100, height: 500, scrollTop: 0, scrollHeight: 2000, ...over,
});

test("'start' puts the target a margin below the container's top", () => {
  // target 700 px below the container top, nothing scrolled yet
  assert.equal(scrollTopToReveal(box(), { top: 800, height: 40 }, 'start', 12), 688);
  // already scrolled 300: the content offset is 700 + 300
  assert.equal(scrollTopToReveal(box({ scrollTop: 300 }), { top: 800, height: 40 }, 'start', 12), 988);
});

test("'center' centres a target that fits, and aligns a taller one to its start", () => {
  assert.equal(scrollTopToReveal(box(), { top: 1100, height: 100 }, 'center'), 1000 - 200);
  assert.equal(scrollTopToReveal(box(), { top: 1100, height: 900 }, 'center', 10), 990);
});

test('the result is clamped to the scrollable range', () => {
  assert.equal(scrollTopToReveal(box(), { top: 90, height: 20 }, 'start', 12), 0);
  assert.equal(scrollTopToReveal(box({ scrollHeight: 900 }), { top: 950, height: 20 }, 'start', 0), 400);
  // a container that cannot scroll never moves
  assert.equal(scrollTopToReveal(box({ scrollHeight: 500 }), { top: 950, height: 20 }, 'center'), 0);
});

test("'nearest' leaves a visible target alone and moves the least otherwise", () => {
  assert.equal(scrollTopToReveal(box({ scrollTop: 50 }), { top: 300, height: 50 }, 'nearest', 12), 50);
  // below the fold: align its bottom with the container's bottom (minus the margin)
  assert.equal(scrollTopToReveal(box(), { top: 700, height: 60 }, 'nearest', 12), 700 - 100 + 60 - 500 + 12);
  // above the fold: align its top
  assert.equal(scrollTopToReveal(box({ scrollTop: 400 }), { top: 50, height: 30 }, 'nearest', 12), 338);
});

test('overflow values that scroll', () => {
  assert.equal(isScrollableOverflow('auto'), true);
  assert.equal(isScrollableOverflow('scroll'), true);
  assert.equal(isScrollableOverflow('hidden'), false);
  assert.equal(isScrollableOverflow('visible'), false);
  assert.equal(isScrollableOverflow('clip'), false);
});
