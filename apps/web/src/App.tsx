import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, describeError } from './api.ts';
import { useAccess, useHealth, useJobDetail, useJobs, useModels, useSourceDoc, useSources } from './hooks.ts';
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
import { demoFaultToSend, disclosureText, shortTitle } from './lib/sources.ts';
import { isRetiredPage, subjectNote } from './lib/subjects.ts';
import type { SubjectKey } from './lib/subjects.ts';
import type { DemoChoice } from './lib/sources.ts';
import { activityRepairCounts, checkTally, lessonRepairCounts, quoteTally, repairPhrases, sectionTally } from './lib/provenance.ts';
import { readStoredTech, writeStoredTech } from './lib/techDetails.ts';
import { readSourceOpen, writeSourceOpen } from './lib/lessonLayout.ts';
import { revealInPanels, scrollPanelToTop } from './lib/scroll.ts';
import { deckFromActivity, deckFromLesson, exitSearch, HOOK_BEAT, NOTES_ONLY_LINE, presentRequest } from './lib/presentation.ts';
import type { Deck } from './lib/presentation.ts';
import { ApiStatus } from './components/ApiStatus.tsx';
import { AppWindow } from './components/AppWindow.tsx';
import { Sidebar } from './components/Sidebar.tsx';
import { NewLessonPage } from './components/NewLessonPage.tsx';
import { AllLessonsPage } from './components/AllLessonsPage.tsx';
import { HowItWorksPage } from './components/HowItWorksPage.tsx';
import { ResultsPage } from './components/ResultsPage.tsx';
import { ReviewPage } from './components/ReviewPage.tsx';
import { LessonSkeleton } from './components/PendingCard.tsx';
import { ACCESS_INPUT_ID } from './components/AccessForm.tsx';
import { navTarget, pathFromSearch, searchForPath, searchForView, sidebarSections, VIEW_TITLES, viewFromSearch } from './lib/navigation.ts';
import type { LessonPath, MainView, NavId } from './lib/navigation.ts';
import { accessFooter } from './lib/access.ts';
import { lessonReviewCue } from './lib/reviewState.ts';
import { SourcePanel, SourceTab } from './components/SourcePanel.tsx';
import type { Flash } from './components/SourcePanel.tsx';
import { RunsSection, StepsSection } from './components/PipelinePanel.tsx';
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
import { LAST_SHOWN_KEY, openingFor } from './lib/demoPins.ts';
import { shownSearch } from './lib/jobUrl.ts';
import type { ReplayRequest } from './lib/replay.ts';
import { replayAfterTourClose, tourReady, tourRequest, tourSignals, TOUR_JOB_ID, TOUR_STORAGE_KEY, watchAfterTourClose } from './lib/onboarding.ts';
import type { TourOutcome, TourStep } from './lib/onboarding.ts';
import { Onboarding, PageGuide } from './components/Onboarding.tsx';
import { WelcomeScreen } from './components/WelcomeScreen.tsx';
import { demoLengthWords, firstLaunch, guideSteps, welcomeAccess, WELCOME_STORAGE_KEY } from './lib/welcome.ts';
import type { GuideAction, GuideStep } from './lib/welcome.ts';
import './styles/welcome.css';
import { AI_SUMMARY_PHRASE } from './lib/pageCopy.ts';
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

/** Focus the start of the lesson column: its title (a quiet tab stop, no ring) when a lesson is shown, else the column. */
function focusLessonStart(main: HTMLElement): void {
  const title = main.querySelector<HTMLElement>('.lesson-title[tabindex="-1"]');
  (title ?? main).focus({ preventScroll: true });
}

/** Stage 10c: the first launch, decided once per page load (lib/welcome.ts): the Welcome, or a forced Demo, or neither. */
const FIRST_LAUNCH = typeof window === 'undefined'
  ? { welcome: false, demo: false }
  : firstLaunch({ welcome: (() => { try { return localStore()?.getItem(WELCOME_STORAGE_KEY) ?? null; } catch { return null; } })(), search: window.location.search });

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

  // Stage 10: the main view (lesson, New lesson, All lessons, How it works, …) lives in the URL as ?view=. Sidebar
  // entries push a history entry, so Back returns to the previous view; the URL follows any other change of view.
  const [view, setView] = useState<MainView>(() => (typeof window === 'undefined' ? 'lesson' : viewFromSearch(window.location.search)));
  const navigate = useCallback((next: MainView) => {
    const search = searchForView(window.location.search, next);
    if (search !== window.location.search) window.history.pushState(window.history.state, '', `${window.location.pathname}${search}${window.location.hash}`);
    if (next !== 'lesson') setDrawer(null);
    setView(next);
  }, []);
  useEffect(() => {
    const search = searchForView(window.location.search, view);
    if (search !== window.location.search) window.history.replaceState(window.history.state, '', `${window.location.pathname}${search}${window.location.hash}`);
  }, [view]);
  useEffect(() => {
    const onPop = (): void => setView(viewFromSearch(window.location.search));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  // Stage 10: the judge access gate (GET /api/access; a 404 from an older API means the gate is off).
  const { access, refresh: refreshAccess, set: setAccess } = useAccess();
  // Stage 10c: the first launch. The Welcome screen, then the page guide (it moves the main view itself), then its Demo
  // prompt. New lesson can be asked to open on a path (the Demo's "Try your own page", ?path=own).
  const [welcomeOn, setWelcomeOn] = useState(FIRST_LAUNCH.welcome);
  const [guiding, setGuiding] = useState(false);
  const [guideRun, setGuideRun] = useState(0);
  const [pathReq, setPathReq] = useState<{ path: LessonPath; n: number } | null>(() => {
    const p = typeof window === 'undefined' ? null : pathFromSearch(window.location.search);
    return p === null ? null : { path: p, n: 0 };
  });
  const openNew = useCallback((path: LessonPath) => {
    const search = searchForPath(searchForView(window.location.search, 'new'), path);
    if (search !== window.location.search) window.history.pushState(window.history.state, '', `${window.location.pathname}${search}${window.location.hash}`);
    setDrawer(null);
    setPathReq({ path, n: Date.now() });
    setView('new');
  }, []);
  const onPathChange = useCallback((path: LessonPath) => {
    const search = searchForPath(window.location.search, path);
    if (search !== window.location.search) window.history.replaceState(window.history.state, '', `${window.location.pathname}${search}${window.location.hash}`);
  }, []);
  const [signingOut, setSigningOut] = useState(false);

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
    // A plain visit opens the demo's pinned run (lib/demoPins.ts), not whichever run happens to be newest.
    // A browser that has shown another lesson goes back to it (lib/demoPins.ts openingFor).
    let lastShown: string | null = null;
    try { lastShown = localStore()?.getItem(LAST_SHOWN_KEY) ?? null; } catch { lastShown = null; }
    const pinned = RUN_LINK === null && jobs.state === 'ready' ? openingFor(jobs.data, lastShown) : null;
    setOpening(pinned ?? res.opening);
    setLinkState(res.notice);
    if (RUN_LINK?.kind === 'replay' && !res.replay) setReplayReq(null);
    if (res.notice?.problem === 'not-found') setPresenting(null);
    if (res.opening === null && res.notice === null && jobs.state === 'ready' && view === 'lesson') setView('new');
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
  // The address bar names the lesson on screen (lib/jobUrl.ts): another lesson opening replaces a stale ?job=, ?replay=
  // or ?present=, so a refresh or a shared link never opens a different lesson. The page's first lesson keeps its URL.
  const firstShown = useRef<string | null>(null);
  const presentingNow = presenting !== null;
  useEffect(() => {
    if (selectedJobId === null || typeof window === 'undefined') return;
    if (firstShown.current === null) firstShown.current = selectedJobId;
    // Remember it for the next plain visit, except the tour's replay (a demo, not the teacher's choice).
    if (!replaying) { try { localStore()?.setItem(LAST_SHOWN_KEY, selectedJobId); } catch { /* storage blocked */ } }
    const next = shownSearch(window.location.search, selectedJobId, { replaying, presenting: presentingNow, opened: selectedJobId !== firstShown.current });
    if (next !== window.location.search) window.history.replaceState(window.history.state, '', `${window.location.pathname}${next}${window.location.hash}`);
  }, [selectedJobId, replaying, presentingNow]);
  // A citation highlights its quote in the source text, so it brings the source panel back if it was hidden.
  const onCite = useCallback((key: string) => { setShowSource(true); setFlash((f) => ({ key, n: (f?.n ?? 0) + 1 })); }, []);
  const onLesson = useCallback(() => {
    const main = mainRef.current;
    if (main === null) return;
    scrollPanelToTop(main);
    // In the stacked (narrow) layout the workspace scrolls, not the lesson column.
    revealInPanels(main, 'start', 0);
    focusLessonStart(main);
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
        // Watch the new lesson being built, in the lesson view.
        navigate('lesson');
        void refreshAccess();
      },
      (e: unknown) => {
        setGenerateError(describeError(e));
        // The session ended, the budget ran out or builds were paused: re-read the gate so the page says so.
        if (e instanceof ApiError && ['ACCESS_REQUIRED', 'JUDGE_BUDGET_REACHED', 'BUILDS_PAUSED'].includes(e.code)) void refreshAccess();
      },
    ).finally(() => {
      // Keep the button locked until /api/health has been re-read, so it never flickers enabled.
      void refreshHealth().finally(() => setGenerating(false));
    });
  }, [selectedSourceId, demoChoice, models, modelChoice, flow, refreshJobs, refreshHealth, navigate, refreshAccess]);
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
        analysis: ready.lessonData.analysis, fallbackTitle: selectedSource !== undefined && selectedSource !== null ? shortTitle(selectedSource.title) : 'Lesson',
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

  // Stage 9b: the Demo. Since Stage 10c it opens by itself only when forced (?demo=1 / ?tour=1, the film path); a first
  // visit gets the Welcome and the guide, whose last card offers the Demo. It also opens from the sidebar.
  const [touring, setTouring] = useState(FIRST_LAUNCH.demo);
  // Started from the guide's prompt, the Demo skips its own introduction (the replay is already playing).
  const [demoIntro, setDemoIntro] = useState(true);
  // The first card waits for the runs list, the page list and the opening lesson (never a tour over an empty "Loading…"
  // app); once shown it stays, since the tour's own replay reloads the lesson under it.
  const lessonLoad = opening === undefined || (selectedSourceId !== null && doc?.state === 'loading')
    ? 'loading'
    : selectedJobId === null ? 'none' : detail === null || detail === undefined ? 'loading' : detail.state;
  const [tourShown, setTourShown] = useState(false);
  if (touring && !tourShown && tourReady({ jobs: jobs.state, sources: sources.state, lesson: lessonLoad })) setTourShown(true);
  const tourJob = allJobs.find((j) => j.jobId === TOUR_JOB_ID) ?? null;
  const tourReplaying = replaying && replayReq?.jobId === TOUR_JOB_ID;
  const library = useMemo(() => {
    if (sourceList === null) return null;
    const active = sourceList.filter((s) => s.kind === 'library' && !isRetiredPage(s));
    return { pages: active.length, subjects: new Set(active.map((s) => s.subject ?? 'other')).size };
  }, [sourceList]);
  const tourReplayFailed = replayReq?.jobId === TOUR_JOB_ID && replay.detail?.state === 'error';
  // Demo v2: while the Demo's replay plays, the Demo reads its clock and seeks or holds it (Next, Back, a beat's dwell).
  const demoReplay = useMemo(() => (tourReplaying ? { clock: replay.clock, seek: replay.seek, hold: replay.hold } : null), [tourReplaying, replay.clock, replay.seek, replay.hold]);
  // M4: the Demo run's whole record, so the figure step knows (before the replay gets there) whether Muse grounded SAM.
  const tourRecord = useJobDetail(touring && tourJob !== null ? TOUR_JOB_ID : null);
  const accessHere = welcomeAccess(access, health === null ? null : health.live);
  const signals = useMemo(() => tourSignals({
    replayAvailable: tourJob !== null || jobs.state === 'loading', replayLoading: jobs.state === 'loading', replaying: tourReplaying, replayFailed: tourReplayFailed,
    detail: ready, builds: liveCtx?.builds ?? {}, strip: liveCtx?.strip ?? null,
    canPresent: deck !== null, library, speed: TOUR_REQUEST.speed,
    recording: tourRecord?.state === 'ready' ? tourRecord.data : null, own: accessHere,
  }), [tourJob, jobs.state, tourReplaying, tourReplayFailed, ready, liveCtx, deck, library, tourRecord, accessHere]);
  // Stage 10c: the page guide's steps, worded from the library, the access state and the Demo run's length.
  const guide = useMemo(() => guideSteps({
    library, access: accessHere,
    demo: { available: tourJob !== null, length: demoLengthWords(tourJob?.createdAt, tourJob?.finishedAt, TOUR_REQUEST.speed) },
  }), [library, accessHere, tourJob]);
  const appReady = tourReady({ jobs: jobs.state, sources: sources.state, lesson: lessonLoad });
  const [guideShown, setGuideShown] = useState(false);
  if (guiding && !guideShown && appReady) setGuideShown(true);
  // W-08: the recording could not be read and the teacher goes on without it: drop the replay, back to the opening lesson.
  const skipTourReplay = useCallback(() => {
    setReplayReq((r) => (r?.jobId === TOUR_JOB_ID ? null : r));
    setPickedJob(null);
    setPickedSource(null);
  }, []);
  const startTourReplay = useCallback(() => {
    if (tourJob === null) return;
    setDrawer(null);
    setView('lesson');
    setShowSource(true);
    setPickedSource(tourJob.sourceId);
    setFlash(null);
    setPickedJob({ jobId: tourJob.jobId, sourceId: tourJob.sourceId });
    if (replayReq?.jobId === tourJob.jobId) replay.restart();
    else setReplayReq({ jobId: tourJob.jobId, speed: TOUR_REQUEST.speed });
  }, [tourJob, replayReq, replay]);
  const onTourStep = useCallback((step: TourStep) => {
    // Demo v2: the reading and summary beats light the page, so it is open for them.
    if (step.id === 'library' || step.beat?.kind === 'reading' || step.beat?.kind === 'summary') { setShowSource(true); setDrawer(null); setView('lesson'); }
    if (step.id === 'present') setDrawer(null);
  }, []);
  // Closing the tour (Skip, Esc, Finish) puts focus on the lesson title, not on the whole lesson column (which drew a
  // focus ring round it after Esc). It waits for the lesson to render (Skip mid-replay reloads it) and gives way when
  // focus went somewhere on purpose (the rail button that opened the tour, presentation mode).
  const focusAfterTour = useRef(0);
  const wasTouring = useRef(touring);
  useEffect(() => {
    if (wasTouring.current && !touring) focusAfterTour.current = Date.now() + 4000;
    wasTouring.current = touring;
  }, [touring]);
  useEffect(() => {
    if (focusAfterTour.current === 0) return;
    const main = mainRef.current;
    const active = document.activeElement;
    if (Date.now() > focusAfterTour.current || main === null || (active !== null && active !== document.body && active !== main)) { focusAfterTour.current = 0; return; }
    const title = main.querySelector<HTMLElement>('.lesson-title[tabindex="-1"]');
    if (title === null) return;
    title.focus({ preventScroll: true });
    focusAfterTour.current = 0;
  });
  const closeTour = useCallback((how: TourOutcome) => {
    setTouring(false);
    setDemoIntro(true);
    // Skipping mid-demo stops the recorded build and leaves its build view: the lesson shows at rest, activity first.
    setReplayReq((r) => replayAfterTourClose(r, how));
    setWatched((w) => watchAfterTourClose(w, how));
    try { localStore()?.setItem(TOUR_STORAGE_KEY, how); } catch { /* blocked storage: the tour just reopens next visit */ }
  }, []);

  // Stage 10c: leaving the Welcome starts the guide (it shows once the app has loaded what it points at).
  const onWelcomeContinue = useCallback(() => {
    try { localStore()?.setItem(WELCOME_STORAGE_KEY, 'done'); } catch { /* blocked storage: the Welcome just shows next visit */ }
    setWelcomeOn(false);
    setGuideRun((n) => n + 1);
    setGuiding(true);
  }, []);
  const onGuideStep = useCallback((step: GuideStep) => {
    setView(step.view);
    setDrawer(step.drawer ? 'runs' : null);
    if (step.view === 'lesson') setShowSource(true);
  }, []);
  const endGuide = useCallback(() => { setGuiding(false); setGuideShown(false); }, []);
  const onGuideSkip = useCallback(() => { endGuide(); setDrawer(null); setView('lesson'); }, [endGuide]);
  const onGuideAction = useCallback((a: Exclude<GuideAction, 'next'>) => {
    endGuide();
    setDrawer(null);
    if (a === 'watch') { setDemoIntro(false); startTourReplay(); setTouring(true); }
    else if (a === 'own') openNew('own');
    else if (a === 'lessons') navigate('lessons');
    else setView('lesson');
  }, [endGuide, startTourReplay, openNew, navigate]);
  const showWelcomeAgain = useCallback(() => {
    setTouring(false);
    setReplayReq((r) => replayAfterTourClose(r, 'skipped'));
    endGuide();
    setDrawer(null);
    setWelcomeOn(true);
  }, [endGuide]);

  // Stage 10: the sidebar. Views open in the main area; Source page, Present, Checks and Demo act on the open lesson.
  const lessonOpen = selectedJobId !== null && !linkHold;
  const sections = sidebarSections({
    view,
    lessonTitle: lessonOpen ? (selectedSource !== null ? shortTitle(selectedSource.title) : 'Lesson') : null,
    showSource,
    canPresent: deck !== null,
    touring,
    checksOpen: drawer === 'runs' && view === 'lesson',
    activity: !lessonOpen ? null : replaying ? 'replay' : ready?.summary.status === 'running' ? 'building' : null,
  });
  // Where focus goes after a view change: the access-code field (Enter access code), else the new view's heading.
  const focusAccess = useRef(false);
  const onNav = useCallback((id: NavId) => {
    const t = navTarget(id);
    if ('view' in t) {
      if (t.view === view) { if (view === 'lesson') onLesson(); else mainRef.current?.querySelector<HTMLElement>('[data-view-title]')?.focus({ preventScroll: true }); return; }
      navigate(t.view);
      return;
    }
    if (t.action === 'source') {
      if (view === 'lesson') setShowSource((v) => !v);
      else { setShowSource(true); navigate('lesson'); }
    } else if (t.action === 'present') {
      onPresent();
    } else if (t.action === 'checks') {
      if (view === 'lesson' && drawer === 'runs') { closeDrawer(); return; }
      if (view !== 'lesson') navigate('lesson');
      setDrawer('runs');
    } else if (t.action === 'welcome') {
      showWelcomeAgain();
    } else {
      setDrawer(null);
      endGuide();
      if (view !== 'lesson') navigate('lesson');
      setDemoIntro(true);
      setTouring(true);
    }
  }, [view, navigate, onLesson, onPresent, drawer, closeDrawer, showWelcomeAgain, endGuide]);
  const onEnterCode = useCallback(() => {
    focusAccess.current = true;
    if (view === 'new') document.getElementById(ACCESS_INPUT_ID)?.focus();
    else navigate('new');
  }, [view, navigate]);
  const onSignOut = useCallback(() => {
    setSigningOut(true);
    api.deleteAccess().then(setAccess, () => { void refreshAccess(); }).finally(() => setSigningOut(false));
  }, [setAccess, refreshAccess]);
  const firstView = useRef(true);
  useEffect(() => {
    if (firstView.current) { firstView.current = false; return; }
    const main = mainRef.current;
    if (main === null) return;
    scrollPanelToTop(main);
    // The guide or the Demo moved the view: its card keeps focus.
    if (document.querySelector('.tour') !== null) return;
    const code = focusAccess.current ? document.getElementById(ACCESS_INPUT_ID) : null;
    focusAccess.current = false;
    if (code !== null) {
      code.focus({ preventScroll: true });
      // Only scroll when the field is out of sight (narrow windows stack the build area under the list).
      const r = code.getBoundingClientRect();
      const m = main.getBoundingClientRect();
      if (r.top < m.top || r.bottom > m.bottom) revealInPanels(code, 'center', 0);
      return;
    }
    if (view === 'lesson') focusLessonStart(main);
    else main.querySelector<HTMLElement>('[data-view-title]')?.focus({ preventScroll: true });
  }, [view]);
  const openFromList = useCallback((jobId: string, sourceId: string) => { onSelectJob(jobId, sourceId); navigate('lesson'); }, [onSelectJob, navigate]);

  const notesOnly = deck?.notesOnly === true;
  // While a build is watched (live or replay) the strip's closing beat offers Present, so the header shows none.
  // Run details opens on "How Muse revised this lesson" when the lesson had a repair (it sat two screens down).
  const repairStoryAt = componentRepairs.length > 0
    ? '[data-testid="component-repair"]'
    : ready?.lessonData !== undefined && analysisSteps.length > 0 ? '[data-testid="analysis-repair"]' : null;
  const presentButton = deck === null || liveCtx !== null ? null : (
    <button
      type="button" className="btn present-launch" data-tour="present" onClick={onPresent}
      title={notesOnly ? `${NOTES_ONLY_LINE} Present the lesson notes full screen.` : 'Present this lesson full screen, one step at a time'}
    >
      <IconPresent size={18} />{notesOnly ? 'Present notes' : 'Present'}
    </button>
  );

  // Library tidy: a finished unpublished lesson gets the amber Needs review notice; activities get no review status.
  const reviewCue = ready === null ? 'line' : lessonReviewCue({
    status: ready.summary.status, lesson: ready.lessonData !== undefined, published: (ready.lessonData?.review ?? null) !== null, live: liveCtx !== null,
  });
  const provenanceLine = (
    <Provenance
      reviewCue={reviewCue}
      onReview={() => navigate('review')}
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
      {welcomeOn ? (
        <div className="window-body window-body-plain">
          <WelcomeScreen
            access={access} live={health === null ? null : health.live} library={library}
            onAccess={setAccess} onContinue={onWelcomeContinue}
          />
        </div>
      ) : (
      <div className={`window-body${drawer !== null && view === 'lesson' ? ' drawer-open' : ''}`}>
        <Sidebar
          sections={sections}
          view={view}
          onItem={onNav}
          footer={accessFooter(access, health === null ? null : health.live)}
          onEnterCode={onEnterCode}
          onSignOut={onSignOut}
          signingOut={signingOut}
        />
        {view !== 'lesson' && (
          <div className="workspace workspace-page">
            <main className="panel page-panel" aria-label={VIEW_TITLES[view]} ref={mainRef} tabIndex={-1}>
              <div className="page-inner">
                {view === 'new' && (
                  <NewLessonPage
                    sources={sources}
                    jobs={allJobs}
                    selectedId={selectedSourceId}
                    onSelect={onSelectSource}
                    onCreated={onSourceCreated}
                    doc={doc}
                    onOpenLesson={openFromList}
                    subjectFilter={subjectFilter}
                    onSubjectFilter={setSubjectFilter}
                    generate={generate}
                    onGenerate={onGenerate}
                    generateError={generateError}
                    models={models}
                    modelChoice={modelChoice}
                    onModelChoice={onModelChoice}
                    live={health === null ? null : health.live}
                    flow={flow}
                    onFlow={setFlow}
                    demoChoice={demoChoice}
                    onDemoChoice={setDemoChoice}
                    access={access}
                    onAccess={setAccess}
                    openPath={pathReq}
                    onPathChange={onPathChange}
                  />
                )}
                {view === 'lessons' && (
                  <AllLessonsPage
                    jobs={jobs}
                    sourcesById={sourcesById}
                    openJobId={lessonOpen ? selectedJobId : null}
                    serverBusy={health === null ? null : generate.busy}
                    subjectFilter={subjectFilter}
                    onSubjectFilter={setSubjectFilter}
                    onOpen={openFromList}
                    onNewLesson={() => navigate('new')}
                    access={access}
                    onJobsChanged={refreshJobs}
                    onReview={() => navigate('review')}
                  />
                )}
                {view === 'how' && (
                  <HowItWorksPage
                    library={library}
                    access={access}
                    onDemo={() => onNav('demo')}
                    onNewLesson={() => navigate('new')}
                    onEnterCode={onEnterCode}
                    onNav={onNav}
                  />
                )}
                {view === 'review' && (
                  <ReviewPage
                    detail={ready}
                    title={lessonOpen && selectedSource !== null ? shortTitle(selectedSource.title) : null}
                    access={access}
                    onAccess={setAccess}
                    onShowLesson={() => navigate('lesson')}
                    onBrowseLessons={() => navigate('lessons')}
                  />
                )}
                {view === 'results' && <ResultsPage jobs={jobs.state === 'ready' ? jobs.data : null} onOpenLesson={openFromList} />}
              </div>
            </main>
          </div>
        )}
        {view === 'lesson' && (
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
                  onChoose={() => navigate('lessons')}
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
                      : `Muse Spark reads the page, writes ${AI_SUMMARY_PHRASE}, then builds a few interactive parts. Code checks every quote and number.`}
                  </p>
                  {(health === null || health.live) && (
                    <button type="button" className="btn btn-primary" onClick={() => navigate('new')}>New lesson</button>
                  )}
                </div>
              )}
              {selectedJobId === null && jobs.state === 'loading' && <LessonSkeleton />}
              {detail?.state === 'loading' && <LessonSkeleton />}
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
                  fallbackTitle={selectedSource !== undefined && selectedSource !== null ? shortTitle(selectedSource.title) : 'Lesson'}
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
        )}

        {drawer !== null && view === 'lesson' && (
          <RunsDrawer mode={drawer} onClose={closeDrawer} tech={tech} onTech={onTech} openAt={repairStoryAt}>
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
                  onNewLesson={() => navigate('new')}
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
      )}
      {!welcomeOn && guiding && guideShown && presenting === null && (
        <PageGuide key={guideRun} steps={guide} onStep={onGuideStep} onAction={onGuideAction} onSkip={onGuideSkip} />
      )}
      {/* The Demo stays mounted while presentation mode is open from it, and shows again when the slides close. */}
      {!welcomeOn && touring && tourShown && (
        <Onboarding
          signals={signals} onStartReplay={startTourReplay} onPresent={onPresent} onClose={closeTour} onStep={onTourStep}
          onRetryReplay={replay.retry} onSkipReplay={skipTourReplay} intro={demoIntro} hidden={presenting !== null}
          onOwn={() => openNew('own')} onLessons={() => navigate('lessons')} replay={demoReplay}
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
