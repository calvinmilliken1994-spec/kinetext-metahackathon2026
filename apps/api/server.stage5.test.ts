// Stage 5 TASK-015 API tests — teacher-pasted sources (POST /api/sources),
// demo-fault selection on POST /api/jobs and multi-revision GET /api/jobs/:id.
// Ephemeral server on 127.0.0.1:0, FAKE MetaClients, real repo sources read-only.
// No network beyond localhost, no credits, no .env access.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from './server.ts';
import type { ApiOptions } from './server.ts';
import { startJob as realStartJob } from '../../workers/generation/jobs.ts';
import type { JobSummary } from '../../workers/generation/jobs.ts';
import type { CompleteRequest, MetaClient } from '../../packages/meta/client.ts';
import {
  MAX_USER_SOURCES,
  saveUserSource,
  sha256,
  userSourceId,
} from '../../packages/sources/index.ts';
import { normalizeUserText } from '../../packages/contracts/index.ts';
import type { DemoFault, GeneratedSpec, MetaReceipt, SourceAnalysis } from '../../packages/contracts/index.ts';

const analysisFixture = JSON.parse(
  readFileSync(new URL('../../tests/fixtures/nasa-analysis.recorded.json', import.meta.url), 'utf8'),
) as SourceAnalysis;
const genFixture = JSON.parse(
  readFileSync(new URL('../../tests/fixtures/nasa-gen.recorded.json', import.meta.url), 'utf8'),
) as GeneratedSpec;

function fakeReceipt(responseId: string): MetaReceipt {
  return {
    purpose: 'test-live',
    requestedModel: 'muse-spark-1.3',
    returnedModel: 'muse-spark-1.3',
    responseId,
    usage: { promptTokens: 1200, completionTokens: 800, reasoningTokens: 300, cachedTokens: 0 },
    latencyMs: 42,
    estCostUSD: 0.01,
    finishReason: 'stop',
    attempts: 1,
  };
}

function repairOnceClient(): MetaClient {
  let repairs = 0;
  const bad = structuredClone(genFixture) as GeneratedSpec & { behavioralTests: Record<string, unknown>[] };
  bad.behavioralTests[0]['expectedAccelerationMps2'] = 99;
  return {
    complete: async <T>(req: CompleteRequest): Promise<{ data: T; receipt: MetaReceipt }> => {
      if (req.schemaName === 'source_analysis') {
        return { data: analysisFixture as T, receipt: fakeReceipt('fake-analysis-1') };
      }
      if (req.schemaName === 'activity_spec') {
        return { data: bad as unknown as T, receipt: fakeReceipt('fake-gen-1') };
      }
      repairs += 1;
      return { data: genFixture as T, receipt: fakeReceipt(`fake-repair-${repairs}`) };
    },
  };
}

function tempStorage(): string {
  return mkdtempSync(join(tmpdir(), 'task015-api-'));
}

async function withServer(opts: ApiOptions, run: (base: string) => Promise<void>): Promise<void> {
  const server: Server = createApiServer(opts);
  await new Promise<void>(resolve => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  assert.ok(address !== null && typeof address === 'object');
  const base = `http://127.0.0.1:${(address as AddressInfo).port}`;
  try {
    await run(base);
  } finally {
    await new Promise<void>(resolve => {
      server.close(() => resolve());
    });
  }
}

/** Raw loopback request with fully custom headers (fetch forbids Host/Origin). */
function rawHttp(
  port: number,
  opts: { method?: string; path: string; headers?: Record<string, string>; body?: string },
): Promise<{ status: number; bodyText: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: '127.0.0.1', port, path: opts.path, method: opts.method ?? 'GET', headers: opts.headers ?? {} },
      res => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, bodyText: Buffer.concat(chunks).toString('utf8') }));
      },
    );
    req.on('error', reject);
    if (opts.body !== undefined) {
      req.write(opts.body);
    }
    req.end();
  });
}

const TEXT = [
  'Constant force motion on a straight, level runway, written by the teacher.',
  'The core relation is F = m * a and, solved for the acceleration, a = F / m.',
  'For a constant force and constant mass, the acceleration remains constant.',
  'Velocity grows linearly with time while the net force stays unchanged.',
  'Students predict the acceleration for a given mass and net force, then compare.',
].join('\n');

function sourceBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: 'Runway physics notes',
    text: TEXT,
    license: 'own-work',
    attribution: 'Written by the teacher for this class.',
    rightsConfirmed: true,
    ...overrides,
  };
}

async function postJson(base: string, path: string, body: unknown): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as unknown };
}

/* ------------------------------------------------------------------ */
/* POST /api/sources                                                    */
/* ------------------------------------------------------------------ */

test('POST /api/sources stores a teacher source atomically and answers 201 {id,title,kind}', async () => {
  const storageDir = tempStorage();
  await withServer({ storageDir, startJob: null }, async base => {
    const created = await postJson(base, '/api/sources', sourceBody());
    assert.equal(created.status, 201);
    const expectedId = userSourceId(TEXT);
    assert.deepEqual(created.body, { id: expectedId, title: 'Runway physics notes', kind: 'user' });

    const dir = join(storageDir, 'user-sources');
    assert.ok(existsSync(join(dir, `${expectedId}.json`)));
    assert.ok(existsSync(join(dir, `${expectedId}.txt`)));
    const meta = JSON.parse(readFileSync(join(dir, `${expectedId}.json`), 'utf8')) as Record<string, unknown>;
    assert.equal(meta['id'], expectedId);
    assert.equal(meta['kind'], 'user');
    assert.equal(meta['license'], 'own-work');
    assert.equal(meta['licenseLabel'], "Teacher's own work");
    assert.equal(meta['locator'], 'Provided by a teacher (pasted text)');
    assert.equal(meta['textFile'], `${expectedId}.txt`);
    assert.equal(meta['sha256'], sha256(normalizeUserText(TEXT)));
    assert.equal(typeof meta['createdAt'], 'string');
    assert.ok(!('text' in meta), 'the metadata file never duplicates the text');
    assert.equal(readFileSync(join(dir, `${expectedId}.txt`), 'utf8'), normalizeUserText(TEXT));

    // The list shows it with kind and never its text; the detail route returns the text.
    const list = await fetch(`${base}/api/sources`).then(r => r.json()) as Record<string, unknown>[];
    const userEntry = list.find(s => s['id'] === expectedId);
    assert.ok(userEntry !== undefined, 'the user source joins GET /api/sources');
    assert.equal(userEntry['kind'], 'user');
    assert.ok(!('text' in userEntry));
    for (const library of list.filter(s => s['id'] !== expectedId)) {
      assert.equal(library['kind'], 'library');
    }
    const detail = await fetch(`${base}/api/sources/${expectedId}`).then(r => r.json()) as Record<string, unknown>;
    assert.equal(detail['kind'], 'user');
    assert.equal(detail['text'], normalizeUserText(TEXT));
    assert.equal(detail['licenseLabel'], "Teacher's own work");
  });
});

test('POST /api/sources is idempotent for identical text (200) and normalisation-insensitive', async () => {
  const storageDir = tempStorage();
  await withServer({ storageDir, startJob: null }, async base => {
    const first = await postJson(base, '/api/sources', sourceBody());
    assert.equal(first.status, 201);
    const again = await postJson(base, '/api/sources', sourceBody());
    assert.equal(again.status, 200, 'identical text returns the existing source');
    assert.deepEqual(again.body, first.body);
    // CRLF line endings, a control character and surrounding whitespace normalise to the same source.
    const messy = await postJson(
      base,
      '/api/sources',
      sourceBody({ text: `\r\n${TEXT.replace(/\n/g, '\r\n').replace('core', 'co\u0000re')}  \r\n` }),
    );
    assert.equal(messy.status, 200, 'the normalised form already exists');
    assert.deepEqual(messy.body, first.body);
  });
});

test('POST /api/sources answers 400 SOURCE_INVALID with the problem list', async () => {
  const storageDir = tempStorage();
  await withServer({ storageDir, startJob: null }, async base => {
    const bad = await postJson(base, '/api/sources', {
      title: 'ab',
      text: 'too short',
      attribution: 'x',
      license: 'nope',
    });
    assert.equal(bad.status, 400);
    assert.deepEqual(bad.body, {
      error: 'SOURCE_INVALID',
      problems: ['TITLE_LENGTH', 'TEXT_LENGTH', 'ATTRIBUTION_LENGTH', 'LICENSE_INVALID', 'RIGHTS_NOT_CONFIRMED'],
    });
    const notObject = await fetch(`${base}/api/sources`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '[1,2]',
    });
    assert.equal(notObject.status, 400);
    assert.deepEqual(await notObject.json(), { error: 'SOURCE_INVALID', problems: ['NOT_AN_OBJECT'] });
    const badJson = await fetch(`${base}/api/sources`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    assert.equal(badJson.status, 400);
    assert.deepEqual(await badJson.json(), { error: 'BAD_REQUEST' });
    const wrongCt = await fetch(`${base}/api/sources`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: TEXT,
    });
    assert.equal(wrongCt.status, 415);
    assert.deepEqual(await wrongCt.json(), { error: 'UNSUPPORTED_MEDIA_TYPE' });
  });
});

test('POST /api/sources refuses bodies over 64 KB with 413', async () => {
  const storageDir = tempStorage();
  await withServer({ storageDir, startJob: null }, async base => {
    const big = await postJson(base, '/api/sources', sourceBody({ pad: 'x'.repeat(70 * 1024) }));
    assert.equal(big.status, 413);
    assert.deepEqual(big.body, { error: 'PAYLOAD_TOO_LARGE' });
  });
});

test('POST /api/sources enforces the 200-source limit with 409 SOURCE_LIMIT (existing text still 200)', async () => {
  const storageDir = tempStorage();
  const dir = join(storageDir, 'user-sources');
  const firstText = `Source number 0. ${'y'.repeat(300)}`;
  for (let i = 0; i < MAX_USER_SOURCES; i++) {
    const text = i === 0 ? firstText : `Source number ${i}. ${'y'.repeat(300)}`;
    saveUserSource(
      { title: `Source ${i}`, text, license: 'public-domain', attribution: 'Public domain text.', rightsConfirmed: true },
      dir,
    );
  }
  await withServer({ storageDir, startJob: null }, async base => {
    const fresh = await postJson(base, '/api/sources', sourceBody());
    assert.equal(fresh.status, 409);
    assert.deepEqual(fresh.body, { error: 'SOURCE_LIMIT' });
    const existing = await postJson(base, '/api/sources', sourceBody({ text: firstText }));
    assert.equal(existing.status, 200, 're-posting an existing source is idempotent even at the limit');
    assert.deepEqual(existing.body, { id: userSourceId(firstText), title: 'Runway physics notes', kind: 'user' });
  });
});

test('POST /api/sources rejects a foreign Origin with 403 and stores nothing (R-07)', async () => {
  const storageDir = tempStorage();
  await withServer({ storageDir, startJob: null }, async base => {
    const port = Number(new URL(base).port);
    const res = await rawHttp(port, {
      method: 'POST',
      path: '/api/sources',
      headers: { host: `127.0.0.1:${port}`, origin: 'http://attacker.example', 'content-type': 'application/json' },
      body: JSON.stringify(sourceBody()),
    });
    assert.equal(res.status, 403);
    assert.deepEqual(JSON.parse(res.bodyText), { error: 'ORIGIN_NOT_ALLOWED' });
    assert.ok(!existsSync(join(storageDir, 'user-sources')), 'nothing is stored for a rejected origin');
    // A foreign Host is refused too.
    const foreign = await rawHttp(port, {
      method: 'POST',
      path: '/api/sources',
      headers: { host: `attacker.example:${port}`, 'content-type': 'application/json' },
      body: JSON.stringify(sourceBody()),
    });
    assert.equal(foreign.status, 403);
    assert.deepEqual(JSON.parse(foreign.bodyText), { error: 'HOST_NOT_ALLOWED' });
    // The Vite dev proxy origin stays allowed.
    const proxy = await rawHttp(port, {
      method: 'POST',
      path: '/api/sources',
      headers: { host: '127.0.0.1:5173', origin: 'http://127.0.0.1:5173', 'content-type': 'application/json' },
      body: JSON.stringify(sourceBody()),
    });
    assert.equal(proxy.status, 201);
  });
});

test('GET /api/sources/:id — tampered user text is 500 SOURCE_UNAVAILABLE; missing user id is 404', async () => {
  const storageDir = tempStorage();
  const id = userSourceId(TEXT);
  saveUserSource(
    { title: 'Runway physics notes', text: TEXT, license: 'own-work', attribution: 'By the teacher.', rightsConfirmed: true },
    join(storageDir, 'user-sources'),
  );
  await withServer({ storageDir, startJob: null }, async base => {
    const ok = await fetch(`${base}/api/sources/${id}`);
    assert.equal(ok.status, 200);

    const textPath = join(storageDir, 'user-sources', `${id}.txt`);
    writeFileSync(textPath, `${readFileSync(textPath, 'utf8')}\ntampered`);
    const tampered = await fetch(`${base}/api/sources/${id}`);
    assert.equal(tampered.status, 500);
    assert.deepEqual(await tampered.json(), { error: 'SOURCE_UNAVAILABLE' });

    const missing = await fetch(`${base}/api/sources/user-000000000000`);
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: 'NOT_FOUND' });
  });
});

/* ------------------------------------------------------------------ */
/* POST /api/jobs with demoFault and user sources                       */
/* ------------------------------------------------------------------ */

function recordingStart(): {
  start: NonNullable<ApiOptions['startJob']>;
  started: { sourceId: string; demoFault?: DemoFault }[];
} {
  const started: { sourceId: string; demoFault?: DemoFault }[] = [];
  return {
    started,
    start: (sourceId: string, opts?: { demoFault?: DemoFault }) => {
      started.push({ sourceId, demoFault: opts?.demoFault });
      return {
        jobId: `job-${started.length}`,
        done: Promise.resolve<JobSummary>({
          jobId: `job-${started.length}`,
          sourceId,
          status: 'succeeded',
          purpose: 'demo',
          createdAt: new Date().toISOString(),
          totalCostUSD: 0,
          reservedUnknownUSD: 0,
          engine: null,
          revisions: 0,
          repairs: [],
          sourceKind: 'library',
        }),
      };
    },
  };
}

test('POST /api/jobs validates demoFault and passes it to the worker', async () => {
  const storageDir = tempStorage();
  const rec = recordingStart();
  await withServer({ storageDir, startJob: rec.start }, async base => {
    const bad = await postJson(base, '/api/jobs', {
      sourceId: 'nasa-grc-equations-of-motion',
      demoFault: 'made-up-fault',
    });
    assert.equal(bad.status, 400);
    assert.deepEqual(bad.body, { error: 'BAD_REQUEST' });
    const wrongType = await postJson(base, '/api/jobs', {
      sourceId: 'nasa-grc-equations-of-motion',
      demoFault: 42,
    });
    assert.equal(wrongType.status, 400);
    assert.deepEqual(rec.started, [], 'nothing is started for rejected bodies');

    for (const fault of ['wrong-answer', 'fabricated-quote'] as const) {
      const ok = await postJson(base, '/api/jobs', {
        sourceId: 'nasa-grc-equations-of-motion',
        demoFault: fault,
      });
      assert.equal(ok.status, 202);
      assert.deepEqual(rec.started.at(-1), { sourceId: 'nasa-grc-equations-of-motion', demoFault: fault });
    }
    const plain = await postJson(base, '/api/jobs', { sourceId: 'nasa-grc-equations-of-motion' });
    assert.equal(plain.status, 202);
    assert.deepEqual(rec.started.at(-1), { sourceId: 'nasa-grc-equations-of-motion', demoFault: undefined });
  });
});

test('POST /api/jobs accepts a teacher source id once it is stored', async () => {
  const storageDir = tempStorage();
  const rec = recordingStart();
  await withServer({ storageDir, startJob: rec.start }, async base => {
    const id = userSourceId(TEXT);
    const before = await postJson(base, '/api/jobs', { sourceId: id });
    assert.equal(before.status, 404, 'unknown user ids are still SOURCE_NOT_FOUND');
    assert.deepEqual(before.body, { error: 'SOURCE_NOT_FOUND' });

    const created = await postJson(base, '/api/sources', sourceBody());
    assert.equal(created.status, 201);
    const after = await postJson(base, '/api/jobs', { sourceId: id });
    assert.equal(after.status, 202);
    assert.deepEqual(rec.started.at(-1), { sourceId: id, demoFault: undefined });
  });
});

/* ------------------------------------------------------------------ */
/* GET /api/jobs/:id exposes every revision                             */
/* ------------------------------------------------------------------ */

test('GET /api/jobs/:id serves all revisions (1 → 2) plus summary and events', async () => {
  const storageDir = tempStorage();
  const { jobId, done } = realStartJob('nasa-grc-equations-of-motion', {
    client: repairOnceClient(),
    storageDir,
    purpose: 'test-live',
  });
  const summary = await done;
  assert.equal(summary.status, 'succeeded');
  assert.equal(summary.publishedRevision, 2);

  await withServer({ storageDir, startJob: null }, async base => {
    const res = await fetch(`${base}/api/jobs/${jobId}`);
    assert.equal(res.status, 200);
    const job = (await res.json()) as {
      summary: JobSummary;
      events: { stage: string; status: string; revision?: number }[];
      revisions: { revision: number; spec: unknown; report?: unknown }[];
      spec?: unknown;
      report?: unknown;
    };
    assert.equal(job.summary.publishedRevision, 2);
    assert.equal(job.summary.revisions, 2);
    assert.equal(job.summary.repairs.length, 1);
    assert.equal(job.summary.engine, 'forces-1d-v1');
    assert.equal(job.summary.sourceKind, 'library');
    assert.equal(job.revisions.length, 2);
    assert.deepEqual(
      job.revisions.map(r => r.revision),
      [1, 2],
    );
    for (const rev of job.revisions) {
      assert.ok(rev.spec !== undefined, `revision ${rev.revision} carries its spec`);
      assert.ok(rev.report !== undefined, `revision ${rev.revision} carries its report`);
    }
    const runDir = join(storageDir, 'runs', jobId);
    assert.deepEqual(job.revisions[0]?.spec, JSON.parse(readFileSync(join(runDir, 'spec.r1.json'), 'utf8')));
    assert.deepEqual(job.revisions[1]?.spec, JSON.parse(readFileSync(join(runDir, 'spec.r2.json'), 'utf8')));
    // Compatibility fields keep pointing at the published revision.
    assert.deepEqual(job.spec, job.revisions[1]?.spec);
    assert.deepEqual(job.report, job.revisions[1]?.report);
    // The timeline shows the repair: revision-tagged validate events around it.
    assert.ok(job.events.some(e => e.stage === 'repair' && e.status === 'started' && e.revision === 2));
    assert.ok(job.events.some(e => e.stage === 'validate' && e.status === 'failed' && e.revision === 1));
    assert.ok(job.events.some(e => e.stage === 'validate' && e.status === 'succeeded' && e.revision === 2));
  });
});

test('GET /api/jobs/:id for a first-try publishable run serves one revision and keeps the old shape', async () => {
  const storageDir = tempStorage();
  const client: MetaClient = {
    complete: async <T>(req: CompleteRequest): Promise<{ data: T; receipt: MetaReceipt }> => {
      if (req.schemaName === 'source_analysis') {
        return { data: analysisFixture as T, receipt: fakeReceipt('fake-analysis-1') };
      }
      return { data: genFixture as T, receipt: fakeReceipt('fake-gen-1') };
    },
  };
  const { jobId, done } = realStartJob('nasa-grc-equations-of-motion', { client, storageDir, purpose: 'test-live' });
  const summary = await done;
  assert.equal(summary.status, 'succeeded');
  assert.equal(summary.publishedRevision, 1);
  await withServer({ storageDir, startJob: null }, async base => {
    const res = await fetch(`${base}/api/jobs/${jobId}`);
    const job = (await res.json()) as {
      revisions: { revision: number; spec: unknown; report?: unknown }[];
      spec?: unknown;
      report?: unknown;
    };
    assert.equal(job.revisions.length, 1);
    assert.equal(job.revisions[0]?.revision, 1);
    assert.ok(job.spec !== undefined);
    assert.ok(job.report !== undefined);
    assert.deepEqual(job.spec, job.revisions[0]?.spec);
  });
});
