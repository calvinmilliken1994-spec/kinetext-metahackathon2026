/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { collectQuoteRefs, previewQuote } from './evidence.ts';

const spec = {
  explanations: [
    { id: 'e1', text: 't', evidence: [{ sourceId: 's1', quote: 'F = m * a' }, { sourceId: 'other', quote: 'zzz' }] },
    { id: 'e2', text: 't', evidence: [{ sourceId: 's1', quote: 'a = F / m' }] },
  ],
};
const analysis = { concepts: [{ id: 'c1', name: 'Newton II', evidence: [{ sourceId: 's1', quote: 'F = m * a' }] }] };

test('collects only quotes citing the selected source, with unique keys', () => {
  const refs = collectQuoteRefs('s1', spec, analysis);
  assert.deepEqual(refs.map((r) => r.key), ['explanation:e1:0', 'explanation:e2:0', 'concept:c1:0']);
  assert.equal(new Set(refs.map((r) => r.key)).size, refs.length);
  assert.equal(refs[2]?.ownerLabel, 'Newton II');
});

test('handles missing spec / analysis', () => {
  assert.deepEqual(collectQuoteRefs('s1', null, undefined), []);
});

test('previewQuote shortens long quotes and keeps short ones', () => {
  assert.equal(previewQuote('short  quote'), 'short quote');
  const p = previewQuote('word '.repeat(40), 30);
  assert.ok(p.length <= 30);
  assert.ok(p.endsWith('…'));
});
