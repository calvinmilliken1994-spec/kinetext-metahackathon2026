# Judge relay (`mki-relay`)

A small FastAPI service on Modal that lets a judge run the app locally with only an **access code**. The Meta API key and
the Modal proxy token exist only in the Modal Secret `mki-relay`; the judge's machine never sees them. The relay checks
the code, a model allowlist, a spending cap and a kill switch, then forwards the request with the real credentials.

Contract: `docs/specs/STAGE-11-judge-relay.md` (frozen). Code: `relay_core.py` (all logic, no Modal imports) and `app.py`
(Modal wiring, pause/resume/report). Tests: `tests/`.

```
local API (judge) --HTTPS, code as the bearer--> mki-relay --> api.meta.ai/v1            (Muse Spark 1.3, SAM 3.1)
                                                          \--> Modal Shared Endpoint     (Muse Spark Open)
```

## Routes

| Route | Code goes in | Forwards to | Allowed `model` |
|---|---|---|---|
| `POST /meta/v1/chat/completions` | `Authorization: Bearer <code>` | `https://api.meta.ai/v1/chat/completions` | `muse-spark-1.3` |
| `POST /meta/v1/responses` | `Authorization: Bearer <code>` | `https://api.meta.ai/v1/responses` | `sam-3.1` |
| `POST /modal/v1/chat/completions` | `Modal-Secret: ws-<code>` (`Modal-Key` ignored) | `<MODAL_BASE_URL>/chat/completions` | `meta-models/Muse-Spark-Open-816B-A42B` |
| `GET /v1/status` | `Authorization: Bearer <code>` | none | `{ ok, enabled, capUSD, spentUSD, remainingUSD }`, 2-decimal numbers |
| `GET /healthz` | none | none | `{ "ok": true }` and nothing else |

Errors are `{ "error": { "code", "message" } }`:
`401 RELAY_CODE_INVALID`, `429 RELAY_RATE_LIMITED` (more than 10 failed attempts per client IP per minute; a blocked IP is
refused even with a valid code until its window clears), `400 RELAY_REQUEST_INVALID` (body over 12 MiB, not a JSON
object, duplicate keys, or `model` not allowlisted for that route), `402 RELAY_BUDGET_SPENT`, `503 RELAY_PAUSED`.
Upstream answers (status and JSON body, errors included) pass through unchanged; only `content-type` is copied. If the
upstream cannot be reached the relay answers `502 RELAY_UPSTREAM_UNREACHABLE`, or `504 RELAY_UPSTREAM_TIMEOUT` after 600 s.

Check order: client-IP rate limit and code, then paused, then body validation, then the cap.

## Cost rules

- Before forwarding, the relay reserves an estimate and refuses with 402 when `spent + reserved + estimate > cap`.
  Chat estimate: `(len(body_bytes) / 3 * 1.25 + max_out * 4.25) / 1e6` USD, where `max_out` is `max_completion_tokens`, else
  `max_tokens`, else 32000 (zero, negative or non-integer values count as absent). SAM: USD 0.0025 per call.
- After the answer it charges the actual cost. Chat: `prompt_tokens * 1.25e-6 + completion_tokens * 4.25e-6` from the
  response `usage` (no cached discount, conservative; `completion_tokens` already includes reasoning).
  A 200 without usable `usage` charges the estimate. A non-200 charges only what its `usage` reports (usually nothing).
  SAM charges 0.0025 on 200 and nothing otherwise.
- Timeouts, network errors and cancelled requests charge the estimate (the call may have run).
- `spentUSD` and `enabled` live in the `modal.Dict` `mki-relay-state`; spent is written after every call. The app runs
  with `max_containers=1` and up to 8 concurrent requests, so in-memory reservations are consistent. The rate limiter is
  in memory and resets when the container restarts.
- If the state cannot be read, the relay fails closed (`503 RELAY_PAUSED`).

## Deploy (the lead does this; nothing here runs on import)

1. Pick access codes: one or more, each at least 20 characters, e.g. `python -c "import secrets; print(secrets.token_urlsafe(24))"`.
2. Create the Secret. Names only (values come from your shell or a scratch `.env`; never commit them):

   | Name | Meaning |
   |---|---|
   | `META_API_KEY` | Meta API key (`LLM_...`) used for `api.meta.ai` |
   | `MODAL_PROXY_TOKEN` | the stored `wk-...<sep>ws-...` proxy token, **or** both of `MODAL_PROXY_KEY` and `MODAL_PROXY_SECRET` |
   | `MODAL_BASE_URL` | Shared Endpoint base **including `/v1`**, i.e. `modalBaseUrl` in `config/resource-limits.json` |
   | `ACCESS_CODES` | comma-separated access codes |
   | `CAP_USD` | spending cap in USD (default 50 when absent) |

   ```bash
   modal secret create mki-relay \
     META_API_KEY="$META_API_KEY" MODAL_PROXY_TOKEN="$MODAL_PROXY_TOKEN" \
     MODAL_BASE_URL="$MODAL_BASE_URL" ACCESS_CODES="$ACCESS_CODES" CAP_USD=50
   # or: modal secret create mki-relay --from-dotenv <scratch.env>   (delete the file afterwards)
   # change a value later: add --force, then redeploy
   ```
3. `modal deploy relay/app.py`. The URL is `https://<workspace>--mki-relay.modal.run` (the function label is `mki-relay`).
   It is not a secret; put it in `config/relay.json`.
4. Smoke test without spending: `curl https://<url>/healthz` gives `{"ok":true}`;
   `curl -H "Authorization: Bearer $CODE" https://<url>/v1/status` gives the cap and spend; a wrong code gives 401.

If the Secret is incomplete or a code is shorter than 20 characters, the container refuses to start (the error names the
variable, never the value).

## Operate

| Action | Command |
|---|---|
| Pause (every forwarding route answers 503 on its next request) | `modal run relay/app.py::pause` |
| Resume | `modal run relay/app.py::resume` |
| Spent / cap / enabled (never prints codes or keys) | `modal run relay/app.py::report` |
| Stop everything | `modal app stop mki-relay -y` (redeploy with `modal deploy relay/app.py` to bring it back) |
| Raise the cap or rotate codes | update the Secret with `--force`, then `modal deploy relay/app.py` (spend is kept in the Dict) |
| Reset spend | `modal app stop mki-relay -y`, then `modal dict clear mki-relay-state -y`, then redeploy (clearing while it runs would be overwritten by the live container's in-memory total) |

`pause`/`resume`/`report` need the Secret to exist first, because `modal run` resolves the app's Secret. `report` starts a
tiny remote function only to read `CAP_USD` from the Secret.

## Long requests and Modal's 303

Modal web functions wait at most 150 s per HTTP request. A slower call (Spark Open lessons can take minutes) is answered
with `303 See Other` pointing at a result URL on the same host; the result URL blocks until the relay finishes and does
not start a second request. Node's `fetch` follows the redirect (the POST becomes a GET of the result URL), so the local
API needs no special handling; a client that does not follow redirects must. The relay itself waits up to 600 s for the
upstream and the Modal function timeout is 900 s. This redirect behaviour comes from Modal's docs
(https://modal.com/docs/guide/webhook-timeouts); it has not been exercised against the live deployment yet.

## Logging

One line per request: `route=<label> status=<code> latency_ms=<n> charged_usd=<x>`. Request and response bodies, codes,
keys, headers and exception text are never logged (the tests capture all log output and assert this).

## Tests

```bash
uv run --with fastapi==0.162.0 --with httpx==0.28.1 --with pytest pytest relay -q
# optional wiring check for app.py (needs the Modal SDK, no network or login):
uv run --with fastapi==0.162.0 --with httpx==0.28.1 --with pytest --with modal==1.6.3 pytest relay -q
```

Upstreams are mocked with `httpx.MockTransport`; the tests need no key, no Modal login and no network.
