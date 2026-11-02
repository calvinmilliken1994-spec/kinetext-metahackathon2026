# Stage 11: judge relay (Calvin's Meta and Modal keys, never on a judge's machine)

Status: FROZEN by the lead, 2026-11-02. Calvin: "How about the possibility of access code on a local build to connect to my
API keys from both Meta and Modal?" then "Let's set up the relay". No hosted copy of the app: judges run it locally from
the README. Calvin removed his card from dev.meta.ai, so Meta spend stops at the credits (verified: the key still answers).

## Shape
```
judge's machine                                   Modal (Calvin's workspace)                upstream
browser ─> local API (npm start) ── HTTPS ──> mki-relay (FastAPI, one container) ──> api.meta.ai/v1  (Muse Spark 1.3, SAM 3.1)
                         code as the bearer         checks code, cap, kill switch       └> Modal Shared Endpoint (Muse Spark Open)
```
Keys live only in the Modal Secret `mki-relay`. The judge's machine holds only the access code, in server memory.

## Relay contract (slice R, `relay/`)
Base URL: the deployed `modal.asgi_app` URL (not secret; committed in `config/relay.json`).

| Route | Auth | Forwards to | Allowed body |
|---|---|---|---|
| `POST /meta/v1/chat/completions` | `Authorization: Bearer <code>` | `https://api.meta.ai/v1/chat/completions` with `Authorization: Bearer <META_API_KEY>` | JSON, `model` == `muse-spark-1.3` |
| `POST /meta/v1/responses` | `Authorization: Bearer <code>` | `https://api.meta.ai/v1/responses` | JSON, `model` == `sam-3.1` |
| `POST /modal/v1/chat/completions` | `Modal-Secret: ws-<code>` (Modal-Key ignored) | `<MODAL_BASE_URL>/chat/completions` with `Modal-Key`/`Modal-Secret` of Calvin's proxy token | JSON, `model` == `meta-models/Muse-Spark-Open-816B-A42B` |
| `GET /v1/status` | `Authorization: Bearer <code>` | none | returns `{ ok: true, enabled, capUSD, spentUSD, remainingUSD }` (2-decimal numbers) |
| `GET /healthz` | none | none | `{ ok: true }` only |

The Modal route takes the code in `Modal-Secret` so the Muse-authored client (`packages/meta/client.ts`, which validates
`wk-`/`ws-` prefixes) needs no change: the local API passes `proxyKey: 'wk-relay'`, `proxySecret: 'ws-' + code`.

Rules:
- Codes: Secret `ACCESS_CODES` (comma-separated, each >= 20 chars). Compare by SHA-256 digests with `hmac.compare_digest`.
  Wrong or missing code: 401 `{ error: { code: 'RELAY_CODE_INVALID' } }`. More than 10 failed attempts per client IP per
  minute: 429 `RELAY_RATE_LIMITED`.
- Body: at most 12 MB, valid JSON object, model allowlisted per route, else 400 `RELAY_REQUEST_INVALID`. The body is
  forwarded unchanged otherwise. Response status and JSON body pass through unchanged (upstream errors included); only
  `content-type` is copied from upstream headers.
- Cap (USD, Secret `CAP_USD`, default 50): before forwarding, reserve an estimate; refuse with 402
  `RELAY_BUDGET_SPENT` when `spent + reserved + estimate > cap`. Estimate: chat routes
  `(len(body_bytes)/3 * 1.25 + max_out * 4.25) / 1e6` with `max_out` = `max_completion_tokens` or `max_tokens` or 32000;
  SAM `0.0025` per call. After the response, charge the actual cost: chat `prompt_tokens * 1.25e-6 + completion_tokens * 4.25e-6`
  (no cached discount, conservative); SAM 0.0025 when status 200, 0 otherwise; when usage is missing on a 200, charge the
  estimate. Errors before upstream answered (timeouts, network) charge the estimate (conservative: the call may have run).
- State: `modal.Dict` `mki-relay-state` holds `spentUSD` and `enabled`; the app runs `max_containers=1` with concurrent
  inputs (<= 8) so in-memory reservations are consistent; spent is written after each call.
- Kill switch: `enabled == False` → 503 `RELAY_PAUSED` on every forwarding route. `modal run relay/app.py::pause` /
  `::resume` / `::report` (prints spent/cap, never codes or keys). `modal app stop mki-relay` stops everything.
- Upstream timeout 600 s. Requests longer than Modal's 150 s web limit are answered with Modal's 303 to a result URL; Node
  `fetch` follows it (POST becomes GET of the result URL). Document this in the README of `relay/`.
- Logging: one line per request: route, status, latency, charged USD. Never bodies, codes, keys or headers.
- Code is testable without Modal: `create_app(store, transport, settings)` builds the FastAPI app; `app.py` wires Modal.
  Tests: pytest + FastAPI TestClient + `httpx.MockTransport` (run `uv run --with fastapi --with httpx --with pytest pytest relay`).

## Local relay mode (slice L, `apps/api`, `config/relay.json`, `package.json`, README)
- `config/relay.json`: `{ "url": "<relay base url>", "note": "..." }` (lead fills `url` after deploy). Validated: https,
  no credentials/query/fragment.
- Mode: **relay mode** when `MODEL_API_KEY` is absent from the environment and `config/relay.json` has a url (or
  `RELAY=1` forces it). Direct mode (today) is unchanged for Calvin.
- In relay mode the existing access gate is ON with the relay as the judge of the code: `POST /api/access {code}` calls
  relay `GET /v1/status` with the code; 200 → the local session is granted (existing signed cookie) and the code is kept
  in server memory only (never written to disk, never logged, never in a response); 401 → the same error the gate gives
  today; network error → 502 `RELAY_UNREACHABLE`. `GET /api/access` (and health) report `remainingUSD` from the relay
  (cached <= 10 s) so the Welcome card shows dollars left. Response shapes stay exactly as today.
- Jobs in relay mode build their clients with: Meta chat `apiKey: code, baseUrl: <url>/meta/v1`; SAM `baseUrl: <url>/meta/v1`
  with the code as its key; Modal `providerConfig { provider: 'modal', proxyKey: 'wk-relay', proxySecret: 'ws-' + code,
  baseUrl: <url>/modal/v1, modelString }`. Both models are available. Local ledger caps still apply.
- No code entered yet: GET routes and recorded runs work; builds return the existing locked error.
- `npm start`: one command that runs the API (relay mode unless keys present) and serves the web app, then prints the
  local URL (and opens the browser when possible). README quick start: Node version, `npm install`, `npm start`, enter the
  access code from the submission notes; what works without a code; how to use your own Meta key instead (`.env`).

## Ownership
| Slice | Owner | Files |
|---|---|---|
| R relay | Sonnet | `relay/**` (new) |
| L local relay mode | Sonnet | `apps/api/**` (relay mode, access, model clients, tests), `config/relay.json`, `package.json` scripts, new `scripts/start.mjs`, `README.md` |
| Welcome card (running) | Opus | `WelcomeScreen.tsx`, `lib/welcome.ts`, `styles/welcome.css` (keeps the access-code path) |

Lead: creates the Modal Secret from the profile `.env` without printing values, generates the access code, deploys,
runs live checks (status, one tiny chat, one SAM, one Spark Open call, a wrong code, the cap, pause/resume), then one GPT
security review of `relay/` + slice L.

## Amendment 2026-11-02 (post security review): cap, request and response rules
Added after `docs/reviews/relay-security-review-2026-11-02.md`; the frozen text above is unchanged. Where this section and
the text above disagree, this section wins. Implemented in `relay/relay_core.py`, tests in `relay/tests/test_relay.py`.

- **Durable spend (replaces "reserve in memory, write after each call").** On admission the relay reads `spentUSD` from the
  Dict, refuses with 402 `RELAY_BUDGET_SPENT` when `spentUSD + estimate > cap`, and otherwise writes
  `spentUSD += estimate` before forwarding. A Dict read or write failure (or an unusable stored value) is 503
  `RELAY_PAUSED`: nothing forwarded, nothing charged. After the upstream answers it writes
  `spentUSD += (actual - estimate)`, with `actual` per the existing charge rules (when those say "charge the estimate" the
  delta is 0). A crash or restart mid-call therefore leaves the estimate charged. A failed settlement write keeps the
  estimate and carries the difference into the next write. The in-memory `reserved` counter is gone; the Dict is the
  source of truth and is read on every admission. The `max_containers=1` assumption stays and is load-bearing: the
  lock serialising the read-modify-write is process-local, with no fencing across containers.
- **Bounded requests.** Chat routes reject with 400 `RELAY_REQUEST_INVALID`: `stream` present and truthy; `n` present and
  not the integer 1; both `max_tokens` and `max_completion_tokens` present; neither present; a bound that is not an integer
  in [1, 32000]. The client (`packages/meta/client.ts`) sends `max_tokens` and `stream: false`. Input estimate is now
  `len(body_bytes)/2` tokens (was /3): chat estimate `(len(body_bytes)/2 * 1.25 + max_out * 4.25) / 1e6`. SAM route: more
  than one image input (any part typed `input_image`/`image_url`/`*image*` anywhere in the body) or any video input is
  rejected; flat USD 0.0025 per call is unchanged. **Deviation from the review's "reject stream" for SAM:** `packages/meta/sam.ts`
  sends `stream: true` and parses the SSE reply, so SAM accepts a boolean `stream` (non-booleans are rejected); the relay
  buffers the reply and SAM's price is per call, so streaming does not change cost.
- **Pause at dispatch.** After the body is read and the estimate persisted, the relay re-reads `enabled` immediately before
  forwarding; if it is not exactly true (or unreadable) it refunds the estimate and answers 503 `RELAY_PAUSED`. Reading the
  body is bounded to 60 s: on expiry, 408 with code `RELAY_REQUEST_INVALID` and no charge. Calls already dispatched upstream
  are not cancelled by a later pause.
- **Response redaction.** Before returning any upstream body or content-type (success or error), every occurrence of the
  configured Meta API key, Modal key and Modal secret is replaced with `[redacted]`. This refines "Response status and JSON
  body pass through unchanged": clean bodies are still byte-identical.
- **Accepted residual risks** (lead, 2026-11-02): the access code stays in the Spark Open URL path because Modal's edge strips
  `Modal-Key`/`Modal-Secret` (only Calvin's Modal logs could show it; rotate the code after judging); the rate limiter keys on
  the client address Modal presents (unverified, low impact); 303 result URLs follow Modal's semantics.
