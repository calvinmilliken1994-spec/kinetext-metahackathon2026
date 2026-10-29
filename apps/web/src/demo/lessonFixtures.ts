// Dev-only fixture data for the lesson demo harness (?lesson-demo=1). Hand-written golden JSON from tests/fixtures and
// source metadata from data/sources; NOT model output. Loaded only through a dynamic import behind import.meta.env.DEV.
import analysisUsable from '../../../../tests/fixtures/stage6/source-analysis-v2.usable.json';
import analysisDeclined from '../../../../tests/fixtures/stage6/source-analysis-v2.declined.json';
import quiz from '../../../../tests/fixtures/stage6/quiz-cards.gen.json';
import sequence from '../../../../tests/fixtures/stage6/sequence.gen.json';
import sort from '../../../../tests/fixtures/stage6/sort-groups.gen.json';
import map from '../../../../tests/fixtures/stage6/concept-map.gen.json';
import compare from '../../../../tests/fixtures/stage6/compare-table.gen.json';
import formula from '../../../../tests/fixtures/stage6/formula-explorer.gen.json';
import balance from '../../../../tests/fixtures/stage6/balance-equation.gen.json';
import timeline from '../../../../tests/fixtures/timeline.declaration.gen.json';
import provenance from '../../../../tests/fixtures/provenance.fixture.json';
import srcDrag from '../../../../data/sources/nasa-grc-drag-equation.json';
import srcConstitution from '../../../../data/sources/nara-constitution.json';
import srcHetero from '../../../../data/sources/nij-heterozygosity.json';
import srcAtmosphere from '../../../../data/sources/nasa-grc-earth-atmosphere-equation-english.json';
import srcDeclaration from '../../../../data/sources/nara-declaration-of-independence.json';
import { buildDemoLessons } from '../lib/demoLesson.ts';
import type { DemoLesson, DemoRaw, DemoSourceMeta } from '../lib/demoLesson.ts';

const meta = (m: DemoSourceMeta): DemoSourceMeta => ({ id: m.id, title: m.title, locator: m.locator, license: m.license, attribution: m.attribution, sha256: m.sha256 });

const raw = {
  analysisUsable, analysisDeclined, quiz, sequence, sort, map, compare, formula, balance, timeline, provenance,
  sources: {
    'nasa-grc-drag-equation': meta(srcDrag),
    'nara-constitution': meta(srcConstitution),
    'nij-heterozygosity': meta(srcHetero),
    'nasa-grc-earth-atmosphere-equation-english': meta(srcAtmosphere),
    'nara-declaration-of-independence': meta(srcDeclaration),
    'synthetic-balance': {
      id: 'synthetic-balance', title: 'Synthetic methane-burning paragraph (fixture)', locator: 'tests/fixtures/stage6/balance.synthetic-source.txt',
      license: 'CC0-1.0', attribution: 'Synthetic fixture text authored for this repository.', sha256: '0'.repeat(64),
    },
  },
} as unknown as DemoRaw;

export const demoLessons: DemoLesson[] = buildDemoLessons(raw);
