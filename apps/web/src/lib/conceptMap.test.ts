/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import type { ConceptMapSpec, MapLinkGen } from '../../../../packages/contracts/kit.ts';
import { gapOptions, gradeGap, layoutConceptMap, pickGapLink, relationSentence, wrapLabel } from './conceptMap.ts';
import type { MapLayout } from './conceptMap.ts';
import { loadDemoLessons } from './stage6-fixtures.ts';

const drag = loadDemoLessons().find((l) => l.id === 'drag');
const spec = Object.values(drag?.specs ?? {}).find((s) => s.componentId === 'concept-map-v1') as ConceptMapSpec;

function rect(cx: number, cy: number, w: number, h: number) {
  return { l: cx - w / 2, r: cx + w / 2, t: cy - h / 2, b: cy + h / 2 };
}
function overlap(a: ReturnType<typeof rect>, b: ReturnType<typeof rect>): boolean {
  return a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
}
function denseSpec(): ConceptMapSpec {
  const nodes = Array.from({ length: 8 }, (_, i) => ({ id: `n${i}`, label: `concept number ${i}` }));
  const rels = ['causes', 'needs', 'is part of', 'uses', 'follows', 'contrasts with'] as const;
  const pairs: [number, number][] = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 0], [0, 4], [2, 6]];
  const links: MapLinkGen[] = pairs.map(([a, b], i) => ({ id: `l${i}`, fromId: `n${a}`, toId: `n${b}`, relation: rels[i % rels.length] as MapLinkGen['relation'], sourceId: 's', quote: `quote ${i}` }));
  return { ...spec, nodes, links };
}
function checkLayout(layout: MapLayout, label: string): void {
  const boxes = layout.nodes.map((n) => rect(n.x, n.y, n.w, n.h));
  for (const n of layout.nodes) {
    assert.ok(Number.isFinite(n.x) && Number.isFinite(n.y), `${label}: node ${n.id} finite`);
    const b = rect(n.x, n.y, n.w, n.h);
    assert.ok(b.l >= 0 && b.t >= 0 && b.r <= layout.width && b.b <= layout.height, `${label}: node ${n.id} inside the view`);
  }
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) assert.equal(overlap(boxes[i] as never, boxes[j] as never), false, `${label}: nodes ${i},${j} overlap`);
  const labelBoxes = layout.links.map((l) => rect(l.labelX, l.labelY, l.labelW, l.labelH));
  layout.links.forEach((l, i) => {
    const b = labelBoxes[i] as ReturnType<typeof rect>;
    assert.ok(b.l >= 0 && b.t >= 0 && b.r <= layout.width && b.b <= layout.height, `${label}: label ${l.id} inside the view`);
    boxes.forEach((nb, k) => assert.equal(overlap(b, nb), false, `${label}: label ${l.id} covers node ${k}`));
    for (let j = i + 1; j < labelBoxes.length; j++) assert.equal(overlap(b, labelBoxes[j] as ReturnType<typeof rect>), false, `${label}: labels ${l.id},${layout.links[j]?.id} overlap`);
  });
}

test('radial layout starts at the top and spreads nodes around', () => {
  const layout = layoutConceptMap(spec);
  assert.equal(layout.nodes.length, 4);
  const [n0, n1, n2, n3] = layout.nodes;
  const cx = layout.width / 2;
  assert.ok(Math.abs((n0?.x ?? 0) - cx) < 1, 'first node is on the vertical axis');
  assert.ok((n0?.y ?? 99999) < (n1?.y ?? 0) && (n0?.y ?? 99999) < (n3?.y ?? 0), 'first node is the topmost');
  assert.ok((n1?.x ?? 0) > cx && (n3?.x ?? 99999) < cx, 'node 1 right, node 3 left');
  assert.ok((n2?.y ?? 0) > (n1?.y ?? 99999), 'node 2 is at the bottom');
});

test('layout is deterministic and keeps node order', () => {
  assert.deepEqual(layoutConceptMap(spec), layoutConceptMap(spec));
  assert.deepEqual(layoutConceptMap(spec).nodes.map((n) => n.id), spec.nodes.map((n) => n.id));
});

test('fixture layout is clean: nodes and labels stay inside the view and do not overlap', () => {
  checkLayout(layoutConceptMap(spec), 'fixture');
});

test('dense layout (8 nodes, 10 links) keeps labels apart', () => {
  checkLayout(layoutConceptMap(denseSpec()), 'dense');
});

test('each arrow starts and ends on a node border', () => {
  const layout = layoutConceptMap(spec);
  const byId = new Map(layout.nodes.map((n) => [n.id, n] as const));
  const onBorder = (n: { x: number; y: number; w: number; h: number }, px: number, py: number): boolean => {
    const dx = Math.abs(px - n.x);
    const dy = Math.abs(py - n.y);
    return (Math.abs(dx - n.w / 2) < 0.6 && dy <= n.h / 2 + 0.6) || (Math.abs(dy - n.h / 2) < 0.6 && dx <= n.w / 2 + 0.6);
  };
  for (const l of layout.links) {
    const a = byId.get(l.fromId);
    const b = byId.get(l.toId);
    assert.ok(a !== undefined && b !== undefined);
    assert.ok(onBorder(a, l.x1, l.y1), `${l.id} start`);
    assert.ok(onBorder(b, l.x2, l.y2), `${l.id} end`);
    assert.ok(Math.hypot(l.x2 - l.x1, l.y2 - l.y1) > 10, `${l.id} has length`);
  }
});

test('links carry the relation word and quote through to the layout', () => {
  const layout = layoutConceptMap(spec);
  const l = layout.links.find((x) => x.id === 'link-drag-density');
  assert.equal(l?.relation, 'uses');
  assert.match(l?.quote ?? '', /density rho/);
});

test('a link whose endpoint is missing is left out, never drawn', () => {
  const broken: ConceptMapSpec = { ...spec, links: [...spec.links, { id: 'bad', fromId: 'drag', toId: 'ghost', relation: 'uses', sourceId: 's', quote: 'q' }] };
  assert.equal(layoutConceptMap(broken).links.some((l) => l.id === 'bad'), false);
});

test('two links between the same pair get separate labels', () => {
  const twin: ConceptMapSpec = { ...spec, links: [...spec.links, { id: 'back', fromId: 'density', toId: 'drag', relation: 'causes', sourceId: 's', quote: 'q2' }] };
  const layout = layoutConceptMap(twin);
  checkLayout(layout, 'twin');
  const a = layout.links.find((l) => l.id === 'link-drag-density');
  const b = layout.links.find((l) => l.id === 'back');
  assert.ok(Math.hypot((a?.labelX ?? 0) - (b?.labelX ?? 0), (a?.labelY ?? 0) - (b?.labelY ?? 0)) > 10);
});

test('wrapLabel breaks on words and never loses text', () => {
  assert.deepEqual(wrapLabel('reference area', 12), ['reference', 'area']);
  assert.deepEqual(wrapLabel('drag', 12), ['drag']);
  assert.deepEqual(wrapLabel('a very long concept name here', 12).join(' '), 'a very long concept name here');
  assert.ok(wrapLabel('supercalifragilistic', 8).every((l) => l.length <= 20));
});

test('gap link is the one with the longest quote, lowest id on a tie', () => {
  assert.equal(pickGapLink(spec)?.id, 'link-drag-density');
  const tie: ConceptMapSpec = { ...spec, links: [
    { id: 'b-link', fromId: 'drag', toId: 'density', relation: 'uses', sourceId: 's', quote: 'same length' },
    { id: 'a-link', fromId: 'drag', toId: 'velocity', relation: 'needs', sourceId: 's', quote: 'same length' },
  ] };
  assert.equal(pickGapLink(tie)?.id, 'a-link');
  assert.equal(pickGapLink({ ...spec, links: [] }), null);
});

test('gap options are three distinct relation words including the right one, seeded', () => {
  const link = pickGapLink(spec) as MapLinkGen;
  const opts = gapOptions(spec, link);
  assert.equal(opts.length, 3);
  assert.equal(new Set(opts).size, 3);
  assert.ok(opts.includes(link.relation));
  assert.deepEqual(opts, gapOptions(spec, link));
  assert.equal(gradeGap(link, link.relation), true);
  assert.equal(gradeGap(link, opts.find((o) => o !== link.relation) as string), false);
});

test('relation sentence reads naturally', () => {
  const link = spec.links[0] as MapLinkGen;
  assert.equal(relationSentence(spec, link), 'drag uses density');
});
