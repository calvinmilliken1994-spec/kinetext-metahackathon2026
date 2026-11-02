// Stage 10b slice S (docs/specs/STAGE-10b-review-and-results.md, section S): the Results page. Every number comes from
// data/results.json, which scripts/build-results.ts builds from committed evidence; each section names its files and
// dates. Pre-registered numbers and later runs are kept in separate, labelled sections.
import { useId, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import raw from '../data/results.json';
import {
  FUNNEL_SORTS, PLOT_TICKS, SEGMENT_LABELS, ciText, dateText, diagramSummary, errorCodeText, funnelRows, lessonLink, pct,
  plotPosition, rateText, seconds, subjectRows, usd,
  type FunnelScale, type FunnelSort, type ModelResult, type Rate, type ResultsData, type SourceRef,
} from '../lib/results.ts';
import { BAR_SCALE_NOTE, RESULTS_SECTIONS } from '../lib/pageCopy.ts';
import { revealInPanels } from '../lib/scroll.ts';
import '../styles/results.css';

const DATA = raw as unknown as ResultsData;
/** A section's element id: the index scrolls to it. */
const sectionId = (key: string): string => `results-${key}`;
const DIAGRAMS_ID = sectionId('diagrams');

export interface ResultsPageProps {
  /** The server's job list once loaded (null while loading): a recorded diagram run opens only if it is stored here. */
  jobs: readonly { jobId: string }[] | null;
  /** Open a stored lesson in the lesson view (the app's `?job=` route). */
  onOpenLesson: (jobId: string, sourceId: string) => void;
}

/** A date that never breaks across lines ("31 Oct 2026"). */
function Day({ iso }: { iso: string }) {
  return <time dateTime={iso} className="rs-nowrap">{dateText(iso)}</time>;
}

function Sources({ refs, label = 'Source' }: { refs: readonly SourceRef[]; label?: string }) {
  return (
    <p className="rs-source">
      <span className="rs-source-label">{refs.length > 1 ? `${label}s` : label}:</span>{' '}
      {refs.map((r, i) => (
        <span key={r.path} className="rs-source-item">
          <code title={r.what}>{r.path}</code> · <Day iso={r.date} />{i < refs.length - 1 ? '; ' : ''}
        </span>
      ))}
    </p>
  );
}

function RateCell({ r, sub }: { r: Rate; sub?: ReactNode }) {
  return (
    <>
      <span className="rs-rate">{pct(r.rate)}</span> <span className="rs-kn">{r.k}/{r.n}</span>
      <span className="rs-ci">{sub ?? <>95% interval {ciText(r)}</>}</span>
    </>
  );
}

function Headline({ models, id }: { models: readonly ModelResult[]; id: string }) {
  const ev = DATA.evaluation;
  const open = models.find((m) => m.id === 'muse-spark-open');
  const misses = open === undefined ? 0 : open.lessons.n - open.lessons.k;
  const timeouts = open?.errorCodes.find((e) => e.code === 'TIMEOUT')?.count ?? 0;
  return (
    <section className="rs-section rs-headline" aria-labelledby={id} id={sectionId('headline')}>
      <h2 id={id} tabIndex={-1}>Lessons with at least one working interactive part</h2>
      <p className="rs-context">
        Pre-registered evaluation, <Day iso={ev.preRegisteredAt} />: {ev.pages} library pages, each built {ev.runsPerPage === 2 ? 'twice' : `${ev.runsPerPage} times`} by
        each model.
      </p>
      <div className="rs-hl-grid">
        {models.map((m) => {
          return (
            <figure key={m.id} className="rs-hl-model" aria-label={`${m.label}: ${pct(m.lessons.rate)}, ${m.lessons.k} of ${m.lessons.n} builds, 95% interval ${ciText(m.lessons)}`}>
              <figcaption className="rs-hl-name">{m.label}<span className="rs-hl-route">{m.route}</span></figcaption>
              <p className="rs-hl-figure" aria-hidden="true">{pct(m.lessons.rate)}</p>
              <p className="rs-hl-detail" aria-hidden="true">{m.lessons.k} of {m.lessons.n} builds · 95% interval {ciText(m.lessons)}</p>
              <div className="rs-hl-track" aria-hidden="true">
                <span className="rs-hl-fill" style={{ width: `${100 * (m.lessons.rate ?? 0)}%` }} />
              </div>
            </figure>
          );
        })}
      </div>
      <p className="rs-quiet rs-scale">{BAR_SCALE_NOTE}</p>
      {open !== undefined && timeouts > 0 && (
        <p className="rs-prose">
          Of the {misses} Spark Open builds without a working part, {timeouts} ran out of time on the shared open-weights endpoint; a later retest of those pages is below.
        </p>
      )}
      <Sources refs={ev.sources.filter((s) => s.path.endsWith('summary.json'))} />
    </section>
  );
}

/** "ran out of time 11 · page reading failed its checks 2 · no part passed 1": the error codes plus finished builds with no part. */
function failureCauses(m: ModelResult): string {
  const coded = m.errorCodes.reduce((a, e) => a + e.count, 0);
  const parts = m.errorCodes.map((e) => `${errorCodeText(e.code)} ${e.count}`);
  if (m.failed.k > coded) parts.push(`finished with no part passing ${m.failed.k - coded}`);
  return parts.join(' · ');
}

function Comparison({ models, id }: { models: readonly ModelResult[]; id: string }) {
  const ev = DATA.evaluation;
  const rows: { label: string; hint?: string; cell: (m: ModelResult) => ReactNode }[] = [
    { label: 'Lessons with a working part', cell: (m) => <RateCell r={m.lessons} /> },
    { label: 'Same, leaving out honest declines', hint: 'Builds where Muse said the page does not suit an activity', cell: (m) => <RateCell r={m.lessonsOfUsable} /> },
    { label: 'Honest declines', cell: (m) => <RateCell r={m.declined} /> },
    {
      label: 'Failed builds', hint: 'The build stopped, or no part passed',
      cell: (m) => <RateCell r={m.failed} sub={<>95% interval {ciText(m.failed)}<br />{failureCauses(m)}</>} />,
    },
    { label: 'Parts published of those planned', hint: 'Each model plans its own parts', cell: (m) => <RateCell r={m.parts.rate} sub={`${m.parts.perLesson.toFixed(2)} parts per lesson`} /> },
    { label: 'Parts that passed first try', cell: (m) => <RateCell r={m.parts.firstTry} /> },
    { label: 'Fixed by repair', hint: 'Of the parts that failed their first check', cell: (m) => <RateCell r={m.parts.naturalRepair} /> },
    {
      label: 'Time per lesson', hint: 'Median and 90th percentile',
      cell: (m) => <><span className="rs-rate">{seconds(m.wallS.p50)}</span> <span className="rs-kn">/ {seconds(m.wallS.p90)}</span><span className="rs-ci">longest {seconds(m.wallS.max)}</span></>,
    },
    {
      label: 'Cost per lesson',
      cell: (m) => <><span className="rs-rate">{usd(m.cost.perLessonUSD, 3)}</span><span className="rs-ci">{usd(m.cost.perPublishedPartUSD, 3)} per published part · {usd(m.cost.totalUSD)} in all</span></>,
    },
    { label: 'Same outcome when run twice', hint: `${models[0]?.consistency.pages ?? ''} pages, run 1 against run 2`, cell: (m) => <RateCell r={m.consistency.sameOutcome} /> },
    { label: 'Same parts planned both times', cell: (m) => <RateCell r={m.consistency.samePlan} /> },
    { label: 'Same number of parts published', cell: (m) => <RateCell r={m.consistency.samePublishedCount} /> },
  ];
  return (
    <section className="rs-section" aria-labelledby={id} id={sectionId('compare')}>
      <h2 id={id} tabIndex={-1}>Muse Spark 1.3 and Muse Spark Open, side by side</h2>
      <p className="rs-prose">
        The same {ev.pages} pages, the same prompts and the same checks; only the model differs. Each model plans its own
        parts, so the planned totals differ too.
      </p>
      <div className="rs-scroll">
        <table className="rs-table rs-compare">
          <caption className="sr-only">Pre-registered evaluation, {ev.jobsPerModel} builds per model</caption>
          <thead>
            <tr>
              <th scope="col">Measure</th>
              {models.map((m) => <th key={m.id} scope="col">{m.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <th scope="row">{r.label}{r.hint !== undefined && <span className="rs-hint">{r.hint}</span>}</th>
                {models.map((m) => <td key={m.id}>{r.cell(m)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="rs-prose rs-quiet">
        Page by page (mean parts published over both runs), Spark 1.3 was ahead on {ev.paired.sparkAhead} pages, Spark Open
        on {ev.paired.openAhead}, and they tied on {ev.paired.tied}.
      </p>
      <Sources refs={ev.sources.filter((s) => s.path.endsWith('summary.json') || s.path.endsWith('REPORT.md'))} />
    </section>
  );
}

function Funnel({ models, id }: { models: readonly ModelResult[]; id: string }) {
  const ev = DATA.evaluation;
  const [sort, setSort] = useState<FunnelSort>('planned');
  const [scale, setScale] = useState<FunnelScale>('count');
  const rows = useMemo(() => funnelRows(models, sort, scale), [models, sort, scale]);
  const figuresModel = models.find((m) => m.id === ev.figuresGivenTo);
  const noFigures = models.filter((m) => m.id !== ev.figuresGivenTo);
  const passedLate = models.filter((m) => m.parts.passedInFailedJobs > 0);
  // Container-scoped scroll (lib/scroll.ts): a plain #anchor jump would also scroll the window shell out of view.
  const toDiagrams = () => {
    const el = document.getElementById(DIAGRAMS_ID);
    revealInPanels(el, 'start');
    el?.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
  };
  return (
    <section className="rs-section" aria-labelledby={id} id={sectionId('funnel')}>
      <h2 id={id} tabIndex={-1}>What reaches the live lesson</h2>
      <p className="rs-prose">
        For each kind of part: how many each model planned, how many passed every check the first time, how many passed
        after Muse revised them, and how many were left out. A part reaches the lesson only when it passes.
      </p>
      <div className="rs-controls">
        <div className="rs-seg" role="group" aria-label="Order the part types">
          <span className="rs-seg-label" aria-hidden="true">Order</span>
          {FUNNEL_SORTS.map((s) => (
            <button key={s.id} type="button" className="seg" aria-pressed={sort === s.id} onClick={() => setSort(s.id)}>{s.label}</button>
          ))}
        </div>
        <div className="rs-seg" role="group" aria-label="Bar length">
          <span className="rs-seg-label" aria-hidden="true">Bars</span>
          <button type="button" className="seg" aria-pressed={scale === 'count'} onClick={() => setScale('count')}>Counts</button>
          <button type="button" className="seg" aria-pressed={scale === 'share'} onClick={() => setScale('share')}>Share of planned</button>
        </div>
        <ul className="rs-legend" aria-label="Legend">
          {(['firstTry', 'repaired', 'failed'] as const).map((k) => (
            <li key={k}><span className={`rs-swatch rs-seg-${k}`} aria-hidden="true" />{SEGMENT_LABELS[k]}</li>
          ))}
        </ul>
      </div>
      <div className="rs-scroll">
        <table className="rs-table rs-funnel" data-scale={scale}>
          <caption className="sr-only">Parts planned and published, by part type and model. Pre-registered evaluation.</caption>
          <thead>
            <tr>
              <th scope="col">Part</th>
              <th scope="col">Model</th>
              <th scope="col" className="rs-bar-head"><span className="sr-only">Bar</span></th>
              <th scope="col" className="rs-n">Planned</th>
              <th scope="col" className="rs-n">First try</th>
              <th scope="col" className="rs-n">Repaired</th>
              <th scope="col" className="rs-n">Left out</th>
              <th scope="col" className="rs-n">Published</th>
            </tr>
          </thead>
          {rows.map((r) => (
            <tbody key={r.id}>
              {r.byModel.map((c, i) => (
                <tr key={c.model}>
                  {i === 0 && <th scope="rowgroup" rowSpan={r.byModel.length} className="rs-part">{r.label}</th>}
                  <td className="rs-model">{c.modelLabel.replace(/^Muse /, '')}</td>
                  <td className="rs-bar-cell">
                    {c.planned === 0 ? (
                      <span className="rs-gap">
                        {r.id === 'label-diagram-v1' && c.model !== ev.figuresGivenTo ? 'Not given figures in this evaluation' : 'Not planned'}
                      </span>
                    ) : (
                      <span className="rs-bar" aria-hidden="true">
                        {c.segments.filter((s) => s.count > 0).map((s) => (
                          <span key={s.kind} className={`rs-seg-${s.kind}`} style={{ left: `${s.start}%`, width: `${s.width}%` }} title={`${SEGMENT_LABELS[s.kind]}: ${s.count}`} />
                        ))}
                      </span>
                    )}
                  </td>
                  <td className="rs-n">{c.planned}</td>
                  <td className="rs-n">{c.firstTry}</td>
                  <td className="rs-n">{c.repaired}</td>
                  <td className="rs-n">{c.failed}</td>
                  <td className="rs-n rs-pub">{c.published}</td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
      <div className="rs-notes">
        {figuresModel !== undefined && noFigures.length > 0 && (
          <p>
            <strong>Label the diagram:</strong> as pre-registered, only {figuresModel.label} was given the library figures
            ({ev.figurePages} pages have one), so {noFigures.map((m) => m.label).join(' and ')} could not plan a diagram in this
            evaluation. The zero says nothing about the model: it has since labelled both demo figures, in{' '}
            <button type="button" className="link-btn" onClick={toDiagrams}>Diagram lessons today</button>.
          </p>
        )}
        {passedLate.length > 0 && (
          <p>
            Counted as in the report: {passedLate.map((m) => `${m.parts.passedInFailedJobs} ${m.label}`).join(' and ')}{' '}
            {passedLate.length === 1 && passedLate[0]!.parts.passedInFailedJobs === 1 ? 'part' : 'parts'} passed their checks in
            builds that then stopped (mostly on the time limit), so they are published parts here but those builds are not lessons above.
          </p>
        )}
      </div>
      <Sources refs={ev.sources.filter((s) => s.path.endsWith('jobs.csv') || s.path.endsWith('summary.json'))} />
    </section>
  );
}

function Subjects({ models, id }: { models: readonly ModelResult[]; id: string }) {
  const ev = DATA.evaluation;
  const rows = subjectRows(models);
  const counts = rows.flatMap((r) => r.byModel.map((c) => c.jobs));
  const few = Math.min(...counts);
  const many = Math.max(...counts);
  return (
    <section className="rs-section" aria-labelledby={id} id={sectionId('subjects')}>
      <h2 id={id} tabIndex={-1}>Pass rate by subject</h2>
      <p className="rs-prose">
        Builds that gave a lesson with a working part, by the page’s subject, plotted with their 95% intervals. Each subject has only {few} to {many} builds
        per model, so the intervals are wide and small differences mean little.
      </p>
      <ul className="rs-legend rs-legend-models" aria-label="Legend">
        {models.map((m, i) => <li key={m.id}><span className={`rs-dot rs-dot-${i}`} aria-hidden="true" />{m.label}</li>)}
        <li><span className="rs-whisker-key" aria-hidden="true" />95% interval</li>
      </ul>
      <div className="rs-scroll">
        <table className="rs-table rs-subjects">
          <caption className="sr-only">Lessons with a working part and parts published, by subject and model. Pre-registered evaluation.</caption>
          <thead>
            <tr>
              <th scope="col">Subject</th>
              {models.map((m) => <th key={m.id} scope="col" className="rs-n">{m.label.replace(/^Muse /, '')} lessons</th>)}
              <th scope="col" className="rs-plot-head">
                <span className="sr-only">Plot of the lesson rates</span>
                <span className="rs-axis" aria-hidden="true">
                  {PLOT_TICKS.map((t) => <span key={t} style={{ left: `${plotPosition(t)}%` }}>{pct(t)}</span>)}
                </span>
              </th>
              {models.map((m) => <th key={m.id} scope="col" className="rs-n">{m.label.replace(/^Muse /, '')} parts</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <th scope="row">{r.label}</th>
                {r.byModel.map((c) => (
                  <td key={c.model} className="rs-n"><span className="rs-rate">{pct(c.lessons.rate)}</span> <span className="rs-kn">{c.lessons.k}/{c.lessons.n}</span></td>
                ))}
                <td className="rs-plot-cell" aria-hidden="true">
                  <span className="rs-plot">
                    {PLOT_TICKS.map((t) => <span key={t} className="rs-grid" style={{ left: `${plotPosition(t)}%` }} />)}
                    {r.byModel.map((c, i) => {
                      const x = plotPosition(c.lessons.rate);
                      const lo = plotPosition(c.lessons.ci95[0]);
                      const hi = plotPosition(c.lessons.ci95[1]);
                      if (x === null || lo === null || hi === null) return null;
                      return (
                        <span key={c.model} className={`rs-mark rs-mark-${i}`} title={`${c.modelLabel}: ${rateText(c.lessons)}, 95% interval ${ciText(c.lessons)}`}>
                          <span className="rs-whisker" style={{ left: `${lo}%`, width: `${hi - lo}%` }} />
                          <span className={`rs-dot rs-dot-${i}`} style={{ left: `${x}%` }} />
                        </span>
                      );
                    })}
                  </span>
                </td>
                {r.byModel.map((c) => (
                  <td key={c.model} className="rs-n rs-parts">{pct(c.parts.rate)} <span className="rs-kn">{c.parts.k}/{c.parts.n}</span></td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="rs-prose rs-quiet">The plot’s axis starts at 40%; every subject’s interval lies above it. “Parts” is parts published of those planned.</p>
      <Sources refs={ev.sources.filter((s) => s.path.endsWith('summary.json'))} />
    </section>
  );
}

function Retest({ id }: { id: string }) {
  const t = DATA.timeoutRetest;
  const rows: { label: string; before: string; after: string }[] = [
    { label: 'Builds that gave a lesson', before: `${t.before.lessons} of ${t.before.jobs}`, after: `${t.after.lessons} of ${t.after.jobs}` },
    { label: 'Builds that ran out of time', before: String(t.before.timeouts), after: String(t.after.timeouts) },
    { label: 'Parts published', before: `${t.before.partsPublished} of ${t.before.partsPlanned} planned`, after: `${t.after.partsPublished} of ${t.after.partsPlanned} planned` },
    { label: 'Median time', before: seconds(t.before.wallP50S), after: seconds(t.after.wallP50S) },
    { label: 'Longest build', before: seconds(t.before.wallMaxS), after: seconds(t.after.wallMaxS) },
    { label: 'Cost', before: usd(t.before.costUSD), after: usd(t.after.costUSD) },
  ];
  return (
    <section className="rs-section" aria-labelledby={id} id={sectionId('retest')}>
      <h2 id={id} tabIndex={-1}>Spark Open’s timeouts, run again</h2>
      <p className="rs-prose">
        A later run, <strong>not part of the pre-registered evaluation</strong>; the numbers above are unchanged. The{' '}
        {t.pages} pages where Muse Spark Open ran out of time were built twice more on <Day iso={t.date} />.
      </p>
      <div className="rs-scroll">
        <table className="rs-table rs-retest">
          <caption className="sr-only">Muse Spark Open on the {t.pages} pages that timed out: evaluation against retest</caption>
          <thead>
            <tr>
              <th scope="col"><span className="sr-only">Measure</span></th>
              <th scope="col" className="rs-n">In the evaluation</th>
              <th scope="col" className="rs-n">Retest</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}><th scope="row">{r.label}</th><td className="rs-n">{r.before}</td><td className="rs-n">{r.after}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="rs-prose">
        What it shows: no call in the retest took longer than {t.slowestCallS} s, so the longer call limit added in between was
        never needed. The pages themselves do not defeat Spark Open; the evaluation’s timeouts were slow moments on the
        shared endpoint.
      </p>
      <Sources refs={t.sources} />
    </section>
  );
}

function Diagrams({ jobs, onOpenLesson, id }: ResultsPageProps & { id: string }) {
  const d = DATA.diagramRuns;
  const summary = diagramSummary(d.runs);
  return (
    <section className="rs-section" aria-labelledby={id} id={DIAGRAMS_ID}>
      <h2 id={id} tabIndex={-1}>Diagram lessons today</h2>
      <p className="rs-prose">
        Later live builds of Label the diagram on the two demo figures, after the evaluation and not part of it. Muse locates
        each part on the figure and SAM 3.1, Meta’s segmentation model, confirms it. A fix went in between rounds, so read the
        rounds as a log of that work, not as a pass rate.
      </p>
      <ul className="rs-diagram-summary">
        {summary.map((s) => (
          <li key={s.model}>
            <strong>{s.modelLabel}:</strong> the diagram published in {s.published} of {s.runs} runs
            {s.latestAllPublished ? `, including the latest run of ${s.figures === 2 ? 'both figures' : `all ${s.figures} figures`}` : ''}.
          </li>
        ))}
      </ul>
      <div className="rs-scroll">
        <table className="rs-table rs-diagrams">
          <caption className="sr-only">Label the diagram live runs, newest first</caption>
          <thead>
            <tr>
              <th scope="col">Run</th>
              <th scope="col">Page</th>
              <th scope="col">Model</th>
              <th scope="col">Diagram</th>
              <th scope="col" className="rs-n">Parts</th>
              <th scope="col">SAM 3.1 sure</th>
              <th scope="col" className="rs-n">Time</th>
              <th scope="col" className="rs-n">Cost</th>
              <th scope="col"><span className="sr-only">Lesson</span></th>
            </tr>
          </thead>
          <tbody>
            {d.runs.map((r) => {
              const link = lessonLink(r.jobId, jobs);
              return (
                <tr key={r.jobId}>
                  <td className="rs-run">{dateText(r.date)}<span className="rs-hint">Stage {r.stage}, round {r.round}</span></td>
                  <td>{r.page}{r.note !== null && <span className="rs-hint rs-note">{r.note.text}</span>}</td>
                  <td className="rs-nowrap">{r.modelLabel.replace(/^Muse /, '')}</td>
                  <td><span className={`rs-verdict rs-verdict-${r.labelDiagram}`}>{r.labelDiagram === 'published' ? 'Published' : 'Held back'}</span></td>
                  <td className="rs-n">{r.published} of {r.planned}</td>
                  <td>
                    {r.sam === null ? <span className="rs-quiet">not in the notes</span> : (
                      <span title={`${r.sam.scope}; ${r.sam.source.path}`}>{r.sam.min.toFixed(2)}–{r.sam.max.toFixed(2)}<span className="rs-hint">{r.sam.scope}</span></span>
                    )}
                  </td>
                  <td className="rs-n">{seconds(r.wallS)}</td>
                  <td className="rs-n">{usd(r.costUSD)}</td>
                  <td className="rs-action">
                    {link === 'missing'
                      ? <span className="rs-quiet">Not stored here</span>
                      : <button type="button" className="link-btn" onClick={() => onOpenLesson(r.jobId, r.sourceId)} aria-label={`Open the lesson: ${r.page}, ${r.modelLabel}, ${dateText(r.date)} round ${r.round}`}>Open lesson</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="rs-prose rs-quiet">
        “Parts” counts the whole lesson (the diagram plus one other part). SAM confidence is shown where a committed note
        records it; the other runs’ values sit in their run folders, which are not in the repository.
      </p>
      <Sources refs={d.sources} />
    </section>
  );
}

function Method({ id }: { id: string }) {
  const ev = DATA.evaluation;
  const [spark, open] = ev.models;
  const all = [...ev.sources, ...DATA.timeoutRetest.sources, ...DATA.diagramRuns.sources];
  return (
    <section className="rs-section rs-method" aria-labelledby={id} id={sectionId('method')}>
      <h2 id={id} tabIndex={-1}>How these numbers were made</h2>
      <ul className="rs-method-list">
        <li>
          <strong>Pre-registered.</strong> The pages, models and measures were committed on <Day iso={ev.preRegisteredAt} />{' '}
          before the first build, and not edited afterwards.
        </li>
        <li>
          <strong>{ev.pages} pages × {ev.runsPerPage} runs × {ev.models.length} models.</strong> Every active library page
          ({ev.subjects} subjects), {ev.jobsPerModel * ev.models.length} builds in all, prompt version {ev.promptVersion}, at most{' '}
          {ev.maxRepairAttempts} repairs per part. Nothing was dropped: a build that crashed counts as a failure.
        </li>
        {spark !== undefined && open !== undefined && (
          <li>
            <strong>Models.</strong> {spark.label} through the {spark.route}; {open.label} as open weights on Modal
            {open.providerModel !== null && <> (<code>{open.providerModel}</code>)</>}. Only {spark.label} received the
            library figures, by design.
          </li>
        )}
        <li>
          <strong>What counts.</strong> A lesson counts when the build finished with at least one interactive part beyond the
          summary. Intervals are Wilson 95% intervals.
        </li>
        <li>
          <strong>Not claimed.</strong> The pages were chosen by the project, so the results describe this library, not any
          page on the web. A part passing its checks means it matches its page, not that a teacher has reviewed it.
        </li>
        <li>
          <strong>Later runs</strong> (the timeout retest and the diagram rounds) are shown in their own sections and never
          mixed into the evaluation’s numbers.
        </li>
        <li>
          <strong>Where the data lives.</strong> <code>scripts/build-results.ts</code> builds this page’s data from the
          committed files below (report written <Day iso={ev.reportGeneratedAt} />); a test checks it against the report.
        </li>
      </ul>
      <div className="rs-scroll">
        <table className="rs-table rs-files">
          <caption className="sr-only">Committed files behind this page</caption>
          <thead><tr><th scope="col">File</th><th scope="col">Date</th><th scope="col">What it holds</th></tr></thead>
          <tbody>
            {all.map((s) => (
              <tr key={s.path}><td><code>{s.path}</code></td><td><Day iso={s.date} /></td><td>{s.what}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** A short index of the page's seven sections: the page is long, so a judge can jump to the one they want. */
function SectionIndex() {
  // Container-scoped scroll (lib/scroll.ts): a plain #anchor jump would also scroll the window shell out of view.
  const go = (key: string): void => {
    const el = document.getElementById(sectionId(key));
    revealInPanels(el, 'start');
    el?.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
  };
  return (
    <nav className="rs-index" aria-label="On this page">
      <span className="rs-index-label">On this page</span>
      <ul>
        {RESULTS_SECTIONS.map((s) => (
          <li key={s.key}><button type="button" className="rs-index-btn" onClick={() => go(s.key)}>{s.label}</button></li>
        ))}
      </ul>
    </nav>
  );
}

export function ResultsPage({ jobs, onOpenLesson }: ResultsPageProps) {
  const uid = useId();
  const models = DATA.evaluation.models;
  return (
    <div className="page page-results" data-testid="results-page">
      <header className="page-head">
        <h1 className="page-title" tabIndex={-1} data-view-title>Results</h1>
        <p className="page-lede">
          How often each model turned a library page into a lesson a class can use, and which kinds of interactive part got
          through the checks. Every number comes from committed evaluation files, named under each section.
        </p>
      </header>
      <SectionIndex />
      <Headline models={models} id={`${uid}-headline`} />
      <Comparison models={models} id={`${uid}-compare`} />
      <Funnel models={models} id={`${uid}-funnel`} />
      <Subjects models={models} id={`${uid}-subjects`} />
      <Retest id={`${uid}-retest`} />
      <Diagrams jobs={jobs} onOpenLesson={onOpenLesson} id={`${uid}-diagrams`} />
      <Method id={`${uid}-method`} />
    </div>
  );
}
