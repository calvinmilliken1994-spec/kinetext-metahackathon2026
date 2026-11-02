// Stage 10c Welcome v2: what sits behind and beside the Get started card. The page's own sentences drift behind
// everything (aria-hidden), and the pinned demo run's figure is the centrepiece: the boxes the models stored trace in
// part by part (Muse Spark located, SAM 3.1 confirmed), each part's page sentence lights up as it is located, the
// numbers land in page order, hold, fade, and the loop starts again. All data is the stored run and the stored page
// (lib/welcomeBackdrop.ts); motion is CSS keyframes on opacity and transform only (styles/welcome.css), paused until the
// figure has loaded and replaced by a still frame under prefers-reduced-motion.
import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { api } from '../api.ts';
import { glowStyle } from '../lib/labelDiagramView.ts';
import {
  backdropSentences, WELCOME_FIGURE_JOB, WELCOME_SOURCE_ID, welcomeFigure, welcomeMarkerSpots,
} from '../lib/welcomeBackdrop.ts';
import type { BackdropSentence, WelcomeFigure } from '../lib/welcomeBackdrop.ts';
import { FigureSrcContext } from './LabelDiagramView.tsx';

/** About a screenful of page text at every target size (the type scales with the window width). */
const TEXT_BUDGET = 2100;

export type FigureState = { state: 'loading' } | { state: 'ready'; figure: WelcomeFigure } | { state: 'none' };

/** Loads the pinned run (GET only) and its page. A run that cannot load leaves the page text, never a broken frame. */
export function useWelcomeBackdrop(): { figure: FigureState; sentences: BackdropSentence[] } {
  const [figure, setFigure] = useState<FigureState>({ state: 'loading' });
  const [sentences, setSentences] = useState<BackdropSentence[]>([]);
  useEffect(() => {
    const ac = new AbortController();
    const text = (sourceId: string, quotes: string[]): void => {
      api.source(sourceId, ac.signal).then(
        (doc) => { if (!ac.signal.aborted) setSentences(backdropSentences(typeof doc.text === 'string' ? doc.text : '', quotes, TEXT_BUDGET)); },
        () => { /* no page text: a plain backdrop */ },
      );
    };
    api.job(WELCOME_FIGURE_JOB, ac.signal).then(
      (detail) => {
        if (ac.signal.aborted) return;
        const f = welcomeFigure(detail);
        setFigure(f === null ? { state: 'none' } : { state: 'ready', figure: f });
        text(f?.sourceId ?? WELCOME_SOURCE_ID, f === null ? [] : f.parts.map((p) => p.quote));
      },
      () => {
        if (ac.signal.aborted) return;
        setFigure({ state: 'none' });
        text(WELCOME_SOURCE_ID, []);
      },
    );
    return () => ac.abort();
  }, []);
  return { figure, sentences };
}

/** The drifting page text. Cited sentences carry their part's index, so each lights up when its part is located. */
export function WelcomePageText({ sentences }: { sentences: readonly BackdropSentence[] }) {
  return (
    <div className="wl-backdrop" aria-hidden="true">
      <p className="wl-pagetext" data-filled={sentences.length > 0 ? 'true' : 'false'}>
        {sentences.map((s, i) => (
          <span key={i} className={s.cite === null ? 'wl-sent' : 'wl-sent wl-cite'} style={s.cite === null ? undefined : ({ '--i': s.cite } as CSSProperties)}>
            {s.text}{' '}
          </span>
        ))}
      </p>
    </div>
  );
}

/** Marker centres, measured once per rendered size (numbers keep clear of the printed labels). */
function useSpots(plate: HTMLDivElement | null, figure: WelcomeFigure): { left: number; top: number }[] {
  const [spots, setSpots] = useState<{ key: string; list: { left: number; top: number }[] } | null>(null);
  useLayoutEffect(() => {
    if (plate === null) return undefined;
    const measure = (): void => {
      const W = plate.clientWidth;
      const H = plate.clientHeight;
      const m = (plate.querySelector<HTMLElement>('.wl-num')?.offsetWidth ?? 28) + 4;
      const list = welcomeMarkerSpots(figure, W, H, m);
      const key = list.map((p) => `${p.left.toFixed(2)},${p.top.toFixed(2)}`).join(';');
      setSpots((prev) => (prev !== null && prev.key === key ? prev : { key, list }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(plate);
    return () => ro.disconnect();
  }, [plate, figure]);
  return spots?.list ?? figure.parts.map((p) => p.point);
}

/**
 * The centrepiece: the page's real figure, dimmed, with the run's stored boxes and numbers. `onImage` reports when the
 * image is ready, so the Welcome starts (unpauses) the loop over a drawn figure, never an empty plate.
 */
export function WelcomeFigurePlate({ figure, onImage }: { figure: WelcomeFigure; onImage: (ready: boolean) => void }) {
  const srcOf = useContext(FigureSrcContext);
  const [plate, setPlate] = useState<HTMLDivElement | null>(null);
  const [failed, setFailed] = useState(false);
  const spots = useSpots(plate, figure);
  const reported = useRef(false);
  const ready = useCallback(() => { if (!reported.current) { reported.current = true; onImage(true); } }, [onImage]);
  const imgRef = useCallback((el: HTMLImageElement | null) => { if (el?.complete === true && el.naturalWidth > 0) ready(); }, [ready]);
  const alt = figure.caption === '' ? 'The page’s figure' : `The page’s figure: ${figure.caption}`;
  return (
    <figure className="wl-figure" data-testid="welcome-figure" style={{ '--wl-aspect': figure.aspect } as CSSProperties}>
      <div className="wl-plate" ref={setPlate}>
        {failed
          ? <p className="wl-missing">The figure could not be loaded.</p>
          : <img src={srcOf(figure.figureId)} alt={alt} draggable={false} ref={imgRef} onLoad={ready} onError={() => { setFailed(true); ready(); }} />}
        {/* SAM 3.1's own outlines of each part, traced in on the figure's pixel grid before the glow settles */}
        <svg className="wl-outlines" viewBox={figure.viewBox} preserveAspectRatio="none" aria-hidden="true">
          {figure.parts.map((p, i) => (p.outline === null ? null
            : <path key={`o${p.number}`} className="wl-outline" d={p.outline} pathLength={1} style={{ '--i': i } as CSSProperties} />))}
        </svg>
        <div className="wl-marks" aria-hidden="true">
          {figure.parts.map((p, i) => (
            <span key={`b${p.number}`} style={{ '--i': i } as CSSProperties}>
              {p.ground !== null && <span className="wl-ground" style={glowStyle(p.ground, 2)} />}
              {p.glow !== null && <span className="wl-glow" style={glowStyle(p.glow)} />}
            </span>
          ))}
          {figure.parts.map((p, i) => {
            const at = spots[i] ?? p.point;
            return <span key={`n${p.number}`} className="wl-num" style={{ '--i': i, left: `${at.left}%`, top: `${at.top}%` } as CSSProperties}>{p.number}</span>;
          })}
        </div>
      </div>
      <figcaption className="wl-figcap">
        <span className="wl-figcap-run">{figure.note.map((s, i) => <span key={i}>{s}</span>)}</span>
        {figure.credit !== '' && <span className="wl-figcap-credit">Figure and page text: {figure.credit}</span>}
      </figcaption>
    </figure>
  );
}

