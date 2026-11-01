// Stage 10 (docs/specs/STAGE-10-navigation-and-access.md, section B): the New lesson page, in the main area. Two clearly
// separated paths (the licensed library, or the teacher's own text), then a model choice and Build lesson. While the
// judge gate is on and the visitor has no access, the build area holds the access-code form instead of a dead button.
import { useId, useMemo, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import type { JobSummary, SourceDoc, SourceMeta } from '../api.ts';
import type { Loadable } from '../hooks.ts';
import { USER_SOURCE_LIMITS } from '../../../../packages/contracts/index.ts';
import { buildGate } from '../lib/access.ts';
import type { Access } from '../lib/access.ts';
import { browsePages, lessonsByPage, previewExcerpt } from '../lib/browse.ts';
import type { GenerateState } from '../lib/health.ts';
import type { FlowId } from '../lib/lessonJob.ts';
import { libraryCounts } from '../lib/libraryCounts.ts';
import type { ModelId, ModelOption } from '../lib/models.ts';
import {
  DEMO_FAULT_HELP, DEMO_FAULT_LABEL, demoFaultOptions, FREE_CREDITS_NOTE, isHttpUrl, shortTitle, sourceCreditText, sourceCreditTitle, sourceLicenseText,
} from '../lib/sources.ts';
import type { DemoChoice } from '../lib/sources.ts';
import { activeSources, subjectLabel, subjectOf } from '../lib/subjects.ts';
import type { SubjectKey } from '../lib/subjects.ts';
import { AccessForm } from './AccessForm.tsx';
import { IconExternal } from './icons.tsx';
import { IconLibrary, IconPaste, IconSearch } from './navIcons.tsx';
import { ModelPicker } from './ModelPicker.tsx';
import { PasteSourceForm } from './PasteSourceForm.tsx';
import { SubjectChips } from './SubjectChips.tsx';

export type SourcePath = 'library' | 'own';

export interface NewLessonPageProps {
  sources: Loadable<SourceMeta[]>;
  jobs: readonly JobSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** A pasted text was stored: reload the list and select it. */
  onCreated: (sourceId: string) => void;
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
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

export function NewLessonPage(p: NewLessonPageProps) {
  const uid = useId();
  const list = p.sources.state === 'ready' ? p.sources.data : [];
  const selected = list.find((s) => s.id === p.selectedId) ?? null;
  const [path, setPath] = useState<SourcePath>(() => (selected?.kind === 'user' ? 'own' : 'library'));
  const lib = useMemo(() => libraryCounts(list), [list]);
  const lessons = useMemo(() => lessonsByPage(p.jobs), [p.jobs]);
  const target = path === 'library' ? (selected !== null && selected.kind !== 'user' ? selected : null) : (selected?.kind === 'user' ? selected : null);
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
          Choose a page, and Muse Spark builds a lesson from it: a short summary in the page’s own words, then interactive parts
          for your class, each checked against the page.
        </p>
      </header>

      <div className="nl-grid">
        <div className="nl-main">
      <div className="nl-paths" role="tablist" aria-label="Where the lesson comes from">
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
            ? <LibraryList {...p} list={list} lessons={lessons} />
            : <OwnSource {...p} list={list} locked={gate === 'needs-code'} />}
        </div>
        </div>

        <div className="nl-side">
          <Preview path={path} target={target} doc={p.doc} lessons={lessons} onOpenLesson={p.onOpenLesson} />
          <BuildArea {...p} target={target} path={path} gate={gate} />
        </div>
      </div>
    </div>
  );
}

// ---- the library path ------------------------------------------------------------------------------------------

function LibraryList(p: NewLessonPageProps & { list: readonly SourceMeta[]; lessons: Map<string, { count: number; latest: string }> }) {
  const uid = useId();
  const [query, setQuery] = useState('');
  const lib = useMemo(() => libraryCounts(p.list), [p.list]);
  const shown = useMemo(() => browsePages(p.list, { query, subject: p.subjectFilter }), [p.list, query, p.subjectFilter]);
  if (p.sources.state === 'loading') return <p className="muted">Loading the library…</p>;
  if (p.sources.state === 'error') return <p className="callout callout-error" role="alert">{p.sources.message}</p>;
  return (
    <div className="nl-library">
      <div className="nl-search">
        <label htmlFor={`${uid}-q`} className="sr-only">Search the library</label>
        <IconSearch size={18} />
        <input
          id={`${uid}-q`} type="search" value={query} placeholder="Search titles and publishers" autoComplete="off"
          onChange={(e) => setQuery(e.target.value)} aria-describedby={`${uid}-count`}
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
          <button type="button" className="link-btn" onClick={() => { setQuery(''); p.onSubjectFilter(null); }}>Show every page</button>
        </p>
      ) : (
        <fieldset className="nl-pages">
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
      <p className="nl-own-lede">
        Paste the text of a page you are allowed to use with AI models: a public-domain page, an openly licensed one, or your
        own writing. Muse treats it as data to read, never as instructions.
      </p>
      {p.locked ? (
        <div className="nl-own-locked" data-testid="own-locked">
          <p>The form asks for:</p>
          <ul className="nl-needs">
            <li>a title and the page text, {L.textMin.toLocaleString('en-US')} to {L.textMax.toLocaleString('en-US')} characters;</li>
            <li>its licence and who to credit, plus an optional link to the original;</li>
            <li>your confirmation that you may use it with AI models and that it holds no personal or student data.</li>
          </ul>
          <p className="muted">Saving your own text needs the judge access code, like building. Enter it under Build.</p>
        </div>
      ) : (
        <>
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
            onCreated={(id, n) => { setNotice(n ?? 'Saved. Build it with the button on the right.'); p.onCreated(id); }}
          />
        </>
      )}
    </div>
  );
}

// ---- the chosen page --------------------------------------------------------------------------------------------

function Preview({ path, target, doc, lessons, onOpenLesson }: {
  path: SourcePath; target: SourceMeta | null; doc: Loadable<SourceDoc> | null;
  lessons: Map<string, { count: number; latest: string }>; onOpenLesson: (jobId: string, sourceId: string) => void;
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
      {made !== undefined && (
        <p className="nl-made">
          {plural(made.count, 'lesson')} already built from this page.{' '}
          <button type="button" className="link-btn" onClick={() => onOpenLesson(made.latest, target.id)}>Open the newest</button>
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
    <section className="nl-build" aria-labelledby={`${uid}-h`} data-testid="build-area">
      <h2 id={`${uid}-h`} className="nl-build-title">Build</h2>
      <ModelPicker options={p.models} selected={p.modelChoice} onSelect={p.onModelChoice} live={p.live} locked={generate.busy} />

      {p.gate === 'needs-code' && <AccessForm onAccess={p.onAccess} />}
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
