// S6-V — SourceAnalysisV2 validation (checks A-01..A-11, docs/specs/STAGE-6-design.md §1.6,
// frozen) and the v2 analysis repair comparator. Separate from the v1 path: v1 invariants never
// run on v2 and nothing here changes validateAnalysis() (design §1.6).
//
// Report shape: 'schema.analysis-v2' Ajv gate first (short-circuits like v1's schema.analysis),
// then EVERY Stage 6 A-check id in order, each passing or failing with a plain-language message
// and validator-owned `affected` JSON-pointers into the analysis object. A-02 is retired
// (reserved id, always passes). Never throws: malformed input degrades into failed checks.
//
// Decisions recorded for the lead (design left these open):
//   - A-04 owns the usable/decline-field consistency both ways, the 300-char stub rule (R-DEC-3:
//     a usable=true analysis over sources whose combined normalised text is < 300 chars fails;
//     a too-short decline over sources >= 300 chars fails) — declineSummary length lives here.
//   - A-05 skips quotes whose sourceId does not resolve; A-06 owns unresolvable sourceIds (v1
//     division of labour between refs.sources and grounding.quotes).
//   - A-07 owns every array count, text length and id pattern of §1.3 (the gen schema carries
//     only item-count maxima, per the S6-0 deviation note).
//   - A-08 enforces the machine-checkable plan rules: R-PLAN-3 (<= 1 premium), R-PLAN-4 (no
//     duplicate family), R-PLAN-5 (a premium requires 1-2 kit siblings; a kit-only plan may have
//     1-3 entries — R-PLAN-1's "1-3 entries" and R-PLAN-5's "2-3 kit" conflict for a single-kit
//     plan; the lenient reading serves partial publish and is recorded here), R-PLAN-6 (distinct
//     focusQuote regions). R-PLAN-2 (appliesWhen fit), R-PLAN-7 (teaching order) and R-PLAN-9
//     (2-4-variable formula) need model judgement or the component spec and are NOT machine
//     checked here; the pass message says so. Stage 8b adds the figure rule: a componentPlan
//     entry 'label-diagram-v1' fails A-08 unless opts.figures lists at least one figure for the
//     source (docs/specs/STAGE-8b-label-diagram.md, Flow step 1).
//   - A-09 publisher tokens come from each source's own title/attribution metadata and match with
//     the SAME narrowed rule the kit policy sweep and OV-03 use (2026-10-30: full publisher name
//     phrases + name acronyms; "according to" only when it names the publisher; "as stated by" /
//     "official" / "endorsed" always); quotes are verbatim source text and exempt.
//   - A-10 (N-01): digits in AI text must occur as whole numeric tokens in the cited page (entry
//     fields) or any provided page (global fields). A-11 checks the frozen markup ban; quote
//     fields are exempt (verbatim source characters, formula/equation spans included).

import { Ajv } from 'ajv';
import type { AnySchemaObject, ValidateFunction } from 'ajv';

import type { SourceAnalysisV2, SourceDocument, ValidationCheck, ValidationReport, RepairFinding } from '../contracts/index.ts';
import {
  DECLINE_CODES,
  isSubject,
  KIT_ID_PATTERN,
  KIT_LIMITS,
  PLAN_COMPONENT_IDS,
  SUBJECTS,
} from '../contracts/kit.ts';
import { ACTIVITY_IDS } from '../contracts/engines.ts';
import { sourceAnalysisV2GenSchema } from '../contracts/schemas.ts';
import { affectedPathsOf, guarded, schemaAffectedPaths, schemaFailureMessage, truncate } from './validate.ts';
import {
  buildSourceIndex,
  duplicateOccurrences,
  findPublisherClaim,
  GENERIC_PUBLISHER_PHRASES,
  idProblems,
  lengthProblems,
  mergePublisherTokens,
  normalizeWhitespace,
  numbersCheckProblems,
  optionalLengthProblems,
  plainTextProblems,
  publisherTokensOf,
  quoteProblems,
} from './kit/shared.ts';
import { compareGuardedRevisions } from './kit/repair.ts';
import type { RevisionGuardContext } from './kit/repair.ts';
import { validateOverviewGen } from './kit/overview.ts';

const ajv = new Ajv({ allErrors: true });
const analysisV2SchemaValidate: ValidateFunction = ajv.compile(sourceAnalysisV2GenSchema as AnySchemaObject);

const QUOTE_MAX = KIT_LIMITS.common.quote.max;
const A = KIT_LIMITS.analysis;

/** Generic phrases that are a claim without any publisher named ("according to" needs a name). */
const ENDORSEMENT_PHRASES = GENERIC_PUBLISHER_PHRASES.filter(p => p !== 'according to');

export interface AnalysisV2ValidateOptions {
  revision?: number;
  artifactId?: string;
  /**
   * Stage 8b: the figures the analysis message listed for this source (A-08 figure rule).
   * `label-diagram-v1` may be planned only when at least one figure is listed; when this option
   * is absent or empty, a plan entry naming it fails A-08. Plans without label-diagram-v1
   * validate exactly as before, with or without the option.
   */
  figures?: readonly { id: string }[];
}

/** Loose post-gate view (the schema gate guarantees the shape). */
interface LooseAnalysisV2 extends SourceAnalysisV2 {}

/**
 * Validate a SourceAnalysisV2 against the provided source documents (checks A-01..A-11).
 * Never throws; a schema failure short-circuits into a single failed 'schema.analysis-v2' check.
 */
export function validateAnalysisV2(analysis: unknown, sources: SourceDocument[], opts: AnalysisV2ValidateOptions = {}): ValidationReport {
  const artifactId = opts.artifactId ?? 'source-analysis-v2';
  const revision = opts.revision ?? 1;
  let schemaOk = false;
  try {
    schemaOk = analysisV2SchemaValidate(analysis) === true;
  } catch {
    schemaOk = false;
  }
  if (!schemaOk) {
    // Item-count limits (minItems/maxItems) are exempt from the short-circuit: A-07
    // counts-in-range owns count violations with per-field affected paths (same convention as
    // the kit dispatcher). Any other schema error is unsafe to walk and short-circuits like v1's
    // schema.analysis.
    const errors = analysisV2SchemaValidate.errors ?? [];
    const nonCount = errors.filter(e => e.keyword !== 'minItems' && e.keyword !== 'maxItems');
    if (nonCount.length > 0) {
      return {
        artifactId,
        revision,
        checks: [
          {
            id: 'schema.analysis-v2',
            kind: 'schema',
            passed: false,
            message: schemaFailureMessage(analysisV2SchemaValidate, 'analysis failed schema.analysis-v2'),
            ...(() => {
              const affected = schemaAffectedPaths(analysisV2SchemaValidate);
              return affected.length > 0 ? { affected } : {};
            })(),
          },
        ],
        publishable: false,
      };
    }
  }

  const a = analysis as LooseAnalysisV2;
  const idx = buildSourceIndex(sources);
  const tokens = mergePublisherTokens(
    [...idx.docById.values()].map(doc => publisherTokensOf(doc)),
  );
  const usable = a.usable === true;

  /** A-05 helper: unresolvable sourceIds are owned by A-06, so skip those quotes here. */
  const quoteOk = (quote: string, sourceId: string): string[] =>
    idx.docById.has(sourceId) ? quoteProblems(quote, sourceId, idx) : [];

  const checks: ValidationCheck[] = [
    { id: 'schema.analysis-v2', kind: 'schema', passed: true, message: 'analysis matches source-analysis-v2.gen.json' },

    {
      id: 'A-01',
      kind: 'semantic',
      passed: a.analysisVersion === 2,
      message: a.analysisVersion === 2
        ? 'analysisVersion is 2'
        : `analysisVersion is ${JSON.stringify(a.analysisVersion)}, expected 2 (version-is-2)`,
      ...(a.analysisVersion === 2 ? {} : { path: '/analysisVersion', affected: ['/analysisVersion'] }),
    },

    {
      id: 'A-02',
      kind: 'semantic',
      passed: true,
      message: 'A-02 mirrors-agree is retired (v2 has no legacy mirror fields); the id is reserved and always passes',
    },

    guarded('A-03', 'semantic', () => {
      const problems: string[] = [];
      const affected: string[] = [];
      if (!isSubject(a.subject)) {
        problems.push(`subject is ${JSON.stringify(a.subject)}, expected one of ${SUBJECTS.join(', ')}`);
        affected.push('/subject');
      }
      const hasBalance = a.componentPlan.some(e => e.componentId === 'balance-equation-v1');
      if (hasBalance && a.subject !== 'chemistry') {
        problems.push(`componentPlan includes balance-equation-v1 but subject is "${a.subject}"; balance-equation-v1 requires subject "chemistry" (R-PLAN-8/R-SUB-2)`);
        a.componentPlan.forEach((e, i) => {
          if (e.componentId === 'balance-equation-v1') affected.push(`/componentPlan/${i}/componentId`, '/subject');
        });
      }
      return problems.length === 0
        ? { passed: true, message: `subject "${a.subject}" is valid${a.componentPlan.some(e => e.componentId === 'balance-equation-v1') ? ' and the balance plan is chemistry' : ''} (subject-valid)` }
        : { passed: false, message: problems.join('; '), path: affected[0], affected };
    }),

    guarded('A-04', 'semantic', () => {
      const problems: string[] = [];
      const affected: string[] = [];
      const totalSourceChars = idx.allTexts().reduce((n, t) => n + t.length, 0);
      const haveSources = idx.docById.size > 0;
      if (usable) {
        if (a.declineCode !== '') {
          problems.push(`usable=true but declineCode is "${a.declineCode}", expected ""`);
          affected.push('/declineCode');
        }
        if (a.declineSummary !== '') {
          problems.push(`usable=true but declineSummary is ${truncate(JSON.stringify(a.declineSummary), 60)}, expected ""`);
          affected.push('/declineSummary');
        }
        if (a.overview.headline === '') {
          problems.push('usable=true but overview.headline is "", expected a 10-120 character AI-written headline');
          affected.push('/overview/headline');
        }
        if (a.overview.keyPoints.length === 0) {
          problems.push('usable=true but overview.keyPoints is empty, expected 3-6 key points');
          affected.push('/overview/keyPoints');
        }
        if (a.overview.keyTerms.length === 0) {
          problems.push('usable=true but overview.keyTerms is empty, expected 3-8 key terms');
          affected.push('/overview/keyTerms');
        }
        if (a.componentPlan.length === 0) {
          problems.push('usable=true but componentPlan is empty, expected 1-3 planned components');
          affected.push('/componentPlan');
        }
        // R-DEC-3: stubs under 300 characters decline even when an equation is guessable.
        if (haveSources && totalSourceChars < A.stubChars) {
          problems.push(`usable=true but the provided source text is only ${totalSourceChars} normalised characters; a stub under ${A.stubChars} characters must decline "too-short" even when an equation is guessable (R-DEC-3)`);
          affected.push('/usable', '/declineCode');
        }
      } else {
        if (!(DECLINE_CODES as readonly string[]).includes(a.declineCode)) {
          problems.push(`usable=false but declineCode is ${JSON.stringify(a.declineCode)}, expected one of ${DECLINE_CODES.join(', ')}`);
          affected.push('/declineCode');
        }
        const dl = lengthProblems('declineSummary', a.declineSummary, A.declineSummary.min, A.declineSummary.max);
        if (dl.length > 0) {
          problems.push(`usable=false but ${dl[0]} (expected ${A.declineSummary.min}-${A.declineSummary.max} characters explaining the decline)`);
          affected.push('/declineSummary');
        }
        // R-DEC-4: on decline the overview is headline "" + empty arrays and the plan is [].
        if (a.overview.headline !== '') {
          problems.push(`usable=false but overview.headline is ${truncate(JSON.stringify(a.overview.headline), 60)}, expected "" on decline (R-DEC-4)`);
          affected.push('/overview/headline');
        }
        if (a.overview.keyPoints.length !== 0) {
          problems.push(`usable=false but overview.keyPoints has ${a.overview.keyPoints.length} entries, expected [] on decline (R-DEC-4)`);
          affected.push('/overview/keyPoints');
        }
        if (a.overview.keyTerms.length !== 0) {
          problems.push(`usable=false but overview.keyTerms has ${a.overview.keyTerms.length} entries, expected [] on decline (R-DEC-4)`);
          affected.push('/overview/keyTerms');
        }
        if (a.componentPlan.length !== 0) {
          problems.push(`usable=false but componentPlan has ${a.componentPlan.length} entries, expected [] on decline (R-DEC-4)`);
          affected.push('/componentPlan');
        }
        if (a.declineCode === 'too-short' && haveSources && totalSourceChars >= A.stubChars) {
          problems.push(`declineCode is "too-short" but the provided source text is ${totalSourceChars} normalised characters (>= ${A.stubChars}); the decline code does not match the page`);
          affected.push('/declineCode');
        }
      }
      return problems.length === 0
        ? { passed: true, message: `decline fields are consistent with usable=${a.usable}${haveSources ? ` (source text ${totalSourceChars} normalised characters, stub threshold ${A.stubChars})` : ''} (decline-integrity)` }
        : { passed: false, message: problems.join('; '), path: affected[0], affected };
    }),

    guarded('A-05', 'grounding', () => {
      const problems: string[] = [];
      const affected: string[] = [];
      let counted = 0;
      a.overview.keyPoints.forEach((kp, i) => {
        const p = quoteOk(kp.quote, kp.sourceId);
        if (p.length > 0) {
          problems.push(...p.map(m => `keyPoints[${i}] (${kp.id}): ${m}`));
          affected.push(`/overview/keyPoints/${i}/quote`);
        } else counted++;
      });
      a.overview.keyTerms.forEach((kt, i) => {
        const p = quoteOk(kt.quote, kt.sourceId);
        if (p.length > 0) {
          problems.push(...p.map(m => `keyTerms[${i}] (${kt.id}): ${m}`));
          affected.push(`/overview/keyTerms/${i}/quote`);
        } else counted++;
      });
      a.componentPlan.forEach((e, i) => {
        const p = quoteOk(e.focusQuote, e.focusSourceId);
        if (p.length > 0) {
          problems.push(...p.map(m => `componentPlan[${i}] (${e.componentId}): ${m}`));
          affected.push(`/componentPlan/${i}/focusQuote`);
        } else counted++;
      });
      return problems.length === 0
        ? { passed: true, message: `all ${counted} overview and plan quote(s) appear verbatim in their cited source after whitespace normalisation (overview-quotes-verbatim)` }
        : { passed: false, message: `${problems.join('; ')} (expected verbatim quotes of 1-${QUOTE_MAX} characters that appear in the cited source)`, path: affected[0], affected };
    }),

    guarded('A-06', 'grounding', () => {
      const problems: string[] = [];
      const affected: string[] = [];
      const cite = (sourceId: unknown, ptr: string, what: string): void => {
        if (typeof sourceId !== 'string' || !idx.docById.has(sourceId)) {
          problems.push(`${what} cites sourceId ${JSON.stringify(sourceId)}, which is not among the provided sources (${[...idx.docById.keys()].join(', ') || 'none'})`);
          affected.push(ptr);
        }
      };
      a.overview.keyPoints.forEach((kp, i) => cite(kp.sourceId, `/overview/keyPoints/${i}/sourceId`, `keyPoints[${i}] (${kp.id})`));
      a.overview.keyTerms.forEach((kt, i) => cite(kt.sourceId, `/overview/keyTerms/${i}/sourceId`, `keyTerms[${i}] (${kt.id})`));
      a.componentPlan.forEach((e, i) => cite(e.focusSourceId, `/componentPlan/${i}/focusSourceId`, `componentPlan[${i}] (${e.componentId})`));
      return problems.length === 0
        ? { passed: true, message: 'every cited sourceId resolves to a provided source document (quote-sourceids)' }
        : { passed: false, message: problems.join('; '), path: affected[0], affected };
    }),

    guarded('A-07', 'semantic', () => {
      const problems: string[] = [];
      const affected: string[] = [];
      const push = (p: string[], ptr: string): void => { if (p.length > 0) { problems.push(...p); affected.push(ptr); } };

      push(lengthProblems('pageCoverage', a.pageCoverage, A.pageCoverage.min, A.pageCoverage.max), '/pageCoverage');
      if (usable) {
        push(lengthProblems('overview.headline', a.overview.headline, A.headline.min, A.headline.max), '/overview/headline');
        if (a.overview.keyPoints.length < A.keyPoints.min || a.overview.keyPoints.length > A.keyPoints.max) {
          problems.push(`overview.keyPoints has ${a.overview.keyPoints.length} entries, expected ${A.keyPoints.min}-${A.keyPoints.max}`);
          affected.push('/overview/keyPoints');
        }
        if (a.overview.keyTerms.length < A.keyTerms.min || a.overview.keyTerms.length > A.keyTerms.max) {
          problems.push(`overview.keyTerms has ${a.overview.keyTerms.length} entries, expected ${A.keyTerms.min}-${A.keyTerms.max}`);
          affected.push('/overview/keyTerms');
        }
        if (a.componentPlan.length < A.componentPlan.min || a.componentPlan.length > A.componentPlan.max) {
          problems.push(`componentPlan has ${a.componentPlan.length} entries, expected ${A.componentPlan.min}-${A.componentPlan.max}`);
          affected.push('/componentPlan');
        }
      }
      const kpIds = a.overview.keyPoints.map(k => k.id);
      const ktIds = a.overview.keyTerms.map(k => k.id);
      const dupKp = duplicateOccurrences(kpIds);
      const dupKt = duplicateOccurrences(ktIds);
      a.overview.keyPoints.forEach((kp, i) => {
        push(idProblems(`keyPoints[${i}].id`, kp.id), `/overview/keyPoints/${i}/id`);
        if (dupKp.has(kp.id)) {
          problems.push(`keyPoints id "${kp.id}" occurs more than once (expected unique ids)`);
          affected.push(`/overview/keyPoints/${i}/id`);
        }
        push(lengthProblems(`keyPoints[${i}].point`, kp.point, A.point.min, A.point.max), `/overview/keyPoints/${i}/point`);
        if (typeof kp.quote !== 'string' || kp.quote.length < 1 || kp.quote.length > QUOTE_MAX) {
          problems.push(`keyPoints[${i}].quote is ${typeof kp.quote === 'string' ? kp.quote.length + ' characters' : JSON.stringify(kp.quote)}, expected 1-${QUOTE_MAX}`);
          affected.push(`/overview/keyPoints/${i}/quote`);
        }
      });
      a.overview.keyTerms.forEach((kt, i) => {
        push(idProblems(`keyTerms[${i}].id`, kt.id), `/overview/keyTerms/${i}/id`);
        if (dupKt.has(kt.id)) {
          problems.push(`keyTerms id "${kt.id}" occurs more than once (expected unique ids)`);
          affected.push(`/overview/keyTerms/${i}/id`);
        }
        push(lengthProblems(`keyTerms[${i}].term`, kt.term, A.term.min, A.term.max), `/overview/keyTerms/${i}/term`);
        push(lengthProblems(`keyTerms[${i}].gloss`, kt.gloss, A.gloss.min, A.gloss.max), `/overview/keyTerms/${i}/gloss`);
        if (typeof kt.quote !== 'string' || kt.quote.length < 1 || kt.quote.length > QUOTE_MAX) {
          problems.push(`keyTerms[${i}].quote is ${typeof kt.quote === 'string' ? kt.quote.length + ' characters' : JSON.stringify(kt.quote)}, expected 1-${QUOTE_MAX}`);
          affected.push(`/overview/keyTerms/${i}/quote`);
        }
      });
      // A keyPoint and a keyTerm may share an id (the fixture does: drag-coefficient); only
      // within-list duplicates are violations.
      a.componentPlan.forEach((e, i) => {
        push(lengthProblems(`componentPlan[${i}].pedagogicalReason`, e.pedagogicalReason, A.pedagogicalReason.min, A.pedagogicalReason.max), `/componentPlan/${i}/pedagogicalReason`);
        if (typeof e.focusQuote !== 'string' || e.focusQuote.length < 1 || e.focusQuote.length > QUOTE_MAX) {
          problems.push(`componentPlan[${i}].focusQuote is ${typeof e.focusQuote === 'string' ? e.focusQuote.length + ' characters' : JSON.stringify(e.focusQuote)}, expected 1-${QUOTE_MAX}`);
          affected.push(`/componentPlan/${i}/focusQuote`);
        }
      });
      return problems.length === 0
        ? { passed: true, message: `every count and text length is in the §1.3 range (keyPoints ${a.overview.keyPoints.length}, keyTerms ${a.overview.keyTerms.length}, componentPlan ${a.componentPlan.length}; ids match ${KIT_ID_PATTERN.source}) (counts-in-range)` }
        : { passed: false, message: problems.join('; '), path: affected[0], affected };
    }),

    guarded('A-08', 'semantic', () => {
      const problems: string[] = [];
      const affected: string[] = [];
      const plan = a.componentPlan;
      plan.forEach((e, i) => {
        if (!(PLAN_COMPONENT_IDS as readonly string[]).includes(e.componentId)) {
          problems.push(`componentPlan[${i}].componentId is ${JSON.stringify(e.componentId)}, expected one of ${PLAN_COMPONENT_IDS.join(', ')} (overview-v1 is implicit and never listed)`);
          affected.push(`/componentPlan/${i}/componentId`);
        }
      });
      const premiums = plan.filter(e => (ACTIVITY_IDS as readonly string[]).includes(e.componentId));
      if (premiums.length > 1) {
        problems.push(`componentPlan lists ${premiums.length} premium engines (${premiums.map(p => p.componentId).join(', ')}), expected at most one (R-PLAN-3/R-PLAN-5)`);
        plan.forEach((e, i) => {
          if ((ACTIVITY_IDS as readonly string[]).includes(e.componentId)) affected.push(`/componentPlan/${i}/componentId`);
        });
      }
      if (premiums.length > 0 && plan.length - premiums.length < 1) {
        problems.push('a premium engine must be planned together with 1-2 kit components (R-PLAN-5: premium + 1-2 kit)');
        affected.push('/componentPlan');
      }
      const seenFamilies = new Set<string>();
      plan.forEach((e, i) => {
        if (seenFamilies.has(e.componentId)) {
          problems.push(`componentPlan[${i}] duplicates the family "${e.componentId}" (R-PLAN-4: no duplicate family)`);
          affected.push(`/componentPlan/${i}/componentId`);
        }
        seenFamilies.add(e.componentId);
      });
      const seenQuotes = new Map<string, number>();
      plan.forEach((e, i) => {
        const key = normalizeWhitespace(e.focusQuote).toLowerCase();
        const prev = seenQuotes.get(key);
        if (prev !== undefined) {
          problems.push(`componentPlan[${i}].focusQuote repeats the region of componentPlan[${prev}].focusQuote (R-PLAN-6: distinct focusQuote regions)`);
          affected.push(`/componentPlan/${i}/focusQuote`, `/componentPlan/${prev}/focusQuote`);
        } else {
          seenQuotes.set(key, i);
        }
      });
      // Stage 8b figure rule (docs/specs/STAGE-8b-label-diagram.md, Flow step 1): the analysis
      // message lists the source's figures and label-diagram-v1 may be planned only when at least
      // one is listed. The caller passes that list as opts.figures; absent or empty fails closed.
      const listedFigures = (Array.isArray(opts.figures) ? opts.figures : []).filter(f => typeof f?.id === 'string' && f.id !== '');
      plan.forEach((e, i) => {
        if (e.componentId === 'label-diagram-v1' && listedFigures.length === 0) {
          problems.push(`componentPlan[${i}] plans label-diagram-v1 but ${opts.figures === undefined ? 'no figure list was provided' : 'no figures are listed'} for this source (label-diagram-v1 may be planned only when at least one figure is listed for the page)`);
          affected.push(`/componentPlan/${i}/componentId`);
        }
      });
      return problems.length === 0
        ? {
            passed: true,
            message: `componentPlan obeys the machine-checkable plan rules (${plan.length} entries, ${premiums.length} premium, distinct families and focusQuote regions); R-PLAN-2 (appliesWhen fit), R-PLAN-7 (teaching order) and R-PLAN-9 (2-4-variable formula) need model judgement or the component spec and are not re-checked here (plan-rules)`,
          }
        : { passed: false, message: problems.join('; '), path: affected[0], affected };
    }),

    guarded('A-09', 'semantic', () => {
      const fields = aiTextFieldEntries(a);
      const hits: { path: string; text: string; token: string }[] = [];
      for (const f of fields) {
        const hit = findPublisherClaim(f.text, tokens);
        if (hit !== null) hits.push({ path: f.path, text: f.text, token: hit });
      }
      return hits.length === 0
        ? {
            passed: true,
            message: `no generated field names a publisher (full name or name acronym from the sources' own title/attribution metadata); "according to" counts only when it names the publisher, and "${ENDORSEMENT_PHRASES.join('" / "')}" wording is always a claim; quotes are verbatim source text and exempt (no-publisher-claim)`,
          }
        : {
            passed: false,
            message: `publisher claim found at ${hits.map(h => `${h.path}: "${truncate(h.text, 60)}" (token "${h.token}")`).join('; ')} (R-SUB-4: never name the publisher in generated strings — not by full name, not by acronym, not via "according to"; never use "${ENDORSEMENT_PHRASES.join('" / "')}" wording)`,
            path: hits[0].path,
            affected: hits.map(h => h.path),
          };
    }),

    guarded('A-10', 'grounding', () => {
      const problems: string[] = [];
      const affected: string[] = [];
      const all = idx.allTexts();
      const check = (label: string, text: unknown, ptr: string, searchTexts: (string | undefined)[]): void => {
        const p = numbersCheckProblems(label, text, searchTexts);
        if (p.length > 0) {
          problems.push(...p);
          affected.push(ptr);
        }
      };
      check('pageCoverage', a.pageCoverage, '/pageCoverage', all);
      check('declineSummary', a.declineSummary, '/declineSummary', all);
      check('overview.headline', a.overview.headline, '/overview/headline', all);
      a.overview.keyPoints.forEach((kp, i) =>
        check(`keyPoints[${i}].point`, kp.point, `/overview/keyPoints/${i}/point`, [idx.textOf(kp.sourceId), ...all]),
      );
      a.overview.keyTerms.forEach((kt, i) => {
        check(`keyTerms[${i}].term`, kt.term, `/overview/keyTerms/${i}/term`, [idx.textOf(kt.sourceId), ...all]);
        check(`keyTerms[${i}].gloss`, kt.gloss, `/overview/keyTerms/${i}/gloss`, [idx.textOf(kt.sourceId), ...all]);
      });
      a.componentPlan.forEach((e, i) =>
        check(`componentPlan[${i}].pedagogicalReason`, e.pedagogicalReason, `/componentPlan/${i}/pedagogicalReason`, [idx.textOf(e.focusSourceId), ...all]),
      );
      return problems.length === 0
        ? { passed: true, message: 'every number stated in AI-written analysis text appears on the cited page or in the same quote (N-01) (ai-numbers-checkable)' }
        : { passed: false, message: problems.join('; '), path: affected[0], affected };
    }),

    guarded('A-11', 'semantic', () => {
      const problems: string[] = [];
      const affected: string[] = [];
      for (const f of aiTextFieldEntries(a)) {
        const p = plainTextProblems(f.path, f.text);
        if (p.length > 0) {
          problems.push(...p);
          affected.push(f.path);
        }
      }
      return problems.length === 0
        ? { passed: true, message: 'every AI-written field is plain text: no "<"/">", backticks, control characters, URLs or markdown heading/link/emphasis patterns (quotes and formula/equation fields are exempt) (plain-text)' }
        : { passed: false, message: `${problems.join('; ')} (expected plain text)`, path: affected[0], affected };
    }),
  ];

  return { artifactId, revision, checks, publishable: checks.every(c => c.passed) };
}

/**
 * The publication gate for a lesson-flow analysis (S6R-01): validateAnalysisV2 (schema gate +
 * A-01..A-11) PLUS, for a USABLE analysis, the overview's own grounding checks OV-01..OV-06 run on
 * `analysis.overview` — term-in-quote, point/gloss-to-quote word overlap, overview number and
 * publisher checks that A-05 (quote existence only) does not cover.
 *
 * Signature: (analysis, sources, opts?) => ValidationReport. `publishable` is true only when every
 * check passes; every failing OV check carries validator-owned `affected` pointers PREFIXED with
 * '/overview' (analysis-object pointers), so they join the revision-1 repair authority that
 * compareAnalysisV2Revisions / analysisV2RepairAuthority recompute from this same gate.
 *
 * - Schema short-circuit: a schema-invalid analysis returns validateAnalysisV2's single failed
 *   'schema.analysis-v2' check (no overview walk on unsafe shapes).
 * - Honest declines (usable=false): the overview is empty by contract (R-DEC-4), so no OV check
 *   (and no usable-overview minimum count) is added; the report is exactly validateAnalysisV2's.
 * - The overview's own 'schema.gen' structural check is NOT added: A-04/A-07 already own the
 *   shape, count, length and id rules of the same fields in the analysis (no double reporting).
 *   OV-01/OV-03/OV-04/OV-05 re-check fields A-05/A-09/A-10/A-07 cover; the redundancy is
 *   deliberate (one overview validator, one set of check ids) and harmless to the authority
 *   (paths are unioned).
 * Never throws.
 */
export function validateLessonAnalysisGate(analysis: unknown, sources: SourceDocument[], opts: AnalysisV2ValidateOptions = {}): ValidationReport {
  const base = validateAnalysisV2(analysis, sources, opts);
  try {
    const a = analysis as Partial<SourceAnalysisV2> | null | undefined;
    if (a === null || typeof a !== 'object' || a.usable !== true) return base;
    if (base.checks.length === 1 && base.checks[0]?.id === 'schema.analysis-v2' && base.checks[0].passed === false) return base;
    const ov = validateOverviewGen(a.overview, sources, { revision: base.revision });
    const ovChecks: ValidationCheck[] = ov.checks
      .filter(c => /^OV-0[1-6]$/.test(c.id))
      .map(c => {
        const { path, affected, ...rest } = c;
        return {
          ...rest,
          ...(typeof path === 'string' ? { path: `/overview${path}` } : {}),
          ...(Array.isArray(affected) ? { affected: affected.map(p => `/overview${p}`) } : {}),
        };
      });
    if (ovChecks.length === 0) return base;
    const checks = [...base.checks, ...ovChecks];
    return { ...base, checks, publishable: checks.every(c => c.passed) };
  } catch (err) {
    const check: ValidationCheck = { id: 'OV-01', kind: 'grounding', passed: false, message: `overview checks crashed before they could pass or fail cleanly: ${err instanceof Error ? err.message : String(err)}` };
    return { ...base, checks: [...base.checks, check], publishable: false };
  }
}

/** Every AI-written text field of the analysis with its JSON pointer (quotes exempt). */
function aiTextFieldEntries(a: LooseAnalysisV2): { path: string; text: string }[] {
  return [
    { path: '/pageCoverage', text: a.pageCoverage },
    { path: '/declineSummary', text: a.declineSummary },
    { path: '/overview/headline', text: a.overview.headline },
    ...a.overview.keyPoints.flatMap((kp, i) => [
      { path: `/overview/keyPoints/${i}/point`, text: kp.point },
    ]),
    ...a.overview.keyTerms.flatMap((kt, i) => [
      { path: `/overview/keyTerms/${i}/term`, text: kt.term },
      { path: `/overview/keyTerms/${i}/gloss`, text: kt.gloss },
    ]),
    ...a.componentPlan.flatMap((e, i) => [
      { path: `/componentPlan/${i}/pedagogicalReason`, text: e.pedagogicalReason },
    ]),
  ].filter(f => typeof f.text === 'string');
}

/* ------------------------------------------------------------------ */
/* v2 analysis repair comparison                                       */
/* ------------------------------------------------------------------ */

/**
 * The analysis lists a repair may GROW (append-only) when the revision-1 gate names the exact list
 * pointer (A-04 empty, A-07 count, A-08 plan, OV-05), mapped to their frozen maximum. Oversized
 * lists are NOT repaired by deletion: the comparator keeps rejecting a shrink, so such a baseline
 * simply exhausts its bounded repair attempts (documented limit; an honest regeneration/degrade
 * rule belongs to the worker, not to a comparator exception).
 */
const APPENDABLE_LISTS: Readonly<Record<string, number>> = {
  '/overview/keyPoints': A.keyPoints.max,
  '/overview/keyTerms': A.keyTerms.max,
  '/componentPlan': A.componentPlan.max,
};

/**
 * Guard a SourceAnalysisV2 repair revision against weakening (design §0.2/§5.4 frozen repair
 * discipline). The authority is the recomputed revision-1 report; caller findings may only
 * narrow it. Extra analysis rule: `usable` may never flip true → false to escape a format or
 * list finding unless A-04 (decline-integrity) itself failed on the baseline — the v2 mirror of
 * the v1 rule that a finding can never be escaped by declining the source. Never throws.
 */
export function compareAnalysisV2Revisions(
  baseline: unknown,
  next: unknown,
  context?: RevisionGuardContext,
): ValidationCheck {
  return compareGuardedRevisions(baseline, next, context, {
    targetLabel: 'source-analysis-v2',
    // The authority is the SAME gate that decides publication (A-checks + OV-01..OV-06).
    recompute: (b, sources) => validateLessonAnalysisGate(b, sources, context?.figures !== undefined ? { figures: context.figures } : {}),
    allowListResize: ({ pointer, allowed, before, after }) => {
      // S6R-10: append-only for an authorised, undersized list. Never a deletion, never beyond the
      // frozen maximum; existing entries (and their ids) stay frozen (the list pointer licenses
      // the length change only), appended entries are checked normally by the gate.
      const max = APPENDABLE_LISTS[pointer];
      return max !== undefined && allowed.includes(pointer) && after > before && after <= max;
    },
    extraRules: ({ baseline: b, next: n, report }) => {
      const problems: string[] = [];
      const failed = new Set(report.checks.filter(c => !c.passed).map(c => c.id));
      const base = b as Partial<SourceAnalysisV2> | null | undefined;
      const nxt = n as Partial<SourceAnalysisV2> | null | undefined;
      if (base?.usable === true && nxt?.usable === false && !failed.has('A-04')) {
        problems.push('usable flipped from true to false even though A-04 (decline-integrity) passed on the baseline — a repair may never escape failing checks by declining the source');
      }
      return problems;
    },
  });
}

/**
 * Convenience for the pipeline: the authorized change paths for an analysis-v2 repair, recomputed
 * from the immutable revision 1 (the ONLY authority; callers hand these to the model and to
 * compareAnalysisV2Revisions).
 */
export function analysisV2RepairAuthority(baseline: unknown, sources: SourceDocument[], opts: AnalysisV2ValidateOptions = {}): { report: ValidationReport; allowed: string[] } {
  const report = validateLessonAnalysisGate(baseline, sources, opts);
  return { report, allowed: affectedPathsOf(report) };
}

export type { RepairFinding, RevisionGuardContext };

/** The optional-text helper re-exported for the kit modules' '' /min-max fields. */
export { optionalLengthProblems };
