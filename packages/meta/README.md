# packages/meta — Meta Model API client, spend ledger, prompts, pipeline (TASK-004)

Server-only. Implementation and tests authored by **Muse Spark 1.3** through the Muse Code subscription bridge (`scripts/muse-subscription.py`); receipts in `docs/evidence/task-004/`. Spec: `docs/specs/TASK-004-meta-client.md`.

| Module | Role |
| --- | --- |
| `pricing.ts` | `muse-spark-1.3` Standard prices; `costFromUsage`, conservative `reservationUSD`. |
| `ledger.ts` | Append-only JSONL spend ledger with a hard cap; reserve → reconcile; replays on restart. |
| `client.ts` | `createMetaClient`: live calls only with `allowLive: true` and a key; reserve before sending, one retry on 429/5xx, typed `MetaError` codes, receipts. |
| `prompts.ts` | `PROMPT_VERSION`, analysis and spec message builders (source as untrusted data, verbatim-quote rules). |
| `pipeline.ts` | `analyzeSource` and `generateSpec`: Muse call → `assembleSpec` → deterministic validation report. |

Tests (`*.test.ts`) use a fake `fetch` / fake client only; none touches the network.
