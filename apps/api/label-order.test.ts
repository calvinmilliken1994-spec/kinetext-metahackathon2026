// A label diagram is numbered in the order its page describes the parts (Calvin, 2 Nov: the water cycle read
// "Condensation 1 … Evaporation 4"). The order is decided when a lesson is served, from where each part's quote sits in
// the page text, so every stored lesson is fixed without a rebuild. Stored runs are never rewritten.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { orderLabelPartsByPage } from './label-order.ts';
import { orderLabelParts } from './recheck.ts';

const part = (id: string, quote: string) => ({ id, name: id, quote, x: 0, y: 0 });
const spec = (...parts: ReturnType<typeof part>[]) => ({ componentId: 'label-diagram-v1', parts });

test('parts are numbered in the order their quotes appear in the page', () => {
  const page = 'Water evaporates first. Then plants transpire.\nLater   vapor condenses. Finally rain falls.';
  const s = spec(part('condensation', 'Later vapor condenses.'), part('rain', 'Finally rain falls.'),
    part('transpiration', 'Then plants transpire.'), part('evaporation', 'Water evaporates first.'));
  orderLabelPartsByPage(s, page);
  assert.deepEqual(s.parts.map((p) => p.id), ['evaporation', 'transpiration', 'condensation', 'rain']);
});

test('a quote the page does not contain keeps its place after the found ones; other kinds are left alone', () => {
  const s = spec(part('a', 'not on the page'), part('c', 'second'), part('b', 'first'));
  orderLabelPartsByPage(s, 'first then second');
  assert.deepEqual(s.parts.map((p) => p.id), ['b', 'c', 'a']);
  const other = { componentId: 'sequence-v1', parts: [part('z', 'second'), part('y', 'first')] };
  orderLabelPartsByPage(other, 'first then second');
  assert.deepEqual(other.parts.map((p) => p.id), ['z', 'y']);
  assert.doesNotThrow(() => orderLabelPartsByPage(null, 'x'));
});

test('the stored NOAA water cycle (c31ad262) is served Evaporation 1, Transpiration 2, Condensation 3, Precipitation 4, Runoff 5', (t) => {
  const run = new URL('../../storage/runs/job-20261101235049-c31ad262/label-diagram-v1.r1.json', import.meta.url);
  const page = new URL('../../data/sources/noaa-jetstream-hydrologic-cycle.txt', import.meta.url);
  if (!existsSync(run) || !existsSync(page)) { t.skip('stored run not in this checkout'); return; }
  const s = (JSON.parse(readFileSync(run, 'utf8')) as { spec: { componentId: string; parts: { id: string; quote: string }[] } }).spec;
  orderLabelPartsByPage(s, readFileSync(page, 'utf8'));
  assert.deepEqual(s.parts.map((p) => p.id), ['evaporation', 'transpiration', 'condensation', 'precipitation', 'surface-runoff']);
});

test('serving: orderLabelParts reorders a job\'s label-diagram spec from its library page; an unknown source leaves it', () => {
  const s = spec(part('runoff', 'Runoff occurs when there is excessive precipitation'), part('evaporation', 'Evaporation is the change of state'));
  const job = { summary: { jobId: 'j', sourceId: 'noaa-jetstream-hydrologic-cycle', status: 'succeeded' }, kitSpecs: { k: s } };
  orderLabelParts('storage', job, {});
  assert.deepEqual(s.parts.map((p) => p.id), ['evaporation', 'runoff']);
  const t2 = spec(part('runoff', 'Runoff occurs'), part('evaporation', 'Evaporation is'));
  orderLabelParts('storage', { summary: { jobId: 'j', sourceId: 'no-such-source', status: 'succeeded' }, kitSpecs: { k: t2 } }, {});
  assert.deepEqual(t2.parts.map((p) => p.id), ['runoff', 'evaporation']);
});
