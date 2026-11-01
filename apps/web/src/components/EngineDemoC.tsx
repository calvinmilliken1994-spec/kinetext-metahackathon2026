// Stage 8b dev-only harness for web slice U (?engine-demo=c[&tab=<id>][&present=demo-engines-c&beat=N]); owned by that
// slice. Not bundled in production (main.tsx imports it dynamically behind import.meta.env.DEV). Tabs: the committed
// golden with hand-made regions (NOT SAM output); the parts and SAM 3.1 regions of four stored live runs (two early ones
// and the two demo-set runs, copied in lib/labelDiagramDemoSpecs.ts); a bare layout check. Every figure carries its stored label boxes
// (data/figures/<id>.labels.json). The figures are the committed files served by Vite instead of the API.
import { useMemo, useState } from 'react';
import labelGolden from '../../../../tests/fixtures/stage6/label-diagram.gen.json';
import provenance from '../../../../tests/fixtures/provenance.fixture.json';
import srcDna from '../../../../data/sources/medlineplus-what-is-dna.json';
import srcWater from '../../../../data/sources/noaa-jetstream-hydrologic-cycle.json';
import dnaFigureMeta from '../../../../data/figures/medlineplus-dna-structure-1.json';
import dnaFigureLabels from '../../../../data/figures/medlineplus-dna-structure-1.labels.json';
import dnaFigureUrl from '../../../../data/figures/medlineplus-dna-structure-1.jpg?url';
import waterFigureMeta from '../../../../data/figures/noaa-hydrologic-cycle-1.json';
import waterFigureLabels from '../../../../data/figures/noaa-hydrologic-cycle-1.labels.json';
import waterFigureUrl from '../../../../data/figures/noaa-hydrologic-cycle-1.jpg?url';
import type { Provenance, SourceDocument } from '../../../../packages/contracts/index.ts';
import type { LabelDiagramGen, LabelDiagramSpec, LessonSpec } from '../../../../packages/contracts/kit.ts';
import { buildLabelDiagramDemos } from '../lib/labelDiagramDemoSpecs.ts';
import type { FigureLabelsLike, FigureMetaLike, LabelDiagramDemo } from '../lib/labelDiagramDemoSpecs.ts';
import { presentRequest } from '../lib/presentation.ts';
import type { Deck } from '../lib/presentation.ts';
import { AppWindow } from './AppWindow.tsx';
import { LessonView } from './LessonView.tsx';
import { FigureSrcContext, LabelDiagramView } from './LabelDiagramView.tsx';
import { WATER_OUTLINES } from '../lib/labelOutline.fixtures.ts';
import { Provenance as ProvenanceLine } from './Provenance.tsx';
import { PresentationMode } from './presentation/PresentationMode.tsx';
import type { CiteProps } from './Explanations.tsx';

const DISCLOSURE = 'Demo fixture: the golden label-diagram parts with hand-made region boxes, and parts and SAM 3.1 regions copied from four stored live runs, each figure with its stored label boxes. Real lessons are written by Muse Spark 1.3 and segmented by SAM 3.1.';
const DECK_JOB = 'demo-engines-c';

type Meta = { id: string; title: string; locator: string; license: string; attribution: string; sha256: string };
const doc = (m: Meta): SourceDocument => ({ id: m.id, title: m.title, locator: m.locator, license: m.license, attribution: m.attribution, sha256: m.sha256, text: '' } as SourceDocument);
const sources: Record<string, SourceDocument> = { [srcDna.id]: doc(srcDna as Meta), [srcWater.id]: doc(srcWater as Meta) };

const tabs: LabelDiagramDemo[] = buildLabelDiagramDemos(
  labelGolden as LabelDiagramGen, { meta: dnaFigureMeta as FigureMetaLike, labels: dnaFigureLabels as FigureLabelsLike }, provenance as unknown as Provenance, sources,
  { meta: waterFigureMeta as FigureMetaLike, labels: waterFigureLabels as FigureLabelsLike },
);
const FIGURES: Readonly<Record<string, string>> = { [dnaFigureMeta.id]: dnaFigureUrl, [waterFigureMeta.id]: waterFigureUrl };
const figureSrc = (id: string): string => FIGURES[id] ?? `/api/figures/${encodeURIComponent(id)}/image`;

/**
 * Stage 8c build harness (&build=outline | box): the water-cycle demo-set part with SAM 3.1's traced outlines from the
 * mask probe (lib/labelOutline.fixtures.ts) or with its stored boxes only, played as the build's draw-in. Evaporation
 * (0.28 sure) must draw nothing either way.
 */
function withOutlines(spec: LabelDiagramSpec): LabelDiagramSpec {
  return { ...spec, regions: spec.regions.map((r) => (WATER_OUTLINES[r.partId] === undefined ? r : { ...r, outline: WATER_OUTLINES[r.partId] })) };
}

function BuildHarness({ t, mode, cite }: { t: LabelDiagramDemo; mode: 'outline' | 'box'; cite: CiteProps }) {
  const [run, setRun] = useState(0);
  const spec = useMemo(() => (mode === 'outline' ? withOutlines(t.spec) : t.spec), [t, mode]);
  return (
    <section className="demo-build" data-testid="build-harness" data-mode={mode}>
      <p className="muted small">Build draw-in: {mode === 'outline' ? 'SAM 3.1 traced outlines (mask probe of the demo-set run)' : 'stored region boxes (no outlines)'}.</p>
      <button type="button" className="btn btn-small" onClick={() => setRun((n) => n + 1)}>Play the draw-in again</button>
      <LabelDiagramView key={run} spec={spec} cite={cite} build />
    </section>
  );
}

function lessonOf(t: LabelDiagramDemo): LessonSpec {
  return { jobId: `demo-${t.id}`, analysisRef: '', overview: null, components: [{ componentId: 'label-diagram-v1', specId: t.spec.id, status: 'passed', reason: '', revision: 1 }] };
}

/** Every demo spec as one presentation deck (title, one engine beat per part, closing). */
function demoDeck(): Deck {
  return {
    jobId: DECK_JOB, headline: 'Label the DNA diagram', source: null, disclosure: DISCLOSURE, overview: null, objectives: [],
    parts: tabs.map((t) => ({ kind: 'kit', spec: t.spec })), leftOut: 0, checks: null, quotes: null,
  };
}

/**
 * Dev-only harness for the label-diagram view (slice U). Each tab is one fixture part in the real lesson frame;
 * "Present" opens all of them as a presentation deck (one engine beat per part).
 */
export function EngineDemoC() {
  const params = new URLSearchParams(window.location.search);
  const [id, setId] = useState(() => (tabs.some((t) => t.id === params.get('tab')) ? (params.get('tab') as string) : (tabs[0]?.id ?? '')));
  const asked = presentRequest(window.location.search);
  const [presenting, setPresenting] = useState<number | null>(asked !== null && asked.jobId === DECK_JOB ? asked.beat : null);
  const [toast, setToast] = useState('');
  const t = tabs.find((x) => x.id === id) ?? tabs[0];
  const buildMode = params.get('build') === 'outline' ? 'outline' : params.get('build') === 'box' ? 'box' : null;
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
    <FigureSrcContext.Provider value={figureSrc}>
      <AppWindow title="Make knowledge interactive · label the diagram (demo)">
        <div className="window-body window-body-plain">
          <div className="demo-page">
            <h1 className="sr-only">Label-the-diagram view (fixture data)</h1>
            <div className="demo-banner" role="note" data-testid="demo-banner">
              <strong>DEMO — fixture data, not model output.</strong>{' '}
              The committed golden parts (hand-made regions standing in for SAM 3.1), and the parts and SAM 3.1 regions of four stored live runs, on the real figures with their stored label boxes. This page exists only in development.
            </div>
            <nav className="demo-tabs" aria-label="Demo parts">
              {tabs.map((x) => (
                <button key={x.id} type="button" className={`btn btn-small${x.id === t.id ? ' btn-primary' : ''}`} aria-current={x.id === t.id ? 'page' : undefined} onClick={() => choose(x.id)}>{x.tab}</button>
              ))}
              <button type="button" className="btn btn-small" onClick={() => setPresenting(1 + tabs.indexOf(t))}>Present</button>
            </nav>
            <p className="muted small demo-note">{t.note}</p>
            <main className="activity-panel demo-main" aria-label="Interactive lesson">
              {buildMode !== null ? <BuildHarness t={t} mode={buildMode} cite={cite} /> : <LessonView
                key={t.id} lesson={lessonOf(t)} specs={{ [t.spec.id]: t.spec }} analysis={null} sources={t.spec.sources}
                cite={cite} disclosure={DISCLOSURE} provenance={<ProvenanceLine disclosure={DISCLOSURE} phrases={[]} />}
              />}
            </main>
            <p className="demo-toast small" role="status" aria-live="polite">{toast}</p>
          </div>
        </div>
        {presenting !== null && <PresentationMode deck={deck} quotes={[]} sourceId={t.sourceId} repairBadge={null} startBeat={presenting} onExit={exit} />}
      </AppWindow>
    </FigureSrcContext.Provider>
  );
}
