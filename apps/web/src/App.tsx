import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, describeError } from './api.ts';
import { useHealth, useJobDetail, useJobs, useModels, useSourceDoc, useSources } from './hooks.ts';
import { buildHighlights } from './lib/highlight.ts';
import { collectQuoteRefs } from './lib/evidence.ts';
import { newestFirst, pickDefaultJob, pickOpeningJob, requestedJobId } from './lib/jobs.ts';
import type { OpeningJob } from './lib/jobs.ts';
import { generateState, isServerBusy } from './lib/health.ts';
import { madeWithPhrase, modelToSend, pickModel, readStoredModel, resolveJobModel, writeStoredModel } from './lib/models.ts';
import type { ModelId } from './lib/models.ts';
import { analysisCheckName, analysisRepairOverall, buildAnalysisRepairSteps } from './lib/analysisRepairs.ts';
import { buildLessonRepairs, buildLessonStream, lessonAnalysisOverall, lessonAnalysisSteps, lessonCheckSections, lessonRenderMode } from './lib/lessonJob.ts';
import type { FlowId } from './lib/lessonJob.ts';
import { collectLessonQuotes } from './lib/lesson.ts';
import { checkName } from './lib/checks.ts';
import { defaultRevision, overallRepairBadge, revisionInputs, validationHeading } from './lib/repairs.ts';
import { timelineEventLabels } from './lib/timeline.ts';
import { demoFaultToSend, disclosureText } from './lib/sources.ts';
import { subjectNote } from './lib/subjects.ts';
import type { Subject } from '../../../packages/contracts/kit.ts';
import type { DemoChoice } from './lib/sources.ts';
import { activityRepairCounts, checkTally, lessonRepairCounts, quoteTally, repairPhrases, sectionTally } from './lib/provenance.ts';
import { readStoredTech, writeStoredTech } from './lib/techDetails.ts';
import { readSourceOpen, writeSourceOpen } from './lib/lessonLayout.ts';
import { revealInPanels, scrollPanelToTop } from './lib/scroll.ts';
import { deckFromActivity, deckFromLesson, exitSearch, presentRequest } from './lib/presentation.ts';
import type { Deck } from './lib/presentation.ts';
import { ApiStatus } from './components/ApiStatus.tsx';
import { AppWindow } from './components/AppWindow.tsx';
import { IconRail } from './components/IconRail.tsx';
import { SourcePanel, SourceTab } from './components/SourcePanel.tsx';
import type { Flash } from './components/SourcePanel.tsx';
import { NewLessonSection, RunsSection, StepsSection } from './components/PipelinePanel.tsx';
import { RunsDrawer } from './components/RunsDrawer.tsx';
import type { DrawerMode } from './components/RunsDrawer.tsx';
import type { RunScope } from './components/PipelinePanel.tsx';
import { ActivityPanel } from './components/ActivityPanel.tsx';
import { JobOutcome } from './components/JobOutcome.tsx';
import { AnalysisRepairTimeline } from './components/AnalysisRepairTimeline.tsx';
import { RepairTimeline } from './components/RepairTimeline.tsx';
import { ValidationPanel } from './components/ValidationPanel.tsx';
import { LessonView } from './components/LessonView.tsx';
import { ComponentRepairTimeline } from './components/ComponentRepairTimeline.tsx';
import { LessonChecksPanel } from './components/LessonChecksPanel.tsx';
import { Provenance } from './components/Provenance.tsx';
import type { ProvenanceReceipt } from './components/Provenance.tsx';
import { PresentationMode } from './components/presentation/PresentationMode.tsx';
import { IconPresent } from './components/presentation/icons.tsx';
import type { SourceRef } from '../../../packages/contracts/index.ts';

const NO_JOBS: never[] = [];

/** The model choice lasts for the browser session (a reload keeps it); blocked storage just means it lasts for the page. */
function sessionStore(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.sessionStorage; } catch { return null; }
}

/** Kept across visits (like the colour theme); blocked storage just means it lasts for the page. */
function localStore(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; }
}

/** `?present=<id>[&beat=N]` opens that stored run straight into presentation mode (Stage 7c). */
const PRESENT_REQUEST = typeof window === 'undefined' ? null : presentRequest(window.location.search);
/** `?job=<id>` opens that stored run instead of the most recent lesson. */
const LINKED_JOB = typeof window === 'undefined' ? null : requestedJobId(window.location.search) ?? PRESENT_REQUEST?.jobId ?? null;

export function App() {
  const { health, down, refresh: refreshHealth } = useHealth();
  const { sources, reload: reloadSources } = useSources();
  const serverBusy = isServerBusy(health);
  const { jobs, refresh: refreshJobs } = useJobs(serverBusy);

  const [pickedSource, setPickedSource] = useState<string | null>(null);
  const [pickedJob, setPickedJob] = useState<{ jobId: string; sourceId: string } | null>(null);
  const [pickedRevision, setPickedRevision] = useState<{ jobId: string; revision: number } | null>(null);
  const [liveJobIds, setLiveJobIds] = useState<ReadonlySet<string>>(() => new Set());
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [demoChoice, setDemoChoice] = useState<DemoChoice>('none');
  const [flash, setFlash] = useState<Flash | null>(null);
  const [flow, setFlow] = useState<FlowId>('lesson');
  // Stage 7b: one subject filter for the page pickers and the runs list; the runs list shows this page or all pages.
  const [subjectFilter, setSubjectFilter] = useState<Subject | null>(null);
  const [runScope, setRunScope] = useState<RunScope>('page');
  const models = useModels(health);
  const [wantedModel, setWantedModel] = useState<ModelId | null>(() => readStoredModel(sessionStore()));
  const modelChoice = pickModel(models, wantedModel);

  // Window layout: the lesson and its source page fill the window; runs, steps and checks open in a drawer from the rail.
  // The source page collapses to a slim tab; the choice is kept across visits (lib/lessonLayout.ts).
  const [showSource, setShowSource] = useState(() => readSourceOpen(localStore()));
  useEffect(() => { writeSourceOpen(localStore(), showSource); }, [showSource]);
  const [drawer, setDrawer] = useState<DrawerMode | null>(null);
  const [tech, setTech] = useState(() => readStoredTech(localStore()));
  // Stage 7c: presentation mode for the open lesson (entered from the lesson header, the rail, or a ?present= link).
  const [presenting, setPresenting] = useState<{ jobId: string; beat: number } | null>(PRESENT_REQUEST);
  const onTech = useCallback((on: boolean) => { setTech(on); writeStoredTech(localStore(), on); }, []);

  // Stage 7: the app opens on a chosen lesson — a ?job= link, else the most recent succeeded lesson-flow run — and
  // else on the New lesson view; never on whatever old run belongs to the first source in the list. Decided once,
  // when the runs list first arrives, so a run finishing later never pulls the view away.
  const [opening, setOpening] = useState<OpeningJob | null | undefined>(undefined);
  if (opening === undefined && jobs.state !== 'loading') {
    const first = jobs.state === 'ready' ? pickOpeningJob(jobs.data, LINKED_JOB) : null;
    setOpening(first);
    if (first === null && jobs.state === 'ready') setDrawer('new');
  }

  const sourceList = sources.state === 'ready' ? sources.data : null;
  const openingSourceId = opening !== null && opening !== undefined && sourceList?.some((s) => s.id === opening.sourceId) === true ? opening.sourceId : null;
  const selectedSourceId = pickedSource ?? openingSourceId ?? (opening === undefined ? null : sourceList?.[0]?.id ?? null);
  const selectedSource = sourceList?.find((s) => s.id === selectedSourceId) ?? null;

  const allJobs = jobs.state === 'ready' ? jobs.data : NO_JOBS;
  const allJobsNewest = useMemo(() => newestFirst(allJobs), [allJobs]);
  const sourcesById = useMemo(() => new Map((sourceList ?? []).map((s) => [s.id, s] as const)), [sourceList]);
  const jobsForSource = useMemo(
    () => newestFirst(allJobs.filter((j) => j.sourceId === selectedSourceId)),
    [allJobs, selectedSourceId],
  );
  const generate = generateState({ health, down, generating, hasSource: selectedSource !== null });

  const selectedJobId = pickedJob !== null && pickedJob.sourceId === selectedSourceId
    ? pickedJob.jobId
    : pickedSource === null && openingSourceId !== null && opening !== null && opening !== undefined
      ? opening.jobId
      : pickDefaultJob(jobsForSource, generate.busy)?.jobId ?? null;
  const detail = useJobDetail(selectedJobId);
  const ready = detail?.state === 'ready' && detail.data.summary.sourceId === selectedSourceId ? detail.data : null;

  const doc = useSourceDoc(selectedSourceId);
  // Stage 6: a lesson job streams in; `stream` says what is ready now (overview, which components, which are placeholders).
  const lessonMode = useMemo(() => (ready === null ? 'v1' : lessonRenderMode(ready)), [ready]);
  const stream = useMemo(() => (ready === null || ready.lessonData === undefined ? null : buildLessonStream(ready)), [ready]);
  const quotes = useMemo(() => {
    if (selectedSourceId === null) return [];
    const v1 = collectQuoteRefs(selectedSourceId, ready?.spec, ready?.analysis?.analysis);
    if (ready === null || ready.lessonData === undefined || stream === null) return v1;
    return [...collectLessonQuotes(selectedSourceId, stream.overview, ready.lessonData.kitSpecs), ...v1];
  }, [selectedSourceId, ready, stream]);
  const sourceText = doc?.state === 'ready' ? doc.data.text : null;
  const highlights = useMemo(
    () => (sourceText === null ? null : buildHighlights(sourceText, quotes.map((q) => ({ key: q.key, quote: q.quote })))),
    [sourceText, quotes],
  );
  const located = useMemo(() => new Set(Object.keys(highlights?.ranges ?? {})), [highlights]);

  const mainRef = useRef<HTMLElement>(null);
  // A citation highlights its quote in the source text, so it brings the source panel back if it was hidden.
  const onCite = useCallback((key: string) => { setShowSource(true); setFlash((f) => ({ key, n: (f?.n ?? 0) + 1 })); }, []);
  const onLesson = useCallback(() => {
    const main = mainRef.current;
    if (main === null) return;
    scrollPanelToTop(main);
    // In the stacked (narrow) layout the workspace scrolls, not the lesson column.
    revealInPanels(main, 'start', 0);
    main.focus({ preventScroll: true });
  }, []);
  const openDrawer = useCallback((mode: DrawerMode) => setDrawer(mode), []);
  const closeDrawer = useCallback(() => setDrawer(null), []);

  const onGenerate = useCallback(() => {
    if (selectedSourceId === null) return;
    const sourceId = selectedSourceId;
    setGenerating(true);
    setGenerateError(null);
    api.createJob(sourceId, demoFaultToSend(demoChoice), modelToSend(models, modelChoice), flow).then(
      ({ jobId }) => {
        setLiveJobIds((prev) => new Set(prev).add(jobId));
        setPickedJob({ jobId, sourceId });
        refreshJobs();
        // Watch the new run's steps advance.
        setDrawer('runs');
      },
      (e: unknown) => setGenerateError(describeError(e)),
    ).finally(() => {
      // Keep the button locked until /api/health has been re-read, so it never flickers enabled.
      void refreshHealth().finally(() => setGenerating(false));
    });
  }, [selectedSourceId, demoChoice, models, modelChoice, flow, refreshJobs, refreshHealth]);
  const onModelChoice = useCallback((id: ModelId) => { setWantedModel(id); writeStoredModel(sessionStore(), id); }, []);

  const onSelectSource = useCallback((id: string) => { setPickedSource(id); setFlash(null); }, []);
  const onSourceCreated = useCallback((id: string) => { reloadSources(); setPickedSource(id); setFlash(null); }, [reloadSources]);
  // A run picked from the "All pages" list opens its own page too.
  const onSelectJob = useCallback((jobId: string, sourceId: string) => {
    if (sourceId !== selectedSourceId) { setPickedSource(sourceId); setFlash(null); }
    setPickedJob({ jobId, sourceId });
  }, [selectedSourceId]);

  const spec = ready?.spec;
  const jobModel = useMemo(() => (ready === null ? null : resolveJobModel(ready.summary)), [ready]);
  const analysisReport = ready?.analysis?.report ?? null;

  // Revisions (Stage 5): the validation panel shows the published (else best) revision unless the user picks another.
  const revisions = useMemo(() => (ready === null ? [] : revisionInputs(ready)), [ready]);
  const defaultRev = ready === null ? null : defaultRevision(revisions, ready.summary);
  const viewRev = pickedRevision !== null && pickedRevision.jobId === selectedJobId && revisions.some((r) => r.revision === pickedRevision.revision)
    ? pickedRevision.revision
    : defaultRev;
  const report = revisions.find((r) => r.revision === viewRev)?.report ?? ready?.report ?? null;
  const onViewRevision = useCallback((revision: number) => {
    if (selectedJobId !== null) setPickedRevision({ jobId: selectedJobId, revision });
  }, [selectedJobId]);
  const repairBadge = ready === null ? null : overallRepairBadge(ready.summary);
  // A timeline's demo fault names events by id; the first draft's labels let the panel describe it in words.
  const eventLabels = useMemo(
    () => timelineEventLabels(ready?.revisions?.find((r) => r.revision === 1)?.spec ?? ready?.spec),
    [ready],
  );

  // Analysis repairs (TASK-024c): Muse repairing its own first analysis, shown before the spec repairs.
  const analysisSteps = useMemo(() => {
    if (ready === null) return [];
    if (ready.lessonData !== undefined) return lessonAnalysisSteps(ready);
    return buildAnalysisRepairSteps({ revisions: ready.analysisRevisions ?? [], analysisRepairs: ready.summary.analysisRepairs, events: ready.events });
  }, [ready]);
  const analysisOverall = ready?.lessonData !== undefined
    ? lessonAnalysisOverall(analysisSteps)
    : analysisRepairOverall({ analysisRepairs: ready?.summary.analysisRepairs, events: ready?.events });
  // Lesson jobs: component repairs (natural vs system-made) and the quiet checks list.
  const componentRepairs = useMemo(() => (ready === null ? [] : buildLessonRepairs(ready)), [ready]);
  const checkSections = useMemo(() => (ready === null || ready.lessonData === undefined ? [] : lessonCheckSections(ready)), [ready]);
  const lessonSources = useMemo((): SourceRef[] => (selectedSource === null ? [] : [{
    id: selectedSource.id, title: selectedSource.title, locator: selectedSource.locator, license: selectedSource.license,
    attribution: selectedSource.attribution, sha256: selectedSource.sha256,
  }]), [selectedSource]);

  // The one provenance line under the lesson title: who wrote it (and on which model), the publisher disclosure, that code
  // checked it, that it needs teacher review, and which repairs happened (natural vs system-made), with a way to the details.
  const disclosure = disclosureText(selectedSource, jobModel === null ? undefined : madeWithPhrase(jobModel));
  const repairCounts = ready === null
    ? null
    : ready.lessonData !== undefined
      ? lessonRepairCounts(componentRepairs, analysisOverall.state)
      : activityRepairCounts({
        analysis: analysisOverall.state,
        repaired: repairBadge === null ? null : repairBadge.tone === 'fault' ? 'system' : 'natural',
        demoFault: ready.summary.demoFault !== undefined,
      });
  // The trust receipt: counts from the stored run (checks of the published result), the page text beside the lesson
  // (quotes found) and the job's recorded cost. It opens the same check list as the drawer. Not shown while running.
  const publishedReport = revisions.find((r) => r.revision === defaultRev)?.report ?? ready?.report ?? null;
  const receipt = useMemo((): ProvenanceReceipt | null => {
    if (ready === null || ready.summary.status === 'running') return null;
    const lesson = ready.lessonData !== undefined;
    const checks = lesson ? sectionTally(checkSections) : checkTally(publishedReport);
    if (checks === null) return null;
    return {
      input: {
        checks,
        quotes: quoteTally(quotes, highlights === null ? null : located),
        costUSD: ready.summary.totalCostUSD,
        reservedUSD: ready.summary.reservedUnknownUSD,
      },
      checks: lesson
        ? <LessonChecksPanel sections={checkSections} />
        : publishedReport !== null && <ValidationPanel report={publishedReport} heading={validationHeading(defaultRev, revisions.length, ready.summary.publishedRevision)} showPublish={false} compact />,
    };
  }, [ready, checkSections, publishedReport, quotes, highlights, located, defaultRev, revisions.length]);
  // Presentation mode: a finished lesson (or classic activity) as a deck of beats. Never a running, failed or declined run.
  const deck = useMemo((): Deck | null => {
    if (ready === null || ready.summary.status !== 'succeeded') return null;
    const common = {
      jobId: ready.summary.jobId, source: selectedSource, disclosure,
      checks: receipt?.input.checks ?? null, quotes: receipt?.input.quotes ?? null,
    };
    if (lessonMode === 'lesson' && stream !== null && ready.lessonData !== undefined) {
      if (ready.lessonData.analysis !== null && !ready.lessonData.analysis.usable) return null;
      if (stream.pending.length > 0) return null;
      const d = deckFromLesson({
        ...common, lesson: stream.lesson, specs: ready.lessonData.kitSpecs, premium: spec ?? null,
        analysis: ready.lessonData.analysis, fallbackTitle: selectedSource?.title ?? 'Lesson',
      });
      return d.overview === null && d.parts.length === 0 ? null : d;
    }
    if (lessonMode === 'v1' && spec !== undefined) return deckFromActivity({ ...common, spec });
    return null;
  }, [ready, selectedSource, disclosure, receipt, lessonMode, stream, spec]);
  // A ?present= link to a run that cannot be presented (or another lesson opened meanwhile) just shows the workspace.
  if (presenting !== null && ready !== null && (ready.summary.jobId !== presenting.jobId || (deck === null && ready.summary.status !== 'running'))) {
    setPresenting(null);
  }
  const onPresent = useCallback(() => {
    if (deck !== null) setPresenting({ jobId: deck.jobId, beat: 0 });
  }, [deck]);
  const onExitPresent = useCallback(() => {
    setPresenting((p) => {
      if (p !== null) window.history.replaceState(window.history.state, '', `${window.location.pathname}${exitSearch(window.location.search, p.jobId)}${window.location.hash}`);
      return null;
    });
  }, []);
  const presentButton = deck === null ? null : (
    <button type="button" className="btn present-launch" onClick={onPresent} title="Present this lesson full screen, one step at a time">
      <IconPresent size={18} />Present
    </button>
  );

  const provenanceLine = (
    <Provenance
      disclosure={disclosure}
      phrases={repairCounts === null ? [] : repairPhrases(repairCounts)}
      onDetails={ready === null ? undefined : () => openDrawer('runs')}
      receipt={receipt}
      subject={subjectNote(selectedSource)}
    />
  );
  const provenance = presentButton === null ? provenanceLine : <>{presentButton}{provenanceLine}</>;

  return (
    <AppWindow title="Make knowledge interactive" titleIsHeading titlebarExtra={<ApiStatus health={health} down={down} />}>
      <div className={`window-body${drawer !== null ? ' drawer-open' : ''}`}>
        <IconRail
          showSource={showSource}
          drawer={drawer}
          onNewLesson={() => (drawer === 'new' ? closeDrawer() : openDrawer('new'))}
          onLesson={onLesson}
          onToggleSource={() => setShowSource((v) => !v)}
          onRuns={() => (drawer === 'runs' ? closeDrawer() : openDrawer('runs'))}
          busy={generate.busy}
          onPresent={onPresent}
          canPresent={deck !== null}
        />
        <div className={`workspace${showSource ? '' : ' hide-source'}`}>
          {showSource ? (
            <SourcePanel
              sources={sources}
              selectedId={selectedSourceId}
              onSelect={onSelectSource}
              onReload={reloadSources}
              doc={doc}
              highlights={highlights}
              quotes={quotes}
              flash={flash}
              onCite={onCite}
              onCollapse={() => setShowSource(false)}
            />
          ) : (
            <SourceTab
              onExpand={() => setShowSource(true)}
              found={receipt?.input.quotes?.found ?? null}
              total={receipt?.input.quotes?.total ?? 0}
            />
          )}

          <main className="panel activity-panel" aria-label="Lesson" ref={mainRef} tabIndex={-1}>
            <div className="main-inner">
              {jobs.state === 'error' && <div className="callout callout-error" role="alert">{jobs.message}</div>}
              {selectedJobId === null && jobs.state === 'ready' && (
                <div className="empty">
                  <h2>No lesson for this page yet</h2>
                  <p className="muted">
                    {health !== null && !health.live
                      ? 'Live generation is off on this server and nothing is stored for this page. Pick another page.'
                      : 'Muse Spark reads the page, writes a short overview with the page’s own words, then builds a few interactive parts. Code checks every quote and number.'}
                  </p>
                  {(health === null || health.live) && (
                    <button type="button" className="btn btn-primary" onClick={() => openDrawer('new')}>New lesson</button>
                  )}
                </div>
              )}
              {selectedJobId === null && jobs.state === 'loading' && <p className="muted">Loading…</p>}
              {detail?.state === 'loading' && <p className="muted">Loading the lesson…</p>}
              {detail?.state === 'error' && <div className="callout callout-error" role="alert">{detail.message}</div>}
              {ready !== null && lessonMode === 'v1' && spec !== undefined && ready.summary.status === 'succeeded' && (
                <ActivityPanel
                  key={spec.id}
                  spec={spec}
                  cite={{ sourceId: ready.summary.sourceId, located, onCite }}
                  disclosure={disclosure}
                  repairBadge={repairBadge}
                  provenance={provenance}
                />
              )}
              {ready !== null && stream !== null && lessonMode === 'lesson' && (
                <LessonView
                  key={ready.summary.jobId}
                  lesson={stream.lesson}
                  specs={ready.lessonData?.kitSpecs ?? {}}
                  analysis={ready.lessonData?.analysis ?? null}
                  sources={lessonSources}
                  cite={{ sourceId: ready.summary.sourceId, located, onCite }}
                  disclosure={disclosure}
                  provenance={provenance}
                  fallbackTitle={selectedSource?.title ?? 'Lesson'}
                  premium={spec ?? null}
                  repairBadge={repairBadge}
                  pending={stream.pending}
                  order={stream.order}
                />
              )}
              {ready !== null && ((lessonMode === 'v1' && (spec === undefined || ready.summary.status !== 'succeeded')) || lessonMode === 'working' || lessonMode === 'outcome') && (
                <JobOutcome detail={ready} serverBusy={health === null ? null : generate.busy} />
              )}
            </div>
          </main>
        </div>

        {drawer !== null && (
          <RunsDrawer mode={drawer} onClose={closeDrawer} tech={tech} onTech={onTech}>
            {drawer === 'new' && (
              <NewLessonSection
                sources={sources}
                selectedId={selectedSourceId}
                onSelect={onSelectSource}
                onCreated={onSourceCreated}
                teacherSource={selectedSource?.kind === 'user'}
                generate={generate}
                onGenerate={onGenerate}
                demoChoice={demoChoice}
                onDemoChoice={setDemoChoice}
                generateError={generateError}
                models={models}
                modelChoice={modelChoice}
                onModelChoice={onModelChoice}
                live={health === null ? null : health.live}
                flow={flow}
                onFlow={setFlow}
                subjectFilter={subjectFilter}
                onSubjectFilter={setSubjectFilter}
              />
            )}
            {drawer === 'runs' && (
              <>
                <RunsSection
                  jobs={jobs}
                  jobsForSource={jobsForSource}
                  allJobs={allJobsNewest}
                  sourcesById={sourcesById}
                  scope={runScope}
                  onScope={setRunScope}
                  subjectFilter={subjectFilter}
                  onSubjectFilter={setSubjectFilter}
                  serverBusy={health === null ? null : generate.busy}
                  selectedJobId={selectedJobId}
                  onSelectJob={onSelectJob}
                  liveJobIds={liveJobIds}
                  canGenerate={!generate.liveOff}
                  onNewLesson={() => openDrawer('new')}
                />
                <StepsSection detail={detail} />
                {ready !== null && jobModel !== null && <AnalysisRepairTimeline steps={analysisSteps} overall={analysisOverall} model={jobModel} />}
                {ready !== null && jobModel !== null && (
                  <RepairTimeline
                    model={jobModel}
                    revisions={revisions}
                    repairs={ready.summary.repairs}
                    demoFault={ready.summary.demoFault}
                    events={ready.events}
                    publishedRevision={ready.summary.publishedRevision}
                    bestRevision={ready.summary.bestRevision}
                    viewing={viewRev}
                    eventLabels={eventLabels}
                    onView={onViewRevision}
                  />
                )}
                {ready !== null && jobModel !== null && <ComponentRepairTimeline cards={componentRepairs} model={jobModel} />}
                <div id="drawer-checks" className="drawer-checks">
                  {ready !== null && ready.lessonData !== undefined && <LessonChecksPanel sections={checkSections} />}
                  {report !== null && (
                    <ValidationPanel
                      report={report}
                      heading={validationHeading(viewRev, revisions.length, ready?.summary.publishedRevision)}
                      showPublish={spec !== undefined && viewRev === defaultRev}
                    />
                  )}
                  {report === null && analysisReport !== null && (
                    <ValidationPanel
                      report={analysisReport}
                      heading={analysisOverall.state === 'passed' ? 'Source analysis checks (after repair)' : 'Source analysis checks'}
                      showPublish={false}
                      nameOf={(id) => analysisCheckName(id) ?? checkName(id)}
                    />
                  )}
                </div>
              </>
            )}
          </RunsDrawer>
        )}
      </div>
      {presenting !== null && deck !== null && deck.jobId === presenting.jobId && (
        <PresentationMode
          key={deck.jobId}
          deck={deck}
          quotes={quotes}
          sourceId={ready?.summary.sourceId ?? ''}
          repairBadge={repairBadge}
          startBeat={presenting.beat}
          onExit={onExitPresent}
        />
      )}
    </AppWindow>
  );
}
