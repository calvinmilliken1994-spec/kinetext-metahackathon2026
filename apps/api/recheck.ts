// Set A (UX review #1): when a finished lesson is served, re-run TODAY's validators over the
// stored passed parts of the engines whose checks changed after lessons were stored. A part that
// no longer passes gets `recheck: { publishable: false, failedChecks }`; the web app then shows it
// as held back instead of "checked". Stored artifacts and reports are never rewritten.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateKitComponent } from '../../packages/validation/kit/index.ts';
import { listFigures, loadFigureLabelBoxes } from '../../packages/sources/figures.ts';
import type { FigureMeta } from '../../packages/sources/figures.ts';
import { loadSource, loadUserSource, userSourcesDirOf } from '../../packages/sources/index.ts';
import type { SourceDocument } from '../../packages/contracts/index.ts';

/** Engines whose checks tightened after lessons were stored (BUG-013 and the set A review fixes). */
export const RECHECKED_COMPONENTS: ReadonlySet<string> = new Set([
  'label-diagram-v1',
  'log-ladder-v1',
  'data-table-v1',
  'threshold-v1',
]);

export interface Recheck { publishable: boolean; failedChecks: string[] }

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
          ? { figures: figuresFor(job.summary.sourceId), ...(Array.isArray(art.regions) ? { labelRegions: art.regions } : {}) }
          : {};
        const report = validateKitComponent(componentId, art.gen, docs, { revision, ...extra } as Parameters<typeof validateKitComponent>[3]);
        result = { publishable: report.publishable, failedChecks: report.checks.filter(c => !c.passed).map(c => c.id) };
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
