// Stage 10 (docs/specs/STAGE-10-navigation-and-access.md, section B): All lessons, a main-area page. Finished lessons,
// newest first, filterable by subject, with a search over the page title. By default it lists the newest lesson of each
// page (the library was built several times over for the evaluation); "Every lesson" and "All runs" show the rest.
import { useId, useMemo, useState } from 'react';
import type { JobSummary, SourceMeta } from '../api.ts';
import type { Loadable } from '../hooks.ts';
import { browseLessons, chipUnit, lessonsLede, pageBreakdown, partsText, rowsCountText } from '../lib/browse.ts';
import type { LessonScope } from '../lib/browse.ts';
import { reviewDate } from '../lib/reviewState.ts';
import { runLine } from '../lib/runs.ts';
import { shortTitle } from '../lib/sources.ts';
import { subjectCounts, subjectLabel } from '../lib/subjects.ts';
import type { SubjectKey } from '../lib/subjects.ts';
import { Mark } from './icons.tsx';
import { IconSearch } from './navIcons.tsx';
import { SubjectChips } from './SubjectChips.tsx';

const PAGE = 60;

export interface AllLessonsPageProps {
  jobs: Loadable<JobSummary[]>;
  sourcesById: ReadonlyMap<string, SourceMeta>;
  openJobId: string | null;
  serverBusy: boolean | null;
  subjectFilter: SubjectKey | null;
  onSubjectFilter: (s: SubjectKey | null) => void;
  onOpen: (jobId: string, sourceId: string) => void;
  onNewLesson: () => void;
}

const SCOPES: { id: LessonScope; label: string }[] = [
  { id: 'latest', label: 'Newest per page' },
  { id: 'lessons', label: 'Every lesson' },
  { id: 'all', label: 'All runs' },
];

export function AllLessonsPage(p: AllLessonsPageProps) {
  const uid = useId();
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<LessonScope>('latest');
  const [limit, setLimit] = useState(PAGE);
  const all = p.jobs.state === 'ready' ? p.jobs.data : [];
  const inScope = useMemo(() => browseLessons(all, p.sourcesById, { query: '', subject: null, scope }), [all, p.sourcesById, scope]);
  const rows = useMemo(() => browseLessons(all, p.sourcesById, { query, subject: p.subjectFilter, scope }), [all, p.sourcesById, query, p.subjectFilter, scope]);
  const counts = useMemo(() => subjectCounts(inScope, (r) => r.subject), [inScope]);
  const finished = useMemo(() => all.filter((j) => j.status === 'succeeded'), [all]);
  // 104 pages against the library's 97: the rest are teacher texts and pages since retired (UX review 2, M5).
  const breakdown = useMemo(() => pageBreakdown(all, p.sourcesById), [all, p.sourcesById]);
  const shown = rows.slice(0, limit);

  return (
    <div className="page page-lessons" data-testid="all-lessons-page">
      <header className="page-head">
        <h1 className="page-title" tabIndex={-1} data-view-title>All lessons</h1>
        <p className="page-lede">
          {p.jobs.state === 'ready'
            ? lessonsLede(finished.length, breakdown)
            : 'Every finished lesson on this server.'}
        </p>
      </header>

      <div className="ll-tools">
        <div className="nl-search ll-search">
          <label htmlFor={`${uid}-q`} className="sr-only">Search lessons by page title</label>
          <IconSearch size={18} />
          <input id={`${uid}-q`} type="search" value={query} placeholder="Search by page title" autoComplete="off"
            onChange={(e) => { setQuery(e.target.value); setLimit(PAGE); }} aria-describedby={`${uid}-count`} />
        </div>
        <div className="ll-scope" role="group" aria-label="Which runs to list">
          {SCOPES.map((s) => (
            <button key={s.id} type="button" className="ll-scope-btn" aria-pressed={scope === s.id} onClick={() => { setScope(s.id); setLimit(PAGE); }}>{s.label}</button>
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
          <p id={`${uid}-count`} className="nl-count" aria-live="polite">
            {rowsCountText({ scope, count: rows.length, subjectLabel: p.subjectFilter === null ? null : subjectLabel(p.subjectFilter), query })}
          </p>
          {rows.length === 0 ? (
            <p className="nl-empty">
              Nothing to show here.{' '}
              {query !== '' || p.subjectFilter !== null
                ? <button type="button" className="link-btn" onClick={() => { setQuery(''); p.onSubjectFilter(null); }}>Clear the search and filter</button>
                : <button type="button" className="link-btn" onClick={p.onNewLesson}>Build a new lesson</button>}
            </p>
          ) : (
            <div className="ll-table">
              <div className="ll-head" aria-hidden="true">
                <span>Page</span><span>Subject</span><span>Model</span><span>{scope === 'all' ? 'Result' : 'Parts'}</span><span className="ll-when">Built</span>
              </div>
              <ul className="ll-rows">
                {shown.map((r) => {
                  const line = runLine(r.job, { liveJobIds: new Set(), serverBusy: p.serverBusy });
                  const open = r.jobId === p.openJobId;
                  const result = scope === 'all' ? line.status.text : partsText(r.job);
                  const title = r.title === 'A page no longer listed' ? r.title : shortTitle(r.title);
                  return (
                    <li key={r.jobId}>
                      <button
                        type="button" className={`ll-row${open ? ' is-open' : ''}`} aria-current={open ? 'true' : undefined}
                        onClick={() => p.onOpen(r.jobId, r.sourceId)} data-job={r.jobId}
                      >
                        <span className="ll-title">
                          {title}
                          {open && <span className="ll-open">Open now</span>}
                          {r.published !== null && <span className="ll-published" title={`Reviewed by a teacher and published ${reviewDate(r.published)}`}><Mark kind="ok" />Published</span>}
                        </span>
                        <span className="ll-cell"><span className="sr-only">Subject: </span>{subjectLabel(r.subject)}</span>
                        <span className="ll-cell"><span className="sr-only">Model: </span>{line.model}</span>
                        <span className={`ll-cell${scope === 'all' ? ` tone-${line.status.tone}` : ''}`}>{result}</span>
                        <span className="ll-cell ll-when"><span className="sr-only">Built </span>{line.when}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {rows.length > shown.length && (
                <p className="ll-more">
                  <button type="button" className="btn" onClick={() => setLimit((n) => n + PAGE)}>
                    Show {Math.min(PAGE, rows.length - shown.length)} more
                  </button>
                  <span className="muted small">{shown.length} of {rows.length.toLocaleString('en-US')} shown</span>
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
