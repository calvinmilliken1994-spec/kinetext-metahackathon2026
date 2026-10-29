// Fixture lessons for the demo harness (?lesson-demo=1) and for tests. Pure: the raw golden JSON is passed in
// (the browser imports it with Vite, tests read it with node:fs), so this file has no node or bundler imports.
// Everything here is hand-written fixture data from tests/fixtures/stage6, NOT model output.

import type { Provenance, SourceDocument, SourceRef, TimelineActivitySpec, TimelineGeneratedSpec } from '../../../../packages/contracts/index.ts';
import { assembleTimelineSpec } from '../../../../packages/contracts/index.ts';
import { assembleKitSpec, assembleOverviewSpec, kitSpecId } from '../../../../packages/contracts/kit.ts';
import type {
  BalanceEquationGen, CompareTableGen, ConceptMapGen, FormulaExplorerGen, KitSpec, LessonSpec, QuizCardsGen, SequenceGen,
  SortGroupsGen, SourceAnalysisV2,
} from '../../../../packages/contracts/kit.ts';

export interface DemoSourceMeta { id: string; title: string; locator: string; license: string; attribution: string; sha256: string }

export interface DemoRaw {
  analysisUsable: SourceAnalysisV2;
  analysisDeclined: SourceAnalysisV2;
  quiz: QuizCardsGen;
  sequence: SequenceGen;
  sort: SortGroupsGen;
  map: ConceptMapGen;
  compare: CompareTableGen;
  formula: FormulaExplorerGen;
  balance: BalanceEquationGen;
  timeline: TimelineGeneratedSpec;
  provenance: Provenance;
  sources: Record<string, DemoSourceMeta>;
}

export interface DemoLesson {
  id: string;
  /** Tab label in the harness. */
  tab: string;
  /** One line telling the viewer what this fixture lesson shows. */
  note: string;
  lesson: LessonSpec;
  specs: Record<string, KitSpec>;
  analysis: SourceAnalysisV2 | null;
  sources: SourceRef[];
  /** A premium (timeline) spec when the lesson plan includes one. */
  premium: TimelineActivitySpec | null;
}

function docOf(meta: DemoSourceMeta): SourceDocument {
  return { ...meta, text: '' };
}

/** A three-zone version of the golden compare table, so the harness can show predict-a-cell (the golden has only two zones). */
export function threeZoneCompare(base: CompareTableGen): CompareTableGen {
  const quote = 'In the upper stratosphere the temperature increases slightly, and the pressure decreases exponentially';
  const sourceId = base.cells[0]?.sourceId ?? 'nasa-grc-earth-atmosphere-equation-english';
  return {
    ...base,
    title: 'Atmosphere zones compare (three zones)',
    entities: [...base.entities, 'upper stratosphere'],
    cells: [
      ...base.cells,
      { id: 'cell-upper-temp', entityIndex: 2, attributeIndex: 0, value: 'temperature increases slightly', sourceId, quote },
      { id: 'cell-upper-pressure', entityIndex: 2, attributeIndex: 1, value: 'pressure decreases exponentially', sourceId, quote },
    ],
  };
}

export function buildDemoLessons(raw: DemoRaw): DemoLesson[] {
  const ref = (id: string): SourceRef => {
    const { text: _text, ...r } = docOf(raw.sources[id] as DemoSourceMeta);
    return r;
  };
  const make = <T extends KitSpec>(jobId: string, spec: T): T => ({ ...spec, id: kitSpecId(jobId, spec.componentId, 1) });

  // ---- lesson 1: the drag page (overview + formula explorer + quiz + concept map) ----
  const dragJob = 'demo-drag';
  const dragDoc = [docOf(raw.sources['nasa-grc-drag-equation'] as DemoSourceMeta)];
  const dragOpts = (componentId: string) => ({ id: kitSpecId(dragJob, componentId as 'quiz-cards-v1', 1), sources: dragDoc, provenance: raw.provenance, seed: 7 });
  const dragOverview = assembleOverviewSpec(raw.analysisUsable, dragOpts('overview-v1'));
  const dragFormula = assembleKitSpec(raw.formula, 'formula-explorer-v1', dragOpts('formula-explorer-v1'));
  const dragQuiz = assembleKitSpec(raw.quiz, 'quiz-cards-v1', dragOpts('quiz-cards-v1'));
  const dragMap = assembleKitSpec(raw.map, 'concept-map-v1', dragOpts('concept-map-v1'));
  const drag: DemoLesson = {
    id: 'drag',
    tab: 'Drag equation lesson',
    note: 'Overview, a formula explorer with a live graph, quiz cards and a concept map, all from the NASA drag-equation page.',
    lesson: {
      jobId: dragJob, analysisRef: `jobs/${dragJob}/analysis.json`, overview: dragOverview,
      components: [
        { componentId: 'formula-explorer-v1', specId: dragFormula.id, status: 'passed', reason: '', revision: 1 },
        { componentId: 'quiz-cards-v1', specId: dragQuiz.id, status: 'passed', reason: '', revision: 1 },
        { componentId: 'concept-map-v1', specId: dragMap.id, status: 'passed', reason: '', revision: 1 },
      ],
    },
    specs: { [dragFormula.id]: dragFormula, [dragQuiz.id]: dragQuiz, [dragMap.id]: dragMap },
    analysis: raw.analysisUsable,
    sources: [ref('nasa-grc-drag-equation')],
    premium: null,
  };

  // ---- lesson 2: component gallery (sequence, sort, compare, balance), each from its own page ----
  const galJob = 'demo-gallery';
  const opts = (sourceId: string, componentId: string, seed: number) => ({ id: kitSpecId(galJob, componentId as 'quiz-cards-v1', 1), sources: [docOf(raw.sources[sourceId] as DemoSourceMeta)], provenance: raw.provenance, seed });
  const seq = assembleKitSpec(raw.sequence, 'sequence-v1', opts('nara-constitution', 'sequence-v1', 3));
  const sort = assembleKitSpec(raw.sort, 'sort-groups-v1', opts('nij-heterozygosity', 'sort-groups-v1', 5));
  const cmp = assembleKitSpec(threeZoneCompare(raw.compare), 'compare-table-v1', opts('nasa-grc-earth-atmosphere-equation-english', 'compare-table-v1', 11));
  const bal = assembleKitSpec(raw.balance, 'balance-equation-v1', opts('synthetic-balance', 'balance-equation-v1', 2));
  const gallery: DemoLesson = {
    id: 'gallery',
    tab: 'Component gallery',
    note: 'Sequence, sort, compare and balance-the-equation. Each component comes from a different fixture page, so there is no overview here.',
    lesson: {
      jobId: galJob, analysisRef: `jobs/${galJob}/analysis.json`, overview: null,
      components: [
        { componentId: 'sequence-v1', specId: seq.id, status: 'passed', reason: '', revision: 1 },
        { componentId: 'sort-groups-v1', specId: sort.id, status: 'passed', reason: '1 item was dropped because its quote did not support its group.', revision: 1 },
        { componentId: 'compare-table-v1', specId: cmp.id, status: 'passed', reason: '', revision: 1 },
        { componentId: 'balance-equation-v1', specId: bal.id, status: 'passed', reason: '', revision: 1 },
      ],
    },
    specs: { [seq.id]: seq, [sort.id]: sort, [cmp.id]: cmp, [bal.id]: bal },
    analysis: null,
    sources: [ref('nara-constitution'), ref('nij-heterozygosity'), ref('nasa-grc-earth-atmosphere-equation-english'), ref('synthetic-balance')],
    premium: null,
  };

  // ---- lesson 3: partial publish (one component could not be verified) ----
  const partialJob = 'demo-partial';
  const partialQuiz = assembleKitSpec(raw.quiz, 'quiz-cards-v1', { ...dragOpts('quiz-cards-v1'), id: kitSpecId(partialJob, 'quiz-cards-v1', 1) });
  const partialOverview = assembleOverviewSpec(raw.analysisUsable, { ...dragOpts('overview-v1'), id: kitSpecId(partialJob, 'overview-v1', 1) });
  const partial: DemoLesson = {
    id: 'partial',
    tab: 'Some parts left out',
    note: 'One component passed, one could not be verified against the page (nothing from it is shown), one was skipped.',
    lesson: {
      jobId: partialJob, analysisRef: `jobs/${partialJob}/analysis.json`, overview: partialOverview,
      components: [
        { componentId: 'quiz-cards-v1', specId: partialQuiz.id, status: 'passed', reason: '', revision: 1 },
        { componentId: 'formula-explorer-v1', specId: kitSpecId(partialJob, 'formula-explorer-v1', 2), status: 'failed', reason: 'FE-08: the expression does not match the quoted formula.', revision: 2 },
        { componentId: 'concept-map-v1', specId: kitSpecId(partialJob, 'concept-map-v1', 1), status: 'skipped', reason: 'Not attempted: the lesson was published after two components.', revision: 1 },
      ],
    },
    specs: { [partialQuiz.id]: partialQuiz },
    analysis: raw.analysisUsable,
    sources: [ref('nasa-grc-drag-equation')],
    premium: null,
  };

  // ---- lesson 4: declined page ----
  const declined: DemoLesson = {
    id: 'declined',
    tab: 'Declined page',
    note: 'A page the analysis declined (too short). The teacher still sees what the page covered and why nothing was built.',
    lesson: { jobId: 'demo-declined', analysisRef: 'jobs/demo-declined/analysis.json', overview: null, components: [] },
    specs: {},
    analysis: raw.analysisDeclined,
    sources: [ref('nasa-grc-drag-equation')],
    premium: null,
  };

  // ---- lesson 5: premium timeline mounted through ActivityPanel beside an overview ----
  const tlJob = 'demo-timeline';
  const tlSource = docOf(raw.sources['nara-declaration-of-independence'] as DemoSourceMeta);
  const timeline = assembleTimelineSpec(raw.timeline, { id: `${tlJob}:timeline-v1:r1`, sources: [tlSource], provenance: raw.provenance });
  const tlQuotes = [
    raw.timeline.explanations[0]?.evidence[0],
    raw.timeline.explanations[0]?.evidence[1],
    raw.timeline.explanations[1]?.evidence[0],
  ].filter((e): e is { sourceId: string; quote: string } => e !== undefined);
  const tlPoints = [
    'Congress adopted the Declaration on July 4, 1776.',
    'Delegates began signing the engrossed copy about a month later.',
    'A committee of five drafted it, and Jefferson did the writing.',
  ];
  const tlAnalysis: SourceAnalysisV2 = {
    analysisVersion: 2, subject: 'history', usable: true, declineCode: '', declineSummary: '',
    pageCoverage: 'The page follows the Declaration of Independence from the committee of five to the signing.',
    overview: {
      headline: 'Adopting and signing the Declaration were separate events.',
      keyPoints: tlQuotes.map((q, i) => ({ id: `point-${i + 1}`, point: tlPoints[i] ?? '', sourceId: q.sourceId, quote: q.quote })),
      keyTerms: tlQuotes.slice(0, 3).map((q, i) => ({
        id: `term-${i + 1}`, term: ['adopted', 'signing', 'Jefferson'][i] ?? '', gloss: ['Formally approved by Congress.', 'Delegates putting their names to the copy.', 'The delegate given the actual writing.'][i] ?? '',
        sourceId: q.sourceId, quote: q.quote,
      })),
    },
    componentPlan: [],
  };
  const tlOverview = assembleOverviewSpec(tlAnalysis, { id: kitSpecId(tlJob, 'overview-v1', 1), sources: [tlSource], provenance: raw.provenance, seed: 1 });
  const premium: DemoLesson = {
    id: 'premium',
    tab: 'With a timeline',
    note: 'A premium timeline activity mounted through the existing ActivityPanel under an overview.',
    lesson: {
      jobId: tlJob, analysisRef: `jobs/${tlJob}/analysis.json`, overview: tlOverview,
      components: [{ componentId: 'timeline-v1', specId: timeline.id, status: 'passed', reason: '', revision: 1 }],
    },
    specs: {},
    analysis: tlAnalysis,
    sources: [{ ...(({ text: _t, ...r }) => r)(tlSource) }],
    premium: timeline,
  };

  return [drag, gallery, partial, declined, premium];
}
