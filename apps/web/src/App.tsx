import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, describeError } from './api.ts';
import { useHealth, useJobDetail, useJobs, useModels, useSourceDoc, useSources } from './hooks.ts';
import { buildHighlights } from './lib/highlight.ts';
import { collectQuoteRefs } from './lib/evidence.ts';
import { newestFirst, pickDefaultJob } from './lib/jobs.ts';
import type { OpeningJob } from './lib/jobs.ts';
import { generateState, isServerBusy } from './lib/health.ts';
import { madeWithPhrase, modelToSend, pickModel, readStoredModel, resolveJobModel, writeStoredModel } from './lib/models.ts';
import type { ModelId } from './lib/models.ts';
import { analysisCheckName, analysisRepairOverall, buildAnalysisRepairSteps } from './lib/analysisRepairs.ts';
import { buildLessonRepairs, buildLessonStream, lessonAnalysisOverall, lessonAnalysisSteps, lessonCheckSections, lessonRenderMode } from './lib/lessonJob.ts';
import type { FlowId } from './lib/lessonJob.ts';
import { collectLessonQuotes } from './lib/lesson.ts';
import { partReports } from './lib/failures.ts';
import { checkName } from './lib/checks.ts';
import { defaultRevision, overallRepairBadge, revisionInputs, validationHeading } from './lib/repairs.ts';
import { timelineEventLabels } from './lib/timeline.ts';
import { demoFaultToSend, disclosureText } from './lib/sources.ts';
import { isRetiredPage, subjectNote } from './lib/subjects.ts';
import type { SubjectKey } from './lib/subjects.ts';
import type { DemoChoice } from './lib/sources.ts';
import { activityRepairCounts, checkTally, lessonRepairCounts, quoteTally, repairPhrases, sectionTally } from './lib/provenance.ts';
import { readStoredTech, writeStoredTech } from './lib/techDetails.ts';
import { readSourceOpen, writeSourceOpen } from './lib/lessonLayout.ts';
import { revealInPanels, scrollPanelToTop } from './lib/scroll.ts';
import { deckFromActivity, deckFromLesson, exitSearch, HOOK_BEAT, presentRequest } from './lib/presentation.ts';
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
import { ReplayLabel } from './components/LiveBuild.tsx';
import type { LiveContext } from './components/LiveBuild.tsx';
import { latestLesson, linkNotice, resolveRunLink, runLink } from './lib/lessonJobLinks.ts';
import type { LinkNoticeState } from './lib/lessonJobLinks.ts';
import { useReplay } from './components/useReplay.ts';
import { jobStartMs, liveStrip, partBuilds } from './lib/liveBuild.ts';
import { replayRequest } from './lib/replay.ts';
import type { ReplayRequest } from './lib/replay.ts';
import { replayAfterTourClose, shouldAutoStart, tourRequest, tourSignals, TOUR_JOB_ID, TOUR_STORAGE_KEY } from './lib/onboarding.ts';
import type { TourOutcome, TourStep } from './lib/onboarding.ts';
import { Onboarding } from './components/Onboarding.tsx';
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
/** Stage 9: `?replay=<id>[&speed=N]` plays that stored run's recorded events through the live build view, labelled as a replay. */
const REPLAY_REQUEST = typeof window === 'undefined' ? null : replayRequest(window.location.search);
/**
 * The run a `?replay=`, `?job=` or `?present=` link names (Set A): an unknown id opens no other lesson in its place, and a
 * replay link to a classic single-activity run opens its stored result with a message instead of a fake running state.
 */
const RUN_LINK = typeof window === 'undefined' ? null : runLink(window.location.search);
/** Stage 9b: `?tour=1[&speed=N]` forces the first-run tour (the scripted demo path), `?tour=0` keeps it closed. */
const TOUR_REQUEST = tourRequest(typeof window === 'undefined' ? '' : window.location.search);

function readTourOutcome(): string | null {
  try { return localStore()?.getItem(TOUR_STORAGE_KEY) ?? null; } catch { return null; }
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
  // Stage 7b: one subject filter for the page pickers and the runs list; the runs list shows this page or all pages.
  const [subjectFilter, setSubjectFilter] = useState<SubjectKey | null>(null);
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
  // Stage 9: a replay feeds the recorded run's detail, moment by moment, in place of the polled one.
  // Stage 9b: the tour starts a replay without a reload, so the request is state (seeded from the URL).
  const [replayReq, setReplayReq] = useState<ReplayRequest | null>(REPLAY_REQUEST);
  // Set A: what a deep link could not open (shown in the lesson column until the teacher picks a lesson).
  const [linkState, setLinkState] = useState<LinkNoticeState | null>(null);
  if (opening === undefined && jobs.state !== 'loading') {
    const res = jobs.state === 'ready' ? resolveRunLink(RUN_LINK, jobs.data) : { opening: null, notice: null, replay: false };
    setOpening(res.opening);
    setLinkState(res.notice);
    if (RUN_LINK?.kind === 'replay' && !res.replay) setReplayReq(null);
    if (res.notice?.problem === 'not-found') setPresenting(null);
    if (res.opening === null && res.notice === null && jobs.state === 'ready') setDrawer('new');
  }
  // A link that named nothing holds the lesson column for its notice until the teacher picks a page or a run.
  const linkHold = linkState?.problem === 'not-found' && pickedJob === null && pickedSource === null;

  const sourceList = sources.state === 'ready' ? sources.data : null;
  const openingSourceId = opening !== null && opening !== undefined && sourceList?.some((s) => s.id === opening.sourceId) === true ? opening.sourceId : null;
  const selectedSourceId = pickedSource ?? openingSourceId ?? (opening === undefined ? null : sourceList?.find((s) => !isRetiredPage(s))?.id ?? null);
  const selectedSource = sourceList?.find((s) => s.id === selectedSourceId) ?? null;

  const allJobs = jobs.state === 'ready' ? jobs.data : NO_JOBS;
  const allJobsNewest = useMemo(() => newestFirst(allJobs), [allJobs]);
  const sourcesById = useMemo(() => new Map((sourceList ?? []).map((s) => [s.id, s] as const)), [sourceList]);
  const jobsForSource = useMemo(
    () => newestFirst(allJobs.filter((j) => j.sourceId === selectedSourceId)),
    [allJobs, selectedSourceId],
  );
  const generate = generateState({ health, down, generating, hasSource: selectedSource !== null });

  const selectedJobId = linkHold
    ? null
    : pickedJob !== null && pickedJob.sourceId === selectedSourceId
    ? pickedJob.jobId
    : pickedSource === null && openingSourceId !== null && opening !== null && opening !== undefined
      ? opening.jobId
      : pickDefaultJob(jobsForSource, generate.busy)?.jobId ?? null;
  const replaying = replayReq !== null && selectedJobId === replayReq.jobId;
  const replay = useReplay(replayReq);
  const polled = useJobDetail(replaying ? null : selectedJobId);
  const detail = replaying ? replay.detail : polled;
  const ready = detail?.state === 'ready' && detail.data.summary.sourceId === selectedSourceId ? detail.data : null;
  // A linked run the server lists but cannot read: the same calm notice, never an error wall or another lesson.
  const linkUnreadable = RUN_LINK !== null && linkState === null && pickedJob === null && pickedSource === null
    && selectedJobId === RUN_LINK.jobId && detail?.state === 'error';
  const notice: LinkNoticeState | null = linkHold
    ? linkState
    : linkUnreadable && RUN_LINK !== null
      ? { problem: 'unreadable', kind: RUN_LINK.kind, jobId: RUN_LINK.jobId }
      : linkState?.problem === 'classic-replay' && selectedJobId === linkState.jobId ? linkState : null;
  if (linkUnreadable && presenting !== null) setPresenting(null);
  // A lesson this view has watched while it was running keeps its live build view (trace lines, reserved space) until
  // another run is opened, so finishing never rearranges what the teacher is looking at.
  const [watched, setWatched] = useState<string | null>(null);
  if (ready !== null && ready.summary.status === 'running' && ready.lessonData !== undefined && watched !== ready.summary.jobId) setWatched(ready.summary.jobId);

  const doc = useSourceDoc(selectedSourceId);
  // Stage 6: a lesson job streams in; `stream` says what is ready now (overview, which components, which are placeholders).
  const lessonMode = useMemo(() => (ready === null ? 'v1' : lessonRenderMode(ready)), [ready]);
  const stream = useMemo(() => (ready === null || ready.lessonData === undefined ? null : buildLessonStream(ready)), [ready]);
  const liveOn = ready !== null && ready.lessonData !== undefined && (replaying || watched === ready.summary.jobId);
  const liveStart = ready === null ? null : jobStartMs(ready.events);
  const liveWords = useMemo(() => (doc?.state === 'ready' ? doc.data.text.split(/\s+/).filter((w) => /[\p{L}\d]/u.test(w)).length : null), [doc]);
  const liveCtx = useMemo((): LiveContext | null => {
    if (!liveOn || ready === null) return null;
    const clock = replaying ? replay.clock : () => (liveStart === null ? 0 : Date.now() - liveStart);
    return {
      clock, strip: liveStrip(ready), builds: partBuilds(ready), sourceWords: liveWords,
      replay: replaying && replayReq !== null ? { speed: replayReq.speed, recordedAt: replay.recordedAt, finished: replay.finished, onRestart: replay.restart } : null,
    };
  }, [liveOn, ready, replaying, replayReq, replay.clock, replay.recordedAt, replay.finished, replay.restart, liveStart, liveWords]);
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
  const reports = useMemo(() => (ready === null ? {} : partReports(ready)), [ready]);
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
    // Set B: Present opens on the hook (the most visual ask); the title sheet is one ← away.
    if (deck !== null) setPresenting({ jobId: deck.jobId, beat: HOOK_BEAT });
  }, [deck]);
  const onExitPresent = useCallback(() => {
    setPresenting((p) => {
      if (p !== null) window.history.replaceState(window.history.state, '', `${window.location.pathname}${exitSearch(window.location.search, p.jobId)}${window.location.hash}`);
      return null;
    });
  }, []);
  // The closing beat of a watched build offers the same Present button (Stage 9b).
  const liveView = useMemo((): LiveContext | null => (liveCtx === null ? null : { ...liveCtx, onPresent: deck === null ? null : onPresent }), [liveCtx, deck, onPresent]);

  // Stage 9b: the first-run tour. It opens by itself once, on a plain first visit (or with ?tour=1), and from the rail.
  const [touring, setTouring] = useState(() => typeof window !== 'undefined' && shouldAutoStart(readTourOutcome(), window.location.search));
  const tourJob = allJobs.find((j) => j.jobId === TOUR_JOB_ID) ?? null;
  const tourReplaying = replaying && replayReq?.jobId === TOUR_JOB_ID;
  const library = useMemo(() => {
    if (sourceList === null) return null;
    const active = sourceList.filter((s) => s.kind === 'library' && !isRetiredPage(s));
    return { pages: active.length, subjects: new Set(active.map((s) => s.subject ?? 'other')).size };
  }, [sourceList]);
  const tourReplayFailed = replayReq?.jobId === TOUR_JOB_ID && replay.detail?.state === 'error';
  const signals = useMemo(() => tourSignals({
    replayAvailable: tourJob !== null || jobs.state === 'loading', replayLoading: jobs.state === 'loading', replaying: tourReplaying, replayFailed: tourReplayFailed,
    detail: ready, builds: liveCtx?.builds ?? {}, strip: liveCtx?.strip ?? null,
    canPresent: deck !== null, library, speed: TOUR_REQUEST.speed,
  }), [tourJob, jobs.state, tourReplaying, tourReplayFailed, ready, liveCtx, deck, library]);
  // W-08: the recording could not be read and the teacher goes on without it: drop the replay, back to the opening lesson.
  const skipTourReplay = useCallback(() => {
    setReplayReq((r) => (r?.jobId === TOUR_JOB_ID ? null : r));
    setPickedJob(null);
    setPickedSource(null);
  }, []);
  const startTourReplay = useCallback(() => {
    if (tourJob === null) return;
    setDrawer(null);
    setShowSource(true);
    setPickedSource(tourJob.sourceId);
    setFlash(null);
    setPickedJob({ jobId: tourJob.jobId, sourceId: tourJob.sourceId });
    if (replayReq?.jobId === tourJob.jobId) replay.restart();
    else setReplayReq({ jobId: tourJob.jobId, speed: TOUR_REQUEST.speed });
  }, [tourJob, replayReq, replay]);
  const onTourStep = useCallback((step: TourStep) => {
    if (step.id === 'library' || step.id === 'overview') { setShowSource(true); setDrawer(null); }
    if (step.id === 'present') setDrawer(null);
  }, []);
  const closeTour = useCallback((how: TourOutcome) => {
    setTouring(false);
    // Skipping mid-demo stops the recorded build; the lesson stays open as it finished.
    setReplayReq((r) => replayAfterTourClose(r, how));
    try { localStore()?.setItem(TOUR_STORAGE_KEY, how); } catch { /* blocked storage: the tour just reopens next visit */ }
  }, []);

  const presentButton = deck === null ? null : (
    <button type="button" className="btn present-launch" data-tour="present" onClick={onPresent} title="Present this lesson full screen, one step at a time">
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
          onTour={() => setTouring(true)}
          touring={touring}
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
              live={liveCtx !== null}
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
              {notice !== null && (
                <LinkNotice
                  notice={notice}
                  onChoose={() => { setRunScope('all'); openDrawer('runs'); }}
                  latest={notice.problem === 'classic-replay' ? null : latestLesson(allJobs)}
                  onOpen={onSelectJob}
                />
              )}
              {selectedJobId === null && jobs.state === 'ready' && !linkHold && (
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
              {detail?.state === 'error' && !linkUnreadable && <div className="callout callout-error" role="alert">{detail.message}</div>}
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
              {ready !== null && stream !== null && (lessonMode === 'lesson' || (lessonMode === 'working' && liveCtx !== null)) && (
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
                  reports={reports}
                  live={liveView}
                />
              )}
              {ready !== null && ((lessonMode === 'v1' && (spec === undefined || ready.summary.status !== 'succeeded')) || (lessonMode === 'working' && liveCtx === null) || lessonMode === 'outcome') && (
                <>
                  {/* W-07: a replayed run that ends on its outcome card is still labelled as a replay. */}
                  {replaying && liveCtx?.replay != null && <div className="lb-bar lb-bar-outcome"><ReplayLabel replay={liveCtx.replay} /></div>}
                  {/* During a replay the record reads "running" by design; never call it left behind. */}
                  <JobOutcome detail={ready} serverBusy={replaying ? true : health === null ? null : generate.busy} />
                </>
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
      {touring && presenting === null && (
        <Onboarding
          signals={signals} onStartReplay={startTourReplay} onPresent={onPresent} onClose={closeTour} onStep={onTourStep}
          onRetryReplay={replay.retry} onSkipReplay={skipTourReplay}
        />
      )}
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

/** Set A: what a deep link could not open, in calm words, with a way back to the library (never another lesson silently). */
function LinkNotice({ notice, onChoose, latest, onOpen }: {
  notice: LinkNoticeState; onChoose: () => void; latest: { jobId: string; sourceId: string } | null; onOpen: (jobId: string, sourceId: string) => void;
}) {
  const text = linkNotice(notice);
  const headRef = useRef<HTMLHeadingElement>(null);
  const missing = notice.problem !== 'classic-replay';
  // A missing lesson replaces the lesson column, so its heading takes focus (no scroll); the replay note just sits above.
  useEffect(() => { if (missing) headRef.current?.focus({ preventScroll: true }); }, [missing, notice.jobId]);
  return (
    <section className={`link-notice${missing ? ' is-missing' : ''}`} role="status" aria-labelledby="link-notice-title" data-testid="link-notice" data-problem={notice.problem}>
      <h2 id="link-notice-title" ref={headRef} tabIndex={-1}>{text.title}</h2>
      <p>{text.body}</p>
      {missing && (
        <p className="link-notice-actions">
          <button type="button" className="btn btn-primary" onClick={onChoose}>Choose a lesson</button>
          {latest !== null && <button type="button" className="btn btn-quiet" onClick={() => onOpen(latest.jobId, latest.sourceId)}>Open the latest lesson</button>}
        </p>
      )}
      {missing && notice.jobId !== '' && <p className="small muted link-notice-id">Link id: <code>{notice.jobId}</code></p>}
    </section>
  );
}
