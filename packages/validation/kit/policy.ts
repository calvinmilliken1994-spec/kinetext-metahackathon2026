// Wave A3 (Stage 6 review S6R-08) — the shared publisher-policy + plain-text sweep over every
// AI-generated DISPLAY field of every kit component.
//
// Why: A-09/OV-03 cover analysis/overview strings, but none of the seven generated kit components
// applied the publisher-attribution policy (docs/ARCHITECTURE.md source-use conditions: never name
// or endorse the publisher in generated text) or the frozen plain-text rule to their own text.
// The prompts forbid it; a prompt is not a deterministic publish gate.
//
// What is swept (enumerated per component from packages/contracts/kit.ts Gen types): titles,
// stems, option texts, hints, step labels / order hints / order note, group and item labels,
// node labels, compare attribute / entity / cell value, formula variable meaning and unit,
// balance hint, overview headline / point / term / gloss.
// What is EXEMPT (verbatim or system-owned, not AI prose): every `quote` and `sourceId`, ids and
// id references (id, groupId, fromId, toId), enums (schemaVersion, orderBasis, relation, side),
// the verbatim formula/equation spans (formulaText, equationText, species formula, expression,
// pageSymbol, variable name, xVariable, case input names) and a formula `meaning` that is flagged
// meaningQuoted AND really occurs in that variable's quote.
//
// overview-v1 is the exception: its publisher rule already has an id (OV-03, same helper, same
// fields), so only the plain-text rule is added to its `schema.gen`.
//
// Check id: no per-component policy id exists in contracts/kit.ts STAGE6_CHECKS (Q-/SEQ-/... have
// none; A-09/OV-03/A-11 are analysis/overview ids) and contracts are frozen for this wave, so the
// sweep is reported under the component's existing structural gate `schema.gen` — the same
// precedent compare-table-v1 set for its page-wording (id-like name) rule. The sweep therefore
// adds NO check id (golden check lists stay `['schema.gen', ...checkIdsFor(c)]`), and its
// affected pointers are exact gen-shape field pointers, so repair authority (recomputed from the
// revision-1 report) is field-scoped: only the offending string may change.

import type { SourceDocument, ValidationCheck, ValidationReport } from '../../contracts/index.ts';
import {
  buildSourceIndex,
  containsNormalized,
  findPublisherClaim,
  mergePublisherTokens,
  plainTextProblems,
  publisherTokensOf,
} from './shared.ts';
import { truncate } from '../validate.ts';

export interface DisplayField { path: string; text: string }
export interface KitPolicyProblems { problems: string[]; affected: string[] }

type Loose = Record<string, unknown>;
const obj = (v: unknown): Loose => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Loose) : {});
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** The AI-written display fields of one component gen, with gen-shape JSON pointers (never throws). */
export function kitDisplayFields(componentId: string, gen: unknown): DisplayField[] {
  const out: DisplayField[] = [];
  const add = (path: string, v: unknown): void => {
    if (typeof v === 'string' && v !== '') out.push({ path, text: v });
  };
  const g = obj(gen);
  const each = (key: string, fn: (item: Loose, ptr: string) => void): void => {
    list(g[key]).forEach((item, i) => fn(obj(item), `/${key}/${i}`));
  };
  switch (componentId) {
    case 'quiz-cards-v1':
      add('/title', g.title);
      each('cards', (c, p) => {
        add(`${p}/stem`, c.stem);
        list(c.options).forEach((o, j) => add(`${p}/options/${j}`, o));
        add(`${p}/hint`, c.hint);
      });
      break;
    case 'sequence-v1':
      add('/title', g.title);
      add('/orderNote', g.orderNote);
      each('steps', (s, p) => {
        add(`${p}/label`, s.label);
        add(`${p}/orderHint`, s.orderHint);
      });
      break;
    case 'sort-groups-v1':
      add('/title', g.title);
      each('groups', (x, p) => add(`${p}/label`, x.label));
      each('items', (x, p) => add(`${p}/label`, x.label));
      break;
    case 'concept-map-v1':
      add('/title', g.title);
      each('nodes', (x, p) => add(`${p}/label`, x.label));
      break;
    case 'compare-table-v1':
      add('/title', g.title);
      list(g.attributes).forEach((a, j) => add(`/attributes/${j}`, a));
      each('rows', (row, p) => {
        add(`${p}/entity`, row.entity);
        list(row.values).forEach((v, j) => add(`${p}/values/${j}/value`, obj(v).value));
      });
      break;
    case 'formula-explorer-v1':
      add('/title', g.title);
      each('variables', (v, p) => {
        // A meaning flagged meaningQuoted is verbatim evidence ONLY while it really occurs in the
        // variable's own quote; otherwise it is AI prose and is swept.
        const verbatim = v.meaningQuoted === true && typeof v.meaning === 'string' && typeof v.quote === 'string'
          && containsNormalized(v.quote, v.meaning);
        if (!verbatim) add(`${p}/meaning`, v.meaning);
        add(`${p}/unit`, v.unit);
      });
      break;
    case 'balance-equation-v1':
      add('/title', g.title);
      add('/hint', g.hint);
      break;
    case 'overview-v1':
      add('/headline', g.headline);
      each('keyPoints', (x, p) => add(`${p}/point`, x.point));
      each('keyTerms', (x, p) => {
        add(`${p}/term`, x.term);
        add(`${p}/gloss`, x.gloss);
      });
      break;
    default:
      break;
  }
  return out;
}

/**
 * Publisher-claim + plain-text problems over the component's display fields. Publisher tokens come
 * from the provided sources' own title/attribution metadata (the same builder and the same
 * narrowed matcher A-09/OV-03 use — lead rulings 3-4): the full publisher name and its acronyms,
 * and "according to" only when a publisher name/acronym follows within ~4 words — never an
 * ordinary single word of the name ("deep ocean") and never "according to the definition".
 * `affected` lists EVERY violating field (once each, document order).
 */
export function kitPolicyProblems(componentId: string, gen: unknown, sources: SourceDocument[]): KitPolicyProblems {
  const idx = buildSourceIndex(Array.isArray(sources) ? sources : []);
  const tokens = mergePublisherTokens([...idx.docById.values()].map(doc => publisherTokensOf(doc)));
  const problems: string[] = [];
  const affected: string[] = [];
  // overview-v1 already owns the publisher rule under its own check id OV-03 (same helper, same
  // fields), so only the plain-text rule is added there; every other component gets both.
  const publisherOwnedElsewhere = componentId === 'overview-v1';
  for (const f of kitDisplayFields(componentId, gen)) {
    const claim = publisherOwnedElsewhere ? null : findPublisherClaim(f.text, tokens);
    const plain = plainTextProblems(f.path, f.text);
    if (claim !== null) {
      problems.push(`publisher claim at ${f.path}: "${truncate(f.text, 60)}" (token "${claim}"; never name or endorse the publisher in generated text)`);
    }
    problems.push(...plain);
    if (claim !== null || plain.length > 0) affected.push(f.path);
  }
  return { problems, affected };
}

/**
 * Fold the policy sweep into a component report's structural gate (`schema.gen`). A clean sweep
 * returns the report untouched; hits flip `schema.gen` to failed (keeping any structural message
 * already there), union the affected pointers, and block publication.
 */
export function applyKitPolicy(componentId: string, gen: unknown, sources: SourceDocument[], report: ValidationReport): ValidationReport {
  let hits: KitPolicyProblems;
  try {
    hits = kitPolicyProblems(componentId, gen, sources);
  } catch (err) {
    hits = { problems: [`policy sweep crashed: ${err instanceof Error ? err.message : String(err)}`], affected: [] };
  }
  if (hits.problems.length === 0) return report;
  const policyMessage = `${hits.problems.join('; ')} (expected plain, publisher-neutral text in every generated display field; verbatim quotes are exempt)`;
  const i = report.checks.findIndex(c => c.id === 'schema.gen');
  const prior: ValidationCheck | undefined = i >= 0 ? report.checks[i] : undefined;
  const affected = [...new Set([...(prior?.passed === false ? (prior.affected ?? []) : []), ...hits.affected])];
  const merged: ValidationCheck = {
    id: 'schema.gen',
    kind: 'schema',
    passed: false,
    message: prior !== undefined && prior.passed === false ? `${prior.message}; ${policyMessage}` : policyMessage,
    ...(affected.length > 0 ? { path: affected[0], affected } : {}),
  };
  const checks = i >= 0 ? report.checks.map((c, k) => (k === i ? merged : c)) : [merged, ...report.checks];
  return { ...report, checks, publishable: false };
}
