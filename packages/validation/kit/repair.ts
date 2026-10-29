// S6-V — v2 repair comparison for kit components and SourceAnalysisV2 (design §5.4 + lead freeze
// addendum: "validator-owned `affected` paths recomputed from revision 1; ids stable; never
// weaken; repair returns a FULL corrected spec; the validator rejects any change outside
// `affected`").
//
// Discipline (mirrors the v1/timeline comparators):
//   - ONE AUTHORITY: the allowed change paths are the failing checks' validator-owned `affected`
//     JSON-pointers of an EXACT revalidation of the immutable revision-1 baseline against the
//     provided sources. Caller-supplied findings may only NARROW that authority (intersection
//     by check id AND exact affected path), consistently: a findings list that is empty, names a
//     check that passed on recomputation, or names a path the recomputed failure does not carry,
//     unlocks NOTHING. Without sources nothing is recomputable and every change fails closed.
//   - ids stable: item counts are frozen (the SYSTEM prunes via the drop helpers, never the
//     model) and `/id` leaves may change only when the revision-1 authority names that exact id
//     path (e.g. a duplicate-id finding), and then only to a valid id that is not another
//     baseline sibling id.
//   - never weaken: a `tolerance` leaf never increases (no exceptions, v1 rule), plus
//     component-specific rules supplied by the caller (range widths, hasSourceExample, usable).
// Returns the v1-convention 'repair.no-weakening' ValidationCheck. Never throws.

import type { RepairFinding, SourceDocument, ValidationCheck, ValidationReport } from '../../contracts/index.ts';
import { KIT_ID_PATTERN } from '../../contracts/kit.ts';
import { affectedByCheckIdOf, affectedPathsOf, COMPARISON_MESSAGE_LIMIT, COMPARISON_PROBLEM_LIMIT, errMsg, truncate } from '../validate.ts';

export interface RevisionGuardContext {
  /** The source documents: required to recompute the revision-1 authority (fail closed without). */
  sources?: SourceDocument[];
  /** repairFindings() of the baseline report handed to the model; may only NARROW the recomputed authority. */
  findings?: RepairFinding[];
}

export interface RevisionGuardOptions {
  /** Display label, e.g. 'quiz-cards-v1 revision 2'. */
  targetLabel: string;
  /** Recompute the baseline (revision 1) report — the only authority. */
  recompute: (baseline: unknown, sources: SourceDocument[]) => ValidationReport;
  /** Component-specific never-weaken rules; returns violation messages. */
  extraRules?: (args: { baseline: unknown; next: unknown; report: ValidationReport; allowed: string[] }) => string[];
  /**
   * Opt-in exception to the frozen-list-length rule for ONE list the revision-1 authority
   * explicitly names (compare-table-v1 CT-03: a short row's `/rows/i/values`; analysis-v2
   * A-04/A-07/A-08: an undersized overview list or plan). Return true only when the exact list
   * pointer is authorized AND the concrete length change is the structural one the finding
   * licenses (e.g. a pure append, or a resize onto the column count).
   *
   * STRUCTURAL PERMISSION ONLY (S6R-06/S6R-10). Naming a list pointer licenses its length change
   * but grants NO content authority over the retained prefix items: for every change beneath a
   * resized list the list pointer and its ancestors are removed from the authority, so a prefix
   * leaf may change only when its own validator-owned affected path names it.
   */
  allowListResize?: (args: { pointer: string; allowed: readonly string[]; before: number; after: number }) => boolean;
}

interface LeafChange { pointer: string; before: unknown; after: unknown }
interface LengthChange { pointer: string; before: number; after: number }
interface DiffResult { changed: LeafChange[]; structural: string[]; lengths: LengthChange[] }

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Positional deep diff. Array length changes and root-shape changes are `structural`, except a list whose length change `resizeAllowed` authorizes (recorded in `lengths`, common prefix still diffed; the caller must then withhold the list pointer's own descendant authority). */
export function leafDiff(a: unknown, b: unknown, pointer = '', resizeAllowed: (ptr: string, before: number, after: number) => boolean = () => false): DiffResult {
  const out: DiffResult = { changed: [], structural: [], lengths: [] };
  const walk = (x: unknown, y: unknown, ptr: string): void => {
    if (Array.isArray(x) || Array.isArray(y)) {
      if (!Array.isArray(x) || !Array.isArray(y)) {
        out.structural.push(ptr === '' ? '(root)' : ptr);
        return;
      }
      if (x.length !== y.length) {
        if (resizeAllowed(ptr, x.length, y.length)) {
          out.lengths.push({ pointer: ptr === '' ? '(root list)' : ptr, before: x.length, after: y.length });
          for (let i = 0; i < Math.min(x.length, y.length); i++) walk(x[i], y[i], `${ptr}/${i}`);
          return;
        }
        out.structural.push(ptr === '' ? '(root list)' : ptr);
        return;
      }
      for (let i = 0; i < x.length; i++) walk(x[i], y[i], `${ptr}/${i}`);
      return;
    }
    if (isPlainObject(x) || isPlainObject(y)) {
      if (!isPlainObject(x) || !isPlainObject(y)) {
        out.structural.push(ptr === '' ? '(root)' : ptr);
        return;
      }
      const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
      for (const k of [...keys].sort()) {
        walk(x[k], y[k], `${ptr}/${k}`);
      }
      return;
    }
    if (!Object.is(x, y)) out.changed.push({ pointer: ptr === '' ? '(root)' : ptr, before: x, after: y });
  };
  walk(a, b, pointer);
  return out;
}

/** True when `changed` is authorized by `allowed`: exact path or anywhere under an allowed path. */
export function isAuthorized(changed: string, allowed: readonly string[]): boolean {
  return allowed.some(a => changed === a || changed.startsWith(a + '/'));
}

/** `allowed` minus every resized list pointer (and its ancestors) that encloses the changed leaf. */
function withoutResizeAuthority(allowed: readonly string[], changed: string, resized: readonly string[]): string[] {
  const enclosing = resized.filter(r => changed.startsWith(r + '/'));
  if (enclosing.length === 0) return [...allowed];
  return allowed.filter(a => !enclosing.some(r => a === r || r.startsWith(a + '/')));
}

function isIdentityPath(pointer: string): boolean {
  return pointer === '/id' || pointer.endsWith('/id') || pointer.endsWith('/componentId');
}

function fmt(v: unknown): string {
  return typeof v === 'string' ? JSON.stringify(truncate(v, 60)) : JSON.stringify(v) ?? String(v);
}

/**
 * The generic guarded revision comparison. `baseline` is the immutable revision 1 gen/analysis,
 * `next` the model's full corrected spec. See the module header for the frozen discipline.
 */
export function compareGuardedRevisions(
  baseline: unknown,
  next: unknown,
  context: RevisionGuardContext | undefined,
  opts: RevisionGuardOptions,
): ValidationCheck {
  const id = 'repair.no-weakening';
  const kind = 'semantic' as const;
  try {
    const problems: string[] = [];
    const wrap = (): ValidationCheck => {
      const shown = problems.slice(0, COMPARISON_PROBLEM_LIMIT);
      const hidden = problems.length - shown.length;
      const list =
        truncate(shown.join('; '), COMPARISON_MESSAGE_LIMIT) + (hidden > 0 ? ` (+${hidden} more violation(s))` : '');
      return {
        id,
        kind,
        passed: false,
        message: `repair weakened the spec: ${list} (a ${opts.targetLabel} repair must fix the failing checks by changing ONLY fields under the affected paths recomputed from revision 1, must keep every item and id stable — the system prunes bad items, never the model — and must never increase a tolerance or otherwise weaken the spec)`,
      };
    };

    const sources = context?.sources;
    if (!Array.isArray(sources)) {
      problems.push('cannot recompute the revision-1 authority without the source documents, so no change is authorized (fail closed)');
      const diff0 = leafDiff(baseline, next);
      if (diff0.changed.length > 0 || diff0.structural.length > 0) return wrap();
      return { id, kind, passed: true, message: `${opts.targetLabel}: revision is byte-identical to the baseline (nothing to authorize)` };
    }

    const report = opts.recompute(baseline, sources);
    const recomputedById = affectedByCheckIdOf(report);
    const recomputed = affectedPathsOf(report);
    let allowed: string[];
    if (Array.isArray(context?.findings)) {
      // NARROWING only: per finding, the intersection of its affected paths with the recomputed
      // failing check's affected paths. A finding without affected paths unlocks nothing.
      const set = new Set<string>();
      for (const f of context.findings) {
        if (typeof f !== 'object' || f === null || typeof f.id !== 'string') continue;
        const recomputedForCheck = new Set(recomputedById.get(f.id) ?? []);
        for (const p of Array.isArray(f.affected) ? f.affected : []) {
          if (typeof p === 'string' && recomputedForCheck.has(p)) set.add(p);
        }
      }
      allowed = [...set];
    } else {
      allowed = recomputed;
    }

    const diff = leafDiff(baseline, next, '', (ptr, before, after) => opts.allowListResize?.({ pointer: ptr, allowed, before, after }) === true);
    const resizedPointers = diff.lengths.map(l => (l.pointer === '(root list)' ? '' : l.pointer));
    for (const s of diff.structural) {
      problems.push(`${s} changed shape or list length (item counts and structure are frozen in a repair; the system prunes bad items via the drop helpers, the model never adds, removes or reorders items)`);
    }

    // Baseline identity values per parent list, for the rename-collision guard.
    const baselineIdsByParent = new Map<string, Map<string, unknown>>();
    const collectIds = (node: unknown, ptr: string): void => {
      if (Array.isArray(node)) {
        node.forEach((v, i) => collectIds(v, `${ptr}/${i}`));
        return;
      }
      if (isPlainObject(node)) {
        for (const [k, v] of Object.entries(node)) {
          if ((k === 'id' || k === 'componentId') && typeof v === 'string') {
            const map = baselineIdsByParent.get(ptr) ?? new Map<string, unknown>();
            map.set(`${ptr}/${k}`, v);
            baselineIdsByParent.set(ptr, map);
          }
          collectIds(v, `${ptr}/${k}`);
        }
      }
    };
    collectIds(baseline, '');

    for (const c of diff.changed) {
      if (c.pointer === '(root)') {
        problems.push('the root value changed shape');
        continue;
      }
      // A resized list's own pointer (and its ancestors) licenses the length change only, never the
      // content of the retained prefix items (S6R-06/S6R-10); those need their own affected paths.
      const effective = resizedPointers.length === 0 ? allowed : withoutResizeAuthority(allowed, c.pointer, resizedPointers);
      if (!isAuthorized(c.pointer, effective)) {
        problems.push(`${c.pointer} changed from ${fmt(c.before)} to ${fmt(c.after)} outside the affected paths recomputed from revision 1 (${effective.length === 0 ? 'no failing check authorized any field change' : 'authorized: ' + effective.join(', ')})${effective.length < allowed.length ? ' — a list-length finding licenses the resize only, not the content of the items it keeps' : ''}`);
        continue;
      }
      if (isIdentityPath(c.pointer)) {
        if (typeof c.after !== 'string' || !KIT_ID_PATTERN.test(c.after)) {
          problems.push(`${c.pointer} changed to ${fmt(c.after)}, which is not a valid id (expected ${KIT_ID_PATTERN.source})`);
          continue;
        }
        const parent = c.pointer.slice(0, c.pointer.lastIndexOf('/'));
        const siblings = baselineIdsByParent.get(parent);
        const siblingsOfList = new Map<string, unknown>();
        // The parent of an id leaf is the item ('/cards/2'); the LIST scope is its parent ('/cards').
        const listPtr = parent.slice(0, parent.lastIndexOf('/'));
        for (const [ptr, val] of siblings ?? []) siblingsOfList.set(ptr, val);
        for (const [mapKey, mapVal] of baselineIdsByParent) {
          if (mapKey.startsWith(listPtr + '/') || mapKey === listPtr) {
            for (const [ptr, val] of mapVal) if (ptr !== c.pointer) siblingsOfList.set(ptr, val);
          }
        }
        for (const [ptr, val] of siblingsOfList) {
          if (val === c.after) {
            problems.push(`${c.pointer} was renamed to ${fmt(c.after)}, which is another baseline id (${ptr}); a rename may not impersonate a preserved item`);
            break;
          }
        }
      }
      const leafName = c.pointer.slice(c.pointer.lastIndexOf('/') + 1);
      if (leafName === 'tolerance') {
        const b = c.before;
        const n = c.after;
        if (typeof b === 'number' && typeof n === 'number' && n > b) {
          problems.push(`${c.pointer} increased from ${b} to ${n} (a tolerance is never widened by a repair, no exceptions)`);
        }
      }
    }

    if (opts.extraRules !== undefined) {
      for (const v of opts.extraRules({ baseline, next, report, allowed })) problems.push(v);
    }

    if (problems.length > 0) return wrap();
    return {
      id,
      kind,
      passed: true,
      message: `${opts.targetLabel}: no weakening — every one of the ${diff.changed.length} changed field(s) sits under the affected paths recomputed from revision 1, item counts and ids are stable${diff.lengths.length > 0 ? ` except the ${diff.lengths.length} list resize(s) the authority itself named (structural only; retained items stayed under their own paths) (${diff.lengths.map(l => `${l.pointer}: ${l.before} -> ${l.after}`).join(', ')})` : ''}, and no tolerance increased`,
    };
  } catch (err) {
    return { id, kind, passed: false, message: `comparison crashed before it could pass or fail cleanly: ${errMsg(err)}` };
  }
}
