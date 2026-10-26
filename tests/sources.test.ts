import test from 'node:test';
import assert from 'node:assert/strict';
import { listSourceIds, loadSource, loadSourceMeta, sha256 } from '../packages/sources/index.ts';

test('every stored source loads and matches its recorded sha256', () => {
  const ids = listSourceIds();
  assert.ok(ids.includes('nasa-grc-equations-of-motion'));
  assert.ok(ids.includes('nasa-grc-speed-of-sound'));
  for (const id of ids) {
    const doc = loadSource(id);
    assert.equal(doc.id, id);
    assert.equal(sha256(doc.text), doc.sha256);
    assert.ok(doc.license.length > 0 && doc.attribution.length > 0, `${id} lacks license/attribution`);
  }
});

test('NASA sources carry the no-endorsement attribution required by NASA AI-use guidance', () => {
  for (const id of listSourceIds().filter(x => x.startsWith('nasa-'))) {
    const meta = loadSourceMeta(id);
    assert.equal(meta.license, 'US-Gov-Work');
    assert.match(meta.attribution, /has not reviewed, approved or endorsed/);
  }
});

test('source loader rejects path tricks', () => {
  assert.throws(() => loadSource('../package'), /SOURCE_ID_INVALID/);
});
