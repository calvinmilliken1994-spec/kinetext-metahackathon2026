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
object, duplicate keys, `model` not allowlisted for that route, or a request that is not bounded: see Security notes),
`408 RELAY_REQUEST_INVALID` (body not fully received within 60 s; nothing charged), `402 RELAY_BUDGET_SPENT`,
`503 RELAY_PAUSED` (also when the spend ledger cannot be read or written).
Upstream answers (status and body, errors included) pass through with our credentials replaced by `[redacted]`; only
`content-type` is copied. If the upstream cannot be reached the relay answers `502 RELAY_UPSTREAM_UNREACHABLE`, or `504 RELAY_UPSTREAM_TIMEOUT` after 600 s.

Check order: client-IP rate limit and code, then paused, then the body (read within 60 s), body validation, the cap and
the durable charge, then the pause flag once more immediately before forwarding.

## Cost rules

- **Admission charges the estimate durably.** The relay reads `spentUSD` from the store, refuses with 402 when
  `spentUSD + estimate > cap`, and otherwise writes `spentUSD += estimate` **before** forwarding. If the store cannot be
  read or written, it answers `503 RELAY_PAUSED`, forwards nothing and charges nothing.
  Chat estimate: `(len(body_bytes) / 2 * 1.25 + max_out * 4.25) / 1e6` USD, where `max_out` is the request's one
  `max_tokens` / `max_completion_tokens` (required, an integer 1..32000). SAM: USD 0.0025 per call.
- **Settlement writes only the difference.** After the answer it persists `spentUSD += (actual - estimate)`.
  Actual chat cost: `prompt_tokens * 1.25e-6 + completion_tokens * 4.25e-6` from the response `usage` (no cached discount,
  conservative; `completion_tokens` already includes reasoning). A 200 without usable `usage` charges the estimate (delta
  0, no second write). A non-200 charges only what its `usage` reports (usually nothing, so the estimate is refunded).
  SAM charges 0.0025 on 200 and nothing otherwise. If the settlement write fails, the estimate stays charged and the
  shortfall is carried into the next successful write.
- Timeouts, network errors and cancelled requests charge the estimate (the call may have run). A crash or restart
  mid-call leaves the estimate charged, never refunded.
- `spentUSD` and `enabled` live in the `modal.Dict` `mki-relay-state`. The Dict is the source of truth: it is read on
  every admission, so an operator reset is seen at once. **Single-container assumption:** the app runs with
  `max_containers=1` and up to 8 concurrent requests; an `asyncio` lock serialises the read-modify-write of `spentUSD`
  inside that one process. There is no cross-process lock or fencing, so never raise `max_containers` without adding one.
  The rate limiter is in memory and resets when the container restarts.
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
| Reset spend | `modal app stop mki-relay -y`, then `modal dict clear mki-relay-state -y`, then redeploy (stopping first keeps in-flight calls from writing their settlement into the cleared total) |

`pause`/`resume`/`report` need the Secret to exist first, because `modal run` resolves the app's Secret. `report` starts a
tiny remote function only to read `CAP_USD` from the Secret.

## Long requests and Modal's 303

Modal web functions wait at most 150 s per HTTP request. A slower call (Spark Open lessons can take minutes) is answered
with `303 See Other` pointing at a result URL on the same host; the result URL blocks until the relay finishes and does
not start a second request. Node's `fetch` follows the redirect (the POST becomes a GET of the result URL), so the local
API needs no special handling; a client that does not follow redirects must. The relay itself waits up to 600 s for the
upstream and the Modal function timeout is 900 s. This redirect behaviour comes from Modal's docs
(https://modal.com/docs/guide/webhook-timeouts); it has not been exercised against the live deployment yet.

## Security notes

Hardening from the independent review (`docs/reviews/relay-security-review-2026-11-02.md`):

1. **Durable spend.** The estimate is persisted before forwarding and only the difference after the answer (see Cost
   rules). A crash mid-call leaves the estimate charged; a ledger read/write failure is `503 RELAY_PAUSED` with nothing
   forwarded. The cap is checked against the persisted total plus this request's estimate.
2. **Bounded requests.** Chat routes answer `400 RELAY_REQUEST_INVALID` when: `stream` is present and truthy; `n` is
   present and not the integer 1; both `max_tokens` and `max_completion_tokens` are present, or neither; the bound is not
   an integer in [1, 32000]. Input is estimated at one token per 2 bytes. The SAM route (`/meta/v1/responses`) refuses
   more than one image input (any `input_image` / `image_url`-typed part anywhere in the body counts), any video input,
   and a non-boolean `stream`; it keeps the flat USD 0.0025 per call. `stream: true` **is accepted on SAM** because
   `packages/meta/sam.ts` sends it and parses the SSE reply; the relay buffers the reply and SAM's price does not depend
   on streaming. A body shaped exactly like the requests of `packages/meta/client.ts` (`max_tokens`, `stream: false`,
   `response_format`, optional `image_url` parts) and `packages/meta/sam.ts` passes (tests pin both shapes).
3. **Pause at dispatch.** The kill switch is read at request entry and again right before forwarding (after the body is
   read and the estimate is persisted). If it is off, or unreadable, the estimate is refunded and the answer is
   `503 RELAY_PAUSED`. The body must arrive within 60 s (`408`, nothing charged). Calls already sent upstream when the
   switch is thrown are not cancelled; they finish and are settled.
4. **Response redaction.** Every upstream body (success or error) and its content-type have the configured Meta API key,
   Modal key and Modal secret replaced by `[redacted]` before it reaches the caller.

Accepted residual risks (lead's decisions, 2026-11-02):

- **The access code travels in the Spark Open URL path** (`/modal/c/<code>/v1/...`). Modal's edge strips the
  `Modal-Key`/`Modal-Secret` headers before the app sees them (observed live), so a header cannot carry it there. The relay
  never logs paths, so only Calvin's Modal account logs could show the code. Rotate the access code after judging.
- **Rate limiting keys on the client address Modal presents** to the ASGI app. Whether that is the end user or a shared
  Modal edge address is unverified; impact is low (ten failed attempts block one address for a minute, and the limiter is
  in memory).
- **Long-request 303 result URLs follow Modal's semantics** (see below): access, lifetime and logging of those URLs are
  Modal's, not the relay's.
- Provider-side spend limits remain the hard backstop; the cap is the relay's own conservative accounting.

## Logging

One line per request: `route=<label> status=<code> latency_ms=<n> charged_usd=<x>`. Request and response bodies, codes,
keys, headers and exception text are never logged (the tests capture all log output and assert this).

## Tests

```bash
uv run --with fastapi==0.162.0 --with httpx==0.28.1 --with pytest pytest relay -q
# with the app.py wiring check (needs the Modal SDK, no network or login):
uv run --with fastapi==0.162.0 --with httpx==0.28.1 --with modal==1.6.3 --with pytest pytest relay -q
```

Upstreams are mocked with `httpx.MockTransport`; the tests need no key, no Modal login and no network.
