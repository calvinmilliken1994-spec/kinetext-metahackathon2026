import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KIT_GEN_COMPONENT_IDS } from '../contracts/kit.ts';
import type { ComponentPlanEntry, SourceAnalysisV2 } from '../contracts/kit.ts';
import type { SourceDocument } from '../contracts/index.ts';
import {
  KIT_COMPONENT_GUIDANCE,
  KIT_REPAIR_SCHEMA_NAMES,
  KIT_SCHEMA_NAMES,
  STAGE6_PROMPT_VERSION,
  SUBJECT_GUIDANCE,
  buildAnalysisV2Messages,
  buildKitComponentMessages
} from './prompts-v2.ts';

function synthSource(): SourceDocument {
  return {
    id: 'synthetic-s6v9',
    title: 'Synthetic s6v9 source',
    locator: 'synthetic/s6v9.txt',
    license: 'project-authored synthetic',
    attribution: 'Project-authored synthetic text',
    sha256: 'abc',
    text: 'The cell has a nucleus, mitochondria and a ribosome. The nucleus holds the genetic material of the cell.'
  };
}

function labelPlanEntry(source: SourceDocument): ComponentPlanEntry & { componentId: 'label-diagram-v1' } {
  return {
    componentId: 'label-diagram-v1',
    pedagogicalReason: 'Label the parts of the cell shown in the listed figure.',
    focusQuote: 'The cell has a nucleus, mitochondria and a ribosome.',
    focusSourceId: source.id
  };
}

function labelAnalysis(source: SourceDocument): SourceAnalysisV2 {
  const plan = labelPlanEntry(source);
  return {
    usable: true,
    subject: 'biology',
    componentPlan: [plan]
  } as unknown as SourceAnalysisV2;
}

test('prompt version is s6-v9', () => {
  assert.equal(STAGE6_PROMPT_VERSION, 's6-v9');
});

test('every component has gen/repair names, design text and a when row', () => {
  const source = synthSource();
  const system = buildAnalysisV2Messages(source)[0]?.content as string;
  for (const id of KIT_GEN_COMPONENT_IDS) {
    const genName: string = KIT_SCHEMA_NAMES[id];
    const repairName: string = KIT_REPAIR_SCHEMA_NAMES[id];
    assert.equal(typeof genName, 'string');
    assert.ok(genName.length > 0, `missing gen name for ${id}`);
    assert.equal(typeof repairName, 'string');
    assert.ok(repairName.length > 0, `missing repair name for ${id}`);
    const design: string = KIT_COMPONENT_GUIDANCE[id];
    assert.equal(typeof design, 'string');
    assert.ok(design.length > 0, `missing design text for ${id}`);
    assert.ok(system.includes(`- ${id}:`), `missing when row for ${id}`);
  }
  assert.equal(KIT_SCHEMA_NAMES['label-diagram-v1'], 'label_diagram');
  assert.equal(KIT_REPAIR_SCHEMA_NAMES['label-diagram-v1'], 'label_diagram_repair');
});

test('label-diagram-v1 when row restricts to listed figures, not photos or charts', () => {
  const source = synthSource();
  const system = buildAnalysisV2Messages(source)[0]?.content as string;
  const row = system.split('\n').find((line) => line.includes('label-diagram-v1:')) ?? '';
  assert.ok(row.includes('only when a figure is listed'), 'when row must require a listed figure');
  assert.ok(row.toLowerCase().includes('photo'), 'when row must exclude photos');
  assert.ok(row.includes('data chart'), 'when row must exclude data charts');
});

test('label subject guidance for biology, earth-science, chemistry and physics', () => {
  for (const subject of ['biology', 'earth-science', 'chemistry', 'physics'] as const) {
    assert.ok(
      SUBJECT_GUIDANCE[subject].includes('label-diagram-v1'),
      `${subject} guidance must mention label-diagram-v1`
    );
    assert.ok(
      SUBJECT_GUIDANCE[subject].includes('may plan label-diagram-v1 when a listed figure shows parts the page names'),
      `${subject} guidance must carry the listed-figure rule`
    );
  }
});

test('label design text states normalised coordinates and the printed-label rule', () => {
  const design: string = KIT_COMPONENT_GUIDANCE['label-diagram-v1'];
  assert.ok(design.includes('normalised'), 'design must state normalised coordinates');
  assert.ok(design.includes('0..1000'), 'design must state the 0..1000 grid');
  assert.ok(design.includes('never on its printed label'), 'design must forbid points on the printed label');
  assert.ok(design.toLowerCase().includes('all-zero'), 'design must document the all-zero box');
  assert.ok(design.includes('never describe regions'), 'design must not ask for regions');
  const source = synthSource();
  const messages = buildKitComponentMessages(source, labelAnalysis(source), labelPlanEntry(source));
  const kitSystem = messages[0]?.content as string;
  assert.ok(kitSystem.includes('never on its printed label'));
});

test('analysis message without figures carries no figure block', () => {
  const source = synthSource();
  const none = buildAnalysisV2Messages(source);
  const undef = buildAnalysisV2Messages(source, undefined);
  const empty = buildAnalysisV2Messages(source, []);
  assert.deepEqual(undef, none);
  assert.deepEqual(empty, none);
  const user = none[1]?.content as string;
  assert.ok(!user.includes('<untrusted-figures>'), 'no figure block without figures');
  assert.ok(!user.includes('label-diagram-v1 only with a listed figure'), 'no figure rule without figures');
});

test('analysis message with figures lists them and states the planning rule', () => {
  const source = synthSource();
  const figures = [
    { id: 'fig-cell-1', caption: 'Diagram of a cell', labelsInImage: true },
    { id: 'fig-dna-2', caption: 'Diagram of DNA', labelsInImage: false }
  ];
  const without = (buildAnalysisV2Messages(source)[1]?.content as string);
  const withFigures = buildAnalysisV2Messages(source, figures);
  const user = withFigures[1]?.content as string;
  assert.ok(user.startsWith(without), 'figure block must be appended, leaving the base message unchanged');
  assert.ok(user.includes('<untrusted-figures>'), 'figure block must be untrusted data');
  for (const f of figures) {
    assert.ok(user.includes(f.id), `figure list must include ${f.id}`);
    assert.ok(user.includes(f.caption), `figure list must include caption for ${f.id}`);
  }
  assert.ok(user.includes('labelsInImage'), 'figure list must include labelsInImage');
  assert.ok(
    user.includes('label-diagram-v1 only with a listed figure; set focusQuote to a sentence naming parts in that figure'),
    'figure block must state the planning rule'
  );
});
