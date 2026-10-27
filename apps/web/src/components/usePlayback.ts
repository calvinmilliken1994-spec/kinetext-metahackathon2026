// Real-time playback clock for the closed-form views. Simulated time advances at `speed` x wall clock;
// when `durationS` is finite playback stops there, when it is Infinity it runs until paused.

import { useCallback, useEffect, useRef, useState } from 'react';

export interface PlaybackCtl {
  t: number;
  playing: boolean;
  play: () => void;
  pause: () => void;
  /** Back to the initial time, paused. */
  reset: () => void;
  scrub: (t: number) => void;
  /** Rewind and play (predict-then-run, parameter change while playing). */
  restart: () => void;
  /** Rewind to the initial time, keeping the play state. */
  rewind: () => void;
}

export function usePlayback(durationS: number, speed: number, initialT: number): PlaybackCtl {
  const [t, setT] = useState(initialT);
  const [playing, setPlaying] = useState(false);
  const tRef = useRef(initialT);
  const setTime = useCallback((v: number) => { tRef.current = v; setT(v); }, []);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const frame = (ts: number): void => {
      const dt = Math.min(0.1, Math.max(0, (ts - last) / 1000)); // a background tab cannot jump ahead
      last = ts;
      const next = tRef.current + dt * speed;
      if (next >= durationS) {
        setTime(durationS);
        setPlaying(false);
        return;
      }
      setTime(next);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [playing, durationS, speed, setTime]);

  const play = useCallback(() => {
    if (tRef.current >= durationS - 1e-9) setTime(initialT);
    setPlaying(true);
  }, [durationS, initialT, setTime]);
  const pause = useCallback(() => setPlaying(false), []);
  const reset = useCallback(() => { setPlaying(false); setTime(initialT); }, [initialT, setTime]);
  const scrub = useCallback((v: number) => { setPlaying(false); setTime(Math.min(Math.max(v, 0), durationS)); }, [durationS, setTime]);
  const restart = useCallback(() => { setTime(initialT); setPlaying(true); }, [initialT, setTime]);
  const rewind = useCallback(() => setTime(initialT), [initialT, setTime]);
  return { t, playing, play, pause, reset, scrub, restart, rewind };
}
