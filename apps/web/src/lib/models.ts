// Model choice (OW-3): the picker list from GET /api/models, the model every job was made with, and the
// wording that goes with both. Pure: no React, no DOM, no network. The API (apps/api/model-clients.ts) owns
// the real labels and availability; the table below only repairs a missing field and names legacy jobs.

export type ModelId = 'muse-spark-1.3' | 'muse-spark-open';
export type ProviderId = 'meta-api' | 'modal';

export const DEFAULT_MODEL_ID: ModelId = 'muse-spark-1.3';
/** The exact model string Modal serves for Muse Spark Open (read from the endpoint's /v1/models, never retyped elsewhere). */
export const MODAL_PROVIDER_MODEL = 'meta-models/Muse-Spark-Open-816B-A42B';

const MODEL_IDS: readonly ModelId[] = ['muse-spark-1.3', 'muse-spark-open'];

interface ModelRow { name: string; label: string; provider: ProviderId; providerModel: string; tag: string; tagTone: 'meta' | 'open'; short: string }
const TABLE: Readonly<Record<ModelId, ModelRow>> = {
  'muse-spark-1.3': {
    name: 'Muse Spark 1.3', label: 'Muse Spark 1.3 — Meta API', provider: 'meta-api', providerModel: 'muse-spark-1.3',
    tag: 'Meta API', tagTone: 'meta', short: 'Meta API',
  },
  'muse-spark-open': {
    name: 'Muse Spark Open', label: 'Muse Spark Open — open weights, hosted on Modal', provider: 'modal', providerModel: MODAL_PROVIDER_MODEL,
    tag: 'Open weights · Modal', tagTone: 'open', short: 'open weights · Modal',
  },
};

function isModelId(v: unknown): v is ModelId {
  return typeof v === 'string' && (MODEL_IDS as readonly string[]).includes(v);
}
function isProviderId(v: unknown): v is ProviderId {
  return v === 'meta-api' || v === 'modal';
}
function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

/** Teacher-facing explanation shown under the picker. */
export const MODEL_EXPLAINER =
  'Muse Spark Open is Meta’s open-weight version of the same model family, here hosted on Modal. '
  + 'A school district or publisher could run it on infrastructure it controls. The same machine checks apply to both models.';

// ---- the picker ------------------------------------------------------------------------------------------

export interface ModelOption { id: ModelId; label: string; provider: ProviderId; available: boolean }

/** Parse the /api/models answer. Unknown ids, duplicates and malformed entries are dropped; the order is fixed. */
export function parseModels(raw: unknown): ModelOption[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Map<ModelId, ModelOption>();
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const r = item as Record<string, unknown>;
    const id = r['id'];
    if (!isModelId(id) || seen.has(id)) continue;
    seen.set(id, {
      id,
      label: str(r['label']) ?? TABLE[id].label,
      provider: isProviderId(r['provider']) ? r['provider'] : TABLE[id].provider,
      available: r['available'] === true,
    });
  }
  return MODEL_IDS.flatMap((id) => { const o = seen.get(id); return o === undefined ? [] : [o]; });
}

/** Plain-language reason a model cannot be picked; null when it can. Never names environment variables or secrets. */
export function unavailableReason(option: ModelOption, live: boolean | null): string | null {
  if (option.available) return null;
  if (live === false) return 'Not available: live generation is switched off on this server.';
  return option.provider === 'modal'
    ? 'Not available: this server has no Modal access set up.'
    : 'Not available: this server has no Meta API access set up.';
}

/** The selected model: the remembered one while it is available, else the default. Always a valid id. */
export function pickModel(options: readonly ModelOption[], wanted: ModelId | null): ModelId {
  if (wanted !== null && options.some((o) => o.id === wanted && o.available)) return wanted;
  return DEFAULT_MODEL_ID;
}

/** Value for POST /api/jobs `model`: the chosen id once the list is known; nothing for a server without /api/models. */
export function modelToSend(options: readonly ModelOption[], chosen: ModelId): ModelId | undefined {
  return options.length === 0 ? undefined : chosen;
}

// ---- remembered for the session ----------------------------------------------------------------------------

export const MODEL_STORAGE_KEY = 'mki.model';
export interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void }

export function readStoredModel(store: StorageLike | null): ModelId | null {
  if (store === null) return null;
  try {
    const v = store.getItem(MODEL_STORAGE_KEY);
    return isModelId(v) ? v : null;
  } catch {
    return null;
  }
}

export function writeStoredModel(store: StorageLike | null, id: ModelId): void {
  if (store === null) return;
  try { store.setItem(MODEL_STORAGE_KEY, id); } catch { /* storage may be blocked: the choice then lasts for this page only */ }
}

// ---- the model behind a job --------------------------------------------------------------------------------

export interface JobModel {
  id: ModelId;
  provider: ProviderId;
  /** The exact model string sent to the provider. */
  providerModel: string;
  /** 'Muse Spark Open' */
  name: string;
  /** 'Muse Spark Open — open weights, hosted on Modal' */
  label: string;
  /** Run-list wording: 'Open weights · Modal' / 'Meta API'. */
  tag: string;
  /** 'open weights · Modal' / 'Meta API' (lower-case, for use inside a sentence). */
  how: string;
  openWeights: boolean;
}

export interface ModelFields { model?: unknown; provider?: unknown; providerModel?: unknown }

/**
 * Which model made a job (or one pipeline event). Jobs recorded before OW-2 carry none of the three fields and
 * are Muse Spark 1.3 via the Meta API. Odd values never reach the screen: the id must be a known one, and the
 * provider model string falls back to the table value when absent.
 */
export function resolveJobModel(src: ModelFields, fallback?: JobModel): JobModel {
  let id: ModelId;
  if (isModelId(src.model)) id = src.model;
  else if (src.providerModel === MODAL_PROVIDER_MODEL || src.provider === 'modal') id = 'muse-spark-open';
  else if (src.provider === 'meta-api') id = 'muse-spark-1.3';
  else id = fallback?.id ?? DEFAULT_MODEL_ID;
  const row = TABLE[id];
  return {
    id,
    provider: isProviderId(src.provider) ? src.provider : row.provider,
    providerModel: str(src.providerModel) ?? row.providerModel,
    name: row.name,
    label: row.label,
    tag: row.tag,
    how: row.short,
    openWeights: id === 'muse-spark-open',
  };
}

export interface ModelTag { text: string; tone: 'meta' | 'open' }

/** Run-list tag: 'Open weights · Modal' or 'Meta API'. */
export function modelRunTag(m: JobModel): ModelTag {
  return { text: m.tag, tone: TABLE[m.id].tagTone };
}

/** Credit inside the AI disclosure above an activity. */
export function madeWithPhrase(m: JobModel): string {
  return m.openWeights ? 'Muse Spark Open (Meta’s open weights, hosted on Modal)' : `${m.name} (Meta)`;
}

/** Receipt line: the full model label and the exact provider model string. */
export function modelDetailsLine(m: JobModel): string {
  return `${m.label} · ${m.providerModel}`;
}

/** Sentence for a repair card. */
export function repairedByLine(m: JobModel, kind: 'analysis' | 'spec'): string {
  return kind === 'analysis'
    ? `Analysis repaired by ${m.name} (${m.how}).`
    : `Repair written by ${m.name} (${m.how}).`;
}

// ---- friendly job errors -----------------------------------------------------------------------------------

const JOB_ERRORS: Readonly<Record<string, string>> = {
  MODAL_PROXY_TOKEN_MISSING:
    'This server has no Modal access set up, so Muse Spark Open could not run. No request was made and nothing was charged. '
    + 'Pick Muse Spark 1.3 — Meta API instead, or ask whoever runs this server to add Modal access.',
};

/** Plain explanation for a public job error code; null when the code has none. */
export function friendlyJobError(code: string | undefined): string | null {
  return code !== undefined && Object.hasOwn(JOB_ERRORS, code) ? JOB_ERRORS[code] ?? null : null;
}
