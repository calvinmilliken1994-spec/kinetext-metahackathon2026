// Spark Open vision probe (2026-11-02, Calvin: "Double check if it's text-only"). Meta's docs list Muse Spark Open as
// multimodal (text, image, audio, video input). Our client refused images on non-Meta providers by design, untested.
// Step 1 (free): GET <modal>/v1/models, the endpoint's advertised features.
// Step 2 (one or two billed calls on Modal credit): the water-cycle figure + Meta's documented grounding box prompt,
// strict JSON schema, reasoning high. Raw HTTP, so the project client's image refusal is bypassed for the probe only.
// The proxy token is read from the env (MODAL_PROXY_TOKEN), split server-side style, never printed.
import { readFileSync, writeFileSync } from 'node:fs';
import { splitModalProxyToken } from '../../../apps/api/model-clients.ts';
import { buildGroundingPrompt, GROUNDING_SCHEMA } from '../../../packages/meta/grounding.ts';

const ROOT = new URL('../../../', import.meta.url);
const OUT = new URL('docs/evidence/open-weights-vision-probe/', ROOT);
const limits = JSON.parse(readFileSync(new URL('config/resource-limits.json', ROOT), 'utf8'));
const base: string = limits.modalBaseUrl;
const tok = splitModalProxyToken(process.env['MODAL_PROXY_TOKEN']);
if (tok === null) throw new Error('no proxy token');
const headers = { 'Modal-Key': tok.proxyKey, 'Modal-Secret': tok.proxySecret, 'Content-Type': 'application/json' };

const models = await fetch(`${base}/models`, { headers });
const modelsBody = await models.json();
writeFileSync(new URL('models.json', OUT), JSON.stringify(modelsBody, null, 2) + '\n');
console.log('models', models.status, JSON.stringify(modelsBody).slice(0, 600));
if (process.env['PROBE_CALL'] !== '1') process.exit(0);

const FIGURES = [
  { id: 'noaa-hydrologic-cycle-1', objects: [['Condensation', 'Condensation'], ['Precipitation', 'Precipitation'], ['Transpiration', 'Transpiration'], ['Evaporation', 'Evaporation'], ['Runoff', 'Surface Runoff']] },
  { id: 'medlineplus-dna-structure-1', objects: [['base pairs', 'Base pairs'], ['adenine', 'Adenine'], ['thymine', 'Thymine'], ['guanine', 'Guanine'], ['cytosine', 'Cytosine'], ['sugar-phosphate backbone', 'Sugar phosphate backbone']] },
];
const results: unknown[] = [];
for (const fig of FIGURES) {
  const meta = JSON.parse(readFileSync(new URL(`data/figures/${fig.id}.json`, ROOT), 'utf8'));
  const b64 = Buffer.from(readFileSync(new URL(`data/figures/${meta.file}`, ROOT))).toString('base64');
  const prompt = buildGroundingPrompt(fig.objects.map(([name, printed]) => ({ name: name as string, printed: printed as string })));
  const body = {
    model: (modelsBody as { data?: { id: string }[] }).data?.[0]?.id ?? 'meta-models/Muse-Spark-Open-816B-A42B',
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: `data:${meta.mime};base64,${b64}` } }] }],
    response_format: { type: 'json_schema', json_schema: { name: 'label_grounding', schema: GROUNDING_SCHEMA } },
    reasoning_effort: 'high',
    max_tokens: 16000,
  };
  const t0 = Date.now();
  const res = await fetch(`${base}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await res.text();
  const ms = Date.now() - t0;
  let parsed: unknown = null;
  try {
    const j = JSON.parse(text);
    parsed = { usage: j.usage, finish: j.choices?.[0]?.finish_reason, content: j.choices?.[0]?.message?.content };
  } catch { parsed = { raw: text.slice(0, 2000) }; }
  results.push({ figure: fig.id, status: res.status, ms, ...(parsed as object) });
  console.log(fig.id, res.status, ms, 'ms', JSON.stringify(parsed).slice(0, 400));
}
writeFileSync(new URL('result.json', OUT), JSON.stringify({ at: new Date().toISOString(), base: 'modal shared endpoint', results }, null, 2) + '\n');
