import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRICES_PER_MTOK, costFromUsage, inputTokenBound, isValidUsage, reservationUSD } from './pricing.ts';
import type { Usage } from '../contracts/index.ts';

test('prices match the published Muse Spark Standard rates', () => {
  assert.equal(PRICES_PER_MTOK['muse-spark-1.3'].input, 1.25);
  assert.equal(PRICES_PER_MTOK['muse-spark-1.3'].cachedInput, 0.15);
  assert.equal(PRICES_PER_MTOK['muse-spark-1.3'].output, 4.25);
});

test('zero usage costs zero (exact)', () => {
  const usage: Usage = { promptTokens: 0, completionTokens: 0, reasoningTokens: 0, cachedTokens: 0 };
  assert.strictEqual(costFromUsage('muse-spark-1.3', usage), 0);
});

test('known usage without cache gives an exact cost', () => {
  const usage: Usage = { promptTokens: 800000, completionTokens: 0, reasoningTokens: 0, cachedTokens: 0 };
  assert.strictEqual(costFromUsage('muse-spark-1.3', usage), 1);
});

test('output-only usage gives an exact cost', () => {
  const usage: Usage = { promptTokens: 0, completionTokens: 4000000, reasoningTokens: 0, cachedTokens: 0 };
  assert.strictEqual(costFromUsage('muse-spark-1.3', usage), 17);
});

test('cached usage matches hand-computed decimal value (tolerance)', () => {
  const usage: Usage = { promptTokens: 1000, completionTokens: 2000, reasoningTokens: 500, cachedTokens: 400 };
  const actual: number = costFromUsage('muse-spark-1.3', usage);
  assert.ok(Math.abs(actual - 0.00931) < 1e-12);
});

test('inputTokenBound for ASCII equals bytes plus framing', () => {
  const messages = [{ content: 'hello' }, { content: 'world!' }];
  const schema: Record<string, unknown> = { type: 'object' };
  const bound: number = inputTokenBound(messages, schema);
  const expected: number =
    Buffer.byteLength('hello', 'utf8') +
    Buffer.byteLength('world!', 'utf8') +
    Buffer.byteLength(JSON.stringify(schema), 'utf8') +
    64 * 2 +
    256;
  assert.strictEqual(bound, expected);
});

test('Unicode-heavy input bound covers UTF-8 bytes and exceeds JS length', () => {
  const content: string = '日本語テスト🎉🎉e\u0301';
  const messages = [{ content }];
  const schema: Record<string, unknown> = { type: 'string' };
  const bound: number = inputTokenBound(messages, schema);
  const byteCount: number = Buffer.byteLength(content, 'utf8') + Buffer.byteLength(JSON.stringify(schema), 'utf8');
  assert.ok(bound >= byteCount);
  assert.ok(bound > content.length);
  assert.ok(bound >= Buffer.byteLength(content, 'utf8'));
});

test('reservation covers costFromUsage when prompt equals the bound', () => {
  const messages = [{ content: 'hello world' }, { content: '日本語🎉' }];
  const schema: Record<string, unknown> = { type: 'object', properties: { ok: { type: 'boolean' } } };
  const bound: number = inputTokenBound(messages, schema);
  const maxOutput = 2000;
  const reservation: number = reservationUSD('muse-spark-1.3', bound, maxOutput);
  const usage: Usage = { promptTokens: bound, completionTokens: maxOutput, reasoningTokens: 0, cachedTokens: 0 };
  const cost: number = costFromUsage('muse-spark-1.3', usage);
  assert.ok(reservation >= cost);
  const cached: Usage = { promptTokens: bound, completionTokens: maxOutput, reasoningTokens: 10, cachedTokens: bound };
  assert.ok(reservation >= costFromUsage('muse-spark-1.3', cached));
});

test('reservationUSD prices tokens at full input rate plus output rate', () => {
  const actual: number = reservationUSD('muse-spark-1.3', 1000, 2000);
  assert.ok(Math.abs(actual - 0.00975) < 1e-12);
});

test('reservationUSD rejects NaN, Infinity and negative amounts', () => {
  assert.throws(() => reservationUSD('muse-spark-1.3', NaN, 10), { message: 'INVALID_AMOUNT' });
  assert.throws(() => reservationUSD('muse-spark-1.3', 10, NaN), { message: 'INVALID_AMOUNT' });
  assert.throws(() => reservationUSD('muse-spark-1.3', Infinity, 10), { message: 'INVALID_AMOUNT' });
  assert.throws(() => reservationUSD('muse-spark-1.3', 10, Infinity), { message: 'INVALID_AMOUNT' });
  assert.throws(() => reservationUSD('muse-spark-1.3', -1, 10), { message: 'INVALID_AMOUNT' });
  assert.throws(() => reservationUSD('muse-spark-1.3', 10, -5), { message: 'INVALID_AMOUNT' });
});

test('costFromUsage throws INVALID_USAGE for negative counters', () => {
  const usage: Usage = { promptTokens: -1, completionTokens: 0, reasoningTokens: 0, cachedTokens: 0 };
  assert.throws(() => costFromUsage('muse-spark-1.3', usage), { message: 'INVALID_USAGE' });
  assert.strictEqual(isValidUsage(usage), false);
});

test('costFromUsage throws INVALID_USAGE for non-integers', () => {
  const a: Usage = { promptTokens: 1.5, completionTokens: 0, reasoningTokens: 0, cachedTokens: 0 };
  const b: Usage = { promptTokens: 10, completionTokens: 2.5, reasoningTokens: 0, cachedTokens: 0 };
  assert.throws(() => costFromUsage('muse-spark-1.3', a), { message: 'INVALID_USAGE' });
  assert.throws(() => costFromUsage('muse-spark-1.3', b), { message: 'INVALID_USAGE' });
});

test('costFromUsage throws INVALID_USAGE when cached exceeds prompt', () => {
  const usage: Usage = { promptTokens: 1, completionTokens: 0, reasoningTokens: 0, cachedTokens: 1000 };
  assert.throws(() => costFromUsage('muse-spark-1.3', usage), { message: 'INVALID_USAGE' });
  assert.strictEqual(isValidUsage(usage), false);
});

test('costFromUsage throws INVALID_USAGE when reasoning exceeds completion', () => {
  const usage: Usage = { promptTokens: 100, completionTokens: 5, reasoningTokens: 10, cachedTokens: 0 };
  assert.throws(() => costFromUsage('muse-spark-1.3', usage), { message: 'INVALID_USAGE' });
});

test('isValidUsage accepts a coherent usage object', () => {
  const usage: Usage = { promptTokens: 1000, completionTokens: 2000, reasoningTokens: 500, cachedTokens: 400 };
  assert.strictEqual(isValidUsage(usage), true);
});
