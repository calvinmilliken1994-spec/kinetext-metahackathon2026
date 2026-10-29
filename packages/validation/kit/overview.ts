// S6-V — overview-v1 validation (OV-01..OV-06, design §2.1 frozen). The overview gen is the
// OverviewGen object produced inside analysis Call 1; validateKitComponent('overview-v1', gen,
// sources) dispatches here. There is no Ajv gen schema file for the overview (S6-0 ships none),
// so the structural gate is a manual shape+limits pass reported as 'schema.gen'.
//
// Recorded interpretation (lead decision needed if disagreed):
//   - OV-02 term-in-quote: the term must appear (case-insensitive, whitespace-normalised) in its
//     own quote OR in the source SENTENCE containing the located quote. The sentence fallback
//     exists because a <=150-char quote span can legitimately sit inside the sentence that names
//     the term (the golden fixture's "dynamic pressure" entry quotes the inner phrase of
//     '"density times the square of the velocity divided by two" is called the dynamic
//     pressure'); the repo already uses sentence-scope grounding for timeline quotes (S5B-02).
//   - OV-06 uses the frozen parameters exactly: >=2 distinct content words (>=4 letters, the
//     frozen stoplist) shared between a key-point and its OWN quote, >=1 for a gloss. The design
//     explicitly accepts the false-reject risk of faithful synonym paraphrase; the repair path
//     rewrites point/gloss wording, never the quote.

import type { SourceDocument, ValidationCheck, ValidationReport } from '../../contracts/index.ts';
import { KIT_LIMITS } from '../../contracts/kit.ts';
import type { KeyPointGen, KeyTermGen, OverviewGen } from '../../contracts/kit.ts';
import { guarded } from '../validate.ts';
import {
  buildSourceIndex,
  buildReport,
  collectQuoteFailures,
  containsNormalized,
  duplicateOccurrences,
  findPublisherClaim,
  idProblems,
  lengthProblems,
  mergePublisherTokens,
  numbersCheckProblems,
  publisherTokensOf,
  sharedContentWords,
} from './shared.ts';

const A = KIT_LIMITS.analysis;

function isOverviewShape(gen: unknown): gen is OverviewGen {
  if (typeof gen !== 'object' || gen === null) return false;
  const g = gen as Record<string, unknown>;
  return typeof g.headline === 'string' && Array.isArray(g.keyPoints) && Array.isArray(g.keyTerms)
    && g.keyPoints.every(x => typeof x === 'object' && x !== null)
    && g.keyTerms.every(x => typeof x === 'object' && x !== null);
}

/** Manual structural gate for the overview gen (the component has no Ajv schema file). */
function overviewStructuralProblems(gen: OverviewGen): { problems: string[]; affected: string[] } {
  const problems: string[] = [];
  const affected: string[] = [];
  const push = (p: string[], ptr: string): void => { if (p.length > 0) { problems.push(...p); affected.push(ptr); } };
  push(lengthProblems('headline', gen.headline, A.headline.min, A.headline.max), '/headline');
  const kpIds = gen.keyPoints.map(k => (k as KeyPointGen).id);
  const ktIds = gen.keyTerms.map(k => (k as KeyTermGen).id);
  const dupKp = duplicateOccurrences(kpIds);
  const dupKt = duplicateOccurrences(ktIds);
  gen.keyPoints.forEach((kp, i) => {
    push(idProblems(`keyPoints[${i}].id`, kp.id), `/keyPoints/${i}/id`);
    if (dupKp.has(kp.id)) { problems.push(`keyPoints id "${kp.id}" occurs more than once (expected unique ids)`); affected.push(`/keyPoints/${i}/id`); }
    push(lengthProblems(`keyPoints[${i}].point`, kp.point, A.point.min, A.point.max), `/keyPoints/${i}/point`);
    push(lengthProblems(`keyPoints[${i}].quote`, kp.quote, KIT_LIMITS.common.quote.min, KIT_LIMITS.common.quote.max), `/keyPoints/${i}/quote`);
  });
  gen.keyTerms.forEach((kt, i) => {
    push(idProblems(`keyTerms[${i}].id`, kt.id), `/keyTerms/${i}/id`);
    if (dupKt.has(kt.id)) { problems.push(`keyTerms id "${kt.id}" occurs more than once (expected unique ids)`); affected.push(`/keyTerms/${i}/id`); }
    push(lengthProblems(`keyTerms[${i}].term`, kt.term, A.term.min, A.term.max), `/keyTerms/${i}/term`);
    push(lengthProblems(`keyTerms[${i}].gloss`, kt.gloss, A.gloss.min, A.gloss.max), `/keyTerms/${i}/gloss`);
    push(lengthProblems(`keyTerms[${i}].quote`, kt.quote, KIT_LIMITS.common.quote.min, KIT_LIMITS.common.quote.max), `/keyTerms/${i}/quote`);
  });
  return { problems, affected };
}

export function validateOverviewGen(gen: unknown, sources: SourceDocument[], opts: { revision?: number } = {}): ValidationReport {
  const revision = opts.revision ?? 1;
  if (!isOverviewShape(gen)) {
    return {
      artifactId: 'overview-v1',
      revision,
      checks: [{
        id: 'schema.gen',
        kind: 'schema',
        passed: false,
        message: 'overview gen is malformed: expected { headline: string, keyPoints: KeyPointGen[], keyTerms: KeyTermGen[] }',
      }],
      publishable: false,
    };
  }
  const g = gen as OverviewGen;
  const idx = buildSourceIndex(sources);
  const tokens = mergePublisherTokens([...idx.docById.values()].map(doc => publisherTokensOf(doc)));
  const all = idx.allTexts();

  const structural = overviewStructuralProblems(g);
  const checks: ValidationCheck[] = [
    structural.problems.length === 0
      ? { id: 'schema.gen', kind: 'schema', passed: true, message: 'overview gen has the required shape and every text length and id pattern is within the frozen limits' }
      : { id: 'schema.gen', kind: 'schema', passed: false, message: `overview gen failed the structural limits: ${structural.problems.join('; ')}`, path: structural.affected[0], affected: structural.affected },

    guarded('OV-01', 'grounding', () => {
      const entries = [
        ...g.keyPoints.map((kp, i) => ({ quote: kp.quote, sourceId: kp.sourceId, quotePtr: `/keyPoints/${i}/quote`, sourceIdPtr: `/keyPoints/${i}/sourceId`, label: `keyPoints[${i}] (${kp.id})` })),
        ...g.keyTerms.map((kt, i) => ({ quote: kt.quote, sourceId: kt.sourceId, quotePtr: `/keyTerms/${i}/quote`, sourceIdPtr: `/keyTerms/${i}/sourceId`, label: `keyTerms[${i}] (${kt.id})` })),
      ];
      const { problems, affected, grounded } = collectQuoteFailures(entries, idx);
      return problems.length === 0
        ? { passed: true, message: `all ${grounded} overview quote(s) appear verbatim in their cited source after whitespace normalisation (quotes-verbatim)` }
        : { passed: false, message: `${problems.join('; ')} (expected verbatim quotes of 1-${KIT_LIMITS.common.quote.max} characters from the cited source)`, path: affected[0], affected };
    }),

    guarded('OV-02', 'grounding', () => {
      const problems: string[] = [];
      const affected: string[] = [];
      g.keyTerms.forEach((kt, i) => {
        if (typeof kt.term !== 'string' || typeof kt.quote !== 'string') return; // structural gate owns shape
        if (containsNormalized(kt.quote, kt.term)) return;
        const sentence = typeof kt.sourceId === 'string' ? idx.sentenceOf(kt.quote, kt.sourceId) : null;
        if (sentence !== null && containsNormalized(sentence, kt.term)) return;
        problems.push(`keyTerms[${i}]: the term "${kt.term}" does not appear in its quote "${kt.quote.slice(0, 60)}" nor in the source sentence containing that quote (term-in-quote)`);
        affected.push(`/keyTerms/${i}/term`, `/keyTerms/${i}/quote`);
      });
      return problems.length === 0
        ? { passed: true, message: `every key term appears in its own quote or in the source sentence containing the quote (term-in-quote)` }
        : { passed: false, message: problems.join('; '), path: affected[0], affected };
    }),

    guarded('OV-03', 'semantic', () => {
      const fields = [
        { path: '/headline', text: g.headline },
        ...g.keyPoints.map((kp, i) => ({ path: `/keyPoints/${i}/point`, text: kp.point })),
        ...g.keyTerms.flatMap((kt, i) => [
          { path: `/keyTerms/${i}/term`, text: kt.term },
          { path: `/keyTerms/${i}/gloss`, text: kt.gloss },
        ]),
      ];
      const hits = fields
        .map(f => ({ ...f, token: findPublisherClaim(f.text, tokens) }))
        .filter(h => h.token !== null);
      return hits.length === 0
        ? { passed: true, message: 'no AI-written overview field names a publisher token from the sources\' own metadata or uses the frozen generic attribution phrases; quotes are exempt (no-publisher-text)' }
        : {
            passed: false,
            message: `publisher claim found at ${hits.map(h => `${h.path}: "${String(h.text).slice(0, 60)}" (token "${h.token}")`).join('; ')} (expected no publisher naming in generated text)`,
            path: hits[0].path,
            affected: hits.map(h => h.path),
          };
    }),

    guarded('OV-04', 'grounding', () => {
      const problems: string[] = [];
      const affected: string[] = [];
      const check = (label: string, text: unknown, ptr: string, texts: (string | undefined)[]): void => {
        const p = numbersCheckProblems(label, text, texts);
        if (p.length > 0) { problems.push(...p); affected.push(ptr); }
      };
      check('headline', g.headline, '/headline', all);
      g.keyPoints.forEach((kp, i) => check(`keyPoints[${i}].point`, kp.point, `/keyPoints/${i}/point`, [idx.textOf(kp.sourceId), ...all]));
      g.keyTerms.forEach((kt, i) => {
        check(`keyTerms[${i}].term`, kt.term, `/keyTerms/${i}/term`, [idx.textOf(kt.sourceId), ...all]);
        check(`keyTerms[${i}].gloss`, kt.gloss, `/keyTerms/${i}/gloss`, [idx.textOf(kt.sourceId), ...all]);
      });
      return problems.length === 0
        ? { passed: true, message: 'every number in AI-written overview text appears on the cited page or in the same quote (N-01) (numbers-checkable)' }
        : { passed: false, message: problems.join('; '), path: affected[0], affected };
    }),

    guarded('OV-05', 'semantic', () => {
      const problems: string[] = [];
      const affected: string[] = [];
      if (g.keyPoints.length < A.keyPoints.min || g.keyPoints.length > A.keyPoints.max) {
        problems.push(`keyPoints has ${g.keyPoints.length} entries, expected ${A.keyPoints.min}-${A.keyPoints.max}`);
        affected.push('/keyPoints');
      }
      if (g.keyTerms.length < A.keyTerms.min || g.keyTerms.length > A.keyTerms.max) {
        problems.push(`keyTerms has ${g.keyTerms.length} entries, expected ${A.keyTerms.min}-${A.keyTerms.max}`);
        affected.push('/keyTerms');
      }
      return problems.length === 0
        ? { passed: true, message: `keyPoints ${g.keyPoints.length} (3-6) and keyTerms ${g.keyTerms.length} (3-8) are within the frozen counts; repair is by retry only (counts-valid)` }
        : { passed: false, message: problems.join('; '), path: affected[0], affected };
    }),

    guarded('OV-06', 'semantic', () => {
      const problems: string[] = [];
      const affected: string[] = [];
      g.keyPoints.forEach((kp, i) => {
        const shared = sharedContentWords(kp.point ?? '', kp.quote ?? '');
        if (shared.length < 2) {
          problems.push(`keyPoints[${i}] (${kp.id}): the point shares ${shared.length} distinct content word(s) (>=4 letters, stoplist applied) with its quote, expected >= 2 (shared: ${shared.join(', ') || 'none'}) — rewrite the point wording toward the quote, never the quote`);
          affected.push(`/keyPoints/${i}/point`);
        }
      });
      g.keyTerms.forEach((kt, i) => {
        const shared = sharedContentWords(kt.gloss ?? '', kt.quote ?? '');
        if (shared.length < 1) {
          problems.push(`keyTerms[${i}] (${kt.id}): the gloss shares no distinct content word (>=4 letters, stoplist applied) with its quote, expected >= 1 — rewrite the gloss wording toward the quote, never the quote`);
          affected.push(`/keyTerms/${i}/gloss`);
        }
      });
      return problems.length === 0
        ? { passed: true, message: 'every key point shares >= 2 and every gloss >= 1 distinct content word (>= 4 letters, frozen stoplist) with its own quote (point-quote-overlap)' }
        : { passed: false, message: problems.join('; '), path: affected[0], affected };
    }),
  ];

  return buildReport('overview-v1', checks, revision);
}
