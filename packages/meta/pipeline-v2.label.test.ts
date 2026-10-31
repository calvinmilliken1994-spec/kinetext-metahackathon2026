import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadSource } from '../sources/index.ts';
import type { ComponentPlanEntry, KitGenByComponent, SourceAnalysisV2 } from '../contracts/kit.ts';
import type { MetaReceipt, SourceDocument, ValidationReport } from '../contracts/index.ts';
import type { ChatMessage, CompleteRequest, MetaClient } from './client.ts';
import {
  analyzeSourceV2,
  generateKitComponent,
  repairKitComponent
} from './pipeline-v2.ts';
import { buildAnalysisV2Messages, buildKitComponentMessages } from './prompts-v2.ts';

const fakeReceipt: MetaReceipt = {
  purpose: 'test-live',
  requestedModel: 'muse-spark-1.3',
  returnedModel: 'muse-spark-1.3',
  responseId: 'resp_fake_label_1',
  usage: { promptTokens: 10, completionTokens: 20, reasoningTokens: 5, cachedTokens: 0 },
  latencyMs: 1,
  estCostUSD: 0.0001,
  finishReason: 'stop',
  attempts: 1
};

const LABEL_FIGURE_ID = 'drag-fig-1';
const LABEL_IMAGE = { mime: 'image/jpeg', base64: 'aGVsbG8td29ybGQ=', figureId: LABEL_FIGURE_ID };
const LABEL_DATA_URL = 'data:image/jpeg;base64,aGVsbG8td29ybGQ=';
const LABEL_ID_LINE = `The figure attached is figureId "${LABEL_FIGURE_ID}" (use exactly this figureId).`;

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`../../tests/fixtures/stage6/${name}`, import.meta.url), 'utf8'));
}

function fakeClientFor(data: unknown, requests: CompleteRequest[]): MetaClient {
  return {
    async complete<U>(req: CompleteRequest): Promise<{ data: U; receipt: MetaReceipt }> {
      requests.push(req);
      return { data: data as U, receipt: fakeReceipt };
    }
  };
}

function labelSetup(): {
  source: SourceDocument;
  golden: unknown;
  analysis: SourceAnalysisV2;
  plan: ComponentPlanEntry & { componentId: 'label-diagram-v1' };
} {
  const source = loadSource('nasa-grc-drag-equation');
  const golden = loadFixture('label-diagram.gen.json');
  const parts = (golden as { parts: Array<{ quote: string; sourceId: string }> }).parts;
  const usable = loadFixture('source-analysis-v2.usable.json') as SourceAnalysisV2;
  const plan = {
    componentId: 'label-diagram-v1',
    pedagogicalReason: 'Label the parts of the diagram in teaching order.',
    focusQuote: parts[0]?.quote ?? '',
    focusSourceId: parts[0]?.sourceId ?? source.id
  } as ComponentPlanEntry & { componentId: 'label-diagram-v1' };
  const analysis = { ...usable, subject: 'biology', componentPlan: [plan] } as SourceAnalysisV2;
  return { source, golden, analysis, plan };
}

function quizSetup(): {
  source: SourceDocument;
  golden: unknown;
  analysis: SourceAnalysisV2;
  plan: ComponentPlanEntry & { componentId: 'quiz-cards-v1' };
} {
  const source = loadSource('nasa-grc-drag-equation');
  const golden = loadFixture('quiz-cards.gen.json');
  const cards = (golden as { cards: Array<{ quote: string; sourceId?: string }> }).cards;
  const usable = loadFixture('source-analysis-v2.usable.json') as SourceAnalysisV2;
  const plan = {
    componentId: 'quiz-cards-v1',
    pedagogicalReason: 'Practise the key ideas of this page.',
    focusQuote: cards[0]?.quote ?? '',
    focusSourceId: cards[0]?.sourceId ?? source.id
  } as ComponentPlanEntry & { componentId: 'quiz-cards-v1' };
  const analysis = { ...usable, componentPlan: [plan] } as SourceAnalysisV2;
  return { source, golden, analysis, plan };
}

function userMessage(req: CompleteRequest): ChatMessage {
  const last: ChatMessage | undefined = req.messages[req.messages.length - 1];
  assert.ok(last !== undefined);
  return last as ChatMessage;
}

function assertNoImages(req: CompleteRequest): void {
  for (const m of req.messages) {
    assert.equal(m.images, undefined);
    assert.equal(typeof m.content, 'string');
  }
}

function assertNoFigureIdLine(req: CompleteRequest): void {
  for (const m of req.messages) {
    assert.equal(typeof m.content, 'string');
    assert.ok(!(m.content as string).includes('figureId'));
  }
}

test('label-diagram-v1 generate sends exactly one image with the data URL and the figureId line', async () => {
  const { source, golden, analysis, plan } = labelSetup();
  const requests: CompleteRequest[] = [];
  const out = await generateKitComponent(fakeClientFor(golden, requests), source, analysis, plan, 'test-live', {
    image: LABEL_IMAGE
  });
  assert.deepEqual(out.gen, golden);
  assert.equal(requests.length, 1);
  const sent = userMessage(requests[0] as CompleteRequest);
  assert.equal(typeof sent.content, 'string');
  assert.ok(Array.isArray(sent.images));
  assert.equal(sent.images?.length, 1);
  assert.equal(sent.images?.[0]?.url, LABEL_DATA_URL);
  assert.ok((sent.content as string).includes(LABEL_ID_LINE));
  const base = buildKitComponentMessages(source, analysis, plan);
  const baseLast: ChatMessage = base[base.length - 1] as ChatMessage;
  assert.equal(sent.content, `${baseLast.content}\n\n${LABEL_ID_LINE}`);
  assert.equal(sent.role, baseLast.role);
});

test('other components never send images and never carry the figureId line', async () => {
  const { source, golden, analysis, plan } = quizSetup();
  {
    const requests: CompleteRequest[] = [];
    await generateKitComponent(fakeClientFor(golden, requests), source, analysis, plan, 'test-live', {
      image: LABEL_IMAGE
    });
    assert.equal(requests.length, 1);
    assertNoImages(requests[0] as CompleteRequest);
    assertNoFigureIdLine(requests[0] as CompleteRequest);
  }
  {
    const requests: CompleteRequest[] = [];
    await generateKitComponent(fakeClientFor(golden, requests), source, analysis, plan, 'test-live');
    assert.equal(requests.length, 1);
    assertNoImages(requests[0] as CompleteRequest);
    assertNoFigureIdLine(requests[0] as CompleteRequest);
  }
});

test('label-diagram-v1 generate without an image throws before the client is called', async () => {
  const { source, golden, analysis, plan } = labelSetup();
  const requests: CompleteRequest[] = [];
  await assert.rejects(
    generateKitComponent(fakeClientFor(golden, requests), source, analysis, plan, 'test-live'),
    /LABEL_DIAGRAM_IMAGE_REQUIRED/
  );
  assert.equal(requests.length, 0);
});

test('label-diagram-v1 repair carries the image, the figureId line, and guards the missing image', async () => {
  const { source, golden, analysis, plan } = labelSetup();
  const failing: ValidationReport = {
    artifactId: 'label-diagram-v1',
    revision: 1,
    checks: [{ id: 'LD-01', kind: 'grounding', passed: false, message: 'bad quote', affected: ['/title'] }],
    publishable: false
  };
  const validate = (_v: never, _s: SourceDocument[]): ValidationReport => ({
    artifactId: 'label-diagram-v1',
    revision: 1,
    checks: [{ id: 'LD-01', kind: 'grounding', passed: false, message: 'bad quote', affected: ['/title'] }],
    publishable: false
  });
  {
    const requests: CompleteRequest[] = [];
    const out = await repairKitComponent(
      fakeClientFor(golden, requests),
      source,
      analysis,
      plan,
      { gen: golden as KitGenByComponent['label-diagram-v1'], report: failing, attempt: 1 },
      'test-live',
      { validate: validate as never, image: LABEL_IMAGE }
    );
    assert.equal(requests.length, 1);
    const sent = userMessage(requests[0] as CompleteRequest);
    assert.equal(typeof sent.content, 'string');
    assert.ok(Array.isArray(sent.images));
    assert.equal(sent.images?.length, 1);
    assert.equal(sent.images?.[0]?.url, LABEL_DATA_URL);
    assert.ok((sent.content as string).includes(LABEL_ID_LINE));
    assert.equal(out.report.revision, 2);
    assert.deepEqual(out.authorizedPaths, ['/title']);
  }
  {
    const requests: CompleteRequest[] = [];
    await assert.rejects(
      repairKitComponent(
        fakeClientFor(golden, requests),
        source,
        analysis,
        plan,
        { gen: golden as KitGenByComponent['label-diagram-v1'], report: failing, attempt: 1 },
        'test-live',
        { validate: validate as never }
      ),
      /LABEL_DIAGRAM_IMAGE_REQUIRED/
    );
    assert.equal(requests.length, 0);
  }
});

test('repair of other components ignores a supplied image and carries no figureId line', async () => {
  const { source, golden, analysis, plan } = quizSetup();
  const failing: ValidationReport = {
    artifactId: 'quiz-cards-v1',
    revision: 1,
    checks: [{ id: 'Q-01', kind: 'grounding', passed: false, message: 'bad', affected: ['/cards/0/quote'] }],
    publishable: false
  };
  const validate = (_v: never, _s: SourceDocument[]): ValidationReport => failing;
  const requests: CompleteRequest[] = [];
  await repairKitComponent(
    fakeClientFor(golden, requests),
    source,
    analysis,
    plan,
    { gen: golden as KitGenByComponent['quiz-cards-v1'], report: failing, attempt: 1 },
    'test-live',
    { validate: validate as never, image: LABEL_IMAGE }
  );
  assert.equal(requests.length, 1);
  assertNoImages(requests[0] as CompleteRequest);
  assertNoFigureIdLine(requests[0] as CompleteRequest);
});

test('analyzeSourceV2 forwards figures to the message builder', async () => {
  const source = loadSource('nasa-grc-drag-equation');
  const usable = loadFixture('source-analysis-v2.usable.json') as SourceAnalysisV2;
  const figures = [{ id: 'fig-cell-1', caption: 'Diagram of a cell', labelsInImage: true }];
  const requests: CompleteRequest[] = [];
  const out = await analyzeSourceV2(fakeClientFor(usable, requests), source, 'test-live', { figures });
  assert.deepEqual(out.analysis, usable);
  assert.deepEqual((requests[0] as CompleteRequest).messages, buildAnalysisV2Messages(source, figures));
  const user = (requests[0] as CompleteRequest).messages[1]?.content as string;
  assert.ok(user.includes('fig-cell-1'));
  assert.ok(user.includes('label-diagram-v1 only with a listed figure'));
});
