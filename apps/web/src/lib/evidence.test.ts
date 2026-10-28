/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { collectQuoteRefs, isEvidenceKey, previewQuote } from './evidence.ts';

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

test('timeline event quotes are collected like explanation quotes and labelled with the event', () => {
  const tl = {
    explanations: [{ id: 'x1', text: 't', evidence: [{ sourceId: 's1', quote: 'q-expl' }] }],
    simulation: {
      engine: 'timeline-v1',
      events: [
        { id: 'e1', label: 'Committee appointed', evidence: [{ sourceId: 's1', quote: 'q-e1a' }, { sourceId: 'other', quote: 'zzz' }] },
        { id: 'e2', label: 'Declaration adopted', evidence: [{ sourceId: 's1', quote: 'q-e2' }] },
      ],
    },
  };
  const refs = collectQuoteRefs('s1', tl, undefined);
  assert.deepEqual(refs.map((r) => r.key), ['explanation:x1:0', 'event:e1:0', 'event:e2:0']);
  assert.equal(refs[1]?.kind, 'event');
  assert.equal(refs[1]?.ownerLabel, 'Committee appointed');
  assert.equal(refs[1]?.quote, 'q-e1a');
});

test('specs without events (numeric engines) are unaffected by event collection', () => {
  const refs = collectQuoteRefs('s1', { ...spec, simulation: { engine: 'projectile-v1' } }, undefined);
  assert.deepEqual(refs.map((r) => r.key), ['explanation:e1:0', 'explanation:e2:0']);
});

test('explanation and timeline-event quotes highlight as evidence; concepts do not', () => {
  assert.equal(isEvidenceKey('explanation:e1:0'), true);
  assert.equal(isEvidenceKey('event:e3:0'), true);
  assert.equal(isEvidenceKey('concept:c1:0'), false);
});
