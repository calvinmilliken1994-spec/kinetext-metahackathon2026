import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROMPT_VERSION, buildRepairMessages } from './prompts.ts';
import type { ActivityId } from '../contracts/engines.ts';
import type { GeneratedSpec, RepairFinding, SourceAnalysis, SourceDocument, TimelineGeneratedSpec } from '../contracts/index.ts';

const source: SourceDocument = {
  id: 'source-1',
  title: 'Test source',
  locator: 'tests/fixtures/source.txt',
  license: 'CC0-1.0',
  attribution: 'Test attribution',
  sha256: 'deadbeef',
  text: 'Net force equals mass times acceleration.\n',
};

function makeAnalysis(activity: ActivityId): SourceAnalysis {
  return {
    supported: true,
    activity,
    unsupportedReason: '',
    concepts: [
      {
        id: 'test-concept',
        name: 'Test concept',
        evidence: [{ sourceId: 'source-1', quote: 'Net force equals mass times acceleration.' }],
      },
    ],
    objectives: ['Test objective.'],
  } as unknown as SourceAnalysis;
}

function makeTimelinePrev(): TimelineGeneratedSpec {
  return {
    title: 'Timeline prev',
    learningObjectives: ['Order events'],
    explanations: [],
    simulation: {
      events: [
        { id: 'e1', label: 'First', year: 1776, month: 6, day: 10, evidence: [{ sourceId: 'source-1', quote: 'June 10 committee' }] },
        { id: 'e2', label: 'Second', year: 1776, month: 7, day: 4, evidence: [{ sourceId: 'source-1', quote: 'July 4 adoption' }] },
      ],
      scenario: { subjectLabel: 'Subject', settingLabel: 'Setting' },
    },
    behavioralTests: [{ name: 'first-before-second', earlierEventId: 'e1', laterEventId: 'e2' }],
    predictions: [{ id: 'pred-first-second', prompt: 'Which first?', earlierEventId: 'e1', laterEventId: 'e2' }],
  } as unknown as TimelineGeneratedSpec;
}

const OLD_SINGLE_EXCEPTION: string =
  'The only exception is a name or id that itself violates the publisher policy';
const INVALID_ID_PHRASE: string = 'a prediction id that is itself not a valid id';
const ID_PATTERN: string = '/^[a-z0-9][a-z0-9-]{0,39}$/';

function numericSys(engine: ActivityId): string {
  const prev = { title: 'prev' } as unknown as GeneratedSpec;
  return buildRepairMessages(source, makeAnalysis(engine), engine, prev, [])[0]?.content ?? '';
}

function timelineSys(): string {
  const prev = makeTimelinePrev();
  return buildRepairMessages(source, makeAnalysis('timeline-v1'), 'timeline-v1', prev, [])[0]?.content ?? '';
}

test("PROMPT_VERSION === 'v9'", () => {
  assert.equal(PROMPT_VERSION, 'v9');
});

test('numeric repair prompts name both rename exceptions', () => {
  for (const engine of ['forces-1d-v1', 'projectile-v1'] as ActivityId[]) {
    const sys: string = numericSys(engine);
    assert.ok(sys.includes(INVALID_ID_PHRASE), `${engine} missing invalid-id exception`);
    assert.ok(sys.includes(ID_PATTERN), `${engine} missing id pattern`);
    assert.ok(sys.includes('publisher policy'), `${engine} missing publisher-policy exception`);
    assert.ok(sys.includes('NASA'), `${engine} missing NASA`);
    assert.ok(sys.includes('National Aeronautics and Space Administration'), `${engine} missing full publisher name`);
    assert.ok(!sys.includes(OLD_SINGLE_EXCEPTION), `${engine} still states the old single exception`);
  }
});

test('timeline repair prompt names both rename exceptions', () => {
  const sys: string = timelineSys();
  assert.ok(sys.includes(INVALID_ID_PHRASE));
  assert.ok(sys.includes(ID_PATTERN));
  assert.ok(sys.includes('publisher policy'));
  assert.ok(sys.includes('NASA'));
  assert.ok(sys.includes('National Aeronautics and Space Administration'));
  assert.ok(!sys.includes(OLD_SINGLE_EXCEPTION));
  assert.ok(sys.includes('The only exceptions are'));
});

test('numeric repair prompts keep their numeric obligations', () => {
  for (const engine of ['forces-1d-v1', 'projectile-v1'] as ActivityId[]) {
    const sys: string = numericSys(engine);
    assert.ok(sys.includes('Keep every behavioral test name and prediction id from the original revision'));
    assert.ok(sys.includes('never raise any tolerance'));
    assert.ok(sys.includes('never narrow a slider range unless a finding names that range'));
    assert.ok(sys.toLowerCase().includes('keep its numbers'));
    assert.ok(sys.toLowerCase().includes('inputs'));
    assert.ok(sys.toLowerCase().includes('expected value'));
    assert.ok(sys.toLowerCase().includes('tolerance unchanged'));
    assert.ok(sys.toLowerCase().includes('do not reuse another original name'));
    assert.ok(sys.toLowerCase().includes('neutral'));
    assert.ok(sys.toLowerCase().includes('policy-clean'));
    assert.ok(sys.includes('rename only that prediction id to a valid one'));
  }
});

test('timeline repair prompt keeps its pair obligation and publisher wording', () => {
  const sys: string = timelineSys();
  assert.ok(sys.includes('Keep every behavioral test name and prediction id from the original revision'));
  assert.ok(sys.includes('keep its pair unchanged'));
  assert.ok(sys.toLowerCase().includes('neutral'));
  assert.ok(sys.toLowerCase().includes('policy-clean'));
  assert.ok(sys.toLowerCase().includes('do not reuse another original name'));
  assert.ok(sys.includes('rename only that prediction id to a valid one'));
});

test('timeline repair prompt states the affected-list and label/name/id rules', () => {
  const sys: string = timelineSys();
  assert.ok(sys.includes("each finding's affected list gives the exact fields it unlocks"));
  assert.ok(sys.includes('unlocks only that string'));
  assert.ok(sys.includes("it never permits changing any event's year, month, day or evidence quotes"));
  assert.ok(sys.includes("or any case's earlierEventId/laterEventId pair"));
  assert.ok(sys.includes('policy.no-publisher-attribution'));
  assert.ok(sys.includes('/simulation/events/<i>/label'));
  assert.ok(sys.includes('/behavioralTests/<i>/name'));
  assert.ok(sys.includes('/predictions/<i>/id'));
  assert.ok(sys.includes('Only a date finding (timeline.date-grounded, timeline.approximate-date, timeline.distinct-dates) unlocks that event\'s date and quotes (or its removal)'));
  assert.ok(sys.includes('only a timeline.case-order finding unlocks that case\'s earlierEventId/laterEventId pair'));
});

test('no system prompt contains physics', () => {
  for (const sys of [numericSys('forces-1d-v1'), numericSys('projectile-v1'), timelineSys()]) {
    assert.ok(!/physics/i.test(sys));
  }
});
