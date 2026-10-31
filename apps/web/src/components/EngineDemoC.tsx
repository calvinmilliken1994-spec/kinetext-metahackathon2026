// Stage 8b dev-only harness for web slice U (?engine-demo=c[&tab=<id>][&present=demo-engines-c&beat=N]); owned by that
// slice. Not bundled in production (main.tsx imports it dynamically behind import.meta.env.DEV). The parts are the
// committed golden (tests/fixtures/stage6/label-diagram.gen.json); the region boxes are hand-made, NOT SAM output. The
// figure is the committed file data/figures/medlineplus-dna-structure-1.jpg served by Vite instead of the API.
import { useMemo, useState } from 'react';
import labelGolden from '../../../../tests/fixtures/stage6/label-diagram.gen.json';
import provenance from '../../../../tests/fixtures/provenance.fixture.json';
import srcDna from '../../../../data/sources/medlineplus-what-is-dna.json';
import dnaFigureMeta from '../../../../data/figures/medlineplus-dna-structure-1.json';
import dnaFigureUrl from '../../../../data/figures/medlineplus-dna-structure-1.jpg?url';
import type { Provenance, SourceDocument } from '../../../../packages/contracts/index.ts';
import type { LabelDiagramGen, LessonSpec } from '../../../../packages/contracts/kit.ts';
import { buildLabelDiagramDemos } from '../lib/labelDiagramDemoSpecs.ts';
import type { FigureMetaLike, LabelDiagramDemo } from '../lib/labelDiagramDemoSpecs.ts';
import { presentRequest } from '../lib/presentation.ts';
import type { Deck } from '../lib/presentation.ts';
import { AppWindow } from './AppWindow.tsx';
import { LessonView } from './LessonView.tsx';
import { FigureSrcContext } from './LabelDiagramView.tsx';
import { Provenance as ProvenanceLine } from './Provenance.tsx';
import { PresentationMode } from './presentation/PresentationMode.tsx';
import type { CiteProps } from './Explanations.tsx';

const DISCLOSURE = 'Demo fixture: the golden label-diagram parts with hand-made region boxes. Real lessons are written by Muse Spark 1.3 and segmented by SAM 3.1.';
const DECK_JOB = 'demo-engines-c';

type Meta = { id: string; title: string; locator: string; license: string; attribution: string; sha256: string };
const doc = (m: Meta): SourceDocument => ({ id: m.id, title: m.title, locator: m.locator, license: m.license, attribution: m.attribution, sha256: m.sha256, text: '' } as SourceDocument);
const sources: Record<string, SourceDocument> = { [srcDna.id]: doc(srcDna as Meta) };

const tabs: LabelDiagramDemo[] = buildLabelDiagramDemos(labelGolden as LabelDiagramGen, dnaFigureMeta as FigureMetaLike, provenance as unknown as Provenance, sources);
const FIGURES: Readonly<Record<string, string>> = { [dnaFigureMeta.id]: dnaFigureUrl };
const figureSrc = (id: string): string => FIGURES[id] ?? `/api/figures/${encodeURIComponent(id)}/image`;

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
              The committed golden parts on the real MedlinePlus DNA figure, with hand-made region boxes standing in for SAM 3.1. This page exists only in development.
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
    </FigureSrcContext.Provider>
  );
}
