// Welcome v3 (docs/specs/WELCOME-V3-split.md): small, faithful previews of a lesson's parts, drawn only from the stored
// specs (and, for the curves, from the same engines the lesson runs). One preview model per part kind, sized by the
// caller, so the Welcome montage and a later wall of lesson previews (option 2) share them. Each part offers options: a
// page quote it was written from, with the preview showing that quote's element in focus (a diagram part, a table cell,
// a step, a chip). The caller lights the first quote the page actually contains. Unknown kinds give no preview.
// Pure: no React, no DOM, no network.

import type {
  CompareTableSpec, DataTableSpec, FormulaExplorerSpec, LabelDiagramSpec, QuizCardsSpec, SequenceSpec, SortGroupsSpec,
} from '../../../../packages/contracts/kit.ts';
import { compareGrid } from './compare.ts';
import { formatUSD, growthPoints } from './compound.ts';
import { decayPoints, halfLifeMarkers } from './decay.ts';
import { aiLabel, aiText, capitalFirst } from './displayText.ts';
import { prettyUnit } from './engines.ts';
import type { PctBox } from './labelDiagramView.ts';
import { partViews, regionDrawing } from './labelDiagramView.ts';
import { componentLabel } from './lesson.ts';
import { quizCards } from './quiz.ts';

export type PreviewKind =
  | 'label-diagram' | 'half-life' | 'compound-interest' | 'formula-explorer' | 'data-table' | 'compare-table'
  | 'sequence' | 'sort-groups' | 'quiz-cards';

/** Most visual first: the order a lesson's parts are offered in. */
export const PREVIEW_ORDER: readonly PreviewKind[] = [
  'label-diagram', 'half-life', 'compound-interest', 'formula-explorer', 'data-table', 'compare-table', 'sequence', 'sort-groups', 'quiz-cards',
];

const KIND_OF: Readonly<Record<string, PreviewKind>> = {
  'label-diagram-v1': 'label-diagram', 'half-life-v1': 'half-life', 'compound-interest-v1': 'compound-interest',
  'formula-explorer-v1': 'formula-explorer', 'data-table-v1': 'data-table', 'compare-table-v1': 'compare-table',
  'sequence-v1': 'sequence', 'sort-groups-v1': 'sort-groups', 'quiz-cards-v1': 'quiz-cards',
};

interface Base {
  /** The part's title as the lesson shows it. */
  title: string;
  /** The kind's name ("Label the diagram", "Sequence"). */
  label: string;
}
export interface DiagramPreviewPart {
  number: number;
  name: string;
  /** Percent of the figure: the part's marker point. */
  point: { left: number; top: number };
  /** SAM 3.1's stored outline (SVG path on the figure's pixel grid), or null when none was stored. */
  outline: string | null;
  /** The model box (SAM's when sure, else Muse's located box), or null: no box at all. */
  glow: PctBox | null;
}
export interface DiagramPreview extends Base {
  kind: 'label-diagram';
  figureId: string;
  /** width / height of the stored figure. */
  aspect: number;
  viewBox: string;
  parts: DiagramPreviewPart[];
  /** Index in `parts` of the part whose sentence is lit. */
  focus: number;
  /** At least one part carries SAM 3.1's stored outline. */
  outlined: boolean;
}
export interface CurvePreview extends Base {
  kind: 'half-life' | 'compound-interest';
  /** 0..1 on both axes, y up. */
  points: { x: number; y: number }[];
  marks: { x: number; y: number; text: string }[];
  xLabel: string;
  yLabel: string;
}
export interface FormulaPreview extends Base {
  kind: 'formula-explorer';
  formula: string;
  slider: { symbol: string; meaning: string; unit: string; min: number; max: number; value: number; at: number } | null;
}
export interface TablePreview extends Base {
  kind: 'compare-table' | 'data-table';
  head: string[];
  rows: string[][];
  /** The cell tied to the lit sentence (col 0 is the row label). */
  focus: { row: number; col: number };
}
export interface SequencePreview extends Base { kind: 'sequence'; steps: string[]; total: number; focus: number }
export interface SortPreview extends Base { kind: 'sort-groups'; groups: { label: string; chips: string[] }[]; focus: { group: number; chip: number } }
export interface QuizPreview extends Base { kind: 'quiz-cards'; stem: string; options: string[] }

export type PartPreview = DiagramPreview | CurvePreview | FormulaPreview | TablePreview | SequencePreview | SortPreview | QuizPreview;

export interface PreviewOption { quote: string; preview: PartPreview }
export interface PreviewPart { kind: PreviewKind; componentId: string; options: PreviewOption[] }

/** The slice of GET /api/jobs/:id (as api.job parses it) the previews read. */
export interface PreviewJob {
  summary: { status: string };
  /** The job's activity spec: a lesson's simulation part (half-life, compound interest) lives here. */
  spec?: unknown;
  lessonData?: {
    lesson: { components: ReadonlyArray<{ componentId: string; specId: string; status: string }> } | null;
    kitSpecs: Readonly<Record<string, { componentId: string }>>;
  } | null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const DASH = '—';
const PREVIEW_ROWS = 3;
const PREVIEW_COLS = 2;
const PREVIEW_STEPS = 3;
const PREVIEW_CHIPS = 3;
const CURVE_STEPS = 48;

// ---- per kind --------------------------------------------------------------------------------------------------

function diagram(spec: LabelDiagramSpec): PreviewOption[] {
  const fig = spec.figure;
  if (fig === undefined || !(fig.width > 0) || !(fig.height > 0) || !Array.isArray(spec.parts) || !Array.isArray(spec.regions)) return [];
  const views = partViews(spec);
  const parts: DiagramPreviewPart[] = views.map((v) => ({
    number: v.number, name: v.name, point: v.point, outline: v.outline, glow: regionDrawing(v)?.box ?? null,
  }));
  if (!parts.some((p) => p.glow !== null || p.outline !== null)) return [];
  const outlined = parts.some((p) => p.outline !== null);
  const base = {
    kind: 'label-diagram' as const, title: aiLabel(spec.title), label: componentLabel('label-diagram-v1'), figureId: spec.figureId,
    aspect: fig.width / fig.height, viewBox: `0 0 ${fig.width} ${fig.height}`, parts, outlined,
  };
  // Parts SAM 3.1 outlined first (page order), then parts with only a model box.
  const order = [...views.keys()].filter((i) => parts[i]!.outline !== null)
    .concat([...views.keys()].filter((i) => parts[i]!.outline === null && parts[i]!.glow !== null));
  return order.map((i) => ({ quote: views[i]!.part.quote, preview: { ...base, focus: i } }));
}

function sequence(spec: SequenceSpec): PreviewOption[] {
  if (!Array.isArray(spec.steps) || spec.steps.length === 0) return [];
  const shown = spec.steps.slice(0, PREVIEW_STEPS);
  const steps = shown.map((s) => aiLabel(s.label));
  return shown.map((s, i) => ({
    quote: s.quote,
    preview: { kind: 'sequence', title: aiLabel(spec.title), label: componentLabel('sequence-v1'), steps, total: spec.steps.length, focus: i },
  }));
}

function quiz(spec: QuizCardsSpec): PreviewOption[] {
  if (!Array.isArray(spec.cards)) return [];
  return quizCards(spec).map((c) => ({
    quote: c.quote,
    preview: {
      kind: 'quiz-cards', title: aiLabel(spec.title), label: componentLabel('quiz-cards-v1'), stem: aiText(c.stem),
      options: c.options.map((o) => capitalFirst(aiText(o.text))),
    },
  }));
}

function compare(spec: CompareTableSpec): PreviewOption[] {
  if (!Array.isArray(spec.entities) || !Array.isArray(spec.attributes) || !Array.isArray(spec.cells)) return [];
  const grid = compareGrid(spec);
  const rows = grid.rows.slice(0, PREVIEW_ROWS);
  const head = ['', ...grid.attributes.slice(0, PREVIEW_COLS).map(aiLabel)];
  const cells = rows.map((r) => [aiLabel(r.entity), ...r.cells.slice(0, PREVIEW_COLS).map((c) => (c === null ? DASH : aiLabel(c.value)))]);
  const base = { kind: 'compare-table' as const, title: aiLabel(spec.title), label: componentLabel('compare-table-v1'), head, rows: cells };
  const out: PreviewOption[] = [];
  rows.forEach((r, ri) => r.cells.slice(0, PREVIEW_COLS).forEach((c, ci) => {
    if (c !== null) out.push({ quote: c.quote, preview: { ...base, focus: { row: ri, col: ci + 1 } } });
  }));
  return out;
}

function dataTable(spec: DataTableSpec): PreviewOption[] {
  if (!Array.isArray(spec.columns) || !Array.isArray(spec.rows) || spec.rows.length === 0) return [];
  const rows = spec.rows.slice(0, PREVIEW_ROWS);
  const head = [aiText(spec.labelHeader), ...spec.columns.slice(0, PREVIEW_COLS).map((c) => aiText(c.header))];
  const cells = rows.map((r) => [aiText(r.label), ...r.values.slice(0, PREVIEW_COLS).map((v) => aiText(v.value))]);
  const base = { kind: 'data-table' as const, title: aiLabel(spec.title), label: componentLabel('data-table-v1'), head, rows: cells };
  const out: PreviewOption[] = [];
  rows.forEach((r, ri) => {
    out.push({ quote: r.quote, preview: { ...base, focus: { row: ri, col: 0 } } });
    r.values.slice(0, PREVIEW_COLS).forEach((v, ci) => out.push({ quote: v.quote, preview: { ...base, focus: { row: ri, col: ci + 1 } } }));
  });
  return out;
}

function sortGroups(spec: SortGroupsSpec): PreviewOption[] {
  if (!Array.isArray(spec.groups) || !Array.isArray(spec.items) || spec.groups.length === 0) return [];
  const shown = spec.groups.slice(0, 2).map((g) => ({ group: g, items: spec.items.filter((it) => it.groupId === g.id).slice(0, PREVIEW_CHIPS) }));
  const base = {
    kind: 'sort-groups' as const, title: aiLabel(spec.title), label: componentLabel('sort-groups-v1'),
    groups: shown.map((s) => ({ label: aiLabel(s.group.label), chips: s.items.map((it) => aiLabel(it.label)) })),
  };
  const out: PreviewOption[] = [];
  for (const it of spec.items) {
    const group = shown.findIndex((s) => s.group.id === it.groupId);
    const chip = group < 0 ? -1 : shown[group]!.items.indexOf(it);
    if (chip >= 0) out.push({ quote: it.quote, preview: { ...base, focus: { group, chip } } });
  }
  return out;
}

function formula(spec: FormulaExplorerSpec): PreviewOption[] {
  if (typeof spec.formulaText !== 'string' || spec.formulaText.trim() === '') return [];
  const v = (spec.variables ?? []).find((x) => x.name === spec.xVariable);
  const opening = spec.cases?.[0]?.inputs.find((i) => i.name === spec.xVariable)?.value;
  let slider: FormulaPreview['slider'] = null;
  if (v !== undefined && v.max > v.min) {
    const value = typeof opening === 'number' && Number.isFinite(opening) ? opening : v.default;
    const at = Math.min(1, Math.max(0, (value - v.min) / (v.max - v.min)));
    slider = { symbol: v.pageSymbol || v.name, meaning: aiLabel(v.meaning), unit: prettyUnit(v.unit), min: v.min, max: v.max, value, at };
  }
  const preview: FormulaPreview = { kind: 'formula-explorer', title: aiLabel(spec.title), label: componentLabel('formula-explorer-v1'), formula: aiText(spec.formulaText), slider };
  const quotes = [spec.quote, ...(spec.variables ?? []).map((x) => x.quote), ...(spec.hasSourceExample ? [spec.sourceExample.quote] : [])];
  return quotes.filter((q) => typeof q === 'string' && q.trim() !== '').map((quote) => ({ quote, preview }));
}

interface Range { min: number; max: number; default: number }
const range = (v: unknown): Range | null => (isRecord(v) && [v.min, v.max, v.default].every((n) => typeof n === 'number' && Number.isFinite(n)) ? (v as unknown as Range) : null);
const num = (o: unknown, k: string): number | null => (isRecord(o) && typeof o[k] === 'number' && Number.isFinite(o[k]) ? o[k] : null);

function evidenceQuotes(activity: Record<string, unknown>): string[] {
  const ex = Array.isArray(activity.explanations) ? activity.explanations : [];
  return ex.flatMap((e) => (isRecord(e) && Array.isArray(e.evidence) ? e.evidence : []))
    .map((ev) => (isRecord(ev) && typeof ev.quote === 'string' ? ev.quote : ''))
    .filter((q) => q.trim() !== '');
}

function scenario(sim: Record<string, unknown>): { object: string; setting: string } {
  const sc = isRecord(sim.scenario) ? sim.scenario : {};
  return {
    object: typeof sc.objectLabel === 'string' ? aiLabel(sc.objectLabel) : '',
    setting: typeof sc.settingLabel === 'string' ? aiLabel(sc.settingLabel) : '',
  };
}

function curve(componentId: string, activity: unknown): PreviewOption[] {
  if (!isRecord(activity) || !isRecord(activity.simulation) || activity.simulation.engine !== componentId) return [];
  const sim = activity.simulation;
  const opening = Array.isArray(activity.predictions) ? activity.predictions[0] : undefined;
  const title = typeof activity.title === 'string' ? aiLabel(activity.title) : '';
  const sc = scenario(sim);
  let preview: CurvePreview | null = null;
  if (componentId === 'half-life-v1') {
    const n0r = range(sim.initialAmount);
    const tr = range(sim.halfLife);
    const er = range(sim.elapsedTime);
    if (n0r === null || tr === null || er === null || !(er.max > 0)) return [];
    const n0 = num(opening, 'initialAmount') ?? n0r.default;
    const half = num(opening, 'halfLife') ?? tr.default;
    const pts = decayPoints({ initialAmount: n0, halfLife: half, elapsedTime: 0 }, er.max, CURVE_STEPS);
    if (pts.length === 0 || !(n0 > 0)) return [];
    preview = {
      kind: 'half-life', title, label: componentLabel('half-life-v1'), xLabel: sc.setting, yLabel: sc.object,
      points: pts.map((p) => ({ x: p.t / er.max, y: p.amount / n0 })),
      marks: halfLifeMarkers(half, er.max, n0).map((m) => ({ x: m.t / er.max, y: m.fraction, text: m.fractionLabel })),
    };
  } else if (componentId === 'compound-interest-v1') {
    const pr = range(sim.principalUSD);
    const rr = range(sim.annualRatePercent);
    const nr = range(sim.compoundsPerYear);
    const yr = range(sim.years);
    if (pr === null || rr === null || nr === null || yr === null || !(yr.max > 0)) return [];
    const input = {
      principalUSD: num(opening, 'principalUSD') ?? pr.default,
      annualRatePercent: num(opening, 'annualRatePercent') ?? rr.default,
      compoundsPerYear: num(opening, 'compoundsPerYear') ?? nr.default,
      years: yr.max,
    };
    const pts = growthPoints(input, yr.max, CURVE_STEPS);
    const top = pts[pts.length - 1]?.balance ?? 0;
    if (pts.length < 2 || !(top > 0)) return [];
    preview = {
      kind: 'compound-interest', title, label: componentLabel('compound-interest-v1'), xLabel: sc.setting, yLabel: sc.object,
      points: pts.map((p) => ({ x: p.t / yr.max, y: p.balance / top })),
      marks: [
        { x: 0, y: input.principalUSD / top, text: formatUSD(input.principalUSD) },
        { x: 1, y: 1, text: formatUSD(top) },
      ],
    };
  }
  if (preview === null) return [];
  const p = preview;
  return evidenceQuotes(activity).map((quote) => ({ quote, preview: p }));
}

// ---- a lesson's parts ----------------------------------------------------------------------------------------------

function optionsFor(componentId: string, spec: unknown, activity: unknown): PreviewOption[] {
  switch (componentId) {
    case 'label-diagram-v1': return diagram(spec as LabelDiagramSpec);
    case 'sequence-v1': return sequence(spec as SequenceSpec);
    case 'quiz-cards-v1': return quiz(spec as QuizCardsSpec);
    case 'compare-table-v1': return compare(spec as CompareTableSpec);
    case 'data-table-v1': return dataTable(spec as DataTableSpec);
    case 'sort-groups-v1': return sortGroups(spec as SortGroupsSpec);
    case 'formula-explorer-v1': return formula(spec as FormulaExplorerSpec);
    case 'half-life-v1':
    case 'compound-interest-v1': return curve(componentId, activity);
    default: return [];
  }
}

/** The lesson's passed parts that have a preview, most visual first (PREVIEW_ORDER), each with its quote options. */
export function lessonPreviewParts(job: PreviewJob): PreviewPart[] {
  if (job.summary.status !== 'succeeded') return [];
  const data = job.lessonData ?? null;
  if (data === null || data.lesson === null) return [];
  const out: PreviewPart[] = [];
  for (const entry of data.lesson.components) {
    const kind = KIND_OF[entry.componentId];
    if (kind === undefined || entry.status !== 'passed') continue;
    const engine = kind === 'half-life' || kind === 'compound-interest';
    const spec = engine ? undefined : data.kitSpecs[entry.specId];
    if (!engine && (spec === undefined || spec.componentId !== entry.componentId)) continue;
    let options: PreviewOption[] = [];
    try {
      options = optionsFor(entry.componentId, spec, job.spec);
    } catch {
      options = [];
    }
    if (options.length > 0) out.push({ kind, componentId: entry.componentId, options });
  }
  return out.sort((a, b) => PREVIEW_ORDER.indexOf(a.kind) - PREVIEW_ORDER.indexOf(b.kind));
}
