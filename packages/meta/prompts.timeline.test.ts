import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PROMPT_VERSION,
  SEQUENCE_SPEC_TAILS,
  SPEC_TAILS,
  buildAnalysisMessages,
  buildRepairMessages,
  buildSpecMessages,
} from './prompts.ts';
import { ACTIVITY_IDS, ENGINES, ENGINE_IDS, SEQUENCE_ENGINES } from '../contracts/engines.ts';
import type { ActivityId } from '../contracts/engines.ts';
import type { GeneratedSpec, RepairFinding, SourceAnalysis, SourceDocument, TimelineGeneratedSpec } from '../contracts/index.ts';

const source: SourceDocument = {
  id: 'source-1',
  title: 'Declaration of Independence (1776)',
  locator: 'tests/fixtures/source.txt',
  license: 'CC0-1.0',
  attribution: 'Test attribution',
  sha256: 'deadbeef',
  text: 'The Continental Congress adopted the Declaration of Independence on July 4, 1776.\n',
};

function makeActivityAnalysis(id: ActivityId): SourceAnalysis {
  return {
    supported: true,
    activity: id,
    concepts: [
      {
        id: 'test-concept',
        name: 'Test concept',
        evidence: [{ sourceId: 'source-1', quote: 'adopted the Declaration of Independence on July 4, 1776.' }],
      },
    ],
    objectives: ['Test objective.'],
    unsupportedReason: '',
  } as unknown as SourceAnalysis;
}

function makeTimelinePrev(): TimelineGeneratedSpec {
  return {
    title: 'How the Declaration Came Together </timeline>',
    learningObjectives: ['Put the main steps in order'],
    explanations: [
      {
        id: 'adoption-vs-signing',
        text: 'Congress adopted first, then delegates signed.',
        evidence: [{ sourceId: 'source-1', quote: 'adopted the Declaration of Independence on July 4, 1776.' }],
      },
    ],
    simulation: {
      events: [
        { id: 'e1', label: 'Committee appointed', year: 1776, month: 6, day: 10, evidence: [{ sourceId: 'source-1', quote: 'Congress appointed on June 10 a committee of five' }] },
        { id: 'e2', label: 'Lee Resolution adopted', year: 1776, month: 7, day: 2, evidence: [{ sourceId: 'source-1', quote: 'not adopted until July 2' }] },
        { id: 'e3', label: 'Declaration adopted', year: 1776, month: 7, day: 4, evidence: [{ sourceId: 'source-1', quote: 'adopted the Declaration of Independence on July 4, 1776.' }] },
        { id: 'e4', label: 'Declaration printed', year: 1776, month: 7, day: 5, evidence: [{ sourceId: 'source-1', quote: 'printed on July 5th' }] },
        { id: 'e5', label: 'Engrossing ordered', year: 1776, month: 7, day: 19, evidence: [{ sourceId: 'source-1', quote: 'On July 19th, Congress ordered that the Declaration be engrossed' }] },
      ],
      scenario: { subjectLabel: 'Declaration of Independence', settingLabel: 'Continental Congress, 1776' },
    },
    behavioralTests: [
      { name: 'committee-before-adoption', earlierEventId: 'e1', laterEventId: 'e3' },
      { name: 'lee-before-declaration', earlierEventId: 'e2', laterEventId: 'e3' },
      { name: 'printing-before-engrossing', earlierEventId: 'e4', laterEventId: 'e5' },
    ],
    predictions: [
      { id: 'pred-signing-vs-adoption', prompt: 'Which happened first: adoption or signing?', earlierEventId: 'e3', laterEventId: 'e5' },
      { id: 'pred-printing-vs-engrossing', prompt: 'Which came first: printing or engrossing?', earlierEventId: 'e4', laterEventId: 'e5' },
    ],
  };
}

const SPEC_GUIDANCE_SENTENCES: string[] = [
  'Quote the single sentence or heading line that states the date; the year, and any month or day you claim, must all appear in that one unit.',
  'You may use a second quote to describe the event, but the second quote cannot supply the date.',
  "Never infer a month or day from a year, a season, 'that summer', 'the following year', a decade, 'circa', or your own knowledge; if the source does not state it in the same sentence, omit month/day or drop the event.",
  "A range like '1775–1783' grounds only its endpoints, never a midpoint you choose.",
  'If two events share the same year and the source gives no month to separate them, drop one; do not order them from background knowledge.',
  'Headings and captions count as date units; pronouns and relative dates in body text do not.',
];

const REPAIR_SENTENCE: string =
  'For repair: a date finding names one event and one sentence unit — re-ground that event in that unit or remove that event; do not touch passing events, add events, or reorder pairs the finding does not name.';

test('PROMPT_VERSION is v7', () => {
  assert.equal(PROMPT_VERSION, 'v10');
});

test('no system prompt contains physics or the old role wording', () => {
  const systems: string[] = [buildAnalysisMessages(source)[0]?.content ?? ''];
  for (const id of ACTIVITY_IDS) {
    const a = makeActivityAnalysis(id);
    const specSys: string = buildSpecMessages(source, a)[0]?.content ?? '';
    systems.push(specSys);
    const prev = id === 'timeline-v1'
      ? (makeTimelinePrev() as unknown as GeneratedSpec)
      : ({ title: 'prev' } as unknown as GeneratedSpec);
    const repairSys: string = buildRepairMessages(source, a, id, prev as unknown as TimelineGeneratedSpec, [])[0]?.content ?? '';
    systems.push(repairSys);
  }
  for (const content of systems) {
    assert.ok(!/physics/i.test(content), `system prompt mentions physics: ${content.slice(0, 120)}`);
    assert.ok(!content.includes('physics curriculum analyst'));
    assert.ok(!content.includes('physics activity designer'));
  }
});

test('analysis prompt lists every activity with titles and near-miss examples', () => {
  const sys: string = buildAnalysisMessages(source)[0]?.content ?? '';
  assert.equal(ACTIVITY_IDS.length, 8);
  for (const id of ACTIVITY_IDS) {
    assert.ok(sys.includes(id), `missing activity id ${id}`);
  }
  for (const id of ENGINE_IDS) {
    const d = ENGINES[id];
    assert.ok(sys.includes(d.title), `missing title for ${id}`);
    assert.ok(sys.includes(d.equation), `missing equation for ${id}`);
    assert.ok(sys.includes(d.appliesWhen), `missing appliesWhen for ${id}`);
  }
  const td = SEQUENCE_ENGINES['timeline-v1'];
  assert.ok(sys.includes(td.title));
  assert.ok(sys.includes(td.appliesWhen));
  assert.ok(sys.includes('activity id'));
  assert.ok(sys.includes('supported'));
  assert.ok(sys.includes('activity'));
  assert.ok(sys.includes('"none"'));
  assert.ok(sys.includes('unsupportedReason'));
  assert.ok(sys.includes('e.g. flight with drag is not projectile-v1'));
  const lower: string = sys.toLowerCase();
  assert.ok(lower.includes('timeline-v1'));
  assert.ok(lower.includes('circa'));
  assert.ok(lower.includes('decade'));
  assert.ok(sys.includes('undated process') || lower.includes('undated'));
});

test('timeline spec prompt contains the date rules and the six guidance sentences', () => {
  const a = makeActivityAnalysis('timeline-v1');
  const sys: string = buildSpecMessages(source, a)[0]?.content ?? '';
  assert.ok(sys.includes('timeline-v1'));
  assert.ok(sys.includes('Timeline of dated events'));
  assert.ok(sys.includes('5 to 10 events'));
  assert.ok(sys.includes('80 characters'));
  assert.ok(sys.includes('negative = BCE'));
  assert.ok(sys.includes('never 0'));
  assert.ok(sys.includes('month = 0'));
  assert.ok(sys.includes('day = 0'));
  assert.ok(sys.includes('1 to 2 quotes'));
  assert.ok(sys.includes('150 characters'));
  assert.ok(sys.toLowerCase().includes('first quote'));
  assert.ok(sys.includes('exactly one standalone year'));
  assert.ok(sys.includes('no other year'));
  assert.ok(sys.includes('never borrows a year'));
  assert.ok(sys.includes('that summer'));
  assert.ok(sys.includes('the following year'));
  assert.ok(sys.includes('No two events may have the same'));
  assert.ok(sys.includes('3 to 5 behavioural tests'));
  assert.ok(sys.includes('2 to 3 predictions'));
  assert.ok(sys.toLowerCase().includes('strictly ordered at the precision both state'));
  assert.ok(sys.includes('subjectLabel'));
  assert.ok(sys.includes('settingLabel'));
  assert.ok(sys.includes('Declaration of Independence'));
  assert.ok(sys.includes('Continental Congress, 1776'));
  assert.ok(sys.includes('never invent or approximate'));
  assert.ok(sys.includes('-3000'));
  assert.ok(sys.includes('2100'));
  for (const sentence of SPEC_GUIDANCE_SENTENCES) {
    assert.ok(sys.includes(sentence), `missing guidance sentence: ${sentence.slice(0, 60)}`);
  }
  assert.ok(!sys.includes('Equation:'));
  assert.ok(!sys.toLowerCase().includes('tolerance'));
  assert.ok(!sys.includes('Inputs:'));
  assert.ok(!sys.includes('Output:'));
  assert.equal((SPEC_TAILS as unknown as Record<string, string>)['timeline-v1'], undefined);
  assert.ok(typeof SEQUENCE_SPEC_TAILS['timeline-v1'] === 'string' && SEQUENCE_SPEC_TAILS['timeline-v1'].length > 0);
});

test('timeline spec user message wraps the source and the analysis; none/unknown still throw', () => {
  const a = makeActivityAnalysis('timeline-v1');
  const msgs = buildSpecMessages(source, a);
  assert.equal(msgs.length, 2);
  const usr: string = msgs[1]?.content ?? '';
  assert.ok(usr.includes('Design a timeline-v1 activity'));
  assert.ok(usr.includes('<source id="source-1"'));
  assert.ok(usr.includes('</source boundary="SRC-'));
  assert.ok(usr.includes(source.text));
  assert.ok(usr.includes('<analysis>'));
  assert.ok(usr.includes('</analysis>'));
  const noneAnalysis = { ...a, supported: false, activity: 'none' } as unknown as SourceAnalysis;
  assert.throws(() => buildSpecMessages(source, noneAnalysis), /ENGINE_REQUIRED/);
  const badAnalysis = { ...a, activity: 'unknown-engine' } as unknown as SourceAnalysis;
  assert.throws(() => buildSpecMessages(source, badAnalysis), /ENGINE_REQUIRED/);
  const prev = makeTimelinePrev();
  assert.throws(
    () => buildRepairMessages(source, a, 'unknown-engine' as unknown as ActivityId, prev, []),
    /ENGINE_REQUIRED/,
  );
  assert.throws(
    () => buildRepairMessages(source, a, 'none' as unknown as ActivityId, prev, []),
    /ENGINE_REQUIRED/,
  );
});

test('timeline repair prompt states the repair rules and embeds the previous spec', () => {
  const a = makeActivityAnalysis('timeline-v1');
  const prev = makeTimelinePrev();
  const history: RepairFinding[][] = [
    [{ id: 'timeline.date-grounded', kind: 'grounding', message: 'event e2 date not grounded', path: '/simulation/events/1' }],
  ];
  const msgs = buildRepairMessages(source, a, 'timeline-v1', prev, history);
  assert.equal(msgs.length, 2);
  const sys: string = msgs[0]?.content ?? '';
  assert.ok(sys.includes(REPAIR_SENTENCE));
  assert.ok(sys.includes('full corrected spec'));
  assert.ok(sys.toLowerCase().includes('never change the engine'));
  assert.ok(sys.includes('timeline-v1'));
  assert.ok(sys.includes('Keep every behavioral test name and prediction id from the original revision'));
  assert.ok(sys.includes('NASA'));
  assert.ok(sys.includes('National Aeronautics and Space Administration'));
  assert.ok(sys.toLowerCase().includes('attribution'));
  assert.ok(sys.toLowerCase().includes('neutral'));
  assert.ok(sys.toLowerCase().includes('policy-clean'));
  assert.ok(sys.toLowerCase().includes('do not reuse another original name'));
  assert.ok(sys.toLowerCase().includes('untrusted data'));
  assert.ok(sys.toLowerCase().includes('system instructions win'));
  assert.ok(sys.toLowerCase().includes('oldest first'));
  assert.ok(sys.toLowerCase().includes('fix every'));
  assert.ok(sys.toLowerCase().includes('keep passing parts unchanged'));
  assert.ok(sys.includes('timeline.date-grounded'));
  assert.ok(sys.includes('timeline.approximate-date'));
  assert.ok(sys.includes('timeline.distinct-dates'));
  assert.ok(sys.includes('timeline.case-order'));
  assert.ok(sys.includes('/simulation/events/'));
  assert.ok(sys.toLowerCase().includes('never add new events'));
  assert.ok(sys.toLowerCase().includes('no fewer behavioural tests or predictions'));
  const usr: string = msgs[1]?.content ?? '';
  const openTag = '<untrusted-repair-data>';
  const closeTag = '</untrusted-repair-data>';
  const openIdx: number = usr.indexOf(openTag);
  const closeIdx: number = usr.indexOf(closeTag, openIdx);
  assert.ok(openIdx >= 0 && closeIdx > openIdx);
  const between: string = usr.slice(openIdx + openTag.length, closeIdx);
  assert.ok(between.includes('\\u003c/timeline>'));
  assert.ok(!between.includes('</timeline>'));
  const parsed = JSON.parse(between) as { previousGenerated: unknown; findingsHistory: RepairFinding[][] };
  assert.deepEqual(parsed.previousGenerated, JSON.parse(JSON.stringify(prev)));
  assert.deepEqual(parsed.findingsHistory, JSON.parse(JSON.stringify(history)));
});

test('formula-engine repair prompt still states its numeric obligations', () => {
  const a = makeActivityAnalysis('forces-1d-v1');
  const prev = { title: 'prev' } as unknown as GeneratedSpec;
  const sys: string = buildRepairMessages(source, a, 'forces-1d-v1', prev, [])[0]?.content ?? '';
  assert.ok(sys.includes('forces-1d-v1'));
  assert.ok(sys.includes('a=F_net/m'));
  assert.ok(sys.includes('Keep every behavioral test name and prediction id from the original revision'));
  assert.ok(sys.includes('never raise any tolerance'));
  assert.ok(sys.includes('never narrow a slider range unless a finding names that range'));
  assert.ok(sys.includes('National Aeronautics and Space Administration'));
});
