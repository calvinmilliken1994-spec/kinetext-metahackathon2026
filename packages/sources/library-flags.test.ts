// Stage 7e (docs/specs/STAGE-7e-library-and-wording.md): featured and retired library pages.
// `featured: true` puts a page first in the picker for its subject (physics: exactly 5); `retired: true` hides it from the
// library list but keeps it loadable by id, so stored runs and evidence keep working. Adding a flag never touches the
// stored text (the sha256 still verifies) and never deletes a library file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SOURCES_DIR, isFeatured, isRetired, listActiveSourceIds, listSourceIds, loadSource, loadSourceMeta, sha256 } from './index.ts';

const FEATURED_PHYSICS = [
  'nasa-grc-bernoullis-equation',
  'nasa-grc-drag-equation',
  'nasa-grc-glider-trajectory-problem',
  'nasa-grc-motion-of-free-falling-object',
  'nasa-grc-newtons-laws-of-motion',
];

const RETIRED = [
  'nasa-grc-ballistic-flight-equations',
  'nasa-grc-equations-of-motion',
  'nasa-grc-flight-equations-with-drag',
  'nasa-grc-lift-equation-of-the-1900s',
  'nasa-grc-re-living-the-wright-way',
  'nrc-unit-1-radiation',
];

test('exactly the five frozen physics pages are featured', () => {
  const featuredPhysics = listSourceIds().filter((id) => {
    const m = loadSourceMeta(id);
    return m.subject === 'physics' && isFeatured(m);
  });
  assert.deepEqual(featuredPhysics, FEATURED_PHYSICS);
});

test('exactly the six frozen pages are retired, and every one still loads with a verified hash', () => {
  const retired = listSourceIds().filter((id) => isRetired(loadSourceMeta(id)));
  assert.deepEqual(retired, RETIRED);
  for (const id of RETIRED) {
    const doc = loadSource(id);
    assert.equal(sha256(doc.text), loadSourceMeta(id).sha256, id);
  }
});

test('physics: 14 active pages (13 after Stage 7e + the airplane-parts figure page), 6 retired, and no page is both featured and retired', () => {
  const physics = listSourceIds().filter((id) => loadSourceMeta(id).subject === 'physics');
  // 2026-11-02: nasa-grc-airplane-parts-function (SAM figure candidate with a label-diagram figure) joined physics.
  assert.equal(physics.filter((id) => !isRetired(loadSourceMeta(id))).length, 14);
  assert.equal(physics.filter((id) => isRetired(loadSourceMeta(id))).length, 6);
  for (const id of listSourceIds()) {
    const m = loadSourceMeta(id);
    assert.ok(!(isFeatured(m) && isRetired(m)), `${id} is featured and retired`);
  }
});

test('the flag files keep LF line endings and the flag sits right after the subject key', () => {
  for (const id of [...FEATURED_PHYSICS, ...RETIRED]) {
    const raw = readFileSync(new URL(`${id}.json`, SOURCES_DIR), 'utf8');
    assert.ok(!raw.includes('\r'), `${id}.json has CR bytes`);
    const flag = FEATURED_PHYSICS.includes(id) ? '"featured": true' : '"retired": true';
    assert.match(raw, new RegExp(`\\n  "subject": "physics",\\n  ${flag},\\n`), id);
  }
});

test('isFeatured / isRetired read only a literal true; listActiveSourceIds leaves retired pages out', () => {
  assert.equal(isFeatured({ featured: true }), true);
  assert.equal(isFeatured({ featured: 'true' }), false);
  assert.equal(isFeatured({}), false);
  assert.equal(isRetired({ retired: true }), true);
  assert.equal(isRetired({ retired: 1 }), false);
  assert.equal(isRetired({}), false);

  const dir = mkdtempSync(join(tmpdir(), 'flags-'));
  const base = { title: 'T', locator: 'x', license: 'l', attribution: 'a', sha256: sha256('hi'), textFile: 'p.txt', retrievedAt: '', transcription: '', purpose: '' };
  writeFileSync(join(dir, 'p.txt'), 'hi');
  writeFileSync(join(dir, 'a-live.json'), JSON.stringify({ id: 'a-live', ...base, subject: 'physics', featured: true }));
  writeFileSync(join(dir, 'b-old.json'), JSON.stringify({ id: 'b-old', ...base, subject: 'physics', retired: true }));
  writeFileSync(join(dir, 'c-plain.json'), JSON.stringify({ id: 'c-plain', ...base }));
  const url = pathToFileURL(`${dir}/`);
  assert.deepEqual(listActiveSourceIds(url), ['a-live', 'c-plain']);
  assert.deepEqual(listSourceIds(url), ['a-live', 'b-old', 'c-plain'], 'the full list still has the retired page');
  assert.equal(loadSource('b-old', url).text, 'hi', 'a retired page still loads by id');
});
