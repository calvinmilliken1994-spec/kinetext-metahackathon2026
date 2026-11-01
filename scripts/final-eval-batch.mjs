// Final-evaluation batch driver (copied from the Stage 7b scratch driver, 2026-10-31): runs a list of
// (sourceId, model, run) jobs through the LIVE local API, at most CONCURRENCY at a time, and appends one
// JSON line per finished job to OUT. Resumable: plan rows whose (sourceId, model, run) already have a
// line in OUT are skipped.
// Usage: node.exe scripts/final-eval-batch.mjs <plan.json> <out.jsonl>
import { readFileSync, appendFileSync, existsSync } from 'node:fs';

const [planFile, out] = process.argv.slice(2);
const fullPlan = JSON.parse(readFileSync(planFile, 'utf8'));
const key = (r) => `${r.sourceId}|${r.model}|${r.run}`;
const doneKeys = new Set(existsSync(out) ? readFileSync(out, 'utf8').split('\n').filter(Boolean).map((l) => { try { const r = JSON.parse(l); return r.jobId ? key(r) : null; } catch { return null; } }).filter(Boolean) : []);
const plan = fullPlan.filter((r) => !doneKeys.has(key(r)));
console.log(`plan ${fullPlan.length}, already done ${fullPlan.length - plan.length}, to run ${plan.length}`);
const API = process.env.API_BASE ?? 'http://127.0.0.1:8787';
const RUNS = new URL('../storage/runs/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1').replace(/\/$/, '');
const CONCURRENCY = 3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function start(item) {
  for (;;) {
    const res = await fetch(`${API}/api/jobs`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sourceId: item.sourceId, model: item.model, flow: item.flow ?? 'lesson' }),
    });
    if (res.status === 202) return (await res.json()).jobId;
    if (res.status === 409) { await sleep(5000); continue; }
    throw new Error(`POST ${res.status} ${await res.text()}`);
  }
}

async function finish(jobId) {
  const file = `${RUNS}/${jobId}/job.json`;
  for (;;) {
    await sleep(5000);
    if (!existsSync(file)) continue;
    const j = JSON.parse(readFileSync(file, 'utf8'));
    if (j.status !== 'running') return j;
  }
}

let next = 0; let done = 0;
async function worker() {
  while (next < plan.length) {
    const item = plan[next++];
    const t0 = Date.now();
    try {
      const jobId = await start(item);
      const j = await finish(jobId);
      let lesson = null;
      try { lesson = JSON.parse(readFileSync(`${RUNS}/${jobId}/lesson.json`, 'utf8')); } catch { /* activity flow or no lesson */ }
      const comps = lesson?.components ?? [];
      const line = {
        ...item, jobId, status: j.status, wallS: Math.round((Date.now() - t0) / 1000), costUSD: j.totalCostUSD,
        engine: j.engine ?? null,
        planned: comps.length || null,
        published: comps.filter((c) => c.status === 'passed').length || 0,
        components: comps.map((c) => `${c.componentId}:${c.status}`),
        failureCode: j.cause ?? j.failure?.code ?? null,
      };
      appendFileSync(out, JSON.stringify(line) + '\n');
      done++;
      console.log(`[${done}/${plan.length}] ${item.sourceId} ${item.model} ${j.status} ${line.published}/${line.planned ?? '-'} ${line.wallS}s $${j.totalCostUSD}`);
    } catch (e) {
      appendFileSync(out, JSON.stringify({ ...item, error: String(e).slice(0, 200) }) + '\n');
      console.log(`ERROR ${item.sourceId}: ${String(e).slice(0, 200)}`);
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
console.log('ALL DONE');
