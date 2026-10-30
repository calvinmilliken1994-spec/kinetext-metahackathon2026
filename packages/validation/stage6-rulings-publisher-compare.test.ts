// Stage 6 lead rulings 3, 4 (publisher sweep) and the compare page-wording rule.
// Ruling 3: "according to" is a publisher claim only when a publisher name or acronym of the source
//           follows within ~4 words. Since 2026-10-30 this applies to EVERY publisher sweep — kit
//           display fields, overview OV-03 and analysis A-09 (see stage6-a09-narrowed.test.ts).
// Ruling 4: publisher matching uses name acronyms (NASA, NOAA, NARA, CFPB, NRC, USGS, NIJ) and the
//           FULL publisher name, never an ordinary word inside the name ("ocean" in "NOAA Office of
//           Ocean Exploration"). The old single-word / loose-acronym builder is gone.
// Compare: a kebab-case / underscore name is "id-like" only if it does NOT occur in the cited source text.
// Run: node --test packages/validation/stage6-rulings-publisher-compare.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';

import { loadSource } from '../sources/index.ts';
import { validateKitComponent } from './kit/index.ts';
import { kitPolicyProblems } from './kit/policy.ts';
import { idLikeNameProblem, validateCompareTable } from './kit/compare.ts';
import { findPublisherClaim, mergePublisherTokens, publisherTokensOf } from './kit/shared.ts';
import { validateAnalysisV2 } from './analysis-v2.ts';
import {
  checkOf, clone, dragSource, synthSource, THREE_ENTITY_SOURCE, threeEntityCompareGen, usableAnalysis,
} from './fixtures/stage6.ts';

const quiz = (...stems: string[]) => ({ schemaVersion: 'quiz-cards-v1', title: 'Quiz', cards: stems.map(stem => ({ stem })) });
const hits = (id: string, stem: string, sourceId: string): string[] => kitPolicyProblems('quiz-cards-v1', quiz(stem), [loadSource(sourceId)]).affected;

/* ------------------------------------------------------------------ */
/* Ruling 3 — "according to" needs a named publisher                  */
/* ------------------------------------------------------------------ */

test('ruling 3: real stored quiz stems "according to the definition / the study" now pass the kit sweep', () => {
  assert.deepEqual(hits('quiz', 'What does post-secondary education include according to the definition', 'cfpb-saving-post-secondary-education'), []);
  assert.deepEqual(hits('quiz', 'Where is human genetic diversity greatest according to the study?', 'nij-population-genetics'), []);
  assert.deepEqual(hits('quiz', 'According to superposition, where are the oldest layers located', 'usgs-fossils-numeric-time-scale'), []);
  assert.deepEqual(hits('quiz', 'According to early findings, how does lift change with speed and area', 'nasa-grc-lift-equation'), []);
});

test('ruling 3: "according to" followed (within ~4 words) by a publisher name or acronym still fails', () => {
  assert.deepEqual(hits('quiz', 'According to NASA, what does drag depend on?', 'nasa-grc-drag-equation'), ['/cards/0/stem']);
  assert.deepEqual(hits('quiz', 'What happens next, according to the National Archives?', 'nara-constitution'), ['/cards/0/stem']);
  assert.deepEqual(hits('quiz', 'Per the page and according to the National Institute of Justice, what is heterozygosity?', 'nij-heterozygosity'), ['/cards/0/stem']);
  assert.deepEqual(hits('quiz', 'According to the CFPB, what is interest?', 'cfpb-compound-interest'), ['/cards/0/stem']);
  const msg = kitPolicyProblems('quiz-cards-v1', quiz('According to NASA, what is lift?'), [dragSource()]).problems.join(' ');
  assert.match(msg, /publisher claim at \/cards\/0\/stem/);
});

test('ruling 3: the other frozen generic phrases ("as stated by", "official", "endorsed") are unchanged in kit text', () => {
  assert.deepEqual(hits('quiz', 'Which is the official definition of drag?', 'nasa-grc-drag-equation'), ['/cards/0/stem']);
  assert.deepEqual(hits('quiz', 'This lesson is endorsed by teachers', 'nasa-grc-drag-equation'), ['/cards/0/stem']);
  assert.deepEqual(hits('quiz', 'As stated by the author, drag rises', 'nasa-grc-drag-equation'), ['/cards/0/stem']);
});

test('ruling 3 (extended 2026-10-30): A-09 / OV-03 share the narrowed "according to" rule', () => {
  const tokens = publisherTokensOf(dragSource());
  // A bare "according to" no longer matches anywhere — kit sweep, OV-03 and A-09 agree.
  assert.equal(findPublisherClaim('What does it include according to the definition', tokens), null);
  assert.notEqual(findPublisherClaim('What does it include according to NASA', tokens), null);
  // The overview gate (OV-03) and analysis A-09 follow the same rule.
  const ov = clone(usableAnalysis().overview);
  ov.headline = 'Drag rises with speed according to the definition';
  const ovReport = validateKitComponent('overview-v1', ov, [dragSource()]);
  assert.equal(checkOf(ovReport, 'OV-03').passed, true);
  const an = clone(usableAnalysis());
  an.overview.headline = 'Drag rises with speed according to the definition';
  assert.equal(checkOf(validateAnalysisV2(an, [dragSource()]), 'A-09').passed, true);
  const named = clone(usableAnalysis());
  named.overview.headline = 'Drag rises with speed according to NASA';
  assert.equal(checkOf(validateAnalysisV2(named, [dragSource()]), 'A-09').passed, false);
});

/* ------------------------------------------------------------------ */
/* Ruling 4 — acronyms + full names, never ordinary single words      */
/* ------------------------------------------------------------------ */

test('ruling 4: the real NOAA stem "…primary production where sunlight is absent in the deep ocean" passes', () => {
  const stem = 'What kind of energy runs primary production where sunlight is absent in the deep ocean';
  assert.deepEqual(hits('quiz', stem, 'noaa-oceanexplorer-fueling-life-on-earth'), []);
  assert.deepEqual(hits('quiz', 'Which exploration method samples the ocean floor?', 'noaa-oceanexplorer-fueling-life-on-earth'), []);
  // Since 2026-10-30 every sweep (kit, OV-03, A-09) uses the narrowed matcher: the ordinary word
  // "ocean" of the publisher name no longer flags anything.
  const tokens = publisherTokensOf(loadSource('noaa-oceanexplorer-fueling-life-on-earth'));
  assert.equal(findPublisherClaim(stem, tokens), null);
});

test('ruling 4: ordinary words inside other publisher names no longer trigger the kit sweep', () => {
  assert.deepEqual(hits('quiz', 'Which nuclear process releases the most energy?', 'nrc-backgrounder-plutonium'), []);
  assert.deepEqual(hits('quiz', 'Which regulatory step comes first?', 'nrc-backgrounder-plutonium'), []);
  assert.deepEqual(hits('quiz', 'How is a geological survey of rock layers carried out?', 'usgs-geologic-age'), ['/cards/0/stem'], 'the full name "geological survey" (U.S. dropped) is still a name');
  assert.deepEqual(hits('quiz', 'Which layer is oldest in a rock record?', 'usgs-geologic-age'), []);
});

test('ruling 4: acronyms derived from the publisher string and the full names are still caught (all seven)', () => {
  const cases: [string, string, string][] = [
    ['NASA', 'nasa-grc-drag-equation', 'What does NASA say about drag?'],
    ['NOAA', 'noaa-oceanexplorer-fueling-life-on-earth', 'What does NOAA call this process?'],
    ['NARA', 'nara-constitution', 'Which document does NARA describe?'],
    ['CFPB', 'cfpb-compound-interest', 'What does the CFPB advise?'],
    ['NRC', 'nrc-backgrounder-plutonium', 'What does the NRC regulate?'],
    ['USGS', 'usgs-geologic-age', 'How does USGS date rocks?'],
    ['NIJ', 'nij-heterozygosity', 'What does the NIJ measure?'],
  ];
  for (const [name, sourceId, stem] of cases) {
    const tokens = publisherTokensOf(loadSource(sourceId));
    assert.equal(findPublisherClaim(stem, tokens)?.toLowerCase(), name.toLowerCase(), `${name} acronym`);
    assert.deepEqual(hits('quiz', stem, sourceId), ['/cards/0/stem'], `${name} stem`);
  }
  // Full names, with and without the leading "U.S." / acronym.
  assert.deepEqual(hits('quiz', 'Which agency is the National Archives and Records Administration?', 'nara-constitution'), ['/cards/0/stem']);
  assert.deepEqual(hits('quiz', 'The U.S. Nuclear Regulatory Commission sets what limit?', 'nrc-backgrounder-plutonium'), ['/cards/0/stem']);
  assert.deepEqual(hits('quiz', 'The Nuclear Regulatory Commission sets what limit?', 'nrc-backgrounder-plutonium'), ['/cards/0/stem']);
  assert.deepEqual(hits('quiz', 'The NOAA Office of Ocean Exploration funds what?', 'noaa-oceanexplorer-fueling-life-on-earth'), ['/cards/0/stem']);
  assert.deepEqual(hits('quiz', 'The Consumer Financial Protection Bureau explains what?', 'cfpb-compound-interest'), ['/cards/0/stem']);
});

test('ruling 4: metadata junk acronyms (FAQ, URL) never become publisher tokens', () => {
  const tokens = mergePublisherTokens([publisherTokensOf(loadSource('noaa-oceanexplorer-fueling-life-on-earth'))]);
  assert.equal(findPublisherClaim('Which FAQ item is easiest?', tokens), null);
  assert.equal(findPublisherClaim('A URL names a page', tokens), null);
});

test('rulings 3-4: the publisher sweep still fails a bare publisher in every real source (kit mode never goes silent)', () => {
  const ids = ['nasa-grc-drag-equation', 'nara-bill-of-rights', 'cfpb-teenagers-and-saving', 'nij-random-mating', 'nrc-glossary-half-life', 'usgs-powell-geologic-time', 'noaa-oceanexplorer-fueling-life-on-earth'];
  for (const id of ids) {
    const t = publisherTokensOf(loadSource(id));
    const any = [...t.phrases, ...t.nameAcronyms, ...t.namePhrases];
    assert.ok(any.length >= 2, `${id} has kit tokens`);
  }
});

/* ------------------------------------------------------------------ */
/* Compare page-wording rule                                          */
/* ------------------------------------------------------------------ */

const PAGE = 'Alpha rock is hard and old. The Set-Aside is long-term; half-life matters.  Constant  pressure holds.';

test('compare: idLikeNameProblem — a hyphenated name on the page passes (case-insensitive, whitespace-normalised)', () => {
  assert.equal(idLikeNameProblem('rows[0].entity', 'set-aside', [PAGE]), null);
  assert.equal(idLikeNameProblem('attributes[1]', 'half-life', [PAGE]), null);
  assert.equal(idLikeNameProblem('attributes[1]', 'long-term', [PAGE]), null);
  assert.equal(idLikeNameProblem('rows[0].entity', 'Set-Aside', ['the set-aside here']), null);
  assert.equal(idLikeNameProblem('rows[0].entity', 'set-aside', ['the \n\n  set-aside\t here']), null);
  // An underscore name that really is on the page is likewise page wording.
  assert.equal(idLikeNameProblem('rows[0].entity', 'half_life', ['the half_life constant']), null);
});

test('compare: idLikeNameProblem — ids that are not on the page keep failing with the frozen message', () => {
  for (const idLike of ['this-equation', 'constant-pressure-process', 'starting-at-age-14']) {
    assert.equal(
      idLikeNameProblem('rows[0].entity', idLike, [PAGE]),
      `rows[0].entity "${idLike}" looks like an id; use the words the page uses`,
    );
  }
  assert.equal(idLikeNameProblem('attributes[2]', 'half_life_value', [PAGE]), 'attributes[2] "half_life_value" looks like an id; use the words the page uses');
  // "constant pressure" (spaces) is on the page but the kebab id is not: still an id.
  assert.notEqual(idLikeNameProblem('rows[0].entity', 'constant-pressure', [PAGE]), null);
  // No source text supplied: the strict legacy behaviour (nothing can be on a page that is not given).
  assert.notEqual(idLikeNameProblem('rows[0].entity', 'set-aside'), null);
  assert.notEqual(idLikeNameProblem('rows[0].entity', 'set-aside', []), null);
  // Ordinary words never matter.
  assert.equal(idLikeNameProblem('rows[0].entity', 'Alpha rock', [PAGE]), null);
  assert.equal(idLikeNameProblem('rows[0].entity', 3, [PAGE]), null);
});

test('compare: idLikeNameProblem — whole-token occurrence, not a substring of a longer hyphenated word', () => {
  assert.notEqual(idLikeNameProblem('attributes[0]', 'set-aside', ['the set-asides were counted']), null);
  assert.notEqual(idLikeNameProblem('attributes[0]', 'long-term', ['a not-long-term plan']), null);
  assert.equal(idLikeNameProblem('attributes[0]', 'long-term', ['a (long-term) plan.']), null);
});

test('compare: validateCompareTable passes a hyphenated attribute the cited page really uses; ids off the page still fail schema.gen', () => {
  const src = synthSource('compare-three', 'Synthetic rock compare paragraph', 'Alpha rock is hard and old. Beta rock is soft and young. Gamma rock is porous and new. The set-aside matters and half-life too.');
  const ok = threeEntityCompareGen();
  ok.attributes = ['set-aside', 'age'];
  const r = validateCompareTable(ok, [src]);
  assert.equal(checkOf(r, 'schema.gen').passed, true, checkOf(r, 'schema.gen').message);

  const bad = threeEntityCompareGen();
  bad.attributes = ['this-equation', 'age'];
  const rb = validateCompareTable(bad, [THREE_ENTITY_SOURCE()]);
  const gate = checkOf(rb, 'schema.gen');
  assert.equal(gate.passed, false);
  assert.match(gate.message, /attributes\[0\] "this-equation" looks like an id; use the words the page uses/);
  assert.ok(gate.affected?.includes('/attributes/0'));

  // The same name is fine on a page that uses it, and fails on one that does not.
  const ent = threeEntityCompareGen();
  ent.rows[0]!.entity = 'set-aside';
  assert.equal(checkOf(validateCompareTable(ent, [THREE_ENTITY_SOURCE()]), 'schema.gen').passed, false);
  const gateEnt = checkOf(validateCompareTable(ent, [THREE_ENTITY_SOURCE()]), 'schema.gen');
  assert.ok(gateEnt.affected?.includes('/rows/0/entity'));
});

test('compare: the page used is the cited source, not another provided source', () => {
  const cited = synthSource('compare-three', 'cited', 'Alpha rock is hard and old. Beta rock is soft and young. Gamma rock is porous and new.');
  const other = synthSource('other', 'other', 'The set-aside appears only here.');
  const gen = threeEntityCompareGen();
  gen.attributes = ['set-aside', 'age'];
  assert.equal(checkOf(validateCompareTable(gen, [cited, other]), 'schema.gen').passed, false);
});
