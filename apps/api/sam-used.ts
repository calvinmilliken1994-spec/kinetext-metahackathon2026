// The Published shelf's SAM stamp (Calvin, 2 Nov): does a lesson show a label diagram whose parts SAM 3.1 outlined?
// Read-only over the stored run: lesson.json says which revision each part published, and a SAM-confirmed revision
// stores SAM's score on each region. Anything unreadable reads as "no SAM", so the stamp is never claimed by mistake.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const JOB_ID = /^[a-z0-9-]{1,80}$/;
const COMPONENT_ID = /^[a-z0-9-]{1,60}$/;

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

/**
 * True when the lesson has a passed label diagram the teacher did not hide (`hiddenParts`) and that part's published
 * revision has at least one region carrying a SAM confidence score.
 */
export function lessonUsesSam(storageDir: string, jobId: string, hiddenParts: readonly string[]): boolean {
  if (!JOB_ID.test(jobId)) return false;
  const run = join(storageDir, 'runs', jobId);
  const lesson = readJson(join(run, 'lesson.json')) as { components?: unknown } | null;
  if (lesson === null || !Array.isArray(lesson.components)) return false;
  for (const c of lesson.components as Array<{ componentId?: unknown; status?: unknown; revision?: unknown }>) {
    if (typeof c?.componentId !== 'string' || !c.componentId.startsWith('label-diagram') || !COMPONENT_ID.test(c.componentId)) continue;
    if (c.status !== 'passed' || hiddenParts.includes(c.componentId)) continue;
    if (typeof c.revision !== 'number' || !Number.isInteger(c.revision) || c.revision < 1) continue;
    const rev = readJson(join(run, `${c.componentId}.r${c.revision}.json`)) as { regions?: unknown } | null;
    if (rev === null || !Array.isArray(rev.regions)) continue;
    if ((rev.regions as Array<{ confidence?: unknown }>).some((r) => typeof r?.confidence === 'number')) return true;
  }
  return false;
}
