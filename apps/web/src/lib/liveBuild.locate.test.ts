/// <reference types="node" />
// STAGE-10c H2: the label diagram's segment stage is two steps, and the build view says so. Muse Spark locates the parts
// first ("Muse Spark is locating 5 parts on the figure"), then SAM 3.1 confirms them ("SAM 3.1 is confirming 5 parts").
// The live worker marks the end of Muse's locating with a `locate` event; a RECORDED run made before that event existed is
// split at `groundingLatencyMs` by lib/replay.ts. A run without grounding keeps "SAM 3.1 is outlining 5 parts".
import test from 'node:test';
import assert from 'node:assert/strict';
import { normaliseJobDetail } from './lessonJob.ts';
import type { JobDetail } from '../api.ts';
import { figureNote, liveStrip, parseSamRetried, partBuilds } from './liveBuild.ts';
import { replayBounds, replaySnapshot, replayStep, CONFIRM_HOLD_MS } from './replay.ts';
import { fixtureFinalWire, FIXTURE_START_MS } from './liveBuildFixtures.ts';

const LD = 'label-diagram-v1';
type Wire = { events: Array<Record<string, unknown>>; kitSpecs: Record<string, Record<string, unknown>>; summary: Record<string, unknown> } & Record<string, unknown>;

const GROUNDED = 'sam-3.1 returned 5 of 5 region(s); muse-spark-1.3 located 5 of 5 part(s) for SAM; sam-3.1 sure of 5 of 5 part(s); placed 5 number(s) on the located parts; sam-3.1 retried 1 weak part(s): runoff 0.41 -> 0.70';
const LOCATE_OK = 'muse-spark-1.3 located 5 of 5 part(s) for SAM';
// segment r1 of the fixture starts at 59.23 s: Muse's call takes 16.632 s, SAM's 4.393 s (the recorded Spark 1.3 run)
const START = 59.23;
const MUSE_S = 16.632;
const SAM_S = 4.393;
const SHIFT = MUSE_S + SAM_S + 0.2 - 1.87; // later events keep their order after the stretched segment stage

/**
 * The fixture run with a grounded revision-1 segment stage of the recorded length. `withLocate` adds the worker's own
 * `locate` event (a run made by the current worker); without it the run reads like one recorded before that event.
 */
function groundedWire(opts: { withLocate: boolean; detail?: string; locateDetail?: string; locateStatus?: string; model?: string } = { withLocate: false }): Wire {
  const wire = fixtureFinalWire() as Wire;
  const T0 = FIXTURE_START_MS;
  const iso = (s: number): string => new Date(T0 + Math.round(s * 1000)).toISOString();
  const out: Array<Record<string, unknown>> = [];
  let seqBump = 0;
  for (const e of wire.events) {
    const at = (Date.parse(e.at as string) - T0) / 1000;
    const isEnd = e.stage === 'segment' && e.status === 'succeeded' && e.revision === 1;
    if (isEnd) {
      if (opts.withLocate) {
        out.push({ ...e, estCostUSD: undefined, seq: (e.seq as number) + seqBump, stage: 'locate', status: opts.locateStatus ?? 'succeeded', at: iso(START + MUSE_S), latencyMs: Math.round(MUSE_S * 1000), detail: opts.locateDetail ?? LOCATE_OK, });
        seqBump += 1;
      }
      out.push({ ...e, seq: (e.seq as number) + seqBump, at: iso(START + MUSE_S + SAM_S + 0.2), latencyMs: Math.round(SAM_S * 1000), groundingLatencyMs: Math.round(MUSE_S * 1000), detail: opts.detail ?? GROUNDED });
    } else {
      out.push({ ...e, seq: (e.seq as number) + seqBump, at: at > START ? iso(at + SHIFT) : e.at });
    }
  }
  wire.events = out;
  // the published spec names its figure (what a replay uses to show the figure while the stage runs)
  for (const k of Object.keys(wire.kitSpecs)) if (wire.kitSpecs[k]!.componentId === LD) wire.kitSpecs[k] = { ...wire.kitSpecs[k], figureId: 'noaa-hydrologic-cycle-1' };
  if (opts.model === 'open') Object.assign(wire.summary, { model: 'muse-spark-open', provider: 'modal', providerModel: 'meta-models/Muse-Spark-Open-816B-A42B' });
  return wire;
}

/** A recorded run at job time `s`, replayed. */
const replayAt = (wire: Wire, s: number): JobDetail => normaliseJobDetail(replaySnapshot(wire, s * 1000));
/** A RUNNING job as the live poll serves it: its events so far, no replay layer in between. */
function liveAt(wire: Wire, s: number): JobDetail {
  const events = wire.events.filter((e) => Date.parse(e.at as string) - FIXTURE_START_MS <= s * 1000);
  return normaliseJobDetail({ ...wire, events, summary: { ...wire.summary, status: 'running' } });
}
const sam = (d: JobDetail) => (partBuilds(d)[LD]?.lines ?? []).filter((l) => l.kind === 'outlining');

test('parseSamRetried reads how many weak parts SAM re-tried', () => {
  assert.equal(parseSamRetried(GROUNDED), 1);
  assert.equal(parseSamRetried('sam-3.1 returned 5 of 5 region(s); sam-3.1 retried 2 weak part(s): a 0.40 -> 0.80, b missing -> 0.70'), 2);
  assert.equal(parseSamRetried('sam-3.1 returned 5 of 5 region(s); sam-3.1 retry of 1 weak part(s) failed (SAM_HTTP_500); kept the first pass'), null);
  assert.equal(parseSamRetried(undefined), null);
});

test('live: from `segment started` until the `locate` event Muse Spark is locating the parts', () => {
  const d = liveAt(groundedWire({ withLocate: true }), START + 5);
  const [line] = sam(d);
  assert.equal(line?.open, true);
  assert.equal(line?.phase, 'locating');
  assert.equal(line?.text, 'Muse Spark is locating 5 parts on the figure');
  assert.deepEqual(figureNote(partBuilds(d)[LD]), { actor: 'Muse Spark', text: 'is locating 5 parts on the figure', working: true, phase: 'locating' });
  // the strip names it as Muse's call
  const op = liveStrip(d).ops.find((o) => o.key.startsWith(LD));
  assert.deepEqual([op?.actor, op?.text], ['muse', 'Locating 5 parts on the figure']);
});

test('live: after the `locate` event SAM 3.1 is confirming what Muse located; Muse’s half stays on the frame', () => {
  const d = liveAt(groundedWire({ withLocate: true }), START + MUSE_S + 1);
  const [line] = sam(d);
  assert.equal(line?.phase, 'confirming');
  assert.equal(line?.text, 'SAM 3.1 is confirming 5 parts');
  assert.deepEqual(figureNote(partBuilds(d)[LD]), {
    actor: 'SAM 3.1', text: 'is confirming 5 parts', working: true, phase: 'confirming', muse: { actor: 'Muse Spark', text: 'located 5 parts' },
  });
  const op = liveStrip(d).ops.find((o) => o.key.startsWith(LD));
  assert.deepEqual([op?.actor, op?.text], ['sam', 'Confirming 5 parts']);
});

test('live: Muse located only some parts: the count says so; located none or failed reads as SAM alone', () => {
  const some = liveAt(groundedWire({ withLocate: true, locateDetail: 'muse-spark-1.3 located 4 of 5 part(s) for SAM' }), START + MUSE_S + 1);
  assert.equal(figureNote(partBuilds(some)[LD])?.muse?.text, 'located 4 of 5 parts');
  assert.equal(figureNote(partBuilds(some)[LD])?.phase, 'confirming');
  for (const [status, detail] of [['succeeded', 'muse-spark-1.3 located 0 of 5 part(s) for SAM'], ['failed', 'muse-spark-1.3 grounding failed (OUTPUT_TRUNCATED)']] as const) {
    const d = liveAt(groundedWire({ withLocate: true, locateStatus: status, locateDetail: detail }), START + MUSE_S + 1);
    assert.equal(sam(d)[0]?.phase, 'outlining', detail);
    assert.equal(sam(d)[0]?.text, 'SAM 3.1 is outlining 5 parts of the figure', 'today’s wording once Muse gave SAM nothing');
    assert.equal(figureNote(partBuilds(d)[LD])?.muse, undefined);
  }
});

test('a failed locate event (OUTPUT_TRUNCATED) is not the draft being unreadable: no “left out” line, the writing time is Muse’s writing call', () => {
  const d = liveAt(groundedWire({ withLocate: true, locateStatus: 'failed', locateDetail: 'muse-spark-1.3 grounding failed (OUTPUT_TRUNCATED)' }), 120);
  const lines = partBuilds(d)[LD]?.lines ?? [];
  assert.ok(!lines.some((l) => l.kind === 'unusable'));
  assert.equal(lines.find((l) => l.kind === 'writing')?.durationMs, 24546, 'the recorded latency of the generation call, not the grounding call’s');
});

test('live: an open-weights job says Muse Spark Open, before and after the locate event', () => {
  const wire = groundedWire({ withLocate: true, model: 'open', locateDetail: 'muse-spark-open located 5 of 5 part(s) for SAM', detail: GROUNDED.replace('muse-spark-1.3', 'muse-spark-open') });
  const before = liveAt(wire, START + 5);
  assert.equal(sam(before)[0]?.text, 'Muse Spark Open is locating 5 parts on the figure');
  assert.equal(figureNote(partBuilds(before)[LD])?.actor, 'Muse Spark Open');
  const after = liveAt(wire, START + MUSE_S + 1);
  assert.deepEqual(figureNote(partBuilds(after)[LD])?.muse, { actor: 'Muse Spark Open', text: 'located 5 parts' });
});

test('the figure the worker recorded on `segment started` rides along (drawn dimmed in the frame)', () => {
  const wire = groundedWire({ withLocate: true });
  for (const e of wire.events) if (e.stage === 'segment' && e.status === 'started') e.figureId = 'noaa-hydrologic-cycle-1';
  assert.equal(figureNote(partBuilds(liveAt(wire, START + 5))[LD])?.figureId, 'noaa-hydrologic-cycle-1');
  assert.equal(figureNote(partBuilds(liveAt(groundedWire({ withLocate: true }), START + 5))[LD])?.figureId, undefined, 'no figure recorded: none drawn');
});

test('replay of a run recorded before the `locate` event: split at groundingLatencyMs, figure from the published spec', () => {
  const wire = groundedWire({ withLocate: false });
  const early = replayAt(wire, START + 5);
  assert.equal(sam(early)[0]?.phase, 'locating');
  assert.equal(figureNote(partBuilds(early)[LD])?.figureId, 'noaa-hydrologic-cycle-1');
  const late = replayAt(wire, START + MUSE_S + 1);
  assert.equal(sam(late)[0]?.phase, 'confirming');
  assert.equal(sam(late)[0]?.text, 'SAM 3.1 is confirming 5 parts');
  assert.equal(liveStrip(late).samCalls, 0, 'the synthetic marker is not a SAM call');
});

test('replay of a run recorded WITHOUT grounding keeps today’s wording the whole stage', () => {
  const old = fixtureFinalWire();
  const mid = normaliseJobDetail(replaySnapshot(old, 60 * 1000));
  assert.equal(sam(mid)[0]?.phase, 'outlining');
  assert.equal(sam(mid)[0]?.text, 'SAM 3.1 is outlining 5 parts of the figure');
  assert.equal(figureNote(partBuilds(mid)[LD])?.phase, 'outlining');
});

test('after the stage: the grounded line stays on the part’s meta row, with Muse’s time and the retry', () => {
  const done = replayAt(groundedWire({ withLocate: true }), 120);
  const build = partBuilds(done)[LD];
  assert.equal(sam(done)[0]?.text, 'Muse Spark located 5 parts · SAM 3.1 confirmed 5 of 5 in 4.4 s', 'the line the Addendum A tests pin is unchanged');
  const trace = build?.trace.map((t) => t.text) ?? [];
  assert.deepEqual(trace.slice(0, 5), ['Written 24.5 s', 'Muse Spark located 5 parts in 16.6 s', 'SAM 3.1 confirmed 5 of 5 in 4.4 s', 'SAM retried 1 weak part', '1 check failed']);
  // a run with no retry has no retry step; one with the failed grounding keeps SAM alone
  const noRetry = replayAt(groundedWire({ withLocate: true, detail: 'sam-3.1 returned 5 of 5 region(s); muse-spark-1.3 located 5 of 5 part(s) for SAM; sam-3.1 sure of 5 of 5 part(s)' }), 120);
  assert.ok(!(partBuilds(noRetry)[LD]?.trace ?? []).some((t) => /retried/.test(t.text)));
  const failed = replayAt(groundedWire({ withLocate: true, detail: 'sam-3.1 returned 5 of 5 region(s); muse-spark-1.3 grounding failed (TIMEOUT); used the generation areas; sam-3.1 sure of 5 of 5 part(s)' }), 120);
  assert.ok((partBuilds(failed)[LD]?.trace ?? []).some((t) => /^SAM 3\.1 \d+\.\d s$/.test(t.text)), 'SAM-only trace step');
});

test('replay layer: the synthetic locate event sits at started + groundingLatencyMs and is not added twice', () => {
  const wire = groundedWire({ withLocate: false });
  const shown = replaySnapshot(wire, (START + MUSE_S + 1) * 1000) as { events: Array<Record<string, unknown>> };
  const loc = shown.events.filter((e) => e.stage === 'locate');
  assert.equal(loc.length, 1);
  assert.equal(loc[0]?.status, 'succeeded');
  assert.equal(loc[0]?.detail, LOCATE_OK);
  assert.equal(loc[0]?.latencyMs, 16632);
  assert.equal(loc[0]?.synthetic, true);
  const started = wire.events.find((e) => e.stage === 'segment' && e.status === 'started' && e.revision === 1)!;
  assert.equal(Date.parse(loc[0]?.at as string) - Date.parse(started.at as string), 16632);
  // not before it happened
  const before = replaySnapshot(wire, (START + MUSE_S - 0.5) * 1000) as { events: Array<Record<string, unknown>> };
  assert.equal(before.events.filter((e) => e.stage === 'locate').length, 0);
  // a run with its own locate event gets none added
  const own = replaySnapshot(groundedWire({ withLocate: true }), (START + MUSE_S + 1) * 1000) as { events: Array<Record<string, unknown>> };
  assert.equal(own.events.filter((e) => e.stage === 'locate').length, 1);
  assert.equal(own.events.filter((e) => e.stage === 'locate' && e.synthetic === true).length, 0);
  // the replay clock gets a frame at the moment Muse is done
  const step = replayStep(wire, (START + MUSE_S - 2) * 1000);
  assert.equal(step, Date.parse(loc[0]?.at as string) - FIXTURE_START_MS);
  // The run ends where it ended, plus the readable hold on a short SAM confirm (replay.ts CONFIRM_HOLD_MS).
  const segEnd = wire.events.find((e) => e.stage === 'segment' && e.status === 'succeeded' && e.revision === 1)!;
  const confirmGap = Date.parse(segEnd.at as string) - Date.parse(loc[0]?.at as string);
  const recordedEnd = Math.max(...wire.events.map((e) => Date.parse(e.at as string) - FIXTURE_START_MS));
  assert.equal(replayBounds(wire)?.durationMs, recordedEnd + Math.max(0, CONFIRM_HOLD_MS - confirmGap), 'the run ends where it ended, plus the confirm hold');
});

test('replay layer: a failed grounding note makes a failed locate event; no latency recorded means none is invented', () => {
  const failedNote = 'sam-3.1 returned 5 of 5 region(s); muse-spark-1.3 grounding failed (OUTPUT_TRUNCATED); used the generation areas; sam-3.1 sure of 5 of 5 part(s)';
  const shown = replaySnapshot(groundedWire({ withLocate: false, detail: failedNote }), (START + MUSE_S + 1) * 1000) as { events: Array<Record<string, unknown>> };
  const loc = shown.events.find((e) => e.stage === 'locate');
  assert.equal(loc?.status, 'failed');
  assert.equal(loc?.detail, 'muse-spark-1.3 grounding failed (OUTPUT_TRUNCATED)');
  const wire = groundedWire({ withLocate: false });
  for (const e of wire.events) delete e.groundingLatencyMs;
  const none = replaySnapshot(wire, (START + MUSE_S + 1) * 1000) as { events: Array<Record<string, unknown>> };
  assert.equal(none.events.filter((e) => e.stage === 'locate').length, 0);
  // grounded (the end event says so) but no way to split: Muse is shown locating until SAM's end
  assert.equal(sam(normaliseJobDetail(none))[0]?.phase, 'locating');
});
