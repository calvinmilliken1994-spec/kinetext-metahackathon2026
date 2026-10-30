// S7 (batch 2026-10-30) — A-09 / OV-03 moved to the SAME narrowed publisher matching the kit
// sweep already uses (lead rulings 3-4): full publisher name phrases + name acronyms;
// "according to" counts only when it names the publisher; "as stated by" / "official" /
// "endorsed" are unchanged. The old default builder matched distinctive single words of the
// attribution's first segment and ANY all-caps word of the whole attribution (which includes the
// page title), so 12 of the 13 Spark 1.3 analysis repairs on 2026-10-30 were false alarms that
// degraded true page words (docs/evidence/stage-7/batch-2026-10-30/README.md):
//   census  job-20261030043747-a584f2fe  "How census counts apportion House seats…" → "How population counts…"
//   PCR     job-20261030044028-5d2d8227  "PCR copies small DNA segments for lab study" → "Copying small DNA segments…"
//   DNA seq job-20261030044043-267a6a0b, election job-20261030043938-debab573.
// Every false-alarm text below is the stored revision-1 text of the named job; every catch text is
// a real attribution/endorsement claim that must keep failing.
// Run: node --test packages/validation/stage6-a09-narrowed.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';

import { loadSource } from '../sources/index.ts';
import { validateKitComponent } from './kit/index.ts';
import { findPublisherClaim, mergePublisherTokens, publisherTokensOf } from './kit/shared.ts';
import { validateAnalysisV2 } from './analysis-v2.ts';
import { checkOf, clone, dragSource, usableAnalysis } from './fixtures/stage6.ts';

/* ------------------------------------------------------------------ */
/* The 2026-10-30 false alarms must pass                              */
/* ------------------------------------------------------------------ */

/** [sourceId, stored revision-1 AI text that the old builder wrongly flagged, old token]. */
const FALSE_ALARMS: [string, string, string][] = [
  // census-computing-apportionment, job-20261030043747-a584f2fe (old token "census", a single
  // word of "U.S. Census Bureau")
  ['census-computing-apportionment', 'How census counts apportion House seats by equal proportions', 'census'],
  ['census-computing-apportionment', 'Explains constitutional mandate for census apportionment and the Method of Equal Proportions with multipliers and priority values to assign House seats', 'census'],
  ['census-computing-apportionment', 'The Constitution requires an actual Enumeration to apportion representatives with Congress meeting after census', 'census'],
  // nhgri-pcr-fact-sheet, job-20261030044028-5d2d8227 (old tokens "pcr"/"dna" — all-caps words
  // of the page TITLE quoted inside the attribution)
  ['nhgri-pcr-fact-sheet', 'PCR copies small DNA segments for lab study', 'pcr'],
  ['nhgri-pcr-fact-sheet', 'Explains what PCR is, its laboratory and clinical uses, and how repeated heating and synthesis cycles amplify DNA.', 'pcr'],
  // nhgri-dna-sequencing-fact-sheet, job-20261030044043-267a6a0b (old token "dna")
  ['nhgri-dna-sequencing-fact-sheet', 'DNA sequencing reads base order to reveal genes and disease changes', 'dna'],
  ['nhgri-dna-sequencing-fact-sheet', 'chemical building blocks that make up the DNA molecule', 'dna'],
  // usagov-presidential-election-process, job-20261030043938-debab573 (old token "general", a
  // single word of the title's "(U.S. General Services Administration)" segment)
  ['usagov-presidential-election-process', 'Gatherings where parties choose presidential candidates for the general election', 'general'],
  ['usagov-presidential-election-process', 'The page covers the timing and ordered stages of the presidential election cycle, from candidate registration and primaries through conventions, debates, general election, Electoral College vote, congressional count, and inauguration.', 'general'],
];

test('S7: the stored 2026-10-30 false-alarm texts are publisher-claim free', () => {
  for (const [id, text] of FALSE_ALARMS) {
    const tokens = publisherTokensOf(loadSource(id));
    assert.equal(findPublisherClaim(text, tokens), null, `false alarm for ${id}: "${text}"`);
  }
});

test('S7: page-title / credit words in the attribution never become matchable publisher tokens', () => {
  const cases: [string, string[]][] = [
    // title "Polymerase Chain Reaction (PCR) Fact Sheet", credit "(NHGRI)" + Copyright Policy text
    ['nhgri-pcr-fact-sheet', ['pcr', 'polymerase', 'chain', 'reaction', 'fact', 'sheet', 'copyright']],
    // title "DNA Sequencing Fact Sheet"
    ['nhgri-dna-sequencing-fact-sheet', ['dna', 'sequencing', 'fact', 'sheet']],
    // title "Computing Apportionment — U.S. Census Bureau, Congressional Apportionment"
    ['census-computing-apportionment', ['computing', 'apportionment', 'congressional', 'census', 'ds027']],
    // title "Overview of the presidential election process — USA.gov (U.S. General Services Administration)"
    ['usagov-presidential-election-process', ['general', 'election', 'presidential', 'process', 'gsa']],
    // attribution credits NSF/WHOI and mentions FAQ/URL — metadata junk, not the publisher
    ['noaa-oceanexplorer-fueling-life-on-earth', ['faq', 'url', 'nsf', 'whoi', 'ocean', 'exploration']],
  ];
  for (const [id, banned] of cases) {
    const t = publisherTokensOf(loadSource(id));
    // The old loose sets (distinctive single words, any all-caps metadata word) are gone entirely.
    assert.equal('singles' in t, false, `${id}: the singles set must no longer exist`);
    assert.equal('acronyms' in t, false, `${id}: the loose acronyms set must no longer exist`);
    const matchable = [...t.phrases, ...t.namePhrases, ...t.nameAcronyms].map(s => s.toLowerCase());
    for (const word of banned) {
      // No matchable token may BE the bare title/credit word (single-word phrases or acronyms);
      // a word inside a full-name phrase ("ocean" in "noaa office of ocean exploration") only
      // matches as part of that whole phrase, never on its own.
      assert.ok(
        !matchable.includes(word),
        `${id}: title/credit word "${word}" is matchable on its own (${matchable.join(' | ')})`,
      );
    }
    // The publisher itself is still matchable (the sweep never goes silent).
    assert.ok(matchable.length >= 1, `${id} has matchable publisher tokens`);
  }
});

/* ------------------------------------------------------------------ */
/* Real attribution / endorsement claims must still fail              */
/* ------------------------------------------------------------------ */

test('S7: named-publisher attributions and endorsements are still caught', () => {
  const drag = publisherTokensOf(dragSource());
  // "according to" + named publisher (within the window)
  assert.notEqual(findPublisherClaim('According to NASA, drag rises with speed.', drag), null);
  assert.notEqual(findPublisherClaim('What happens next, according to the NASA Glenn Research Center?', drag), null);
  // bare acronym / full name anywhere in the field
  assert.notEqual(findPublisherClaim('NASA says drag rises with speed squared.', drag), null);
  assert.notEqual(findPublisherClaim('The NASA Glenn Research Center explains the drag factors.', drag), null);
  // endorsement words are unchanged (no publisher needed)
  assert.notEqual(findPublisherClaim('This lesson is endorsed by teachers.', drag), null);
  assert.notEqual(findPublisherClaim('Which is the official definition of drag?', drag), null);
  assert.notEqual(findPublisherClaim('As stated by the author, drag rises.', drag), null);

  const nara = publisherTokensOf(loadSource('nara-constitution'));
  assert.notEqual(findPublisherClaim('The National Archives states that delegates signed in secret.', nara), null);
  assert.notEqual(findPublisherClaim('NARA describes the signed document.', nara), null);
  assert.notEqual(findPublisherClaim('According to the National Archives, when was it signed?', nara), null);

  const noaa = publisherTokensOf(loadSource('noaa-oceanexplorer-fueling-life-on-earth'));
  assert.notEqual(findPublisherClaim('This lesson is endorsed by NOAA.', noaa), null);
  assert.notEqual(findPublisherClaim('NOAA explains chemosynthesis at vents.', noaa), null);
  assert.notEqual(findPublisherClaim('According to NOAA, what runs primary production?', noaa), null);
  assert.notEqual(findPublisherClaim('The NOAA Office of Ocean Exploration funds expeditions.', noaa), null);

  const census = publisherTokensOf(loadSource('census-computing-apportionment'));
  assert.notEqual(findPublisherClaim('The U.S. Census Bureau explains the method.', census), null);
  assert.notEqual(findPublisherClaim('According to the Census Bureau, how are seats assigned?', census), null);

  const nhgri = publisherTokensOf(loadSource('nhgri-pcr-fact-sheet'));
  assert.notEqual(findPublisherClaim('The National Human Genome Research Institute explains PCR.', nhgri), null);
  assert.notEqual(findPublisherClaim('NHGRI describes the thermal cycles.', nhgri), null);

  const nij = publisherTokensOf(loadSource('nij-heterozygosity'));
  assert.notEqual(findPublisherClaim('NIJ reports heterozygosity levels.', nij), null);
  assert.notEqual(findPublisherClaim('According to the National Institute of Justice, what is heterozygosity?', nij), null);
});

test('S7: a bare "according to" (no publisher named) passes, matching the kit sweep', () => {
  const drag = publisherTokensOf(dragSource());
  assert.equal(findPublisherClaim('What does it include according to the definition', drag), null);
  assert.equal(findPublisherClaim('According to the page, drag rises.', drag), null);
  // An ordinary single word of the publisher name no longer matches on its own (ruling 4 parity).
  assert.equal(findPublisherClaim('The Glenn center explains drag.', drag), null);
  // Merged tokens behave the same.
  const all = mergePublisherTokens([drag, publisherTokensOf(loadSource('nhgri-pcr-fact-sheet'))]);
  assert.equal(findPublisherClaim('PCR copies small DNA segments for lab study', all), null);
  assert.notEqual(findPublisherClaim('According to NASA, drag rises.', all), null);
});

/* ------------------------------------------------------------------ */
/* Check level: A-09 (analysis) and OV-03 (overview component)         */
/* ------------------------------------------------------------------ */

test('S7: A-09 and OV-03 apply the narrowed rule to the same fields', () => {
  const pass = clone(usableAnalysis());
  pass.overview.headline = 'Drag rises with speed according to the definition used on the page';
  assert.equal(checkOf(validateAnalysisV2(pass, [dragSource()]), 'A-09').passed, true);
  const passOv = clone(pass.overview);
  assert.equal(checkOf(validateKitComponent('overview-v1', passOv, [dragSource()]), 'OV-03').passed, true);

  const fail = clone(usableAnalysis());
  fail.overview.headline = 'According to NASA, drag rises with speed squared and density.';
  const report = validateAnalysisV2(fail, [dragSource()]);
  assert.equal(checkOf(report, 'A-09').passed, false);
  assert.deepEqual(checkOf(report, 'A-09').affected, ['/overview/headline']);
  assert.equal(checkOf(validateKitComponent('overview-v1', clone(fail.overview), [dragSource()]), 'OV-03').passed, false);

  // Endorsement wording fails without any publisher token (unchanged).
  const endorsed = clone(usableAnalysis());
  endorsed.pageCoverage = 'The official page teaches the drag equation and its factors.';
  assert.equal(checkOf(validateAnalysisV2(endorsed, [dragSource()]), 'A-09').passed, false);

  // The full publisher name in a keyPoint fails, and the affected path names that field.
  const named = clone(usableAnalysis());
  named.overview.keyPoints[0]!.point = 'The NASA Glenn Research Center story collects the drag factors in one relation.';
  const namedReport = validateAnalysisV2(named, [dragSource()]);
  assert.equal(checkOf(namedReport, 'A-09').passed, false);
  assert.deepEqual(checkOf(namedReport, 'A-09').affected, ['/overview/keyPoints/0/point']);
});
