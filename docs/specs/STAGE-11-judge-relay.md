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
