import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

// Setup probe only, not the application adapter. No provider fallback, no SDK retries.
const model = 'muse-spark-1.3';
const baseURL = 'https://api.meta.ai/v1';
const maxOutputTokens = 512;
const reservedInputTokens = 4096;
const upperEstimateUSD = (reservedInputTokens * 1.25 + maxOutputTokens * 4.25) / 1e6;
const key = process.env.MODEL_API_KEY;
function stop(reason, exitCode = 2) {
  console.log(JSON.stringify({ status: 'blocked', reason, model, networkAttempted: false }));
  process.exit(exitCode);
}
if (!key) stop('MODEL_API_KEY_MISSING');
// Shape check only (no whitespace, plausible length); the server is the authority on validity.
if (!/^\S{20,}$/.test(key)) stop('MODEL_API_KEY_FORMAT_INVALID');
const budget = Number(process.env.META_APPROVED_JOB_BUDGET_USD || 0);
if (!Number.isFinite(budget) || budget < upperEstimateUSD) stop('SPENDING_NOT_APPROVED');
const started = performance.now();
let networkAttempted = false;
try {
  const deadline = AbortSignal.timeout(30000);
  const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  networkAttempted = true;
  const catalog = await fetch(`${baseURL}/models`, { headers, signal: deadline });
  if (!catalog.ok) throw new Error(`CATALOG_HTTP_${catalog.status}`);
  const models = await catalog.json();
  if (!models.data?.some(x => x.id === model)) throw new Error('EXACT_MODEL_NOT_ENABLED');
  const response = await fetch(`${baseURL}/chat/completions`, {
    method: 'POST', headers, signal: deadline,
    body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Reply with the single word: ready' }],
      max_tokens: maxOutputTokens, reasoning_effort: 'high', stream: false }),
  });
  if (!response.ok) throw new Error(`COMPLETION_HTTP_${response.status}`);
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content?.trim().toLowerCase();
  const usage = data.usage;
  if (data.model !== model) throw new Error('RETURNED_MODEL_MISMATCH');
  if (content !== 'ready' || data.choices[0].finish_reason !== 'stop') throw new Error('SMOKE_OUTPUT_INVALID');
  if (!usage || !Number.isFinite(usage.prompt_tokens) || !Number.isFinite(usage.completion_tokens)) throw new Error('USAGE_MISSING');
  const cached = usage.prompt_tokens_details?.cached_tokens || 0;
  const estimatedIncrementalCostUSD = ((usage.prompt_tokens - cached) * 1.25 + cached * 0.15 + usage.completion_tokens * 4.25) / 1e6;
  const receipt = { status: 'passed', checkedAt: new Date().toISOString(), provider: 'meta', model: data.model,
    responseId: data.id, essentialToProductBehavior: false, feature: 'setup-api-smoke', modality: 'text',
    toolCalls: [], outputArtifact: 'one-word-connectivity-check', validation: 'exact ready; finish_reason stop; exact model; reported usage',
    latencyMs: Math.round(performance.now() - started), usage, estimatedIncrementalCostUSD,
    priceSource: 'https://dev.meta.ai/docs/getting-started/pricing-rate-limits', networkAttempted };
  await mkdir('logs', { recursive: true });
  await writeFile(`logs/meta-smoke-${Date.now()}.json`, JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt));
} catch (error) {
  // Never log request headers, source material, API response bodies, or credentials.
  const safe = /^(CATALOG_HTTP_\d+|COMPLETION_HTTP_\d+|EXACT_MODEL_NOT_ENABLED|RETURNED_MODEL_MISMATCH|SMOKE_OUTPUT_INVALID|USAGE_MISSING)$/.test(error.message)
    ? error.message : error.name === 'TimeoutError' ? 'TIME_BUDGET_EXCEEDED' : 'NETWORK_OR_RESPONSE_ERROR';
  console.log(JSON.stringify({ status: 'failed', reason: safe, model, networkAttempted, latencyMs: Math.round(performance.now() - started) }));
  process.exitCode = 1;
}
