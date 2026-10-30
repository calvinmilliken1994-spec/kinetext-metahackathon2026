// Stage 7b (docs/specs/STAGE-7b-subjects.md) — GET /api/sources carries each page's subject.
// Library pages: the curated `subject` from data/sources/<id>.json, flagged subjectSource 'curated'.
// Teacher pages: the subject Muse detected in the latest lesson analysis of that page (analysis-v2), flagged 'muse';
// absent when no lesson analysis exists. Ephemeral server on 127.0.0.1:0, fake registry and storage in a temp dir,
// live generation off (startJob null: no ledger, no model client, no network beyond loopback).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from './server.ts';
import type { ApiOptions } from './server.ts';
import { museSubjectsBySource } from './source-subjects.ts';
import { saveUserSource, sha256 } from '../../packages/sources/index.ts';

async function withServer(opts: ApiOptions, run: (base: string) => Promise<void>): Promise<void> {
  const server: Server = createApiServer(opts);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    await run(base);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

/** A fake library registry: one page with a curated subject, one without, one with an unknown value. */
function fakeRegistry(): URL {
  const dir = mkdtempSync(join(tmpdir(), 's7b-registry-'));
  const text = 'A short licensed page about rates of change.\n';
  writeFileSync(join(dir, 'page.txt'), text);
  const base = {
    locator: 'https://example.gov/page', license: 'US-Gov-Work', attribution: 'Source material: Example Agency, page.',
    sha256: sha256(text), textFile: 'page.txt', retrievedAt: '2026-10-30T00:00:00Z', transcription: 'whole page', purpose: 'test',
  };
  writeFileSync(join(dir, 'lib-maths.json'), JSON.stringify({ id: 'lib-maths', title: 'Rates of change', subject: 'maths', ...base }, null, 2));
  writeFileSync(join(dir, 'lib-none.json'), JSON.stringify({ id: 'lib-none', title: 'No subject yet', ...base }, null, 2));
  writeFileSync(join(dir, 'lib-odd.json'), JSON.stringify({ id: 'lib-odd', title: 'Odd subject', subject: 'astrology', ...base }, null, 2));
  return pathToFileURL(`${dir}/`);
}

const TEXT_A = 'Teacher notes on a ball thrown upwards: it slows, stops and falls back. '.repeat(6).trim();
const TEXT_B = 'Teacher notes on saving money each week and how interest adds up over a year. '.repeat(6).trim();

function writeRun(storageDir: string, jobId: string, sourceId: string, createdAt: string, analyses: Record<string, unknown>): void {
  const dir = join(storageDir, 'runs', jobId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'job.json'), JSON.stringify({ jobId, sourceId, status: 'succeeded', purpose: 'test-live', createdAt, totalCostUSD: 0, flow: 'lesson' }));
  for (const [file, body] of Object.entries(analyses)) writeFileSync(join(dir, file), JSON.stringify(body));
}

const v2 = (subject: unknown): unknown => ({ analysis: { analysisVersion: 2, subject, usable: true }, report: {}, receipt: {} });

/** Storage with two teacher sources: A has lesson analyses (older physics, newer biology after a repair), B only a v1 run. */
function fakeStorage(): { storageDir: string; idA: string; idB: string } {
  const storageDir = mkdtempSync(join(tmpdir(), 's7b-storage-'));
  const users = join(storageDir, 'user-sources');
  const idA = saveUserSource({ title: 'Ball thrown up', text: TEXT_A, license: 'own-work', attribution: 'By the teacher.', rightsConfirmed: true }, users).id;
  const idB = saveUserSource({ title: 'Weekly saving', text: TEXT_B, license: 'own-work', attribution: 'By the teacher.', rightsConfirmed: true }, users).id;
  writeRun(storageDir, 'job-20261029100000-aaaaaaa1', idA, '2026-10-29T10:00:00.000Z', { 'analysis-v2.r1.json': v2('physics') });
  // Newest run for A: revision 1 said chemistry, the repaired revision 2 (the analysis of record) says biology.
  writeRun(storageDir, 'job-20261030100000-aaaaaaa2', idA, '2026-10-30T10:00:00.000Z', { 'analysis-v2.r1.json': v2('chemistry'), 'analysis-v2.r2.json': v2('biology') });
  // A newer run whose analysis carries an unknown subject is ignored (falls back to the newest valid one).
  writeRun(storageDir, 'job-20261030120000-aaaaaaa3', idA, '2026-10-30T12:00:00.000Z', { 'analysis-v2.r1.json': v2('astrology') });
  // B: only a classic (v1) analysis — no Muse subject.
  writeRun(storageDir, 'job-20261030110000-bbbbbbb1', idB, '2026-10-30T11:00:00.000Z', { 'analysis.json': { analysis: {} } });
  // A library page's runs never override its curated subject.
  writeRun(storageDir, 'job-20261030130000-ccccccc1', 'lib-maths', '2026-10-30T13:00:00.000Z', { 'analysis-v2.r1.json': v2('physics') });
  return { storageDir, idA, idB };
}

interface Row { id: string; kind: string; subject?: string; subjectSource?: string }

test('GET /api/sources: library pages carry their curated subject; missing or unknown subjects are left out', async () => {
  const { storageDir } = fakeStorage();
  await withServer({ storageDir, sourcesDir: fakeRegistry(), startJob: null }, async base => {
    const res = await fetch(`${base}/api/sources`);
    assert.equal(res.status, 200);
    const rows = (await res.json()) as Row[];
    const byId = new Map(rows.map(r => [r.id, r]));
    assert.equal(byId.get('lib-maths')?.subject, 'maths');
    assert.equal(byId.get('lib-maths')?.subjectSource, 'curated');
    for (const id of ['lib-none', 'lib-odd']) {
      assert.equal('subject' in (byId.get(id) as object), false, `${id} must not carry a subject`);
      assert.equal('subjectSource' in (byId.get(id) as object), false, `${id} must not carry a subjectSource`);
    }
  });
});

test('GET /api/sources: a teacher page carries the latest Muse-detected subject, flagged muse; none without a lesson analysis', async () => {
  const { storageDir, idA, idB } = fakeStorage();
  await withServer({ storageDir, sourcesDir: fakeRegistry(), startJob: null }, async base => {
    const rows = (await (await fetch(`${base}/api/sources`)).json()) as Row[];
    const a = rows.find(r => r.id === idA);
    const b = rows.find(r => r.id === idB);
    assert.equal(a?.kind, 'user');
    assert.equal(a?.subject, 'biology');
    assert.equal(a?.subjectSource, 'muse');
    assert.equal(b?.kind, 'user');
    assert.equal('subject' in (b as object), false);
    assert.equal('subjectSource' in (b as object), false);
  });
});

test('GET /api/sources/:id carries the same subject fields', async () => {
  const { storageDir, idA } = fakeStorage();
  await withServer({ storageDir, sourcesDir: fakeRegistry(), startJob: null }, async base => {
    const lib = (await (await fetch(`${base}/api/sources/lib-maths`)).json()) as Row & { text: string };
    assert.equal(lib.subject, 'maths');
    assert.equal(lib.subjectSource, 'curated');
    assert.ok(lib.text.length > 0);
    const user = (await (await fetch(`${base}/api/sources/${idA}`)).json()) as Row;
    assert.equal(user.subject, 'biology');
    assert.equal(user.subjectSource, 'muse');
  });
});

test('museSubjectsBySource: newest run with a valid analysis-v2 subject, highest revision; ignores other sources and junk', () => {
  const { storageDir, idA, idB } = fakeStorage();
  // Junk: a run dir without job.json, and an unreadable analysis file.
  mkdirSync(join(storageDir, 'runs', 'job-broken'), { recursive: true });
  writeRun(storageDir, 'job-20261030140000-ddddddd1', idB, '2026-10-30T14:00:00.000Z', {});
  writeFileSync(join(storageDir, 'runs', 'job-20261030140000-ddddddd1', 'analysis-v2.r1.json'), '{not json');
  const got = museSubjectsBySource(storageDir, new Set([idA, idB]));
  assert.deepEqual([...got.entries()], [[idA, 'biology']]);
  assert.equal(museSubjectsBySource(storageDir, new Set()).size, 0);
  assert.equal(museSubjectsBySource(join(storageDir, 'nowhere'), new Set([idA])).size, 0);
});
