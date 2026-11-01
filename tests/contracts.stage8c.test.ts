import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { kitGenSchemaFor } from '../packages/contracts/schemas.ts';
import { KIT_LIMITS, STAGE6_CHECKS } from '../packages/contracts/kit.ts';
import type { ComponentPlanEntry, SourceAnalysisV2 } from '../packages/contracts/kit.ts';
import type { MetaReceipt, SourceDocument } from '../packages/contracts/index.ts';
import type { ChatMessage, CompleteRequest, MetaClient } from '../packages/meta/client.ts';
import { KIT_COMPONENT_GUIDANCE, buildKitComponentMessages } from '../packages/meta/prompts-v2.ts';
import { generateKitComponent } from '../packages/meta/pipeline-v2.ts';
import { loadSource } from '../packages/sources/index.ts';

const fakeReceipt: MetaReceipt = {
  purpose: 'test-live',
  requestedModel: 'muse-spark-1.3',
  returnedModel: 'muse-spark-1.3',
  responseId: 'resp_fake_stage8c_1',
  usage: { promptTokens: 10, completionTokens: 20, reasoningTokens: 5, cachedTokens: 0 },
  latencyMs: 1,
  estCostUSD: 0.0001,
  finishReason: 'stop',
  attempts: 1
};

const FIGURE_ID = 'drag-fig-1';
const ID_LINE = `The figure attached is figureId "${FIGURE_ID}" (use exactly this figureId).`;

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`./fixtures/stage6/${name}`, import.meta.url), 'utf8'));
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

function fakeClientFor(data: unknown, requests: CompleteRequest[]): MetaClient {
  return {
    async complete<U>(req: CompleteRequest): Promise<{ data: U; receipt: MetaReceipt }> {
      requests.push(req);
      return { data: data as U, receipt: fakeReceipt };
    }
  };
}

function userMessage(req: CompleteRequest): ChatMessage {
  const last: ChatMessage | undefined = req.messages[req.messages.length - 1];
  assert.ok(last !== undefined);
  return last as ChatMessage;
}

test('stage8c checks LD-10 and LD-11', () => {
  assert.equal(STAGE6_CHECKS['LD-10'], 'labels-covered');
  assert.equal(STAGE6_CHECKS['LD-11'], 'regions-confident');
});

test('stage8c minRegionConfidence is 0.5', () => {
  assert.equal(KIT_LIMITS.labelDiagram.minRegionConfidence, 0.5);
});

test('stage8c label-diagram gen schema requires areaX1..areaY2', () => {
  const schema = kitGenSchemaFor('label-diagram-v1') as unknown as Record<string, any>;
  const parts = (schema.properties as any).parts.items as Record<string, any>;
  const required = (parts.required ?? []) as string[];
  for (const key of ['areaX1', 'areaY1', 'areaX2', 'areaY2']) {
    assert.ok(required.includes(key), `required missing ${key}: ${JSON.stringify(required)}`);
    assert.ok(((parts.properties ?? {}) as Record<string, unknown>)[key] !== undefined, `properties missing ${key}`);
  }
});

test('stage8c label-diagram prompt covers area box and printed-label coverage', () => {
  const text: string = KIT_COMPONENT_GUIDANCE['label-diagram-v1'];
  assert.ok(text.includes('area box (areaX1, areaY1, areaX2, areaY2) around ALL'));
  assert.ok(text.includes('make one part for every listed printed label whose words the page text names'));
});

test('stage8c generation message lists printedLabels when present', async () => {
  const { source, golden, analysis, plan } = labelSetup();
  const requests: CompleteRequest[] = [];
  await generateKitComponent(fakeClientFor(golden, requests), source, analysis, plan, 'test-live', {
    image: { mime: 'image/jpeg', base64: 'aGVsbG8td29ybGQ=', figureId: FIGURE_ID, printedLabels: ['Condensation', 'Snowmelt Runoff'] }
  });
  assert.equal(requests.length, 1);
  const sent = userMessage(requests[0] as CompleteRequest);
  assert.equal(typeof sent.content, 'string');
  assert.ok((sent.content as string).includes('"Condensation"; "Snowmelt Runoff"'));
});

test('stage8c generation message without printedLabels is byte-identical to [] and to before', async () => {
  const { source, golden, analysis, plan } = labelSetup();
  const base = buildKitComponentMessages(source, analysis, plan);
  const baseLast = base[base.length - 1] as ChatMessage;
  const before = `${baseLast.content}\n\n${ID_LINE}`;
  const reqAbsent: CompleteRequest[] = [];
  await generateKitComponent(fakeClientFor(golden, reqAbsent), source, analysis, plan, 'test-live', {
    image: { mime: 'image/jpeg', base64: 'aGVsbG8td29ybGQ=', figureId: FIGURE_ID }
  });
  const reqEmpty: CompleteRequest[] = [];
  await generateKitComponent(fakeClientFor(golden, reqEmpty), source, analysis, plan, 'test-live', {
    image: { mime: 'image/jpeg', base64: 'aGVsbG8td29ybGQ=', figureId: FIGURE_ID, printedLabels: [] }
  });
  const sentAbsent = userMessage(reqAbsent[0] as CompleteRequest);
  const sentEmpty = userMessage(reqEmpty[0] as CompleteRequest);
  assert.equal(sentAbsent.content, sentEmpty.content);
  assert.equal(sentAbsent.content, before);
});
