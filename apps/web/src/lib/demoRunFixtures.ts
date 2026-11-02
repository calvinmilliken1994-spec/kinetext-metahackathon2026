/// <reference types="node" />
// The Demo's recorded run, job-20261101234914-97ba271b (lib/demoPins.ts DEMO_PINS.tour: NOAA water cycle on Muse Spark
// 1.3), exactly as GET /api/jobs/:id served it on 2 Nov 2026 (demoRun.fixture.json, copied unchanged; storage/ is not in
// the repository). Real model output and real event times. Test-only: the app never imports this file.
import { readFileSync } from 'node:fs';

export const DEMO_RUN_ID = 'job-20261101234914-97ba271b';

export function demoRunWire(): Record<string, unknown> {
  return JSON.parse(readFileSync(new URL('./demoRun.fixture.json', import.meta.url), 'utf8')) as Record<string, unknown>;
}
