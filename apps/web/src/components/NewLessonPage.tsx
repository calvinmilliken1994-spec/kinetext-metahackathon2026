// Stage 10 (docs/specs/STAGE-10-navigation-and-access.md, section B): the New lesson page, in the main area. Two clearly
// separated paths (the licensed library, or the teacher's own text), then a model choice and Build lesson. While the
// judge gate is on and the visitor has no access, the build area holds the access-code form instead of a dead button.
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import type { JobSummary, SourceDoc, SourceMeta } from '../api.ts';
import type { Loadable } from '../hooks.ts';
import { USER_SOURCE_LIMITS } from '../../../../packages/contracts/index.ts';
import { buildGate } from '../lib/access.ts';
import type { Access } from '../lib/access.ts';
import { lessonsByPage, previewExcerpt } from '../lib/browse.ts';
import { librarySearch, selectionOutside } from '../lib/newLesson.ts';
import type { LibraryResult } from '../lib/newLesson.ts';
import { revealInPanels } from '../lib/scroll.ts';
import { AI_SUMMARY_PHRASE } from '../lib/pageCopy.ts';
import type { GenerateState } from '../lib/health.ts';
import type { FlowId } from '../lib/lessonJob.ts';
import { libraryCounts } from '../lib/libraryCounts.ts';
import type { ModelId, ModelOption } from '../lib/models.ts';
import {
  DEMO_FAULT_HELP, DEMO_FAULT_LABEL, demoFaultOptions, FREE_CREDITS_NOTE, isHttpUrl, shortTitle, sourceCreditText, sourceCreditTitle, sourceLicenseText,
} from '../lib/sources.ts';
import type { DemoChoice } from '../lib/sources.ts';
import { activeSources, subjectLabel, subjectOf } from '../lib/subjects.ts';
import { figureSizeText } from '../lib/teacherFigure.ts';
import type { AddedFigure } from '../lib/teacherFigure.ts';
import type { SubjectKey } from '../lib/subjects.ts';
import { AccessForm } from './AccessForm.tsx';
import { IconExternal } from './icons.tsx';
import { IconLibrary, IconPaste, IconSearch } from './navIcons.tsx';
import { ModelPicker } from './ModelPicker.tsx';
import { PasteSourceForm } from './PasteSourceForm.tsx';
import { SubjectChips } from './SubjectChips.tsx';

export type SourcePath = 'library' | 'own';

/** Finished lessons per page, archived runs left out (Library tidy): how many, and the one to open (published first). */
type PageLessons = ReturnType<typeof lessonsByPage>;

export interface NewLessonPageProps {
  sources: Loadable<SourceMeta[]>;
  jobs: readonly JobSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** A pasted text was stored: reload the list and select it. `figure`: the teacher's diagram (beta) added with it, if any. */
  onCreated: (sourceId: string, figure: AddedFigure | null) => void;
  /** Teacher diagram (beta): the diagram kept with each own source this session, sent as `figureId` with Build. */
  figures?: Readonly<Record<string, AddedFigure>>;
  /** Leave the kept diagram out of the next build. */
  onRemoveFigure?: (sourceId: string) => void;
  /** The selected page's stored text (for the preview). */
  doc: Loadable<SourceDoc> | null;
  onOpenLesson: (jobId: string, sourceId: string) => void;
  subjectFilter: SubjectKey | null;
  onSubjectFilter: (s: SubjectKey | null) => void;
  generate: GenerateState;
  onGenerate: () => void;
  generateError: string | null;
  models: readonly ModelOption[];
  modelChoice: ModelId;
  onModelChoice: (id: ModelId) => void;
  live: boolean | null;
  flow: FlowId;
  onFlow: (f: FlowId) => void;
  demoChoice: DemoChoice;
  onDemoChoice: (c: DemoChoice) => void;
  access: Access;
  onAccess: (a: Access) => void;
  /** Stage 10c: open on this path (the Demo's "Try your own page"); `n` changes for each request. */
  openPath?: { path: SourcePath; n: number } | null;
  /** The visitor switched path (the app keeps `?path=own` in the address). */
  onPathChange?: (path: SourcePath) => void;
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

export function NewLessonPage(p: NewLessonPageProps) {
  const uid = useId();
  const list = p.sources.state === 'ready' ? p.sources.data : [];
  const selected = list.find((s) => s.id === p.selectedId) ?? null;
  const [path, setPathState] = useState<SourcePath>(() => p.openPath?.path ?? (selected?.kind === 'user' ? 'own' : 'library'));
  const { onPathChange } = p;
  const setPath = (next: SourcePath): void => { setPathState(next); onPathChange?.(next); };
  // A request to open a path while the page is already open (the Demo's closing card).
  const asked = p.openPath?.n;
  useEffect(() => { if (p.openPath != null) setPathState(p.openPath.path); }, [asked]);
  const lib = useMemo(() => libraryCounts(list), [list]);
  const lessons = useMemo(() => lessonsByPage(p.jobs), [p.jobs]);
  // M1: the search lives here so the preview can say when it hides the chosen page.
  const [query, setQuery] = useState('');
  const found = useMemo(() => librarySearch(list, { query, subject: p.subjectFilter }), [list, query, p.subjectFilter]);
  const target = path === 'library' ? (selected !== null && selected.kind !== 'user' ? selected : null) : (selected?.kind === 'user' ? selected : null);
  const outside = path === 'library' && target !== null && selectionOutside(target.id, found);
  const clearSearch = (): void => { setQuery(''); p.onSubjectFilter(null); };
  const gate = buildGate(p.access);

  const tabs: { id: SourcePath; icon: ReactNode; title: string; detail: string }[] = [
    { id: 'library', icon: <IconLibrary size={22} />, title: 'From the library', detail: p.sources.state === 'ready' ? `${lib.library} licensed pages in ${lib.counts.length} subjects` : 'Licensed public pages' },
    { id: 'own', icon: <IconPaste size={22} />, title: 'Your own source', detail: 'Paste a page you have the rights to use' },
  ];
  const onTabKey = (e: ReactKeyboardEvent<HTMLButtonElement>): void => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const next: SourcePath = e.key === 'Home' ? 'library' : e.key === 'End' ? 'own' : path === 'library' ? 'own' : 'library';
    setPath(next);
    document.getElementById(`${uid}-tab-${next}`)?.focus();
  };

  return (
    <div className="page page-new" data-testid="new-lesson-page">
      <header className="page-head">
        <h1 className="page-title" tabIndex={-1} data-view-title>New lesson</h1>
        <p className="page-lede">
          Choose a page, and Muse Spark builds a lesson from it: {AI_SUMMARY_PHRASE}, then interactive parts for your class, each
          checked against the page.
        </p>
      </header>

      <div className="nl-grid">
        <div className="nl-main">
      <div className="nl-paths" role="tablist" aria-label="Where the lesson comes from" data-tour="nl-paths">
        {tabs.map((t) => (
          <button
            key={t.id} id={`${uid}-tab-${t.id}`} type="button" role="tab" className="nl-path"
            aria-selected={path === t.id} aria-controls={`${uid}-panel`} tabIndex={path === t.id ? 0 : -1}
            onClick={() => setPath(t.id)} onKeyDown={onTabKey} data-path={t.id}
          >
            <span className="nl-path-icon">{t.icon}</span>
            <span className="nl-path-text">
              <span className="nl-path-title">{t.title}</span>
              <span className="nl-path-detail">{t.detail}</span>
            </span>
          </button>
        ))}
      </div>

        <div className="nl-source" role="tabpanel" id={`${uid}-panel`} aria-labelledby={`${uid}-tab-${path}`}>
          {path === 'library'
            ? <LibraryList {...p} list={list} lessons={lessons} query={query} onQuery={setQuery} found={found} onClear={clearSearch} />
            : <OwnSource {...p} list={list} locked={gate === 'needs-code'} />}
        </div>
        </div>

        <div className="nl-side">
          <Preview
            path={path} target={target} doc={p.doc} lessons={lessons} onOpenLesson={p.onOpenLesson} outside={outside} onClear={clearSearch}
            figure={target?.kind === 'user' ? p.figures?.[target.id] ?? null : null} onRemoveFigure={p.onRemoveFigure}
          />
          <BuildArea {...p} target={target} path={path} gate={gate} />
        </div>
      </div>
    </div>
  );
}

// ---- the library path ------------------------------------------------------------------------------------------

function LibraryList(p: NewLessonPageProps & {
  list: readonly SourceMeta[]; lessons: PageLessons;
  query: string; onQuery: (q: string) => void; found: LibraryResult<SourceMeta>; onClear: () => void;
}) {
  const uid = useId();
  const { query } = p;
  const lib = useMemo(() => libraryCounts(p.list), [p.list]);
  const shown = p.found;
  // M1: the list scrolls inside its own box, which ends at the bottom of the page column (beside the sticky preview), so
  // the chosen page can be scrolled into view without moving the paths and the search off screen.
  const listRef = useRef<HTMLDivElement>(null);
  const pagesRef = useRef<HTMLFieldSetElement>(null);
  const ready = p.sources.state === 'ready';
  const empty = shown.shown === 0;
  useLayoutEffect(() => {
    const fit = (): void => {
      const el = pagesRef.current;
      const panel = el?.closest<HTMLElement>('.page-panel') ?? null;
      if (el === null || panel === null) return;
      if (window.innerWidth <= 1100) { el.style.maxBlockSize = ''; return; }
      const top = el.getBoundingClientRect().top - panel.getBoundingClientRect().top + panel.scrollTop;
      el.style.maxBlockSize = `${Math.max(280, Math.round(panel.clientHeight - top - 28))}px`;
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [ready, empty]);
  // The chosen page is scrolled into view in that box once, when it first shows (never the document). The choice can
  // arrive after the list (a direct ?view=new visit learns its opening lesson from the runs list).
  const revealed = useRef(false);
  useEffect(() => {
    if (!ready || revealed.current) return;
    const row = listRef.current?.querySelector<HTMLElement>('.nl-row.is-on') ?? null;
    if (row === null) return;
    revealed.current = true;
    revealInPanels(row, 'center', 0);
  }, [ready, p.selectedId]);
  if (p.sources.state === 'loading') return <p className="muted">Loading the library…</p>;
  if (p.sources.state === 'error') return <p className="callout callout-error" role="alert">{p.sources.message}</p>;
  return (
    <div className="nl-library" ref={listRef}>
      <div className="nl-search">
        <label htmlFor={`${uid}-q`} className="sr-only">Search the library</label>
        <IconSearch size={18} />
        <input
          id={`${uid}-q`} type="search" value={query} placeholder="Search titles, subjects and topics" autoComplete="off"
          onChange={(e) => p.onQuery(e.target.value)} aria-describedby={`${uid}-count`}
        />
      </div>
      <SubjectChips counts={lib.counts} total={lib.library} active={p.subjectFilter} onChange={p.onSubjectFilter} label="Filter pages by subject" unit="page" />
      <p id={`${uid}-count`} className="nl-count" aria-live="polite">
        {shown.shown === shown.total ? `${plural(shown.total, 'page')}` : `${shown.shown} of ${plural(shown.total, 'page')}`}
        {p.subjectFilter !== null ? ` in ${subjectLabel(p.subjectFilter)}` : ''}
      </p>
      {shown.shown === 0 ? (
        <p className="nl-empty">
          No pages match{query.trim() !== '' ? ` “${query.trim()}”` : ''}{p.subjectFilter !== null ? ` in ${subjectLabel(p.subjectFilter)}` : ''}.{' '}
          <button type="button" className="link-btn" onClick={p.onClear}>Show every page</button>
        </p>
      ) : (
        <fieldset className="nl-pages" ref={pagesRef}>
          <legend className="sr-only">Library page</legend>
          {shown.groups.map((g) => (
            <div key={g.subject} className="nl-group" role="group" aria-labelledby={`${uid}-g-${g.subject}`}>
              <h3 className="nl-group-title" id={`${uid}-g-${g.subject}`}>{g.label}</h3>
              <ul className="nl-rows">
                {g.items.map((s) => {
                  const on = s.id === p.selectedId;
                  const n = p.lessons.get(s.id)?.count ?? 0;
                  return (
                    <li key={s.id}>
                      <label className={`nl-row${on ? ' is-on' : ''}`} title={sourceCreditTitle(s)}>
                        <input type="radio" name={`${uid}-page`} className="sr-only" value={s.id} checked={on} onChange={() => p.onSelect(s.id)} />
                        <span className="nl-row-title">{shortTitle(s.title)}</span>
                        <span className="nl-row-meta">
                          <span>{sourceCreditText(s)}</span>
                          {n > 0 && <span className="nl-row-lessons">{plural(n, 'lesson')}</span>}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </fieldset>
      )}
    </div>
  );
}

// ---- the own-source path ---------------------------------------------------------------------------------------

function OwnSource(p: NewLessonPageProps & { list: readonly SourceMeta[]; locked: boolean }) {
  const uid = useId();
  const mine = activeSources(p.list).filter((s) => s.kind === 'user');
  const [notice, setNotice] = useState<string | null>(null);
  const L = USER_SOURCE_LIMITS;
  return (
    <div className="nl-own">
      {p.locked ? (
        <>
          {/* H4: judges see at once how to try their own page: the code first, the form it unlocks greyed below. */}
          <div className="nl-own-gate" data-testid="own-locked">
            <AccessForm onAccess={p.onAccess} intro="Enter the judge access code to paste your own page and build a lesson from it." />
          </div>
          <p className="nl-own-lede">
            Paste the text of a page you are allowed to use with AI models: a public-domain page, an openly licensed one, or your
            own writing. Muse treats it as data to read, never as instructions.
          </p>
          <div className="nl-own-outline" inert aria-hidden="true" data-testid="own-outline">
            <PasteSourceForm title={null} rows={6} onCreated={() => undefined} />
          </div>
          <p className="nl-own-outline-note">
            The form asks for a title, the page text ({L.textMin.toLocaleString('en-US')} to {L.textMax.toLocaleString('en-US')} characters),
            its licence and who to credit, and your confirmation that you may use it with AI models. You can add one diagram too (beta).
          </p>
        </>
      ) : (
        <>
          <p className="nl-own-lede">
            Paste the text of a page you are allowed to use with AI models: a public-domain page, an openly licensed one, or your
            own writing. Muse treats it as data to read, never as instructions.
          </p>
          {mine.length > 0 && (
            <fieldset className="nl-mine">
              <legend className="nl-group-title">Your saved texts</legend>
              <ul className="nl-rows">
                {mine.map((s) => (
                  <li key={s.id}>
                    <label className={`nl-row${s.id === p.selectedId ? ' is-on' : ''}`}>
                      <input type="radio" name={`${uid}-mine`} className="sr-only" checked={s.id === p.selectedId} onChange={() => { setNotice(null); p.onSelect(s.id); }} />
                      <span className="nl-row-title">{shortTitle(s.title)}</span>
                      <span className="nl-row-meta"><span>{sourceLicenseText(s)}</span></span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          )}
          {notice !== null && <p className="callout small" role="status">{notice}</p>}
          <PasteSourceForm
            title={mine.length > 0 ? 'Paste another text' : null}
            rows={12}
            onCreated={(id, n, figure) => {
              setNotice(n ?? (figure !== null ? 'Saved with your diagram. Build it with the button on the right.' : 'Saved. Build it with the button on the right.'));
              p.onCreated(id, figure);
            }}
          />
        </>
      )}
    </div>
  );
}

// ---- the chosen page --------------------------------------------------------------------------------------------

function Preview({ path, target, doc, lessons, onOpenLesson, outside, onClear, figure, onRemoveFigure }: {
  path: SourcePath; target: SourceMeta | null; doc: Loadable<SourceDoc> | null;
  lessons: PageLessons; onOpenLesson: (jobId: string, sourceId: string) => void;
  /** M1: the chosen page is not in the current results. */
  outside: boolean; onClear: () => void;
  /** Teacher diagram (beta) kept with this own source, if any. */
  figure: AddedFigure | null; onRemoveFigure?: ((sourceId: string) => void) | undefined;
}) {
  const uid = useId();
  if (target === null) {
    return (
      <section className="nl-preview is-empty" aria-labelledby={`${uid}-h`}>
        <h2 id={`${uid}-h`} className="nl-preview-title">{path === 'library' ? 'No page chosen yet' : 'No text saved yet'}</h2>
        <p className="muted">{path === 'library' ? 'Pick a page from the list to see how it starts.' : 'Your text shows here once it is saved.'}</p>
      </section>
    );
  }
  const text = doc?.state === 'ready' && doc.data.id === target.id ? previewExcerpt(doc.data.text, 600, shortTitle(target.title)).replace(/\n{2,}/g, '\n') : null;
  const made = lessons.get(target.id);
  return (
    <section className="nl-preview" aria-labelledby={`${uid}-h`} data-testid="page-preview">
      {outside && (
        <p className="nl-outside" role="status" data-testid="preview-outside">
          <span>Chosen page, not in these results.</span>
          <button type="button" className="link-btn" onClick={onClear}>Clear the search</button>
        </p>
      )}
      <p className="nl-preview-meta">
        <span>{target.kind === 'user' ? 'Your text' : subjectLabel(subjectOf(target))}</span>
        <span aria-hidden="true">·</span>
        <span title={sourceCreditTitle(target)}>{sourceCreditText(target)}</span>
        {isHttpUrl(target.locator) && (
          <>
            <span aria-hidden="true">·</span>
            <a href={target.locator} target="_blank" rel="noopener noreferrer">Original <IconExternal size={14} /><span className="sr-only"> page (opens in a new tab)</span></a>
          </>
        )}
      </p>
      <h2 id={`${uid}-h`} className="nl-preview-title">{shortTitle(target.title)}</h2>
      <div className="nl-excerpt" aria-label="How the page starts">
        {text === null ? <p className="muted">{doc?.state === 'error' ? 'The page text could not be loaded.' : 'Loading the page…'}</p> : <p>{text}</p>}
      </div>
      {figure !== null && (
        <figure className="nl-figure" data-testid="preview-figure">
          <img
            src={`/api/figures/${encodeURIComponent(figure.figureId)}/image`} width={figure.width} height={figure.height} draggable={false}
            alt={figure.caption !== '' ? figure.caption : 'The diagram you added'}
          />
          <figcaption>
            <span>Your diagram <span className="tag figure-beta">beta</span></span>
            <span aria-hidden="true">·</span>
            <span>{figureSizeText(figure.width, figure.height)}</span>
            <span aria-hidden="true">·</span>
            <span>Used in the next build</span>
            {onRemoveFigure !== undefined && target !== null && (
              <button type="button" className="link-btn" onClick={() => onRemoveFigure(target.id)}>Leave it out</button>
            )}
          </figcaption>
        </figure>
      )}
      {made !== undefined && (
        <p className="nl-made">
          {plural(made.count, 'lesson')} already built from this page.{' '}
          <button type="button" className="link-btn" onClick={() => onOpenLesson(made.open, target.id)}>{made.published ? 'Open the published lesson' : 'Open the newest'}</button>
        </p>
      )}
    </section>
  );
}

// ---- model and Build -------------------------------------------------------------------------------------------

function BuildArea(p: NewLessonPageProps & { target: SourceMeta | null; path: SourcePath; gate: ReturnType<typeof buildGate> }) {
  const uid = useId();
  const { generate } = p;
  const why = generate.liveOff
    ? 'Live builds are off on this server. Recorded lessons, replays and presenting still work.'
    : p.target === null
      ? (p.path === 'library' ? 'Choose a page from the list first.' : 'Save your text first.')
      : generate.reason;
  const label = generate.busy ? 'Starting…' : p.flow === 'lesson' ? 'Build lesson' : 'Build activity';
  return (
    <section className="nl-build" aria-labelledby={`${uid}-h`} data-testid="build-area" data-tour="nl-build">
      <h2 id={`${uid}-h`} className="nl-build-title">Build</h2>
      <ModelPicker options={p.models} selected={p.modelChoice} onSelect={p.onModelChoice} live={p.live} locked={generate.busy} />

      {/* H4: on Your own source the access form sits at the top of that panel, so it is not repeated here. */}
      {p.gate === 'needs-code' && p.path === 'library' && <AccessForm onAccess={p.onAccess} />}
      {p.gate === 'needs-code' && p.path === 'own' && (
        <p className="nl-build-own-note" role="note">Enter the access code under Your own source; building unlocks with it.</p>
      )}
      {p.gate === 'budget' && <p className="callout" role="status">The judges’ build budget is used up. Recorded lessons, replays and presenting still work.</p>}
      {p.gate === 'paused' && <p className="callout" role="status">{p.live === false ? 'Live builds are off on this server.' : 'Builds are paused right now.'} Recorded lessons, replays and presenting still work.</p>}

      {p.gate === 'open' && (
        <>
          <div className="nl-go">
            <button
              type="button" className="btn btn-primary nl-go-btn" onClick={p.onGenerate}
              disabled={generate.disabled || p.target === null} aria-describedby={why !== null ? `${uid}-why` : undefined}
            >
              {label}
            </button>
            {p.demoChoice !== 'none' && <span className="tone-fault small" data-testid="demo-fault-armed">With a system-made demo fault</span>}
          </div>
          {why !== null && <p id={`${uid}-why`} className="nl-why">{why}</p>}
          {p.generateError !== null && <p className="field-error" role="alert">{p.generateError}</p>}
          {p.target?.kind === 'user' && <p className="callout small" role="note">{FREE_CREDITS_NOTE}</p>}
          <details className="run-options" open={p.demoChoice !== 'none' || p.flow === 'activity' ? true : undefined}>
            <summary>Run options</summary>
            <div className="run-options-body">
              <label htmlFor="flow-classic" className="check-label">
                <input id="flow-classic" type="checkbox" checked={p.flow === 'activity'} disabled={generate.busy} aria-describedby="flow-classic-help" onChange={(e) => p.onFlow(e.target.checked ? 'activity' : 'lesson')} />
                <span>Classic single activity</span>
              </label>
              <p id="flow-classic-help" className="muted small field-help">
                {p.flow === 'activity'
                  ? 'The next build makes one simulation or timeline, with no overview and no other parts.'
                  : 'Off: the next build makes a lesson, an overview of the page and then a few interactive parts.'}
              </p>
              <div className="field">
                <label htmlFor="demo-fault-select" className="field-label">{DEMO_FAULT_LABEL}</label>
                <select id="demo-fault-select" value={p.demoChoice} disabled={generate.busy} aria-describedby="demo-fault-help" onChange={(e) => p.onDemoChoice(e.target.value as DemoChoice)}>
                  {demoFaultOptions().map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <p id="demo-fault-help" className="muted small field-help">{DEMO_FAULT_HELP}</p>
                {p.demoChoice !== 'none' && (
                  <p className="callout callout-fault small" role="note">The next build will carry a fault planted by the system, not made by Muse.</p>
                )}
              </div>
            </div>
          </details>
        </>
      )}
    </section>
  );
}
