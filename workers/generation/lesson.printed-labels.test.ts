// Stage 8c round 2 (A): the printed-label list Muse receives names ONLY the labels the page text
// names (the same rule as LD-10), so Muse is never told to cover "Snowmelt Runoff" on a page that
// only says "runoff". Real water-cycle and DNA sources + figures; fake Muse client, no SAM, no
// network, no credits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startJob } from './jobs.ts';
import { pageNamedPrintedLabels } from './lesson.ts';
import type { ChatMessage, CompleteRequest, MetaClient } from '../../packages/meta/client.ts';
import { loadFigurePrintedLabels } from '../../packages/sources/figures.ts';
import { loadSource } from '../../packages/sources/index.ts';
import type { MetaReceipt } from '../../packages/contracts/index.ts';
import type { LabelDiagramGen, SourceAnalysisV2 } from '../../packages/contracts/kit.ts';

const WATER = 'noaa-jetstream-hydrologic-cycle';
const WATER_FIGURE = 'noaa-hydrologic-cycle-1';
const DNA = 'medlineplus-what-is-dna';
const DNA_FIGURE = 'medlineplus-dna-structure-1';

test('pageNamedPrintedLabels: real water cycle keeps the four labels the page names, drops the two it never names', () => {
  const printed = loadFigurePrintedLabels(WATER_FIGURE);
  assert.deepEqual(printed, ['Condensation', 'Precipitation', 'Transpiration', 'Snowmelt Runoff', 'Evaporation', 'Surface Runoff']);
  const text = loadSource(WATER).text;
  assert.deepEqual(pageNamedPrintedLabels(printed, [text]), ['Condensation', 'Precipitation', 'Transpiration', 'Evaporation']);
});

test('pageNamedPrintedLabels: real DNA page names all six printed labels (hyphen counts as a space)', () => {
  const printed = loadFigurePrintedLabels(DNA_FIGURE);
  assert.equal(printed.length, 6);
  assert.deepEqual(pageNamedPrintedLabels(printed, [loadSource(DNA).text]), printed);
});

test('pageNamedPrintedLabels: whole phrases only, any of several texts, empty when none', () => {
  assert.deepEqual(pageNamedPrintedLabels(['Surface Runoff'], ['Runoff occurs when the ground is saturated.']), []);
  assert.deepEqual(pageNamedPrintedLabels(['Run'], ['Runoff occurs.']), [], 'a word prefix is not a phrase');
  assert.deepEqual(pageNamedPrintedLabels(['Snowmelt Runoff'], ['Spring SNOWMELT-runoff floods rivers.']), ['Snowmelt Runoff']);
  assert.deepEqual(pageNamedPrintedLabels(['Lift', 'Drag'], ['one', 'the drag force']), ['Drag']);
  assert.deepEqual(pageNamedPrintedLabels(['  ', ''], ['anything']), []);
  assert.deepEqual(pageNamedPrintedLabels([], ['anything']), []);
});

/* ------------------------------------------------------------------ */
/* Worker wiring: what the label_diagram generation call actually sees   */
/* ------------------------------------------------------------------ */

const goldenLabelGen = JSON.parse(
  readFileSync(new URL('../../tests/fixtures/stage6/label-diagram.gen.json', import.meta.url), 'utf8'),
) as LabelDiagramGen;

function receipt(id: string): MetaReceipt {
  return {
    purpose: 'test-live',
    requestedModel: 'muse-spark-1.3',
    returnedModel: 'muse-spark-1.3',
    responseId: id,
    usage: { promptTokens: 1000, completionTokens: 500, reasoningTokens: 100, cachedTokens: 0 },
    latencyMs: 10,
    estCostUSD: 0.01,
    finishReason: 'stop',
    attempts: 1,
  };
}

const waterAnalysis = {
  analysisVersion: 2,
  subject: 'earth-science',
  usable: true,
  declineCode: '',
  declineSummary: '',
  pageCoverage: 'The page explains how water moves between the ground and the air through evaporation, condensation and precipitation.',
  overview: {
    headline: 'Water circulates continuously between the ground and the atmosphere.',
    keyPoints: [
      {
        id: 'circulation',
        point: 'The hydrologic cycle is the continuous circulation of water in the Earth-Atmosphere system.',
        sourceId: WATER,
        quote: 'The hydrologic cycle involves the continuous circulation of water in the Earth-Atmosphere system',
      },
      {
        id: 'evaporation',
        point: 'Evaporation changes liquid water into a gas.',
        sourceId: WATER,
        quote: 'Evaporation is the change of state in a substance from a liquid to a gas',
      },
      {
        id: 'condensation',
        point: 'Condensation turns water vapor back into a liquid.',
        sourceId: WATER,
        quote: 'Condensation is the process whereby water vapor is changed into a liquid state',
      },
    ],
    keyTerms: [
      {
        id: 'transpiration',
        term: 'transpiration',
        gloss: 'Evaporation of water from plants through stomata.',
        sourceId: WATER,
        quote: 'Transpiration is the evaporation of water from plants through stomata',
      },
      {
        id: 'evaporation-term',
        term: 'evaporation',
        gloss: 'The change of a liquid into a gas.',
        sourceId: WATER,
        quote: 'Evaporation is the change of state in a substance from a liquid to a gas',
      },
      {
        id: 'precipitation',
        term: 'precipitation',
        gloss: 'Rain, hail, snow or sleet falling to the Earth.',
        sourceId: WATER,
        quote: 'Precipitation can be in the form of rain, hail, snow, or sleet',
      },
    ],
  },
  componentPlan: [
    {
      componentId: 'label-diagram-v1',
      pedagogicalReason: 'Students match the named parts of the water cycle diagram to the page wording.',
      focusQuote: 'Condensation is the process whereby water vapor is changed into a liquid state',
      focusSourceId: WATER,
    },
  ],
} as unknown as SourceAnalysisV2;

function capturingClient(analysis: unknown, sourceKit: unknown): { client: MetaClient; requests: { schemaName: string; messages: ChatMessage[] }[] } {
  const requests: { schemaName: string; messages: ChatMessage[] }[] = [];
  let n = 0;
  const client: MetaClient = {
    complete: async <T,>(req: CompleteRequest): Promise<{ data: T; receipt: MetaReceipt }> => {
      requests.push({ schemaName: req.schemaName, messages: structuredClone(req.messages) });
      n += 1;
      let data: unknown;
      if (req.schemaName === 'source_analysis_v2' || req.schemaName === 'source_analysis_v2_repair') {
        data = analysis;
      } else if (req.schemaName === 'label_diagram' || req.schemaName === 'label_diagram_repair') {
        data = sourceKit;
      }
      if (data === undefined) {
        throw new Error(`FAKE_MISSING_RESPONSE:${req.schemaName}`);
      }
      return { data: structuredClone(data) as T, receipt: receipt(`${req.schemaName}-${n}`) };
    },
  };
  return { client, requests };
}

async function labelGenerationMessage(sourceId: string, analysis: unknown): Promise<string> {
  const { client, requests } = capturingClient(analysis, goldenLabelGen);
  const storageDir = mkdtempSync(join(tmpdir(), 's8c-r2-printed-'));
  const { done } = startJob(
    sourceId,
    { client, storageDir, purpose: 'test-live', flow: 'lesson', newJobId: () => 'lesson-printed-00000001', limits: { maxRepairAttempts: 0 } },
    () => {},
  );
  await done;
  const gen = requests.find(r => r.schemaName === 'label_diagram');
  assert.ok(gen !== undefined, `no label_diagram call was made (calls: ${requests.map(r => r.schemaName).join(', ')})`);
  const last = gen.messages[gen.messages.length - 1] as ChatMessage;
  assert.equal(typeof last.content, 'string');
  return last.content as string;
}

test('worker: the water-cycle generation message lists only the four labels the page names', async () => {
  const sent = await labelGenerationMessage(WATER, waterAnalysis);
  assert.ok(sent.includes(`figureId "${WATER_FIGURE}"`), 'the figure line is present');
  assert.ok(
    sent.includes('"Condensation"; "Precipitation"; "Transpiration"; "Evaporation".'),
    `expected the four page-named labels, got: ${sent.slice(sent.indexOf('The figure attached'))}`,
  );
  assert.ok(!sent.includes('Snowmelt Runoff'), 'a label the page never names is not offered');
  assert.ok(!sent.includes('Surface Runoff'), 'a label the page never names is not offered');
});
