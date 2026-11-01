/// <reference types="node" />
// Stage 10b slice R: the web client for POST /api/jobs/:id/review, against a fake fetch (no network, no server).
import test from 'node:test';
import assert from 'node:assert/strict';
import { api, ApiError } from '../api.ts';

interface Call { url: string; init: RequestInit }

async function withFetch(reply: { status: number; body: unknown }, run: (calls: Call[]) => Promise<void>): Promise<void> {
  const calls: Call[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  try {
    await run(calls);
  } finally {
    globalThis.fetch = real;
  }
}

const REVIEW = { status: 'published', publishedAt: '2026-11-02T12:30:00.000Z', hiddenParts: ['b'], checkedParts: ['a'] };

test('postReview publish: POSTs the body as JSON to the job’s review route and reads { review }', async () => {
  await withFetch({ status: 200, body: { review: REVIEW } }, async (calls) => {
    const out = await api.postReview('job-1', { action: 'publish', checkedParts: ['a'], hiddenParts: ['b'] });
    assert.deepEqual(out, REVIEW);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, '/api/jobs/job-1/review');
    assert.equal(calls[0]?.init.method, 'POST');
    assert.deepEqual(calls[0]?.init.headers, { 'content-type': 'application/json' });
    assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), { action: 'publish', checkedParts: ['a'], hiddenParts: ['b'] });
  });
});

test('postReview unpublish: { review: null } reads as null', async () => {
  await withFetch({ status: 200, body: { review: null } }, async (calls) => {
    assert.equal(await api.postReview('job-1', { action: 'unpublish' }), null);
    assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), { action: 'unpublish' });
  });
});

test('postReview encodes the id and surfaces the API’s code as an ApiError', async () => {
  await withFetch({ status: 403, body: { error: 'ACCESS_REQUIRED' } }, async (calls) => {
    await assert.rejects(api.postReview('job a/b', { action: 'unpublish' }), (e: unknown) => e instanceof ApiError && e.code === 'ACCESS_REQUIRED' && e.status === 403);
    assert.equal(calls[0]?.url, '/api/jobs/job%20a%2Fb/review');
  });
  await withFetch({ status: 400, body: { error: 'REVIEW_INCOMPLETE' } }, async () => {
    await assert.rejects(api.postReview('job-1', { action: 'publish', checkedParts: [], hiddenParts: [] }), (e: unknown) => e instanceof ApiError && e.code === 'REVIEW_INCOMPLETE');
  });
});

test('an answer that is not a published review reads as no review (never a made-up one)', async () => {
  await withFetch({ status: 200, body: { review: { status: 'draft' } } }, async () => {
    assert.equal(await api.postReview('job-1', { action: 'publish', checkedParts: ['a'], hiddenParts: [] }), null);
  });
});
