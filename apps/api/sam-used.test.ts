// The Published shelf's SAM stamp: a published lesson whose kept label diagram has SAM 3.1 regions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lessonUsesSam } from './sam-used.ts';

const JOB = 'job-20261102050029-1ebd79c6';

function store(components: unknown[], files: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), 'sam-used-'));
  const run = join(dir, 'runs', JOB);
  mkdirSync(run, { recursive: true });
  writeFileSync(join(run, 'lesson.json'), JSON.stringify({ components }));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(run, name), JSON.stringify(body));
  return dir;
}

const samRegions = { regions: [{ partId: 'p1', x1: 0, y1: 0, x2: 1, y2: 1, confidence: 0.81 }] };

test('a passed label diagram whose published revision has SAM regions uses SAM', () => {
  const dir = store([{ componentId: 'label-diagram-v1', status: 'passed', revision: 2 }], {
    'label-diagram-v1.r1.json': { regions: [] },
    'label-diagram-v1.r2.json': samRegions,
  });
  try {
    assert.equal(lessonUsesSam(dir, JOB, []), true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('no SAM: no label diagram, a held-back one, one the teacher hid, one without SAM scores, or unreadable files', () => {
  const cases: Array<[unknown[], Record<string, unknown>, string[]]> = [
    [[{ componentId: 'quiz-cards-v1', status: 'passed', revision: 1 }], {}, []],
    [[{ componentId: 'label-diagram-v1', status: 'failed', revision: 1 }], { 'label-diagram-v1.r1.json': samRegions }, []],
    [[{ componentId: 'label-diagram-v1', status: 'passed', revision: 1 }], { 'label-diagram-v1.r1.json': samRegions }, ['label-diagram-v1']],
    [[{ componentId: 'label-diagram-v1', status: 'passed', revision: 1 }], { 'label-diagram-v1.r1.json': { regions: [{ partId: 'p1' }] } }, []],
    [[{ componentId: 'label-diagram-v1', status: 'passed', revision: 3 }], { 'label-diagram-v1.r1.json': samRegions }, []],
  ];
  for (const [components, files, hidden] of cases) {
    const dir = store(components, files);
    try {
      assert.equal(lessonUsesSam(dir, JOB, hidden), false, JSON.stringify({ components, hidden }));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
  assert.equal(lessonUsesSam(join(tmpdir(), 'no-such-store'), JOB, []), false);
  assert.equal(lessonUsesSam(tmpdir(), '../escape', []), false, 'a bad id is never read');
});
