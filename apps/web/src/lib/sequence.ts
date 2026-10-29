// Sequence (sequence-v1) view model (pure): starting shuffle and grading. The key is the stored step order; a cycle
// (cyclic: true, page-stated) accepts any starting point because a cycle has none. Grading proves an order, not that the
// page's order is scientifically right.

import type { SequenceSpec } from '../../../../packages/contracts/kit.ts';
import { seededOrder } from './seeded.ts';

/** Step ids in the shuffled starting order (never the answer). */
export function sequenceStart(spec: SequenceSpec): string[] {
  return seededOrder(spec.steps.map((s) => s.id), `${spec.seed}:${spec.id}`);
}

export interface SequenceGrade {
  total: number;
  /** Aligned to the learner's list: true when that step is in the right place. */
  positions: boolean[];
  rightCount: number;
  correct: boolean;
  /** The stored order (for a cycle: one of its equally good rotations). */
  correctOrderIds: string[];
  cyclic: boolean;
}

export function gradeSequence(spec: SequenceSpec, order: readonly string[]): SequenceGrade {
  const stored = spec.steps.map((s) => s.id);
  const n = stored.length;
  const isPermutation = order.length === n && new Set(order).size === n && order.every((id) => stored.includes(id));
  const cyclic = spec.cyclic === true;
  const rotations = cyclic && isPermutation ? n : 1;
  let bestShift = 0;
  let bestMatches = -1;
  for (let k = 0; k < rotations; k++) {
    const matches = order.reduce((acc, id, i) => acc + (id === stored[(i + k) % n] ? 1 : 0), 0);
    if (matches > bestMatches) { bestMatches = matches; bestShift = k; }
  }
  const positions = order.map((id, i) => id === stored[(i + bestShift) % n]);
  const rightCount = positions.filter(Boolean).length;
  return {
    total: n,
    positions,
    rightCount,
    correct: isPermutation && rightCount === n,
    correctOrderIds: stored.map((_, i) => stored[(i + bestShift) % n] as string),
    cyclic,
  };
}

/** Plain-language result line. */
export function sequenceSummary(grade: SequenceGrade, labels: Readonly<Record<string, string>>, spec: SequenceSpec): string {
  if (grade.correct) {
    if (!grade.cyclic) return `✓ Correct — all ${grade.total} steps are in the order the page gives.`;
    const first = spec.steps[0];
    const start = first === undefined ? '' : ` The page starts at “${labels[first.id] ?? first.label}”.`;
    return `✓ Correct — this is a cycle, so any starting point works.${start}`;
  }
  return `✗ ${grade.rightCount} of ${grade.total} steps are in the right place. Move the marked steps and check again.`;
}
