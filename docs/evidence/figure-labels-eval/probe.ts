// Figure-label reading eval (2026-11-03, teacher diagram beta). Muse Spark 1.3 reads the printed labels of every
// library figure with the SAME prompt/schema the worker uses (packages/meta/figure-labels.ts). The library figures
// carry lead-verified OCR boxes (<id>.labels.json), so each Muse box set can be scored against ground truth offline.
// Raw answers + receipts are saved so later box refinements are evaluated with no further calls.
// Run (API stopped: the ledger lock): MODEL_API_KEY in the child env only; never printed.
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { createMetaClient } from '../../../packages/meta/client.ts';
import { openLedger } from '../../../packages/meta/ledger.ts';
import { buildFigureLabelsPrompt, FIGURE_LABELS_SCHEMA, FIGURE_LABELS_SCHEMA_NAME, FIGURE_LABELS_MAX_OUTPUT_TOKENS } from '../../../packages/meta/figure-labels.ts';

const ROOT = new URL('../../../', import.meta.url);
const OUT = new URL('docs/evidence/figure-labels-eval/raw/', ROOT);
const FIG_DIR = new URL('data/figures/', ROOT);
mkdirSync(OUT, { recursive: true });
const KEY = 'MODEL_' + 'API_KEY';
const env = process.env;
const limits = JSON.parse(readFileSync(new URL('config/resource-limits.json', ROOT), 'utf8'));
const ledgerPath = process.env.LEDGER_PATH as string;
const ledger = await openLedger({ path: ledgerPath, capUSD: limits.stageCapsUSD.stage2, lockPort: limits.ledgerLockPort, providerCapsUSD: limits.providerCapsUSD });
const client = createMetaClient({ apiKey: env[KEY], ledger, allowLive: true });
const only = process.argv.slice(2);
const ids = readdirSync(FIG_DIR).filter(f => f.endsWith('.json') && !f.endsWith('.labels.json')).map(f => f.slice(0, -5)).filter(id => only.length === 0 || only.includes(id));
async function one(id: string): Promise<void> {
  const meta = JSON.parse(readFileSync(new URL(`${id}.json`, FIG_DIR), 'utf8'));
  const bytes = readFileSync(new URL(meta.file, FIG_DIR));
  const t0 = Date.now();
  try {
    const res = await client.complete<unknown>({
      purpose: 'test-live', schemaName: FIGURE_LABELS_SCHEMA_NAME, jsonSchema: FIGURE_LABELS_SCHEMA,
      messages: [{ role: 'user', content: buildFigureLabelsPrompt(), images: [{ url: `data:${meta.mime};base64,${bytes.toString('base64')}` }] }],
      maxOutputTokens: FIGURE_LABELS_MAX_OUTPUT_TOKENS,
    });
    writeFileSync(new URL(`${id}.json`, OUT), JSON.stringify({ id, width: meta.width, height: meta.height, data: res.data, receipt: res.receipt }, null, 2));
    console.log(id, 'ok', Date.now() - t0, 'ms', res.receipt.estCostUSD);
  } catch (e) {
    console.log(id, 'FAILED', (e as Error).message.slice(0, 120));
  }
}
for (let i = 0; i < ids.length; i += 5) await Promise.all(ids.slice(i, i + 5).map(one));
ledger.close();
