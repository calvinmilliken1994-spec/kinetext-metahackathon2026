// Welcome v3 (docs/specs/WELCOME-V3-split.md): the right half of the Welcome, a fast "page becomes lesson" montage over
// the published lessons. Pure rules: which lessons, in which order, which sentence and which part per lesson, what the
// caption says, and the timing. The motion itself is checked in the browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BEAT_MS, beatFrame, MONTAGE_JOBS, MONTAGE_LABEL, montageBeats, montageLesson, nextBeat, nextPlayable, PART_AT_MS,
} from './welcomeMontage.ts';
import type { MontageJob, MontageLesson } from './welcomeMontage.ts';
import type { PartPreview, PreviewKind, PreviewPart } from './partPreview.ts';
import { WELCOME_FIXTURE_SPEC, WELCOME_FIXTURE_TEXT } from './partPreview.fixtures.ts';
import type { LabelDiagramSpec } from '../../../../packages/contracts/kit.ts';

const IDS = {
  volcano: 'job-20261102050029-1ebd79c6', water: 'job-20261101235049-c31ad262', dna: 'job-20261101211438-e741b91a',
  waste: 'job-20261031154139-c6facfdb', saving: 'job-20261031152958-aa411e2f', gov: 'job-20261031110323-8979fdcd',
  fall: 'job-20261031103341-bac931f2', phishing: 'job-20261031100603-3a2687b8', vra: 'job-20261031094943-7234f176',
} as const;

test('MONTAGE_JOBS: the nine published lessons of the spec, opening on the volcano; never the retired airplane page', () => {
  assert.deepEqual(MONTAGE_JOBS, Object.values(IDS));
  assert.equal(new Set(MONTAGE_JOBS).size, 9);
  assert.equal(MONTAGE_LABEL, 'From published lessons');
});

test('timing: fast beats of 1.5 to 2 s, the part snapping out early in the beat', () => {
  assert.ok(BEAT_MS >= 1500 && BEAT_MS <= 2000, `${BEAT_MS}`);
  assert.ok(PART_AT_MS > 200 && PART_AT_MS < BEAT_MS / 2, `${PART_AT_MS}`);
  assert.equal(nextBeat(0, 9), 1);
  assert.equal(nextBeat(8, 9), 0);
  assert.equal(nextBeat(0, 1), 0);
  assert.equal(nextBeat(0, 0), 0);
});

test('nextPlayable: skips a beat whose figure is not ready (or failed), wraps, and stays put when nothing else can play', () => {
  assert.equal(nextPlayable(0, [true, false, true]), 2);
  assert.equal(nextPlayable(2, [true, false, true]), 0);
  assert.equal(nextPlayable(1, [false, false, false]), 1);
  assert.equal(nextPlayable(0, [true]), 0);
});

test('beatFrame: every cut jumps (side or height changes), including the wrap from the last beat to the first', () => {
  for (const n of [2, 3, 7, 9]) {
    for (let i = 0; i < n; i++) {
      const a = beatFrame(i, n);
      const b = beatFrame(nextBeat(i, n), n);
      assert.ok(a.side !== b.side || a.drop !== b.drop, `n=${n} i=${i}`);
    }
  }
  assert.equal(beatFrame(0, 9).side, 'start', 'the first beat reads left to right');
});

// ---- synthetic lessons for the ordering rules (each part's quote is a sentence of its own page) -------------------

const sentence = (job: string, kind: string): string => `Sentence ${kind} of lesson ${job}.`;
function lesson(jobId: string, subject: MontageLesson['subject'], kinds: PreviewKind[], o: { onPage?: boolean } = {}): MontageLesson {
  const parts: PreviewPart[] = kinds.map((kind) => ({
    kind, componentId: `${kind}-v1`,
    options: [{ quote: sentence(jobId, kind), preview: { kind, title: kind, label: kind, outlined: false } as unknown as PartPreview }],
  }));
  const text = o.onPage === false ? 'Nothing quoted here at all.' : kinds.map((k) => sentence(jobId, k)).join(' ');
  return { jobId, subject, model: 'Muse Spark Open', pageTitle: `Page ${jobId}`, publisher: 'Publisher', text, parts };
}

const NINE = (): MontageLesson[] => [
  lesson(IDS.volcano, 'earth-science', ['label-diagram', 'sort-groups', 'quiz-cards']),
  lesson(IDS.water, 'earth-science', ['label-diagram', 'sequence']),
  lesson(IDS.dna, 'biology', ['label-diagram', 'quiz-cards']),
  lesson(IDS.waste, 'chemistry', ['half-life', 'sequence', 'sort-groups']),
  lesson(IDS.saving, 'finance', ['compound-interest', 'quiz-cards']),
  lesson(IDS.gov, 'civics', ['compare-table', 'sequence']),
  lesson(IDS.fall, 'physics', ['formula-explorer', 'data-table']),
  lesson(IDS.phishing, 'computing', ['sequence', 'sort-groups']),
  lesson(IDS.vra, 'history', ['compare-table', 'quiz-cards']),
];

const name = Object.fromEntries(Object.entries(IDS).map(([k, v]) => [v, k]));

test('montageBeats: opens on the volcano, alternates subjects and part kinds, one beat per lesson', () => {
  const beats = montageBeats(NINE());
  assert.deepEqual(beats.map((b) => name[b.jobId]), ['volcano', 'waste', 'water', 'saving', 'dna', 'gov', 'fall', 'phishing', 'vra']);
  for (let i = 0; i < beats.length; i++) {
    const a = beats[i]!;
    const b = beats[nextBeat(i, beats.length)]!;
    assert.notEqual(a.subject, b.subject, `subjects ${i}`);
    assert.notEqual(a.preview.kind, b.preview.kind, `kinds ${i}`);
  }
});

test('montageBeats: figures may repeat (each is a different figure); other kinds are not repeated while a lesson has another', () => {
  const beats = montageBeats(NINE());
  assert.deepEqual(beats.map((b) => b.preview.kind), [
    'label-diagram', 'half-life', 'label-diagram', 'compound-interest', 'label-diagram', 'compare-table', 'formula-explorer', 'sequence', 'quiz-cards',
  ]);
});

test('montageBeats: the volcano opens even when listed last; the order does not depend on load order', () => {
  const shuffled = NINE().reverse();
  assert.equal(montageBeats(shuffled)[0]!.jobId, IDS.volcano);
  assert.deepEqual(montageBeats(shuffled).map((b) => b.jobId), montageBeats(NINE()).map((b) => b.jobId));
});

test('montageBeats: a lesson that failed to load, or whose quotes are not on its page, is skipped; none gives no beats', () => {
  const list: (MontageLesson | null)[] = NINE();
  list[0] = null;
  list[2] = lesson(IDS.dna, 'biology', ['label-diagram'], { onPage: false });
  const beats = montageBeats(list);
  assert.equal(beats.length, 7);
  assert.ok(!beats.some((b) => b.jobId === IDS.volcano || b.jobId === IDS.dna));
  assert.deepEqual(montageBeats([]), []);
  assert.deepEqual(montageBeats([null, null]), []);
});

test('montageBeats: a part whose first quote is not on the page lights its next quote that is', () => {
  const l = lesson(IDS.gov, 'civics', ['sequence']);
  const part = l.parts[0]!;
  part.options.unshift({ quote: 'A quote the page does not contain.', preview: part.options[0]!.preview });
  const [beat] = montageBeats([l]);
  assert.equal(beat!.excerpt.lit, sentence(IDS.gov, 'sequence'));
});

test('montageBeats: a page heading that repeats the page title is not shown twice', () => {
  const l = { ...lesson(IDS.vra, 'history', ['quiz-cards']), pageTitle: 'Voting Rights Act (1965)' };
  l.text = `# Voting Rights Act (1965)\n\n${l.text}`;
  const [beat] = montageBeats([l]);
  assert.deepEqual(beat!.excerpt.blocks.map((b) => b.kind), ['text']);
});

// ---- a real stored run: the pinned water-cycle diagram and its page ----------------------------------------------

function realJob(o: { spec?: LabelDiagramSpec; published?: boolean; status?: string; model?: string } = {}): MontageJob {
  const spec = o.spec ?? WELCOME_FIXTURE_SPEC;
  return {
    summary: { jobId: IDS.water, sourceId: 'noaa-jetstream-hydrologic-cycle', status: o.status ?? 'succeeded', model: o.model ?? 'muse-spark-1.3', provider: 'meta-api' },
    lessonData: {
      lesson: { components: [{ componentId: 'label-diagram-v1', specId: spec.id, status: 'passed' }] },
      kitSpecs: { [spec.id]: spec },
      review: o.published === false ? null : { status: 'published' },
    },
  } as unknown as MontageJob;
}
const SOURCE = { title: 'The Hydrologic Cycle — NOAA National Weather Service, JetStream', text: WELCOME_FIXTURE_TEXT, subject: 'earth-science' };

test('montageLesson: a published lesson with its page; the title and publisher split from the page title', () => {
  const l = montageLesson(realJob(), SOURCE);
  assert.ok(l !== null);
  assert.equal(l.pageTitle, 'The Hydrologic Cycle');
  assert.equal(l.publisher, 'NOAA National Weather Service, JetStream');
  assert.equal(l.subject, 'earth-science');
  assert.equal(l.model, 'Muse Spark 1.3');
  assert.equal(montageLesson(realJob({ model: 'muse-spark-open' }), SOURCE)?.model, 'Muse Spark Open');
});

test('montageLesson: never an unpublished, unfinished or missing lesson, nor one without its page', () => {
  assert.equal(montageLesson(null, SOURCE), null);
  assert.equal(montageLesson(realJob({ published: false }), SOURCE), null, '"From published lessons" must stay true');
  assert.equal(montageLesson(realJob({ status: 'failed' }), SOURCE), null);
  assert.equal(montageLesson(realJob(), null), null);
  assert.equal(montageLesson(realJob(), { ...SOURCE, text: '' }), null);
});

test('real run: the beat lights the page sentence the first part was written from, and the figure focuses that part', () => {
  const [beat] = montageBeats([montageLesson(realJob(), SOURCE)]);
  assert.ok(beat !== undefined);
  assert.equal(beat.excerpt.lit, 'Evaporation is the change of state in a substance from a liquid to a gas.');
  assert.ok(beat.preview.kind === 'label-diagram');
  assert.equal(beat.preview.focus, 0);
  assert.equal(beat.pageTitle, 'The Hydrologic Cycle');
  assert.deepEqual(beat.caption, ['Earth & space', 'Muse Spark 1.3'], 'no outline stored in this run: no SAM claim');
});

test('real run: with SAM 3.1’s stored outline the caption says so, and the outlined part leads', () => {
  const s = JSON.parse(JSON.stringify(WELCOME_FIXTURE_SPEC)) as LabelDiagramSpec;
  (s.regions.find((r) => r.partId === 'condensation') as { outline?: string }).outline = 'M10 10L20 10L20 20Z';
  const [beat] = montageBeats([montageLesson(realJob({ spec: s }), SOURCE)]);
  assert.deepEqual(beat!.caption, ['Earth & space', 'Muse Spark 1.3', 'SAM 3.1 outlined']);
  assert.equal(beat!.excerpt.lit, 'Condensation is the process whereby water vapor is changed into a liquid state.');
});
