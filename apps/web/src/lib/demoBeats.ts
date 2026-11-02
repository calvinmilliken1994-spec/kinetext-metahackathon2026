// Demo v2 (docs/specs/DEMO-V2-follow-the-build.md): the build part of the Demo as beats. Each beat is one real event of
// the recorded run (reading the page, the summary, each part started, Muse locating a figure's parts, SAM 3.1
// confirming them, each part checked, the end), timed on the replay's own timeline (lib/replay.ts replayEvents), so the
// beat on screen is a pure function of replay time. Beats whose event the run does not have are simply absent.
// Pure: no React, no DOM, no network.

import { lessonCheckName } from './lessonJob.ts';
import { componentLabel } from './lesson.ts';
import type { MuseActor } from './liveBuild.ts';
import { parseCheckCount, parseFailedChecks, parseGrounding, parseGroundingActor, parseSegmentAsk } from './liveBuild.ts';
import { replayEvents } from './replay.ts';
import type { PlanComponentId } from '../../../../packages/contracts/kit.ts';

export type BeatKind = 'reading' | 'summary' | 'writing' | 'locating' | 'confirming' | 'outlining' | 'failed' | 'passed' | 'done';

/** What is still being worked on when a part has been checked (the light moves on to it after the checked moment). */
export interface BeatFollow { part: string; label: string; doing: 'writing' | 'reworking' | 'working on' }

export interface Beat {
  /** Unique within a run, the same from the wire and the normalised detail. */
  id: string;
  kind: BeatKind;
  /** Replay (job) time of the beat's event, ms; strictly increasing along the list. */
  tMs: number;
  part: string | null;
  label: string | null;
  /** The revision the event belongs to (a failed beat: the revision that failed). */
  revision: number;
  /** SAM: the parts asked for. */
  parts: number | null;
  /** confirming: what Muse located for SAM. */
  located: { located: number; of: number } | null;
  /** Who located the parts (Muse Spark, or Muse Spark Open on an open-weights run). */
  actor: MuseActor;
  /** passed: the check count recorded. */
  checks: { passed: number; total: number } | null;
  /** failed, and passed after a repair: the teacher name of the check that failed (from the run's own events). */
  failedCheck: string | null;
  /** passed: an earlier revision of this part failed its checks. failed: Muse starts a revision. */
  revised: boolean;
  /** A fault was injected into this part on purpose (a demo-fault run): never call that failure natural. */
  planted: boolean;
  /** writing: labels of the other parts being written at the same moment. */
  alongside: string[];
  /** passed: the part still being worked on, if any. */
  follow: BeatFollow | null;
  /** Parts in the plan. */
  planned: number;
  /** done: the run succeeded. */
  ok: boolean;
  /**
   * When the beat's moment ends, if before the next beat (job ms, exclusive): the analysis call or SAM's call closing.
   * A hold for the minimum dwell stops short of it, so the strip still shows what the card says.
   */
  untilMs: number | null;
}

/** How long, in replay time, a checked part keeps the light before it moves on to the work still going on (2 s at 4x). */
export const CHECKED_MOMENT_MS = 8000;

type Rec = Record<string, unknown>;
const str = (v: unknown): v is string => typeof v === 'string';
const label = (id: string): string => componentLabel(id as PlanComponentId);
const isOwn = (e: Rec, id: string): boolean => e.componentId === id
  && (e.stage === 'component' || e.stage === 'segment' || e.stage === 'locate' || (e.stage === 'repair' && e.target === 'component'));
const checkName = (detail: unknown): string | null =>
  parseFailedChecks(str(detail) ? detail : undefined).map((id) => lessonCheckName(id)).find((n) => n !== null) ?? null;

/** The recorded run's beats, in order. Empty for anything without usable events. */
export function buildBeats(raw: unknown): Beat[] {
  const timeline = replayEvents(raw);
  if (timeline === null) return [];
  const evs = timeline.map((x) => ({ ...x, seq: typeof x.e.seq === 'number' ? x.e.seq : 0 }));
  const parts = [...new Set(evs.map((x) => x.e.componentId).filter(str))];
  const own = new Map(parts.map((id) => [id, evs.filter((x) => isOwn(x.e, id))]));
  const startedBy = (id: string, t: number): boolean => evs.some((x) => x.t <= t && x.e.componentId === id && x.e.stage === 'component' && x.e.status === 'started');
  const busy = (id: string, t: number): boolean => {
    const o = own.get(id) ?? [];
    return startedBy(id, t) && o.some((x) => x.t > t);
  };
  const doing = (id: string, t: number): BeatFollow['doing'] => {
    const last = (own.get(id) ?? []).filter((x) => x.t <= t).at(-1)?.e;
    if (last?.stage === 'repair' && last.status === 'started') return 'reworking';
    return last?.stage === 'component' && last.status === 'started' ? 'writing' : 'working on';
  };
  const planned = parts.filter((id) => evs.some((x) => x.e.componentId === id && x.e.stage === 'component' && x.e.status === 'started')).length;
  const injected = new Set(evs.filter((x) => x.e.stage === 'inject').map((x) => x.e.componentId).filter(str));

  const out: Beat[] = [];
  const add = (kind: BeatKind, t: number, seq: number, e: Rec | null, extra: Partial<Beat> = {}): void => {
    const part = e !== null && str(e.componentId) ? e.componentId : null;
    const prev = out.at(-1);
    out.push({
      id: `${kind}@${seq}`, kind, tMs: prev === undefined ? t : Math.max(t, prev.tMs + 1), part, label: part === null ? null : label(part),
      revision: e !== null && typeof e.revision === 'number' ? e.revision : 1, parts: null, located: null, actor: 'Muse Spark', checks: null,
      failedCheck: null, revised: false, planted: part !== null && injected.has(part), alongside: [], follow: null, planned, ok: false, untilMs: null, ...extra,
    });
  };

  const analyze = evs.find((x) => x.e.stage === 'analyze' && x.e.status === 'started') ?? evs[0];
  for (const x of evs) {
    const { e, t, seq } = x;
    if (x === analyze) {
      const done = evs.find((y) => y.seq > seq && y.e.stage === 'analyze' && y.e.status !== 'started');
      add('reading', t, seq, null, { untilMs: done?.t ?? null });
      continue;
    }
    if (e.stage === 'overview' && e.status === 'succeeded') { add('summary', t, seq, null); continue; }
    const id = str(e.componentId) ? e.componentId : null;
    const rev = typeof e.revision === 'number' ? e.revision : 1;
    if (id !== null && e.stage === 'component' && e.status === 'started' && rev === 1) {
      add('writing', t, seq, e, { alongside: parts.filter((p) => p !== id && busy(p, t)).map(label) });
      continue;
    }
    if (id !== null && e.stage === 'segment' && e.status === 'started') {
      // One segment call: Muse locates first on a grounded run (its `locate` event ends that), else SAM alone.
      const same = (y: Rec): boolean => y.componentId === id && y.revision === e.revision;
      const later = evs.filter((y) => y.seq > seq && same(y.e));
      const end = later.find((y) => y.e.stage === 'segment' && y.e.status !== 'started');
      const loc = later.find((y) => y.e.stage === 'locate' && (end === undefined || y.seq < end.seq));
      const actor = parseGroundingActor(str(loc?.e.detail) ? loc.e.detail : str(end?.e.detail) ? end.e.detail : undefined);
      const asked = parseSegmentAsk(str(e.detail) ? e.detail : undefined);
      add(e.grounded === false ? 'outlining' : 'locating', t, seq, e, { parts: asked, actor, untilMs: (loc ?? end)?.t ?? null });
      continue;
    }
    if (id !== null && e.stage === 'locate') {
      const g = parseGrounding(str(e.detail) ? e.detail : undefined);
      const actor = parseGroundingActor(str(e.detail) ? e.detail : undefined);
      const segStart = [...evs].reverse().find((y) => y.seq < seq && y.e.componentId === id && y.e.revision === e.revision && y.e.stage === 'segment' && y.e.status === 'started');
      const asked = parseSegmentAsk(str(segStart?.e.detail) ? segStart.e.detail : undefined);
      const end = evs.find((y) => y.seq > seq && y.e.componentId === id && y.e.revision === e.revision && y.e.stage === 'segment' && y.e.status !== 'started');
      const untilMs = end?.t ?? null;
      if (e.status === 'succeeded' && g !== null && g !== 'failed' && g.located > 0) add('confirming', t, seq, e, { located: g, parts: asked, actor, untilMs });
      else add('outlining', t, seq, e, { parts: asked, actor, untilMs });
      continue;
    }
    if (id !== null && e.stage === 'component' && e.status === 'failed') {
      // Timed at Muse's revision call when one starts, so the beat matches the strip's "Reworking …".
      const repair = evs.find((y) => y.seq > seq && y.e.stage === 'repair' && y.e.target === 'component' && y.e.componentId === id && y.e.status === 'started' && y.e.revision === rev + 1);
      add('failed', repair?.t ?? t, seq, e, { failedCheck: checkName(e.detail), revised: repair !== undefined });
      continue;
    }
    if (id !== null && e.stage === 'component' && e.status === 'succeeded') {
      const failedBefore = evs.find((y) => y.seq < seq && y.e.componentId === id && y.e.stage === 'component' && y.e.status === 'failed');
      const others = parts.filter((p) => p !== id && busy(p, t));
      const next = others[0];
      add('passed', t, seq, e, {
        checks: parseCheckCount(str(e.detail) ? e.detail : undefined),
        revised: failedBefore !== undefined,
        failedCheck: failedBefore === undefined ? null : checkName(failedBefore.e.detail),
        follow: next === undefined ? null : { part: next, label: label(next), doing: doing(next, t) },
      });
      continue;
    }
    if (e.stage === 'done') add('done', t, seq, null, { ok: e.status === 'succeeded' });
  }
  return out;
}

/** The index of the beat on screen at replay time `tMs`: the latest at or before it (the first during the lead-in); -1 with no beats. */
export function beatAt(beats: readonly Beat[], tMs: number): number {
  if (beats.length === 0) return -1;
  let i = 0;
  for (let k = 0; k < beats.length; k++) if ((beats[k] as Beat).tMs <= tMs) i = k;
  return i;
}

/**
 * How far the replay may run while beat `index` is on screen (job ms), or null for no limit. Until the beat has been up
 * for `dwellMs` (wall time) the replay waits just before the next beat; after that it may reach the next beat, never
 * the one after it, so each beat is shown for at least the dwell however close the recorded events were.
 */
export function paceCap(beats: readonly Beat[], index: number, enteredAt: number, now: number, dwellMs: number): number | null {
  const cur = beats[index];
  if (cur === undefined) return null;
  if (now - enteredAt < dwellMs) {
    const next = beats[index + 1];
    // Held inside the beat's own moment ("SAM 3.1 is confirming" stays up), and always before the next beat.
    const ends = [next?.tMs, cur.untilMs].filter((x): x is number => typeof x === 'number' && x > cur.tMs);
    return ends.length === 0 ? null : Math.min(...ends) - 1;
  }
  const after = beats[index + 2];
  return after === undefined ? null : after.tMs - 1;
}

// ---- what each beat says and lights -----------------------------------------------------------------------------------

export const STRIP_TARGET = '[data-tour="live-strip"]';
export const SOURCE_TARGET = '[data-tour="source-text"]';
export const partTarget = (id: string): string => `.lesson [data-component="${id}"]`;

/** The elements a beat cuts out of the dim backdrop at replay time `tMs`. */
export function beatLights(b: Beat, tMs: number): { targets: string[]; extras: string[] } {
  switch (b.kind) {
    case 'reading': return { targets: [STRIP_TARGET, SOURCE_TARGET], extras: [] };
    // The part frames the card talks about are lit as well, so the card never covers the next part (review #5).
    case 'summary': return { targets: ['.lesson .overview', SOURCE_TARGET], extras: ['.lesson [data-component]'] };
    case 'done': return { targets: [STRIP_TARGET], extras: [] };
    case 'passed': {
      const on = b.follow !== null && tMs >= b.tMs + CHECKED_MOMENT_MS ? b.follow.part : b.part;
      return { targets: on === null ? [STRIP_TARGET] : [partTarget(on)], extras: [] };
    }
    default: return { targets: b.part === null ? [STRIP_TARGET] : [partTarget(b.part)], extras: [] };
  }
}

export function speedWords(speed: number): string {
  return speed === 1 ? 'at real speed' : `at ${Number.isInteger(speed) ? speed : speed.toFixed(2).replace(/0+$/, '')}× speed`;
}

const q = (s: string | null): string => `“${s ?? 'this part'}”`;
const andList = (xs: readonly string[]): string => xs.map((x) => q(x)).join(' and ');

/** The card for a beat, worded from the run's own events (counts, check names, models). */
export function beatCard(b: Beat, o: { model: string; speed: number }): { title: string; body: string } {
  const follow = b.follow === null ? '' : ` Muse is still ${b.follow.doing} ${q(b.follow.label)}.`;
  const n = b.parts === null ? 'each part' : `each of the ${b.parts} parts`;
  switch (b.kind) {
    case 'reading': return {
      title: `${o.model} is reading the page`,
      body: `This is a replay of a recorded run, ${speedWords(o.speed)}. The strip names the model, what it is doing and how long it has taken. Every step you see happened in that run.`,
    };
    case 'summary': return {
      title: 'Muse writes the summary first',
      body: 'Each key point is tied to the sentence it came from: those sentences light up in the page on the left. Below, the parts Muse planned take shape while it writes them.',
    };
    case 'writing': return {
      title: `Muse writes ${q(b.label)}`,
      body: `${b.alongside.length > 0 ? `Muse writes it at the same time as ${andList(b.alongside)}.` : b.planned > 1 ? `One of the ${b.planned} parts Muse planned for this page.` : 'The part Muse planned for this page.'} It takes shape here while Muse writes it. Code checks it against the page before it appears.`,
    };
    case 'locating': return {
      title: b.revision > 1 ? `${b.actor} locates the parts again` : `${b.actor} locates the parts on the figure`,
      body: `${b.actor} finds ${n} on the page’s figure${b.revision > 1 ? ` for revision ${b.revision}` : ''}. SAM 3.1, Meta’s segmentation model, confirms them next.`,
    };
    case 'confirming': return {
      title: `SAM 3.1 confirms what ${b.actor} located`,
      body: `${b.actor} located ${b.located?.located ?? 0} of ${b.located?.of ?? 0} parts. SAM 3.1, Meta’s segmentation model, now outlines each one to confirm it, so every number sits on its part.`,
    };
    case 'outlining': return {
      title: 'SAM 3.1 outlines the parts of the figure',
      body: `SAM 3.1, Meta’s segmentation model, outlines ${n} from the point Muse marked on the figure, so every number sits on its part.`,
    };
    case 'failed': {
      if (b.revised) {
        return {
          title: `${q(b.label)} did not pass a check`,
          body: `Code checks each draft against the page. This one did not pass ${b.failedCheck === null ? 'one of its checks' : q(b.failedCheck)}, so Muse is reworking it as revision ${b.revision + 1}.`,
        };
      }
      return {
        title: `${q(b.label)} is left out`,
        body: b.failedCheck === null
          ? 'The draft could not be checked, so this part stays out of the lesson. The other parts are not affected.'
          : `It did not pass ${q(b.failedCheck)}, so this part stays out of the lesson. The other parts are not affected.`,
      };
    }
    case 'passed': {
      const counts = b.checks === null ? 'every check' : `${b.checks.passed} of ${b.checks.total} checks`;
      if (!b.revised) {
        return { title: `${q(b.label)} passed its checks`, body: `Code checked it against the page: ${b.checks === null ? 'every check passed' : `${counts} passed`}.${follow}` };
      }
      // Calvin's rule: "Revised by Muse after a failed check", never "the model's own mistake".
      return {
        title: 'Revised by Muse after a failed check',
        body: `The first draft of ${q(b.label)} did not pass ${b.failedCheck === null ? 'one of its checks' : q(b.failedCheck)}. Muse revised it, and revision ${b.revision} passed ${counts}.${b.planted ? '' : ' The check found the issue in Muse’s draft; it was not a planted fault.'}${follow}`,
      };
    }
    case 'done': return b.ok
      // Not "Ready to teach": the lesson still says "Needs review" (review #6).
      ? { title: 'Ready for your review', body: 'The strip now sums up the build: how long it took, the model calls it made and whether every part passed its checks.' }
      : { title: 'The build stopped', body: 'The strip sums up how far the run got and which parts passed their checks.' };
  }
}
