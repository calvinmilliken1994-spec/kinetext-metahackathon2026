// BUG-013 recheck: replay every stored log-ladder revision under storage/runs/ through the
// CURRENT validator and report which stored-published ladders (report.publishable true) would now
// fail under the extended LOG-06 (case endpoints must BE rung values) and LOG-07 (label-value
// agreement, digits and number words). READ-ONLY over storage/. Run: node scripts/ladder-recheck.ts
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { SourceDocument, ValidationReport } from '../packages/contracts/index.ts';
import type { LogLadderGen } from '../packages/contracts/kit.ts';
import { validateKitComponent } from '../packages/validation/kit/index.ts';
import { loadSource } from '../packages/sources/index.ts';

interface StoredLadder { gen: LogLadderGen; report: ValidationReport }

const runsDir = fileURLToPath(new URL('../storage/runs/', import.meta.url));
const jobs = readdirSync(runsDir).sort();
const sourceCache = new Map<string, SourceDocument | null>();
function sourceFor(id: unknown): SourceDocument | null {
  if (typeof id !== 'string') return null;
  if (!sourceCache.has(id)) {
    try { sourceCache.set(id, loadSource(id)); } catch { sourceCache.set(id, null); }
  }
  return sourceCache.get(id) ?? null;
}

let scanned = 0;
const published: string[] = [];
const nowFailing: { file: string; ids: string[]; details: string[] }[] = [];
const missingSources: string[] = [];

for (const job of jobs) {
  const jobDir = join(runsDir, job);
  let names: string[] = [];
  try { names = readdirSync(jobDir).filter(n => /^log-ladder-v1\.r\d+\.json$/.test(n)).sort(); } catch { continue; }
  for (const name of names) {
    const file = join(jobDir, name);
    scanned += 1;
    let stored: StoredLadder;
    try { stored = JSON.parse(readFileSync(file, 'utf8')) as StoredLadder; } catch { continue; }
    const storedPublishable = stored?.report?.publishable === true;
    if (storedPublishable) published.push(`${job}/${name}`);
    const gen = stored?.gen;
    if (gen === undefined || gen === null) continue;
    const ids = new Set<string>();
    if (typeof gen.sourceId === 'string') ids.add(gen.sourceId);
    for (const r of Array.isArray(gen.rungs) ? gen.rungs : []) if (typeof r?.sourceId === 'string') ids.add(r.sourceId);
    const sources: SourceDocument[] = [];
    for (const id of ids) {
      const doc = sourceFor(id);
      if (doc === null) missingSources.push(`${job}/${name}: source ${id} not in data/sources`);
      else sources.push(doc);
    }
    const report = validateKitComponent('log-ladder-v1', gen, sources, { revision: stored?.report?.revision ?? 1 });
    const failed = report.checks.filter(c => !c.passed);
    if (storedPublishable && failed.length > 0) {
      nowFailing.push({
        file: `${job}/${name}`,
        ids: failed.map(c => c.id),
        details: failed.map(c => c.message.slice(0, 300)),
      });
    }
  }
}

console.log(`scanned ${scanned} stored log-ladder revision(s) across ${jobs.length} job dir(s)`);
console.log(`stored-published (report.publishable true): ${published.length}`);
for (const p of published) console.log(`  published: ${p}`);
console.log(`stored-published that FAIL under the current validator: ${nowFailing.length}`);
for (const f of nowFailing) {
  console.log(`  FAIL ${f.file} [${f.ids.join(', ')}]`);
  for (const d of f.details) console.log(`    - ${d}`);
}
if (missingSources.length > 0) {
  console.log(`missing sources (${missingSources.length}):`);
  for (const m of [...new Set(missingSources)]) console.log(`  ${m}`);
}
console.log(existsSync(runsDir) ? 'storage/ untouched (read-only scan)' : 'WARNING: runs dir not found');
