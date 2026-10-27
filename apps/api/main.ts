// TASK-005 — API entry point. Localhost only; live generation is opt-in via META_LIVE=1
// and requires MODEL_API_KEY (loaded from the environment, never logged, never sent to clients).
//
//   PORT         default 8787
//   STORAGE_DIR  default 'storage'
//   META_LIVE    '1' enables live generation (creates ledger + Meta client)
//   META_PURPOSE 'demo' | 'test-live' (default 'test-live')
//
// Prints before listening (TASK-009 R-10):
//   Recovered <n> interrupted job(s) from <storageDir>
// then exactly one line when listening:
//   API listening on http://127.0.0.1:<port> (live generation: on|off, purpose: <p>)

import { readFileSync } from 'node:fs';
import { createLedger } from '../../packages/meta/ledger.ts';
import type { Ledger } from '../../packages/meta/ledger.ts';
import { createMetaClient, MetaError } from '../../packages/meta/client.ts';
import type { MetaClient } from '../../packages/meta/client.ts';
import { startJob as startGenerationJob, recoverInterruptedJobs } from '../../workers/generation/jobs.ts';
import { createApiServer } from './server.ts';
import type { ApiOptions } from './server.ts';

const portEnv: string | undefined = process.env.PORT;
const port: number =
  portEnv !== undefined && /^[0-9]+$/.test(portEnv) && Number(portEnv) > 0 ? Number(portEnv) : 8787;
const storageDir: string = process.env.STORAGE_DIR ?? 'storage';
const live: boolean = process.env.META_LIVE === '1';
const purpose: 'test-live' | 'demo' = process.env.META_PURPOSE === 'demo' ? 'demo' : 'test-live';

/** R-11: config budgets must be finite positive numbers — fail closed at startup. */
function finitePositive(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

let startJob: ApiOptions['startJob'] = null;
let activeLedger: Ledger | null = null;
if (live) {
  try {
    const limits = JSON.parse(
      readFileSync(new URL('../../config/resource-limits.json', import.meta.url), 'utf8'),
    ) as { stageCapsUSD?: { stage2?: number }; maxJobWallTimeMs?: unknown; maxOutputTokens?: unknown };
    const capUSD: number = limits.stageCapsUSD?.stage2 ?? 0; // default zero spend
    const wallTimeMs: unknown = limits.maxJobWallTimeMs;
    const maxOutputTokens: unknown = limits.maxOutputTokens;
    if (!finitePositive(wallTimeMs) || !finitePositive(maxOutputTokens)) {
      throw new Error('RESOURCE_LIMITS_INVALID');
    }
    const ledger = createLedger({ path: `${storageDir}/ledger.jsonl`, capUSD });
    activeLedger = ledger;
    const client: MetaClient = createMetaClient({
      apiKey: process.env.MODEL_API_KEY,
      ledger,
      allowLive: true,
    });
    startJob = (sourceId: string) =>
      startGenerationJob(sourceId, {
        client,
        storageDir,
        purpose,
        // R-11: one job-wide deadline and per-stage output caps from config.
        limits: {
          maxJobWallTimeMs: wallTimeMs,
          analysisMaxOutputTokens: Math.min(6000, maxOutputTokens),
          specMaxOutputTokens: maxOutputTokens,
        },
      });
  } catch (err: unknown) {
    const code: string =
      err instanceof MetaError ? err.code : err instanceof Error ? err.message : 'UNKNOWN';
    console.error(`API startup failed: ${code}`);
    process.exit(1);
  }
}

// R-10: recover jobs left 'running' by a previous process BEFORE accepting traffic.
const recovered: string[] = recoverInterruptedJobs(storageDir);
console.log(`Recovered ${recovered.length} interrupted job(s) from ${storageDir}`);

const server = createApiServer({ storageDir, startJob });
server.on('error', (err: Error) => {
  console.error(`API server error: ${err.message}`);
  process.exit(1);
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    // Release the ledger lock so the next start is not LEDGER_LOCKED.
    activeLedger?.close();
    process.exit(0);
  });
}
server.listen(port, '127.0.0.1', () => {
  console.log(
    `API listening on http://127.0.0.1:${port} (live generation: ${live ? 'on' : 'off'}, purpose: ${purpose})`,
  );
});
