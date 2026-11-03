// TASK-005 — API entry point. Localhost only; live generation is opt-in via META_LIVE=1
// and requires MODEL_API_KEY (loaded from the environment, never logged, never sent to clients).
//
//   PORT         default 8787
//   STORAGE_DIR  default 'storage'
//   META_LIVE    '1' enables live generation (opens ledger + Meta client)
//   META_PURPOSE 'demo' | 'test-live' (default 'test-live')
//
// Stage 10 slice A (judge access, apps/api/access.ts; never logged, never sent to a client):
//   ACCESS_CODE            the one shared judge code; the gate is ON when set and non-empty,
//                          OFF (today's local behaviour, unchanged) when unset
//   ACCESS_SESSION_SECRET  HMAC key for the session cookie; a random per-process key when
//                          absent, so sessions end on restart
//   BUILDS_PAUSED          '1' pauses gated builds at runtime (kill switch, no redeploy);
//                          the file <STORAGE_DIR>/BUILDS_PAUSED does the same
//   TRUST_PROXY            '1' behind a trusted reverse proxy (Render): the access-code attempt
//                          limiter then keys on the rightmost X-Forwarded-For entry
//   judgeCapUSD (config/resource-limits.json) is the judge budget (USD 50).
//

// OW-2 (open-weights mode): POST /api/jobs carries an optional model choice. A
// muse-spark-open job builds its Modal client at submission time and reads
// MODAL_PROXY_TOKEN (`wk-…ws-…`, split server-side) ONLY then — the token is
// never logged, never in a response/event/job file, and a missing token fails
// that job with the fixed MODAL_PROXY_TOKEN_MISSING public error before any
// reservation. GET /api/health and GET /api/models report availability as
// booleans only.
//
// Stage 11 slice L (local relay mode; apps/api/relay.ts, docs/specs/STAGE-11-judge-relay.md):
//   RELAY       '1' forces relay mode, '0' turns it off (default: relay mode when MODEL_API_KEY is
//               absent or blank and config/relay.json holds a url)
//   WEB_DIST_DIR a built web app folder to serve on the same port (scripts/start.mjs sets it)
// In relay mode the server holds no keys: a judge enters the access code (POST /api/access), the relay
// checks it, the code is kept in memory only, and every model call goes to the relay with it. With no
// key and no relay url the server starts read-only (live generation off).
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
import type { ModelChoice } from '../../packages/meta/pricing.ts';
import type { DemoFault } from '../../packages/contracts/index.ts';
import { startJob as startGenerationJob, recoverInterruptedJobs } from '../../workers/generation/jobs.ts';
import type { JobFlow } from '../../workers/generation/jobs.ts';
import { parseResourceLimits } from './resource-limits.ts';
import { buildModalClient, modalTokenAvailable } from './model-clients.ts';
import { createRelayControl, loadRelayConfig, selectApiMode } from './relay.ts';
import type { ApiMode, RelayControl } from './relay.ts';
import { buildRelayJobClients } from './relay-clients.ts';
import { staticDirIfBuilt } from './static.ts';
import { createApiServer } from './server.ts';
import type { ApiOptions } from './server.ts';

const portEnv: string | undefined = process.env.PORT;
const port: number =
  portEnv !== undefined && /^[0-9]+$/.test(portEnv) && Number(portEnv) > 0 ? Number(portEnv) : 8787;
const storageDir: string = process.env.STORAGE_DIR ?? 'storage';

// Stage 11: which way this server runs (relay | direct | readonly). Direct mode is exactly today's.
let mode: ApiMode;
let relay: RelayControl | undefined;
try {
  const relayUrl: string = loadRelayConfig().url;
  mode = selectApiMode(process.env, relayUrl);
  relay = mode === 'relay' ? createRelayControl({ url: relayUrl }) : undefined;
} catch (err: unknown) {
  console.error(`API startup failed: ${err instanceof Error ? err.message : 'UNKNOWN'}`);
  process.exit(1);
}
const live: boolean = mode !== 'readonly';
const staticDir: string | undefined = staticDirIfBuilt(process.env.WEB_DIST_DIR);
const purpose: 'test-live' | 'demo' = process.env.META_PURPOSE === 'demo' ? 'demo' : 'test-live';

let startJob: ApiOptions['startJob'] = null;
let activeLedger: Ledger | null = null;
/**
 * Concurrency (part B): the validated config value (product default 3). Only live mode
 * reads the config; an offline server keeps the createApiServer option default (1) —
 * it can never run a job anyway (POST answers 503 LIVE_DISABLED).
 */
let maxConcurrentJobs: number | undefined;
/** Stage 10: the validated judge budget (live mode reads the config; offline keeps the access.ts default). */
let judgeCapUSD: number | undefined;

async function startup(): Promise<void> {
  if (live) {
    try {
      // R-11/S5-06: every runtime bound is validated up front and fails closed
      // with RESOURCE_LIMITS_INVALID — including maxRepairAttempts, which must
      // be an integer in [0, 2] (the absolute repair rule).
      const limits = parseResourceLimits(
        JSON.parse(readFileSync(new URL('../../config/resource-limits.json', import.meta.url), 'utf8')),
      );
      maxConcurrentJobs = limits.maxConcurrentJobs;
      judgeCapUSD = limits.judgeCapUSD;
      // N-01: the OS-backed ledger lock — a second process fails closed below.
      // OW-2: per-provider caps from config (meta-api additionally bounded by
      // the stage-2 cap; modal capped separately).
      const ledger: Ledger = await openLedger({
        path: `${storageDir}/ledger.jsonl`,
        capUSD: limits.capUSD,
        lockPort: limits.ledgerLockPort,
        providerCapsUSD: limits.providerCapsUSD,
      });
      activeLedger = ledger;
      // S6-W: the client input bound is fixed per client instance (packages/meta client.ts),
      // so a job's flow selects the bound its client is CONSTRUCTED with: lesson-flow (v2)
      // jobs use maxInputTokensV2 (72,000 — the v2 prompt family measured 40.8k bytes on the
      // largest source), activity-flow (v1) jobs keep maxInputTokens (32,000). The Meta-API
      // client is cheap to construct (no I/O), so it is built per job like the Modal one.
      const buildMetaApiClient = (maxInputTokens: number): MetaClient =>
        createMetaClient({
          apiKey: process.env.MODEL_API_KEY,
          ledger,
          allowLive: true,
          // R-11: the configured input budget, not the client default.
          maxInputTokens,
        });
      // Built once at startup so a missing key still fails startup exactly as before.
      // Relay mode holds no key: its clients are built per job from the in-memory access code.
      const client: MetaClient | null = relay === undefined ? buildMetaApiClient(limits.maxInputTokens) : null;
      const clientV2: MetaClient | null = relay === undefined ? buildMetaApiClient(limits.maxInputTokensV2) : null;
      startJob = (
        sourceId: string,
        jobOpts?: { demoFault?: DemoFault; model?: ModelChoice; flow?: JobFlow; access?: 'judge'; figureId?: string },
      ) => {
        const model: ModelChoice = jobOpts?.model ?? 'muse-spark-1.3';
        const flow: JobFlow = jobOpts?.flow ?? 'lesson';
        // OW-2: the right client PER JOB. muse-spark-1.3 keeps the Meta-API
        // client built above; muse-spark-open builds its Modal client at
        // SUBMISSION time, so MODAL_PROXY_TOKEN is read only for such a job and
        // a missing/malformed token fails that job with the fixed public
        // MODAL_PROXY_TOKEN_MISSING error before any ledger reservation. There
        // is never a silent fallback between providers.
        // S6-W: the flow picks the input bound the client was constructed with.
        // Stage 11: in relay mode the code the relay accepted (memory only) is read here, at submission
        // time; the clients send it to the relay, which holds Calvin's keys.
        const relayJob =
          relay !== undefined
            ? buildRelayJobClients({
                relay,
                model,
                flow,
                ledger,
                maxInputTokens: limits.maxInputTokens,
                maxInputTokensV2: limits.maxInputTokensV2,
              })
            : null;
        const jobClient: MetaClient =
          relayJob !== null
            ? relayJob.client
            : model === 'muse-spark-open'
              ? buildModalClient({
                  ledger,
                  maxInputTokens: flow === 'lesson' ? limits.maxInputTokensV2 : limits.maxInputTokens,
                  modalBaseUrl: limits.modalBaseUrl,
                })
              : ((flow === 'lesson' ? clientV2 : client) as MetaClient);
        return startGenerationJob(sourceId, {
          client: jobClient,
          storageDir,
          purpose,
          // Stage 5: the optional labelled demo fault requested by POST /api/jobs.
          demoFault: jobOpts?.demoFault,
          // Stage 10: a job started under a judge access session is tagged in its job record.
          ...(jobOpts?.access === 'judge' ? { access: 'judge' as const } : {}),
          // Teacher diagram (beta): the teacher figure the API checked belongs to this user source.
          ...(jobOpts?.figureId !== undefined ? { figureId: jobOpts.figureId } : {}),
          // Stage 8b: SAM 3.1 segmentation for label-diagram-v1 revisions runs on the
          // Meta API key and the job's spending ledger (USD 0.0025 per image, reserved
          // and reconciled like every model call). The key is read from the environment
          // here only and never logged.
          sam: relayJob !== null ? relayJob.sam : { apiKey: process.env.MODEL_API_KEY, ledger },
          // S6-W: the pipeline choice from POST /api/jobs (default 'lesson').
          flow,
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
      };
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

  const server = createApiServer({
    storageDir,
    startJob,
    // Concurrency (part B): up to the validated config limit of simultaneous live jobs
    // (each with its own abort/wall-time budget and cost accumulator); the busy 409 only
    // fires when that many are running.
    ...(maxConcurrentJobs !== undefined ? { maxConcurrentJobs } : {}),
    // Stage 10 slice A: judge access. The code and secret come from the environment only and
    // are handed straight to the access module; nothing here prints them.
    access: {
      code: process.env.ACCESS_CODE ?? '',
      ...(process.env.ACCESS_SESSION_SECRET ? { sessionSecret: process.env.ACCESS_SESSION_SECRET } : {}),
      ...(judgeCapUSD !== undefined ? { judgeCapUSD } : {}),
      trustProxy: process.env.TRUST_PROXY === '1',
    },
    // OW-2: which models are available — BOOLEANS ONLY, re-evaluated per
    // request. In live mode the Meta-API client exists by construction (startup
    // fails without its key), so muse-spark-1.3 is available; muse-spark-open
    // is available exactly when a well-formed MODAL_PROXY_TOKEN is present in
    // the environment (shape check only — the value is read solely when a
    // muse-spark-open job is submitted, and never leaves the server).
    // Relay mode leaves this to the server: both models once a code is held.
    ...(relay === undefined
      ? {
          availableModels: (): ModelChoice[] => {
            if (!live) {
              return [];
            }
            const models: ModelChoice[] = ['muse-spark-1.3'];
            if (modalTokenAvailable()) {
              models.push('muse-spark-open');
            }
            return models;
          },
        }
      : {}),
    // Stage 11: relay mode (the relay judges the access code) and the built web app on this port.
    ...(relay !== undefined ? { relay } : {}),
    ...(staticDir !== undefined ? { staticDir } : {}),
  });
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
      if (relay !== undefined) {
        console.log('Relay mode: live builds unlock when a valid access code is entered in the app.');
      } else if (!live) {
        console.log('Read-only: live builds are unavailable (no MODEL_API_KEY and no relay in config/relay.json).');
      }
      if (staticDir !== undefined) {
        console.log(`Serving the web app from ${staticDir}`);
      }
      resolveListen();
    });
  });
}

await startup();
