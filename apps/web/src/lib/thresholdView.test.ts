/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ThresholdGen } from '../../../../packages/contracts/kit.ts';
import type { Provenance } from '../../../../packages/contracts/index.ts';
import {
  clampVotes, meterLayout, needText, quoteLeaksNeed, ruleWords, scenarioQuestion, stageInfo, thresholdPresentationSteps,
  thresholdRevealQuote, verdictText, voteOutcome,
} from './thresholdView.ts';
import { buildThresholdDemos, electoralGen } from './thresholdDemo.ts';

const root = new URL('../../../../', import.meta.url);
const json = <T>(p: string): T => JSON.parse(readFileSync(new URL(p, root), 'utf8')) as T;
const golden = json<ThresholdGen>('tests/fixtures/stage6/threshold.gen.json');
const provenance = json<Provenance>('tests/fixtures/provenance.fixture.json');
const demos = buildThresholdDemos(golden, provenance, {});
const spec = (id: string) => {
  const d = demos.find((x) => x.id === id);
  assert.ok(d !== undefined);
  return d.spec;
};

test('every demo quote is the page’s exact words (synthetic layout check excepted)', () => {
  for (const d of demos) {
    if (d.sourceId.startsWith('synthetic')) continue;
    const text = readFileSync(new URL(`data/sources/${d.sourceId}.txt`, root), 'utf8');
    for (const s of d.spec.stages) {
      assert.ok(text.includes(s.quote), `${d.id}: ${s.quote}`);
      assert.ok(text.includes(s.totalQuote), `${d.id}: ${s.totalQuote}`);
    }
  }
});

test('one presenter step per try-it scenario', () => {
  assert.equal(thresholdPresentationSteps(spec('electoral')), 3);
  assert.equal(thresholdPresentationSteps(spec('golden')), 1);
  assert.equal(thresholdPresentationSteps({ ...spec('golden'), scenarios: [] }), 1, 'never zero steps');
});

test('required counts come from the engine: 270 of 538, 38 of 50', () => {
  const [ec] = stageInfo(spec('electoral'));
  assert.equal(ec?.need, 270);
  assert.equal(ec?.needLine, 'needs 270 of 538');
  assert.equal(ec?.rule, 'a majority');
  const [am] = stageInfo(spec('amendment'));
  assert.equal(am?.need, 38);
  assert.equal(am?.needLine, 'needs 38 of 50');
  assert.equal(am?.rule, 'three-fourths');
  assert.equal(ruleWords({ rule: 'count', numerator: 0, denominator: 0 }), 'the stated count');
  assert.equal(needText(1000, 1500), 'needs 1,000 of 1,500');
});

test('a meter draws units up to 100 seats and a bar above', () => {
  assert.deepEqual(meterLayout(50), { kind: 'units', rows: 2, cols: 25 });
  assert.deepEqual(meterLayout(9), { kind: 'units', rows: 1, cols: 9 });
  assert.deepEqual(meterLayout(100), { kind: 'units', rows: 4, cols: 25 });
  assert.equal(meterLayout(101).kind, 'bar');
  assert.equal(meterLayout(538).kind, 'bar');
});

test('the required line: at need/total on a bar, after the columns the needed seats fill on units', () => {
  const [am] = stageInfo(spec('amendment'));
  assert.equal(am?.needAt, 38 / 50);
  assert.equal(am?.needColumns, 19, '38 seats in columns of 2');
  const [ec] = stageInfo(spec('electoral'));
  assert.equal(ec?.needAt, 270 / 538);
});

test('every stage must pass', () => {
  const two = spec('two-stage');
  const strong = voteOutcome(two, [90, 4]);
  assert.equal(strong.stages[0]?.passes, true);
  assert.equal(strong.stages[1]?.passes, false);
  assert.equal(strong.passes, false);
  assert.equal(strong.failedAt, 1);
  assert.equal(voteOutcome(two, [80, 5]).passes, true);
  assert.equal(voteOutcome(spec('electoral'), [269]).passes, false);
  assert.equal(voteOutcome(spec('electoral'), [270]).passes, true);
});

test('vote counts are clamped to whole seats in range', () => {
  assert.equal(clampVotes(50, 51), 50);
  assert.equal(clampVotes(50, -3), 0);
  assert.equal(clampVotes(50, 37.6), 38);
  assert.equal(clampVotes(50, Number.NaN), 0);
});

test('questions and verdicts are worded by code', () => {
  assert.equal(scenarioQuestion(spec('amendment'), { yes: [35] }), 'Will 35 of 50 States be enough?');
  assert.equal(scenarioQuestion(spec('electoral'), { yes: [269] }), 'Will 269 of 538 electoral votes be enough?');
  assert.equal(scenarioQuestion(spec('two-stage'), { yes: [90, 4] }), 'Will this vote pass every stage?');
  assert.deepEqual(verdictText(spec('amendment'), voteOutcome(spec('amendment'), [35])), { headline: 'It fails', detail: '3 short of the 38 needed.' });
  assert.deepEqual(verdictText(spec('amendment'), voteOutcome(spec('amendment'), [38])), { headline: 'It passes', detail: 'Exactly the 38 needed.' });
  assert.deepEqual(verdictText(spec('electoral'), voteOutcome(spec('electoral'), [365])), { headline: 'It passes', detail: '95 more than the 270 needed.' });
  assert.deepEqual(verdictText(spec('two-stage'), voteOutcome(spec('two-stage'), [90, 4])), { headline: 'It fails', detail: 'Regions: 1 short of the 5 needed.' });
});

test('a quote that states the required count stays unlinked until the reveal', () => {
  const [am] = spec('amendment').stages;
  assert.ok(am !== undefined);
  assert.equal(quoteLeaksNeed(am, am.quote), true, '“(38 of 50 States)” gives the answer away');
  const [ec] = electoralGen.stages;
  assert.ok(ec !== undefined);
  assert.equal(quoteLeaksNeed(ec, ec.quote), true);
  assert.equal(quoteLeaksNeed(ec, ec.totalQuote), false, 'the total alone is fine');
  assert.equal(quoteLeaksNeed(ec, 'Over 2700 people'), false, 'whole numbers only');
});

test('a revealed step quotes the rule of the stage that decided it', () => {
  assert.equal(thresholdRevealQuote(spec('electoral'), 0)?.quote, electoralGen.stages[0]?.quote);
  assert.equal(thresholdRevealQuote(spec('two-stage'), 0)?.quote, 'It then needs a majority of the regions.');
  assert.equal(thresholdRevealQuote(spec('two-stage'), 1)?.quote, 'A proposal needs two-thirds of the chamber.');
});
