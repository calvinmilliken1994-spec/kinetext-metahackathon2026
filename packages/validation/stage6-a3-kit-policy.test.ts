// Wave A3 (Stage 6 review S6R-08): the shared publisher-policy + plain-text sweep over every
// AI-generated DISPLAY field of every kit component, wired into validateKitComponent so each
// component report carries it. Turned from reviewer probe `kit-publisher-claim`.
// Verbatim evidence quotes (and system/identifier fields) are exempt.
// Run: node --test packages/validation/stage6-a3-kit-policy.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';

import { checkIdsFor } from '../contracts/kit.ts';
import type { KitComponentId } from '../contracts/kit.ts';
import type { SourceDocument } from '../contracts/index.ts';
import { compareKitRevisions, validateKitComponent } from './kit/index.ts';
import * as Policy from './kit/policy.ts';
import {
  atmosphereSource, balanceGoldenSource, checkOf, clone, constitutionSource, dragSource, nijSource,
  stage6Fixture, usableAnalysis,
} from './fixtures/stage6.ts';

interface Golden { id: KitComponentId; gen: unknown; sources: () => SourceDocument[]; display: string[]; exempt: string[] }

const COMMON_EXEMPT = ['/schemaVersion'];
const GOLDENS: Golden[] = [
  { id: 'quiz-cards-v1', gen: stage6Fixture('quiz-cards.gen.json'), sources: () => [dragSource()],
    display: ['/title', '/cards/*/stem', '/cards/*/hint', '/cards/*/options/*'],
    exempt: [...COMMON_EXEMPT, '/cards/*/id', '/cards/*/sourceId', '/cards/*/quote'] },
  { id: 'sequence-v1', gen: stage6Fixture('sequence.gen.json'), sources: () => [constitutionSource()],
    display: ['/title', '/orderNote', '/steps/*/label', '/steps/*/orderHint'],
    exempt: [...COMMON_EXEMPT, '/orderBasis', '/steps/*/id', '/steps/*/sourceId', '/steps/*/quote'] },
  { id: 'sort-groups-v1', gen: stage6Fixture('sort-groups.gen.json'), sources: () => [nijSource()],
    display: ['/title', '/groups/*/label', '/items/*/label'],
    exempt: [...COMMON_EXEMPT, '/groups/*/id', '/items/*/id', '/items/*/groupId', '/items/*/sourceId', '/items/*/quote'] },
  { id: 'concept-map-v1', gen: stage6Fixture('concept-map.gen.json'), sources: () => [dragSource()],
    display: ['/title', '/nodes/*/label'],
    exempt: [...COMMON_EXEMPT, '/nodes/*/id', '/links/*/id', '/links/*/fromId', '/links/*/toId', '/links/*/relation', '/links/*/sourceId', '/links/*/quote'] },
  { id: 'compare-table-v1', gen: stage6Fixture('compare-table.gen.json'), sources: () => [atmosphereSource()],
    display: ['/title', '/attributes/*', '/rows/*/entity', '/rows/*/values/*/value'],
    exempt: [...COMMON_EXEMPT, '/rows/*/values/*/sourceId', '/rows/*/values/*/quote'] },
  // variables[0] is meaningQuoted=true and its meaning occurs in its quote: verbatim evidence, exempt.
  { id: 'formula-explorer-v1', gen: stage6Fixture('formula-explorer.gen.json'), sources: () => [dragSource()],
    display: ['/title', '/variables/1/meaning', '/variables/2/meaning', '/variables/3/meaning', '/variables/*/unit'],
    exempt: [...COMMON_EXEMPT, '/formulaText', '/sourceId', '/quote', '/expression', '/xVariable', '/variables/0/meaning', '/variables/*/name', '/variables/*/pageSymbol', '/variables/*/quote', '/cases/*/id', '/cases/*/inputs/*/name', '/sourceExample/quote'] },
  { id: 'balance-equation-v1', gen: stage6Fixture('balance-equation.gen.json'), sources: () => [balanceGoldenSource()],
    display: ['/title', '/hint'],
    exempt: [...COMMON_EXEMPT, '/equationText', '/sourceId', '/quote', '/species/*/id', '/species/*/formula', '/species/*/side', '/species/*/sourceId', '/species/*/quote'] },
  { id: 'overview-v1', gen: usableAnalysis().overview, sources: () => [dragSource()],
    display: ['/headline', '/keyPoints/*/point', '/keyTerms/*/term', '/keyTerms/*/gloss'],
    exempt: ['/keyPoints/*/id', '/keyPoints/*/sourceId', '/keyPoints/*/quote', '/keyTerms/*/id', '/keyTerms/*/sourceId', '/keyTerms/*/quote'] },
];

const re = (template: string): RegExp => new RegExp('^' + template.replace(/\*/g, '\\d+').replace(/\//g, '\\/') + '$');
const matches = (templates: string[], path: string): boolean => templates.some(t => re(t).test(path));
function stringLeaves(node: unknown, ptr = ''): { path: string; text: string }[] {
  if (Array.isArray(node)) return node.flatMap((v, i) => stringLeaves(v, `${ptr}/${i}`));
  if (node !== null && typeof node === 'object') return Object.entries(node).flatMap(([k, v]) => stringLeaves(v, `${ptr}/${k}`));
  return typeof node === 'string' ? [{ path: ptr, text: node }] : [];
}
function setAt(root: unknown, path: string, value: string): void {
  const parts = path.split('/').slice(1);
  let cur = root as Record<string, unknown>;
  for (const p of parts.slice(0, -1)) cur = cur[p] as Record<string, unknown>;
  cur[parts[parts.length - 1] as string] = value;
}
const CLAIM = 'Official NASA-endorsed';

test('every golden still passes with the policy sweep wired in (no new check ids, no false rejects on true content)', () => {
  for (const g of GOLDENS) {
    const report = validateKitComponent(g.id, g.gen, g.sources());
    assert.equal(report.publishable, true, `${g.id}: ${report.checks.filter(c => !c.passed).map(c => `${c.id}: ${c.message}`).join('; ')}`);
    assert.deepEqual(report.checks.map(c => c.id), ['schema.gen', ...checkIdsFor(g.id)], `${g.id} check list must not gain ids`);
  }
});

test('policy.ts enumerates exactly the display fields of each golden (hand-listed per component from contracts/kit.ts)', () => {
  for (const g of GOLDENS) {
    const got = Policy.kitDisplayFields(g.id, g.gen).map(f => f.path).sort();
    const expected = stringLeaves(g.gen).map(l => l.path).filter(p => matches(g.display, p) && !matches(g.exempt, p) && stringLeaves(g.gen).find(l => l.path === p)!.text !== '').sort();
    assert.deepEqual(got, expected, `${g.id}: display field set`);
  }
});

test('no string leaf of any golden escapes the classification (a new contract field must be classified display or exempt)', () => {
  for (const g of GOLDENS) {
    for (const leaf of stringLeaves(g.gen)) {
      assert.ok(matches(g.display, leaf.path) || matches(g.exempt, leaf.path), `${g.id}: unclassified string field ${leaf.path}`);
    }
  }
});

test('kit-publisher-claim: reviewer probe — an endorsement title is no longer publishable', () => {
  const q = stage6Fixture<{ title: string }>('quiz-cards.gen.json');
  q.title = 'Official NASA-endorsed lesson';
  const report = validateKitComponent('quiz-cards-v1', q, [dragSource()]);
  assert.equal(report.publishable, false);
  const gate = checkOf(report, 'schema.gen');
  assert.equal(gate.passed, false);
  assert.deepEqual(gate.affected, ['/title']);
  assert.match(gate.message, /publisher|attribution|endorse|official/i);
});

test('every display field of every component: an injected publisher claim fails with that exact field in the affected pointers', () => {
  for (const g of GOLDENS) {
    const fields = Policy.kitDisplayFields(g.id, g.gen);
    assert.ok(fields.length >= 2, `${g.id} should have display fields`);
    for (const f of fields) {
      const gen = clone(g.gen);
      setAt(gen, f.path, `${CLAIM} ${f.text}`);
      const report = validateKitComponent(g.id, gen, g.sources());
      assert.equal(report.publishable, false, `${g.id} ${f.path} must block publication`);
      // overview-v1 already owns the publisher rule as OV-03 (same helper, same fields).
      const gate = checkOf(report, g.id === 'overview-v1' ? 'OV-03' : 'schema.gen');
      assert.equal(gate.passed, false, `${g.id} ${f.path}: ${gate.id} must carry the policy hit`);
      assert.ok(gate.affected?.includes(f.path), `${g.id} ${f.path}: affected=${JSON.stringify(gate.affected)} message=${gate.message}`);
    }
  }
});

test('every display field of every component: the plain-text rule (markup, backticks, URLs, markdown) is applied', () => {
  const bads = ['<b>bold</b>', 'see `code` here', 'visit https://example.com now', '**strong** claim'];
  for (const g of GOLDENS) {
    for (const f of Policy.kitDisplayFields(g.id, g.gen)) {
      for (const bad of bads) {
        const gen = clone(g.gen);
        setAt(gen, f.path, `${f.text} ${bad}`);
        const report = validateKitComponent(g.id, gen, g.sources());
        assert.equal(report.publishable, false, `${g.id} ${f.path} + ${bad}`);
        assert.ok(checkOf(report, 'schema.gen').affected?.includes(f.path), `${g.id} ${f.path} + ${bad}: ${JSON.stringify(checkOf(report, 'schema.gen').affected)}`);
      }
    }
  }
});

test('verbatim evidence quotes are exempt: a quote naming the publisher or using markup characters is not a policy hit', () => {
  const gen = stage6Fixture<{ cards: { quote: string }[] }>('quiz-cards.gen.json');
  gen.cards[0]!.quote = 'Official NASA <guide> says **drag** at https://example.com';
  const problems = Policy.kitPolicyProblems('quiz-cards-v1', gen, [dragSource()]);
  assert.deepEqual(problems.affected, []);
  assert.deepEqual(problems.problems, []);
});

test('a meaningQuoted formula meaning is exempt only while it really occurs in its quote', () => {
  const gen = stage6Fixture<{ variables: { meaning: string; quote: string; meaningQuoted: boolean }[] }>('formula-explorer.gen.json');
  gen.variables[0]!.meaning = 'Official drag coefficient';
  gen.variables[0]!.quote = 'Official drag coefficient is defined here';
  assert.deepEqual(Policy.kitPolicyProblems('formula-explorer-v1', gen, [dragSource()]).affected, [], 'verbatim quoted meaning is exempt');
  gen.variables[0]!.quote = 'this variable is called the drag coefficient, designated';
  assert.deepEqual(Policy.kitPolicyProblems('formula-explorer-v1', gen, [dragSource()]).affected, ['/variables/0/meaning'], 'claimed-verbatim but absent from the quote: swept');
  gen.variables[0]!.quote = 'Official drag coefficient is defined here';
  gen.variables[0]!.meaningQuoted = false;
  assert.deepEqual(Policy.kitPolicyProblems('formula-explorer-v1', gen, [dragSource()]).affected, ['/variables/0/meaning'], 'meaningQuoted=false: swept');
});

test('policy hits list EVERY violating field so a legitimate multi-field fix is not rejected', () => {
  const q = stage6Fixture<{ title: string; cards: { stem: string; options: string[]; hint: string }[] }>('quiz-cards.gen.json');
  q.title = `${CLAIM} quiz`;
  q.cards[1]!.hint = 'Look at <this> hint please';
  q.cards[2]!.options[1] = `${CLAIM} area`;
  const problems = Policy.kitPolicyProblems('quiz-cards-v1', q, [dragSource()]);
  assert.deepEqual([...problems.affected].sort(), ['/cards/1/hint', '/cards/2/options/1', '/title']);
});

test('repair: a field-scoped fix of the flagged title is accepted; touching any other field is rejected', () => {
  const baseline = stage6Fixture<{ title: string }>('quiz-cards.gen.json');
  baseline.title = 'Official NASA-endorsed lesson';
  const fixed = stage6Fixture<{ title: string }>('quiz-cards.gen.json');
  const ok = compareKitRevisions('quiz-cards-v1', baseline, fixed, { sources: [dragSource()] });
  assert.equal(ok.passed, true, ok.message);
  const sneaky = stage6Fixture<{ title: string; cards: { stem: string }[] }>('quiz-cards.gen.json');
  sneaky.cards[0]!.stem = 'Which single variable collects the complex drag effects?';
  const bad = compareKitRevisions('quiz-cards-v1', baseline, sneaky, { sources: [dragSource()] });
  assert.equal(bad.passed, false);
  assert.match(bad.message, /\/cards\/0\/stem changed/);
});

test('ordinary page wording with comparison words and digits is not mistaken for markup', () => {
  const q = stage6Fixture<{ title: string; cards: { hint: string }[] }>('quiz-cards.gen.json');
  q.title = 'Drag factors quiz, part 2';
  q.cards[0]!.hint = 'It starts with the word drag.';
  assert.equal(validateKitComponent('quiz-cards-v1', q, [dragSource()]).publishable, true);
});
