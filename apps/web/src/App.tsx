import { useCallback, useMemo, useRef, useState } from 'react';
import { api, describeError } from './api.ts';
import { useHealth, useJobDetail, useJobs, useModels, useSourceDoc, useSources } from './hooks.ts';
import { buildHighlights } from './lib/highlight.ts';
import { collectQuoteRefs } from './lib/evidence.ts';
import { newestFirst, pickDefaultJob } from './lib/jobs.ts';
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
import type { DemoChoice } from './lib/sources.ts';
import { activityRepairCounts, lessonRepairCounts, repairPhrases } from './lib/provenance.ts';
import { revealInPanels, scrollPanelToTop } from './lib/scroll.ts';
import { ApiStatus } from './components/ApiStatus.tsx';
import { AppWindow } from './components/AppWindow.tsx';
import { IconRail } from './components/IconRail.tsx';
import { SourcePanel } from './components/SourcePanel.tsx';
import type { Flash } from './components/SourcePanel.tsx';
import { NewLessonSection, RunsSection, StepsSection } from './components/PipelinePanel.tsx';
import { RunsDrawer } from './components/RunsDrawer.tsx';
import type { DrawerMode } from './components/RunsDrawer.tsx';
import { ActivityPanel } from './components/ActivityPanel.tsx';
import { JobOutcome } from './components/JobOutcome.tsx';
import { AnalysisRepairTimeline } from './components/AnalysisRepairTimeline.tsx';
import { RepairTimeline } from './components/RepairTimeline.tsx';
import { ValidationPanel } from './components/ValidationPanel.tsx';
import { LessonView } from './components/LessonView.tsx';
import { ComponentRepairTimeline } from './components/ComponentRepairTimeline.tsx';
import { LessonChecksPanel } from './components/LessonChecksPanel.tsx';
import { Provenance } from './components/Provenance.tsx';
import type { SourceRef } from '../../../packages/contracts/index.ts';

const NO_JOBS: never[] = [];

/** After React has shown a panel, scroll the drawer (never the page) to a section and move focus to its heading. */
function revealAfterRender(find: () => HTMLElement | null): void {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const el = find();
    if (el === null) return;
    revealInPanels(el, 'start', 8);
    const heading = el.matches('h2, h3') ? el : el.querySelector<HTMLElement>('h2, h3');
    if (heading !== null) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
  }));
}

/** The model choice lasts for the browser session (a reload keeps it); blocked storage just means it lasts for the page. */
function sessionStore(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.sessionStorage; } catch { return null; }
}

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
  const models = useModels(health);
  const [wantedModel, setWantedModel] = useState<ModelId | null>(() => readStoredModel(sessionStore()));
  const modelChoice = pickModel(models, wantedModel);

  const sourceList = sources.state === 'ready' ? sources.data : null;
  const selectedSourceId = pickedSource ?? sourceList?.[0]?.id ?? null;
  const selectedSource = sourceList?.find((s) => s.id === selectedSourceId) ?? null;

  const allJobs = jobs.state === 'ready' ? jobs.data : NO_JOBS;
  const jobsForSource = useMemo(
    () => newestFirst(allJobs.filter((j) => j.sourceId === selectedSourceId)),
    [allJobs, selectedSourceId],
  );
  const generate = generateState({ health, down, generating, hasSource: selectedSource !== null });

  const selectedJobId = pickedJob !== null && pickedJob.sourceId === selectedSourceId
    ? pickedJob.jobId
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

  // Window layout: the lesson and its source page fill the window; runs, steps and checks open in a drawer from the rail.
  const [showSource, setShowSource] = useState(true);
  const [drawer, setDrawer] = useState<DrawerMode | null>(null);
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
  const onChecks = useCallback(() => {
    setDrawer('runs');
    revealAfterRender(() => document.getElementById('drawer-checks'));
  }, []);

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
  const onSelectJob = useCallback((jobId: string) => {
    if (selectedSourceId !== null) setPickedJob({ jobId, sourceId: selectedSourceId });
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

  const hasChecks = ready !== null && (report !== null || analysisReport !== null || (ready.lessonData !== undefined && checkSections.length > 0));

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
  const provenance = (
    <Provenance
      disclosure={disclosure}
      phrases={repairCounts === null ? [] : repairPhrases(repairCounts)}
      onDetails={ready === null ? undefined : () => openDrawer('runs')}
    />
  );

  return (
    <AppWindow title="Make knowledge interactive" titleIsHeading titlebarExtra={<ApiStatus health={health} down={down} />}>
      <div className={`window-body${drawer !== null ? ' drawer-open' : ''}`}>
        <IconRail
          showSource={showSource}
          drawer={drawer}
          onNewLesson={() => openDrawer('new')}
          onLesson={onLesson}
          onChecks={onChecks}
          hasChecks={hasChecks}
          onToggleSource={() => setShowSource((v) => !v)}
          onRuns={() => (drawer === 'runs' ? closeDrawer() : openDrawer('runs'))}
          busy={generate.busy}
        />
        <div className={`workspace${showSource ? '' : ' hide-source'}`}>
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
          />

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
          <RunsDrawer mode={drawer} onMode={setDrawer} onClose={closeDrawer}>
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
              />
            )}
            {drawer === 'runs' && (
              <>
                <RunsSection
                  jobs={jobs}
                  jobsForSource={jobsForSource}
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
    </AppWindow>
  );
}
