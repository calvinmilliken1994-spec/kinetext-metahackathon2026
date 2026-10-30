// Stage 7b (docs/specs/STAGE-7b-subjects.md) — the subject Muse detected for teacher-pasted sources.
//
// Teacher ('user-…') sources have no curated subject. When a lesson run exists for one, its Muse page analysis
// (analysis-v2) names a subject; GET /api/sources returns the one from the NEWEST such run (by createdAt), taken from
// that run's highest analysis-v2 revision (the analysis of record after any repair), labelled subjectSource 'muse'.
// Read-only: it only reads run files and never mutates storage. Unreadable or malformed files are skipped.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isSubject } from '../../packages/contracts/kit.ts';
import type { Subject } from '../../packages/contracts/kit.ts';

const ANALYSIS_V2_FILE = /^analysis-v2\.r([0-9]{1,3})\.json$/;

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
}

/** The subject in one run dir's highest analysis-v2 revision, or undefined. */
function runSubject(runDir: string): Subject | undefined {
  let files: string[];
  try {
    files = readdirSync(runDir);
  } catch {
    return undefined;
  }
  const revisions = files
    .map(f => ANALYSIS_V2_FILE.exec(f))
    .filter((m): m is RegExpExecArray => m !== null)
    .map(m => ({ file: m[0], revision: Number(m[1]) }))
    .sort((a, b) => b.revision - a.revision);
  const top = revisions[0];
  if (top === undefined) return undefined;
  const body = readJson(join(runDir, top.file));
  const analysis = typeof body === 'object' && body !== null ? (body as { analysis?: unknown }).analysis : undefined;
  const subject = typeof analysis === 'object' && analysis !== null ? (analysis as { subject?: unknown }).subject : undefined;
  return isSubject(subject) ? subject : undefined;
}

/**
 * For each wanted source id, the subject from its newest run that has a valid analysis-v2 subject.
 * Sources without such a run are absent from the map.
 */
export function museSubjectsBySource(storageDir: string, sourceIds: ReadonlySet<string>): Map<string, Subject> {
  const out = new Map<string, Subject>();
  if (sourceIds.size === 0) return out;
  const runsDir = join(storageDir, 'runs');
  let entries: string[];
  try {
    entries = readdirSync(runsDir);
  } catch {
    return out;
  }
  const runs: { sourceId: string; createdAt: string; dir: string }[] = [];
  for (const name of entries) {
    const job = readJson(join(runsDir, name, 'job.json'));
    if (typeof job !== 'object' || job === null) continue;
    const { sourceId, createdAt } = job as { sourceId?: unknown; createdAt?: unknown };
    if (typeof sourceId !== 'string' || !sourceIds.has(sourceId)) continue;
    runs.push({ sourceId, createdAt: typeof createdAt === 'string' ? createdAt : '', dir: join(runsDir, name) });
  }
  runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt)); // newest first
  for (const run of runs) {
    if (out.has(run.sourceId)) continue;
    const subject = runSubject(run.dir);
    if (subject !== undefined) out.set(run.sourceId, subject);
  }
  return out;
}
