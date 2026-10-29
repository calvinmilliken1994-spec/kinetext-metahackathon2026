/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_MODEL_ID, MODAL_PROVIDER_MODEL, MODEL_EXPLAINER, MODEL_STORAGE_KEY,
  friendlyJobError, madeWithPhrase, modelDetailsLine, modelRunTag, modelToSend, parseModels, pickModel,
  readStoredModel, repairedByLine, resolveJobModel, unavailableReason, writeStoredModel,
} from './models.ts';

const SERVER_LIST = [
  { id: 'muse-spark-1.3', label: 'Muse Spark 1.3 — Meta API', provider: 'meta-api', available: true },
  { id: 'muse-spark-open', label: 'Muse Spark Open — open weights, hosted on Modal', provider: 'modal', available: false },
];

test('parseModels keeps the server labels and availability, in the fixed order', () => {
  const out = parseModels([...SERVER_LIST].reverse());
  assert.deepEqual(out.map((o) => o.id), ['muse-spark-1.3', 'muse-spark-open']);
  assert.equal(out[0]?.label, 'Muse Spark 1.3 — Meta API');
  assert.equal(out[0]?.provider, 'meta-api');
  assert.equal(out[0]?.available, true);
  assert.equal(out[1]?.label, 'Muse Spark Open — open weights, hosted on Modal');
  assert.equal(out[1]?.provider, 'modal');
  assert.equal(out[1]?.available, false);
});

test('parseModels drops unknown ids, duplicates and malformed entries; anything but a list gives []', () => {
  const out = parseModels([
    { id: 'gpt-x', label: 'Other', provider: 'meta-api', available: true },
    SERVER_LIST[0],
    { ...SERVER_LIST[0], label: 'Duplicate' },
    null, 7, 'muse-spark-open', { id: 7 },
  ]);
  assert.deepEqual(out.map((o) => o.id), ['muse-spark-1.3']);
  assert.equal(out[0]?.label, 'Muse Spark 1.3 — Meta API');
  for (const bad of [null, undefined, {}, 'x', 3]) assert.deepEqual(parseModels(bad), []);
});

test('parseModels repairs a missing label or provider from the fixed table and treats a non-boolean available as unavailable', () => {
  const out = parseModels([{ id: 'muse-spark-open', available: 'yes' }, { id: 'muse-spark-1.3', label: '', provider: 'nonsense', available: true }]);
  assert.equal(out[0]?.label, 'Muse Spark 1.3 — Meta API');
  assert.equal(out[0]?.provider, 'meta-api');
  assert.equal(out[0]?.available, true);
  assert.equal(out[1]?.label, 'Muse Spark Open — open weights, hosted on Modal');
  assert.equal(out[1]?.provider, 'modal');
  assert.equal(out[1]?.available, false);
});

test('unavailableReason is plain language and distinguishes live-off from a missing credential', () => {
  const [meta, open] = parseModels(SERVER_LIST);
  assert.ok(meta !== undefined && open !== undefined);
  assert.equal(unavailableReason(meta, true), null, 'available models have no reason');
  const liveOff = unavailableReason({ ...open, available: false }, false);
  assert.match(liveOff ?? '', /live generation is (switched )?off/i);
  const noToken = unavailableReason(open, true);
  assert.match(noToken ?? '', /Modal/);
  assert.match(noToken ?? '', /not set up|not configured|no .*access/i);
  const noKey = unavailableReason({ ...meta, available: false }, true);
  assert.match(noKey ?? '', /Meta API/);
  assert.doesNotMatch(`${liveOff}${noToken}${noKey}`, /MODAL_PROXY_TOKEN|MODEL_API_KEY|wk-|ws-/, 'never names env vars or secrets');
});

test('pickModel: default is Muse Spark 1.3; a remembered choice wins only while available', () => {
  const both = parseModels(SERVER_LIST.map((m) => ({ ...m, available: true })));
  const onlyMeta = parseModels(SERVER_LIST);
  const none = parseModels(SERVER_LIST.map((m) => ({ ...m, available: false })));
  assert.equal(DEFAULT_MODEL_ID, 'muse-spark-1.3');
  assert.equal(pickModel(both, null), 'muse-spark-1.3');
  assert.equal(pickModel(both, 'muse-spark-open'), 'muse-spark-open');
  assert.equal(pickModel(onlyMeta, 'muse-spark-open'), 'muse-spark-1.3', 'unavailable choice falls back to the default');
  assert.equal(pickModel(none, 'muse-spark-open'), 'muse-spark-1.3', 'shown selected even when nothing is available');
  assert.equal(pickModel([], null), 'muse-spark-1.3');
});

test('modelToSend: the chosen id once the list loaded; nothing for a server without /api/models', () => {
  const both = parseModels(SERVER_LIST.map((m) => ({ ...m, available: true })));
  assert.equal(modelToSend(both, 'muse-spark-open'), 'muse-spark-open');
  assert.equal(modelToSend(both, 'muse-spark-1.3'), 'muse-spark-1.3');
  assert.equal(modelToSend([], 'muse-spark-open'), undefined);
});

test('session memory: stored id is read back only when valid; storage failures are ignored', () => {
  const mem = new Map<string, string>();
  const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); } };
  assert.equal(readStoredModel(store), null);
  writeStoredModel(store, 'muse-spark-open');
  assert.equal(mem.get(MODEL_STORAGE_KEY), 'muse-spark-open');
  assert.equal(readStoredModel(store), 'muse-spark-open');
  mem.set(MODEL_STORAGE_KEY, 'something-else');
  assert.equal(readStoredModel(store), null);
  const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
  assert.equal(readStoredModel(broken), null);
  assert.doesNotThrow(() => writeStoredModel(broken, 'muse-spark-1.3'));
  assert.equal(readStoredModel(null), null);
  assert.doesNotThrow(() => writeStoredModel(null, 'muse-spark-1.3'));
});

test('resolveJobModel: legacy jobs (no model fields) are Muse Spark 1.3 via the Meta API', () => {
  const m = resolveJobModel({});
  assert.equal(m.id, 'muse-spark-1.3');
  assert.equal(m.provider, 'meta-api');
  assert.equal(m.providerModel, 'muse-spark-1.3');
  assert.equal(m.name, 'Muse Spark 1.3');
  assert.equal(m.label, 'Muse Spark 1.3 — Meta API');
  assert.equal(m.openWeights, false);
  assert.equal(m.tag, 'Meta API');
});

test('resolveJobModel: a recorded open-weights job keeps the exact provider model string', () => {
  const m = resolveJobModel({ model: 'muse-spark-open', provider: 'modal', providerModel: 'meta-models/Muse-Spark-Open-816B-A42B' });
  assert.equal(m.id, 'muse-spark-open');
  assert.equal(m.provider, 'modal');
  assert.equal(m.providerModel, 'meta-models/Muse-Spark-Open-816B-A42B');
  assert.equal(m.name, 'Muse Spark Open');
  assert.equal(m.label, 'Muse Spark Open — open weights, hosted on Modal');
  assert.equal(m.openWeights, true);
  assert.equal(m.tag, 'Open weights · Modal');
  assert.equal(MODAL_PROVIDER_MODEL, 'meta-models/Muse-Spark-Open-816B-A42B');
});

test('resolveJobModel: partial or odd input is normalised, never trusted blindly', () => {
  // Provider alone is enough to identify the open-weights model.
  assert.equal(resolveJobModel({ provider: 'modal' }).id, 'muse-spark-open');
  assert.equal(resolveJobModel({ provider: 'modal' }).providerModel, MODAL_PROVIDER_MODEL);
  // The Modal model string alone, too.
  assert.equal(resolveJobModel({ providerModel: MODAL_PROVIDER_MODEL }).id, 'muse-spark-open');
  // A legacy event whose model is the plain Meta string.
  assert.equal(resolveJobModel({ model: 'muse-spark-1.3' }).id, 'muse-spark-1.3');
  // Unknown strings fall back to the fallback, then to the default.
  const open = resolveJobModel({ model: 'muse-spark-open' });
  assert.equal(resolveJobModel({ model: 'weird' }, open).id, 'muse-spark-open');
  assert.equal(resolveJobModel({ model: 'weird' }).id, 'muse-spark-1.3');
  // Non-string fields are ignored.
  assert.equal(resolveJobModel({ model: 5, provider: {}, providerModel: null } as never).id, 'muse-spark-1.3');
  // An empty providerModel gets the table value.
  assert.equal(resolveJobModel({ model: 'muse-spark-open', providerModel: '' }).providerModel, MODAL_PROVIDER_MODEL);
});

test('madeWithPhrase: the credit used in the AI disclosure', () => {
  assert.equal(madeWithPhrase(resolveJobModel({})), 'Muse Spark 1.3 (Meta)');
  assert.equal(madeWithPhrase(resolveJobModel({ model: 'muse-spark-open' })), 'Muse Spark Open (Meta’s open weights, hosted on Modal)');
});

test('modelRunTag: the run-list tag for each provider', () => {
  assert.deepEqual(modelRunTag(resolveJobModel({})), { text: 'Meta API', tone: 'meta' });
  assert.deepEqual(modelRunTag(resolveJobModel({ model: 'muse-spark-open' })), { text: 'Open weights · Modal', tone: 'open' });
});

test('modelDetailsLine and repairedByLine name the model and the exact provider string', () => {
  const open = resolveJobModel({ model: 'muse-spark-open', provider: 'modal', providerModel: MODAL_PROVIDER_MODEL });
  assert.equal(modelDetailsLine(open), `Muse Spark Open — open weights, hosted on Modal · ${MODAL_PROVIDER_MODEL}`);
  const meta = resolveJobModel({});
  assert.equal(modelDetailsLine(meta), 'Muse Spark 1.3 — Meta API · muse-spark-1.3');
  assert.equal(repairedByLine(open, 'analysis'), 'Analysis repaired by Muse Spark Open (open weights · Modal).');
  assert.equal(repairedByLine(meta, 'spec'), 'Repair written by Muse Spark 1.3 (Meta API).');
});

test('MODEL_EXPLAINER says what Spark Open is, where it runs, and that the same checks apply', () => {
  assert.match(MODEL_EXPLAINER, /open-weight/);
  assert.match(MODEL_EXPLAINER, /same model family/);
  assert.match(MODEL_EXPLAINER, /Modal/);
  assert.match(MODEL_EXPLAINER, /school district or publisher/);
  assert.match(MODEL_EXPLAINER, /infrastructure it controls/);
  assert.match(MODEL_EXPLAINER, /same (machine )?checks/);
});

test('friendlyJobError turns MODAL_PROXY_TOKEN_MISSING into a plain explanation; other codes get none', () => {
  const t = friendlyJobError('MODAL_PROXY_TOKEN_MISSING');
  assert.ok(t !== null);
  assert.match(t, /Modal/);
  assert.match(t, /nothing was charged/i);
  assert.match(t, /Muse Spark 1\.3/);
  assert.doesNotMatch(t, /MODAL_PROXY_TOKEN|wk-|ws-/);
  assert.equal(friendlyJobError('INTERRUPTED'), null);
  assert.equal(friendlyJobError(undefined), null);
});
