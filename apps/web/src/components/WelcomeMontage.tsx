// Welcome v3 (docs/specs/WELCOME-V3-split.md; Calvin 3 Nov: "page becomes lesson", "fast paced with jumps"). The right
// half of the Welcome: a fast montage over the published lessons. Each beat (BEAT_MS) is one lesson: an excerpt of its
// page with the cited sentence lit, then (PART_AT_MS) the part written from it snaps out beside it on a thin line, then
// a hard cut to the next lesson in another place on the stage. Data: GET /api/jobs/:id and /api/sources/:id for the runs
// in lib/welcomeMontage.ts, figures preloaded before their beat plays. Motion is CSS keyframes on transform and opacity
// only, restarted by remounting the beat (styles/welcome.css); reduced motion shows one still beat. Decorative for
// assistive tech (one hidden sentence says what it shows); the sign-in on the left is the page's content.
import { Fragment, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { api } from '../api.ts';
import {
  BEAT_MS, MONTAGE_JOBS, MONTAGE_LABEL, montageBeats, montageLesson, nextPlayable, PART_AT_MS,
} from '../lib/welcomeMontage.ts';
import type { MontageBeat, MontageJob } from '../lib/welcomeMontage.ts';
import { FigureSrcContext } from './LabelDiagramView.tsx';
import { PartPreviewView } from './PartPreview.tsx';

type Loaded = { state: 'loading' } | { state: 'ready'; beats: MontageBeat[] } | { state: 'none' };

/** Loads every montage run and its page (GET only). A run or page that fails to load is skipped. */
function useMontageBeats(): Loaded {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  useEffect(() => {
    const ac = new AbortController();
    const one = (id: string) => api.job(id, ac.signal).then(
      (job) => api.source(job.summary.sourceId, ac.signal).then(
        (src) => montageLesson(job as unknown as MontageJob, src),
        () => null,
      ),
      () => null,
    );
    Promise.all(MONTAGE_JOBS.map(one)).then((lessons) => {
      if (ac.signal.aborted) return;
      const beats = montageBeats(lessons);
      setLoaded(beats.length === 0 ? { state: 'none' } : { state: 'ready', beats });
    });
    return () => ac.abort();
  }, []);
  return loaded;
}

/** Figures load before their beat may play; a figure that fails takes its beat out of the montage. */
function useFigures(beats: readonly MontageBeat[]): ('ok' | 'wait' | 'fail')[] {
  const srcOf = useContext(FigureSrcContext);
  const [state, setState] = useState<Record<string, 'ok' | 'fail'>>({});
  useEffect(() => {
    const imgs: HTMLImageElement[] = [];
    let live = true;
    for (const b of beats) {
      if (b.preview.kind !== 'label-diagram') continue;
      const id = b.preview.figureId;
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => { if (live) setState((s) => ({ ...s, [id]: 'ok' })); };
      img.onerror = () => { if (live) setState((s) => ({ ...s, [id]: 'fail' })); };
      img.src = srcOf(id);
      imgs.push(img);
    }
    return () => { live = false; for (const i of imgs) { i.onload = null; i.onerror = null; } };
  }, [beats, srcOf]);
  return beats.map((b) => (b.preview.kind === 'label-diagram' ? state[b.preview.figureId] ?? 'wait' : 'ok'));
}

function useReducedMotion(): boolean {
  const query = '(prefers-reduced-motion: reduce)';
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = (): void => setReduced(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return reduced;
}

function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden');
  useEffect(() => {
    const on = (): void => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  return visible;
}

/** One beat. Measures once on mount: the card centres on the lit sentence and the line joins them across the gap. */
function Beat({ beat }: { beat: MontageBeat }) {
  const root = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLElement>(null);
  const lit = useRef<HTMLSpanElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const link = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const r = root.current;
    const s = sheet.current;
    const l = lit.current;
    const c = card.current;
    const k = link.current;
    if (r === null || s === null || l === null || c === null || k === null) return;
    const R = r.getBoundingClientRect();
    const S = s.getBoundingClientRect();
    const lines = l.getClientRects();
    const first = lines[0];
    const last = lines[lines.length - 1];
    if (first === undefined || last === undefined) return;
    const y = (first.top + last.bottom) / 2 - R.top;
    const h = c.offsetHeight;
    const top = Math.round(Math.min(Math.max(y - h / 2, 0), Math.max(0, R.height - h)));
    c.style.top = `${top}px`;
    const C = c.getBoundingClientRect();
    const start = beat.frame.side === 'start';
    const from = start ? S.right : C.right;
    const to = start ? C.left : S.left;
    k.style.top = `${Math.round(y)}px`;
    k.style.left = `${Math.round(from - R.left)}px`;
    k.style.width = `${Math.max(0, Math.round(to - from))}px`;
  }, [beat]);

  return (
    <div className="wm-beat" ref={root} data-side={beat.frame.side} data-drop={beat.frame.drop} data-kind={beat.preview.kind}>
      <article className="wm-sheet" ref={sheet}>
        <p className="wm-page-title">{beat.pageTitle}</p>
        <div className="wm-excerpt">
          {beat.excerpt.blocks.map((b, bi) => (
            <p key={bi} className={`wm-${b.kind}`}>
              {b.pieces.map((p, pi) => (
                <Fragment key={pi}>{pi > 0 && ' '}{p.lit ? <span className="wm-lit" ref={lit}>{p.text}</span> : p.text}</Fragment>
              ))}
            </p>
          ))}
        </div>
        {beat.publisher !== '' && <p className="wm-publisher">{beat.publisher}</p>}
      </article>
      <span className="wm-link" ref={link}><span className="wm-link-line" /></span>
      <div className="wm-card" ref={card}>
        <PartPreviewView preview={beat.preview} />
      </div>
    </div>
  );
}

/** A calm still for when no published lesson could be loaded: the shape of a page and a part, no words, no motion. */
function Still() {
  return (
    <div className="wm-still" aria-hidden="true">
      <span className="wm-still-sheet"><i /><i /><i /><i /><i /></span>
      <span className="wm-still-card"><i /><i /><i /></span>
    </div>
  );
}

export function WelcomeMontage() {
  const loaded = useMontageBeats();
  const beats = loaded.state === 'ready' ? loaded.beats : [];
  const figures = useFigures(beats);
  const reduced = useReducedMotion();
  const visible = usePageVisible();
  const [index, setIndex] = useState(0);
  const playable = figures.map((f) => f === 'ok');
  const current = beats[index];
  const status = figures[index];

  // A beat whose figure failed gives way to the next one that can play.
  const key = playable.map((p) => (p ? 1 : 0)).join('');
  useEffect(() => {
    if (status === 'fail') setIndex((i) => nextPlayable(i, key.split('').map((c) => c === '1')));
  }, [status, key]);

  // The clock: one beat, then a hard cut. Waits for the current beat's figure; stops when hidden or under reduced motion.
  useEffect(() => {
    if (reduced || !visible || status !== 'ok' || beats.length < 2) return undefined;
    const t = window.setTimeout(() => setIndex((i) => nextPlayable(i, key.split('').map((c) => c === '1'))), BEAT_MS);
    return () => window.clearTimeout(t);
  }, [index, reduced, visible, status, beats.length, key]);

  const none = loaded.state === 'none' || (beats.length > 0 && figures.every((f) => f === 'fail'));
  const showing = current !== undefined && status === 'ok' ? current : null;
  const style = { '--wm-beat': `${BEAT_MS}ms`, '--wm-part': `${PART_AT_MS}ms`, '--wm-i': index, '--wm-n': Math.max(1, beats.length) } as CSSProperties;
  return (
    <section className="wm" style={style} data-state={none ? 'none' : showing === null ? 'loading' : 'playing'} data-testid="welcome-montage">
      <p className="sr-only">
        Examples from published lessons: a sentence from a source page, and the lesson part that was written from it.
      </p>
      <div className="wm-stage" aria-hidden="true">
        {none ? <Still /> : showing !== null && <Beat key={`${index}-${showing.jobId}`} beat={showing} />}
      </div>
      <div className="wm-foot" aria-hidden="true">
        <p className="wm-cap">
          <span className="wm-cap-label">{MONTAGE_LABEL}</span>
          {showing?.caption.map((c, i) => <span key={i}>{c}</span>)}
        </p>
        {beats.length > 1 && !reduced && (
          <span className="wm-ticks">
            {beats.map((b) => <i key={b.jobId} />)}
            <b className="wm-tick-on" />
          </span>
        )}
      </div>
    </section>
  );
}
