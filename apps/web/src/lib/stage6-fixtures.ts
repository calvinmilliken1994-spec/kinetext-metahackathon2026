/// <reference types="node" />
// Test-only: loads the golden Stage 6 fixtures from disk and builds the demo lessons from them.
import { readFileSync } from 'node:fs';
import type { Provenance, TimelineGeneratedSpec } from '../../../../packages/contracts/index.ts';
import type {
  BalanceEquationGen, CompareTableGen, ConceptMapGen, FormulaExplorerGen, QuizCardsGen, SequenceGen, SortGroupsGen, SourceAnalysisV2,
} from '../../../../packages/contracts/kit.ts';
import { buildDemoLessons } from './demoLesson.ts';
import type { DemoRaw, DemoSourceMeta } from './demoLesson.ts';

const root = new URL('../../../../', import.meta.url);
const json = <T>(path: string): T => JSON.parse(readFileSync(new URL(path, root), 'utf8')) as T;
const stage6 = <T>(name: string): T => json<T>(`tests/fixtures/stage6/${name}`);

function sourceMeta(id: string): DemoSourceMeta {
  const m = json<DemoSourceMeta>(`data/sources/${id}.json`);
  return { id: m.id, title: m.title, locator: m.locator, license: m.license, attribution: m.attribution, sha256: m.sha256 };
}

export function loadDemoRaw(): DemoRaw {
  const sources: Record<string, DemoSourceMeta> = {};
  for (const id of ['nasa-grc-drag-equation', 'nara-constitution', 'nij-heterozygosity', 'nasa-grc-earth-atmosphere-equation-english', 'nara-declaration-of-independence']) {
    sources[id] = sourceMeta(id);
  }
  sources['synthetic-balance'] = {
    id: 'synthetic-balance', title: 'Synthetic methane-burning paragraph (fixture)', locator: 'tests/fixtures/stage6/balance.synthetic-source.txt',
    license: 'CC0-1.0', attribution: 'Synthetic fixture text authored for this repository.', sha256: '0'.repeat(64),
  };
  return {
    analysisUsable: stage6<SourceAnalysisV2>('source-analysis-v2.usable.json'),
    analysisDeclined: stage6<SourceAnalysisV2>('source-analysis-v2.declined.json'),
    quiz: stage6<QuizCardsGen>('quiz-cards.gen.json'),
    sequence: stage6<SequenceGen>('sequence.gen.json'),
    sort: stage6<SortGroupsGen>('sort-groups.gen.json'),
    map: stage6<ConceptMapGen>('concept-map.gen.json'),
    compare: stage6<CompareTableGen>('compare-table.gen.json'),
    formula: stage6<FormulaExplorerGen>('formula-explorer.gen.json'),
    balance: stage6<BalanceEquationGen>('balance-equation.gen.json'),
    timeline: json<TimelineGeneratedSpec>('tests/fixtures/timeline.declaration.gen.json'),
    provenance: json<Provenance>('tests/fixtures/provenance.fixture.json'),
    sources,
  };
}

export function loadDemoLessons() {
  return buildDemoLessons(loadDemoRaw());
}
