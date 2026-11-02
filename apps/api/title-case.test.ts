// Part titles start with a capital at serve time (Calvin, 3 Nov: the merge sort lesson's "merge sort"). Stored runs
// are never rewritten. Only a first word written all in lower case is changed, so "pH acidity ladder" stays.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capitaliseTitle, capitaliseSpecTitle } from './title-case.ts';

test('capitaliseTitle: an all-lowercase first word gets its capital; mixed-case words and the rest are left alone', () => {
  assert.equal(capitaliseTitle('merge sort'), 'Merge sort');
  assert.equal(capitaliseTitle('quick check on dna structure and copying'), 'Quick check on dna structure and copying');
  assert.equal(capitaliseTitle('pH acidity ladder'), 'pH acidity ladder');
  assert.equal(capitaliseTitle('Sorting with divide and conquer review'), 'Sorting with divide and conquer review');
  assert.equal(capitaliseTitle('éclair layers'), 'Éclair layers');
  assert.equal(capitaliseTitle('3 phases of matter'), '3 phases of matter');
  assert.equal(capitaliseTitle(''), '');
});

test('capitaliseSpecTitle: changes the in-memory spec only, ignores anything without a string title', () => {
  const spec: Record<string, unknown> = { title: 'merge sort', componentId: 'algorithm-trace-v1' };
  capitaliseSpecTitle(spec);
  assert.equal(spec['title'], 'Merge sort');
  for (const junk of [null, undefined, 3, { title: 7 }, { notitle: true }]) capitaliseSpecTitle(junk);
});
