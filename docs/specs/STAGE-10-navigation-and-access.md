# Stage 10: sidebar navigation, New lesson page, Demo, judge access code

Status: FROZEN by the lead, 2026-11-02. Calvin: "let's try the always-expanded labelled sidebar. And just let them build
until cap with one access code, i'd give them a hefty $50". Modal credit left: USD 72.22.

## A. Judge access (API: `apps/api/**`, Sonnet)
- Env `ACCESS_CODE` (one shared code; never logged, never sent to the browser). Env `ACCESS_SESSION_SECRET` (HMAC key for
  the session cookie; if absent a random per-process key is used, so sessions end on restart).
- **Gate on** when `ACCESS_CODE` is set and non-empty. Gate off (unset) keeps today's local behaviour exactly, so every
  existing test keeps passing.
- `config/resource-limits.json`: `"judgeCapUSD": 50` (validated at startup: finite, > 0, ≤ the smaller of the
  provider caps' sum and the stage cap; absent means 50).
- **`GET /api/access`** → `200 { gate: boolean, granted: boolean, capUSD: number, spentUSD: number, remainingUSD:
  number, buildsEnabled: boolean }`.
  - `spentUSD` is the summed actual cost (`costUSD` in the job summary, plus live estimates for running jobs) of every
    job started under an access session; jobs carry `access: 'judge'` in their stored job record.
  - `buildsEnabled` is false when live generation is off (`META_LIVE` not 1), the kill switch is on, or
    `remainingUSD` < `judgeMinHeadroomUSD` (1.00).
  - With the gate off: `{ gate: false, granted: true, ... }`, with `spentUSD` still summed from judge-tagged jobs.
- **`POST /api/access`** `{ code: string }` (JSON, the same Origin check as every POST).
  - Right code: `200` + the same body as GET with `granted: true`, and `Set-Cookie: mki_access=<signed>; HttpOnly;
    SameSite=Strict; Path=/; Max-Age=604800` (`Secure` when the request is https or `X-Forwarded-Proto: https`).
  - Wrong code: `401 ACCESS_CODE_INVALID`. The code is compared in constant time.
  - At most 5 attempts per minute per client address, otherwise `429 TOO_MANY_ATTEMPTS`.
- **`DELETE /api/access`** clears the cookie and returns `200` with the GET body.
- **Gated writes:** with the gate on, `POST /api/jobs` and `POST /api/sources` without a valid session return
  `403 ACCESS_REQUIRED`. With a session:
  - `POST /api/jobs` returns `402 JUDGE_BUDGET_REACHED` when `remainingUSD < judgeMinHeadroomUSD`, and
    `503 BUILDS_PAUSED` when the kill switch is on.
  - The job is started with `access: 'judge'` recorded.
  - Every GET stays open, so browsing, replays and presenting are read-only for everyone.
- **Kill switch:** the file `<storageDir>/BUILDS_PAUSED` exists, or env `BUILDS_PAUSED=1`. It is checked on every gated
  POST.
- Concurrency and provider caps are unchanged; the ledger still fails closed.

## B. Web (`apps/web/src/**`, Opus)
- **Sidebar:** always expanded, labelled, about 232 px wide, left side. It replaces `IconRail`. Its sections, top to
  bottom, each with a small heading:
  1. **Create**: *New lesson*.
  2. **Lessons**: *All lessons* (a main-area page listing finished lessons, newest first, grouped or filterable by
     subject, with search). Below it, the current lesson highlighted.
  3. **This lesson** (shown when a lesson is open): *Lesson*, *Source page* (toggle), *Present*, *Checks and run
     details*, *Review and publish*.
  4. **Results**: *Results*.
  5. **Help**: *Demo* (the renamed tour, which replays the recorded build), *How it works*.
  6. **Footer: access status.**
     - Gate off: nothing.
     - Read-only: "Read-only demo" plus an *Enter access code* button.
     - Granted: "Judge access · $X of $50 left" plus *Sign out*.
     - Builds paused or budget reached: say so plainly.
- **Every sidebar entry opens in the main area.** Nothing opens a panel on the right from the sidebar. The right drawer
  stays only for details of the open lesson (checks and run details), opened from the lesson itself or from *Checks and
  run details*.
- **The main view is in the URL:** `?view=new|lessons|results|how`; no view means the lesson. Existing params (`?job=`,
  `?present=`, `?replay=`) keep working. `?tour=` keeps working and `?demo=` is its new alias.
- **New lesson page (main area):** two clearly separated paths.
  - **Pick from the library:** search the library, subject chips, then a page preview.
  - **Use your own source:** paste text or a link, using the existing form and its rules, with the licence
    confirmation unchanged. It is prominent: a judge must see within one glance that they can try their own page.
  - Then a model choice (Muse Spark 1.3 / Muse Spark Open) and **Build lesson**.
  - When the gate is on and access is not granted, the build area shows the access-code form inline: "Builds are open
    to judges with an access code. Everything else (browsing, recorded builds, presenting) works without one." Never a
    dead button.
- **Demo:** rename every visible "Tour" to "Demo": the sidebar entry, the cards' "Skip tour" → "Skip demo", hints and
  aria labels. Internal names and storage keys can stay.
- **Review and publish / Results:** sidebar entries exist and route to `view=review` / `view=results`. A later slice
  builds these pages; for now they render a minimal honest placeholder that this slice may style.
- **Access client:** `apps/web/src/api.ts` gains `getAccess()`, `postAccess(code)` and `deleteAccess()` per section A,
  and the existing POST helpers surface `ACCESS_REQUIRED`, `JUDGE_BUDGET_REACHED` and `BUILDS_PAUSED` as plain messages.
- **Sizes:** 1920×1080 and 2560×1440 first; 1366 must still work. The sidebar never covers the lesson; below 1100 px it
  may become a top bar or a menu. Impeccable detect stays 0. The look matches the existing dev.meta.ai-like style, not
  generic AI-dashboard chrome.

## Ownership
| Slice | Owner | Files |
|---|---|---|
| A | Sonnet 5.5 | `apps/api/**`, `config/resource-limits.json` (+ its validation/tests) |
| B | Opus 5.5 | `apps/web/src/**`, `apps/web/index.html` |
