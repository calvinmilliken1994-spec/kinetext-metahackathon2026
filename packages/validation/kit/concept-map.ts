// S6-V — concept-map-v1 validation (CM-01..CM-06, design §2.5 frozen) + the link drop helper
// ("drop link while >= 3 remain"). Day-1 rendering is read-only; unverified links never render.
//
// CM-03 relation-in-quote — recorded interpretation (the design names the check but does not
// spell out the matching rule; the golden fixture's relations ("uses"/"needs" over drag-equation
// quotes) cannot be literal substrings of the quotes): the relation must be grounded by
//   (a) the relation phrase itself in the quote ("part of" for "is part of"), OR
//   (b) one of the relation's frozen trigger words in the quote or in the source sentence
//       containing the located quote.
// The trigger table below is frozen with this validator. On formula pages a relation between two
// quantities is stated by the equation's own connectors, so "needs"/"uses" also accept the
// equation-dependency triggers (times, multiplied, divided, equal to, squared). False accepts on
// loose wording are disclosed by the design (§2.5d); every quote is shown to the teacher.

import type { SourceDocument, ValidationCheck, ValidationReport } from '../../contracts/index.ts';
import { CONCEPT_MAP_RELATIONS, KIT_LIMITS } from '../../contracts/kit.ts';
import type { ConceptMapGen, ConceptMapRelation } from '../../contracts/kit.ts';
import { guarded, normalizeWhitespace } from '../validate.ts';
import {
  buildReport,
  buildSourceIndex,
  collectQuoteFailures,
  containsNormalized,
  duplicateOccurrences,
  idProblems,
  itemIndicesWithFailures,
  KIT_FAILURE_MESSAGES,
  numbersCheckProblems,
} from './shared.ts';
import { labelInQuoteOrParagraph } from './sort.ts';
import type { DroppedItem, PruneResult } from './quiz.ts';

const L = KIT_LIMITS.conceptMap;

/** Frozen CM-03 trigger table (see module header). */
export const RELATION_TRIGGERS: Readonly<Record<ConceptMapRelation, readonly string[]>> = {
  'causes': ['cause', 'causes', 'caused', 'causing', 'leads to', 'lead to', 'leading to', 'results in', 'result in', 'produces', 'produce', 'producing', 'creates', 'create', 'generates', 'generate', 'brings about', 'makes', 'make'],
  'needs': ['need', 'needs', 'needed', 'require', 'requires', 'required', 'depends on', 'depend on', 'dependent', 'without', 'times', 'multiplied', 'divided', 'equal to', 'squared'],
  'is part of': ['part of', 'parts of', 'member of', 'includes', 'include', 'including', 'consists of', 'composed of', 'comprises', 'comprise', 'within', 'contains', 'contain', 'subset'],
  'uses': ['use', 'uses', 'used', 'using', 'times', 'multiplied', 'divided', 'via', 'employs', 'employ', 'equal to', 'based on', 'squared'],
  'follows': ['follow', 'follows', 'followed', 'following', 'after', 'next', 'then', 'subsequent', 'succeeds', 'comes after'],
  'contrasts with': ['contrast', 'contrasts', 'contrasting', 'unlike', 'versus', 'vs', 'differs', 'differ', 'different from', 'opposite', 'whereas'],
};

/** The relation phrase matched literally inside a quote ('is part of' also matches 'part of'). */
export function relationPhrases(relation: ConceptMapRelation): string[] {
  const phrases: string[] = [relation];
  if (relation === 'is part of') phrases.push('part of');
  if (relation === 'contrasts with') phrases.push('contrasts with', 'contrast with');
  return phrases;
}

export function conceptMapStructuralProblems(gen: ConceptMapGen): { problems: string[]; affected: string[] } {
  const problems: string[] = [];
  const affected: string[] = [];
  const push = (p: string[], ptr: string): void => { if (p.length > 0) { problems.push(...p); affected.push(ptr); } };
  if (typeof gen.title !== 'string' || gen.title === '') { problems.push('title must be a non-empty string'); affected.push('/title'); }
  const nodeIds = gen.nodes.map(n => n.id);
  const nodeDups = duplicateOccurrences(nodeIds);
  gen.nodes.forEach((n, i) => {
    push(idProblems(`nodes[${i}].id`, n.id), `/nodes/${i}/id`);
    if (nodeDups.has(n.id)) { problems.push(`node id "${n.id}" occurs more than once (expected unique ids)`); affected.push(`/nodes/${i}/id`); }
    if (typeof n.label !== 'string' || n.label === '') { problems.push(`nodes[${i}].label must be a non-empty string`); affected.push(`/nodes/${i}/label`); }
  });
  const linkIds = gen.links.map(l => l.id);
  const linkDups = duplicateOccurrences(linkIds);
  gen.links.forEach((l, i) => {
    push(idProblems(`links[${i}].id`, l.id), `/links/${i}/id`);
    if (linkDups.has(l.id)) { problems.push(`link id "${l.id}" occurs more than once (expected unique ids)`); affected.push(`/links/${i}/id`); }
  });
  return { problems, affected };
}

export function validateConceptMap(gen: ConceptMapGen, sources: SourceDocument[], opts: { revision?: number } = {}): ValidationReport {
  const idx = buildSourceIndex(sources);
  const all = idx.allTexts();
  const structural = conceptMapStructuralProblems(gen);
  const nodeById = new Map(gen.nodes.map((n, i) => [n.id, { n, i }]));

  const checks: ValidationCheck[] = [
    structural.problems.length === 0
      ? { id: 'schema.gen', kind: 'schema', passed: true, message: 'every concept-map id pattern, id uniqueness and label shape is within the frozen limits' }
      : { id: 'schema.gen', kind: 'schema', passed: false, message: `concept-map gen failed the structural limits: ${structural.problems.join('; ')}`, path: structural.affected[0], affected: structural.affected },

    guarded('CM-01', 'grounding', () => {
      const { problems, affected, grounded } = collectQuoteFailures(
        gen.links.map((l, i) => ({ quote: l.quote, sourceId: l.sourceId, quotePtr: `/links/${i}/quote`, sourceIdPtr: `/links/${i}/sourceId`, label: `links[${i}] (${l.id})` })),
        idx,
      );
      return problems.length === 0
        ? { passed: true, message: `all ${grounded} link quote(s) appear verbatim in their cited source after whitespace normalisation (quotes-verbatim)` }
        : { passed: false, message: `${problems.join('; ')} (expected verbatim quotes of 1-${KIT_LIMITS.common.quote.max} characters from the cited source)`, path: affected[0], affected };
    }),

    guarded('CM-02', 'grounding', () => {
      const problems: string[] = [];
      const affected: string[] = [];
      gen.links.forEach((l, i) => {
        const from = nodeById.get(l.fromId)?.n;
        const to = nodeById.get(l.toId)?.n;
        if (from === undefined || to === undefined) return; // CM-04 owns unknown endpoints
        const fromIn = containsNormalized(l.quote ?? '', from.label ?? '');
        const toIn = containsNormalized(l.quote ?? '', to.label ?? '');
        if (!fromIn && !toIn) {
          problems.push(`links[${i}] (${l.id}): neither endpoint label ("${from.label}", "${to.label}") occurs in the quote — one endpoint label must be IN the quote (endpoints-in-quote)`);
          affected.push(`/links/${i}/fromId`, `/links/${i}/toId`, `/links/${i}/quote`);
          return;
        }
        const other = fromIn ? to : from;
        const otherIn = fromIn ? toIn : fromIn;
        if (!otherIn && !labelInQuoteOrParagraph(other.label ?? '', l.quote ?? '', l.sourceId ?? '', idx)) {
          problems.push(`links[${i}] (${l.id}): the other endpoint label "${other.label}" occurs neither in the quote nor in the same paragraph as the located quote span (endpoints-in-quote)`);
          affected.push(`/links/${i}/quote`);
        }
      });
      return problems.length === 0
        ? { passed: true, message: 'every link has one endpoint label in its quote and the other in the quote or the same source paragraph (endpoints-in-quote; paragraph-level co-mention without a stated link is the design-disclosed false accept — quotes are visible)' }
        : { passed: false, message: problems.join('; '), path: affected[0], affected };
    }),

    guarded('CM-03', 'semantic', () => {
      const problems: string[] = [];
      const affected: string[] = [];
      gen.links.forEach((l, i) => {
        const relation = l.relation;
        if (!(CONCEPT_MAP_RELATIONS as readonly string[]).includes(relation)) {
          problems.push(`links[${i}] (${l.id}): relation ${JSON.stringify(relation)} is not in the frozen vocabulary ${CONCEPT_MAP_RELATIONS.join(' | ')}`);
          affected.push(`/links/${i}/relation`);
          return;
        }
        const quoteLower = normalizeWhitespace(l.quote ?? '').toLowerCase();
        if (relationPhrases(relation).some(p => quoteLower.includes(p))) return;
        const sentence = typeof l.sourceId === 'string' ? idx.sentenceOf(l.quote ?? '', l.sourceId) : null;
        const triggers = RELATION_TRIGGERS[relation] ?? [];
        const hit = triggers.some(t => quoteLower.includes(t) || (sentence !== null && sentence.toLowerCase().includes(t)));
        if (!hit) {
          problems.push(`links[${i}] (${l.id}): the relation "${relation}" is not grounded — neither the relation phrase nor one of its trigger words (${triggers.slice(0, 6).join(', ')}, ...) occurs in the quote or its source sentence (relation-in-quote)`);
          affected.push(`/links/${i}/relation`, `/links/${i}/quote`);
        }
      });
      return problems.length === 0
        ? { passed: true, message: 'every link relation is in the frozen vocabulary and grounded by the relation phrase or a frozen trigger word in the quote or its source sentence (relation-in-quote)' }
        : { passed: false, message: problems.join('; '), path: affected[0], affected };
    }),

    guarded('CM-04', 'semantic', () => {
      const problems: string[] = [];
      const affected: string[] = [];
      const seenPairs = new Set<string>();
      const adj = new Map<string, Set<string>>();
      gen.nodes.forEach(n => adj.set(n.id, new Set()));
      gen.links.forEach((l, i) => {
        if (!nodeById.has(l.fromId)) {
          problems.push(`links[${i}] (${l.id}): fromId "${l.fromId}" is not a declared node`);
          affected.push(`/links/${i}/fromId`);
        }
        if (!nodeById.has(l.toId)) {
          problems.push(`links[${i}] (${l.id}): toId "${l.toId}" is not a declared node`);
          affected.push(`/links/${i}/toId`);
        }
        if (l.fromId === l.toId) {
          problems.push(`links[${i}] (${l.id}): self-loop on node "${l.fromId}" (expected no self-loops)`);
          affected.push(`/links/${i}/fromId`, `/links/${i}/toId`);
        }
        const pair = [l.fromId, l.toId].sort().join('\u0000');
        if (seenPairs.has(pair)) {
          problems.push(`links[${i}] (${l.id}): duplicates an existing link between "${l.fromId}" and "${l.toId}" (expected no duplicate links)`);
          affected.push(`/links/${i}/fromId`, `/links/${i}/toId`);
        }
        seenPairs.add(pair);
        adj.get(l.fromId)?.add(l.toId);
        adj.get(l.toId)?.add(l.fromId);
      });
      // Connectivity over declared nodes (undirected).
      if (gen.nodes.length > 0 && problems.length === 0) {
        const start = (gen.nodes[0] as { id: string }).id;
        const seen = new Set<string>([start]);
        const queue = [start];
        while (queue.length > 0) {
          const cur = queue.shift() as string;
          for (const nxt of adj.get(cur) ?? []) {
            if (!seen.has(nxt)) { seen.add(nxt); queue.push(nxt); }
          }
        }
        if (seen.size !== gen.nodes.length) {
          const isolated = gen.nodes.filter(n => !seen.has(n.id)).map(n => `"${n.label}"`);
          problems.push(`the graph is not connected: ${isolated.join(', ')} cannot be reached from "${(gen.nodes[0] as { id: string; label: string }).label}" (graph-connected)`);
          affected.push('/links');
        }
      }
      return problems.length === 0
        ? { passed: true, message: `the map is connected over all ${gen.nodes.length} nodes with no self-loops or duplicate links (graph-connected)` }
        : { passed: false, message: problems.join('; '), path: affected[0], affected };
    }),

    guarded('CM-05', 'semantic', () => {
      const problems: string[] = [];
      const affected: string[] = [];
      if (gen.nodes.length < L.nodes.min || gen.nodes.length > L.nodes.max) {
        problems.push(`nodes has ${gen.nodes.length} entries, expected ${L.nodes.min}-${L.nodes.max}`);
        affected.push('/nodes');
      }
      if (gen.links.length < L.links.min || gen.links.length > L.links.max) {
        problems.push(`links has ${gen.links.length} entries, expected ${L.links.min}-${L.links.max}`);
        affected.push('/links');
      }
      return problems.length === 0
        ? { passed: true, message: `nodes ${gen.nodes.length} (${L.nodes.min}-${L.nodes.max}) and links ${gen.links.length} (${L.links.min}-${L.links.max}) are within the frozen counts (counts-valid)` }
        : { passed: false, message: problems.join('; '), path: affected[0], affected };
    }),

    guarded('CM-06', 'grounding', () => {
      const problems: string[] = [];
      const affected: string[] = [];
      if (typeof gen.title === 'string') {
        const p = numbersCheckProblems('title', gen.title, all);
        if (p.length > 0) { problems.push(...p); affected.push('/title'); }
      }
      gen.nodes.forEach((n, i) => {
        const p = numbersCheckProblems(`nodes[${i}].label`, n.label, all);
        if (p.length > 0) { problems.push(...p); affected.push(`/nodes/${i}/label`); }
      });
      return problems.length === 0
        ? { passed: true, message: 'every number in node labels and the title appears on a provided page (N-01) (numbers-checkable)' }
        : { passed: false, message: problems.join('; '), path: affected[0], affected };
    }),
  ];

  return buildReport('concept-map-v1', checks, opts.revision ?? 1);
}

/** Design §2.5(d): drop failing links while >= 3 remain; the map is revalidated after every drop. */
export function pruneConceptMapLinks(gen: ConceptMapGen, sources: SourceDocument[]): PruneResult<ConceptMapGen> {
  const failureMessage = KIT_FAILURE_MESSAGES['concept-map-v1'] as string;
  let current: ConceptMapGen = { ...gen, nodes: [...gen.nodes], links: [...gen.links] };
  const dropped: DroppedItem[] = [];
  const originalIndex = current.links.map((_, i) => i);
  for (;;) {
    const report = validateConceptMap(current, sources);
    if (report.publishable) return { gen: current, dropped, failureMessage: null };
    if (current.links.length <= L.links.min) return { gen: null, dropped, failureMessage };
    const byItem = itemIndicesWithFailures(report, '/links');
    const itemScoped = [...byItem.entries()].filter(([i]) => i >= 0 && i < current.links.length);
    if (itemScoped.length === 0) return { gen: null, dropped, failureMessage };
    itemScoped.sort((a, b) => b[1].length - a[1].length || a[0] - b[0]);
    const [i, checks] = itemScoped[0] as [number, string[]];
    const link = current.links[i] as { id: string };
    dropped.push({ index: originalIndex[i] as number, id: link.id, reason: `link failed ${checks.join(', ')}`, checks });
    current = { ...current, links: current.links.filter((_, j) => j !== i) };
    originalIndex.splice(i, 1);
  }
}
