// SAM mask probe (Calvin 2026-11-02: "go ahead with the filter and the probe"). ONE live sam-3.1 call on the NOAA water
// cycle figure with the same five point prompts as the stored run job-20261031081105-910f3776 (revision 2), through the
// project ledger. Saves SAM's raw output (boxes AND masks) so the mask encoding can be decoded offline. The key is read
// from MODEL_API_KEY in the environment and never printed.
import { readFileSync, writeFileSync } from 'node:fs';
import { segmentPoints } from '../../../packages/meta/sam.ts';
import { openLedger } from '../../../packages/meta/ledger.ts';

const ROOT = new URL('../../../', import.meta.url);
const meta = JSON.parse(readFileSync(new URL('data/figures/noaa-hydrologic-cycle-1.json', ROOT), 'utf8'));
const bytes = new Uint8Array(readFileSync(new URL(`data/figures/${meta.file}`, ROOT)));
const art = JSON.parse(readFileSync(new URL('storage/runs/job-20261031081105-910f3776/label-diagram-v1.r2.json', ROOT), 'utf8'));
const parts: { id: string; x: number; y: number }[] = art.gen.parts;
const points = parts.map((p, i) => ({ id: i + 1, x: Math.round((p.x * meta.width) / 1000), y: Math.round((p.y * meta.height) / 1000) }));
const limits = JSON.parse(readFileSync(new URL('config/resource-limits.json', ROOT), 'utf8'));
const ledger = await openLedger({ path: new URL('storage/ledger.jsonl', ROOT).pathname.replace(/^\/([A-Za-z]:)/, '$1'), capUSD: limits.stageCapsUSD.stage2, lockPort: limits.ledgerLockPort, providerCapsUSD: limits.providerCapsUSD });
try {
  const res = await segmentPoints({ apiKey: process.env.MODEL_API_KEY, ledger, purpose: 'test-live', image: { bytes, mime: meta.mime, width: meta.width, height: meta.height }, points });
  const out = new URL('docs/evidence/sam-mask-probe/', ROOT);
  writeFileSync(new URL('raw-output.txt', out), res.raw);
  writeFileSync(new URL('result.json', out), JSON.stringify({ figure: meta.id, size: [meta.width, meta.height], points: points.map((p, i) => ({ ...p, partId: parts[i]?.id })), boxes: res.boxes, imagesProcessed: res.imagesProcessed, costUSD: res.costUSD, latencyMs: res.latencyMs, at: new Date().toISOString() }, null, 2) + '\n');
  console.log(JSON.stringify({ boxes: res.boxes.length, rawChars: res.raw.length, costUSD: res.costUSD, latencyMs: res.latencyMs }));
} finally {
  ledger.close();
}
