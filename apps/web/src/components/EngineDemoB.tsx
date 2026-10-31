// Stage 8a dev-only harness for web slice W-B (?engine-demo=b[&tab=<id>][&present=demo-engines-b&beat=N]); owned by that
// slice. Not bundled in production (main.tsx imports it dynamically behind import.meta.env.DEV). Fixture data quoting
// real library pages exactly (lib/thresholdDemo.ts, lib/dataTableDemo.ts) plus the committed goldens; NOT model output.
import { useMemo, useState } from 'react';
import thresholdGolden from '../../../../tests/fixtures/stage6/threshold.gen.json';
import dataTableGolden from '../../../../tests/fixtures/stage6/data-table.gen.json';
import provenance from '../../../../tests/fixtures/provenance.fixture.json';
import srcElectoral from '../../../../data/sources/nara-what-is-the-electoral-college.json';
import srcAmendment from '../../../../data/sources/nara-constitutional-amendment-process.json';
import srcIrs from '../../../../data/sources/irs-tax-inflation-adjustments-2026.json';
import srcFed from '../../../../data/sources/federalreserve-open-market-operations.json';
import srcPlanets from '../../../../data/sources/nasa-nssdc-planetary-fact-sheet-metric.json';
import type { Provenance, SourceDocument } from '../../../../packages/contracts/index.ts';
import type { DataTableGen, KitSpec, LessonSpec, ThresholdGen } from '../../../../packages/contracts/kit.ts';
import { buildThresholdDemos } from '../lib/thresholdDemo.ts';
import { buildDataTableDemos } from '../lib/dataTableDemo.ts';
import { presentRequest } from '../lib/presentation.ts';
import type { Deck } from '../lib/presentation.ts';
import { AppWindow } from './AppWindow.tsx';
import { LessonView } from './LessonView.tsx';
import { Provenance as ProvenanceLine } from './Provenance.tsx';
import { PresentationMode } from './presentation/PresentationMode.tsx';
import type { CiteProps } from './Explanations.tsx';

const DISCLOSURE = 'Demo fixture: hand-written test data quoting real pages. Real lessons are written by Muse Spark 1.3 and checked against the page.';
const DECK_JOB = 'demo-engines-b';

type Meta = { id: string; title: string; locator: string; license: string; attribution: string; sha256: string };
const doc = (m: Meta): SourceDocument => ({ id: m.id, title: m.title, locator: m.locator, license: m.license, attribution: m.attribution, sha256: m.sha256, text: '' } as SourceDocument);
const sources: Record<string, SourceDocument> = Object.fromEntries([srcElectoral, srcAmendment, srcIrs, srcFed, srcPlanets].map((m) => [m.id, doc(m as Meta)]));

interface Tab { id: string; tab: string; note: string; spec: KitSpec; sourceId: string }

const tabs: Tab[] = [
  ...buildThresholdDemos(thresholdGolden as ThresholdGen, provenance as unknown as Provenance, sources),
  ...buildDataTableDemos(dataTableGolden as unknown as DataTableGen, provenance as unknown as Provenance, sources),
];

function lessonOf(t: Tab): LessonSpec {
  return { jobId: `demo-${t.id}`, analysisRef: '', overview: null, components: [{ componentId: t.spec.componentId as 'threshold-v1', specId: t.spec.id, status: 'passed', reason: '', revision: 1 }] };
}

/** Every demo spec as one presentation deck (title, one engine beat per part, closing). */
function demoDeck(): Deck {
  return {
    jobId: DECK_JOB, headline: 'Does it pass, and what does the table say?', source: null, disclosure: DISCLOSURE, overview: null, objectives: [],
    parts: tabs.map((t) => ({ kind: 'kit', spec: t.spec })), leftOut: 0, checks: null, quotes: null,
  };
}

/**
 * Dev-only harness for the threshold and data-table views (slice W-B). Each tab is one fixture part in the real lesson
 * frame; "Present" opens all of them as a presentation deck (one engine beat per part).
 */
export function EngineDemoB() {
  const params = new URLSearchParams(window.location.search);
  const [id, setId] = useState(() => (tabs.some((t) => t.id === params.get('tab')) ? (params.get('tab') as string) : (tabs[0]?.id ?? '')));
  const asked = presentRequest(window.location.search);
  const [presenting, setPresenting] = useState<number | null>(asked !== null && asked.jobId === DECK_JOB ? asked.beat : null);
  const [toast, setToast] = useState('');
  const t = tabs.find((x) => x.id === id) ?? tabs[0];
  const deck = useMemo(demoDeck, []);
  if (t === undefined) return null;
  const cite: CiteProps = { sourceId: t.sourceId, located: new Set(), onCite: (key) => setToast(`Demo: in the workspace this highlights the quote in the source panel (${key}).`) };
  const choose = (next: string): void => {
    setId(next);
    setToast('');
    const url = new URL(window.location.href);
    url.searchParams.set('tab', next);
    window.history.replaceState(null, '', url);
  };
  const exit = (): void => {
    setPresenting(null);
    const url = new URL(window.location.href);
    url.searchParams.delete('present'); url.searchParams.delete('beat'); url.searchParams.delete('job');
    window.history.replaceState(null, '', url);
  };

  return (
    <AppWindow title="Make knowledge interactive · engine views B (demo)">
      <div className="window-body window-body-plain">
        <div className="demo-page">
          <h1 className="sr-only">Threshold and data-table views (fixture data)</h1>
          <div className="demo-banner" role="note" data-testid="demo-banner">
            <strong>DEMO — fixture data, not model output.</strong>{' '}
            Hand-written fixtures quoting real library pages (NARA, IRS, Federal Reserve, NASA) and the committed goldens, shown with the real views. This page exists only in development.
          </div>
          <nav className="demo-tabs" aria-label="Demo parts">
            {tabs.map((x) => (
              <button key={x.id} type="button" className={`btn btn-small${x.id === t.id ? ' btn-primary' : ''}`} aria-current={x.id === t.id ? 'page' : undefined} onClick={() => choose(x.id)}>{x.tab}</button>
            ))}
            <button type="button" className="btn btn-small" onClick={() => setPresenting(1 + tabs.indexOf(t))}>Present</button>
          </nav>
          <p className="muted small demo-note">{t.note}</p>
          <main className="activity-panel demo-main" aria-label="Interactive lesson">
            <LessonView
              key={t.id} lesson={lessonOf(t)} specs={{ [t.spec.id]: t.spec }} analysis={null} sources={t.spec.sources}
              cite={cite} disclosure={DISCLOSURE} provenance={<ProvenanceLine disclosure={DISCLOSURE} phrases={[]} />}
            />
          </main>
          <p className="demo-toast small" role="status" aria-live="polite">{toast}</p>
        </div>
      </div>
      {presenting !== null && <PresentationMode deck={deck} quotes={[]} sourceId={t.sourceId} repairBadge={null} startBeat={presenting} onExit={exit} />}
    </AppWindow>
  );
}
