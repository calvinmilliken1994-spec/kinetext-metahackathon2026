// TASK-005 — API entry point. Localhost only; live generation is opt-in via META_LIVE=1
// and requires MODEL_API_KEY (loaded from the environment, never logged, never sent to clients).
//
//   PORT         default 8787
//   STORAGE_DIR  default 'storage'
//   META_LIVE    '1' enables live generation (creates ledger + Meta client)
//   META_PURPOSE 'demo' | 'test-live' (default 'test-live')
//
// Prints exactly one line when listening:
//   API listening on http://127.0.0.1:<port> (live generation: on|off, purpose: <p>)

import { readFileSync } from 'node:fs';
import { createLedger } from '../../packages/meta/ledger.ts';
import { createMetaClient, MetaError } from '../../packages/meta/client.ts';
import type { MetaClient } from '../../packages/meta/client.ts';
import { startJob as startGenerationJob } from '../../workers/generation/jobs.ts';
import { createApiServer } from './server.ts';
import type { ApiOptions } from './server.ts';

const portEnv: string | undefined = process.env.PORT;
const port: number =
  portEnv !== undefined && /^[0-9]+$/.test(portEnv) && Number(portEnv) > 0 ? Number(portEnv) : 8787;
const storageDir: string = process.env.STORAGE_DIR ?? 'storage';
const live: boolean = process.env.META_LIVE === '1';
const purpose: 'test-live' | 'demo' = process.env.META_PURPOSE === 'demo' ? 'demo' : 'test-live';

let startJob: ApiOptions['startJob'] = null;
if (live) {
  try {
    const limits = JSON.parse(
      readFileSync(new URL('../../config/resource-limits.json', import.meta.url), 'utf8'),
    ) as { stageCapsUSD?: { stage2?: number } };
    const capUSD: number = limits.stageCapsUSD?.stage2 ?? 0; // default zero spend
    const ledger = createLedger({ path: `${storageDir}/ledger.jsonl`, capUSD });
    const client: MetaClient = createMetaClient({
      apiKey: process.env.MODEL_API_KEY,
      ledger,
      allowLive: true,
    });
    startJob = (sourceId: string) => startGenerationJob(sourceId, { client, storageDir, purpose });
  } catch (err: unknown) {
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
server.listen(port, '127.0.0.1', () => {
  console.log(
    `API listening on http://127.0.0.1:${port} (live generation: ${live ? 'on' : 'off'}, purpose: ${purpose})`,
  );
});
