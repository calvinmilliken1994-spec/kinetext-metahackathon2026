import { useCallback, useMemo, useState } from 'react';
import { api, describeError } from './api.ts';
import { useHealth, useJobDetail, useJobs, useModels, useSourceDoc, useSources } from './hooks.ts';
import { buildHighlights } from './lib/highlight.ts';
import { collectQuoteRefs } from './lib/evidence.ts';
import { newestFirst, pickDefaultJob } from './lib/jobs.ts';
import { generateState, isServerBusy } from './lib/health.ts';
import { madeWithPhrase, modelToSend, pickModel, readStoredModel, resolveJobModel, writeStoredModel } from './lib/models.ts';
import type { ModelId } from './lib/models.ts';
import { analysisCheckName, analysisRepairOverall, buildAnalysisRepairSteps, repairSummaryText } from './lib/analysisRepairs.ts';
import { buildLessonRepairs, buildLessonStream, lessonAnalysisOverall, lessonAnalysisSteps, lessonCheckSections, lessonRenderMode, lessonRepairSummary } from './lib/lessonJob.ts';
import type { FlowId } from './lib/lessonJob.ts';
import { collectLessonQuotes } from './lib/lesson.ts';
import { checkName } from './lib/checks.ts';
import { defaultRevision, overallRepairBadge, revisionInputs, validationHeading } from './lib/repairs.ts';
import { timelineEventLabels } from './lib/timeline.ts';
import { demoFaultToSend, disclosureText } from './lib/sources.ts';
import type { DemoChoice } from './lib/sources.ts';
import { Header } from './components/Header.tsx';
import { ModelNote } from './components/ModelNote.tsx';
import { SourcePanel } from './components/SourcePanel.tsx';
import type { Flash } from './components/SourcePanel.tsx';
import { PipelinePanel } from './components/PipelinePanel.tsx';
import { ActivityPanel } from './components/ActivityPanel.tsx';
import { JobOutcome } from './components/JobOutcome.tsx';
import { AnalysisRepairTimeline } from './components/AnalysisRepairTimeline.tsx';
import { RepairTimeline } from './components/RepairTimeline.tsx';
import { ValidationPanel } from './components/ValidationPanel.tsx';
import { LessonView } from './components/LessonView.tsx';
import { ComponentRepairTimeline } from './components/ComponentRepairTimeline.tsx';
import { LessonChecksPanel } from './components/LessonChecksPanel.tsx';
import type { SourceRef } from '../../../packages/contracts/index.ts';

const NO_JOBS: never[] = [];

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

  const onCite = useCallback((key: string) => setFlash((f) => ({ key, n: (f?.n ?? 0) + 1 })), []);

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
  const repairBanner = ready === null || ready.lessonData !== undefined || analysisOverall.state === 'none'
    ? null
    : repairSummaryText(ready.summary) ?? 'Analysis repair in progress';
  // Lesson jobs: component repairs (natural vs system-made), the one-line summary and the quiet checks list.
  const componentRepairs = useMemo(() => (ready === null ? [] : buildLessonRepairs(ready)), [ready]);
  const lessonSummary = useMemo(() => (ready === null || ready.lessonData === undefined ? null : lessonRepairSummary(ready)), [ready]);
  const checkSections = useMemo(() => (ready === null || ready.lessonData === undefined ? [] : lessonCheckSections(ready)), [ready]);
  const lessonSources = useMemo((): SourceRef[] => (selectedSource === null ? [] : [{
    id: selectedSource.id, title: selectedSource.title, locator: selectedSource.locator, license: selectedSource.license,
    attribution: selectedSource.attribution, sha256: selectedSource.sha256,
  }]), [selectedSource]);

  return (
    <div className="app">
      <Header health={health} down={down} />
      <div className="workspace">
        <SourcePanel
          sources={sources}
          selectedId={selectedSourceId}
          onSelect={onSelectSource}
          onReload={reloadSources}
          onCreated={onSourceCreated}
          doc={doc}
          highlights={highlights}
          quotes={quotes}
          flash={flash}
          onCite={onCite}
        />

        <main className="panel activity-panel" aria-label="Interactive activity">
          {jobs.state === 'error' && <div className="callout callout-error pad-m" role="alert">{jobs.message}</div>}
          {selectedJobId === null && jobs.state === 'ready' && (
            <div className="empty">
              <h2>No activity yet for this source</h2>
              <p className="muted">
                {health !== null && !health.live
                  ? 'Live generation is off on this server and there are no recorded runs for this source. Pick another source, or start the API with live generation enabled.'
                  : flow === 'lesson'
                    ? 'Press “Generate lesson with Muse Spark”. Muse reads the page and shows a quick overview first, then builds a few interactive components from it. Deterministic code checks quotes and numbers quietly in the background. The wording is AI-generated and needs teacher review.'
                    : 'Press “Generate with Muse Spark”. Muse reads the source, plans an activity, and deterministic code machine-checks its quotes, numbers, ranges, sources and physics. Explanation wording is AI-generated and needs teacher review.'}
              </p>
            </div>
          )}
          {selectedJobId === null && jobs.state === 'loading' && <p className="muted pad">Loading…</p>}
          {detail?.state === 'loading' && <p className="muted pad">Loading run…</p>}
          {detail?.state === 'error' && <div className="callout callout-error pad-m" role="alert">{detail.message}</div>}
          {jobModel !== null && <ModelNote model={jobModel} />}
          {ready !== null && repairBanner !== null && (
            <p className={`callout ${analysisOverall.state === 'failed' ? 'callout-error' : 'callout-natural'} pad-m repair-banner`} role="note" data-testid="repair-summary">
              <strong>{repairBanner}</strong>
              {analysisOverall.state === 'failed' ? ' — Muse’s own analysis did not pass.' : ' — Natural repair (Muse’s own mistake), details under “Analysis repair”.'}
            </p>
          )}
          {ready !== null && lessonSummary !== null && (
            <p className={`callout ${lessonSummary.tone === 'bad' ? 'callout-error' : lessonSummary.tone === 'fault' ? 'callout-fault' : 'callout-natural'} pad-m repair-banner`} role="note" data-testid="repair-summary">
              <strong>{lessonSummary.text}</strong>
              {lessonSummary.tone === 'bad'
                ? ' — the affected part is not shown unless it passed.'
                : lessonSummary.tone === 'fault'
                  ? ' — a demonstration fault planted by the system on purpose, not a model error. Details under “Component repairs”.'
                  : ' — Natural repair (Muse’s own mistake), details under “Analysis repair” and “Component repairs”.'}
            </p>
          )}
          {ready !== null && lessonMode === 'v1' && spec !== undefined && ready.summary.status === 'succeeded' && (
            <ActivityPanel
              key={spec.id}
              spec={spec}
              cite={{ sourceId: ready.summary.sourceId, located, onCite }}
              disclosure={disclosureText(selectedSource, jobModel === null ? undefined : madeWithPhrase(jobModel))}
              repairBadge={repairBadge}
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
              disclosure={disclosureText(selectedSource, jobModel === null ? undefined : madeWithPhrase(jobModel))}
              premium={spec ?? null}
              repairBadge={repairBadge}
              pending={stream.pending}
              order={stream.order}
            />
          )}
          {ready !== null && ((lessonMode === 'v1' && (spec === undefined || ready.summary.status !== 'succeeded')) || lessonMode === 'working' || lessonMode === 'outcome') && (
            <JobOutcome detail={ready} serverBusy={health === null ? null : generate.busy} />
          )}
        </main>

        <aside className="side" aria-label="Pipeline and validation">
          <PipelinePanel
            sourceTitle={selectedSource?.title ?? null}
            teacherSource={selectedSource?.kind === 'user'}
            jobs={jobs}
            jobsForSource={jobsForSource}
            generate={generate}
            serverBusy={health === null ? null : generate.busy}
            selectedJobId={selectedJobId}
            onSelectJob={onSelectJob}
            liveJobIds={liveJobIds}
            onGenerate={onGenerate}
            demoChoice={demoChoice}
            onDemoChoice={setDemoChoice}
            generateError={generateError}
            detail={detail}
            models={models}
            modelChoice={modelChoice}
            onModelChoice={onModelChoice}
            live={health === null ? null : health.live}
            flow={flow}
            onFlow={setFlow}
          />
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
        </aside>
      </div>
    </div>
  );
}
