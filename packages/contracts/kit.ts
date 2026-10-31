// Stage 6 kit contracts v0.6.0 + Stage 8a subject engines + Stage 8b label-diagram — frozen by the lead from `docs/specs/STAGE-6-design.md` + addendum + `docs/specs/STAGE-8a-subject-engines.md` + `docs/specs/STAGE-8b-label-diagram.md`.
// Stage 6 check count: 101 checks — 92 + 9 (63 + 7 ALG + 7 LOG + 7 TH + 8 DT + 9 LD). KIT_SCHEMA_VERSION stays 0.6.0: existing shapes unchanged.
// Runtime: Node 24 type stripping, so only erasable TypeScript syntax (no enums, namespaces or parameter properties).
// Browser-safe: no node:* imports; structuredClone only.
import type { Execution, Provenance, SourceDocument, SourceRef } from './index.ts';
import { ACTIVITY_IDS } from './engines.ts';

export const KIT_SCHEMA_VERSION = '0.6.0';
export type KitSchemaVersion = typeof KIT_SCHEMA_VERSION;

export const SUBJECTS = ['physics', 'maths', 'computing', 'history', 'finance', 'chemistry', 'biology', 'earth-science', 'civics', 'language-reading', 'other'] as const;
export type Subject = typeof SUBJECTS[number];
export function isSubject(v: unknown): v is Subject {
  return typeof v === 'string' && (SUBJECTS as readonly string[]).includes(v);
}

export const DECLINE_CODES = ['too-short', 'not-prose', 'boilerplate-only', 'no-teachable-content', 'unreadable', 'prompt-injection-only'] as const;
export type DeclineCode = typeof DECLINE_CODES[number];

export const KIT_COMPONENT_IDS = ['overview-v1', 'quiz-cards-v1', 'sequence-v1', 'sort-groups-v1', 'concept-map-v1', 'compare-table-v1', 'formula-explorer-v1', 'balance-equation-v1', 'algorithm-trace-v1', 'log-ladder-v1', 'threshold-v1', 'data-table-v1', 'label-diagram-v1'] as const;
export type KitComponentId = typeof KIT_COMPONENT_IDS[number];
export function isKitComponentId(v: unknown): v is KitComponentId {
  return typeof v === 'string' && (KIT_COMPONENT_IDS as readonly string[]).includes(v);
}

export const KIT_GEN_COMPONENT_IDS = ['quiz-cards-v1', 'sequence-v1', 'sort-groups-v1', 'concept-map-v1', 'compare-table-v1', 'formula-explorer-v1', 'balance-equation-v1', 'algorithm-trace-v1', 'log-ladder-v1', 'threshold-v1', 'data-table-v1', 'label-diagram-v1'] as const;
export type KitGenComponentId = typeof KIT_GEN_COMPONENT_IDS[number];
export function isKitGenComponentId(v: unknown): v is KitGenComponentId {
  return typeof v === 'string' && (KIT_GEN_COMPONENT_IDS as readonly string[]).includes(v);
}

export const PLAN_COMPONENT_IDS = [...KIT_GEN_COMPONENT_IDS, ...ACTIVITY_IDS] as const;
export type PlanComponentId = KitGenComponentId | typeof ACTIVITY_IDS[number];
export function isPlanComponentId(v: unknown): v is PlanComponentId {
  return typeof v === 'string' && (PLAN_COMPONENT_IDS as readonly string[]).includes(v);
}

export const KIT_GEN_SCHEMA_FILES: Readonly<Record<KitGenComponentId, string>> = {
  'quiz-cards-v1': 'quiz-cards.gen.json',
  'sequence-v1': 'sequence.gen.json',
  'sort-groups-v1': 'sort-groups.gen.json',
  'concept-map-v1': 'concept-map.gen.json',
  'compare-table-v1': 'compare-table.gen.json',
  'formula-explorer-v1': 'formula-explorer.gen.json',
  'balance-equation-v1': 'balance-equation.gen.json',
  'algorithm-trace-v1': 'algorithm-trace.gen.json',
  'log-ladder-v1': 'log-ladder.gen.json',
  'threshold-v1': 'threshold.gen.json',
  'data-table-v1': 'data-table.gen.json',
  'label-diagram-v1': 'label-diagram.gen.json'
};
export const SOURCE_ANALYSIS_V2_GEN_SCHEMA_FILE = 'source-analysis-v2.gen.json';

export const CONCEPT_MAP_RELATIONS = ['causes', 'needs', 'is part of', 'uses', 'follows', 'contrasts with'] as const;
export type ConceptMapRelation = typeof CONCEPT_MAP_RELATIONS[number];

export const SEQUENCE_ORDER_BASES = ['numbered', 'page-order'] as const;
export type SequenceOrderBasis = typeof SEQUENCE_ORDER_BASES[number];

export const BALANCE_SIDES = ['left', 'right'] as const;
export type BalanceSide = typeof BALANCE_SIDES[number];

export const ALGORITHM_IDS = ['binary-search', 'linear-search', 'bubble-sort', 'insertion-sort', 'selection-sort', 'merge-sort', 'quicksort'] as const;
export type AlgorithmId = typeof ALGORITHM_IDS[number];
export function isAlgorithmId(v: unknown): v is AlgorithmId {
  return typeof v === 'string' && (ALGORITHM_IDS as readonly string[]).includes(v);
}

export const SEARCH_ALGORITHM_IDS = ['binary-search', 'linear-search'] as const;
export type SearchAlgorithmId = typeof SEARCH_ALGORITHM_IDS[number];
export function isSearchAlgorithmId(v: unknown): v is SearchAlgorithmId {
  return typeof v === 'string' && (SEARCH_ALGORITHM_IDS as readonly string[]).includes(v);
}

export const ALGORITHM_CLAIM_KINDS = ['running-time', 'property'] as const;
export type AlgorithmClaimKind = typeof ALGORITHM_CLAIM_KINDS[number];
export function isAlgorithmClaimKind(v: unknown): v is AlgorithmClaimKind {
  return typeof v === 'string' && (ALGORITHM_CLAIM_KINDS as readonly string[]).includes(v);
}

export const THRESHOLD_RULES = ['majority', 'fraction', 'count'] as const;
export type ThresholdRule = typeof THRESHOLD_RULES[number];
export function isThresholdRule(v: unknown): v is ThresholdRule {
  return typeof v === 'string' && (THRESHOLD_RULES as readonly string[]).includes(v);
}

export const DATA_TABLE_QUESTION_KINDS = ['lookup', 'largest', 'smallest'] as const;
export type DataTableQuestionKind = typeof DATA_TABLE_QUESTION_KINDS[number];
export function isDataTableQuestionKind(v: unknown): v is DataTableQuestionKind {
  return typeof v === 'string' && (DATA_TABLE_QUESTION_KINDS as readonly string[]).includes(v);
}

export const KIT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const FORMULA_VAR_NAME_PATTERN = /^[a-z][a-z0-9_]{0,11}$/;
export const FORMULA_FUNCTIONS = ['sqrt', 'exp', 'log', 'sin', 'cos', 'tan'] as const;
export const FORMULA_CONSTANTS = ['pi', 'e'] as const;
export const FORMULA_RESERVED_NAMES = [...FORMULA_FUNCTIONS, ...FORMULA_CONSTANTS] as const;

export const KIT_LIMITS = {
  analysis: {
    declineSummary: { min: 10, max: 280 },
    pageCoverage: { min: 10, max: 300 },
    headline: { min: 10, max: 120 },
    keyPoints: { min: 3, max: 6 },
    keyTerms: { min: 3, max: 8 },
    componentPlan: { min: 1, max: 3 },
    point: { min: 10, max: 200 },
    term: { min: 1, max: 40 },
    gloss: { min: 5, max: 120 },
    pedagogicalReason: { min: 10, max: 160 },
    stubChars: 300
  },
  common: {
    quote: { min: 1, max: 150 },
    idMaxChars: 40
  },
  quiz: {
    cards: { min: 3, max: 5 },
    options: { min: 3, max: 4 },
    stem: { min: 10, max: 160 },
    option: { min: 1, max: 80 },
    hint: { min: 5, max: 120 }
  },
  sequence: {
    steps: { min: 4, max: 8 },
    label: { min: 1, max: 80 },
    orderNote: { min: 5, max: 120 }
  },
  sort: {
    groups: { min: 2, max: 4 },
    items: { min: 6, max: 12 },
    groupLabel: { min: 1, max: 40 },
    itemLabel: { min: 1, max: 60 },
    minItemsPerGroup: 2
  },
  conceptMap: {
    nodes: { min: 4, max: 8 },
    links: { min: 3, max: 10 }
  },
  compare: {
    entities: { min: 2, max: 4 },
    attributes: { min: 2, max: 5 },
    cells: { min: 4, max: 20 },
    value: { min: 1, max: 80 }
  },
  formulaExplorer: {
    variables: { min: 2, max: 4 },
    cases: { min: 1, max: 4 },
    expressionMaxChars: 120,
    astMaxNodes: 50,
    exponentAbsMax: 100,
    sliderRatioMax: 1e6,
    tolerance: { min: 1e-9, max: 0.25 },
    samples: 101
  },
  balance: {
    species: { min: 2, max: 5 },
    elements: { min: 1, max: 8 },
    atomsPerSpeciesMax: 40,
    coefficient: { min: 1, max: 12 },
    subscript: { min: 1, max: 999 },
    parenDepthMax: 2
  },
  algorithm: {
    input: { min: 4, max: 10 },
    value: { min: 0, max: 99 },
    claims: { min: 0, max: 3 },
    claimText: { min: 1, max: 80 },
    name: { min: 1, max: 60 },
    maxFrames: 400
  },
  logLadder: {
    rungs: { min: 2, max: 8 },
    cases: { min: 1, max: 3 },
    factor: { min: 1.000001, max: 1000 },
    label: { min: 1, max: 60 },
    maxRatio: 1e12
  },
  threshold: {
    stages: { min: 1, max: 3 },
    scenarios: { min: 1, max: 3 },
    total: { min: 1, max: 100000 },
    body: { min: 1, max: 60 },
    label: { min: 1, max: 80 }
  },
  dataTable: {
    columns: { min: 2, max: 6 },
    rows: { min: 3, max: 12 },
    questions: { min: 1, max: 4 },
    header: { min: 1, max: 40 },
    unit: { min: 0, max: 20 },
    label: { min: 1, max: 60 },
    value: { min: 1, max: 40 }
  },
  labelDiagram: {
    parts: { min: 3, max: 8 },
    name: { min: 1, max: 40 },
    coordMax: 1000,
    maxRegionAreaFraction: 0.5,
    minRegionAreaFraction: 0.0005,
    maxRegionOverlapIoU: 0.6,
    // Stage 8b live run (lead): SAM boxes hug thin arrows and strands, so LD-06 accepts a point within this
    // fraction of the image's longer side outside its region box (12 px on a 600 px figure).
    pointToleranceFraction: 0.02
  }
} as const;

export interface SourceAnalysisV2 {
  analysisVersion: 2;
  subject: Subject;
  usable: boolean;
  declineCode: DeclineCode | '';
  declineSummary: string;
  pageCoverage: string;
  overview: OverviewGen;
  componentPlan: ComponentPlanEntry[];
}
export interface OverviewGen {
  headline: string;
  keyPoints: KeyPointGen[];
  keyTerms: KeyTermGen[];
}
export interface KeyPointGen {
  id: string;
  point: string;
  sourceId: string;
  quote: string;
}
export interface KeyTermGen {
  id: string;
  term: string;
  gloss: string;
  sourceId: string;
  quote: string;
}
export interface ComponentPlanEntry {
  componentId: PlanComponentId;
  pedagogicalReason: string;
  focusQuote: string;
  focusSourceId: string;
}

export interface QuizCardsGen {
  schemaVersion: 'quiz-cards-v1';
  title: string;
  cards: QuizCardGen[];
}
export interface QuizCardGen {
  id: string;
  stem: string;
  options: string[];
  sourceId: string;
  quote: string;
  hint: string;
}
export interface SequenceGen {
  schemaVersion: 'sequence-v1';
  title: string;
  orderBasis: SequenceOrderBasis;
  cyclic: boolean;
  orderNote: string;
  steps: SequenceStepGen[];
}
export interface SequenceStepGen {
  id: string;
  label: string;
  sourceId: string;
  quote: string;
  orderHint: string;
}
export interface SortGroupsGen {
  schemaVersion: 'sort-groups-v1';
  title: string;
  groups: SortGroupGen[];
  items: SortItemGen[];
}
export interface SortGroupGen {
  id: string;
  label: string;
}
export interface SortItemGen {
  id: string;
  label: string;
  groupId: string;
  sourceId: string;
  quote: string;
}
export interface ConceptMapGen {
  schemaVersion: 'concept-map-v1';
  title: string;
  nodes: MapNodeGen[];
  links: MapLinkGen[];
}
export interface MapNodeGen {
  id: string;
  label: string;
}
export interface MapLinkGen {
  id: string;
  fromId: string;
  toId: string;
  relation: ConceptMapRelation;
  sourceId: string;
  quote: string;
}
export interface CompareTableGen {
  schemaVersion: 'compare-table-v1';
  title: string;
  attributes: string[];
  rows: CompareRowGen[];
}
export interface CompareRowGen {
  entity: string;
  values: CompareValueGen[];
}
export interface CompareValueGen {
  value: string;
  sourceId: string;
  quote: string;
}
export interface CompareCellGen {
  id: string;
  entityIndex: number;
  attributeIndex: number;
  value: string;
  sourceId: string;
  quote: string;
}
/** Build the spec grid from a compare-table gen: entities in row order, one cell per row x column slot that has a value. Never invents, pads or drops content; never mutates the input. */
export function compareGridFromRows(gen: CompareTableGen): { entities: string[]; cells: CompareCellGen[] } {
  const entities: string[] = gen.rows.map((r) => r.entity);
  const cells: CompareCellGen[] = [];
  for (let i = 0; i < gen.rows.length; i++) {
    const row: CompareRowGen = gen.rows[i] as CompareRowGen;
    const values: CompareValueGen[] = row.values;
    for (let j = 0; j < values.length; j++) {
      const v: CompareValueGen | undefined = values[j] as CompareValueGen | undefined;
      if (v === undefined) continue;
      cells.push({
        id: 'cell-' + String(i) + '-' + String(j),
        entityIndex: i,
        attributeIndex: j,
        value: v.value,
        sourceId: v.sourceId,
        quote: v.quote
      });
    }
  }
  return { entities, cells };
}
export interface FormulaExplorerGen {
  schemaVersion: 'formula-explorer-v1';
  title: string;
  formulaText: string;
  sourceId: string;
  quote: string;
  expression: string;
  variables: FormulaVarGen[];
  xVariable: string;
  cases: FormulaCaseGen[];
  sourceExample: FormulaSourceExampleGen;
  hasSourceExample: boolean;
}
export interface FormulaVarGen {
  name: string;
  pageSymbol: string;
  meaning: string;
  meaningQuoted: boolean;
  /** Verbatim span of the explorer's `sourceId` source */
  quote: string;
  unit: string;
  min: number;
  max: number;
  default: number;
}
export interface FormulaCaseGen {
  id: string;
  inputs: FormulaInputGen[];
}
export interface FormulaInputGen {
  name: string;
  value: number;
}
export interface FormulaSourceExampleGen {
  /** Verbatim span of the explorer's `sourceId` source */
  quote: string;
  resultNumber: number;
  tolerance: number;
}
export interface BalanceEquationGen {
  schemaVersion: 'balance-equation-v1';
  title: string;
  equationText: string;
  sourceId: string;
  quote: string;
  species: BalanceSpeciesGen[];
  hint: string;
}
export interface BalanceSpeciesGen {
  id: string;
  formula: string;
  side: BalanceSide;
  sourceId: string;
  quote: string;
}
export interface AlgorithmTraceGen {
  schemaVersion: 'algorithm-trace-v1';
  title: string;
  algorithm: AlgorithmId;
  algorithmName: string;
  sourceId: string;
  quote: string;
  input: number[];
  hasTarget: boolean;
  target: number;
  claims: AlgorithmClaimGen[];
}
export interface AlgorithmClaimGen {
  id: string;
  kind: 'running-time' | 'property';
  text: string;
  sourceId: string;
  quote: string;
}
export interface LogLadderGen {
  schemaVersion: 'log-ladder-v1';
  title: string;
  quantity: string;
  factor: number;
  factorText: string;
  effectPhrase: string;
  increasing: boolean;
  sourceId: string;
  quote: string;
  rungs: LogRungGen[];
  cases: LogCaseGen[];
}
export interface LogRungGen {
  id: string;
  label: string;
  value: number;
  sourceId: string;
  quote: string;
}
export interface LogCaseGen {
  id: string;
  fromValue: number;
  toValue: number;
}
export interface ThresholdGen {
  schemaVersion: 'threshold-v1';
  title: string;
  stages: ThresholdStageGen[];
  scenarios: ThresholdScenarioGen[];
}
export interface ThresholdStageGen {
  id: string;
  body: string;
  total: number;
  rule: 'majority' | 'fraction' | 'count';
  numerator: number;
  denominator: number;
  statedCount: number;
  sourceId: string;
  quote: string;
  totalQuote: string;
}
export interface ThresholdScenarioGen {
  id: string;
  label: string;
  yes: number[];
}
export interface DataTableGen {
  schemaVersion: 'data-table-v1';
  title: string;
  labelHeader: string;
  columns: DataColumnGen[];
  rows: DataRowGen[];
  questions: DataQuestionGen[];
  chartColumnIndex: number;
  brackets: DataBracketsGen;
}
export interface DataColumnGen {
  header: string;
  unit: string;
  numeric: boolean;
  sourceId: string;
  quote: string;
}
export interface DataRowGen {
  label: string;
  sourceId: string;
  quote: string;
  values: DataCellGen[];
}
export interface DataCellGen {
  value: string;
  sourceId: string;
  quote: string;
}
export interface DataQuestionGen {
  id: string;
  kind: 'lookup' | 'largest' | 'smallest';
  rowIndex: number;
  columnIndex: number;
}
export interface DataBracketsGen {
  enabled: boolean;
  rateColumnIndex: number;
  overColumnIndex: number;
  exampleIncome: number;
}
export interface LabelDiagramGen {
  schemaVersion: 'label-diagram-v1';
  title: string;
  figureId: string;
  parts: LabelPartGen[];
  hint: string;
}
export interface LabelPartGen {
  id: string;
  name: string;
  sourceId: string;
  quote: string;
  x: number;
  y: number;
  labelX1: number;
  labelY1: number;
  labelX2: number;
  labelY2: number;
}
export interface LabelFigureRef {
  id: string;
  width: number;
  height: number;
  caption: string;
  credit: string;
  license: string;
  labelsInImage: boolean;
}
export interface LabelRegion {
  partId: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  confidence: number | null;
}

export interface KitGenByComponent {
  'quiz-cards-v1': QuizCardsGen;
  'sequence-v1': SequenceGen;
  'sort-groups-v1': SortGroupsGen;
  'concept-map-v1': ConceptMapGen;
  'compare-table-v1': CompareTableGen;
  'formula-explorer-v1': FormulaExplorerGen;
  'balance-equation-v1': BalanceEquationGen;
  'algorithm-trace-v1': AlgorithmTraceGen;
  'log-ladder-v1': LogLadderGen;
  'threshold-v1': ThresholdGen;
  'data-table-v1': DataTableGen;
  'label-diagram-v1': LabelDiagramGen;
}

/** System-owned base fields shared by every kit spec. */
export interface KitSpecBase<C extends KitComponentId = KitComponentId> {
  schemaVersion: KitSchemaVersion;
  id: string;
  componentId: C;
  title: string;
  sources: SourceRef[];
  execution: Execution;
  provenance: Provenance;
  seed: number;
}
export interface OverviewSpec extends KitSpecBase<'overview-v1'> {
  headline: string;
  keyPoints: KeyPointGen[];
  keyTerms: KeyTermGen[];
}
export interface QuizCardsSpec extends KitSpecBase<'quiz-cards-v1'> {
  cards: QuizCardGen[];
}
export interface SequenceSpec extends KitSpecBase<'sequence-v1'> {
  orderBasis: SequenceOrderBasis;
  cyclic: boolean;
  orderNote: string;
  steps: SequenceStepGen[];
}
export interface SortGroupsSpec extends KitSpecBase<'sort-groups-v1'> {
  groups: SortGroupGen[];
  items: SortItemGen[];
}
export interface ConceptMapSpec extends KitSpecBase<'concept-map-v1'> {
  nodes: MapNodeGen[];
  links: MapLinkGen[];
}
export interface CompareTableSpec extends KitSpecBase<'compare-table-v1'> {
  entities: string[];
  attributes: string[];
  cells: CompareCellGen[];
}
export interface FormulaExplorerSpec extends KitSpecBase<'formula-explorer-v1'> {
  formulaText: string;
  sourceId: string;
  quote: string;
  expression: string;
  variables: FormulaVarGen[];
  xVariable: string;
  cases: FormulaCaseGen[];
  sourceExample: FormulaSourceExampleGen;
  hasSourceExample: boolean;
}
export interface BalanceEquationSpec extends KitSpecBase<'balance-equation-v1'> {
  equationText: string;
  sourceId: string;
  quote: string;
  species: BalanceSpeciesGen[];
  hint: string;
}
export interface AlgorithmTraceSpec extends KitSpecBase<'algorithm-trace-v1'> {
  algorithm: AlgorithmId;
  algorithmName: string;
  sourceId: string;
  quote: string;
  input: number[];
  hasTarget: boolean;
  target: number;
  claims: AlgorithmClaimGen[];
}
export interface LogLadderSpec extends KitSpecBase<'log-ladder-v1'> {
  quantity: string;
  factor: number;
  factorText: string;
  effectPhrase: string;
  increasing: boolean;
  sourceId: string;
  quote: string;
  rungs: LogRungGen[];
  cases: LogCaseGen[];
}
export interface ThresholdSpec extends KitSpecBase<'threshold-v1'> {
  stages: ThresholdStageGen[];
  scenarios: ThresholdScenarioGen[];
}
export interface DataTableSpec extends KitSpecBase<'data-table-v1'> {
  labelHeader: string;
  columns: DataColumnGen[];
  rows: DataRowGen[];
  questions: DataQuestionGen[];
  chartColumnIndex: number;
  brackets: DataBracketsGen;
}
export interface LabelDiagramSpec extends KitSpecBase<'label-diagram-v1'> {
  figureId: string;
  parts: LabelPartGen[];
  hint: string;
  figure: LabelFigureRef;
  regions: LabelRegion[];
}
export interface KitSpecByComponent {
  'overview-v1': OverviewSpec;
  'quiz-cards-v1': QuizCardsSpec;
  'sequence-v1': SequenceSpec;
  'sort-groups-v1': SortGroupsSpec;
  'concept-map-v1': ConceptMapSpec;
  'compare-table-v1': CompareTableSpec;
  'formula-explorer-v1': FormulaExplorerSpec;
  'balance-equation-v1': BalanceEquationSpec;
  'algorithm-trace-v1': AlgorithmTraceSpec;
  'log-ladder-v1': LogLadderSpec;
  'threshold-v1': ThresholdSpec;
  'data-table-v1': DataTableSpec;
  'label-diagram-v1': LabelDiagramSpec;
}
export type KitSpec = OverviewSpec | QuizCardsSpec | SequenceSpec | SortGroupsSpec | ConceptMapSpec | CompareTableSpec | FormulaExplorerSpec | BalanceEquationSpec | AlgorithmTraceSpec | LogLadderSpec | ThresholdSpec | DataTableSpec | LabelDiagramSpec;

export const LESSON_COMPONENT_STATUSES = ['passed', 'failed', 'skipped'] as const;
export type LessonComponentStatus = typeof LESSON_COMPONENT_STATUSES[number];
export interface LessonComponentEntry {
  componentId: PlanComponentId;
  specId: string;
  status: LessonComponentStatus;
  reason: string;
  revision: number;
}
/** Lesson assembly: overview plus ordered component entries. */
export interface LessonSpec {
  jobId: string;
  analysisRef: string;
  overview: OverviewSpec | null;
  components: LessonComponentEntry[];
}

/** Stage 6 check names by id; A-02 and BAL-06 retired: reserved, never reused, always pass.
 * SEQ-02 `labels-in-quotes` was retired and REMOVED from the published list (Stage 7e,
 * docs/specs/STAGE-7e-library-and-wording.md option (a): step labels are AI-written short event
 * names, grounded by their step's verbatim quote); unlike A-02/BAL-06 it is NOT emitted as an
 * always-pass stub, and the id is never reused. Sequence ids keep their numbers (SEQ-01,
 * SEQ-03..SEQ-06) so stored evidence stays readable. Stage 8a appends ALG/LOG/TH/DT checks (92 total).
 * Stage 8b appends LD checks (101 checks — 92 + 9). */
export const STAGE6_CHECKS = {
  'A-01': 'version-is-2',
  'A-02': 'mirrors-agree',
  'A-03': 'subject-valid',
  'A-04': 'decline-integrity',
  'A-05': 'overview-quotes-verbatim',
  'A-06': 'quote-sourceids',
  'A-07': 'counts-in-range',
  'A-08': 'plan-rules',
  'A-09': 'no-publisher-claim',
  'A-10': 'ai-numbers-checkable',
  'A-11': 'plain-text',
  'OV-01': 'quotes-verbatim',
  'OV-02': 'term-in-quote',
  'OV-03': 'no-publisher-text',
  'OV-04': 'numbers-checkable',
  'OV-05': 'counts-valid',
  'OV-06': 'point-quote-overlap',
  'Q-01': 'quote-verbatim',
  'Q-02': 'answer-in-quote',
  'Q-03': 'options-distinct',
  'Q-04': 'stem-no-answer-leak',
  'Q-05': 'one-correct',
  'Q-06': 'numbers-checkable',
  'Q-07': 'distractors-not-in-quote',
  'SEQ-01': 'quotes-verbatim',
  'SEQ-03': 'order-basis-holds',
  'SEQ-04': 'distinct-steps',
  'SEQ-05': 'count-valid',
  'SEQ-06': 'numbers-checkable',
  'SORT-01': 'quotes-verbatim',
  'SORT-02': 'item-and-group-in-quote',
  'SORT-03': 'groups-covered',
  'SORT-04': 'distinct-items',
  'SORT-05': 'counts-valid',
  'SORT-06': 'numbers-checkable',
  'CM-01': 'quotes-verbatim',
  'CM-02': 'endpoints-in-quote',
  'CM-03': 'relation-in-quote',
  'CM-04': 'graph-connected',
  'CM-05': 'counts-valid',
  'CM-06': 'numbers-checkable',
  'CT-01': 'quotes-verbatim',
  'CT-02': 'cell-in-quote',
  'CT-03': 'shape-valid',
  'CT-04': 'numbers-checkable',
  'CT-05': 'predict-cell-valid',
  'FE-01': 'formula-quoted',
  'FE-02': 'expression-parses',
  'FE-03': 'variables-declared',
  'FE-04': 'cases-recomputed',
  'FE-05': 'sourceExample-check',
  'FE-06': 'ranges-sane',
  'FE-07': 'numbers-checkable',
  'FE-08': 'expression-matches-page-formula',
  'BAL-01': 'equation-quoted',
  'BAL-02': 'formulas-parse',
  'BAL-03': 'atom-balance-exact',
  'BAL-04': 'lowest-terms',
  'BAL-05': 'solution-exists',
  'BAL-06': 'coefficient-shape',
  'BAL-07': 'numbers-checkable',
  'BAL-08': 'unique-up-to-scale',
  'BAL-09': 'species-quote-verbatim',
  'ALG-01': 'quotes-verbatim',
  'ALG-02': 'algorithm-named-in-quote',
  'ALG-03': 'input-valid',
  'ALG-04': 'trace-runs',
  'ALG-05': 'claims-in-quote',
  'ALG-06': 'numbers-checkable',
  'ALG-07': 'counts-valid',
  'LOG-01': 'quotes-verbatim',
  'LOG-02': 'factor-stated',
  'LOG-03': 'quantity-in-quote',
  'LOG-04': 'rung-values-in-quote',
  'LOG-05': 'rungs-distinct',
  'LOG-06': 'cases-valid',
  'LOG-07': 'numbers-checkable',
  'TH-01': 'quotes-verbatim',
  'TH-02': 'total-in-quote',
  'TH-03': 'rule-in-quote',
  'TH-04': 'stated-count-consistent',
  'TH-05': 'scenarios-valid',
  'TH-06': 'numbers-checkable',
  'TH-07': 'counts-valid',
  'DT-01': 'quotes-verbatim',
  'DT-02': 'headers-and-labels-in-quote',
  'DT-03': 'values-in-quote',
  'DT-04': 'shape-valid',
  'DT-05': 'questions-valid',
  'DT-06': 'chart-valid',
  'DT-07': 'brackets-valid',
  'DT-08': 'numbers-checkable',
  'LD-01': 'quotes-verbatim',
  'LD-02': 'name-in-quote',
  'LD-03': 'figure-valid',
  'LD-04': 'points-valid',
  'LD-05': 'label-boxes-valid',
  'LD-06': 'regions-found',
  'LD-07': 'regions-distinct',
  'LD-08': 'numbers-checkable',
  'LD-09': 'counts-valid'
} as const;
export type Stage6CheckId = keyof typeof STAGE6_CHECKS;
export const STAGE6_CHECK_IDS: readonly Stage6CheckId[] = Object.keys(STAGE6_CHECKS) as unknown as readonly Stage6CheckId[];
export const RETIRED_STAGE6_CHECK_IDS = ['A-02', 'BAL-06'] as const;
export const ANALYSIS_V2_REPAIRABLE_CHECK_IDS = ['A-04', 'A-05', 'A-06', 'A-07', 'A-08', 'A-10'] as const;
export const CHECK_PREFIX_BY_COMPONENT = {
  'analysis': 'A',
  'overview-v1': 'OV',
  'quiz-cards-v1': 'Q',
  'sequence-v1': 'SEQ',
  'sort-groups-v1': 'SORT',
  'concept-map-v1': 'CM',
  'compare-table-v1': 'CT',
  'formula-explorer-v1': 'FE',
  'balance-equation-v1': 'BAL',
  'algorithm-trace-v1': 'ALG',
  'log-ladder-v1': 'LOG',
  'threshold-v1': 'TH',
  'data-table-v1': 'DT',
  'label-diagram-v1': 'LD'
} as const;
export function checkIdsFor(target: 'analysis' | KitComponentId): Stage6CheckId[] {
  const prefix = CHECK_PREFIX_BY_COMPONENT[target];
  return STAGE6_CHECK_IDS.filter((id) => id.slice(0, id.lastIndexOf('-')) === prefix);
}

export interface KitAssembleOptions {
  id: string;
  sources: SourceDocument[];
  provenance: Provenance;
  seed: number;
  execution?: Execution;
}
export const KIT_DEFAULT_EXECUTION: Execution = Object.freeze({ maxWallTimeMs: 2000, maxRepairAttempts: 2, network: false, generatedCodeAllowed: false } as Execution) as Execution;
export function kitSpecId(jobId: string, componentId: KitComponentId, revision: number): string {
  return jobId + ':' + componentId + ':r' + String(revision);
}
export const KIT_GEN_BODY_KEYS: Readonly<Record<KitGenComponentId, readonly string[]>> = {
  'quiz-cards-v1': ['cards'],
  'sequence-v1': ['orderBasis', 'cyclic', 'orderNote', 'steps'],
  'sort-groups-v1': ['groups', 'items'],
  'concept-map-v1': ['nodes', 'links'],
  'compare-table-v1': ['attributes', 'rows'],
  'formula-explorer-v1': ['formulaText', 'sourceId', 'quote', 'expression', 'variables', 'xVariable', 'cases', 'sourceExample', 'hasSourceExample'],
  'balance-equation-v1': ['equationText', 'sourceId', 'quote', 'species', 'hint'],
  'algorithm-trace-v1': ['algorithm', 'algorithmName', 'sourceId', 'quote', 'input', 'hasTarget', 'target', 'claims'],
  'log-ladder-v1': ['quantity', 'factor', 'factorText', 'effectPhrase', 'increasing', 'sourceId', 'quote', 'rungs', 'cases'],
  'threshold-v1': ['stages', 'scenarios'],
  'data-table-v1': ['labelHeader', 'columns', 'rows', 'questions', 'chartColumnIndex', 'brackets'],
  'label-diagram-v1': ['figureId', 'parts', 'hint']
};
/** Combine a gen body with system-owned fields into a kit spec; the gen body and system objects are deep-copied. */
export function assembleKitSpec<C extends KitGenComponentId>(gen: KitGenByComponent[C], componentId: C, opts: KitAssembleOptions): KitSpecByComponent[C] {
  if (!Number.isSafeInteger(opts.seed) || opts.seed < 0) throw new Error('KIT_SEED_INVALID');
  const g = gen as unknown as Record<string, unknown>;
  if (g['schemaVersion'] !== componentId) throw new Error('KIT_COMPONENT_MISMATCH');
  const body: Record<string, unknown> = {};
  if (componentId === 'compare-table-v1') {
    const cmp = gen as unknown as CompareTableGen;
    const grid = compareGridFromRows(cmp);
    body['entities'] = grid.entities;
    body['attributes'] = structuredClone(cmp.attributes);
    body['cells'] = grid.cells;
  } else {
    for (const key of KIT_GEN_BODY_KEYS[componentId]) {
      body[key] = structuredClone(g[key]);
    }
  }
  const title = g['title'] as string;
  return {
    schemaVersion: KIT_SCHEMA_VERSION,
    id: opts.id,
    componentId,
    title,
    sources: opts.sources.map(({ text: _text, ...ref }) => ({ ...ref })),
    execution: structuredClone(opts.execution ?? KIT_DEFAULT_EXECUTION),
    provenance: structuredClone(opts.provenance),
    seed: opts.seed,
    ...body
  } as unknown as KitSpecByComponent[C];
}
/** Attach the worker-resolved figure reference and SAM regions to an assembled label-diagram spec; inputs are deep-copied, never mutated. */
export function attachLabelRegions(spec: LabelDiagramSpec, figure: LabelFigureRef, regions: LabelRegion[]): LabelDiagramSpec {
  const copy: LabelDiagramSpec = structuredClone(spec);
  copy.figure = structuredClone(figure);
  copy.regions = structuredClone(regions);
  return copy;
}
/** Copy a usable v2 analysis overview into an overview spec; analysis and system objects are deep-copied. */
export function assembleOverviewSpec(analysis: SourceAnalysisV2, opts: KitAssembleOptions): OverviewSpec {
  if (analysis.usable !== true) throw new Error('OVERVIEW_DECLINED');
  if (!Number.isSafeInteger(opts.seed) || opts.seed < 0) throw new Error('KIT_SEED_INVALID');
  return {
    schemaVersion: KIT_SCHEMA_VERSION,
    id: opts.id,
    componentId: 'overview-v1',
    title: analysis.overview.headline,
    sources: opts.sources.map(({ text: _text, ...ref }) => ref),
    execution: structuredClone(opts.execution ?? KIT_DEFAULT_EXECUTION),
    provenance: structuredClone(opts.provenance),
    seed: opts.seed,
    headline: structuredClone(analysis.overview.headline),
    keyPoints: structuredClone(analysis.overview.keyPoints),
    keyTerms: structuredClone(analysis.overview.keyTerms)
  };
}
