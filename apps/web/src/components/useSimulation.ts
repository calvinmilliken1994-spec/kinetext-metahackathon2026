// Simulation state + real-time playback. All physics comes from the SAME engine the validator ran
// (packages/activities/forces-1d/engine.ts); nothing is re-derived here.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { accelerationOf, simulate, stateAt } from '../../../../packages/activities/forces-1d/engine.ts';
import type { Frame } from '../../../../packages/activities/forces-1d/engine.ts';
import type { ForcesActivitySpec as ActivitySpec } from '../../../../packages/contracts/index.ts';
import { defaultInputs } from '../lib/engines.ts';

export interface SimControls {
  massKg: number;
  netForceN: number;
  t: number;
  playing: boolean;
  durationS: number;
  frames: Frame[];
  now: Frame;
  acceleration: number;
  /** Non-null when the engine rejected the current inputs (e.g. TOO_MANY_FRAMES). */
  engineError: string | null;
  setMass: (v: number) => void;
  setForce: (v: number) => void;
  play: () => void;
  pause: () => void;
  /** Back to the opening case (the lesson's first prediction) at t = 0, paused. */
  reset: () => void;
  scrub: (t: number) => void;
  /** Set both sliders, rewind and start playing (predict-then-run). */
  runWith: (massKg: number, netForceN: number) => void;
}

const ZERO: Frame = { t: 0, x: 0, v: 0, a: 0 };

export function useSimulation(spec: ActivitySpec): SimControls {
  const sim = spec.simulation;
  const durationS = sim.durationS;
  // Opens on the lesson's first case (clamped to the sliders); the spec defaults only when there is no case.
  const opening = useMemo(() => {
    const o = defaultInputs(spec);
    return { massKg: o['massKg'] ?? sim.massKg.default, netForceN: o['netForceN'] ?? sim.netForceN.default };
  }, [spec, sim]);
  const [massKg, setMassKg] = useState(opening.massKg);
  const [netForceN, setForceN] = useState(opening.netForceN);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const tRef = useRef(0);

  const setTime = useCallback((v: number) => { tRef.current = v; setT(v); }, []);

  const input = useMemo(
    () => ({ massKg, netForceN, durationS, stepS: sim.stepS }),
    [massKg, netForceN, durationS, sim.stepS],
  );

  const run = useMemo((): { frames: Frame[]; error: string | null } => {
    try {
      return { frames: simulate(input), error: null };
    } catch (e) {
      return { frames: [], error: e instanceof Error ? e.message : 'ENGINE_ERROR' };
    }
  }, [input]);

  const now = useMemo((): Frame => {
    try { return stateAt(input, t); } catch { return ZERO; }
  }, [input, t]);

  const acceleration = useMemo((): number => {
    try { return accelerationOf(massKg, netForceN); } catch { return 0; }
  }, [massKg, netForceN]);

  // requestAnimationFrame loop: simulation time advances in real time (1 s of sim = 1 s of wall clock).
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const frame = (ts: number): void => {
      const dt = Math.min(0.1, Math.max(0, (ts - last) / 1000)); // cap so a background tab can't jump ahead
      last = ts;
      const next = tRef.current + dt;
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
  }, [playing, durationS, setTime]);

  const play = useCallback(() => {
    if (tRef.current >= durationS - 1e-9) setTime(0);
    setPlaying(true);
  }, [durationS, setTime]);
  const pause = useCallback(() => setPlaying(false), []);
  const reset = useCallback(() => {
    setPlaying(false);
    setTime(0);
    setMassKg(opening.massKg);
    setForceN(opening.netForceN);
  }, [opening, setTime]);
  const scrub = useCallback((v: number) => { setPlaying(false); setTime(Math.min(Math.max(v, 0), durationS)); }, [durationS, setTime]);
  // Changing a parameter changes the whole trajectory, so restart from t = 0 (play state is kept).
  const setMass = useCallback((v: number) => { setMassKg(v); setTime(0); }, [setTime]);
  const setForce = useCallback((v: number) => { setForceN(v); setTime(0); }, [setTime]);
  const runWith = useCallback((m: number, f: number) => {
    setMassKg(m);
    setForceN(f);
    setTime(0);
    setPlaying(true);
  }, [setTime]);

  return {
    massKg, netForceN, t, playing, durationS, frames: run.frames, now, acceleration, engineError: run.error,
    setMass, setForce, play, pause, reset, scrub, runWith,
  };
}
