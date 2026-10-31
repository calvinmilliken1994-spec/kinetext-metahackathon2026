import type { AlgorithmId } from '../contracts/kit.ts';

export type AlgoOp =
  | 'start'
  | 'compare'
  | 'swap'
  | 'write'
  | 'split'
  | 'merge'
  | 'pivot'
  | 'narrow'
  | 'found'
  | 'not-found'
  | 'done';

export interface AlgoFrame {
  array: number[];
  op: AlgoOp;
  indices: number[];
  range: [number, number] | null;
  note: string;
  comparisons: number;
  moves: number;
}

export interface AlgoTrace {
  frames: AlgoFrame[];
  truncated: boolean;
  sorted: number[] | null;
  foundIndex: number | null;
}

const VALID_IDS: readonly string[] = [
  'binary-search',
  'linear-search',
  'bubble-sort',
  'insertion-sort',
  'selection-sort',
  'merge-sort',
  'quicksort',
];

const DISPLAY: Record<AlgorithmId, string> = {
  'binary-search': 'binary search',
  'linear-search': 'linear search',
  'bubble-sort': 'bubble sort',
  'insertion-sort': 'insertion sort',
  'selection-sort': 'selection sort',
  'merge-sort': 'merge sort',
  quicksort: 'quicksort',
};

export function algorithmNamePattern(id: AlgorithmId): RegExp {
  switch (id) {
    case 'binary-search':
      return /\b(?:binary[ -]search|binary[ -]chop|half[ -]interval[ -]search)\b/i;
    case 'linear-search':
      return /\b(?:linear[ -]search|sequential[ -]search)\b/i;
    case 'bubble-sort':
      return /\bbubble[ -]sort\b/i;
    case 'insertion-sort':
      return /\binsertion[ -]sort\b/i;
    case 'selection-sort':
      return /\bselection[ -]sort\b/i;
    case 'merge-sort':
      return /\bmerge[ -]?sort\b/i;
    case 'quicksort':
      return /\bquick[ -]?sort\b/i;
  }
}

function assertValidInputArray(input: readonly number[]): void {
  if (!Array.isArray(input)) {
    throw new RangeError('ALGO_INPUT_INVALID: input must be an array');
  }
  if (input.length < 1) {
    throw new RangeError('ALGO_INPUT_INVALID: input must not be empty');
  }
  for (const v of input) {
    if (typeof v !== 'number' || !Number.isFinite(v) || !Number.isInteger(v)) {
      throw new RangeError('ALGO_INPUT_INVALID: input must contain only finite integers');
    }
  }
}

export function traceAlgorithm(
  id: AlgorithmId,
  input: readonly number[],
  target: number | null,
  maxFrames = 400,
): AlgoTrace {
  if (!VALID_IDS.includes(id)) {
    throw new RangeError(`ALGO_INPUT_INVALID: unknown algorithm "${String(id)}"`);
  }
  assertValidInputArray(input);
  if (!Number.isInteger(maxFrames) || maxFrames < 1) {
    throw new RangeError('ALGO_INPUT_INVALID: maxFrames must be a positive integer');
  }
  const needsTarget = id === 'binary-search' || id === 'linear-search';
  if (needsTarget) {
    if (typeof target !== 'number' || !Number.isFinite(target) || !Number.isInteger(target)) {
      throw new RangeError('ALGO_INPUT_INVALID: search algorithms need an integer target');
    }
  }

  const frames: AlgoFrame[] = [];
  const state = { comparisons: 0, moves: 0 };
  const push = (
    array: number[],
    op: AlgoOp,
    indices: number[],
    range: [number, number] | null,
    note: string,
  ): void => {
    frames.push({
      array: array.slice(),
      op,
      indices: indices.slice(),
      range: range === null ? null : [range[0], range[1]],
      note,
      comparisons: state.comparisons,
      moves: state.moves,
    });
  };

  let sorted: number[] | null = null;
  let foundIndex: number | null = null;
  const name = DISPLAY[id];

  if (id === 'linear-search') {
    const t: number = target as number;
    const a = input.slice();
    push(a, 'start', [], null, `Start linear search for ${t} in ${a.length} items.`);
    for (let i = 0; i < a.length; i++) {
      state.comparisons += 1;
      push(a, 'compare', [i], null, `Compare target ${t} with ${a[i]} at position ${i}.`);
      if (a[i] === t) {
        push(a, 'found', [i], null, `Found ${t} at position ${i}.`);
        push(a, 'done', [], null, `Done. Found ${t} at position ${i}.`);
        foundIndex = i;
        return finish();
      }
    }
    push(a, 'not-found', [], null, `${t} is not in the list.`);
    push(a, 'done', [], null, `Done. ${t} was not found.`);
    return finish();
  }

  if (id === 'binary-search') {
    const t: number = target as number;
    const a = input.slice();
    const n = a.length;
    push(a, 'start', [], null, `Start binary search for ${t} in ${n} sorted items.`);
    let lo = 0;
    let hi = n - 1;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      const v = a[mid];
      state.comparisons += 1;
      push(
        a,
        'compare',
        [mid],
        [lo, hi],
        `Compare target ${t} with ${v} at position ${mid} (range ${lo} to ${hi}).`,
      );
      if (v === t) {
        push(a, 'found', [mid], [lo, hi], `Found ${t} at position ${mid}.`);
        push(a, 'done', [], null, `Done. Found ${t} at position ${mid}.`);
        foundIndex = mid;
        return finish();
      }
      if (t < v) {
        const nlo = lo;
        const nhi = mid - 1;
        const r: [number, number] | null = nlo <= nhi ? [nlo, nhi] : null;
        push(
          a,
          'narrow',
          [mid],
          r,
          `${t} is smaller than ${v}, so search the left half (positions ${nlo} to ${nhi}).`,
        );
        hi = mid - 1;
      } else {
        const nlo = mid + 1;
        const nhi = hi;
        const r: [number, number] | null = nlo <= nhi ? [nlo, nhi] : null;
        push(
          a,
          'narrow',
          [mid],
          r,
          `${t} is larger than ${v}, so search the right half (positions ${nlo} to ${nhi}).`,
        );
        lo = mid + 1;
      }
    }
    push(a, 'not-found', [], null, `${t} is not in the list.`);
    push(a, 'done', [], null, `Done. ${t} was not found.`);
    return finish();
  }

  if (id === 'bubble-sort') {
    const a = input.slice();
    const n = a.length;
    push(a, 'start', [], null, `Start ${name} on ${n} items.`);
    for (let i = 0; i < n - 1; i++) {
      for (let j = 0; j < n - 1 - i; j++) {
        state.comparisons += 1;
        push(
          a,
          'compare',
          [j, j + 1],
          null,
          `Compare ${a[j]} at position ${j} with ${a[j + 1]} at position ${j + 1}.`,
        );
        if (a[j] > a[j + 1]) {
          const x = a[j];
          const y = a[j + 1];
          const tmp = a[j];
          a[j] = a[j + 1];
          a[j + 1] = tmp;
          state.moves += 1;
          push(a, 'swap', [j, j + 1], null, `Swap positions ${j} and ${j + 1}: ${x} and ${y}.`);
        }
      }
    }
    push(a, 'done', [], null, `Done. Sorted list: ${a.join(', ')}.`);
    sorted = a.slice();
    return finish();
  }

  if (id === 'insertion-sort') {
    const a = input.slice();
    const n = a.length;
    push(a, 'start', [], null, `Start ${name} on ${n} items.`);
    for (let i = 1; i < n; i++) {
      const key = a[i];
      let j = i - 1;
      while (j >= 0) {
        state.comparisons += 1;
        push(a, 'compare', [j, j + 1], null, `Compare ${key} with ${a[j]} at position ${j}.`);
        if (a[j] <= key) {
          break;
        }
        const moved = a[j];
        a[j + 1] = moved;
        state.moves += 1;
        push(a, 'write', [j + 1], null, `Move ${moved} from position ${j} to position ${j + 1}.`);
        j -= 1;
      }
      if (j + 1 !== i) {
        a[j + 1] = key;
        state.moves += 1;
        push(a, 'write', [j + 1], null, `Write ${key} at position ${j + 1}.`);
      }
    }
    push(a, 'done', [], null, `Done. Sorted list: ${a.join(', ')}.`);
    sorted = a.slice();
    return finish();
  }

  if (id === 'selection-sort') {
    const a = input.slice();
    const n = a.length;
    push(a, 'start', [], null, `Start ${name} on ${n} items.`);
    for (let i = 0; i < n - 1; i++) {
      let min = i;
      for (let j = i + 1; j < n; j++) {
        state.comparisons += 1;
        push(
          a,
          'compare',
          [j, min],
          null,
          `Compare ${a[j]} at position ${j} with current minimum ${a[min]} at position ${min}.`,
        );
        if (a[j] < a[min]) {
          min = j;
        }
      }
      if (min !== i) {
        const x = a[i];
        const y = a[min];
        const tmp = a[i];
        a[i] = a[min];
        a[min] = tmp;
        state.moves += 1;
        push(a, 'swap', [i, min], null, `Swap minimum ${y} into position ${i} (with ${x}).`);
      }
    }
    push(a, 'done', [], null, `Done. Sorted list: ${a.join(', ')}.`);
    sorted = a.slice();
    return finish();
  }

  if (id === 'merge-sort') {
    const a = input.slice();
    const n = a.length;
    push(a, 'start', [], null, `Start ${name} on ${n} items.`);
    const sort = (lo: number, hi: number): void => {
      if (hi - lo <= 1) {
        return;
      }
      const mid = Math.floor((lo + hi) / 2);
      push(
        a,
        'split',
        [mid],
        [lo, hi - 1],
        `Split positions ${lo} to ${hi - 1} into positions ${lo} to ${mid - 1} and positions ${mid} to ${hi - 1}.`,
      );
      sort(lo, mid);
      sort(mid, hi);
      const left = a.slice(lo, mid);
      const right = a.slice(mid, hi);
      let li = 0;
      let rj = 0;
      let k = lo;
      while (li < left.length && rj < right.length) {
        const lv = left[li];
        const rv = right[rj];
        state.comparisons += 1;
        push(
          a,
          'compare',
          [lo + li, mid + rj],
          [lo, hi - 1],
          `Compare ${lv} (left) with ${rv} (right).`,
        );
        if (lv <= rv) {
          a[k] = lv;
          li += 1;
        } else {
          a[k] = rv;
          rj += 1;
        }
        state.moves += 1;
        push(a, 'write', [k], [lo, hi - 1], `Write ${a[k]} at position ${k}.`);
        k += 1;
      }
      while (li < left.length) {
        a[k] = left[li];
        state.moves += 1;
        push(a, 'write', [k], [lo, hi - 1], `Write ${a[k]} at position ${k}.`);
        k += 1;
        li += 1;
      }
      while (rj < right.length) {
        a[k] = right[rj];
        state.moves += 1;
        push(a, 'write', [k], [lo, hi - 1], `Write ${a[k]} at position ${k}.`);
        k += 1;
        rj += 1;
      }
      push(
        a,
        'merge',
        [lo, hi - 1],
        [lo, hi - 1],
        `Merged positions ${lo} to ${hi - 1}: ${a.slice(lo, hi).join(', ')}.`,
      );
    };
    sort(0, n);
    push(a, 'done', [], null, `Done. Sorted list: ${a.join(', ')}.`);
    sorted = a.slice();
    return finish();
  }

  // quicksort (Lomuto, last element as pivot)
  {
    const a = input.slice();
    const n = a.length;
    push(a, 'start', [], null, `Start ${name} on ${n} items.`);
    const qs = (lo: number, hi: number): void => {
      if (lo >= hi) {
        return;
      }
      const pivot = a[hi];
      push(
        a,
        'pivot',
        [hi],
        [lo, hi],
        `Choose ${pivot} at position ${hi} as the pivot for positions ${lo} to ${hi}.`,
      );
      let i = lo - 1;
      for (let j = lo; j < hi; j++) {
        state.comparisons += 1;
        push(
          a,
          'compare',
          [j, hi],
          [lo, hi],
          `Compare ${a[j]} at position ${j} with pivot ${pivot}.`,
        );
        if (a[j] <= pivot) {
          i += 1;
          if (i !== j) {
            const tmp = a[i];
            a[i] = a[j];
            a[j] = tmp;
            state.moves += 1;
            push(a, 'swap', [i, j], [lo, hi], `Swap positions ${i} and ${j}.`);
          }
        }
      }
      const p = i + 1;
      if (p !== hi) {
        const tmp = a[p];
        a[p] = a[hi];
        a[hi] = tmp;
        state.moves += 1;
        push(a, 'swap', [p, hi], [lo, hi], `Swap pivot into position ${p}.`);
      }
      qs(lo, p - 1);
      qs(p + 1, hi);
    };
    qs(0, n - 1);
    push(a, 'done', [], null, `Done. Sorted list: ${a.join(', ')}.`);
    sorted = a.slice();
    return finish();
  }

  function finish(): AlgoTrace {
    if (frames.length > maxFrames) {
      return { frames: frames.slice(0, maxFrames), truncated: true, sorted, foundIndex };
    }
    return { frames, truncated: false, sorted, foundIndex };
  }
}
