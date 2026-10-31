// S6-V — single entry point for Stage 6 kit component validation and the v2 kit repair
// comparator. validateKitComponent(componentId, gen, sources) dispatches:
//   overview-v1        → OverviewGen validation (OV-01..OV-06; manual structural gate — S6-0
//                        ships no Ajv schema file for the overview)
//   every gen component → Ajv gate against schemas/<component>.gen.json ('schema.gen'; a gate
//                        failure short-circuits like v1's schema.full) and then EVERY Stage 6
//                        check id of that component, in frozen order, each passing or failing
//                        with a plain-language message and validator-owned `affected`
//                        JSON-pointers into the GEN object (the artifact a repair revises).
// Retired ids (BAL-06) stay reserved and always pass. Never throws: malformed input degrades
// into failed checks (guarded()).

import { Ajv } from 'ajv';
import type { AnySchemaObject, ValidateFunction } from 'ajv';

import type { SourceDocument, ValidationCheck, ValidationReport } from '../../contracts/index.ts';
import { isKitComponentId, KIT_GEN_COMPONENT_IDS } from '../../contracts/kit.ts';
import type {
  BalanceEquationGen,
  CompareTableGen,
  ConceptMapGen,
  KitComponentId,
  KitGenComponentId,
  OverviewGen,
  QuizCardsGen,
  SequenceGen,
  SortGroupsGen,
  FormulaExplorerGen,
  AlgorithmTraceGen,
  LogLadderGen,
  ThresholdGen,
  DataTableGen,
} from '../../contracts/kit.ts';
import { kitGenSchemaFor } from '../../contracts/schemas.ts';
import { schemaAffectedPaths, schemaFailureMessage } from '../validate.ts';
import { buildReport } from './shared.ts';
import { applyKitPolicy } from './policy.ts';
import { validateOverviewGen } from './overview.ts';
import { validateQuizCards, pruneQuizCards } from './quiz.ts';
import { validateSequence, pruneSequenceSteps } from './sequence.ts';
import { validateSortGroups, pruneSortItems } from './sort.ts';
import { validateConceptMap, pruneConceptMapLinks } from './concept-map.ts';
import { validateCompareTable } from './compare.ts';
import { validateFormulaExplorer, computeCaseOutputs } from './formula-explorer.ts';
import { validateBalanceEquation, deriveBalanceSolution } from './balance.ts';
import { validateAlgorithmTrace } from './algorithm.ts';
import { validateLogLadder } from './log-ladder.ts';
import { validateThreshold } from './threshold.ts';
import { validateDataTable } from './data-table.ts';
import { compareGuardedRevisions } from './repair.ts';
import type { RevisionGuardContext } from './repair.ts';

const ajv = new Ajv({ allErrors: true });
const genValidators = new Map<KitGenComponentId, ValidateFunction>();
function genValidatorFor(componentId: KitGenComponentId): ValidateFunction {
  let v = genValidators.get(componentId);
  if (v === undefined) {
    v = ajv.compile(kitGenSchemaFor(componentId) as AnySchemaObject);
    genValidators.set(componentId, v);
  }
  return v;
}

export interface KitValidateOptions { revision?: number; artifactId?: string }

/**
 * Validate one Stage 6 kit component gen against the provided source documents.
 * `gen` is the model-written gen body (OverviewGen for overview-v1, the component's *Gen type
 * otherwise). The report's check ids are 'schema.gen' (or 'schema.analysis-v2' for the analysis,
 * elsewhere) plus exactly the component's frozen Stage 6 ids; `publishable` requires all to pass.
 */
export function validateKitComponent(
  componentId: KitComponentId | string,
  gen: unknown,
  sources: SourceDocument[],
  opts: KitValidateOptions = {},
): ValidationReport {
  const revision = opts.revision ?? 1;
  const artifactId = opts.artifactId ?? String(componentId);
  if (!isKitComponentId(componentId)) {
    return {
      artifactId,
      revision,
      checks: [{
        id: 'schema.gen',
        kind: 'schema',
        passed: false,
        message: `componentId is ${JSON.stringify(componentId)}, expected one of the kit component ids (overview-v1, ${KIT_GEN_COMPONENT_IDS.join(', ')})`,
      }],
      publishable: false,
    };
  }
  if (componentId === 'overview-v1') {
    return applyKitPolicy(componentId, gen, sources, validateOverviewGen(gen, sources, { revision }));
  }
  const validate = genValidatorFor(componentId);
  let schemaOk = false;
  try {
    schemaOk = validate(gen) === true;
  } catch {
    schemaOk = false;
  }
  if (!schemaOk) {
    // Item-count limits (minItems/maxItems) are EXEMPT from the short-circuit: the design gives
    // every component an explicit counts check id (OV-05, SEQ-05, SORT-05, CM-05, CT-03, BAL-02)
    // or a structural 'schema.gen' pass (quiz, formula-explorer) that owns count violations with
    // per-field affected paths. Any other schema error (types, enums, required keys) is unsafe to
    // walk and short-circuits like v1's schema.full.
    const errors = validate.errors ?? [];
    const nonCount = errors.filter(e => e.keyword !== 'minItems' && e.keyword !== 'maxItems');
    if (nonCount.length > 0) {
      return {
        artifactId,
        revision,
        checks: [
          {
            id: 'schema.gen',
            kind: 'schema',
            passed: false,
            message: schemaFailureMessage(validate, `${componentId} gen failed schema.gen`),
            ...(() => {
              const affected = schemaAffectedPaths(validate);
              return affected.length > 0 ? { affected } : {};
            })(),
          },
        ],
        publishable: false,
      };
    }
  }
  return applyKitPolicy(componentId, gen, sources, validateKitBody(componentId, gen, sources, artifactId, revision));
}

function validateKitBody(componentId: KitGenComponentId, gen: unknown, sources: SourceDocument[], artifactId: string, revision: number): ValidationReport {
  switch (componentId) {
    case 'quiz-cards-v1': return validateQuizCards(gen as QuizCardsGen, sources, { revision });
    case 'sequence-v1': return validateSequence(gen as SequenceGen, sources, { revision });
    case 'sort-groups-v1': return validateSortGroups(gen as SortGroupsGen, sources, { revision });
    case 'concept-map-v1': return validateConceptMap(gen as ConceptMapGen, sources, { revision });
    case 'compare-table-v1': return validateCompareTable(gen as CompareTableGen, sources, { revision });
    case 'formula-explorer-v1': return validateFormulaExplorer(gen as FormulaExplorerGen, sources, { revision });
    case 'balance-equation-v1': return validateBalanceEquation(gen as BalanceEquationGen, sources, { revision });
    case 'algorithm-trace-v1': return validateAlgorithmTrace(gen as AlgorithmTraceGen, sources, { revision });
    case 'log-ladder-v1': return validateLogLadder(gen as LogLadderGen, sources, { revision });
    case 'threshold-v1': return validateThreshold(gen as ThresholdGen, sources, { revision });
    case 'data-table-v1': return validateDataTable(gen as DataTableGen, sources, { revision });
    default: {
      const never: never = componentId;
      return buildReport(artifactId, [{ id: 'schema.gen', kind: 'schema', passed: false, message: `no validator for ${String(never)}` }], revision);
    }
  }
}

/** The revision-1 column count (S6R-06: a CT-03 row resize may only land on exactly this many slots). */
function columnCountOf(baseline: unknown): number {
  const attributes = (baseline as { attributes?: unknown } | null | undefined)?.attributes;
  return Array.isArray(attributes) ? attributes.length : -1;
}

/** The revision-1 value-column count of a data-table-v1 gen (Stage 8a: same S6R-06 rule for DT-04 row resizes). */
function dataColumnCountOf(baseline: unknown): number {
  const columns = (baseline as { columns?: unknown } | null | undefined)?.columns;
  return Array.isArray(columns) ? columns.length : -1;
}

/**
 * Guard a kit component repair revision (design §5.4 frozen discipline). The authority is the
 * recomputed revision-1 report over the provided sources; caller findings may only narrow it.
 * Generic rules (kit/repair.ts): changes ONLY under authorized affected paths, item counts and
 * structure frozen (the SYSTEM prunes via the drop helpers, never the model), ids stable except
 * an id path the authority itself names (renamed only to a valid, non-colliding id), and a
 * `tolerance` leaf never increases. Component extras below. Never throws.
 *
 * compare-table-v1 (Stage 6 compare-grid): cell identity is (row index, attribute index), so the
 * positional diff already freezes rows and columns in place; a flagged id-like entity/attribute
 * rename is allowed exactly because schema.gen names `/rows/i/entity` or `/attributes/j` in its
 * affected paths. The one resize exception (S6R-06): when CT-03 names `/rows/i/values` (a row
 * whose value count differs from the column count), the repair may add or remove TAIL slots of
 * THAT values list so it ends on exactly the column count. The pointer licenses the resize only:
 * the retained prefix cells stay frozen unless their own failing paths (CT-01/CT-02/CT-04 cell
 * paths) authorize them (kit/repair.ts withholds descendant authority from a resized list). The
 * rows and attributes lists stay frozen. A missing HEAD slot therefore cannot be repaired by
 * shifting the prefix: the component fails honestly instead of rewriting a passing cell.
 */
export function compareKitRevisions(
  componentId: KitComponentId | string,
  baseline: unknown,
  next: unknown,
  context?: RevisionGuardContext,
): ValidationCheck {
  const extras = (args: { baseline: unknown; next: unknown; report: ValidationReport }): string[] => {
    const problems: string[] = [];
    const failed = new Set(args.report.checks.filter(c => !c.passed).map(c => c.id));
    if (componentId === 'formula-explorer-v1') {
      const b = args.baseline as FormulaExplorerGen;
      const n = args.next as FormulaExplorerGen;
      if (b?.variables && n?.variables && b.variables.length === n.variables.length) {
        b.variables.forEach((bv, i) => {
          const nv = n.variables[i];
          if (nv === undefined) return;
          const widthBefore = Number(bv.max) - Number(bv.min);
          const widthNext = Number(nv.max) - Number(nv.min);
          if (Number.isFinite(widthBefore) && Number.isFinite(widthNext) && widthNext < widthBefore && !failed.has('FE-06')) {
            problems.push(`variables[${i}] (${bv.name}) slider range width shrank from ${widthBefore} to ${widthNext} even though FE-06 passed on the baseline (a repair never narrows a sane range)`);
          }
        });
      }
      if (b?.hasSourceExample === true && n?.hasSourceExample === false && !failed.has('FE-05')) {
        problems.push('hasSourceExample flipped from true to false even though FE-05 passed on the baseline (the verified-example degrade path requires a failing FE-05)');
      }
    }
    return problems;
  };
  return compareGuardedRevisions(baseline, next, context, {
    targetLabel: `${componentId}`,
    recompute: (b, sources) => validateKitComponent(componentId, b, sources),
    extraRules: extras,
    allowListResize: componentId === 'compare-table-v1'
      ? ({ pointer, allowed, after }) => /^\/rows\/\d+\/values$/.test(pointer) && allowed.includes(pointer) && after === columnCountOf(baseline)
      : componentId === 'data-table-v1'
        // Stage 8a (lead): DT-04 names `/rows/i/values` when a row's value count differs from the column count;
        // exactly the compare-table S6R-06 rule — tail slots of THAT row only, ending on the revision-1 column count.
        ? ({ pointer, allowed, after }) => /^\/rows\/\d+\/values$/.test(pointer) && allowed.includes(pointer) && after === dataColumnCountOf(baseline)
        : undefined,
  });
}

// Re-exports: the prune helpers, per-component validators and the system-side recomputations.
export { validateOverviewGen } from './overview.ts';
export { validateQuizCards, pruneQuizCards, quizStructuralProblems } from './quiz.ts';
export { validateSequence, pruneSequenceSteps, orderSignals, sequenceStructuralProblems } from './sequence.ts';
export { validateSortGroups, pruneSortItems, labelInQuoteOrParagraph, sortStructuralProblems } from './sort.ts';
export { validateConceptMap, pruneConceptMapLinks, RELATION_TRIGGERS, conceptMapStructuralProblems } from './concept-map.ts';
export { validateCompareTable, compareStructuralProblems, idLikeNameProblem, COMPARE_FAILURE_MESSAGE } from './compare.ts';
export {
  validateFormulaExplorer,
  computeCaseOutputs,
  parsePageFormulaFromQuote,
  mapPageSymbols,
  formulaExplorerStructuralProblems,
  FE_FAILURE_MESSAGE,
  FE08_SAMPLE_FRACTIONS,
  FE08_RELATIVE_TOLERANCE,
  FE08_MIN_AGREEING_POINTS,
} from './formula-explorer.ts';
export { validateBalanceEquation, deriveBalanceSolution, balanceStructuralProblems, BAL_FAILURE_MESSAGE } from './balance.ts';
export { compareGuardedRevisions, leafDiff, isAuthorized } from './repair.ts';
export { kitDisplayFields, kitPolicyProblems, applyKitPolicy } from './policy.ts';
export type { RevisionGuardContext } from './repair.ts';
export type { DroppedItem, PruneResult } from './quiz.ts';
export {
  KIT_FAILURE_MESSAGES,
  publisherTokensOf,
  mergePublisherTokens,
  findPublisherClaim,
  numericTokens,
  numberOccursIn,
  contentWords,
  sharedContentWords,
  buildSourceIndex,
} from './shared.ts';
export type { SourceIndex, PublisherTokens } from './shared.ts';
export type { OverviewGen };
