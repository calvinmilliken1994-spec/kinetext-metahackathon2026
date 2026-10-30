// Stage 7b (docs/specs/STAGE-7b-subjects.md): every library source carries one curated `subject` from SUBJECTS,
// and adding it never touches the stored text (the sha256 still verifies).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SUBJECTS } from '../contracts/kit.ts';
import { listSourceIds, loadSource, loadSourceMeta, sha256, sourceSubject } from './index.ts';

test('every library source has a curated subject from SUBJECTS', () => {
  const ids = listSourceIds();
  assert.ok(ids.length >= 41, `expected at least the 41 Stage 7b sources, got ${ids.length}`);
  for (const id of ids) {
    const meta = loadSourceMeta(id);
    assert.ok(
      typeof meta.subject === 'string' && (SUBJECTS as readonly string[]).includes(meta.subject),
      `${id} has no valid subject (got ${JSON.stringify(meta.subject)})`,
    );
    assert.equal(sourceSubject(meta), meta.subject);
    // The subject lives in the metadata only: the stored text still matches its recorded hash.
    assert.equal(sha256(loadSource(id).text), meta.sha256);
  }
});

test('a few curated subjects are pinned (spot checks across publishers)', () => {
  const pinned: Record<string, string> = {
    'nasa-grc-lift-equation': 'physics',
    'nasa-grc-earth-atmosphere-equation-english': 'earth-science',
    'cfpb-compound-interest': 'finance',
    'nara-constitution': 'history',
    'nij-hardy-weinberg-principle': 'biology',
    'noaa-oceanexplorer-fueling-life-on-earth': 'chemistry',
    'usgs-geologic-age': 'earth-science',
  };
  for (const [id, subject] of Object.entries(pinned)) assert.equal(loadSourceMeta(id).subject, subject, id);
});

test('sourceSubject: a missing or unknown subject reads as undefined (the UI files it under Other)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'subjects-'));
  const base = { title: 'T', locator: 'x', license: 'l', attribution: 'a', sha256: sha256('hi'), textFile: 'p.txt', retrievedAt: '', transcription: '', purpose: '' };
  writeFileSync(join(dir, 'p.txt'), 'hi');
  writeFileSync(join(dir, 'no-subject.json'), JSON.stringify({ id: 'no-subject', ...base }));
  writeFileSync(join(dir, 'odd-subject.json'), JSON.stringify({ id: 'odd-subject', ...base, subject: 'astrology' }));
  const url = pathToFileURL(`${dir}/`);
  assert.equal(sourceSubject(loadSourceMeta('no-subject', url)), undefined);
  assert.equal(sourceSubject(loadSourceMeta('odd-subject', url)), undefined);
});
