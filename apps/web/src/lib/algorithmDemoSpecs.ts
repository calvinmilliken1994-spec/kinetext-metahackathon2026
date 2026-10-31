// Stage 8a slice W-A: hand-written algorithm-trace gens for the dev harness (?engine-demo=a), shaped like Muse's output and
// quoting real library pages verbatim (data/sources/nist-dads-*). Fixture data written for this repository, NOT model
// output; lib/algorithmDemoSpecs.test.ts checks every quote against the stored page text.
import type { AlgorithmTraceGen } from '../../../../packages/contracts/kit.ts';

export const BUBBLE_SORT_GEN: AlgorithmTraceGen = {
  schemaVersion: 'algorithm-trace-v1',
  title: 'Bubble sort, one comparison at a time',
  algorithm: 'bubble-sort',
  algorithmName: 'bubble sort',
  sourceId: 'nist-dads-bubble-sort',
  quote: 'bubble sort (algorithm) Definition: Sort by comparing each adjacent pair of items in a list in turn, swapping the items if necessary',
  input: [34, 7, 23, 32, 5, 62],
  hasTarget: false,
  target: 0,
  claims: [
    {
      id: 'claim-1', kind: 'running-time', text: 'Complexity is O(n^2) for arbitrary data', sourceId: 'nist-dads-bubble-sort',
      quote: 'Note: Complexity is O(n^2) for arbitrary data, but approaches Θ(n) if the list is nearly in order at the beginning.',
    },
    {
      id: 'claim-2', kind: 'property', text: 'at least one item is moved into its final place for each pass', sourceId: 'nist-dads-bubble-sort',
      quote: 'Since at least one item is moved into its final place for each pass, an improvement is to decrement the last position checked on each pass.',
    },
  ],
};

export const MERGE_SORT_GEN: AlgorithmTraceGen = {
  schemaVersion: 'algorithm-trace-v1',
  title: 'Merge sort: split, sort, merge',
  algorithm: 'merge-sort',
  algorithmName: 'merge sort',
  sourceId: 'nist-dads-merge-sort',
  quote: 'merge sort (algorithm) Definition: A sort algorithm that splits the items to be sorted into two groups, recursively sorts each group',
  input: [38, 27, 43, 3, 9, 82, 10],
  hasTarget: false,
  target: 0,
  claims: [
    { id: 'claim-1', kind: 'running-time', text: 'Run time is Θ(n log n).', sourceId: 'nist-dads-merge-sort', quote: 'and merges them into a final, sorted sequence. Run time is Θ(n log n).' },
  ],
};

export const QUICKSORT_GEN: AlgorithmTraceGen = {
  schemaVersion: 'algorithm-trace-v1',
  title: 'Quicksort around a pivot',
  algorithm: 'quicksort',
  algorithmName: 'quicksort',
  sourceId: 'nist-dads-quicksort',
  quote: 'quicksort (algorithm) Definition: Pick an element from the array (the pivot), partition the remaining elements',
  input: [29, 72, 98, 13, 87, 66, 52, 51],
  hasTarget: false,
  target: 0,
  claims: [
    { id: 'claim-1', kind: 'running-time', text: 'running time Θ(n²) in the worst case', sourceId: 'nist-dads-quicksort', quote: 'Quicksort has running time Θ(n²) in the worst case, but it is typically O(n log n).' },
    { id: 'claim-2', kind: 'property', text: 'There are many variants of the basic scheme above', sourceId: 'nist-dads-quicksort', quote: 'There are many variants of the basic scheme above: to select the pivot, to partition the array, to stop the recursion' },
  ],
};

/** A longer binary search on the same page as the golden fixture (the golden finds its target at the first look). */
export const BINARY_SEARCH_GEN: AlgorithmTraceGen = {
  schemaVersion: 'algorithm-trace-v1',
  title: 'Binary search, halving the interval',
  algorithm: 'binary-search',
  algorithmName: 'binary search',
  sourceId: 'nist-dads-binary-search',
  quote: 'binary search (algorithm) Definition: Search a sorted array by repeatedly dividing the search interval in half.',
  input: [4, 9, 15, 23, 31, 42, 58, 66, 79, 91],
  hasTarget: true,
  target: 15,
  claims: [{ id: 'claim-1', kind: 'running-time', text: 'Run time is O(ln n).', sourceId: 'nist-dads-binary-search', quote: 'Note: Run time is O(ln n).' }],
};

export const ALGORITHM_DEMO_GENS: readonly AlgorithmTraceGen[] = [BUBBLE_SORT_GEN, MERGE_SORT_GEN, QUICKSORT_GEN, BINARY_SEARCH_GEN];
