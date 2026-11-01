// Presentation mode (Stage 7c slice P4), pure parts: the deck of beats a lesson becomes, the navigation state and its
// reducer, the keyboard map, the deep link, and the plain-language lines of the title and closing beats.
//
// A BEAT is one screenful the teacher projects. Some beats build in STEPS (the overview adds one key point per step);
// a predict-then-reveal beat has two steps, the question and its answer. Next walks the steps, then the beats; R jumps to
// the beat's last step (everything revealed) and never moves on. Only parts that passed their checks are ever presented.

import type { ActivitySpec, AnyPrediction, EngineId, TimelineActivitySpec, TimelineEvent } from '../../../../packages/contracts/index.ts';
import type {
  CompareTableSpec, FormulaExplorerSpec, KeyPointGen, KeyTermGen, KitSpec, LessonSpec, QuizCardsSpec, SourceAnalysisV2,
} from '../../../../packages/contracts/kit.ts';
import { caseInputs, engineOutput, formatOutputValue, outputInfo, playbackPlan, projectileSummary } from './engines.ts';
import { buildExplorer, casePrompt, evalAt, groupedSig6, inputsOfCase, outputName } from './explorer.ts';
import { lessonCards } from './lesson.ts';
import { linkKey, linkKeysOf } from './linking.ts';
import type { QuoteLike } from './linking.ts';
import { compareConcealed, planPredict } from './compare.ts';
import { concealedKeys } from './conceal.ts';
import { aiLabel } from './displayText.ts';
import { capFirst } from './sources.ts';
import { gradeCaseGuess } from './explorer.ts';
import { gradePrediction, parseGuess, studentTolerance } from './predictions.ts';
import { gradeFeedback } from './feedback.ts';
import type { FeedbackLevel } from './feedback.ts';
import { mostVisualFirst } from './partOrder.ts';
import type { PartKind } from './partOrder.ts';
import type { PredictPlan } from './compare.ts';
import type { CheckTally, QuoteTally } from './provenance.ts';
import { isTimelineSpec, pairOptions } from './timeline.ts';
import type { AnyActivitySpec } from './timeline.ts';
import type { AlgorithmTraceSpec, DataTableSpec, LabelDiagramSpec, LogLadderSpec, ThresholdSpec } from '../../../../packages/contracts/kit.ts';
import type { EnginePresentation } from './enginePresentation.ts';
import { algorithmPresentationSteps } from './algorithmView.ts';
import { logLadderPresentationSteps } from './logLadderView.ts';
import { thresholdPresentationSteps, thresholdRevealQuote } from './thresholdView.ts';
import { dataTablePresentationSteps, dataTableRevealQuote } from './dataTableView.ts';
import { labelDiagramPresentationSteps } from './labelDiagramView.ts';
import { labelDiagramRevealQuote } from './labelDiagramView.ts';

// ---- the deck -----------------------------------------------------------------------------------------------------

export interface DeckSource {
  id: string; title: string; locator: string; license: string; attribution: string;
  kind?: 'library' | 'user' | undefined; licenseLabel?: string | undefined;
}

/** One presented part: a checked kit component, or the premium/classic activity (simulation or timeline). */
export type DeckPart = { kind: 'kit'; spec: KitSpec } | { kind: 'activity'; spec: AnyActivitySpec };

export interface Deck {
  jobId: string;
  /** The lesson's headline (overview headline, else the activity title, else the page title). */
  headline: string;
  source: DeckSource | null;
  /** The AI disclosure for this source kind (sources.ts disclosureText). */
  disclosure: string;
  /** Key points and terms only: Muse's internal page-coverage note never reaches the deck (Stage 7e). */
  overview: { keyPoints: readonly KeyPointGen[]; keyTerms: readonly KeyTermGen[] } | null;
  /** A classic activity's learning objectives (lesson runs have an overview instead). */
  objectives: readonly string[];
  parts: DeckPart[];
  /** Parts that were planned but did not pass their checks (never shown). */
  leftOut: number;
  /** No planned part passed today's checks: the deck is the notes only, and its disclosure line says so first. */
  notesOnly?: boolean;
  checks: CheckTally | null;
  quotes: QuoteTally | null;
}

interface DeckCommon { jobId: string; source: DeckSource | null; disclosure: string; checks: CheckTally | null; quotes: QuoteTally | null }

/** The one line a lesson with no working part carries (lesson view, Present hint, title slide). */
export const NOTES_ONLY_LINE = 'Notes only: no activity passed today’s checks.';

/** A lesson-flow run as a deck: the overview, then every passed part in plan order. */
export function deckFromLesson(input: DeckCommon & {
  lesson: LessonSpec; specs: Readonly<Record<string, KitSpec>>; premium: AnyActivitySpec | null; analysis: SourceAnalysisV2 | null; fallbackTitle: string;
}): Deck {
  const cards = lessonCards(input.lesson, input.specs, input.premium !== null);
  const parts: DeckPart[] = [];
  for (const c of cards) {
    if (c.status !== 'passed') continue;
    if (c.premium) { if (input.premium !== null) parts.push({ kind: 'activity', spec: input.premium }); continue; }
    if (c.spec !== null) parts.push({ kind: 'kit', spec: c.spec });
  }
  const ov = input.lesson.overview;
  const notesOnly = parts.length === 0 && cards.length > 0;
  return {
    jobId: input.jobId, source: input.source, checks: input.checks, quotes: input.quotes,
    // A notes-only deck opens on its title slide, whose disclosure line then starts by saying so.
    disclosure: notesOnly ? `${NOTES_ONLY_LINE} ${input.disclosure}` : input.disclosure,
    headline: ov?.headline ?? input.fallbackTitle,
    overview: ov === null ? null : { keyPoints: ov.keyPoints, keyTerms: ov.keyTerms },
    objectives: [],
    parts,
    leftOut: cards.filter((c) => c.status === 'failed').length,
    notesOnly,
  };
}

/** An older single-activity run as a deck: its objectives, then the activity. */
export function deckFromActivity(input: DeckCommon & { spec: AnyActivitySpec }): Deck {
  return {
    jobId: input.jobId, source: input.source, disclosure: input.disclosure, checks: input.checks, quotes: input.quotes,
    headline: input.spec.title, overview: null, objectives: input.spec.learningObjectives,
    parts: [{ kind: 'activity', spec: input.spec }], leftOut: 0,
  };
}

// ---- beats --------------------------------------------------------------------------------------------------------

export type PredictTarget =
  | { kind: 'engine'; spec: ActivitySpec; engine: EngineId; prediction: AnyPrediction }
  | { kind: 'formula'; spec: FormulaExplorerSpec; prompt: string }
  | { kind: 'timeline'; spec: TimelineActivitySpec; prompt: string; options: [TimelineEvent, TimelineEvent]; predictionId: string };

interface BeatBase {
  id: string;
  /** Short label for the progress bar (≤ 16 characters). */
  label: string;
  /** Full title (notes, tooltips, the screen-reader announcement). */
  title: string;
  /** Build steps; 1 = static. A predict-then-reveal beat has 2: the question, then the answer. */
  steps: number;
  /** The page's words behind this beat, for the presenter notes. */
  quotes: QuoteLike[];
  /** One line telling the teacher what to do here (presenter notes). */
  cue: string;
}

export type Beat =
  | BeatBase & { kind: 'title' }
  | BeatBase & { kind: 'overview' }
  /** `termQuotes`: one sentence per key term, in term order (the concealment of meanings not shown yet). */
  | BeatBase & { kind: 'terms'; termQuotes: QuoteLike[] }
  | BeatBase & { kind: 'objectives' }
  | BeatBase & { kind: 'quiz'; spec: QuizCardsSpec; cardId: string; number: number; of: number }
  | BeatBase & { kind: 'compare'; spec: CompareTableSpec; plan: PredictPlan | null }
  | BeatBase & { kind: 'predict'; target: PredictTarget }
  | BeatBase & { kind: 'stage'; part: DeckPart }
  /** A Stage 8a subject engine: `steps` = its view's `<name>PresentationSteps(spec)`; R reveals the current step only. */
  | BeatBase & { kind: 'engine'; part: { kind: 'kit'; spec: EngineSpec } }
  | BeatBase & { kind: 'closing' };

export type BeatKind = Beat['kind'];

// ---- the Stage 8a subject engines (docs/specs/STAGE-8a-subject-engines.md §4) -----------------------------------------

export type EngineSpec = AlgorithmTraceSpec | LogLadderSpec | ThresholdSpec | DataTableSpec | LabelDiagramSpec;

export function isEngineSpec(spec: KitSpec): spec is EngineSpec {
  return spec.componentId === 'algorithm-trace-v1' || spec.componentId === 'log-ladder-v1' || spec.componentId === 'threshold-v1' || spec.componentId === 'data-table-v1' || spec.componentId === 'label-diagram-v1';
}

/** How many presenter steps an engine part has (its view's own count; at least 1, whatever the view returns). */
export function enginePresentationSteps(spec: EngineSpec): number {
  let n: number;
  switch (spec.componentId) {
    case 'algorithm-trace-v1': n = algorithmPresentationSteps(spec); break;
    case 'log-ladder-v1': n = logLadderPresentationSteps(spec); break;
    case 'threshold-v1': n = thresholdPresentationSteps(spec); break;
    case 'data-table-v1': n = dataTablePresentationSteps(spec); break;
    case 'label-diagram-v1': n = labelDiagramPresentationSteps(spec); break;
  }
  return Number.isFinite(n) && n >= 1 ? Math.trunc(n) : 1;
}

/** The page sentence a revealed engine step shows in the quote zone (views without one: null). */
function engineRevealQuote(spec: EngineSpec, step: number): QuoteLike | null {
  switch (spec.componentId) {
    case 'threshold-v1': return thresholdRevealQuote(spec, step);
    case 'data-table-v1': return dataTableRevealQuote(spec, step);
    case 'label-diagram-v1': return labelDiagramRevealQuote(spec, step);
    default: return null;
  }
}

const STAGE_LABELS: Readonly<Record<string, string>> = {
  'sequence-v1': 'Sequence', 'sort-groups-v1': 'Sort', 'concept-map-v1': 'Concept map', 'compare-table-v1': 'Compare',
  'formula-explorer-v1': 'Formula', 'balance-equation-v1': 'Balance', 'quiz-cards-v1': 'Quiz', 'timeline-v1': 'Timeline',
  'algorithm-trace-v1': 'Algorithm', 'log-ladder-v1': 'Scale', 'threshold-v1': 'Vote', 'data-table-v1': 'Table', 'label-diagram-v1': 'Diagram',
};

const CUE = {
  title: 'Introduce the page and where it comes from. The lesson is a draft you have reviewed.',
  overview: 'Press → to bring in each key point. Hover a point to show the sentence it comes from.',
  terms: 'Ask what each term means before you press → to show the page’s meaning.',
  objectives: 'Say what the class will find out. Press → for each objective.',
  quiz: 'Read the question aloud and let the class vote (hands or cards). Click the option most chose, then press R.',
  compare: 'One cell is hidden. Let the class choose its value, click their choice, then press R.',
  predict: 'Collect a few estimates, agree on one class prediction and type it in, then press R. The value shown is worked out by code from this case’s inputs; within 2% counts as right.',
  pair: 'Let the class vote on which came first, click the event most chose, then press R for the dates.',
  stage: 'Run it with the class. The controls work as in the lesson.',
  engine: 'Ask the question on screen and let the class decide, then press R. Press → for the next question.',
  closing: 'Close with where the material came from and what was checked.',
} as const;

/** The quotes a part cites, in the order it shows them. */
export function partQuotes(part: DeckPart): QuoteLike[] {
  if (part.kind === 'activity') {
    const spec = part.spec;
    const fromEvents = isTimelineSpec(spec) ? spec.simulation.events.flatMap((e) => e.evidence) : [];
    return [...fromEvents, ...spec.explanations.flatMap((e) => e.evidence)];
  }
  const spec = part.spec;
  switch (spec.componentId) {
    case 'quiz-cards-v1': return spec.cards.map((c) => ({ sourceId: c.sourceId, quote: c.quote }));
    case 'sequence-v1': return spec.steps.map((s) => ({ sourceId: s.sourceId, quote: s.quote }));
    case 'sort-groups-v1': return spec.items.map((i) => ({ sourceId: i.sourceId, quote: i.quote }));
    case 'concept-map-v1': return spec.links.map((l) => ({ sourceId: l.sourceId, quote: l.quote }));
    case 'compare-table-v1': return spec.cells.map((c) => ({ sourceId: c.sourceId, quote: c.quote }));
    case 'formula-explorer-v1': return [
      { sourceId: spec.sourceId, quote: spec.quote },
      ...(spec.hasSourceExample ? [{ sourceId: spec.sourceId, quote: spec.sourceExample.quote }] : []),
    ];
    case 'balance-equation-v1': return [{ sourceId: spec.sourceId, quote: spec.quote }, ...spec.species.map((s) => ({ sourceId: s.sourceId, quote: s.quote }))];
    case 'algorithm-trace-v1': return [{ sourceId: spec.sourceId, quote: spec.quote }, ...spec.claims.map((c) => ({ sourceId: c.sourceId, quote: c.quote }))];
    case 'log-ladder-v1': return [{ sourceId: spec.sourceId, quote: spec.quote }, ...spec.rungs.map((r) => ({ sourceId: r.sourceId, quote: r.quote }))];
    case 'threshold-v1': return spec.stages.flatMap((s) => [{ sourceId: s.sourceId, quote: s.quote }, { sourceId: s.sourceId, quote: s.totalQuote }]);
    case 'label-diagram-v1': return spec.parts.map((p) => ({ sourceId: p.sourceId, quote: p.quote }));
    case 'data-table-v1': return spec.rows.flatMap((r) => [{ sourceId: r.sourceId, quote: r.quote }, ...r.values.map((v) => ({ sourceId: v.sourceId, quote: v.quote }))]);
    default: return [];
  }
}

function uniqueQuotes(quotes: readonly QuoteLike[]): QuoteLike[] {
  const seen = new Set<string>();
  const out: QuoteLike[] = [];
  for (const q of quotes) {
    const k = linkKey(q.sourceId, q.quote);
    if (k === '' || seen.has(k)) continue;
    seen.add(k);
    out.push(q);
  }
  return out;
}

function stageLabel(part: DeckPart): string {
  if (part.kind === 'kit') return STAGE_LABELS[part.spec.componentId] ?? 'Activity';
  return isTimelineSpec(part.spec) ? 'Timeline' : 'Simulation';
}

function partBeats(part: DeckPart, n: number): Beat[] {
  const quotes = uniqueQuotes(partQuotes(part));
  const id = `${n}:${part.spec.id}`;
  const stage: Beat = { kind: 'stage', id: `${id}:stage`, label: stageLabel(part), title: aiLabel(part.spec.title), steps: 1, quotes, cue: CUE.stage, part };

  if (part.kind === 'activity') {
    const spec = part.spec;
    if (isTimelineSpec(spec)) {
      const p = spec.predictions[0];
      const options = p === undefined ? null : pairOptions(spec.simulation.events, p, spec.id);
      if (p === undefined || options === null) return [stage];
      const predict: Beat = {
        kind: 'predict', id: `${id}:predict`, label: 'Which first?', title: aiLabel(p.prompt), steps: 2, cue: CUE.pair,
        quotes: uniqueQuotes(options.flatMap((e) => e.evidence)),
        target: { kind: 'timeline', spec, prompt: p.prompt, options, predictionId: p.id },
      };
      return [predict, stage];
    }
    const engine = spec.simulation.engine;
    const p = spec.predictions[0] as AnyPrediction | undefined;
    if (p === undefined || engineOutput(engine, p) === null) return [stage];
    const predict: Beat = {
      kind: 'predict', id: `${id}:predict`, label: 'Predict', title: aiLabel(p.prompt), steps: 2, cue: CUE.predict,
      quotes: uniqueQuotes(spec.explanations.flatMap((e) => e.evidence)).slice(0, 3),
      target: { kind: 'engine', spec, engine, prediction: p },
    };
    return [predict, stage];
  }

  const spec = part.spec;
  if (isEngineSpec(spec)) {
    return [{ kind: 'engine', id: `${id}:engine`, label: stageLabel(part), title: aiLabel(spec.title), steps: enginePresentationSteps(spec), quotes, cue: CUE.engine, part: { kind: 'kit', spec } }];
  }
  switch (spec.componentId) {
    case 'quiz-cards-v1':
      return spec.cards.map((c, i): Beat => ({
        kind: 'quiz', id: `${id}:card:${c.id}`, label: `Question ${i + 1}`, title: aiLabel(c.stem), steps: 2, cue: CUE.quiz,
        quotes: [{ sourceId: c.sourceId, quote: c.quote }], spec, cardId: c.id, number: i + 1, of: spec.cards.length,
      }));
    case 'compare-table-v1': {
      const plan = planPredict(spec);
      const hidden = plan === null ? undefined : spec.cells.find((c) => c.id === plan.cellId);
      return [{
        kind: 'compare', id: `${id}:compare`, label: 'Compare', title: aiLabel(spec.title), steps: plan === null ? 1 : 2,
        cue: plan === null ? CUE.stage : CUE.compare,
        quotes: hidden === undefined ? quotes : uniqueQuotes([hidden, ...quotes]), spec, plan,
      }];
    }
    case 'formula-explorer-v1': {
      const model = buildExplorer(spec);
      const first = spec.cases[0];
      if (!model.ok || first === undefined || !Number.isFinite(evalAt(model, inputsOfCase(first)))) return [stage];
      const prompt = casePrompt(spec, first);
      const predict: Beat = { kind: 'predict', id: `${id}:predict`, label: 'Predict', title: aiLabel(prompt), steps: 2, cue: CUE.predict, quotes, target: { kind: 'formula', spec, prompt } };
      return [predict, stage];
    }
    default:
      return [stage];
  }
}

/** A deck part's kind for the "most visual part" rule (lib/partOrder.ts). */
export function deckPartKind(part: DeckPart): PartKind {
  if (part.kind === 'kit') return part.spec.componentId;
  return isTimelineSpec(part.spec) ? 'timeline' : 'simulation';
}

/** The parts in teaching order: the most visual part first, other visual parts next, quizzes and sequences after. */
export function teachingOrder(parts: readonly DeckPart[]): DeckPart[] {
  return mostVisualFirst(parts, deckPartKind);
}

/** The AI summary's slide heading: a plain recap, never "what the page says" (that is for real quotes). */
export const SUMMARY_HEADING = 'In short';
export const SUMMARY_NOTE = 'AI-written summary';

/**
 * The beats of a deck, in teaching order: title, objectives (classic runs), then each part's beats with the most visual
 * part first (the hook), then the AI summary ("In short") and the key terms, which would answer the questions if they
 * came first, then the closing. Presenting starts on the hook (heroBeatIndex); the title stays one ← away.
 */
export function planBeats(deck: Deck): Beat[] {
  const beats: Beat[] = [{ kind: 'title', id: 'title', label: 'Title', title: aiLabel(deck.headline), steps: 1, quotes: [], cue: CUE.title }];
  if (deck.objectives.length > 0) {
    beats.push({ kind: 'objectives', id: 'objectives', label: 'Goals', title: 'What we will find out', steps: deck.objectives.length, quotes: [], cue: CUE.objectives });
  }
  teachingOrder(deck.parts).forEach((part, i) => { beats.push(...partBeats(part, i + 1)); });
  const ov = deck.overview;
  if (ov !== null && ov.keyPoints.length > 0) {
    beats.push({ kind: 'overview', id: 'overview', label: SUMMARY_HEADING, title: SUMMARY_HEADING, steps: ov.keyPoints.length, quotes: uniqueQuotes(ov.keyPoints), cue: CUE.overview });
  }
  if (ov !== null && ov.keyTerms.length > 0) {
    beats.push({
      kind: 'terms', id: 'terms', label: 'Key terms', title: 'Key terms', steps: ov.keyTerms.length + 1, quotes: uniqueQuotes(ov.keyTerms), cue: CUE.terms,
      termQuotes: ov.keyTerms.map((t) => ({ sourceId: t.sourceId, quote: t.quote })),
    });
  }
  beats.push({ kind: 'closing', id: 'closing', label: 'Sources', title: 'Where this came from', steps: 1, quotes: [], cue: CUE.closing });
  return beats;
}

const PART_BEATS: ReadonlySet<BeatKind> = new Set<BeatKind>(['engine', 'predict', 'stage', 'compare', 'quiz']);

/** The hook: the first beat of the first part (the most visual ask), or 0 when the deck has no part. */
export function heroBeatIndex(beats: readonly Beat[]): number {
  const i = beats.findIndex((b) => PART_BEATS.has(b.kind));
  return i < 0 ? 0 : i;
}

/** A start beat meaning "open on the hook" (Present button, a `?present=` link without `&beat=`). */
export const HOOK_BEAT = -1;

/**
 * The one-line credit on the hook slide, so the first slide shown carries the source and the AI disclosure: page ·
 * publisher · licence · "AI-written, teacher review pending". Null without source information.
 */
export function creditLine(source: DeckSource | null): string | null {
  const card = titleCard(source);
  if (card === null) return null;
  return [card.name, card.from, card.licence, 'AI-written, teacher review pending'].filter((x): x is string => x !== null && x.trim() !== '').join(' · ');
}

/** A beat's name on the bar's track, short enough to stay whole beside its neighbours ('Q2' for a quiz card). */
export function trackLabel(beat: Beat): string {
  return beat.kind === 'quiz' ? `Q${beat.number}` : beat.label;
}

/** The bar's "where am I" line: the beat's label and, on a beat that builds or asks several questions, the step. */
export function stepCaption(beat: Beat, s: Pick<PresentState, 'step' | 'revealed'>): string {
  const step = Math.max(0, Math.min(beat.steps - 1, s.step));
  switch (beat.kind) {
    case 'engine':
      return beat.steps > 1 ? `${beat.label} · step ${step + 1} of ${beat.steps}${s.revealed ? ' · revealed' : ''}` : `${beat.label}${s.revealed ? ' · revealed' : ''}`;
    case 'overview':
      return `${beat.label} · point ${step + 1} of ${beat.steps}`;
    case 'objectives':
      return `${beat.label} · ${step + 1} of ${beat.steps}`;
    case 'terms':
      return step === 0 ? `${beat.label} · ask first` : `${beat.label} · meaning ${step} of ${beat.steps - 1}`;
    case 'quiz':
      return `Question ${beat.number} of ${beat.of}${isRevealed(beat, step) ? ' · revealed' : ''}`;
    case 'predict': case 'compare':
      return beat.steps > 1 ? `${beat.label} · ${isRevealed(beat, step) ? 'revealed' : 'ask'}` : beat.label;
    default:
      return beat.label;
  }
}

/** How many items of a building beat are shown at `step`: overview points / objectives (first one on arrival), term meanings (none on arrival). */
export function visibleCount(beat: Pick<Beat, 'kind' | 'steps'>, step: number): number {
  const s = Math.max(0, Math.min(step, beat.steps - 1));
  return beat.kind === 'terms' ? s : s + 1;
}

export function canReveal(beat: Pick<Beat, 'steps'>, step: number): boolean { return step < beat.steps - 1; }

/** A predict-then-reveal (or building) beat at its last step. */
export function isRevealed(beat: Pick<Beat, 'steps'>, step: number): boolean { return beat.steps > 1 && step >= beat.steps - 1; }

/** Every quote the deck uses, once each, in beat order. */
export function deckQuotes(beats: readonly Beat[]): QuoteLike[] {
  return uniqueQuotes(beats.flatMap((b) => b.quotes));
}

// ---- the reveal of a numeric predict beat -------------------------------------------------------------------------

export interface NumericAnswer { value: number; display: string; unit: string; label: string }

/** The checked value a numeric predict beat reveals: the engine's (or calculator's) output for the first case. */
export function numericAnswer(target: PredictTarget): NumericAnswer | null {
  if (target.kind === 'engine') {
    const value = engineOutput(target.engine, target.prediction);
    if (value === null) return null;
    const out = outputInfo(target.engine);
    return { value, display: formatOutputValue(target.engine, value), unit: out.unit, label: out.label };
  }
  if (target.kind === 'formula') {
    const model = buildExplorer(target.spec);
    const first = target.spec.cases[0];
    if (!model.ok || first === undefined) return null;
    const value = evalAt(model, inputsOfCase(first));
    if (!Number.isFinite(value)) return null;
    return { value, display: groupedSig6(value), unit: '', label: outputName(target.spec) };
  }
  return null;
}

/** What a predict beat draws: the projectile scene with the guess line, the formula's graph, another engine's own scene, or the which-came-first pair. */
export type PredictVisual = 'projectile' | 'graph' | 'scene' | 'pair';

export function predictVisual(target: PredictTarget): PredictVisual {
  if (target.kind === 'timeline') return 'pair';
  if (target.kind === 'formula') return 'graph';
  return target.engine === 'projectile-v1' ? 'projectile' : 'scene';
}

/** How long the numbers wait after R for a graph's point to settle (its CSS settle runs 720 ms). */
export const GRAPH_SETTLE_MS = 720;

/**
 * How long after R the class number, the checked value and the verdict wait, so the scene answers first: a projectile's
 * until the ball reaches the top (the playback plan's wall-clock time to the apex), a graph's until its point settles,
 * other scenes not at all.
 */
export function revealDelayMs(target: PredictTarget): number {
  if (target.kind === 'formula') return GRAPH_SETTLE_MS;
  if (target.kind !== 'engine' || target.engine !== 'projectile-v1') return 0;
  const inputs = caseInputs('projectile-v1', target.prediction);
  const plan = playbackPlan('projectile-v1', inputs);
  const sum = projectileSummary(inputs);
  if (plan === null || sum === null || !(plan.speed > 0)) return 0;
  return Math.round((sum.apexTimeS / plan.speed) * 1000);
}

/**
 * The verdict under a revealed numeric predict beat, in the lesson's voice (lib/feedback.ts): the class number against
 * the checked value, graded with the teaching margin (engine cases: max(case tolerance, 2 %); formula cases: 2 %).
 * `headline` + `detail` are the slide's two lines, `text` the one compact line. Null when no class number was entered.
 */
export function predictVerdict(answer: NumericAnswer, guessRaw: string, caseTolerance: number | null): { within: boolean; level: FeedbackLevel; text: string; headline: string; detail: string } | null {
  const guess = parseGuess(guessRaw);
  if (guess === null) return null;
  const g = caseTolerance === null ? gradeCaseGuess(guess, answer.value) : gradePrediction(guess, answer.value, studentTolerance(answer.value, caseTolerance));
  const f = gradeFeedback(g, { unit: answer.unit, format: (n) => (n === answer.value ? answer.display : String(n)) });
  return { within: f.ok, level: f.level, text: f.line, headline: f.headline, detail: f.detail };
}

// ---- navigation ---------------------------------------------------------------------------------------------------

export interface PresentState {
  beat: number;
  step: number;
  blank: boolean;
  /** B blanks to black, W to white (as in slide software). */
  blankTone: 'black' | 'white';
  notes: boolean;
  help: boolean;
  /** Per beat id: the class's choice or estimate, kept while moving around the deck. */
  answers: Readonly<Record<string, string>>;
  /** An engine beat's current step has been revealed with R (cleared by every move; unused on other beats). */
  revealed: boolean;
}

export type PresentAction =
  | { type: 'next' } | { type: 'prev' } | { type: 'reveal' } | { type: 'jump'; beat: number } | { type: 'first' } | { type: 'last' }
  | { type: 'blank'; tone?: 'white' } | { type: 'notes' } | { type: 'help' } | { type: 'answer'; beatId: string; value: string }
  /** A key typed into the class prediction of the open number question (digits, '.', '-', Backspace). */
  | { type: 'type'; key: string };

/** The open number question: an unrevealed engine or formula predict beat, where the keys type the class prediction. */
export function acceptsNumber(beat: Beat, step: number): boolean {
  return beat.kind === 'predict' && beat.target.kind !== 'timeline' && !isRevealed(beat, step);
}

/** Longest class prediction typed from the keyboard. */
const MAX_TYPED = 12;

function typeInto(prev: string, key: string): string {
  if (key === 'Backspace') return prev.slice(0, -1);
  if (key === '-') return prev === '' ? '-' : prev;
  if (key === '.') return prev.includes('.') ? prev : `${prev === '' || prev === '-' ? `${prev}0` : prev}.`;
  if (/^[0-9]$/.test(key)) return prev.length >= MAX_TYPED ? prev : `${prev}${key}`;
  return prev;
}

const clampBeat = (beats: readonly Beat[], n: number): number => (Number.isFinite(n) ? Math.max(0, Math.min(beats.length - 1, Math.trunc(n))) : 0);

export function initialPresent(beats: readonly Beat[], beat = 0): PresentState {
  // A negative start (HOOK_BEAT) opens on the hook: the first part's first beat.
  const at = Number.isFinite(beat) && beat < 0 ? heroBeatIndex(beats) : clampBeat(beats, beat);
  return { beat: at, step: 0, blank: false, blankTone: 'black', notes: false, help: false, answers: {}, revealed: false };
}

/** Whether the current beat shows its answer: an engine beat's current step after R, any other beat at its last step. */
export function beatRevealed(beat: Beat, s: Pick<PresentState, 'step' | 'revealed'>): boolean {
  return beat.kind === 'engine' ? s.revealed : isRevealed(beat, s.step);
}

/** Whether R would show something new now (the bar's Reveal button). */
export function canRevealNow(beat: Beat, s: Pick<PresentState, 'step' | 'revealed'>): boolean {
  return beat.kind === 'engine' ? !s.revealed : canReveal(beat, s.step);
}

/** What an engine view is told while presenting (EnginePresentation, frozen in STAGE-8a §4). */
export function engineStage(beat: Beat, s: Pick<PresentState, 'step' | 'revealed'>): EnginePresentation {
  const step = Math.max(0, Math.min(beat.steps - 1, s.step));
  return { mode: 'stage', step, revealed: beat.kind === 'engine' && s.revealed };
}

/** The navigation reducer for one deck. */
export function presentReducer(beats: readonly Beat[]) {
  const stepsOf = (i: number): number => beats[i]?.steps ?? 1;
  const isEngine = (i: number): boolean => beats[i]?.kind === 'engine';
  return (s: PresentState, a: PresentAction): PresentState => {
    const moving = a.type === 'next' || a.type === 'prev' || a.type === 'jump' || a.type === 'first' || a.type === 'last' || a.type === 'reveal';
    // A blanked screen comes back on the next key press without moving (as in slide software).
    if (s.blank && (a.type === 'next' || a.type === 'prev' || a.type === 'reveal')) return { ...s, blank: false };
    // Every move leaves an engine step unrevealed; only R (below) reveals it.
    const base = moving ? { ...s, help: false, blank: false, revealed: false } : s;
    switch (a.type) {
      case 'next':
        if (s.step < stepsOf(s.beat) - 1) return { ...base, step: s.step + 1 };
        if (s.beat < beats.length - 1) return { ...base, beat: s.beat + 1, step: 0 };
        return { ...base, revealed: s.revealed };
      case 'prev':
        // An engine step's answer is hidden again first (as ← from a revealed predict beat goes back to its question).
        if (isEngine(s.beat) && s.revealed) return base;
        if (s.step > 0) return { ...base, step: s.step - 1 };
        if (s.beat > 0) return { ...base, beat: s.beat - 1, step: stepsOf(s.beat - 1) - 1 };
        return base;
      case 'reveal':
        // An engine beat reveals its current step; any other beat jumps to its last step (everything revealed).
        return isEngine(s.beat) ? { ...base, revealed: true } : { ...base, step: stepsOf(s.beat) - 1 };
      case 'jump': return { ...base, beat: clampBeat(beats, a.beat), step: 0 };
      case 'first': return { ...base, beat: 0, step: 0 };
      case 'last': return { ...base, beat: beats.length - 1, step: 0 };
      case 'blank': {
        const tone = a.tone ?? 'black';
        // The same key again brings the picture back; the other one swaps the colour.
        return s.blank && s.blankTone === tone ? { ...s, blank: false, help: false } : { ...s, blank: true, blankTone: tone, help: false };
      }
      case 'notes': return { ...s, notes: !s.notes };
      case 'help': return { ...s, help: !s.help };
      case 'answer': return { ...s, answers: { ...s.answers, [a.beatId]: a.value } };
      case 'type': {
        const b = beats[s.beat];
        if (b === undefined || !acceptsNumber(b, s.step)) return s;
        return { ...s, answers: { ...s.answers, [b.id]: typeInto(s.answers[b.id] ?? '', a.key) } };
      }
    }
  };
}

// ---- keys ---------------------------------------------------------------------------------------------------------

/**
 * Where a key press lands: a field or slider that uses the keys itself, a button (Space/Enter activate it), the open number
 * question of a predict beat (digits type the class prediction), or none of these.
 */
export type KeyContext = 'none' | 'button' | 'text' | 'numeric';

const TEXT_ROLES = new Set(['slider', 'spinbutton', 'textbox', 'combobox', 'listbox', 'option', 'radio', 'radiogroup', 'searchbox', 'menuitem']);
const BUTTON_INPUTS = new Set(['button', 'submit', 'reset']);

export function keyContext(el: { tagName: string; type?: string; isContentEditable?: boolean; role?: string | null } | null): KeyContext {
  if (el === null) return 'none';
  const tag = el.tagName.toUpperCase();
  if (el.isContentEditable === true) return 'text';
  if (tag === 'INPUT') return BUTTON_INPUTS.has((el.type ?? 'text').toLowerCase()) ? 'button' : 'text';
  if (tag === 'TEXTAREA' || tag === 'SELECT') return 'text';
  if (el.role !== undefined && el.role !== null && TEXT_ROLES.has(el.role)) return 'text';
  if (tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY') return 'button';
  return 'none';
}

export interface KeyLike { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }

/**
 * The keyboard map. 'exit' leaves presentation mode, 'fullscreen' toggles full screen, 'release' lets go of a focused
 * field (Esc inside it), null = not ours. Browser shortcuts (Ctrl/Cmd/Alt) are never taken.
 */
export function keyAction(e: KeyLike, context: KeyContext): PresentAction | 'exit' | 'fullscreen' | 'release' | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  if (context === 'text') return e.key === 'Escape' ? 'release' : null;
  if (context === 'button' && (e.key === ' ' || e.key === 'Enter')) return null;
  switch (e.key) {
    case 'ArrowRight': case 'ArrowDown': case 'PageDown': case ' ': return { type: 'next' };
    case 'ArrowLeft': case 'ArrowUp': case 'PageUp': return { type: 'prev' };
    case 'Home': return { type: 'first' };
    case 'End': return { type: 'last' };
    case 'Escape': return 'exit';
    default: break;
  }
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (context === 'numeric') {
    if (/^[0-9]$/.test(key) || key === '.' || key === '-' || key === 'Backspace') return { type: 'type', key };
    if (key === ',') return { type: 'type', key: '.' };
  }
  if (/^[0-9]$/.test(key)) return { type: 'jump', beat: key === '0' ? 9 : Number(key) - 1 };
  switch (key) {
    case 'r': return { type: 'reveal' };
    case 'b': case '.': return { type: 'blank' };
    case 'w': case ',': return { type: 'blank', tone: 'white' };
    case 'p': return { type: 'notes' };
    case '?': case 'h': return { type: 'help' };
    case 'f': return 'fullscreen';
    default: return null;
  }
}

/** The keyboard map as shown in the help overlay. */
export const KEY_MAP: readonly { keys: string; does: string }[] = [
  { keys: '→  Space  PgDn', does: 'Next step or beat' },
  { keys: '←  PgUp', does: 'Back' },
  { keys: 'R', does: 'Reveal the answer' },
  { keys: '1–9  0', does: 'Jump to beat (0 = 10); on a number question, type the class prediction' },
  { keys: 'Home  End', does: 'First or last beat' },
  { keys: 'B', does: 'Black screen' },
  { keys: 'W', does: 'White screen' },
  { keys: 'P', does: 'Presenter notes' },
  { keys: 'F', does: 'Full screen' },
  { keys: '?', does: 'This list' },
  { keys: 'Esc', does: 'Leave presentation' },
];

// ---- deep link ----------------------------------------------------------------------------------------------------

/** `?present=<jobId>[&beat=N]` (N is 1-based on the address bar, 0-based here); without a valid `&beat=` it opens on the hook (HOOK_BEAT). */
export function presentRequest(search: string): { jobId: string; beat: number } | null {
  const q = new URLSearchParams(search);
  const jobId = q.get('present');
  if (jobId === null || jobId === '') return null;
  const n = Number(q.get('beat'));
  return { jobId, beat: q.get('beat') !== null && Number.isInteger(n) && n >= 1 ? n - 1 : HOOK_BEAT };
}

/** The address while presenting: other parameters kept, `job` replaced by `present` and the 1-based beat. */
export function presentSearch(search: string, jobId: string, beat: number): string {
  const q = new URLSearchParams(search);
  q.delete('job'); q.delete('present'); q.delete('beat');
  q.set('present', jobId);
  q.set('beat', String(beat + 1));
  return `?${q.toString()}`;
}

/** The address after leaving: the same lesson stays open (`?job=`). */
export function exitSearch(search: string, jobId: string): string {
  const q = new URLSearchParams(search);
  q.delete('present'); q.delete('beat'); q.delete('job');
  q.set('job', jobId);
  return `?${q.toString()}`;
}

// ---- title and closing lines --------------------------------------------------------------------------------------

const LICENCE_TEXT: Readonly<Record<string, string>> = {
  'US-Gov-Work': 'U.S. Government work',
  'CC0-1.0': 'CC0 1.0',
  'CC-BY-4.0': 'CC BY 4.0',
};

export function licenceText(license: string): string { return LICENCE_TEXT[license] ?? license; }

const norm = (s: string): string => s.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * A figure's credit as ONE line: who made it, then its licence. The stored licence often repeats the publisher in a
 * bracket ("U.S. Government work (U.S. National Library of Medicine), public domain") and adds the conditions of use
 * after a ';' or in a later sentence ("credit NOAA; AI edits must be disclosed"). Those are rules for us, not a credit:
 * only the licence's first clause is printed, without a bracket that repeats the credit.
 */
export function figureCredit(fig: { credit: string; license: string }): string {
  const credit = fig.credit.replace(/^\s*credit:\s*/i, '').replace(/\s+/g, ' ').trim();
  const first = (fig.license.split(/;|(?<=\p{Ll}{2})\.\s+(?=\p{Lu})/u)[0] ?? '').replace(/\s+/g, ' ').trim().replace(/\.$/, '');
  const licence = credit === ''
    ? first
    : first.replace(/\s*\(([^()]*)\)/g, (m, inner: string) => (norm(inner) === norm(credit) ? '' : m)).trim();
  const policy = /\b(?:must|should|disclos\w*|insignia|endorse\w*)\b/i;
  return [credit, policy.test(licence) ? '' : licence].filter((s) => s !== '').join(' · ');
}

/**
 * The one page claim an algorithm slide prints under the trace (two, e.g. "O(ln n)" beside "O(log n)", read as a
 * typo to a class): the claim about comparisons, which the trace counts on screen; else the running time; else the first.
 */
export function stageClaim<C extends { kind: string; text: string }>(claims: readonly C[]): C | null {
  return claims.find((c) => /\bcomparisons?\b/i.test(c.text))
    ?? claims.find((c) => c.kind === 'running-time')
    ?? claims[0]
    ?? null;
}

const PROJECT_TEAM = /^\s*Written by the Make knowledge interactive project team\b/i;

/** The title beat's source lines: the page's own name, who it is from, its licence in plain words. */
export function titleCard(source: DeckSource | null): { name: string; from: string | null; licence: string } | null {
  if (source === null) return null;
  const at = source.title.indexOf(' — ');
  const name = capFirst(at > 0 ? source.title.slice(0, at).trim() : source.title.trim());
  let from: string | null = at > 0 ? source.title.slice(at + 3).trim() : null;
  if (PROJECT_TEAM.test(source.attribution)) from = 'Written by the project team';
  else if (source.kind === 'user' && from === null) from = 'A teacher’s own text';
  const licence = source.kind === 'user' ? (source.licenseLabel ?? licenceText(source.license)) : licenceText(source.license);
  return { name, from, licence };
}

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/** One calm line: what code checked. Counts come from the stored run; a missing count is left out, never guessed. */
export function checksLine(checks: CheckTally | null, quotes: QuoteTally | null): string | null {
  const parts: string[] = [];
  if (checks !== null) {
    parts.push(checks.passed === checks.total
      ? (checks.total === 1 ? 'The 1 check passed' : `All ${checks.total} checks passed`)
      : `${checks.passed} of ${checks.total} ${plural(checks.total, 'check', 'checks')} passed`);
  }
  if (quotes !== null) {
    const all = quotes.found === quotes.total;
    const text = all
      ? `${quotes.total === 1 ? 'the 1 quote' : `all ${quotes.total} quotes`} found on the page`
      : `${quotes.found} of ${quotes.total} ${plural(quotes.total, 'quote', 'quotes')} found on the page`;
    parts.push(parts.length === 0 ? text.charAt(0).toUpperCase() + text.slice(1) : text);
  }
  return parts.length === 0 ? null : parts.join(' · ');
}

export function leftOutLine(n: number): string | null {
  if (n <= 0) return null;
  return n === 1
    ? '1 part was left out because it could not be verified against the page.'
    : `${n} parts were left out because they could not be verified against the page.`;
}

/** The page sentence behind the hovered element's link keys (lib/linking.ts), or null. */
export function quoteForLinks(keys: readonly string[], quotes: readonly QuoteLike[]): string | null {
  return quoteRefForLinks(keys, quotes)?.quote ?? null;
}

/** The quote (with its source) behind the hovered element's link keys, or null. */
export function quoteRefForLinks(keys: readonly string[], quotes: readonly QuoteLike[]): QuoteLike | null {
  if (keys.length === 0) return null;
  for (const q of quotes) if (keys.includes(linkKey(q.sourceId, q.quote))) return { sourceId: q.sourceId, quote: q.quote };
  return null;
}

// ---- display text of the overview beats (pass 3: sentence case everywhere) ----------------------------------------

/** The key terms as a slide shows them: term and meaning in sentence case (symbols and units kept); quotes verbatim. */
export function shownTerms(deck: Pick<Deck, 'overview'>): KeyTermGen[] {
  return (deck.overview?.keyTerms ?? []).map((t) => ({ ...t, term: aiLabel(t.term), gloss: aiLabel(t.gloss) }));
}

/** The key points as a slide shows them: sentence case with display maths; quotes verbatim. */
export function shownPoints(deck: Pick<Deck, 'overview'>): KeyPointGen[] {
  return (deck.overview?.keyPoints ?? []).map((p) => ({ ...p, point: aiLabel(p.point) }));
}

// ---- the quote zone: one anchored place per slide for what the page says ------------------------------------------

/** The page quote a beat reveals with R (a quiz card's quote, the hidden compare cell's quote, an engine step's), or null. */
export function revealQuote(beat: Beat, step: number, revealed = false): QuoteLike | null {
  if (beat.kind === 'engine') return revealed ? engineRevealQuote(beat.part.spec, step) : null;
  if (!isRevealed(beat, step)) return null;
  if (beat.kind === 'quiz') {
    const card = beat.spec.cards.find((c) => c.id === beat.cardId);
    return card === undefined ? null : { sourceId: card.sourceId, quote: card.quote };
  }
  if (beat.kind === 'compare' && beat.plan !== null) {
    const cellId = beat.plan.cellId;
    const cell = beat.spec.cells.find((c) => c.id === cellId);
    return cell === undefined ? null : { sourceId: cell.sourceId, quote: cell.quote };
  }
  return null;
}

/** Quotes a beat prints in its own body (never repeated in the zone): a revealed pair's two events, the closing list. */
export function visibleQuotes(beat: Beat, step: number, beats: readonly Beat[]): QuoteLike[] {
  if (beat.kind === 'predict' && beat.target.kind === 'timeline') {
    if (!isRevealed(beat, step)) return [];
    return beat.target.options.flatMap((e) => (e.evidence[0] === undefined ? [] : [{ sourceId: e.evidence[0].sourceId, quote: e.evidence[0].quote }]));
  }
  if (beat.kind === 'closing') return deckQuotes(beats).slice(0, CLOSING_QUOTES);
  return [];
}

/** How many of the deck's quotes the closing beat prints. */
export const CLOSING_QUOTES = 3;

/**
 * What the quote zone shows: the hovered element's quote, else a quote pinned with "Show in source", else the quote the
 * beat revealed, else nothing. A quote already printed in the slide's body is never echoed: hovering it leaves the zone
 * as it was. A CONCEALED quote (beatConcealed: it would give an open answer away) is never shown, however it got there —
 * so ← from a revealed answer empties the zone even while the pointer still rests on the zone's own quote.
 */
export function zoneQuote(input: { hovered: QuoteLike | null; pinned: QuoteLike | null; revealed: QuoteLike | null; visible: readonly QuoteLike[]; concealed?: ReadonlySet<string> }): QuoteLike | null {
  const printed = new Set(input.visible.map((q) => linkKey(q.sourceId, q.quote)));
  const hidden = input.concealed ?? new Set<string>();
  const fresh = (q: QuoteLike | null): q is QuoteLike => q !== null && linkKey(q.sourceId, q.quote) !== '' && !printed.has(linkKey(q.sourceId, q.quote)) && !hidden.has(linkKey(q.sourceId, q.quote));
  if (fresh(input.hovered)) return input.hovered;
  if (fresh(input.pinned)) return input.pinned;
  if (fresh(input.revealed)) return input.revealed;
  return null;
}

/**
 * The link keys a beat keeps dark right now (lib/conceal.ts, the policy the lesson views use too): an open quiz card's
 * sentence; the hidden compare cell's sentence and every cell sentence that states its value; the sentence behind each
 * key term whose meaning is not shown yet. Engine views unlink their own answer-bearing quotes (a threshold rule that
 * states the count, a table cell that is the answer); the presenter also drops every hover on each move, so a quote
 * the pointer rested on after R never outlives ←. Empty once the answer is revealed.
 */
export function beatConcealed(beat: Beat, s: Pick<PresentState, 'step' | 'revealed'>): Set<string> {
  switch (beat.kind) {
    case 'quiz': {
      if (isRevealed(beat, s.step)) return new Set();
      const card = beat.spec.cards.find((c) => c.id === beat.cardId);
      return card === undefined ? new Set() : concealedKeys([], { quote: { sourceId: card.sourceId, quote: card.quote }, values: [] });
    }
    case 'compare':
      return isRevealed(beat, s.step) ? new Set() : compareConcealed(beat.spec, beat.plan);
    case 'terms': {
      const shown = visibleCount(beat, s.step);
      // A term whose meaning shows keeps its link, unless it shares the sentence with a term still hidden.
      return new Set(linkKeysOf(beat.termQuotes.filter((_, i) => i >= shown)));
    }
    default:
      return new Set();
  }
}


export type ZoneQuoteSize = 'normal' | 'long' | 'longer' | 'longest';

/** The zone's text size for a quote of this length, so three to five lines always fit its reserved band. */
export function zoneQuoteSize(quote: string): ZoneQuoteSize {
  const n = quote.replace(/\s+/g, ' ').trim().length;
  if (n <= 230) return 'normal';
  if (n <= 360) return 'long';
  if (n <= 560) return 'longer';
  return 'longest';
}
