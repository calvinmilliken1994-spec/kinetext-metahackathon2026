// Stage 8a dev-only harness for web slice W-A (?engine-demo=a); owned by that slice. Not bundled in production: main.tsx
// imports it behind import.meta.env.DEV. It shows the algorithm tracer and the log ladder on fixture specs (the two
// goldens in tests/fixtures/stage6 and hand-written specs quoting real library pages), in the lesson column next to the
// page text, and inside a presentation stage driven like the deck (→ ← R). Nothing here calls a model or the API.
//
// URL: ?engine-demo=a[&spec=<id>][&mode=lesson|stage][&step=N][&revealed=1]
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import algorithmGolden from '../../../../tests/fixtures/stage6/algorithm-trace.gen.json';
import ladderGolden from '../../../../tests/fixtures/stage6/log-ladder.gen.json';
import provenance from '../../../../tests/fixtures/provenance.fixture.json';
import metaBinary from '../../../../data/sources/nist-dads-binary-search.json';
import metaBubble from '../../../../data/sources/nist-dads-bubble-sort.json';
import metaMerge from '../../../../data/sources/nist-dads-merge-sort.json';
import metaQuick from '../../../../data/sources/nist-dads-quicksort.json';
import metaQuake from '../../../../data/sources/usgs-earthquake-magnitude-energy-intensity.json';
import metaPh from '../../../../data/sources/usgs-wss-ph-and-water.json';
import textBinary from '../../../../data/sources/nist-dads-binary-search.txt?raw';
import textBubble from '../../../../data/sources/nist-dads-bubble-sort.txt?raw';
import textMerge from '../../../../data/sources/nist-dads-merge-sort.txt?raw';
import textQuick from '../../../../data/sources/nist-dads-quicksort.txt?raw';
import textQuake from '../../../../data/sources/usgs-earthquake-magnitude-energy-intensity.txt?raw';
import textPh from '../../../../data/sources/usgs-wss-ph-and-water.txt?raw';
import type { Provenance, SourceDocument } from '../../../../packages/contracts/index.ts';
import { assembleKitSpec, kitSpecId } from '../../../../packages/contracts/kit.ts';
import type { AlgorithmTraceGen, AlgorithmTraceSpec, LogLadderGen, LogLadderSpec } from '../../../../packages/contracts/kit.ts';
import { BINARY_SEARCH_GEN, BUBBLE_SORT_GEN, MERGE_SORT_GEN, QUICKSORT_GEN } from '../lib/algorithmDemoSpecs.ts';
import { algorithmPresentationSteps } from '../lib/algorithmView.ts';
import { collectLessonQuotes } from '../lib/lesson.ts';
import { linkKey, linkStore } from '../lib/linking.ts';
import { PH_LADDER_GEN } from '../lib/logLadderDemoSpecs.ts';
import { logLadderPresentationSteps } from '../lib/logLadderView.ts';
import { AlgorithmTraceView } from './AlgorithmTraceView.tsx';
import { AppWindow } from './AppWindow.tsx';
import type { CiteProps } from './Explanations.tsx';
import { Linked } from './Linked.tsx';
import { LogLadderView } from './LogLadderView.tsx';

interface Meta { id: string; title: string; locator: string; license: string; attribution: string; sha256: string }
type DemoSpec = AlgorithmTraceSpec | LogLadderSpec;
interface Demo { id: string; tab: string; note: string; spec: DemoSpec; text: string; pageTitle: string }

const doc = (m: Meta, text: string): SourceDocument => ({ id: m.id, title: m.title, locator: m.locator, license: m.license, attribution: m.attribution, sha256: m.sha256, text });

function build(): Demo[] {
  const job = 'demo-engines-a';
  const algo = (gen: AlgorithmTraceGen, m: Meta, text: string, seed: number): AlgorithmTraceSpec =>
    assembleKitSpec(gen, 'algorithm-trace-v1', { id: kitSpecId(`${job}-${gen.algorithm}-${seed}`, 'algorithm-trace-v1', 1), sources: [doc(m, text)], provenance: provenance as unknown as Provenance, seed });
  const ladder = (gen: LogLadderGen, m: Meta, text: string, seed: number): LogLadderSpec =>
    assembleKitSpec(gen, 'log-ladder-v1', { id: kitSpecId(`${job}-ladder-${seed}`, 'log-ladder-v1', 1), sources: [doc(m, text)], provenance: provenance as unknown as Provenance, seed });
  return [
    { id: 'bubble', tab: 'Bubble sort', note: 'Hand-written spec quoting the NIST bubble sort page: will these two swap?', spec: algo(BUBBLE_SORT_GEN, metaBubble, textBubble, 1), text: textBubble, pageTitle: metaBubble.title },
    { id: 'binary', tab: 'Binary search', note: 'Hand-written spec quoting the NIST binary search page: left half, right half, or found?', spec: algo(BINARY_SEARCH_GEN, metaBinary, textBinary, 2), text: textBinary, pageTitle: metaBinary.title },
    { id: 'binary-golden', tab: 'Binary search (golden)', note: 'The golden fixture tests/fixtures/stage6/algorithm-trace.gen.json: the target is the first middle item.', spec: algo(algorithmGolden as AlgorithmTraceGen, metaBinary, textBinary, 3), text: textBinary, pageTitle: metaBinary.title },
    { id: 'merge', tab: 'Merge sort', note: 'Hand-written spec quoting the NIST merge sort page: which goes down next?', spec: algo(MERGE_SORT_GEN, metaMerge, textMerge, 4), text: textMerge, pageTitle: metaMerge.title },
    { id: 'quick', tab: 'Quicksort', note: 'Hand-written spec quoting the NIST quicksort page: where will the pivot settle?', spec: algo(QUICKSORT_GEN, metaQuick, textQuick, 5), text: textQuick, pageTitle: metaQuick.title },
    { id: 'ph', tab: 'pH ladder', note: 'Hand-written spec quoting the USGS “pH and Water” page: how many times more acidic?', spec: ladder(PH_LADDER_GEN, metaPh, textPh, 6), text: textPh, pageTitle: metaPh.title },
    { id: 'quake', tab: 'Magnitude ladder (golden)', note: 'The golden fixture tests/fixtures/stage6/log-ladder.gen.json on the USGS magnitude page.', spec: ladder(ladderGolden as LogLadderGen, metaQuake, textQuake, 7), text: textQuake, pageTitle: metaQuake.title },
  ];
}

function quotesOf(spec: DemoSpec): { sourceId: string; quote: string }[] {
  return spec.componentId === 'algorithm-trace-v1'
    ? [{ sourceId: spec.sourceId, quote: spec.quote }, ...spec.claims.map((c) => ({ sourceId: c.sourceId, quote: c.quote }))]
    : [{ sourceId: spec.sourceId, quote: spec.quote }, ...spec.rungs.map((r) => ({ sourceId: r.sourceId, quote: r.quote }))];
}

const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** A paragraph lights with a quote it contains, that contains it, or that starts inside it (a heading plus definition). */
function paragraphLinks(para: string, quotes: readonly { sourceId: string; quote: string }[]): string[] {
  const p = norm(para.replace(/^#\s*/, ''));
  return quotes.filter((q) => {
    const n = norm(q.quote);
    return p.includes(n) || n.includes(p) || p.includes(n.slice(0, 40)) || n.includes(p.slice(0, 40));
  }).map((q) => linkKey(q.sourceId, q.quote));
}

function PageText({ demo }: { demo: Demo }) {
  const quotes = quotesOf(demo.spec);
  const paras = demo.text.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p !== '');
  return (
    <aside className="ea-page" aria-label="Page text">
      <p className="ea-page-title">{demo.pageTitle}</p>
      <div className="ea-page-text">
        {paras.map((p, i) => {
          const links = paragraphLinks(p, quotes);
          return <Linked as="p" key={i} links={links} className={links.length > 0 ? 'ea-quoted' : undefined}>{p.replace(/^#\s*/, '')}</Linked>;
        })}
      </div>
    </aside>
  );
}

function View({ spec, cite, presentation }: { spec: DemoSpec; cite: CiteProps; presentation?: { mode: 'stage'; step: number; revealed: boolean } }) {
  return spec.componentId === 'algorithm-trace-v1'
    ? <AlgorithmTraceView spec={spec} cite={cite} presentation={presentation} />
    : <LogLadderView spec={spec} cite={cite} presentation={presentation} />;
}

const stepsOf = (spec: DemoSpec): number => (spec.componentId === 'algorithm-trace-v1' ? algorithmPresentationSteps(spec) : logLadderPresentationSteps(spec));

/** A copy of the deck's stage fit: the view at a fixed design width, zoomed to fill the stage. */
function FitStage({ children }: { children: ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  useLayoutEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (o === null || i === null) return undefined;
    const fit = (): void => setZoom(Math.min(o.clientWidth / 980, o.clientHeight / Math.max(1, i.offsetHeight + 16), 1.9));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(o);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={outer} className="pz-fit">
      <div className="pz-fit-zoom" style={{ zoom }}>
        <div ref={inner} className="pz-fit-inner" style={{ width: 980 }}>{children}</div>
      </div>
    </div>
  );
}

function Stage({ demo, cite, step, revealed, onExit, onStep, onReveal }: {
  demo: Demo; cite: CiteProps; step: number; revealed: boolean; onExit: () => void; onStep: (d: number) => void; onReveal: () => void;
}) {
  const n = stepsOf(demo.spec);
  const active = useSyncExternalStore(linkStore.subscribe, linkStore.get);
  const quotes = quotesOf(demo.spec);
  const hovered = active === null ? null : quotes.find((q) => active.keys.includes(linkKey(q.sourceId, q.quote))) ?? null;
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); onStep(1); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); onStep(-1); }
      if (e.key === 'r' || e.key === 'R') onReveal();
      if (e.key === 'Escape') onExit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onExit, onStep, onReveal]);
  return (
    <div className="pz" role="dialog" aria-modal="true" aria-label={`Presenting: ${demo.spec.title}`} data-testid="ea-stage">
      <div className="pz-stage-frame">
        <div className="pz-beat" data-kind="engine" data-revealed={revealed ? 'true' : 'false'}>
          <div className="pz-stage" data-part={demo.spec.componentId}>
            <h2 className="pz-heading">{demo.spec.title}</h2>
            <FitStage><View spec={demo.spec} cite={cite} presentation={{ mode: 'stage', step, revealed }} /></FitStage>
          </div>
        </div>
        <Linked as="figure" className="pz-zone" links={hovered === null ? [] : [linkKey(hovered.sourceId, hovered.quote)]} data-filled={hovered === null ? 'false' : 'true'}>
          {hovered !== null && <><figcaption>The page says</figcaption><blockquote>“{hovered.quote}”</blockquote></>}
        </Linked>
      </div>
      <p className="ea-stage-bar" data-testid="ea-stage-bar">
        Harness stage · step {step + 1} of {n}{revealed ? ' · revealed' : ''} · <kbd>→</kbd> next <kbd>←</kbd> back <kbd>R</kbd> reveal <kbd>Esc</kbd> lesson view
      </p>
    </div>
  );
}

function readParams(demos: readonly Demo[]): { id: string; mode: 'lesson' | 'stage'; step: number; revealed: boolean } {
  const q = new URLSearchParams(window.location.search);
  const id = demos.some((d) => d.id === q.get('spec')) ? (q.get('spec') as string) : (demos[0]?.id ?? 'bubble');
  return { id, mode: q.get('mode') === 'stage' ? 'stage' : 'lesson', step: Math.max(0, Number(q.get('step') ?? 0) || 0), revealed: q.get('revealed') === '1' };
}

export function EngineDemoA() {
  const demos = useMemo(build, []);
  const [state, setState] = useState(() => readParams(demos));
  const [toast, setToast] = useState('');
  const demo = demos.find((d) => d.id === state.id) ?? demos[0];
  const located = useMemo(() => new Set(demo === undefined ? [] : collectLessonQuotes(demo.spec.sourceId, null, { [demo.spec.id]: demo.spec }).map((q) => q.key)), [demo]);
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('spec', state.id);
    url.searchParams.set('mode', state.mode);
    url.searchParams.set('step', String(state.step));
    if (state.revealed) url.searchParams.set('revealed', '1'); else url.searchParams.delete('revealed');
    window.history.replaceState(null, '', url);
  }, [state]);
  if (demo === undefined) return null;
  const cite: CiteProps = { sourceId: demo.spec.sourceId, located, onCite: (key) => setToast(`Demo: in the workspace this highlights the quote in the source panel (${key}).`) };
  const n = stepsOf(demo.spec);

  return (
    <AppWindow title="Make knowledge interactive · algorithm tracer and log ladder demo">
      <div className="window-body window-body-plain">
        <div className="demo-page">
          <h1 className="sr-only">Algorithm tracer and log ladder demo (fixture data)</h1>
          <div className="demo-banner" role="note" data-testid="demo-banner">
            <strong>DEMO — fixture data, not model output.</strong>{' '}
            Specs are the Stage 6 golden fixtures and hand-written specs quoting real library pages, shown with the real views. Nothing here was generated by a model. This page exists only in development.
          </div>
          <nav className="demo-tabs ea-tabs" aria-label="Demo specs">
            {demos.map((d) => (
              <button key={d.id} type="button" className={`btn btn-small${d.id === demo.id ? ' btn-primary' : ''}`} aria-current={d.id === demo.id ? 'page' : undefined} onClick={() => { setState((s) => ({ ...s, id: d.id, step: 0, revealed: false })); setToast(''); }}>{d.tab}</button>
            ))}
            <button type="button" className="btn btn-small ea-present" onClick={() => setState((s) => ({ ...s, mode: 'stage', step: 0, revealed: false }))}>Present this part</button>
          </nav>
          <p className="muted small demo-note ea-note">{demo.note}</p>
          <div className="ea-layout">
            <PageText demo={demo} />
            <main className="activity-panel ea-main" aria-label="Interactive lesson">
              <article className="card kit-card" data-component={demo.spec.componentId} data-status="passed">
                <header className="kit-head">
                  <h2>{demo.spec.title}</h2>
                  <p className="card-meta"><span>{demo.spec.componentId === 'algorithm-trace-v1' ? 'Step through the algorithm' : 'Climb the scale'}</span><span>Demo fixture</span></p>
                </header>
                <View key={demo.id} spec={demo.spec} cite={cite} />
              </article>
              <p className="demo-toast small" role="status" aria-live="polite">{toast}</p>
            </main>
          </div>
        </div>
      </div>
      {state.mode === 'stage' && (
        <Stage
          key={demo.id}
          demo={demo}
          cite={cite}
          step={Math.min(state.step, n - 1)}
          revealed={state.revealed}
          onExit={() => setState((s) => ({ ...s, mode: 'lesson' }))}
          onStep={(d) => setState((s) => ({ ...s, step: Math.min(n - 1, Math.max(0, Math.min(s.step, n - 1) + d)), revealed: false }))}
          onReveal={() => setState((s) => ({ ...s, revealed: true }))}
        />
      )}
    </AppWindow>
  );
}
