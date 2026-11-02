// Stage 10 (docs/specs/STAGE-10-navigation-and-access.md, section B): All lessons, a main-area page. Finished lessons,
// newest first, filterable by subject, with a search over the page title. Library tidy (docs/specs/LIBRARY-TIDY.md):
// the published lessons sit on a shelf above the list; "One per page" (the default) shows the published lesson of each
// page, else its newest; "Every lesson" and "All runs" show the rest, and "Archived" the copies a teacher put away.
// With access, rows offer Archive / Archive older / Restore as SIBLING buttons of the row (never nested in it).
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { api } from '../api.ts';
import type { JobSummary, SourceMeta } from '../api.ts';
import type { Loadable } from '../hooks.ts';
import type { Access } from '../lib/access.ts';
import { archiveConfirmText, archiveErrorMessage, archiveStatusText, canArchive, olderCopies, rowArchiveAction } from '../lib/archive.ts';
import type { ArchiveChange, RowArchiveAction } from '../lib/archive.ts';
import { browseLessons, chipUnit, lessonsLede, pageBreakdown, partsText, publishedShelf, rowsCountText, shelfVisible } from '../lib/browse.ts';
import type { LessonRow, LessonScope } from '../lib/browse.ts';
import { NEEDS_REVIEW, NEEDS_REVIEW_DETAIL, reviewDate } from '../lib/reviewState.ts';
import { runLine } from '../lib/runs.ts';
import { shortTitle } from '../lib/sources.ts';
import { subjectCounts, subjectLabel } from '../lib/subjects.ts';
import type { SubjectKey } from '../lib/subjects.ts';
import { Mark } from './icons.tsx';
import { IconSearch } from './navIcons.tsx';
import { SubjectChips } from './SubjectChips.tsx';

const PAGE = 60;
/** The SAM stamp: a small dashed outline, the shape SAM 3.1 traces round a part. */
function SamGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
      <rect x="1.5" y="1.5" width="9" height="9" rx="2" fill="none" stroke="currentColor" strokeWidth="1.3" strokeDasharray="2 1.6" />
    </svg>
  );
}

export interface AllLessonsPageProps {
  jobs: Loadable<JobSummary[]>;
  sourcesById: ReadonlyMap<string, SourceMeta>;
  openJobId: string | null;
  serverBusy: boolean | null;
  subjectFilter: SubjectKey | null;
  onSubjectFilter: (s: SubjectKey | null) => void;
  onOpen: (jobId: string, sourceId: string) => void;
  onNewLesson: () => void;
  /** Who may archive and restore: the same gate as publishing. */
  access: Access;
  /** Reload the job list (after an archive or restore). */
  onJobsChanged: () => void;
  /** To Review and publish (the empty shelf's pointer). */
  onReview: () => void;
}

const SCOPES: { id: LessonScope; label: string }[] = [
  { id: 'latest', label: 'One per page' },
  { id: 'lessons', label: 'Every lesson' },
  { id: 'all', label: 'All runs' },
  { id: 'archived', label: 'Archived' },
];

type Status = { text: string; error: boolean } | null;

const displayTitle = (t: string): string => (t === 'A page no longer listed' ? t : shortTitle(t));
const num = (n: number): string => n.toLocaleString('en-US');

export function AllLessonsPage(p: AllLessonsPageProps) {
  const uid = useId();
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<LessonScope>('latest');
  const [limit, setLimit] = useState(PAGE);
  const [shelfAll, setShelfAll] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>(null);
  const [confirming, setConfirming] = useState(false);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const archiveAllRef = useRef<HTMLButtonElement>(null);
  const manage = canArchive(p.access);

  const all = p.jobs.state === 'ready' ? p.jobs.data : [];
  const inScope = useMemo(() => browseLessons(all, p.sourcesById, { query: '', subject: null, scope }), [all, p.sourcesById, scope]);
  const rows = useMemo(() => browseLessons(all, p.sourcesById, { query, subject: p.subjectFilter, scope }), [all, p.sourcesById, query, p.subjectFilter, scope]);
  const counts = useMemo(() => subjectCounts(inScope, (r) => r.subject), [inScope]);
  const finished = useMemo(() => all.filter((j) => j.status === 'succeeded' && j.archivedAt === undefined), [all]);
  const archivedCount = useMemo(() => all.filter((j) => j.archivedAt !== undefined).length, [all]);
  // 104 pages against the library's 97: the rest are teacher texts and pages since retired (UX review 2, M5).
  const breakdown = useMemo(() => pageBreakdown(all, p.sourcesById), [all, p.sourcesById]);
  const shelf = useMemo(() => publishedShelf(all, p.sourcesById), [all, p.sourcesById]);
  const older = useMemo(() => {
    const ids = new Set(olderCopies(all));
    return { count: ids.size, pages: new Set(all.filter((j) => ids.has(j.jobId)).map((j) => j.sourceId)).size };
  }, [all]);
  const shown = rows.slice(0, limit);
  const resultColumn = scope === 'all' || scope === 'archived';

  const pickScope = (s: LessonScope): void => { setScope(s); setLimit(PAGE); setConfirming(false); };

  /** One archive call: the list reloads after it (success or refusal) and the status line says what changed. */
  const change = (key: string, kind: ArchiveChange, call: () => Promise<number>): void => {
    if (busy !== null) return;
    setBusy(key);
    setStatus(null);
    call().then(
      (n) => setStatus({ text: archiveStatusText(kind, n), error: false }),
      (e: unknown) => setStatus({ text: archiveErrorMessage(e), error: true }),
    ).finally(() => {
      setBusy(null);
      setConfirming(false);
      p.onJobsChanged();
      // The row the button sat in may be gone: focus goes to the status line, never to the page body.
      window.setTimeout(() => statusRef.current?.focus({ preventScroll: true }), 0);
    });
  };
  const onRowAction = (r: LessonRow<JobSummary>, a: RowArchiveAction): void => {
    if (a.kind === 'archive') change(r.jobId, 'archive', async () => ((await api.postArchive(r.jobId, 'archive')).archivedAt === null ? 0 : 1));
    else if (a.kind === 'restore') change(r.jobId, 'restore', async () => ((await api.postArchive(r.jobId, 'restore')).archivedAt === null ? 1 : 0));
    else change(r.jobId, 'archive-older', async () => (await api.postArchiveBulk('archive-older', r.sourceId)).archived.length);
  };
  const archiveEverywhere = (): void => change('library', 'archive-older', async () => (await api.postArchiveBulk('archive-older')).archived.length);
  const restoreEverywhere = (): void => change('restore-all', 'restore-all', async () => (await api.postArchiveBulk('restore-all')).restored.length);
  const cancelConfirm = (): void => { setConfirming(false); window.setTimeout(() => archiveAllRef.current?.focus(), 0); };
  const onConfirmKey = (e: ReactKeyboardEvent): void => { if (e.key === 'Escape') { e.preventDefault(); cancelConfirm(); } };

  // The shelf: hidden when nothing is published, except for a teacher who can publish (it points to Review and publish).
  const showShelf = scope !== 'archived' && p.jobs.state === 'ready' && (shelf.length > 0 || manage);
  // Three rows of the grid as laid out now (Calvin: no Show all while there is room).
  const cardsRef = useRef<HTMLUListElement | null>(null);
  const [columns, setColumns] = useState(0);
  useEffect(() => {
    const el = cardsRef.current;
    if (el === null) return undefined;
    const measure = (): void => setColumns(getComputedStyle(el).gridTemplateColumns.split(' ').filter((s) => s !== '').length);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [showShelf, shelf.length]);
  const fits = shelfVisible(shelf.length, columns);
  const shelfShown = shelfAll ? shelf : shelf.slice(0, fits);

  return (
    <div className="page page-lessons" data-testid="all-lessons-page">
      <header className="page-head">
        <h1 className="page-title" tabIndex={-1} data-view-title>All lessons</h1>
        <p className="page-lede">
          {p.jobs.state === 'ready'
            ? lessonsLede(finished.length, breakdown, archivedCount)
            : 'Every finished lesson on this server.'}
        </p>
      </header>

      {showShelf && (
        <section className="ll-shelf" aria-labelledby={`${uid}-shelf`} data-testid="published-shelf">
          <h2 id={`${uid}-shelf`} className="ll-shelf-title">
            Published{shelf.length > 0 && <span className="ll-shelf-n">{num(shelf.length)}</span>}
          </h2>
          {shelf.length === 0 ? (
            <p className="ll-shelf-empty">
              No published lessons yet. A teacher reads a lesson, then publishes it from Review and publish.{' '}
              <button type="button" className="link-btn" onClick={p.onReview}>Open Review and publish</button>
            </p>
          ) : (
            <>
              <ul className="ll-cards" ref={cardsRef}>
                {shelfShown.map((r) => {
                  // No highlight for the lesson already open (it read as still selected, Calvin 2 Nov): a short line says it.
                  const open = r.jobId === p.openJobId;
                  return (
                    <li key={r.jobId}>
                      <button type="button" className="ll-card" onClick={() => p.onOpen(r.jobId, r.sourceId)} data-job={r.jobId} aria-current={open ? 'true' : undefined}>
                        <span className="ll-card-tags">
                          <span className="ll-card-subject"><span className="sr-only">Subject: </span>{subjectLabel(r.subject)}</span>
                          {r.job.samUsed === true && (
                            <span className="ll-card-sam" title="The diagram's parts were outlined by SAM 3.1">
                              <SamGlyph /><span className="sr-only">Diagram outlined by </span>SAM 3.1
                            </span>
                          )}
                        </span>
                        <span className="ll-card-title" title={displayTitle(r.title)}>{displayTitle(r.title)}</span>
                        <span className="ll-card-meta">
                          <span><span className="sr-only">Model: </span>{runLine(r.job, { liveJobIds: new Set(), serverBusy: p.serverBusy }).model}</span>
                          {open && <><span aria-hidden="true">·</span><span className="ll-open">Open in Lesson</span></>}
                        </span>
                        <span className="ll-card-date"><Mark kind="ok" />Published {r.published === null ? '' : reviewDate(r.published)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {shelf.length > fits && (
                <button type="button" className="link-btn ll-shelf-more" aria-expanded={shelfAll} onClick={() => setShelfAll((v) => !v)}>
                  {shelfAll ? 'Show fewer' : `Show all ${num(shelf.length)} published lessons`}
                </button>
              )}
            </>
          )}
        </section>
      )}

      <div className="ll-tools">
        <div className="nl-search ll-search">
          <label htmlFor={`${uid}-q`} className="sr-only">Search lessons by page title</label>
          <IconSearch size={18} />
          <input id={`${uid}-q`} type="search" value={query} placeholder="Search by page title" autoComplete="off"
            onChange={(e) => { setQuery(e.target.value); setLimit(PAGE); }} aria-describedby={`${uid}-count`} />
        </div>
        <div className="ll-scope" role="group" aria-label="Which runs to list">
          {SCOPES.map((s) => (
            <button key={s.id} type="button" className="ll-scope-btn" aria-pressed={scope === s.id} onClick={() => pickScope(s.id)}>
              {s.label}
              {s.id === 'archived' && archivedCount > 0 && <span className="ll-scope-n">{num(archivedCount)}</span>}
            </button>
          ))}
        </div>
      </div>
      {p.jobs.state === 'ready' && (
        <SubjectChips counts={counts} total={inScope.length} active={p.subjectFilter} onChange={(s) => { p.onSubjectFilter(s); setLimit(PAGE); }} label="Filter lessons by subject" unit={chipUnit(scope)} />
      )}

      {p.jobs.state === 'loading' && <p className="muted">Loading lessons…</p>}
      {p.jobs.state === 'error' && <p className="callout callout-error" role="alert">{p.jobs.message}</p>}
      {p.jobs.state === 'ready' && (
        <>
          <div className="ll-countbar">
            <p id={`${uid}-count`} className="nl-count" aria-live="polite">
              {rowsCountText({ scope, count: rows.length, subjectLabel: p.subjectFilter === null ? null : subjectLabel(p.subjectFilter), query })}
            </p>
            {manage && scope !== 'archived' && older.count > 0 && !confirming && (
              <button ref={archiveAllRef} type="button" className="ll-act-btn" onClick={() => setConfirming(true)} disabled={busy !== null}>
                Archive older copies
              </button>
            )}
            {manage && scope === 'archived' && archivedCount > 0 && (
              <button type="button" className="ll-act-btn" onClick={restoreEverywhere} disabled={busy !== null} aria-busy={busy === 'restore-all'}>
                {busy === 'restore-all' ? 'Restoring…' : `Restore all ${num(archivedCount)}`}
              </button>
            )}
          </div>
          <p ref={statusRef} className={`ll-status${status?.error === true ? ' tone-bad' : ''}`} role="status" tabIndex={-1} data-testid="archive-status">
            {status?.text ?? ''}
          </p>
          {manage && confirming && (
            <div className="ll-confirm" role="group" aria-labelledby={`${uid}-confirm-text`} onKeyDown={onConfirmKey} data-testid="archive-confirm">
              <p id={`${uid}-confirm-text`} className="ll-confirm-text">{archiveConfirmText(older.count, older.pages)}</p>
              <div className="ll-confirm-bar">
                {/* Opened by a click on "Archive older copies": focus moves to its first button (Escape cancels). */}
                <button type="button" className="btn btn-primary btn-small" onClick={archiveEverywhere} disabled={busy !== null} aria-busy={busy === 'library'} autoFocus>
                  {busy === 'library' ? 'Archiving…' : `Archive ${num(older.count)} ${older.count === 1 ? 'copy' : 'copies'}`}
                </button>
                <button type="button" className="btn btn-small" onClick={cancelConfirm} disabled={busy !== null}>Cancel</button>
              </div>
            </div>
          )}
          {rows.length === 0 ? (
            <p className="nl-empty">
              {query !== '' || p.subjectFilter !== null ? (
                <>Nothing to show here.{' '}<button type="button" className="link-btn" onClick={() => { setQuery(''); p.onSubjectFilter(null); }}>Clear the search and filter</button></>
              ) : scope === 'archived' ? (
                'No runs are archived. Archived copies show here, and Restore brings them back.'
              ) : (
                <>Nothing to show here.{' '}<button type="button" className="link-btn" onClick={p.onNewLesson}>Build a new lesson</button></>
              )}
            </p>
          ) : (
            <div className={`ll-table${manage ? ' has-act' : ''}`}>
              <div className="ll-head" aria-hidden="true">
                <span>Page</span><span>Subject</span><span>Model</span><span>{resultColumn ? 'Result' : 'Parts'}</span><span className="ll-when">Built</span>
              </div>
              <ul className="ll-rows">
                {shown.map((r) => {
                  const line = runLine(r.job, { liveJobIds: new Set(), serverBusy: p.serverBusy });
                  const open = r.jobId === p.openJobId;
                  const result = resultColumn ? line.status.text : partsText(r.job);
                  const title = displayTitle(r.title);
                  const act = manage ? rowArchiveAction({ ...r, title }, scope) : null;
                  return (
                    <li key={r.jobId}>
                      <button
                        type="button" className={`ll-row${open ? ' is-open' : ''}`} aria-current={open ? 'true' : undefined}
                        onClick={() => p.onOpen(r.jobId, r.sourceId)} data-job={r.jobId}
                      >
                        <span className="ll-title">
                          {title}
                          {open && <span className="ll-open">Open in Lesson</span>}
                          {r.badge === 'published' && r.published !== null && <span className="ll-published" title={`Reviewed by a teacher and published ${reviewDate(r.published)}`}><Mark kind="ok" />Published</span>}
                          {r.badge === 'needs-review' && <span className="ll-review" title={NEEDS_REVIEW_DETAIL}>{NEEDS_REVIEW}</span>}
                          {r.archived !== null && <span className="ll-archived">Archived {reviewDate(r.archived)}</span>}
                        </span>
                        <span className="ll-cell"><span className="sr-only">Subject: </span>{subjectLabel(r.subject)}</span>
                        <span className="ll-cell"><span className="sr-only">Model: </span>{line.model}</span>
                        <span className={`ll-cell${resultColumn ? ` tone-${line.status.tone}` : ''}`}>{result}</span>
                        <span className="ll-cell ll-when"><span className="sr-only">Built </span>{line.when}</span>
                      </button>
                      {manage && (
                        <span className="ll-act">
                          {act !== null ? (
                            <button
                              type="button" className="ll-act-btn" onClick={() => onRowAction(r, act)} disabled={busy !== null}
                              aria-label={act.aria} aria-busy={busy === r.jobId}
                            >
                              {busy === r.jobId ? (act.kind === 'restore' ? 'Restoring…' : 'Archiving…') : act.label}
                            </button>
                          ) : r.pinned && (scope === 'lessons' || scope === 'all') ? (
                            <span className="ll-act-note" title="The app links to this run, so it is never archived">Pinned</span>
                          ) : null}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
              {rows.length > shown.length && (
                <p className="ll-more">
                  <button type="button" className="btn" onClick={() => setLimit((n) => n + PAGE)}>
                    Show {Math.min(PAGE, rows.length - shown.length)} more
                  </button>
                  <span className="muted small">{shown.length} of {num(rows.length)} shown</span>
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
