// Live spike (TASK-004 acceptance, EXP-001): run analyzeSource + generateSpec against the real Meta Model API.
// Spends participant credits (purpose test-live) under the Stage 2 ledger cap. Usage:
//   MODEL_API_KEY=... node scripts/live-spike.ts <sourceId>
import { mkdirSync, writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { openLedger } from '../packages/meta/ledger.ts';
import { createMetaClient, MetaError } from '../packages/meta/client.ts';
import { analyzeSource, generateSpec } from '../packages/meta/pipeline.ts';
import { loadSource } from '../packages/sources/index.ts';

const sourceId = process.argv[2] ?? 'nasa-grc-equations-of-motion';
const limits = JSON.parse(readFileSync(new URL('../config/resource-limits.json', import.meta.url), 'utf8'));
const ledger = await openLedger({ path: 'storage/ledger.jsonl', capUSD: limits.stageCapsUSD.stage2, lockPort: limits.ledgerLockPort });
const client = createMetaClient({ apiKey: process.env.MODEL_API_KEY, ledger, allowLive: true, maxInputTokens: limits.maxInputTokens });
const jobId = `spike-${Date.now()}`;
const dir = `storage/runs/${jobId}`;
mkdirSync(dir, { recursive: true });
const source = loadSource(sourceId);
// R-11: one deadline for the whole spike, and the configured output caps.
const signal = AbortSignal.timeout(limits.maxJobWallTimeMs);
const specMaxOutputTokens: number = limits.maxOutputTokens;
const analysisMaxOutputTokens = Math.min(6000, specMaxOutputTokens);
const summary = (r: { checks: { id: string; passed: boolean; message: string }[]; publishable: boolean }) =>
  ({ publishable: r.publishable, failed: r.checks.filter(c => !c.passed).map(c => `${c.id}: ${c.message}`) });

try {
  const a = await analyzeSource(client, source, 'test-live', { signal, maxOutputTokens: analysisMaxOutputTokens });
  writeFileSync(`${dir}/analysis.json`, JSON.stringify(a, null, 2));
  console.log(JSON.stringify({ stage: 'analyze', receipt: a.receipt, supported: a.analysis.supported, report: summary(a.report) }));
  if (a.analysis.supported && a.report.publishable) {
    const s = await generateSpec(client, source, a.analysis, { jobId, specId: `${sourceId}-spike` }, 'test-live', () => new Date(), { signal, maxOutputTokens: specMaxOutputTokens });
    writeFileSync(`${dir}/spec.json`, JSON.stringify(s.spec, null, 2));
    writeFileSync(`${dir}/report.json`, JSON.stringify(s.report, null, 2));
    console.log(JSON.stringify({ stage: 'specify', receipt: s.receipt, report: summary(s.report) }));
  }
} catch (err) {
  // R-01: print only the public error code and cost fields, never messages or provider data.
  const e = err as MetaError;
  console.log(JSON.stringify({ stage: 'error', code: e.code ?? 'INTERNAL', status: e.status, chargedUSD: e.chargedUSD, costBasis: e.costBasis }));
  process.exitCode = 1;
}
console.log(JSON.stringify({ jobId, dir, ledgerCommittedUSD: ledger.committedUSD(), capUSD: ledger.capUSD }));
ledger.close();
