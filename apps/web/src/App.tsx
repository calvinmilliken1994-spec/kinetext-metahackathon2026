import { useCallback, useMemo, useState } from 'react';
import { api, describeError } from './api.ts';
import { useHealth, useJobDetail, useJobs, useSourceDoc, useSources } from './hooks.ts';
import { buildHighlights } from './lib/highlight.ts';
import { collectQuoteRefs } from './lib/evidence.ts';
import { newestFirst, pickDefaultJob } from './lib/jobs.ts';
import { generateState, isServerBusy } from './lib/health.ts';
import { defaultRevision, overallRepairBadge, revisionInputs, validationHeading } from './lib/repairs.ts';
import { demoFaultToSend, disclosureText } from './lib/sources.ts';
import type { DemoChoice } from './lib/sources.ts';
import { Header } from './components/Header.tsx';
import { SourcePanel } from './components/SourcePanel.tsx';
import type { Flash } from './components/SourcePanel.tsx';
import { PipelinePanel } from './components/PipelinePanel.tsx';
import { ActivityPanel } from './components/ActivityPanel.tsx';
import { JobOutcome } from './components/JobOutcome.tsx';
import { RepairTimeline } from './components/RepairTimeline.tsx';
import { ValidationPanel } from './components/ValidationPanel.tsx';

const NO_JOBS: never[] = [];

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
  const quotes = useMemo(
    () => (selectedSourceId === null ? [] : collectQuoteRefs(selectedSourceId, ready?.spec, ready?.analysis?.analysis)),
    [selectedSourceId, ready],
  );
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
    api.createJob(sourceId, demoFaultToSend(demoChoice)).then(
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
  }, [selectedSourceId, demoChoice, refreshJobs, refreshHealth]);

  const onSelectSource = useCallback((id: string) => { setPickedSource(id); setFlash(null); }, []);
  const onSourceCreated = useCallback((id: string) => { reloadSources(); setPickedSource(id); setFlash(null); }, [reloadSources]);
  const onSelectJob = useCallback((jobId: string) => {
    if (selectedSourceId !== null) setPickedJob({ jobId, sourceId: selectedSourceId });
  }, [selectedSourceId]);

  const spec = ready?.spec;
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
                  : 'Press “Generate with Muse Spark”. Muse reads the source, plans an activity, and deterministic code machine-checks its quotes, numbers, ranges, sources and physics. Explanation wording is AI-generated and needs teacher review.'}
              </p>
            </div>
          )}
          {selectedJobId === null && jobs.state === 'loading' && <p className="muted pad">Loading…</p>}
          {detail?.state === 'loading' && <p className="muted pad">Loading run…</p>}
          {detail?.state === 'error' && <div className="callout callout-error pad-m" role="alert">{detail.message}</div>}
          {ready !== null && spec !== undefined && ready.summary.status === 'succeeded' && (
            <ActivityPanel
              key={spec.id}
              spec={spec}
              cite={{ sourceId: ready.summary.sourceId, located, onCite }}
              disclosure={disclosureText(selectedSource)}
              repairBadge={repairBadge}
            />
          )}
          {ready !== null && (spec === undefined || ready.summary.status !== 'succeeded') && (
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
          />
          {ready !== null && (
            <RepairTimeline
              revisions={revisions}
              repairs={ready.summary.repairs}
              demoFault={ready.summary.demoFault}
              events={ready.events}
              publishedRevision={ready.summary.publishedRevision}
              bestRevision={ready.summary.bestRevision}
              viewing={viewRev}
              onView={onViewRevision}
            />
          )}
          {report !== null && (
            <ValidationPanel
              report={report}
              heading={validationHeading(viewRev, revisions.length, ready?.summary.publishedRevision)}
              showPublish={spec !== undefined && viewRev === defaultRev}
            />
          )}
          {report === null && analysisReport !== null && (
            <ValidationPanel report={analysisReport} heading="Source analysis checks" showPublish={false} />
          )}
        </aside>
      </div>
    </div>
  );
}
