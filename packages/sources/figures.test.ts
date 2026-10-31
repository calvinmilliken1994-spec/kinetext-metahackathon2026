import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { listFigures, loadFigure } from './figures.ts';

test('the DNA figure loads and its bytes match the recorded sha256', () => {
  const { meta, bytes } = loadFigure('medlineplus-dna-structure-1');
  assert.equal(meta.id, 'medlineplus-dna-structure-1');
  assert.equal(meta.sourceId, 'medlineplus-what-is-dna');
  assert.equal(meta.file, 'medlineplus-dna-structure-1.jpg');
  assert.equal(meta.mime, 'image/jpeg');
  assert.equal(meta.width, 600);
  assert.equal(meta.height, 600);
  assert.equal(meta.labelsInImage, true);
  assert.equal(meta.sha256, '84e5b887cdd3a12fc6b15d1fd0b85026384927492baeb86567a4c264cf7e78a9');
  assert.ok(bytes.length > 0);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), meta.sha256);
});

test('listFigures of medlineplus-what-is-dna contains the DNA figure', () => {
  const ids = listFigures('medlineplus-what-is-dna').map((f) => f.id);
  assert.ok(ids.includes('medlineplus-dna-structure-1'));
});

test('unknown figure id throws FIGURE_NOT_FOUND', () => {
  assert.throws(() => loadFigure('no-such-figure'), /FIGURE_NOT_FOUND/);
});

test('listFigures of a source without figures is []', () => {
  assert.deepEqual(listFigures('no-such-source-without-figures'), []);
});
