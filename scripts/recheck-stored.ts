// Set A replay: run the CURRENT validators over every stored PUBLISHED revision of label-diagram, log-ladder,
// data-table and threshold under storage/runs/*/ and list which would now fail, and why.
// READ-ONLY over storage/ (it only reads files and prints). Run: node scripts/recheck-stored.ts [--json] [--all]
//   --json  print one JSON document instead of the text report
//   --all   also replay every stored revision (not only the one the lesson published)
// A "published" revision is a lesson.json component with status "passed" for one of the four component ids;
// its artifact is <componentId>.r<revision>.json, holding the gen, the recorded report and (label-diagram) the
// spec with the SAM regions that were used. Sources come from data/sources, figures (with their stored printed
// label boxes, text and group) from data/figures, exactly as the lesson worker attaches them.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { SourceDocument, ValidationReport } from '../packages/contracts/index.ts';
import type { KitGenComponentId, LabelRegion } from '../packages/contracts/kit.ts';
import { loadSource } from '../packages/sources/index.ts';
import { listFigures, loadFigureLabelBoxes } from '../packages/sources/figures.ts';
import type { FigureMeta } from '../packages/sources/figures.ts';
import { validateKitComponent } from '../packages/validation/kit/index.ts';
import { NOT_RETROACTIVE_CHECK_IDS } from '../packages/validation/not-retroactive.ts';

const COMPONENTS = ['label-diagram-v1', 'log-ladder-v1', 'data-table-v1', 'threshold-v1'] as const;
type Component = (typeof COMPONENTS)[number];

const args = new Set(process.argv.slice(2));
const asJson = args.has('--json');
const includeAll = args.has('--all');
const runsDir = fileURLToPath(new URL('../storage/runs/', import.meta.url));

interface Artifact { gen?: unknown; report?: ValidationReport; spec?: { regions?: LabelRegion[]; figure?: { id?: string } } }
interface Row {
  job: string;
  file: string;
  component: Component;
  published: boolean;
  recordedPublishable: boolean | null;
  nowPublishable: boolean;
  failed: { id: string; message: string }[];
}

const sourceCache = new Map<string, SourceDocument | null>();
function sourceFor(id: string): SourceDocument | null {
  if (!sourceCache.has(id)) {
    try { sourceCache.set(id, loadSource(id)); } catch { sourceCache.set(id, null); }
  }
  return sourceCache.get(id) ?? null;
}

/** Every string stored under a `sourceId` key anywhere in the gen. */
function sourceIdsOf(node: unknown, out: Set<string> = new Set()): Set<string> {
  if (Array.isArray(node)) node.forEach(n => sourceIdsOf(n, out));
  else if (typeof node === 'object' && node !== null) {
    for (const [k, v] of Object.entries(node)) {
      if (k === 'sourceId' && typeof v === 'string') out.add(v);
      else sourceIdsOf(v, out);
    }
  }
  return out;
}

const rows: Row[] = [];
const missing = new Set<string>();
let jobsScanned = 0;
let lessons = 0;

for (const job of readdirSync(runsDir).sort()) {
  const dir = join(runsDir, job);
  let names: string[];
  try { names = readdirSync(dir); } catch { continue; }
  jobsScanned += 1;
  // which revision did the lesson publish, per component?
  const publishedRev = new Map<string, number>();
  const lessonFile = join(dir, 'lesson.json');
  if (existsSync(lessonFile)) {
    try {
      const lesson = JSON.parse(readFileSync(lessonFile, 'utf8')) as { components?: { componentId?: string; status?: string; revision?: number }[] };
      lessons += 1;
      for (const c of lesson.components ?? []) {
        if (c.status === 'passed' && typeof c.componentId === 'string' && typeof c.revision === 'number') publishedRev.set(c.componentId, c.revision);
      }
    } catch { /* unreadable lesson: nothing counts as published */ }
  }
  for (const name of names) {
    const m = /^(label-diagram-v1|log-ladder-v1|data-table-v1|threshold-v1)\.r(\d+)\.json$/.exec(name);
    if (m === null) continue;
    const component = m[1] as Component;
    const revision = Number(m[2]);
    const published = publishedRev.get(component) === revision;
    if (!published && !includeAll) continue;
    let artifact: Artifact;
    try { artifact = JSON.parse(readFileSync(join(dir, name), 'utf8')) as Artifact; } catch { continue; }
    if (artifact.gen === undefined || artifact.gen === null) continue;
    const sources: SourceDocument[] = [];
    for (const id of sourceIdsOf(artifact.gen)) {
      const doc = sourceFor(id);
      if (doc === null) missing.add(`${job}/${name}: source ${id} not in data/sources`); else sources.push(doc);
    }
    let figures: FigureMeta[] | undefined;
    let regions: LabelRegion[] | undefined;
    if (component === 'label-diagram-v1') {
      const sourceId = sources[0]?.id;
      figures = sourceId === undefined ? [] : listFigures(sourceId).map(f => ({ ...f, labelBoxes: loadFigureLabelBoxes(f.id) }));
      regions = Array.isArray(artifact.spec?.regions) ? artifact.spec!.regions : undefined;
    }
    let report: ValidationReport;
    try {
      report = validateKitComponent(component as KitGenComponentId, artifact.gen, sources, {
        revision: artifact.report?.revision ?? revision,
        ...(figures !== undefined ? { figures, storedWithoutAreas: true } : {}),
        ...(regions !== undefined ? { labelRegions: regions } : {}),
      });
    } catch (err) {
      rows.push({ job, file: name, component, published, recordedPublishable: artifact.report?.publishable ?? null, nowPublishable: false, failed: [{ id: 'THROW', message: err instanceof Error ? err.message : String(err) }] });
      continue;
    }
    // LD-10/LD-11 (Stage 8c) are not retroactive: stored revisions are judged without them (NOT_RETROACTIVE_CHECK_IDS).
    const failedNow = report.checks.filter(c => !c.passed && !NOT_RETROACTIVE_CHECK_IDS.has(c.id));
    rows.push({
      job,
      file: name,
      component,
      published,
      recordedPublishable: artifact.report?.publishable ?? null,
      nowPublishable: failedNow.length === 0,
      failed: failedNow.map(c => ({ id: c.id, message: c.message })),
    });
  }
}

const newlyFailing = rows.filter(r => r.published && r.failed.length > 0);
const summary = COMPONENTS.map(component => {
  const mine = rows.filter(r => r.component === component && r.published);
  return { component, published: mine.length, nowFailing: mine.filter(r => r.failed.length > 0).length };
});

if (asJson) {
  console.log(JSON.stringify({ jobsScanned, lessons, summary, newlyFailing, missingSources: [...missing] }, null, 2));
} else {
  console.log(`scanned ${jobsScanned} job dir(s), ${lessons} lesson.json; replayed ${rows.length} artifact(s)${includeAll ? ' (all revisions)' : ' (published revisions only)'}`);
  for (const s of summary) console.log(`  ${s.component}: ${s.published} published, ${s.nowFailing} would now fail`);
  console.log(`published revisions that FAIL under the current validators: ${newlyFailing.length}`);
  for (const r of newlyFailing) {
    console.log(`  FAIL ${r.job}/${r.file} [${r.failed.map(f => f.id).join(', ')}] (recorded publishable: ${String(r.recordedPublishable)})`);
    for (const f of r.failed) console.log(`    - ${f.id}: ${f.message.slice(0, 420)}`);
  }
  if (missing.size > 0) {
    console.log(`missing sources (${missing.size}):`);
    for (const m of missing) console.log(`  ${m}`);
  }
  console.log(existsSync(runsDir) ? 'storage/ untouched (read-only replay)' : 'WARNING: storage/runs not found');
}
