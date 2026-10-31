/// <reference types="node" />
// Stage 8a slice W-A: the harness's hand-written specs (and the two goldens) quote their pages verbatim and satisfy the
// frozen limits and checks of docs/specs/STAGE-8a-subject-engines.md §1a/§1b, so the harness never shows invented text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { AlgorithmTraceGen, LogLadderGen } from '../../../../packages/contracts/kit.ts';
import { KIT_LIMITS } from '../../../../packages/contracts/kit.ts';
import { algorithmNamePattern } from '../../../../packages/kit-engines/algorithms.ts';
import { ALGORITHM_DEMO_GENS } from './algorithmDemoSpecs.ts';
import { PH_LADDER_GEN } from './logLadderDemoSpecs.ts';
import { algorithmTrace, predictPoints } from './algorithmView.ts';
import { ladderCases } from './logLadderView.ts';

const root = new URL('../../../../', import.meta.url);
const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();
const page = (id: string): string => norm(readFileSync(new URL(`data/sources/${id}.txt`, root), 'utf8'));
const golden = <T>(name: string): T => JSON.parse(readFileSync(new URL(`tests/fixtures/stage6/${name}`, root), 'utf8')) as T;

function assertQuote(sourceId: string, quote: string): void {
  assert.ok(quote.length >= 8 && quote.length <= 150, `quote length ${quote.length}: ${quote}`);
  assert.ok(page(sourceId).includes(norm(quote)), `not verbatim in ${sourceId}: ${quote}`);
}

const algorithms: AlgorithmTraceGen[] = [...ALGORITHM_DEMO_GENS, golden<AlgorithmTraceGen>('algorithm-trace.gen.json')];

test('algorithm demo specs quote their pages and pass the frozen limits', () => {
  const L = KIT_LIMITS.algorithm;
  for (const g of algorithms) {
    assertQuote(g.sourceId, g.quote);
    assert.ok(norm(g.quote).toLowerCase().includes(g.algorithmName.toLowerCase()), `${g.algorithm}: name not in quote`);
    assert.match(g.algorithmName, algorithmNamePattern(g.algorithm));
    assert.ok(g.input.length >= L.input.min && g.input.length <= L.input.max);
    assert.ok(g.input.every((v) => Number.isInteger(v) && v >= L.value.min && v <= L.value.max));
    const search = g.algorithm === 'binary-search' || g.algorithm === 'linear-search';
    assert.equal(g.hasTarget, search);
    if (g.algorithm === 'binary-search') assert.ok(g.input.every((v, i) => i === 0 || v > (g.input[i - 1] as number)));
    if (!search) assert.equal(g.target, 0);
    assert.ok(g.claims.length <= L.claims.max);
    for (const c of g.claims) {
      assertQuote(c.sourceId, c.quote);
      assert.ok(c.text.length <= L.claimText.max);
      assert.ok(norm(c.quote).includes(norm(c.text)), `claim not in its quote: ${c.text}`);
    }
    const t = algorithmTrace(g);
    assert.equal(t.truncated, false);
    if (!search) assert.deepEqual(t.sorted, [...g.input].sort((a, b) => a - b));
    assert.ok(predictPoints({ ...g, schemaVersion: '0.6.0' } as never).length >= 1);
  }
});

test('log ladder demo specs quote their pages; factor, quantity and rung values stand in their quotes', () => {
  for (const g of [PH_LADDER_GEN, golden<LogLadderGen>('log-ladder.gen.json')]) {
    assertQuote(g.sourceId, g.quote);
    assert.ok(g.quote.includes(g.factorText), 'factorText in quote');
    assert.ok(g.quote.includes(g.quantity), 'quantity in quote');
    assert.ok(g.rungs.length >= KIT_LIMITS.logLadder.rungs.min && g.rungs.length <= KIT_LIMITS.logLadder.rungs.max);
    assert.equal(new Set(g.rungs.map((r) => r.value)).size, g.rungs.length);
    for (const r of g.rungs) {
      assertQuote(r.sourceId, r.quote);
      assert.match(r.quote, new RegExp(`(?<![\\d.])${String(r.value).replace('.', '\\.')}(?![\\d]|\\.\\d)`), `rung ${r.value} as a whole token`);
    }
    const lo = Math.min(...g.rungs.map((r) => r.value));
    const hi = Math.max(...g.rungs.map((r) => r.value));
    for (const c of g.cases) {
      assert.notEqual(c.fromValue, c.toValue);
      assert.ok(c.fromValue >= lo && c.fromValue <= hi && c.toValue >= lo && c.toValue <= hi);
    }
  }
});

test('the pH page itself states the first case: 100,000 times more acidic from pH 7 to pH 2', () => {
  const [first] = ladderCases({ ...PH_LADDER_GEN, schemaVersion: '0.6.0' } as never);
  assert.equal(first?.answerText, '100,000 times more acidic');
  assert.ok(page('usgs-wss-ph-and-water').includes('this mine-drainage water would be 100,000 times more acidic than neutral water'));
});
