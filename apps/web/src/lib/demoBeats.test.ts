/// <reference types="node" />
// Demo v2 (docs/specs/DEMO-V2-follow-the-build.md): the build part of the Demo is a list of beats, each tied to a real
// event of the recorded run. The beat on screen is a pure function of replay time; Next and Back seek the replay to a
// beat's event time; the replay waits for a short minimum dwell, never the other way round. Tested on the real Demo run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { lessonCheckName, normaliseJobDetail } from './lessonJob.ts';
import { liveStrip } from './liveBuild.ts';
import { replayBounds, replayEvents, replaySnapshot } from './replay.ts';
import { fixtureFinalWire } from './liveBuildFixtures.ts';
import { DEMO_RUN_ID, demoRunWire } from './demoRunFixtures.ts';
import { DEMO_PINS } from './demoPins.ts';
import { beatAt, beatCard, beatLights, buildBeats, CHECKED_MOMENT_MS, paceCap } from './demoBeats.ts';
import type { Beat } from './demoBeats.ts';

const wire = demoRunWire();
const beats = buildBeats(wire);
const key = (b: Beat): string => [b.kind, b.part, b.kind === 'locating' || b.kind === 'confirming' || b.kind === 'failed' || b.kind === 'passed' ? b.revision : null].filter((x) => x !== null).join(':');
const LD = '.lesson [data-component="label-diagram-v1"]';
const SEQ = '.lesson [data-component="sequence-v1"]';
const STRIP = '[data-tour="live-strip"]';
const SOURCE = '[data-tour="source-text"]';
const card = (b: Beat) => beatCard(b, { model: 'Muse Spark 1.3', speed: 4 });
const stripAt = (t: number) => liveStrip(normaliseJobDetail(replaySnapshot(wire, t)));

test('the fixture is the pinned Demo run', () => {
  assert.equal(DEMO_PINS.tour, DEMO_RUN_ID);
  assert.equal((wire.summary as { jobId: string }).jobId, DEMO_RUN_ID);
});

test('the Demo run’s beats, in order, each from one of its recorded events', () => {
  assert.deepEqual(beats.map(key), [
    'reading', 'summary', 'writing:sequence-v1', 'writing:label-diagram-v1', 'passed:sequence-v1:1',
    'locating:label-diagram-v1:1', 'confirming:label-diagram-v1:1', 'failed:label-diagram-v1:1',
    'locating:label-diagram-v1:2', 'confirming:label-diagram-v1:2', 'passed:label-diagram-v1:2', 'done',
  ]);
  // Event times on the replay's own timeline (job ms; the SAM confirm holds of lib/replay.ts shift the later ones).
  assert.deepEqual(beats.map((b) => b.tMs), [12, 39325, 39327, 39383, 55448, 75696, 95532, 101543, 107313, 124789, 130797, 130801]);
  assert.equal(beats.at(-1)?.tMs, replayBounds(wire)?.durationMs, 'the last beat is the end of the replay');
  assert.equal(new Set(beats.map((b) => b.id)).size, beats.length, 'ids are unique');
});

test('beats read the same from the normalised detail the app holds as from the wire', () => {
  assert.deepEqual(buildBeats(normaliseJobDetail(wire)), beats);
  assert.deepEqual(buildBeats(null), []);
  assert.deepEqual(buildBeats({ events: 'x' }), []);
});

test('the beat on screen is the latest whose event time is at or before now', () => {
  beats.forEach((b, i) => {
    assert.equal(beatAt(beats, b.tMs), i, `${b.id} at its own time`);
    if (i > 0) assert.equal(beatAt(beats, b.tMs - 1), i - 1, `${b.id} one ms before`);
  });
  assert.equal(beatAt(beats, -800), 0, 'the lead-in shows the first beat');
  assert.equal(beatAt(beats, 1e9), beats.length - 1);
  assert.equal(beatAt([], 5), -1);
});

test('the card matches the strip for the whole of each beat (from its event to just before the next)', () => {
  const ops = (t: number): string[] => stripAt(t).ops.map((o) => o.text);
  // A beat's moment can end before the next beat: the analysis call ends 5 ms before the overview event, SAM's call
  // a few ms before the check result. The beat says so (untilMs), and the dwell hold stops short of it.
  const analysed = replayEvents(wire)!.find((x) => x.e.stage === 'analyze' && x.e.status === 'succeeded')!.t;
  assert.equal(beats[0]?.untilMs, analysed);
  beats.forEach((b, i) => {
    const end = Math.min(beats[i + 1]?.tMs ?? b.tMs + 1, b.untilMs ?? Infinity) - 1;
    for (const t of [b.tMs, end]) {
      const s = stripAt(t);
      const at = `${b.id} at ${t}`;
      switch (b.kind) {
        case 'reading': assert.ok(ops(t).includes('Reading the page and planning the lesson'), at); break;
        case 'summary': assert.equal(s.partsPlanned, 2, at); assert.ok(!ops(t).some((o) => o.startsWith('Reading')), at); break;
        case 'writing': assert.ok(ops(t).includes(`Writing ${b.label}`), at); break;
        case 'locating': assert.ok(ops(t).includes('Locating 5 parts on the figure'), at); break;
        case 'confirming': assert.ok(ops(t).includes('Confirming 5 parts'), at); break;
        case 'failed': assert.ok(ops(t).includes(`Reworking ${b.label}`), at); break;
        case 'passed': assert.equal(s.partsPassed, b.part === 'sequence-v1' ? 1 : 2, at); break;
        case 'done': assert.equal(s.finished, true, at); break;
        default: assert.fail(at);
      }
    }
  });
  // Calvin's screenshot: "Writing Label the diagram 33 s, 1 of 2 parts checked" while the card said the summary. Now that
  // moment is the Sequence's checked beat, whose card names the part still being written.
  const seqDone = beats.find((b) => b.kind === 'passed' && b.part === 'sequence-v1') as Beat;
  const shot = 39_383 + 33_000;
  assert.ok(ops(shot).includes('Writing Label the diagram'));
  assert.equal(beats[beatAt(beats, shot)], seqDone);
  assert.match(card(seqDone).body, /still writing “Label the diagram”/);
});

test('every beat lights what it talks about, and a checked part hands the light on to the work that goes on', () => {
  const lit = (b: Beat, t = b.tMs) => beatLights(b, t);
  const by = (k: string) => beats.find((b) => key(b) === k) as Beat;
  assert.deepEqual(lit(by('reading')), { targets: [STRIP, SOURCE], extras: [] });
  assert.deepEqual(lit(by('summary')), { targets: ['.lesson .overview', SOURCE], extras: ['.lesson [data-component]'] });
  assert.deepEqual(lit(by('writing:sequence-v1')).targets, [SEQ]);
  assert.deepEqual(lit(by('writing:label-diagram-v1')).targets, [LD]);
  const seq = by('passed:sequence-v1:1');
  assert.deepEqual(lit(seq).targets, [SEQ], 'lit again for its checked moment');
  assert.deepEqual(lit(seq, seq.tMs + CHECKED_MOMENT_MS - 1).targets, [SEQ]);
  assert.deepEqual(lit(seq, seq.tMs + CHECKED_MOMENT_MS).targets, [LD], 'then on to the part still being written');
  for (const k of ['locating:label-diagram-v1:1', 'confirming:label-diagram-v1:1', 'failed:label-diagram-v1:1', 'locating:label-diagram-v1:2', 'confirming:label-diagram-v1:2', 'passed:label-diagram-v1:2']) {
    assert.deepEqual(lit(by(k)).targets, [LD], k);
  }
  const ld = by('passed:label-diagram-v1:2');
  assert.deepEqual(lit(ld, ld.tMs + CHECKED_MOMENT_MS).targets, [LD], 'nothing else is busy: the light stays');
  assert.deepEqual(lit(by('done')), { targets: [STRIP], extras: [] });
  for (const b of beats) assert.ok(lit(b).targets.length > 0, `${b.id} lights something`);
});

test('the SAM beats name Muse Spark locating and SAM 3.1 confirming, with the run’s own counts', () => {
  const loc = beats.filter((b) => b.kind === 'locating').map(card);
  assert.equal(loc[0]?.title, 'Muse Spark locates the parts on the figure');
  assert.match(loc[0]?.body ?? '', /Muse Spark finds each of the 5 parts on the page’s figure\. SAM 3\.1, Meta’s segmentation model, confirms them next\./);
  assert.equal(loc[1]?.title, 'Muse Spark locates the parts again');
  assert.match(loc[1]?.body ?? '', /revision 2/);
  const conf = beats.filter((b) => b.kind === 'confirming').map(card);
  for (const c of conf) {
    assert.equal(c.title, 'SAM 3.1 confirms what Muse Spark located');
    assert.match(c.body, /^Muse Spark located 5 of 5 parts\. SAM 3\.1, Meta’s segmentation model, now outlines each one to confirm it/);
  }
});

test('the repair is worded from the run itself: “Revised by Muse after a failed check” with its own failed check', () => {
  const name = lessonCheckName('LD-06') as string;
  assert.ok(name !== null);
  const failed = card(beats.find((b) => b.kind === 'failed') as Beat);
  assert.equal(failed.title, '“Label the diagram” did not pass a check');
  assert.ok(failed.body.includes(`“${name}”`), failed.body);
  assert.match(failed.body, /Muse is reworking it as revision 2\./);
  const revised = card(beats.find((b) => b.kind === 'passed' && b.revision === 2) as Beat);
  assert.equal(revised.title, 'Revised by Muse after a failed check');
  assert.ok(revised.body.includes(`“${name}”`), revised.body);
  assert.match(revised.body, /revision 2 passed 13 of 13 checks/);
  assert.match(revised.body, /not a planted fault/, 'the run had no injected fault');
  const seq = card(beats.find((b) => b.kind === 'passed' && b.revision === 1) as Beat);
  assert.equal(seq.title, '“Sequence” passed its checks');
  assert.match(seq.body, /6 of 6 checks passed/);
});

test('the rest of the copy: reading names the speed and the replay, the summary and the end keep their titles', () => {
  const c = beats.map(card);
  assert.equal(c[0]?.title, 'Muse Spark 1.3 is reading the page');
  assert.match(c[0]?.body ?? '', /This is a replay of a recorded run, at 4× speed\./);
  assert.equal(c[1]?.title, 'Muse writes the summary first');
  assert.equal(c[2]?.title, 'Muse writes “Sequence”');
  assert.equal(c[3]?.title, 'Muse writes “Label the diagram”');
  assert.match(c[3]?.body ?? '', /at the same time as “Sequence”/);
  assert.equal(c.at(-1)?.title, 'Ready for your review');
  for (const x of c) {
    assert.doesNotMatch(`${x.title} ${x.body}`, /—|–/, `no dashes: ${x.title}`);
    assert.doesNotMatch(`${x.title} ${x.body}`, /mistake|\btour\b|starts when the replay/i, x.title);
  }
});

test('pacing: the replay is held before the next beat until this one has been up for the minimum dwell', () => {
  const dwell = 2600;
  // Just entered beat 1 (the summary): hold before beat 2 (Sequence starts 2 ms later).
  assert.equal(paceCap(beats, 1, 10_000, 10_000, dwell), beats[2]!.tMs - 1);
  assert.equal(paceCap(beats, 1, 10_000, 12_599, dwell), beats[2]!.tMs - 1);
  // Dwell done: the replay may reach the next beat, but never the one after it before that beat has been shown.
  assert.equal(paceCap(beats, 1, 10_000, 12_600, dwell), beats[3]!.tMs - 1);
  // SAM's confirm (1.5 s at 4x) is held while the strip still says "Confirming 5 parts", not after SAM's call closed.
  const conf = beats.findIndex((b) => b.kind === 'confirming');
  assert.equal(paceCap(beats, conf, 0, 0, dwell), 101_532 - 1);
  assert.ok(stripAt(101_531).ops.some((o) => o.text === 'Confirming 5 parts'));
  assert.equal(paceCap(beats, beats.length - 2, 0, 0, dwell), beats.at(-1)!.tMs - 1);
  assert.equal(paceCap(beats, beats.length - 2, 0, dwell, dwell), null, 'nothing after the last beat to protect');
  assert.equal(paceCap(beats, beats.length - 1, 0, 0, dwell), null);
  assert.equal(paceCap([], 0, 0, 0, dwell), null);
});

test('a run without grounding gets SAM’s outline beat instead, and beats with no event are absent', () => {
  const old = buildBeats(fixtureFinalWire());
  assert.ok(!old.some((b) => b.kind === 'locating' || b.kind === 'confirming'), 'no grounding call recorded');
  const outline = old.filter((b) => b.kind === 'outlining');
  assert.equal(outline.length, 2, 'one per SAM call');
  assert.equal(card(outline[0] as Beat).title, 'SAM 3.1 outlines the parts of the figure');
  assert.ok(card(old.find((b) => b.kind === 'failed') as Beat).body.includes(`“${lessonCheckName('LD-04')}”`), 'the older run names its own check');
  // No repair: no failed beat, and the passed beat makes no repair claim.
  const clean = JSON.parse(JSON.stringify(wire)) as { events: Array<Record<string, unknown>> };
  clean.events = clean.events.filter((e) => e['componentId'] !== 'label-diagram-v1' || e['revision'] === 1)
    .map((e) => (e['componentId'] === 'label-diagram-v1' && e['stage'] === 'component' && e['status'] === 'failed' ? { ...e, status: 'succeeded', detail: '13/13 checks passed' } : e));
  const cb = buildBeats(clean);
  assert.ok(!cb.some((b) => b.kind === 'failed'));
  const p = cb.find((b) => b.kind === 'passed' && b.part === 'label-diagram-v1') as Beat;
  assert.equal(card(p).title, '“Label the diagram” passed its checks');
  assert.doesNotMatch(card(p).body, /revis|fault/i);
});
