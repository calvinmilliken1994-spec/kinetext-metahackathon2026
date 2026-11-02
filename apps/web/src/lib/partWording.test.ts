/// <reference types="node" />
// Stage 10c slice D (UX review 2, M3): the Review page shows what each part says to students, read-only, so the teacher
// can tick "I've read the wording" having read it. Pure: one list of short lines per kind of part.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { partWording, previewLines, WORDING_PREVIEW } from './partWording.ts';
import type { WordingLine } from './partWording.ts';
import { normaliseJobDetail } from './lessonJob.ts';
import { lessonWire } from './lessonJobFixtures.ts';
import { reviewModel } from './review.ts';
import type { KitSpec } from '../../../../packages/contracts/kit.ts';

const gen = <T,>(name: string): T => JSON.parse(readFileSync(new URL(`../../../../tests/fixtures/stage6/${name}.gen.json`, import.meta.url), 'utf8')) as T;
/** A kit gen file is the spec's content plus system fields: enough for the wording rules. */
const asSpec = (name: string, componentId: string): KitSpec => ({ ...gen<Record<string, unknown>>(name), componentId }) as unknown as KitSpec;
const texts = (l: readonly WordingLine[]): string[] => l.map((x) => x.text);

test('quiz cards: each question is a line, its answer options sit under it', () => {
  const spec = asSpec('quiz-cards', 'quiz-cards-v1') as KitSpec & { cards: { stem: string; options: string[] }[] };
  const lines = partWording(spec, null);
  assert.equal(lines.length, spec.cards.length);
  assert.ok(lines[0]!.text.length > 5);
  assert.match(lines[0]!.detail ?? '', / · /);
  for (const o of spec.cards[0]!.options) assert.ok((lines[0]!.detail ?? '').toLowerCase().includes(o.toLowerCase()), `option "${o}" is shown`);
});

test('sequence: the steps in the page order, numbered', () => {
  const spec = asSpec('sequence', 'sequence-v1') as KitSpec & { steps: { label: string }[] };
  const lines = partWording(spec, null);
  assert.equal(lines.length, spec.steps.length);
  assert.match(lines[0]!.text, /^1\. /);
  assert.match(lines[1]!.text, /^2\. /);
});

test('sort into groups: each group with its items', () => {
  const spec = asSpec('sort-groups', 'sort-groups-v1') as KitSpec & { groups: { label: string }[]; items: { label: string; groupId: string }[] };
  const lines = partWording(spec, null);
  assert.equal(lines.length, spec.groups.length);
  const total = lines.reduce((n, l) => n + (l.detail ?? '').split(' · ').filter((x) => x !== '').length, 0);
  assert.equal(total, spec.items.length, 'every item appears once, under its group');
});

test('concept map: one line per link, read as a sentence; compare table: one line per row', () => {
  const map = asSpec('concept-map', 'concept-map-v1') as KitSpec & { links: unknown[] };
  assert.equal(partWording(map, null).length, map.links.length);
  assert.match(partWording(map, null)[0]!.text, /\b(causes|needs|is part of|uses|follows|contrasts with)\b/i);
  const cmp = asSpec('compare-table', 'compare-table-v1');
  const lines = partWording({ ...cmp, entities: ['Alpha', 'Beta'], attributes: ['Size', 'Colour'], cells: [
    { id: 'c1', entityIndex: 0, attributeIndex: 0, value: 'big', sourceId: 's', quote: 'q' },
    { id: 'c2', entityIndex: 0, attributeIndex: 1, value: 'red', sourceId: 's', quote: 'q' },
    { id: 'c3', entityIndex: 1, attributeIndex: 0, value: 'small', sourceId: 's', quote: 'q' },
  ] } as unknown as KitSpec, null);
  assert.deepEqual(texts(lines), ['Alpha', 'Beta']);
  assert.equal(lines[0]!.detail, 'Size: Big · Colour: Red', 'values read as the table shows them (sentence case)');
  assert.equal(lines[1]!.detail, 'Size: Small');
});

test('formula explorer, balance, algorithm, ladder, threshold, data table and diagram each give lines', () => {
  for (const [file, id] of [
    ['formula-explorer', 'formula-explorer-v1'], ['balance-equation', 'balance-equation-v1'], ['algorithm-trace', 'algorithm-trace-v1'],
    ['log-ladder', 'log-ladder-v1'], ['threshold', 'threshold-v1'], ['data-table', 'data-table-v1'], ['label-diagram', 'label-diagram-v1'],
  ] as const) {
    const lines = partWording(asSpec(file, id), null);
    assert.ok(lines.length >= 1, `${id} has wording`);
    assert.ok(lines.every((l) => l.text.trim() !== ''), `${id}: no empty line`);
  }
  const f = partWording(asSpec('formula-explorer', 'formula-explorer-v1'), null);
  assert.ok(f[0]!.text.includes('='), 'the formula comes first');
  const d = texts(partWording(asSpec('label-diagram', 'label-diagram-v1'), null));
  assert.ok(d.length >= 2);
});

test('data table: a column with a blank unit shows its header alone, never "( )"', () => {
  const spec = { componentId: 'data-table-v1', labelHeader: 'Isotope', columns: [{ header: 'Half-life', unit: ' ' }, { header: 'Mass', unit: 'g' }], rows: [{ label: 'U-238' }], questions: [{ kind: 'lookup', rowIndex: 0, columnIndex: 0 }] } as unknown as KitSpec;
  const lines = partWording(spec, null);
  assert.equal(lines[0]!.detail, 'Isotope · Half-life · Mass (g)');
  assert.equal(lines[1]!.text, 'What is U-238’s Half-life?');
});

test('the display clean-up applies: code ticks and zero-width characters never reach the teacher', () => {
  const spec = { componentId: 'sequence-v1', steps: [{ label: '`rain`\u200b falls' }, { label: 'water collects' }] } as unknown as KitSpec;
  assert.deepEqual(texts(partWording(spec, null)), ['1. Rain falls', '2. Water collects']);
});

test('a premium activity reads its prediction questions and explanations; no spec, no lines', () => {
  const premium = { title: 'Throw it', learningObjectives: ['x'], explanations: [{ id: 'e1', text: 'Gravity pulls down.', evidence: [] }], predictions: [{ id: 'p1', prompt: 'How far does it go?' }] };
  assert.deepEqual(texts(partWording(null, premium as never)), ['How far does it go?', 'Gravity pulls down.']);
  assert.deepEqual(partWording(null, null), []);
});

test('previewLines: the first lines show; the rest wait behind "Show all"', () => {
  const lines: WordingLine[] = [1, 2, 3, 4, 5].map((n) => ({ text: `line ${n}` }));
  assert.equal(WORDING_PREVIEW, 2);
  assert.deepEqual(previewLines(lines, false), { shown: lines.slice(0, 2), hidden: 3 });
  assert.deepEqual(previewLines(lines, true), { shown: lines, hidden: 0 });
  assert.deepEqual(previewLines(lines.slice(0, 2), false), { shown: lines.slice(0, 2), hidden: 0 });
  assert.deepEqual(previewLines([], false), { shown: [], hidden: 0 });
});

test('the Review rows carry each working part\'s wording (kit parts), in the lesson order', () => {
  const detail = normaliseJobDetail(lessonWire('complete'));
  const model = reviewModel(detail);
  assert.ok(model.parts.length >= 2);
  for (const row of model.parts) assert.ok(row.wording.length > 0, `${row.id} has wording to read`);
});
