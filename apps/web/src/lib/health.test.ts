/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateState, isServerBusy, REASON_BUSY, REASON_DOWN, REASON_LIVE_OFF } from './health.ts';

const base = { down: false, generating: false, hasSource: true };

test('isServerBusy reads only health.busy; missing flag or no health is not busy', () => {
  assert.equal(isServerBusy({ ok: true, live: true, busy: true }), true);
  assert.equal(isServerBusy({ ok: true, live: true, busy: false }), false);
  assert.equal(isServerBusy({ ok: true, live: true }), false);
  assert.equal(isServerBusy(null), false);
  assert.equal(isServerBusy(undefined), false);
});

test('generateState: enabled when live and not busy', () => {
  const s = generateState({ ...base, health: { ok: true, live: true, busy: false } });
  assert.deepEqual(s, { disabled: false, busy: false, liveOff: false, reason: null });
});

test('generateState: disabled and labelled busy while the SERVER is busy', () => {
  const s = generateState({ ...base, health: { ok: true, live: true, busy: true } });
  assert.equal(s.disabled, true);
  assert.equal(s.busy, true);
  assert.equal(s.reason, REASON_BUSY);
});

test('generateState: a stale historical running job cannot disable the button (input has no job list)', () => {
  // The function takes no job summaries at all: with busy=false the button is enabled.
  const s = generateState({ ...base, health: { ok: true, live: true, busy: false } });
  assert.equal(s.disabled, false);
});

test('generateState: a POST in flight locks the button until health is re-read', () => {
  const s = generateState({ ...base, generating: true, health: { ok: true, live: true, busy: false } });
  assert.equal(s.disabled, true);
  assert.equal(s.busy, true);
});

test('generateState: live off, API down, health not yet loaded, no source', () => {
  const off = generateState({ ...base, health: { ok: true, live: false, busy: false } });
  assert.deepEqual([off.disabled, off.liveOff, off.reason], [true, true, REASON_LIVE_OFF]);
  const down = generateState({ ...base, down: true, health: null });
  assert.deepEqual([down.disabled, down.reason], [true, REASON_DOWN]);
  const connecting = generateState({ ...base, health: null });
  assert.deepEqual([connecting.disabled, connecting.reason], [true, null]);
  const none = generateState({ ...base, hasSource: false, health: { ok: true, live: true, busy: false } });
  assert.equal(none.disabled, true);
});
