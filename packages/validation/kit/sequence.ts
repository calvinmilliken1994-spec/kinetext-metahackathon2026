// S6-V — sequence-v1 validation (SEQ-01..SEQ-06, design §2.3 frozen) + the per-item drop helper
// ("drop single bad steps only while >= 4 remain"). Array order is the taught order.
//
// SEQ-03 order-basis-holds (verified by our code, no model judgement):
//   - orderBasis 'page-order': the start offset of each step's quote in its source's normalised
//     text strictly ascends in array order. Steps citing different documents compare by
//     (document index in the provided sources list, offset) — recorded interpretation: a
//     sequence should cite one document; across documents the provided-source order decides.
//   - orderBasis 'numbered': every quote carries an order signal (ordinal word first..twentieth,
//     numeric ordinal 1st..31st, "step N", "phase N", or a leading enumeration "N." / "N)") and
//     the signals strictly ascend in array order.
//   Dated-event sets are the timeline's job (design guidance); the golden constitution sequence
//   quotes dates inside page-order steps and passes — SEQ-03 checks only the stated basis.

import type { SourceDocument, ValidationCheck, ValidationReport } from '../../contracts/index.ts';
import { KIT_LIMITS } from '../../contracts/kit.ts';
import type { SequenceGen } from '../../contracts/kit.ts';
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
  lengthProblems,
  numbersCheckProblems,
  optionalLengthProblems,
} from './shared.ts';
import type { DroppedItem, PruneResult } from './quiz.ts';

const S = KIT_LIMITS.sequence;

const ORDINAL_WORDS: readonly string[] = [
  'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth',
  'eleventh', 'twelfth', 'thirteenth', 'fourteenth', 'fifteenth', 'sixteenth', 'seventeenth',
  'eighteenth', 'nineteenth', 'twentieth',
];

/** The order signals of one quote, as numeric values (ordinal words, numeric ordinals, step/phase N, leading enumeration). */
export function orderSignals(quote: string): number[] {
  const text = normalizeWhitespace(quote ?? '').toLowerCase();
  const out: number[] = [];
  ORDINAL_WORDS.forEach((w, i) => {
    if (new RegExp(`\\b${w}\\b`).test(text)) out.push(i + 1);
  });
  for (const m of text.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)\b/g)) out.push(Number(m[1]));
  for (const m of text.matchAll(/\b(?:step|phase|stage)\s+(\d{1,2})\b/g)) out.push(Number(m[1]));
  const lead = /^\(?\s*(\d{1,2})\s*[.)]/.exec(text);
  if (lead !== null) out.push(Number(lead[1]));
  return out;
}

export function sequenceStructuralProblems(gen: SequenceGen): { problems: string[]; affected: string[] } {
  const problems: string[] = [];
  const affected: string[] = [];
  const push = (p: string[], ptr: string): void => { if (p.length > 0) { problems.push(...p); affected.push(ptr); } };
  if (typeof gen.title !== 'string' || gen.title === '') { problems.push('title must be a non-empty string'); affected.push('/title'); }
  push(optionalLengthProblems('orderNote', gen.orderNote, S.orderNote.min, S.orderNote.max), '/orderNote');
  const ids = gen.steps.map(s => s.id);
  const dups = duplicateOccurrences(ids);
  gen.steps.forEach((step, i) => {
    push(idProblems(`steps[${i}].id`, step.id), `/steps/${i}/id`);
    if (dups.has(step.id)) { problems.push(`step id "${step.id}" occurs more than once (expected unique ids)`); affected.push(`/steps/${i}/id`); }
    push(lengthProblems(`steps[${i}].label`, step.label, S.label.min, S.label.max), `/steps/${i}/label`);
  });
  return { problems, affected };
}

export function validateSequence(gen: SequenceGen, sources: SourceDocument[], opts: { revision?: number } = {}): ValidationReport {
  const idx = buildSourceIndex(sources);
  const all = idx.allTexts();
  const structural = sequenceStructuralProblems(gen);
  const docOrder = new Map<string, number>();
  [...idx.docById.keys()].forEach((id, i) => docOrder.set(id, i));

  const checks: ValidationCheck[] = [
    structural.problems.length === 0
      ? { id: 'schema.gen', kind: 'schema', passed: true, message: 'every sequence text length, id pattern and id uniqueness is within the frozen limits' }
      : { id: 'schema.gen', kind: 'schema', passed: false, message: `sequence gen failed the structural limits: ${structural.problems.join('; ')}`, path: structural.affected[0], affected: structural.affected },

    guarded('SEQ-01', 'grounding', () => {
      const { problems, affected, grounded } = collectQuoteFailures(
        gen.steps.map((s, i) => ({ quote: s.quote, sourceId: s.sourceId, quotePtr: `/steps/${i}/quote`, sourceIdPtr: `/steps/${i}/sourceId`, label: `steps[${i}] (${s.id})` })),
        idx,
      );
      return problems.length === 0
        ? { passed: true, message: `all ${grounded} step quote(s) appear verbatim in their cited source after whitespace normalisation (quotes-verbatim)` }
        : { passed: false, message: `${problems.join('; ')} (expected verbatim quotes of 1-${KIT_LIMITS.common.quote.max} characters from the cited source)`, path: affected[0], affected };
    }),

    guarded('SEQ-02', 'semantic', () => {
      const problems: string[] = [];
      const affected: string[] = [];
      gen.steps.forEach((step, i) => {
        if (!containsNormalized(step.quote ?? '', step.label ?? '')) {
          problems.push(`steps[${i}] (${step.id}): the label "${step.label}" does not occur in its quote (labels-in-quotes)`);
          affected.push(`/steps/${i}/label`, `/steps/${i}/quote`);
        }
      });
      return problems.length === 0
        ? { passed: true, message: 'every step label occurs in its own quote after normalisation (labels-in-quotes)' }
        : { passed: false, message: problems.join('; '), path: affected[0], affected };
    }),

    guarded('SEQ-03', 'behavioral', () => {
      const problems: string[] = [];
      const affected: string[] = [];
      if (gen.orderBasis === 'page-order') {
        let prev: { doc: number; offset: number; i: number } | null = null;
        gen.steps.forEach((step, i) => {
          const offset = idx.locate(step.quote ?? '', step.sourceId ?? '');
          if (offset < 0) return; // SEQ-01 owns unlocatable quotes
          const doc = docOrder.get(step.sourceId) ?? -1;
          if (prev !== null) {
            const ascends = doc > prev.doc || (doc === prev.doc && offset > prev.offset);
            if (!ascends) {
              problems.push(`steps[${i}] (${step.id}) starts at offset ${offset} of source "${step.sourceId}", not after steps[${prev.i}] (offset ${prev.offset}) — page-order requires strictly ascending quote start offsets in array order`);
              affected.push(`/steps/${i}/quote`, `/steps/${i}/sourceId`);
            }
          }
          prev = { doc, offset, i };
        });
      } else if (gen.orderBasis === 'numbered') {
        let prevValue: number | null = null;
        let prevI = -1;
        gen.steps.forEach((step, i) => {
          const signals = orderSignals(step.quote ?? '');
          if (signals.length === 0) {
            problems.push(`steps[${i}] (${step.id}): the quote carries no order signal (ordinal word/number, "step N" or a leading enumeration) but orderBasis is "numbered"`);
            affected.push(`/steps/${i}/quote`, '/orderBasis');
            return;
          }
          const value = Math.min(...signals);
          if (prevValue !== null && value <= prevValue) {
            problems.push(`steps[${i}] (${step.id}) carries order signal ${value}, not strictly after steps[${prevI}] (signal ${prevValue}) — numbered order must ascend in array order`);
            affected.push(`/steps/${i}/quote`, `/steps/${i}/orderHint`);
          }
          prevValue = value;
          prevI = i;
        });
      }
      return problems.length === 0
        ? { passed: true, message: `the stated order basis "${gen.orderBasis}" holds: ${gen.orderBasis === 'page-order' ? 'quote start offsets strictly ascend in array order' : 'every quote carries an ascending order signal'} (computed by our code; this proves an order signal, not scientific correctness) (order-basis-holds)` }
        : { passed: false, message: problems.join('; '), path: affected[0], affected };
    }),

    guarded('SEQ-04', 'semantic', () => {
      const problems: string[] = [];
      const affected: string[] = [];
      const labels = gen.steps.map(s => normalizeWhitespace(s.label ?? '').toLowerCase());
      const dups = duplicateOccurrences(labels.filter(l => l !== ''));
      gen.steps.forEach((step, i) => {
        const key = normalizeWhitespace(step.label ?? '').toLowerCase();
        if (key !== '' && dups.has(key)) {
          problems.push(`steps[${i}]: the label "${step.label}" duplicates another step's label (distinct-steps)`);
          affected.push(`/steps/${i}/label`);
        }
      });
      return problems.length === 0
        ? { passed: true, message: 'every step has a distinct label after normalisation (distinct-steps)' }
        : { passed: false, message: problems.join('; '), path: affected[0], affected };
    }),

    guarded('SEQ-05', 'semantic', () => {
      const problems: string[] = [];
      const affected: string[] = [];
      if (gen.steps.length < S.steps.min || gen.steps.length > S.steps.max) {
        problems.push(`steps has ${gen.steps.length} entries, expected ${S.steps.min}-${S.steps.max}`);
        affected.push('/steps');
      }
      return problems.length === 0
        ? { passed: true, message: `steps count ${gen.steps.length} is within ${S.steps.min}-${S.steps.max}; repair is by retry only (count-valid)` }
        : { passed: false, message: problems.join('; '), path: affected[0], affected };
    }),

    guarded('SEQ-06', 'grounding', () => {
      const problems: string[] = [];
      const affected: string[] = [];
      if (typeof gen.title === 'string') {
        const p = numbersCheckProblems('title', gen.title, all);
        if (p.length > 0) { problems.push(...p); affected.push('/title'); }
      }
      const on = numbersCheckProblems('orderNote', gen.orderNote, all);
      if (on.length > 0) { problems.push(...on); affected.push('/orderNote'); }
      gen.steps.forEach((step, i) => {
        const texts = [idx.textOf(step.sourceId), ...all];
        for (const [label, text, ptr] of [
          [`steps[${i}].label`, step.label, `/steps/${i}/label`],
          [`steps[${i}].orderHint`, step.orderHint, `/steps/${i}/orderHint`],
        ] as [string, unknown, string][]) {
          const p = numbersCheckProblems(label, text, texts);
          if (p.length > 0) { problems.push(...p); affected.push(ptr); }
        }
      });
      return problems.length === 0
        ? { passed: true, message: 'every number in labels, order hints and notes appears on the cited page or in the same quote (N-01) (numbers-checkable)' }
        : { passed: false, message: problems.join('; '), path: affected[0], affected };
    }),
  ];

  return buildReport('sequence-v1', checks, opts.revision ?? 1);
}

/** Design §2.3(f): drop single bad steps only while >= 4 remain. */
export function pruneSequenceSteps(gen: SequenceGen, sources: SourceDocument[]): PruneResult<SequenceGen> {
  const failureMessage = KIT_FAILURE_MESSAGES['sequence-v1'] as string;
  let current: SequenceGen = { ...gen, steps: [...gen.steps] };
  const dropped: DroppedItem[] = [];
  const originalIndex = current.steps.map((_, i) => i);
  for (;;) {
    const report = validateSequence(current, sources);
    if (report.publishable) return { gen: current, dropped, failureMessage: null };
    if (current.steps.length <= S.steps.min) return { gen: null, dropped, failureMessage };
    const byItem = itemIndicesWithFailures(report, '/steps');
    const itemScoped = [...byItem.entries()].filter(([i]) => i >= 0 && i < current.steps.length);
    if (itemScoped.length === 0) return { gen: null, dropped, failureMessage };
    itemScoped.sort((a, b) => b[1].length - a[1].length || a[0] - b[0]);
    const [i, checks] = itemScoped[0] as [number, string[]];
    const step = current.steps[i] as { id: string };
    dropped.push({ index: originalIndex[i] as number, id: step.id, reason: `step failed ${checks.join(', ')}`, checks });
    current = { ...current, steps: current.steps.filter((_, j) => j !== i) };
    originalIndex.splice(i, 1);
  }
}
