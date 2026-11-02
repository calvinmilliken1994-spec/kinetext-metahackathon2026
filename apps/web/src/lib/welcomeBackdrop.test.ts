// Stage 10c Welcome v2: the backdrop behind the Welcome (the pinned demo run's figure with its stored model boxes, and
// the page's own sentences). Pure rules on the real stored run (welcomeBackdrop.fixtures.ts); the motion is checked in
// the browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  backdropSentences, WELCOME_CYCLE_MS, WELCOME_END_GAP_MS, WELCOME_PART_SPAN_MS, WELCOME_FIGURE_JOB, welcomeFigure,
  welcomeMarkerSpots, welcomeStagger,
} from './welcomeBackdrop.ts';
import type { WelcomeJob } from './welcomeBackdrop.ts';
import { WELCOME_FIXTURE_JOB, WELCOME_FIXTURE_SPEC, WELCOME_FIXTURE_TEXT } from './welcomeBackdrop.fixtures.ts';
import { DEMO_PINS } from './demoPins.ts';
import type { LabelDiagramSpec } from '../../../../packages/contracts/kit.ts';

const specId = WELCOME_FIXTURE_SPEC.id;

function job(o: { spec?: LabelDiagramSpec | null; status?: string; entryStatus?: string; model?: string } = {}): WelcomeJob {
  const spec = o.spec === undefined ? WELCOME_FIXTURE_SPEC : o.spec;
  return {
    summary: { jobId: WELCOME_FIXTURE_JOB, sourceId: 'noaa-jetstream-hydrologic-cycle', status: o.status ?? 'succeeded', model: o.model ?? 'muse-spark-1.3', provider: 'meta-api' },
    lessonData: {
      lesson: { components: [{ componentId: 'label-diagram-v1', specId, status: o.entryStatus ?? 'passed' }] },
      kitSpecs: spec === null ? {} : { [specId]: spec },
    },
  } as unknown as WelcomeJob;
}

const clone = (): LabelDiagramSpec => JSON.parse(JSON.stringify(WELCOME_FIXTURE_SPEC)) as LabelDiagramSpec;

test('the Welcome figure comes from the pinned opening run (the one lesson the guide and the Demo show)', () => {
  assert.equal(WELCOME_FIGURE_JOB, DEMO_PINS.opening[0]);
  assert.equal(WELCOME_FIXTURE_JOB, DEMO_PINS.opening[0], 'the fixture is that run');
});

test('welcomeFigure: the stored parts in page order, each with the model boxes the run stored', () => {
  const f = welcomeFigure(job());
  assert.ok(f !== null);
  assert.equal(f.figureId, 'noaa-hydrologic-cycle-1');
  assert.deepEqual(f.parts.map((p) => `${p.number} ${p.name}`), ['1 Evaporation', '2 Transpiration', '3 Condensation', '4 Precipitation', '5 Runoff']);
  // Evaporation: SAM's box 136,310 → 197,426 on the 572 × 504 figure; Muse's grounding box 137,303 → 199,418.
  const ev = f.parts[0]!;
  assert.ok(ev.glow !== null && ev.ground !== null);
  assert.ok(Math.abs(ev.glow.left - (136 / 572) * 100) < 1e-9);
  assert.ok(Math.abs(ev.glow.top - (310 / 504) * 100) < 1e-9);
  assert.ok(Math.abs(ev.ground.top - (303 / 504) * 100) < 1e-9);
  assert.equal(ev.quote, 'Evaporation is the change of state in a substance from a liquid to a gas.');
  assert.equal(f.aspect, 572 / 504);
});

test('welcomeFigure: the caption is derived from the stored run (model, located, confirmed), never typed in', () => {
  assert.deepEqual(welcomeFigure(job())?.note, ['Recorded run', 'Muse Spark 1.3 located 5 parts', 'SAM 3.1 confirmed 5 of 5']);
  const weak = clone();
  weak.regions[4]!.confidence = 0.31;
  const f = welcomeFigure(job({ spec: weak }));
  assert.deepEqual(f?.note, ['Recorded run', 'Muse Spark 1.3 located 5 parts', 'SAM 3.1 confirmed 4 of 5']);
  // A weak SAM region still glows, on the box Muse located (labelDiagramView regionDrawing), as in the build.
  const runoff = f!.parts.find((p) => p.name === 'Runoff')!;
  assert.ok(runoff.glow !== null && runoff.ground !== null);
  assert.deepEqual(runoff.glow, runoff.ground);
});

test('welcomeFigure: an older run without Muse grounding claims no locating step', () => {
  const old = clone();
  for (const r of old.regions) delete r.ground;
  const f = welcomeFigure(job({ spec: old }));
  assert.deepEqual(f?.note, ['Recorded run', 'SAM 3.1 found 5 of 5 parts']);
  assert.ok(f!.parts.every((p) => p.ground === null && p.glow !== null));
});

test('welcomeFigure: a part the models gave no box keeps its number and gets no box (never a drawn-in one)', () => {
  const gap = clone();
  gap.regions = gap.regions.filter((r) => r.partId !== 'runoff');
  const f = welcomeFigure(job({ spec: gap }));
  const runoff = f!.parts.find((p) => p.name === 'Runoff')!;
  assert.equal(runoff.glow, null);
  assert.equal(runoff.ground, null);
  assert.equal(runoff.number, 5);
  assert.deepEqual(f!.note, ['Recorded run', 'Muse Spark 1.3 located 4 parts', 'SAM 3.1 confirmed 4 of 5']);
});

test('welcomeFigure: Spark Open runs name their own model', () => {
  assert.equal(welcomeFigure(job({ model: 'muse-spark-open' }))?.note[1], 'Muse Spark Open located 5 parts');
});

test('welcomeFigure: no figure when the run cannot show one (missing, unfinished, withheld, boxless)', () => {
  assert.equal(welcomeFigure(null), null);
  assert.equal(welcomeFigure(job({ spec: null })), null, 'spec not served (withheld or hidden)');
  assert.equal(welcomeFigure(job({ status: 'running' })), null);
  assert.equal(welcomeFigure(job({ entryStatus: 'failed' })), null);
  const none = clone();
  none.regions = [];
  assert.equal(welcomeFigure(job({ spec: none })), null, 'no model boxes at all: the figure-less layout');
  const bad = clone();
  bad.figure.width = 0;
  assert.equal(welcomeFigure(job({ spec: bad })), null);
  assert.equal(welcomeFigure({ summary: { jobId: 'x', sourceId: 'y', status: 'succeeded' } } as unknown as WelcomeJob), null, 'not a lesson job');
});

test('backdropSentences: page sentences only, the cited ones marked with their part, in page order', () => {
  const quotes = WELCOME_FIXTURE_SPEC.parts.map((p) => p.quote);
  const s = backdropSentences(WELCOME_FIXTURE_TEXT, quotes, 2000);
  const cited = s.filter((x) => x.cite !== null);
  assert.deepEqual(cited.map((x) => x.cite), [0, 1, 2, 3, 4]);
  assert.equal(cited[0]!.text, quotes[0]);
  assert.ok(s.every((x) => WELCOME_FIXTURE_TEXT.includes(x.text)), 'every sentence is the page’s own text');
  assert.ok(s.every((x) => !/^#|•/.test(x.text)), 'no markdown heading or bullet marks');
  const total = s.reduce((n, x) => n + x.text.length + 1, 0);
  assert.ok(total <= 2000, `budget kept (${total})`);
  assert.ok(total > 1500, `budget used (${total})`);
  const at = s.map((x) => WELCOME_FIXTURE_TEXT.indexOf(x.text));
  assert.deepEqual([...at].sort((a, b) => a - b), at, 'page order');
});

test('backdropSentences: with no quotes (no figure), the page from the top; empty text gives nothing', () => {
  const s = backdropSentences(WELCOME_FIXTURE_TEXT, [], 600);
  assert.ok(s.length > 0 && s.every((x) => x.cite === null));
  assert.match(s[0]!.text, /^The hydrologic cycle involves/);
  assert.deepEqual(backdropSentences('', ['x'], 600), []);
});

test('backdropSentences: a quote that is not in the page is not marked (nothing lights up that the page does not say)', () => {
  const s = backdropSentences(WELCOME_FIXTURE_TEXT, ['Clouds are made of cotton.'], 800);
  assert.ok(s.every((x) => x.cite === null));
});

test('welcomeStagger: every part finishes inside the loop, with a quiet gap before it starts again', () => {
  assert.equal(welcomeStagger(5), 650);
  for (const n of [1, 2, 5, 8, 14]) {
    const st = welcomeStagger(n);
    assert.ok(st >= 0);
    assert.ok((n - 1) * st + WELCOME_PART_SPAN_MS <= WELCOME_CYCLE_MS - WELCOME_END_GAP_MS, `n=${n}`);
  }
  assert.equal(welcomeStagger(1), 0);
  assert.ok(WELCOME_CYCLE_MS >= 10000 && WELCOME_CYCLE_MS <= 14000, 'a slow 10 to 14 s loop');
});

test('welcomeMarkerSpots: numbers sit clear of every printed label on the real figure', () => {
  const f = welcomeFigure(job())!;
  const W = 700;
  const H = W / f.aspect;
  const m = 30;
  const spots = welcomeMarkerSpots(f, W, H, m);
  assert.equal(spots.length, 5);
  for (const sp of spots) {
    for (const b of f.labelBoxes) {
      const bx = (b.left * W) / 100;
      const by = (b.top * H) / 100;
      const bw = (b.width * W) / 100;
      const bh = (b.height * H) / 100;
      const x = (sp.left * W) / 100;
      const y = (sp.top * H) / 100;
      const overlap = x + m / 2 > bx && x - m / 2 < bx + bw && y + m / 2 > by && y - m / 2 < by + bh;
      assert.equal(overlap, false);
    }
  }
});

test('outlines (Welcome option 3): each part carries SAM\'s stored outline path, drawn on the figure\'s own pixel grid', () => {
  const s = clone();
  const evap = s.regions.find((r) => r.partId === 'evaporation');
  assert.ok(evap !== undefined);
  (evap as { outline?: string }).outline = 'M140 323.5L141.5 323L143 325.5Z';
  const f = welcomeFigure(job({ spec: s }));
  assert.ok(f !== null);
  assert.equal(f.viewBox, '0 0 572 504');
  assert.equal(f.parts.find((p) => p.name === 'Evaporation')?.outline, 'M140 323.5L141.5 323L143 325.5Z');
  assert.equal(f.parts.find((p) => p.name === 'Runoff')?.outline, null, 'no stored outline: none drawn');
});
