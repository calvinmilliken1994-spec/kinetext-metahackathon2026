// Set A (UX review #1): when a finished lesson is served, re-run TODAY's validators over the
// stored passed parts of the engines whose checks changed after lessons were stored. A part that
// no longer passes gets `recheck: { publishable: false, failedChecks }`; the web app then shows it
// as held back instead of "checked". Stored artifacts and reports are never rewritten.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateKitComponent } from '../../packages/validation/kit/index.ts';
import { NOT_RETROACTIVE_CHECK_IDS, retroactiveFailedIds } from '../../packages/validation/not-retroactive.ts';
import { listFigures, loadFigureLabelBoxes } from '../../packages/sources/figures.ts';
import type { FigureMeta } from '../../packages/sources/figures.ts';
import { loadSource, loadUserSource, userSourcesDirOf } from '../../packages/sources/index.ts';
import type { SourceDocument } from '../../packages/contracts/index.ts';
import { orderLabelPartsByPage } from './label-order.ts';

/** Engines whose checks tightened after lessons were stored (BUG-013 and the set A review fixes). */
export const RECHECKED_COMPONENTS: ReadonlySet<string> = new Set([
  'label-diagram-v1',
  'log-ladder-v1',
  'data-table-v1',
  'threshold-v1',
]);

export interface Recheck { publishable: boolean; failedChecks: string[]; review?: { id: string; reason: string } }

interface RecheckJob {
  summary: { jobId: string; sourceId: string; status: string; provider?: string; sourceKind?: string };
  lesson?: unknown;
}

interface RecheckOptions { sourcesDir?: URL; userSourcesDir?: string }

// Finished runs never change, so one result per job/component/revision is cached.
const cache = new Map<string, Recheck | null>();

function loadDocs(storageDir: string, job: RecheckJob, opts: RecheckOptions): SourceDocument[] {
  const id = job.summary.sourceId;
  if (job.summary.sourceKind === 'user') {
    return [loadUserSource(id, opts.userSourcesDir ?? userSourcesDirOf(storageDir))];
  }
  return [loadSource(id, opts.sourcesDir)];
}

function figuresFor(sourceId: string): FigureMeta[] {
  return listFigures(sourceId).slice(0, 3).map(f => ({ ...f, labelBoxes: loadFigureLabelBoxes(f.id) }));
}

function recheckOne(storageDir: string, job: RecheckJob, componentId: string, revision: number, opts: RecheckOptions): Recheck | null {
  const key = `${job.summary.jobId}|${componentId}|${revision}`;
  if (cache.has(key)) return cache.get(key) ?? null;
  let result: Recheck | null = null;
  const file = join(storageDir, 'runs', job.summary.jobId, `${componentId}.r${revision}.json`);
  if (existsSync(file)) {
    try {
      const art = JSON.parse(readFileSync(file, 'utf8')) as { gen?: unknown; regions?: unknown };
      if (art.gen !== undefined) {
        const docs = loadDocs(storageDir, job, opts);
        const extra = componentId === 'label-diagram-v1'
          ? { figures: figuresFor(job.summary.sourceId), storedWithoutAreas: true, ...(Array.isArray(art.regions) ? { labelRegions: art.regions } : {}) }
          : {};
        const report = validateKitComponent(componentId, art.gen, docs, { revision, ...extra } as Parameters<typeof validateKitComponent>[3]);
        // LD-10/LD-11 (Stage 8c) are not retroactive: stored parts were never asked for areas, full label
        // coverage or confident regions, so they are ignored here (NOT_RETROACTIVE_CHECK_IDS).
        result = {
          publishable: report.checks.every(c => c.passed || NOT_RETROACTIVE_CHECK_IDS.has(c.id)),
          failedChecks: retroactiveFailedIds(report.checks),
        };
      }
    } catch {
      result = null; // unreadable artifact or source: leave the lesson as stored
    }
  }
  cache.set(key, result);
  return result;
}

/** Adds `recheck` to each passed component of a finished lesson whose engine is in RECHECKED_COMPONENTS. */
export function recheckLesson(storageDir: string, job: RecheckJob, opts: RecheckOptions): void {
  if (job.summary.status !== 'succeeded') return;
  const lesson = job.lesson as { components?: { componentId?: unknown; status?: unknown; revision?: unknown; recheck?: Recheck }[] } | null | undefined;
  if (!lesson || !Array.isArray(lesson.components)) return;
  for (const c of lesson.components) {
    if (c.status !== 'passed' || typeof c.componentId !== 'string' || typeof c.revision !== 'number') continue;
    if (!RECHECKED_COMPONENTS.has(c.componentId)) continue;
    const r = recheckOne(storageDir, job, c.componentId, c.revision, opts);
    if (r !== null) c.recheck = r;
  }
}

/** Numbers each served label diagram in its page's order (label-order.ts). An unreadable source leaves the order as stored. */
export function orderLabelParts(storageDir: string, job: RecheckJob & { kitSpecs?: Record<string, unknown> }, opts: RecheckOptions): void {
  const specs = Object.values(job.kitSpecs ?? {}).filter((s) => (s as { componentId?: unknown } | null)?.componentId === 'label-diagram-v1');
  if (specs.length === 0) return;
  let text: string;
  try { text = loadDocs(storageDir, job, opts).map((d) => d.text).join('\n'); } catch { return; }
  for (const s of specs) orderLabelPartsByPage(s, text);
}

type Box = { x1: number; y1: number; x2: number; y2: number; text?: string; group?: number };

/**
 * Older label-diagram specs stored their figure's label boxes without the printed text. When the
 * current stored boxes for that figure have exactly the same coordinates, copy text/group across so
 * the view can place names by printed word. Any coordinate difference: leave the spec alone.
 */
export function enrichLabelBoxes(spec: unknown, current: (figureId: string) => Box[] = loadFigureLabelBoxes): void {
  const s = spec as { componentId?: unknown; figure?: { id?: unknown; labelBoxes?: Box[] } } | null;
  const fig = s?.figure;
  if (!fig || typeof fig.id !== 'string' || !Array.isArray(fig.labelBoxes) || fig.labelBoxes.length === 0) return;
  if (fig.labelBoxes.some(b => typeof b.text === 'string')) return;
  const now = current(fig.id);
  if (now.length !== fig.labelBoxes.length) return;
  const same = fig.labelBoxes.every((b, i) => {
    const n = now[i];
    return n !== undefined && n.x1 === b.x1 && n.y1 === b.y1 && n.x2 === b.x2 && n.y2 === b.y2;
  });
  if (!same) return;
  fig.labelBoxes = now.map(b => ({ ...b }));
}

export interface ComponentRevisionLite {
  revision: number;
  publishable: boolean;
  failedChecks: string[];
  /** label-diagram-v1 only: where each part's point sat (0..1000 grid). Never names or quotes. */
  labelPoints?: { id: string; x: number; y: number }[];
}

const ARTIFACT = /^([a-z0-9-]+-v\d+)\.r(\d+)\.json$/;

/**
 * Set B (repair story): every stored revision of each lesson part, as the report recorded it, so the web app can show
 * "check found an issue -> revised -> rechecked". A failed revision contributes only check ids and, for label
 * diagrams, point positions: its text is never served (unverified content stays hidden).
 */
export function componentHistory(storageDir: string, jobId: string): Record<string, ComponentRevisionLite[]> {
  const out: Record<string, ComponentRevisionLite[]> = {};
  if (!/^[A-Za-z0-9-]{1,80}$/.test(jobId)) return out;
  let names: string[];
  try {
    names = readdirSync(join(storageDir, 'runs', jobId));
  } catch {
    return out;
  }
  for (const name of names) {
    const m = ARTIFACT.exec(name);
    if (!m || m[1] === 'analysis-v2') continue;
    const componentId = m[1] as string;
    const revision = Number(m[2]);
    try {
      const art = JSON.parse(readFileSync(join(storageDir, 'runs', jobId, name), 'utf8')) as {
        report?: { publishable?: unknown; checks?: { id?: unknown; passed?: unknown }[] };
        gen?: { parts?: { id?: unknown; x?: unknown; y?: unknown }[] };
      };
      const checks = Array.isArray(art.report?.checks) ? art.report.checks : [];
      const entry: ComponentRevisionLite = {
        revision,
        publishable: art.report?.publishable === true,
        failedChecks: checks.filter(c => c.passed !== true && typeof c.id === 'string').map(c => c.id as string),
      };
      if (componentId === 'label-diagram-v1' && Array.isArray(art.gen?.parts)) {
        entry.labelPoints = art.gen.parts
          .filter(q => typeof q.id === 'string' && typeof q.x === 'number' && typeof q.y === 'number')
          .map(q => ({ id: q.id as string, x: q.x as number, y: q.y as number }));
      }
      (out[componentId] ??= []).push(entry);
    } catch {
      // unreadable revision: left out
    }
  }
  for (const list of Object.values(out)) list.sort((a, b) => a.revision - b.revision);
  return out;
}

// ---- ISSUE-011: content holds (a human review found an error printed on the SOURCE PAGE) ---------------------------
// Quote checks confirm a part matches its page, so they cannot catch a page that is wrong. data/content-holds.json lists
// such sentences; a passed part whose stored artifact quotes one is served as held back with the reviewer's reason.
// Stored runs are never rewritten.

export interface ContentHold { id: string; sourceId: string; quote: string; reason: string }

const HOLDS_FILE = new URL('../../data/content-holds.json', import.meta.url);

export function loadContentHolds(file: URL = HOLDS_FILE): ContentHold[] {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { holds?: unknown };
    if (!Array.isArray(raw.holds)) return [];
    return raw.holds.filter((h): h is ContentHold => typeof h === 'object' && h !== null
      && ['id', 'sourceId', 'quote', 'reason'].every(k => typeof (h as Record<string, unknown>)[k] === 'string'));
  } catch {
    return [];
  }
}

const squash = (s: string): string => s.replace(/\s+/g, ' ').trim();

function quotesHeld(value: unknown, quote: string): boolean {
  if (typeof value === 'string') return squash(value).includes(quote);
  if (Array.isArray(value)) return value.some(v => quotesHeld(v, quote));
  if (typeof value === 'object' && value !== null) return Object.values(value).some(v => quotesHeld(v, quote));
  return false;
}

/** Marks each passed part of a finished lesson that quotes a held sentence of its source as not publishable. */
export function applyContentHolds(storageDir: string, job: RecheckJob, holds: ContentHold[] = loadContentHolds()): void {
  if (job.summary.status !== 'succeeded') return;
  const mine = holds.filter(h => h.sourceId === job.summary.sourceId);
  if (mine.length === 0) return;
  const lesson = job.lesson as { components?: { componentId?: unknown; status?: unknown; revision?: unknown; recheck?: Recheck }[] } | null | undefined;
  if (!lesson || !Array.isArray(lesson.components)) return;
  for (const c of lesson.components) {
    if (c.status !== 'passed' || typeof c.componentId !== 'string' || typeof c.revision !== 'number') continue;
    const file = join(storageDir, 'runs', job.summary.jobId, `${c.componentId}.r${c.revision}.json`);
    if (!existsSync(file)) continue;
    let gen: unknown;
    try { gen = (JSON.parse(readFileSync(file, 'utf8')) as { gen?: unknown }).gen; } catch { continue; }
    const hit = mine.find(h => quotesHeld(gen, squash(h.quote)));
    if (hit === undefined) continue;
    c.recheck = { publishable: false, failedChecks: c.recheck?.failedChecks ?? [], review: { id: hit.id, reason: hit.reason } };
  }
}
