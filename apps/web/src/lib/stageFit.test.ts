// The presentation stage scale ignores sub-pixel measuring noise (a slide 'vibrated' at 1592x815).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settleZoom } from './stageFit.ts';

test('settleZoom keeps the scale for changes under 0.5% and follows real changes', () => {
  assert.equal(settleZoom(1.144, 1.1451), 1.144, 'the measured flip-flop at 1592x815 is ignored');
  assert.equal(settleZoom(1.1451, 1.144), 1.1451);
  assert.equal(settleZoom(1.28688, 1.28944), 1.28688, 'the flip-flop at 1592x900 is ignored');
  assert.equal(settleZoom(1, 1.2), 1.2, 'a new stage size still rescales');
  assert.equal(settleZoom(1.5, 1.4), 1.4);
});
