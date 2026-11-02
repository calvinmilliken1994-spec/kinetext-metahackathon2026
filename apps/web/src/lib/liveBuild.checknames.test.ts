import test from 'node:test';
import assert from 'node:assert/strict';
import { checkNames } from './liveBuild.ts';

test('a failed check\'s name keeps model names capitalised; an ordinary first word is lower-cased', () => {
  assert.equal(checkNames(['LD-06']), 'Muse and SAM agree where each part is');
  assert.match(checkNames(['LD-04']), /^[a-z]/);
});
