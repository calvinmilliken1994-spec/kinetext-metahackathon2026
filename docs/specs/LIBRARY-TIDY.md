# Library tidy: Needs review, Published shelf, archiving old copies

Agreed with Calvin on 2 Nov 2026. The All lessons page lists every run (754 on the dev server, 644 finished lessons from
101 pages) because the library was built many times over for the evaluation. This slice makes it read as one lesson per
page, puts teacher-published lessons first, warns on unreviewed lessons, and lets a teacher archive old copies.

Interfaces below are frozen. Backend and web are built in parallel against them.

## Rules

- **Nothing is deleted and no run file changes.** Archiving writes a side file next to the run, the way publishing writes
  `review.json`. Restoring deletes that side file.
- **Archiving needs the access code** (same gate as publishing). Read-only visitors see no archive controls.
- **Never archived:** published lessons, pinned runs (`config/pinned-runs.json`), runs still in progress.
- **Wording:** an unpublished finished lesson "Needs review". One wording everywhere the app used "Teacher review pending".
  Activity runs (flow `activity`) and failed runs get no review badge (they are not reviewable).

## Storage

`<storageDir>/runs/<jobId>/archive.json` = `{ "archivedAt": "<ISO 8601>" }`. Written atomically (temp file in the same
directory, then rename). A missing, damaged or unrecognised file reads as "not archived".

## Pinned runs

`config/pinned-runs.json`:

```json
{ "note": "…", "runs": [ { "jobId": "job-…", "why": "Demo and opening lesson" } ] }
```

It lists every run the app links to by id: `DEMO_PINS` (tour, opening, welcome) in `apps/web/src/lib/demoPins.ts`, every
job id in `apps/web/src/data/results.json`, and every other `job-YYYYMMDDHHMMSS-xxxxxxxx` literal in non-test files under
`apps/web/src`. A test fails when a linked id is missing from the file.

## API

### `GET /api/jobs`

Each item gains, when they apply:

- `archivedAt: string`, the archive time (absent = not archived);
- `pinned: true` (absent = not pinned).

### `POST /api/jobs/:id/archive`

Body `{ "action": "archive" }` or `{ "action": "restore" }`. Check order, as for `/review`: 405 (not POST), 403
`ORIGIN_NOT_ALLOWED`, 403 `ACCESS_REQUIRED`, 404 `NOT_FOUND`, 415 `UNSUPPORTED_MEDIA_TYPE`, 413 `PAYLOAD_TOO_LARGE` (over
1 KB), 400 `BAD_REQUEST`. Archive only: 409 `RUN_PINNED`, 409 `RUN_PUBLISHED`, 409 `RUN_ACTIVE` (not finished).
Archiving an archived run keeps its first time. Restore always succeeds (idempotent).

Answer: 200 `{ "archivedAt": "<ISO>" | null }`.

### `POST /api/archive`

Body `{ "action": "archive-older", "sourceId"?: string }` or `{ "action": "restore-all", "sourceId"?: string }`. Without
`sourceId` it covers the whole library. Same gate and error order (no 404; an unknown `sourceId` matches nothing).

`archive-older`, per page (`sourceId`), computed over the runs that are not archived yet:

1. The **keeper** is the newest `succeeded` run with flow `lesson`; when there is none, the newest `succeeded` run of any
   flow; when there is none, no keeper.
2. Every other run of the page is archived unless it is published, pinned, or not finished.

`restore-all` restores every archived run (of the page, or everywhere).

Answer: 200 `{ "archived": ["job-…"], "restored": ["job-…"] }` (ids changed by this call; the other list is empty).

## Web

- `api.ts`: `JobSummary.archivedAt?: string`, `JobSummary.pinned?: boolean`; `postArchive(jobId, action)`,
  `postArchiveBulk(action, sourceId?)`.
- **All lessons**
  - Scopes: **One per page** (default: the published lesson of each page when there is one, else the newest finished
    lesson), **Every lesson**, **All runs**, **Archived**. Archived runs appear only under Archived.
  - **Published shelf** above the list: the published lessons as cards (title, subject, model, published date). Hidden
    when there are none. With access, an empty state points to Review and publish instead.
  - **Needs review** badge (amber) on every unpublished finished lesson, where published ones show "Published".
  - **With access:** a row action to archive a run (Every lesson, All runs) or archive the page's older copies (One per
    page, shown only when there are any), not offered on pinned or published runs; "Archive older copies" for the
    whole library with an inline confirmation that says what stays; under Archived, Restore per run and Restore all.
    The list reloads after each change and a status line says what changed ("Archived 512 older copies").
  - The counts lede leaves archived runs out and says how many are archived.
- **New lesson page:** the per-page lesson counts leave archived runs out; "open its lesson" prefers the published one.
- **Lesson page:** the status line under the title becomes an amber **Needs review** notice ("AI-written and not yet
  checked by a teacher") with a link to Review and publish, when the lesson is unpublished. Present mode is unchanged.

## Amendment 2026-11-02 (Calvin's shelf review)

- `GET /api/jobs` adds `samUsed: true` to a **published** lesson whose kept (passed, not hidden) label diagram has SAM 3.1
  regions in its published revision (`apps/api/sam-used.ts`). Absent otherwise.
- Published shelf cards carry a small subject tag and, when `samUsed`, a "SAM 3.1" stamp. The shelf shows as many cards
  as fill two rows of its grid before "Show all".
