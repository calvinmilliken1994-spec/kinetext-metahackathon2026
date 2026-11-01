/// <reference types="node" />
// Stage 10 section A/B: the judge access code. GET /api/access answers the gate state; until the API ships it the route
// is a 404, which means the gate is off (today's local behaviour). The sidebar footer and the New lesson build area say
// what a visitor can do, in plain words, and never show a dead Build button.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ACCESS_MESSAGES, accessFooter, accessFromResponse, buildGate, formatUSD } from './access.ts';
import type { Access, AccessInfo } from './access.ts';

const info = (o: Partial<AccessInfo> = {}): AccessInfo => ({
  gate: true, granted: false, capUSD: 50, spentUSD: 0, remainingUSD: 50, buildsEnabled: true, ...o,
});

test('accessFromResponse: 404 (an API without the route) means the gate is off', () => {
  assert.deepEqual(accessFromResponse(404, null), { state: 'off' });
});

test('accessFromResponse: gate off, read-only and granted bodies', () => {
  assert.deepEqual(accessFromResponse(200, info({ gate: false, granted: true })), { state: 'off' });
  assert.deepEqual(accessFromResponse(200, info()), { state: 'locked', info: info() });
  assert.deepEqual(accessFromResponse(200, info({ granted: true, spentUSD: 2.5, remainingUSD: 47.5 })), {
    state: 'granted', info: info({ granted: true, spentUSD: 2.5, remainingUSD: 47.5 }),
  });
});

test('accessFromResponse: a malformed answer or another error is unknown, never granted', () => {
  assert.deepEqual(accessFromResponse(200, { gate: 'yes' }), { state: 'error' });
  assert.deepEqual(accessFromResponse(200, null), { state: 'error' });
  assert.deepEqual(accessFromResponse(500, { error: 'INTERNAL' }), { state: 'error' });
  assert.deepEqual(accessFromResponse(200, { ...info(), capUSD: Number.NaN }), { state: 'error' });
});

test('formatUSD: whole dollars without cents, otherwise two places, never negative', () => {
  assert.equal(formatUSD(50), '$50');
  assert.equal(formatUSD(47.123), '$47.12');
  assert.equal(formatUSD(0.4), '$0.40');
  assert.equal(formatUSD(-0.3), '$0');
});

test('footer: nothing while the gate is off, loading or unknown', () => {
  for (const a of [{ state: 'off' }, { state: 'loading' }, { state: 'error' }] as Access[]) assert.equal(accessFooter(a, true), null);
});

test('footer: read-only demo with a way to enter the code', () => {
  assert.deepEqual(accessFooter({ state: 'locked', info: info() }, true), {
    title: 'Read-only demo', detail: 'Browse, replay and present. Builds need an access code.', action: 'enter', tone: 'neutral',
  });
});

test('footer: granted shows what is left of the judges\' budget and Sign out', () => {
  assert.deepEqual(accessFooter({ state: 'granted', info: info({ granted: true, spentUSD: 2.88, remainingUSD: 47.12 }) }, true), {
    title: 'Judge access · $47.12 of $50 left', detail: null, action: 'sign-out', tone: 'neutral',
  });
});

test('footer: budget reached, builds paused and live generation off are said plainly', () => {
  const spent = info({ granted: true, spentUSD: 49.4, remainingUSD: 0.6, buildsEnabled: false });
  assert.equal(accessFooter({ state: 'granted', info: spent }, true)?.detail, 'The judges’ build budget is used up.');
  const paused = info({ granted: true, spentUSD: 3, remainingUSD: 47, buildsEnabled: false });
  assert.equal(accessFooter({ state: 'granted', info: paused }, true)?.detail, 'Builds are paused right now.');
  assert.equal(accessFooter({ state: 'granted', info: paused }, false)?.detail, 'Live builds are off on this server.');
  assert.equal(accessFooter({ state: 'granted', info: paused }, true)?.tone, 'warn');
});

test('buildGate: what the New lesson build area shows instead of a dead button', () => {
  assert.equal(buildGate({ state: 'off' }), 'open');
  assert.equal(buildGate({ state: 'loading' }), 'open');
  assert.equal(buildGate({ state: 'error' }), 'open');
  assert.equal(buildGate({ state: 'locked', info: info() }), 'needs-code');
  assert.equal(buildGate({ state: 'granted', info: info({ granted: true }) }), 'open');
  assert.equal(buildGate({ state: 'granted', info: info({ granted: true, remainingUSD: 0.5, buildsEnabled: false }) }), 'budget');
  assert.equal(buildGate({ state: 'granted', info: info({ granted: true, remainingUSD: 30, buildsEnabled: false }) }), 'paused');
});

test('the API refusals read as plain sentences', () => {
  assert.equal(ACCESS_MESSAGES['ACCESS_REQUIRED'], 'Builds need a judge access code. Everything else (browsing, recorded builds, presenting) works without one.');
  assert.equal(ACCESS_MESSAGES['JUDGE_BUDGET_REACHED'], 'The judges’ build budget is used up. Recorded lessons, replays and presenting still work.');
  assert.equal(ACCESS_MESSAGES['BUILDS_PAUSED'], 'Builds are paused right now. Recorded lessons, replays and presenting still work.');
  assert.equal(ACCESS_MESSAGES['ACCESS_CODE_INVALID'], 'That access code is not right. Check it and try again.');
  assert.equal(ACCESS_MESSAGES['TOO_MANY_ATTEMPTS'], 'Too many tries. Wait a minute, then try again.');
});
