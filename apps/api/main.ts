// TASK-005 — API entry point. Localhost only; live generation is opt-in via META_LIVE=1
// and requires MODEL_API_KEY (loaded from the environment, never logged, never sent to clients).
//
//   PORT         default 8787
//   STORAGE_DIR  default 'storage'
//   META_LIVE    '1' enables live generation (opens ledger + Meta client)
//   META_PURPOSE 'demo' | 'test-live' (default 'test-live')
//
// Live mode opens the spending ledger FIRST (TASK-009 N-01: an OS-backed lock;
// LEDGER_LOCKED exits 1) and only then recovers interrupted jobs, so job
// storage is mutated only by the process that owns the ledger (TASK-009 N-05).
// An offline server never recovers or mutates jobs. In live mode, prints before
// listening (TASK-009 R-10):
//   Recovered <n> interrupted job(s) from <storageDir>
// then exactly one line when listening:
//   API listening on http://127.0.0.1:<port> (live generation: on|off, purpose: <p>)

import { readFileSync } from 'node:fs';
import { openLedger } from '../../packages/meta/ledger.ts';
import type { Ledger } from '../../packages/meta/ledger.ts';
import { createMetaClient, MetaError } from '../../packages/meta/client.ts';
import type { MetaClient } from '../../packages/meta/client.ts';
import type { DemoFault } from '../../packages/contracts/index.ts';
import { startJob as startGenerationJob, recoverInterruptedJobs } from '../../workers/generation/jobs.ts';
import { parseResourceLimits } from './resource-limits.ts';
import { createApiServer } from './server.ts';
import type { ApiOptions } from './server.ts';

const portEnv: string | undefined = process.env.PORT;
const port: number =
  portEnv !== undefined && /^[0-9]+$/.test(portEnv) && Number(portEnv) > 0 ? Number(portEnv) : 8787;
const storageDir: string = process.env.STORAGE_DIR ?? 'storage';
const live: boolean = process.env.META_LIVE === '1';
const purpose: 'test-live' | 'demo' = process.env.META_PURPOSE === 'demo' ? 'demo' : 'test-live';

let startJob: ApiOptions['startJob'] = null;
let activeLedger: Ledger | null = null;

async function startup(): Promise<void> {
  if (live) {
    try {
      // R-11/S5-06: every runtime bound is validated up front and fails closed
      // with RESOURCE_LIMITS_INVALID — including maxRepairAttempts, which must
      // be an integer in [0, 2] (the absolute repair rule).
      const limits = parseResourceLimits(
        JSON.parse(readFileSync(new URL('../../config/resource-limits.json', import.meta.url), 'utf8')),
      );
      // N-01: the OS-backed ledger lock — a second process fails closed below.
      const ledger: Ledger = await openLedger({
        path: `${storageDir}/ledger.jsonl`,
        capUSD: limits.capUSD,
        lockPort: limits.ledgerLockPort,
      });
      activeLedger = ledger;
      const client: MetaClient = createMetaClient({
        apiKey: process.env.MODEL_API_KEY,
        ledger,
        allowLive: true,
        // R-11: the configured input budget, not the client default.
        maxInputTokens: limits.maxInputTokens,
      });
      startJob = (sourceId: string, jobOpts?: { demoFault?: DemoFault }) =>
        startGenerationJob(sourceId, {
          client,
          storageDir,
          purpose,
          // Stage 5: the optional labelled demo fault requested by POST /api/jobs.
          demoFault: jobOpts?.demoFault,
          // R-11: one job-wide deadline and per-stage output caps from config;
          // maxRepairAttempts bounds the Stage 5 repair loop (S5-06: an integer
          // in [0, 2], validated at startup AND again by the worker boundary).
          limits: {
            maxJobWallTimeMs: limits.wallTimeMs,
            analysisMaxOutputTokens: limits.analysisMaxOutputTokens,
            specMaxOutputTokens: limits.maxOutputTokens,
            maxRepairAttempts: limits.maxRepairAttempts,
          },
        });
      // N-05: recovery mutates job storage, so it runs ONLY in live mode and
      // ONLY after this process holds the spending ledger. An offline server
      // never recovers — and so never interrupts another live owner's job.
      const recovered: string[] = recoverInterruptedJobs(storageDir, undefined, {
        maxJobWallTimeMs: limits.wallTimeMs,
      });
      console.log(`Recovered ${recovered.length} interrupted job(s) from ${storageDir}`);
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'LEDGER_LOCKED') {
        console.error('LEDGER_LOCKED: another process owns the spending ledger');
        process.exit(1);
      }
      const code: string =
        err instanceof MetaError ? err.code : err instanceof Error ? err.message : 'UNKNOWN';
      console.error(`API startup failed: ${code}`);
      process.exit(1);
    }
  }

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
  await new Promise<void>(resolveListen => {
    server.listen(port, '127.0.0.1', () => {
      console.log(
        `API listening on http://127.0.0.1:${port} (live generation: ${live ? 'on' : 'off'}, purpose: ${purpose})`,
      );
      resolveListen();
    });
  });
}

await startup();
