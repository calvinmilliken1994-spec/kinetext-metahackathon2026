/// <reference types="node" />
// Stage 8a (slice W-B): the four new subject engines in presentation mode (docs/specs/STAGE-8a-subject-engines.md §4).
// Each engine part is ONE beat with `<name>PresentationSteps(spec)` steps; → walks the steps, R reveals the CURRENT step
// (it never jumps to the last one), and the view gets { mode: 'stage', step, revealed }.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assembleKitSpec } from '../../../../packages/contracts/kit.ts';
import type { AlgorithmTraceGen, DataTableGen, KitSpec, LogLadderGen, ThresholdGen } from '../../../../packages/contracts/kit.ts';
import type { Provenance } from '../../../../packages/contracts/index.ts';
import {
  acceptsNumber, beatRevealed, canRevealNow, engineStage, initialPresent, planBeats, presentReducer, revealQuote, visibleQuotes, zoneQuote,
} from './presentation.ts';
import type { Beat, Deck, PresentAction, PresentState } from './presentation.ts';
import { algorithmPresentationSteps } from './algorithmView.ts';
import { logLadderPresentationSteps } from './logLadderView.ts';
import { thresholdPresentationSteps } from './thresholdView.ts';
import { dataTablePresentationSteps } from './dataTableView.ts';
import { buildDataTableDemos } from './dataTableDemo.ts';
import { buildThresholdDemos } from './thresholdDemo.ts';

const root = new URL('../../../../', import.meta.url);
const json = <T>(p: string): T => JSON.parse(readFileSync(new URL(p, root), 'utf8')) as T;
const provenance = json<Provenance>('tests/fixtures/provenance.fixture.json');
const opts = (id: string) => ({ id, sources: [], provenance, seed: 1 });
const algo = assembleKitSpec(json<AlgorithmTraceGen>('tests/fixtures/stage6/algorithm-trace.gen.json'), 'algorithm-trace-v1', opts('j:algorithm-trace-v1:r1'));
const ladder = assembleKitSpec(json<LogLadderGen>('tests/fixtures/stage6/log-ladder.gen.json'), 'log-ladder-v1', opts('j:log-ladder-v1:r1'));
const threshold = buildThresholdDemos(json<ThresholdGen>('tests/fixtures/stage6/threshold.gen.json'), provenance, {}).find((d) => d.id === 'electoral')?.spec;
const table = buildDataTableDemos(json<DataTableGen>('tests/fixtures/stage6/data-table.gen.json'), provenance, {}).find((d) => d.id === 'irs')?.spec;
assert.ok(threshold !== undefined && table !== undefined);

const deckOf = (specs: KitSpec[]): Deck => ({
  jobId: 'job-engines', headline: 'Engines', source: null, disclosure: 'AI-written.', overview: null, objectives: [], leftOut: 0, checks: null, quotes: null,
  parts: specs.map((spec) => ({ kind: 'kit', spec })),
});
const beats = planBeats(deckOf([algo, ladder, threshold, table]));
const run = (s: PresentState, ...as: PresentAction[]): PresentState => as.reduce(presentReducer(beats), s);
const at = (id: string): number => beats.findIndex((b) => b.kind === 'engine' && b.part.spec.componentId === id);

test('each of the four engines is one engine beat with its view’s step count', () => {
  assert.deepEqual(beats.map((b) => b.kind), ['title', 'engine', 'engine', 'engine', 'engine', 'closing']);
  const steps = (id: string): number => beats[at(id)]?.steps ?? -1;
  assert.equal(steps('algorithm-trace-v1'), algorithmPresentationSteps(algo));
  assert.equal(steps('log-ladder-v1'), logLadderPresentationSteps(ladder));
  assert.equal(steps('threshold-v1'), thresholdPresentationSteps(threshold));
  assert.equal(steps('threshold-v1'), 3);
  assert.equal(steps('data-table-v1'), dataTablePresentationSteps(table));
  assert.equal(steps('data-table-v1'), 3);
  assert.deepEqual(beats.slice(1, 5).map((b) => b.label), ['Algorithm', 'Scale', 'Vote', 'Table']);
});

test('→ walks the steps unrevealed, R reveals the current step only, → moves on unrevealed', () => {
  const i = at('threshold-v1');
  let s = initialPresent(beats, i);
  const b = beats[i] as Beat;
  assert.deepEqual(engineStage(b, s), { mode: 'stage', step: 0, revealed: false });
  s = run(s, { type: 'reveal' });
  assert.deepEqual(engineStage(b, s), { mode: 'stage', step: 0, revealed: true }, 'R does not jump to the last step');
  assert.equal(s.beat, i);
  s = run(s, { type: 'reveal' });
  assert.deepEqual([s.step, s.revealed], [0, true], 'R twice stays');
  s = run(s, { type: 'next' });
  assert.deepEqual([s.beat, s.step, s.revealed], [i, 1, false]);
  s = run(s, { type: 'next' }, { type: 'reveal' }, { type: 'next' });
  assert.deepEqual([s.beat, s.step, s.revealed], [i + 1, 0, false], 'past the last step → next beat');
});

test('← hides the current step’s answer first, then steps back; entering backwards lands on the last step, hidden', () => {
  const i = at('threshold-v1');
  let s = run(initialPresent(beats, i), { type: 'next' }, { type: 'reveal' });
  s = run(s, { type: 'prev' });
  assert.deepEqual([s.beat, s.step, s.revealed], [i, 1, false]);
  s = run(s, { type: 'prev' });
  assert.deepEqual([s.beat, s.step, s.revealed], [i, 0, false]);
  s = run(initialPresent(beats, i + 1), { type: 'prev' });
  assert.deepEqual([s.beat, s.step, s.revealed], [i, 2, false]);
  s = run(s, { type: 'jump', beat: i });
  assert.deepEqual([s.step, s.revealed], [0, false]);
});

test('a one-step engine beat still reveals with R (works with any step count)', () => {
  const one = planBeats(deckOf([{ ...threshold, scenarios: threshold.scenarios.slice(0, 1) }]));
  const j = one.findIndex((b) => b.kind === 'engine');
  assert.equal(one[j]?.steps, 1);
  let s = initialPresent(one, j);
  assert.equal(canRevealNow(one[j] as Beat, s), true);
  s = [{ type: 'reveal' } as PresentAction].reduce(presentReducer(one), s);
  assert.equal(beatRevealed(one[j] as Beat, s), true);
  assert.equal(canRevealNow(one[j] as Beat, s), false);
});

test('revealed is cleared by every move and never leaks to other beats', () => {
  const i = at('data-table-v1');
  let s = run(initialPresent(beats, i), { type: 'reveal' });
  assert.equal(s.revealed, true);
  s = run(s, { type: 'first' });
  assert.equal(s.revealed, false);
  const quizLike = run(initialPresent(beats, 0), { type: 'reveal' });
  assert.equal(quizLike.revealed, false, 'R on a non-engine beat keeps its own meaning (last step)');
});

test('digits never type into an engine beat (they jump beats)', () => {
  const b = beats[at('threshold-v1')] as Beat;
  assert.equal(acceptsNumber(b, 0), false);
});

test('a revealed engine step puts its page sentence in the quote zone', () => {
  const i = at('threshold-v1');
  const b = beats[i] as Beat;
  assert.equal(revealQuote(b, 0, false), null);
  const q = revealQuote(b, 0, true);
  assert.equal(q?.quote, 'A majority of 270 electoral votes is required to elect the President.');
  assert.equal(zoneQuote({ hovered: null, pinned: null, revealed: q, visible: visibleQuotes(b, 0, beats) })?.quote, q?.quote);
  const t = beats[at('data-table-v1')] as Beat;
  assert.match(revealQuote(t, 0, true)?.quote ?? '', /^22% for incomes over/);
  assert.equal(revealQuote(beats[at('algorithm-trace-v1')] as Beat, 0, true), null, 'W-A engines: none until their views define one');
});
