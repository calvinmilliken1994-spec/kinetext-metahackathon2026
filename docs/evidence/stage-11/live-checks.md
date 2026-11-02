# Stage 11 relay: live checks (2026-11-02)

Relay: `https://calvinmilliken1994--mki-relay.us-east.modal.run` (Modal app `mki-relay`, Secret `mki-relay`, cap USD 50).

| Check | Result |
|---|---|
| `GET /healthz` | 200 `{"ok":true}` |
| `GET /v1/status`, right code | 200, cap 50, spent 0 |
| `GET /v1/status`, wrong code | 401 `RELAY_CODE_INVALID` |
| Muse Spark 1.3 chat through `/meta/v1` | 200 |
| A model not on the allowlist | 400 `RELAY_REQUEST_INVALID` |
| Spark Open with the code in `Modal-Secret` | 401: Modal's edge strips `Modal-Key`/`Modal-Secret` before the app sees them. Fixed: the code travels in the path (`/modal/c/<code>/v1`), test-first on both sides, redeployed |
| Local API in relay mode (no keys), wrong code | 401 `ACCESS_CODE_INVALID` |
| Right code | 200 granted; health `live: true`, both models available, remaining USD 50 |
| Spark Open water-cycle lesson through the relay (`job-20261102043420-aa6dca6c`) | succeeded in 110 s, USD 0.21; label diagram (Muse grounding + SAM 3.1 via the relay) and sequence both passed |
| Relay spend after it | USD 0.21 of 50 (matches the job) |
| `modal run relay/app.py::pause`, then a call | 503 `RELAY_PAUSED`; `::resume` restores |
| Calls longer than Modal's 150 s web limit | throwaway endpoint sleeping 170 s: Node `fetch` POST followed Modal's 303 and got the JSON at 174 s (app stopped after) |

The access code lives only in the Modal Secret and a file in Calvin's Hermes profile; it is not in the repo.
