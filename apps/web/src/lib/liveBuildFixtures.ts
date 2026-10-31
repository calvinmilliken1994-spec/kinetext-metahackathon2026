// Wire-shaped job details for the live-build and replay tests. The event stream copies the shape and timing of a real
// stored run (Spark 1.3, water cycle page: label diagram with SAM 3.1 and one natural repair, plus a sequence), with
// synthetic artifacts that are just large enough for the web parsers. Not a model result.

const JOB = 'job-20261031081105-910f3776';
const T0 = Date.parse('2026-10-31T08:11:05.946Z');
const at = (s: number): string => new Date(T0 + Math.round(s * 1000)).toISOString();
const base = { jobId: JOB, model: 'muse-spark-1.3', provider: 'meta-api', providerModel: 'muse-spark-1.3' };

/** [seconds after start, fields]. Mirrors the recorded events.jsonl of the run above. */
const RAW_EVENTS: Array<[number, Record<string, unknown>]> = [
  [0.0, { stage: 'ingest', status: 'started' }],
  [0.005, { stage: 'ingest', status: 'succeeded', detail: 'sha256 03cf33515184' }],
  [0.016, { stage: 'analyze', status: 'started' }],
  [34.68, { stage: 'analyze', status: 'succeeded', latencyMs: 34660, estCostUSD: 0.04496025, usage: { promptTokens: 5902, completionTokens: 8843, reasoningTokens: 7826, cachedTokens: 0 }, detail: 'usable; checks 18/18 passed' }],
  [34.685, { stage: 'overview', status: 'succeeded', detail: 'overview ready: 2 key points, 1 key terms' }],
  [34.69, { stage: 'component', status: 'started', componentId: 'label-diagram-v1', revision: 1 }],
  [34.70, { stage: 'component', status: 'started', componentId: 'sequence-v1', revision: 1 }],
  [59.23, { stage: 'segment', status: 'started', componentId: 'label-diagram-v1', revision: 1, detail: 'sam-3.1 point segmentation of 5 part(s)' }],
  [61.10, { stage: 'segment', status: 'succeeded', componentId: 'label-diagram-v1', revision: 1, latencyMs: 1850, estCostUSD: 0.0025, detail: 'sam-3.1 returned 5 of 5 region(s)' }],
  [61.11, { stage: 'component', status: 'failed', componentId: 'label-diagram-v1', revision: 1, latencyMs: 24546, estCostUSD: 0.02845075, usage: { promptTokens: 4285, completionTokens: 5434, reasoningTokens: 5010, cachedTokens: 0 }, detail: 'failed checks: LD-04' }],
  [61.115, { stage: 'repair', status: 'started', target: 'component', componentId: 'label-diagram-v1', revision: 2, detail: 'targeted checks: LD-04' }],
  [71.19, { stage: 'component', status: 'succeeded', componentId: 'sequence-v1', revision: 1, latencyMs: 36474, estCostUSD: 0.04, usage: { promptTokens: 4000, completionTokens: 6100, reasoningTokens: 5000, cachedTokens: 0 }, detail: '6/6 checks passed' }],
  [82.00, { stage: 'segment', status: 'started', componentId: 'label-diagram-v1', revision: 2, detail: 'sam-3.1 point segmentation of 5 part(s)' }],
  [82.85, { stage: 'segment', status: 'succeeded', componentId: 'label-diagram-v1', revision: 2, latencyMs: 831, estCostUSD: 0.0025, detail: 'sam-3.1 returned 5 of 5 region(s)' }],
  [82.852, { stage: 'repair', status: 'succeeded', target: 'component', componentId: 'label-diagram-v1', revision: 2, latencyMs: 20892, estCostUSD: 0.026, usage: { promptTokens: 5200, completionTokens: 4100, reasoningTokens: 3900, cachedTokens: 0 }, detail: 'repaired revision 1' }],
  [82.855, { stage: 'component', status: 'succeeded', componentId: 'label-diagram-v1', revision: 2, detail: '11/11 checks passed' }],
  [82.86, { stage: 'done', status: 'succeeded', detail: 'lesson published: overview + 2/2 components' }],
];

export const FIXTURE_JOB_ID = JOB;
export const FIXTURE_START_MS = T0;

export function fixtureEvents(): Array<Record<string, unknown>> {
  return RAW_EVENTS.map(([s, f], seq) => ({ ...base, seq, at: at(s), ...f }));
}

const analysis = {
  analysisVersion: 2, subject: 'earth-space', usable: true, declineCode: '', declineSummary: '', pageCoverage: 'The water cycle.',
  overview: {
    headline: 'Water moves between the ocean, the air and the land.',
    keyPoints: [
      { id: 'kp-1', point: 'Water evaporates from the ocean.', sourceId: 'noaa-jetstream-hydrologic-cycle', quote: 'Water evaporates' },
      { id: 'kp-2', point: 'Clouds form when vapour condenses.', sourceId: 'noaa-jetstream-hydrologic-cycle', quote: 'vapour condenses' },
    ],
    keyTerms: [{ id: 'kt-1', term: 'Evaporation', gloss: 'Liquid to vapour.', sourceId: 'noaa-jetstream-hydrologic-cycle', quote: 'Water evaporates' }],
  },
  componentPlan: [
    { componentId: 'label-diagram-v1', pedagogicalReason: 'the page prints a labelled figure of the cycle', focusQuote: 'Water evaporates', focusSourceId: 'noaa-jetstream-hydrologic-cycle' },
    { componentId: 'sequence-v1', pedagogicalReason: 'the cycle is a sequence of stages', focusQuote: 'vapour condenses', focusSourceId: 'noaa-jetstream-hydrologic-cycle' },
  ],
};

const report = (id: string, n: number, revision: number) => ({
  artifactId: id, revision, publishable: true,
  checks: Array.from({ length: n }, (_, i) => ({ id: `X-${String(i + 1).padStart(2, '0')}`, passed: true, kind: 'semantic', message: '' })),
});

const kitSpec = (componentId: string, revision: number) => ({
  id: `${JOB}:${componentId}:r${revision}`, componentId, title: componentId === 'sequence-v1' ? 'Put the stages in order' : 'Name the parts of the cycle',
});

/** The final wire detail of the run (what GET /api/jobs/:id serves once it has finished). */
export function fixtureFinalWire(): Record<string, unknown> {
  const events = fixtureEvents();
  const repairs = [{ componentId: 'label-diagram-v1', attempt: 1, revision: 2, targeted: ['LD-04'], fixed: ['LD-04'], remaining: [], passed: true, afterInjectedFault: false }];
  return {
    summary: {
      jobId: JOB, sourceId: 'noaa-jetstream-hydrologic-cycle', status: 'succeeded', createdAt: at(0), finishedAt: at(82.87), flow: 'lesson',
      model: 'muse-spark-1.3', provider: 'meta-api', providerModel: 'muse-spark-1.3', totalCostUSD: 0.144494, reservedUnknownUSD: 0,
      revisions: 0, repairs: [], analysisRepairs: [],
      lesson: { overviewReady: true, componentsPlanned: 2, componentsPublished: 2, componentsFailed: 0, partialPublish: false },
      componentRepairs: repairs,
    },
    events,
    revisions: [],
    analysisRevisions: [],
    analysisV2Revisions: [{ revision: 1, analysis, report: report('analysis', 18, 1) }],
    analysisV2Report: report('analysis', 18, 1),
    analysisV2: analysis,
    lesson: {
      jobId: JOB, analysisRef: `${JOB}/analysis-v2.r1.json`,
      overview: { componentId: 'overview-v1', id: `${JOB}:overview-v1:r1`, headline: analysis.overview.headline, keyPoints: analysis.overview.keyPoints, keyTerms: analysis.overview.keyTerms, sources: [] },
      components: [
        { componentId: 'label-diagram-v1', specId: `${JOB}:label-diagram-v1:r2`, status: 'passed', reason: '', revision: 2 },
        { componentId: 'sequence-v1', specId: `${JOB}:sequence-v1:r1`, status: 'passed', reason: '', revision: 1 },
      ],
    },
    kitSpecs: { [`${JOB}:label-diagram-v1:r2`]: kitSpec('label-diagram-v1', 2), [`${JOB}:sequence-v1:r1`]: kitSpec('sequence-v1', 1) },
    componentReports: { [`${JOB}:label-diagram-v1:r2`]: report('ld', 11, 2), [`${JOB}:sequence-v1:r1`]: report('seq', 6, 1) },
    componentRepairs: repairs,
  };
}

/** The same run cut off at `seconds` (events only, as a running job's detail would carry them), for the beat tests. */
export function fixtureEventsUntil(seconds: number): Array<Record<string, unknown>> {
  return fixtureEvents().filter((e) => Date.parse(e.at as string) - T0 <= seconds * 1000);
}
