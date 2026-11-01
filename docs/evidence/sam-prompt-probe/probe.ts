// SAM prompt-style probe (Calvin 2026-11-02: "go ahead with all of it", step 1). Three live sam-3.1 calls on the NOAA
// water-cycle figure, one per prompt style, all aimed at the EVAPORATION arrows (stored run: one point between two
// arrows, confidence 0.28). Goes through packages/meta/sam.ts segmentPoints and the project ledger; a fetch wrapper only
// swaps the input_text for the variant's prompt (grammar from Meta's @meta-sam/parser buildObjectPrompt). The key is read
// from MODEL_API_KEY in the environment and never printed.
import { readFileSync, writeFileSync } from 'node:fs';
import { segmentPoints } from '../../../packages/meta/sam.ts';
import { openLedger } from '../../../packages/meta/ledger.ts';

const ROOT = new URL('../../../', import.meta.url);
const OUT = new URL('docs/evidence/sam-prompt-probe/', ROOT);
const meta = JSON.parse(readFileSync(new URL('data/figures/noaa-hydrologic-cycle-1.json', ROOT), 'utf8'));
const bytes = new Uint8Array(readFileSync(new URL(`data/figures/${meta.file}`, ROOT)));
// Round 2 (same day): the first box missed the left-most of the five arrows; try a box around all five, alone and with
// one point on an arrow. Set PROBE_ROUND=2 to run only these.
const ROUND2: Record<string, string> = {
  wideBox: '<0f>1<|box;x1=135;y1=306;x2=200;y2=429;w=572;h=504|>',
  wideBoxPlusPoint: '<0f>1<|box;x1=135;y1=306;x2=200;y2=429;w=572;h=504|><|point;x=166;y=375;w=572;h=504|>',
};
const ROUND1: Record<string, string> = {
  onePointOnArrow: '<0f>1<|point;x=166;y=375;w=572;h=504|>',
  fourPointsOnArrows: '<0f>1<|point;x=154;y=375;w=572;h=504|><|point;x=166;y=375;w=572;h=504|><|point;x=180;y=375;w=572;h=504|><|point;x=192;y=375;w=572;h=504|>',
  boxAroundArrows: '<0f>1<|box;x1=147;y1=306;x2=200;y2=429;w=572;h=504|>',
};
const VARIANTS = process.env.PROBE_ROUND === '2' ? ROUND2 : ROUND1;
const limits = JSON.parse(readFileSync(new URL('config/resource-limits.json', ROOT), 'utf8'));
const ledgerPath = new URL('storage/ledger.jsonl', ROOT).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const ledger = await openLedger({ path: ledgerPath, capUSD: limits.stageCapsUSD.stage2, lockPort: limits.ledgerLockPort, providerCapsUSD: limits.providerCapsUSD });
const results: Record<string, unknown> = {};
try {
  for (const [name, prompt] of Object.entries(VARIANTS)) {
    const swap: typeof fetch = (url, init) => {
      const body = JSON.parse(String(init?.body));
      body.input[0].content[0].text = prompt;
      return fetch(url, { ...init, body: JSON.stringify(body) });
    };
    const res = await segmentPoints({ apiKey: process.env.MODEL_API_KEY, ledger, purpose: 'test-live', fetch: swap, image: { bytes, mime: meta.mime, width: meta.width, height: meta.height }, points: [{ id: 1, x: 166, y: 375 }] });
    writeFileSync(new URL(`raw-${name}.txt`, OUT), res.raw);
    results[name] = { prompt, boxes: res.boxes, costUSD: res.costUSD, latencyMs: res.latencyMs };
    console.log(name, JSON.stringify(res.boxes), res.costUSD, res.latencyMs);
  }
} finally {
  ledger.close();
  writeFileSync(new URL(process.env.PROBE_ROUND === '2' ? 'result-round2.json' : 'result.json', OUT), JSON.stringify({ figure: meta.id, at: new Date().toISOString(), results }, null, 2) + '\n');
}
