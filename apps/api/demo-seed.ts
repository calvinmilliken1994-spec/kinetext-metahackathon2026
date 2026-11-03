// Fresh clones (judges): storage/ is gitignored, so a clone starts with no lessons. A curated set of real recorded runs
// ships in data/demo-runs/ (the Demo, Welcome and opening-lesson pins, every published lesson, and the latest finished
// lesson of each library page). At start-up each one is copied into <storageDir>/runs/ when that run is not there yet.
// An existing run is never overwritten or changed (stored runs are evidence), so this is a no-op on the dev machine.
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEMO_RUNS_DIR: string = fileURLToPath(new URL('../../data/demo-runs/', import.meta.url));
/** Teacher-pasted sources some shipped runs were built from (project-authored test text only). */
const USER_SOURCES_SUBDIR = '_user-sources';
const JOB_ID = /^job-\d{14}-[0-9a-f]{8}$/;
const USER_SOURCE_FILE = /^user-[0-9a-f]{12}\.(json|txt)$/;

export interface SeedResult {
  copied: number;
  kept: number;
  userSourcesCopied: number;
}

export function seedDemoRuns(storageDir: string, seedDir: string = DEMO_RUNS_DIR): SeedResult {
  const result: SeedResult = { copied: 0, kept: 0, userSourcesCopied: 0 };
  let entries: string[];
  try {
    entries = readdirSync(seedDir);
  } catch {
    return result; // no seed folder: nothing to do
  }
  const runsDir = join(storageDir, 'runs');
  for (const id of entries) {
    if (!JOB_ID.test(id)) continue;
    const target = join(runsDir, id);
    if (existsSync(target)) {
      result.kept += 1;
      continue;
    }
    mkdirSync(runsDir, { recursive: true });
    cpSync(join(seedDir, id), target, { recursive: true, errorOnExist: true, force: false });
    result.copied += 1;
  }
  const userSeed = join(seedDir, USER_SOURCES_SUBDIR);
  if (existsSync(userSeed)) {
    const userDir = join(storageDir, 'user-sources');
    for (const f of readdirSync(userSeed)) {
      if (!USER_SOURCE_FILE.test(f) || existsSync(join(userDir, f))) continue;
      mkdirSync(userDir, { recursive: true });
      cpSync(join(userSeed, f), join(userDir, f), { errorOnExist: true, force: false });
      result.userSourcesCopied += 1;
    }
  }
  return result;
}
