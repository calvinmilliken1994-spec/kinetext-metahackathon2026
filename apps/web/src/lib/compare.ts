// Compare table (compare-table-v1) view model (pure): grid lookup and the predict-a-cell plan.
// A cell the page does not state stays blank ("Not stated on this page"), never filled in.

import type { CompareCellGen, CompareTableSpec } from '../../../../packages/contracts/kit.ts';
import { seededOrder } from './seeded.ts';
import { hash32 } from './timeline.ts';
import { concealedKeys } from './conceal.ts';

export const NOT_STATED = 'Not stated on this page';

export interface CompareRow { entity: string; cells: (CompareCellGen | null)[] }
export interface CompareGrid { attributes: string[]; rows: CompareRow[] }

/** Entities down the side, attributes across the top. Cells with a position outside the table, or a second cell for the same position, are ignored. */
export function compareGrid(spec: CompareTableSpec): CompareGrid {
  const rows: CompareRow[] = spec.entities.map((entity) => ({ entity, cells: spec.attributes.map(() => null) }));
  for (const cell of spec.cells) {
    const row = rows[cell.entityIndex];
    if (row === undefined || !Number.isInteger(cell.attributeIndex) || cell.attributeIndex < 0 || cell.attributeIndex >= spec.attributes.length) continue;
    if (row.cells[cell.attributeIndex] === null) row.cells[cell.attributeIndex] = cell;
  }
  return { attributes: [...spec.attributes], rows };
}

export interface PredictPlan {
  /** The cell that is hidden until the learner chooses. */
  cellId: string;
  entityIndex: number;
  attributeIndex: number;
  /** The cell's stored value. */
  correct: string;
  /** Three distinct values from the same column in a seeded order (the right one is never first). */
  options: string[];
}

const norm = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Choose the hidden cell and its three options, or null when no column has three different values
 * (the view then falls back to reveal-only). The choice is seeded, so a lecture demo hides the same cell every time.
 */
export function planPredict(spec: CompareTableSpec): PredictPlan | null {
  const grid = compareGrid(spec);
  const candidates: { cell: CompareCellGen; distractors: string[] }[] = [];
  for (let a = 0; a < spec.attributes.length; a++) {
    const column = grid.rows.map((r) => r.cells[a]).filter((c): c is CompareCellGen => c !== null && c !== undefined);
    for (const cell of column) {
      const distractors: string[] = [];
      for (const other of column) {
        if (norm(other.value) === norm(cell.value) || distractors.some((d) => norm(d) === norm(other.value))) continue;
        distractors.push(other.value);
      }
      if (distractors.length >= 2) candidates.push({ cell, distractors: distractors.slice(0, 2) });
    }
  }
  if (candidates.length === 0) return null;
  const seed = `${spec.seed}:${spec.id}`;
  const pick = candidates[hash32(seed) % candidates.length] as { cell: CompareCellGen; distractors: string[] };
  const options = seededOrder([pick.cell.value, ...pick.distractors], `${seed}:options`, { avoidFirst: pick.cell.value });
  return { cellId: pick.cell.id, entityIndex: pick.cell.entityIndex, attributeIndex: pick.cell.attributeIndex, correct: pick.cell.value, options };
}

/**
 * The link keys of every cell quote that would give the hidden cell away while it is open (lib/conceal.ts): its own
 * sentence, and any other cell's sentence that states its value. Lesson and presentation use the same set.
 */
export function compareConcealed(spec: CompareTableSpec, plan: PredictPlan | null): Set<string> {
  if (plan === null) return new Set();
  const hidden = spec.cells.find((c) => c.id === plan.cellId);
  if (hidden === undefined) return new Set();
  return concealedKeys(spec.cells, { quote: { sourceId: hidden.sourceId, quote: hidden.quote }, values: [hidden.value] });
}

export function gradePredict(plan: PredictPlan, pickedValue: string): boolean {
  return norm(pickedValue) === norm(plan.correct);
}
