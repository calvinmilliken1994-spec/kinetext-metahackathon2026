// Set A (UX review #1): stored lessons are re-checked with TODAY's validators when served, so an
// old part that a newer check rejects is withheld instead of keeping its "checked" badge.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { enrichLabelBoxes, recheckLesson, RECHECKED_COMPONENTS } from './recheck.ts';

const RUNS = new URL('../../storage/runs/', import.meta.url);
const BAD_PH = 'job-20261031111156-12c77646'; // BUG-013: 'pH six' plotted at 14
const GOOD_PH = 'job-20261031023145-7a1de630';

function storageWith(...jobIds: string[]): string | null {
  const dir = mkdtempSync(join(tmpdir(), 'recheck-'));
  for (const id of jobIds) {
    const from = new URL(`${id}/`, RUNS);
    if (!existsSync(from)) return null;
    cpSync(from, join(dir, 'runs', id), { recursive: true });
  }
  return dir;
}

function jobView(storageDir: string, jobId: string): { summary: { jobId: string; sourceId: string; status: string; provider?: string; sourceKind?: string }; lesson: { components: { componentId: string; status: string; revision: number; recheck?: unknown }[] } } {
  const summary = JSON.parse(readFileSync(join(storageDir, 'runs', jobId, 'job.json'), 'utf8'));
  const lesson = JSON.parse(readFileSync(join(storageDir, 'runs', jobId, 'lesson.json'), 'utf8'));
  return { summary, lesson };
}

test('the recheck covers the engines whose checks changed after lessons were stored', () => {
  assert.deepEqual([...RECHECKED_COMPONENTS].sort(), ['data-table-v1', 'label-diagram-v1', 'log-ladder-v1', 'threshold-v1']);
});

test('a stored ladder that fails today\'s checks is marked not publishable, with the failing check ids', (t) => {
  const dir = storageWith(BAD_PH);
  if (dir === null) return t.skip('stored run not present on this machine');
  const job = jobView(dir, BAD_PH);
  recheckLesson(dir, job, {});
  const ladder = job.lesson.components.find(c => c.componentId === 'log-ladder-v1');
  assert.ok(ladder);
  const r = ladder.recheck as { publishable: boolean; failedChecks: string[] };
  assert.equal(r.publishable, false);
  assert.ok(r.failedChecks.includes('LOG-07'), JSON.stringify(r));
});

test('a stored ladder that still passes keeps publishable true; components outside the list get no recheck', (t) => {
  const dir = storageWith(GOOD_PH);
  if (dir === null) return t.skip('stored run not present on this machine');
  const job = jobView(dir, GOOD_PH);
  recheckLesson(dir, job, {});
  for (const c of job.lesson.components) {
    if (c.status !== 'passed') continue;
    if (RECHECKED_COMPONENTS.has(c.componentId)) {
      assert.deepEqual(c.recheck, { publishable: true, failedChecks: [] }, c.componentId);
    } else {
      assert.equal(c.recheck, undefined, c.componentId);
    }
  }
});

test('a missing artifact or unfinished job leaves the lesson untouched (no recheck field)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'recheck-empty-'));
  const job = {
    summary: { jobId: 'job-x', sourceId: 'usgs-wss-ph-and-water', status: 'succeeded' },
    lesson: { components: [{ componentId: 'log-ladder-v1', status: 'passed', revision: 1 }] as { componentId: string; status: string; revision: number; recheck?: unknown }[] },
  };
  recheckLesson(dir, job, {});
  assert.equal(job.lesson.components[0]?.recheck, undefined);
  const running = { ...job, summary: { ...job.summary, status: 'running' } };
  recheckLesson(dir, running, {});
  assert.equal(running.lesson.components[0]?.recheck, undefined);
});

test('enrichLabelBoxes copies stored text/group onto an older spec only when every box coordinate matches', () => {
  const current = [{ x1: 1, y1: 2, x2: 10, y2: 12, text: 'Adenine' }, { x1: 20, y1: 2, x2: 30, y2: 12, text: 'Sugar', group: 3 }];
  const spec = { componentId: 'label-diagram-v1', figure: { id: 'fig-a', labelBoxes: [{ x1: 1, y1: 2, x2: 10, y2: 12 }, { x1: 20, y1: 2, x2: 30, y2: 12 }] } };
  enrichLabelBoxes(spec, () => current);
  assert.deepEqual(spec.figure.labelBoxes, current);
  const moved = { componentId: 'label-diagram-v1', figure: { id: 'fig-a', labelBoxes: [{ x1: 1, y1: 2, x2: 10, y2: 13 }, { x1: 20, y1: 2, x2: 30, y2: 12 }] } };
  enrichLabelBoxes(moved, () => current);
  assert.equal((moved.figure.labelBoxes[0] as { text?: string }).text, undefined, 'different coordinates: no text copied');
});
