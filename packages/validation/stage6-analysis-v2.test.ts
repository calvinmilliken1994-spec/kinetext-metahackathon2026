// S6-V — SourceAnalysisV2 validation tests: the golden fixtures (usable + declined) must pass,
// every A-check id has a failing fixture, the A-09 publisher-token set is exercised on ALL real
// data/sources metadata (no false rejects on ordinary text), and the v2 repair comparator enforces
// the frozen discipline (changes only under revision-1 affected paths, ids stable, never weaken).
// Run: node --test packages/validation/stage6-analysis-v2.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';

import type { SourceAnalysisV2 } from '../contracts/index.ts';
import { validateAnalysisV2, compareAnalysisV2Revisions, analysisV2RepairAuthority } from './analysis-v2.ts';
import { findPublisherClaim, mergePublisherTokens, publisherTokensOf } from './kit/shared.ts';
import { affectedPathsOf } from './validate.ts';
import {
  checkOf, clone, dragSource, declinedAnalysis, expectFailures, failedIds,
  listSourceIds, loadSourceMeta, stubSource, usableAnalysis,
} from './fixtures/stage6.ts';

const A_IDS = ['A-01', 'A-02', 'A-03', 'A-04', 'A-05', 'A-06', 'A-07', 'A-08', 'A-09', 'A-10', 'A-11'];

/* ------------------------------------------------------------------ */
/* Goldens                                                             */
/* ------------------------------------------------------------------ */

test('golden usable analysis passes every check against the real drag source', () => {
  const report = validateAnalysisV2(usableAnalysis(), [dragSource()]);
  assert.deepEqual(report.checks.map(c => c.id), ['schema.analysis-v2', ...A_IDS]);
  assert.deepEqual(failedIds(report), [], report.checks.filter(c => !c.passed).map(c => c.message).join('\n'));
  assert.equal(report.publishable, true);
  assert.equal(checkOf(report, 'A-02').passed, true); // retired, reserved, always passes
});

test('golden declined analysis passes against a sub-300-char stub source', () => {
  const report = validateAnalysisV2(declinedAnalysis(), [stubSource()]);
  assert.deepEqual(failedIds(report), [], report.checks.filter(c => !c.passed).map(c => c.message).join('\n'));
  assert.equal(report.publishable, true);
});

test('malformed analysis short-circuits at the schema gate with affected paths', () => {
  const a = clone(usableAnalysis());
  (a as unknown as { subject: string }).subject = 'astrology';
  const report = validateAnalysisV2(a, [dragSource()]);
  assert.equal(report.publishable, false);
  assert.equal(report.checks.length, 1);
  assert.equal(report.checks[0]?.id, 'schema.analysis-v2');
  assert.deepEqual(report.checks[0]?.affected, ['/subject']);
  // A root-level shape failure still short-circuits (root errors carry no field information):
  const bare = validateAnalysisV2({ analysisVersion: 2 }, []);
  assert.equal(bare.checks.length, 1);
  assert.equal(bare.checks[0]?.id, 'schema.analysis-v2');
  assert.equal(bare.checks[0]?.passed, false);
});

/* ------------------------------------------------------------------ */
/* One failing fixture per check id                                    */
/* ------------------------------------------------------------------ */

test('A-01: analysisVersion != 2 is caught by the schema gate (A-01 double-guards it)', () => {
  const a = clone(usableAnalysis());
  (a as unknown as { analysisVersion: number }).analysisVersion = 1;
  const report = validateAnalysisV2(a, [dragSource()]);
  assert.equal(report.checks[0]?.id, 'schema.analysis-v2');
  assert.equal(report.checks[0]?.passed, false);
  // On a schema-valid analysis A-01 passes:
  assert.equal(checkOf(validateAnalysisV2(usableAnalysis(), [dragSource()]), 'A-01').passed, true);
});

test('A-03: balance-equation-v1 requires subject chemistry', () => {
  const a = clone(usableAnalysis());
  a.componentPlan[0] = { componentId: 'balance-equation-v1', pedagogicalReason: a.componentPlan[0]!.pedagogicalReason, focusQuote: a.componentPlan[0]!.focusQuote, focusSourceId: a.componentPlan[0]!.focusSourceId };
  expectFailures(validateAnalysisV2(a, [dragSource()]), ['A-03'], 'schema.analysis-v2');
});

test('A-04: decline fields must be consistent both ways, incl. the 300-char stub rule', () => {
  // too-short decline over a long source is inconsistent:
  expectFailures(validateAnalysisV2(declinedAnalysis(), [dragSource()]), ['A-04'], 'schema.analysis-v2');
  // usable analysis over a stub source violates R-DEC-3 (A-06 also fails: the stub has another id):
  const report = validateAnalysisV2(usableAnalysis(), [stubSource()]);
  assert.deepEqual(failedIds(report), ['A-04', 'A-06']);
  // usable=true with a decline code:
  const a = clone(usableAnalysis());
  a.declineCode = 'too-short';
  expectFailures(validateAnalysisV2(a, [dragSource()]), ['A-04'], 'schema.analysis-v2');
  // declined with a non-empty overview:
  const d = clone(declinedAnalysis());
  d.overview.headline = 'A headline that should not exist on decline.';
  const rd = validateAnalysisV2(d, [stubSource()]);
  assert.ok(failedIds(rd).includes('A-04'));
});

test('A-05: a fabricated overview quote fails grounding', () => {
  const a = clone(usableAnalysis());
  a.overview.keyPoints[0]!.quote = 'A fabricated sentence that never appeared on the drag page.';
  const report = expectFailures(validateAnalysisV2(a, [dragSource()]), ['A-05'], 'schema.analysis-v2');
  assert.deepEqual(checkOf(report, 'A-05').affected, ['/overview/keyPoints/0/quote']);
});

test('A-06: an unresolvable sourceId is owned by A-06 alone (A-05 skips it)', () => {
  const a = clone(usableAnalysis());
  a.overview.keyPoints[0]!.sourceId = 'no-such-source';
  const report = expectFailures(validateAnalysisV2(a, [dragSource()]), ['A-06'], 'schema.analysis-v2');
  assert.deepEqual(checkOf(report, 'A-06').affected, ['/overview/keyPoints/0/sourceId']);
});

test('A-07: lengths, counts and id patterns are validator-owned', () => {
  const a = clone(usableAnalysis());
  a.overview.headline = 'Drag.';
  expectFailures(validateAnalysisV2(a, [dragSource()]), ['A-07'], 'schema.analysis-v2');
  const b = clone(usableAnalysis());
  b.overview.keyPoints[0]!.id = 'Bad ID';
  const rb = expectFailures(validateAnalysisV2(b, [dragSource()]), ['A-07'], 'schema.analysis-v2');
  assert.ok((checkOf(rb, 'A-07').affected ?? []).includes('/overview/keyPoints/0/id'));
  // A plan with 4 entries passes the count-exempt gate and fails A-07's 1-3 count:
  const c = clone(usableAnalysis());
  c.componentPlan.push({ componentId: 'sequence-v1', pedagogicalReason: 'Adds an ordering practice for the derivation steps.', focusQuote: 'Drag depends on the density of the air', focusSourceId: 'nasa-grc-drag-equation' });
  c.componentPlan.push({ componentId: 'sort-groups-v1', pedagogicalReason: 'Adds a sorting practice for the drag factors.', focusQuote: 'Drag depends on the density of the air', focusSourceId: 'nasa-grc-drag-equation' });
  const rc = validateAnalysisV2(c, [dragSource()]);
  assert.ok(failedIds(rc).includes('A-07'));
});

test('A-08: duplicate families and multiple premiums fail the plan rules', () => {
  const a = clone(usableAnalysis());
  a.componentPlan[1] = { componentId: 'formula-explorer-v1', pedagogicalReason: 'A duplicate family entry for the same formula.', focusQuote: 'Drag depends on the density of the air', focusSourceId: 'nasa-grc-drag-equation' };
  const report = expectFailures(validateAnalysisV2(a, [dragSource()]), ['A-08'], 'schema.analysis-v2');
  assert.ok((checkOf(report, 'A-08').affected ?? []).includes('/componentPlan/1/componentId'));
  // Two premiums:
  const b = clone(usableAnalysis());
  b.componentPlan = [
    { componentId: 'projectile-v1', pedagogicalReason: 'Models the thrown object motion on the page.', focusQuote: 'drag D is equal to the drag coefficient Cd times the density rho', focusSourceId: 'nasa-grc-drag-equation' },
    { componentId: 'lift-equation-v1', pedagogicalReason: 'Models the lift relation stated on the page.', focusQuote: 'Drag depends on the density of the air', focusSourceId: 'nasa-grc-drag-equation' },
  ];
  assert.ok(failedIds(validateAnalysisV2(b, [dragSource()])).includes('A-08'));
  // A repeated focusQuote region violates R-PLAN-6:
  const c = clone(usableAnalysis());
  c.componentPlan[1]!.focusQuote = c.componentPlan[0]!.focusQuote;
  assert.ok(failedIds(validateAnalysisV2(c, [dragSource()])).includes('A-08'));
});

test('A-09: publisher names, name acronyms and the frozen generic phrases are rejected', () => {
  const a = clone(usableAnalysis());
  a.overview.headline = 'According to NASA, drag rises with speed squared and density.';
  const report = expectFailures(validateAnalysisV2(a, [dragSource()]), ['A-09'], 'schema.analysis-v2');
  assert.deepEqual(checkOf(report, 'A-09').affected, ['/overview/headline']);
  const b = clone(usableAnalysis());
  b.pageCoverage = 'The official page teaches the drag equation and its factors.';
  assert.ok(failedIds(validateAnalysisV2(b, [dragSource()])).includes('A-09'));
  const c = clone(usableAnalysis());
  c.overview.keyPoints[0]!.point = 'The NASA Glenn Research Center story collects the drag factors in one relation.';
  assert.ok(failedIds(validateAnalysisV2(c, [dragSource()])).includes('A-09'));
});

test('A-10: numbers in AI text must appear on the page (N-01)', () => {
  const a = clone(usableAnalysis());
  a.pageCoverage = 'The page teaches the drag equation for 123456 aircraft types.';
  const report = expectFailures(validateAnalysisV2(a, [dragSource()]), ['A-10'], 'schema.analysis-v2');
  assert.deepEqual(checkOf(report, 'A-10').affected, ['/pageCoverage']);
  // A number that IS on the page passes: the drag page prints "V^2" and the equation numbers.
  const b = clone(usableAnalysis());
  b.overview.keyPoints[0]!.point = 'The drag equation collects density, speed, area and coefficient, with velocity squared (V^2), in one relation.';
  assert.equal(checkOf(validateAnalysisV2(b, [dragSource()]), 'A-10').passed, true);
});

test('A-11: markup, URLs and control characters are rejected in AI text', () => {
  const a = clone(usableAnalysis());
  a.overview.headline = 'Drag rises with speed squared — see <b>density</b> and area.';
  assert.ok(failedIds(validateAnalysisV2(a, [dragSource()])).includes('A-11'));
  const b = clone(usableAnalysis());
  b.overview.keyPoints[0]!.point = 'The drag equation is described at https://example.com/drag in one relation.';
  assert.ok(failedIds(validateAnalysisV2(b, [dragSource()])).includes('A-11'));
  const c = clone(usableAnalysis());
  c.overview.keyTerms[0]!.gloss = 'Single number collecting **shape** and flow effects.';
  assert.ok(failedIds(validateAnalysisV2(c, [dragSource()])).includes('A-11'));
  // Quotes are verbatim source text and EXEMPT from the plain-text rule.
  assert.equal(checkOf(validateAnalysisV2(usableAnalysis(), [dragSource()]), 'A-11').passed, true);
});

/* ------------------------------------------------------------------ */
/* A-09 on every real source (addendum: tested before freezing)        */
/* ------------------------------------------------------------------ */

const NEUTRAL_TEXTS = [
  'The page teaches the drag equation and which factors change drag.',
  'Drag rises with speed squared, density, area and coefficient.',
  'One coefficient packs the complex shape and flow effects together.',
  'Interest compounds monthly over ten years and raises the balance.',
  'The Constitution was drafted in secret by delegates to a convention.',
  'Heterozygous individuals carry two different alleles at a locus.',
  'In the troposphere the temperature decreases linearly with altitude.',
  'A quorum of seven states was obtained before any vote could proceed.',
  'Students predict the outcome before the answer is revealed in class.',
  'The population frequency of the allele stays constant across generations.',
  'Water vapor rises, cools, condenses into clouds and falls as rain.',
  'A short stub mentioning an equation without explanation.',
];

test('A-09 publisher tokens: no false rejects on ordinary text for ANY real source', () => {
  const ids = listSourceIds();
  assert.ok(ids.length >= 20, `expected the real source corpus, got ${ids.length}`);
  const all = mergePublisherTokens(ids.map(id => publisherTokensOf(loadSourceMeta(id))));
  assert.ok(all.nameAcronyms.has('nasa'), 'the NASA acronym must be a token of the GRC sources');
  for (const text of NEUTRAL_TEXTS) {
    assert.equal(findPublisherClaim(text, all), null, `false reject on ordinary text: "${text}"`);
  }
  // Per-source too (each source's own metadata):
  for (const id of ids) {
    const tokens = publisherTokensOf(loadSourceMeta(id));
    for (const text of NEUTRAL_TEXTS) {
      assert.equal(findPublisherClaim(text, tokens), null, `false reject for ${id}: "${text}"`);
    }
  }
});

test('A-09 publisher tokens: real publisher claims are caught', () => {
  const byId = new Map(listSourceIds().map(id => [id, publisherTokensOf(loadSourceMeta(id))]));
  const drag = byId.get('nasa-grc-drag-equation');
  assert.ok(drag !== undefined);
  assert.notEqual(findPublisherClaim('NASA states that drag rises with speed.', drag), null);
  assert.notEqual(findPublisherClaim('According to NASA, drag rises.', drag), null);
  assert.notEqual(findPublisherClaim('The NASA Glenn Research Center explains drag.', drag), null);
  assert.notEqual(findPublisherClaim('This is endorsed by the authors.', drag), null);
  // Narrowed matching (2026-10-30, same rule as the kit sweep): an ordinary single word of the
  // publisher name and a bare "according to" are NOT claims.
  assert.equal(findPublisherClaim('The Glenn center explains drag.', drag), null);
  assert.equal(findPublisherClaim('According to the page, drag rises.', drag), null);
  const nara = byId.get('nara-constitution');
  assert.ok(nara !== undefined);
  assert.notEqual(findPublisherClaim('The National Archives and Records Administration presents this document.', nara), null);
  const nij = byId.get('nij-heterozygosity');
  assert.ok(nij !== undefined);
  assert.notEqual(findPublisherClaim('NIJ reports heterozygosity levels.', nij), null);
});

test('A-09: every AI-written field of the golden fixtures is publisher-claim free', () => {
  const all = mergePublisherTokens(listSourceIds().map(id => publisherTokensOf(loadSourceMeta(id))));
  const fields: string[] = [];
  for (const a of [usableAnalysis(), declinedAnalysis()]) {
    fields.push(a.pageCoverage, a.declineSummary, a.overview.headline);
    for (const kp of a.overview.keyPoints) fields.push(kp.point);
    for (const kt of a.overview.keyTerms) fields.push(kt.term, kt.gloss);
    for (const e of a.componentPlan) fields.push(e.pedagogicalReason);
  }
  for (const f of fields) {
    assert.equal(findPublisherClaim(f, all), null, `golden field rejected: "${f}"`);
  }
});

/* ------------------------------------------------------------------ */
/* v2 repair comparison                                                */
/* ------------------------------------------------------------------ */

function brokenBaseline(): SourceAnalysisV2 {
  const a = clone(usableAnalysis());
  a.overview.keyPoints[0]!.quote = 'A fabricated sentence that never appeared on the drag page.';
  return a;
}

test('repair: fixing exactly the affected quote passes the comparator', () => {
  const baseline = brokenBaseline();
  const next = clone(usableAnalysis());
  const check = compareAnalysisV2Revisions(baseline, next, { sources: [dragSource()] });
  assert.equal(check.passed, true, check.message);
  assert.equal(check.id, 'repair.no-weakening');
});

test('repair: a change outside the revision-1 affected paths is rejected', () => {
  const baseline = brokenBaseline();
  const next = clone(usableAnalysis());
  next.overview.headline = 'A completely new headline about drag and speed.';
  const check = compareAnalysisV2Revisions(baseline, next, { sources: [dragSource()] });
  assert.equal(check.passed, false);
  assert.match(check.message, /\/overview\/headline changed/);
});

test('repair: dropping or adding list items is a structural violation (ids stable)', () => {
  const baseline = brokenBaseline();
  const next = clone(usableAnalysis());
  next.overview.keyPoints.pop();
  const check = compareAnalysisV2Revisions(baseline, next, { sources: [dragSource()] });
  assert.equal(check.passed, false);
  assert.match(check.message, /list length|shape/);
});

test('repair: flipping usable to false to escape a quote finding is rejected', () => {
  const baseline = brokenBaseline();
  const next = clone(usableAnalysis());
  next.usable = false;
  next.declineCode = 'no-teachable-content';
  next.declineSummary = 'A decline invented to escape the fabricated-quote finding.';
  next.overview = { headline: '', keyPoints: [], keyTerms: [] };
  next.componentPlan = [];
  const check = compareAnalysisV2Revisions(baseline, next, { sources: [dragSource()] });
  assert.equal(check.passed, false);
  assert.match(check.message, /declining the source|outside the affected paths/);
});

test('repair: caller findings may only NARROW the recomputed authority', () => {
  const baseline = brokenBaseline();
  const next = clone(usableAnalysis());
  // A finding without affected paths unlocks nothing (consistent narrowing):
  const narrowed = compareAnalysisV2Revisions(baseline, next, {
    sources: [dragSource()],
    findings: [{ id: 'A-05', kind: 'grounding', message: 'fabricated quote' }],
  });
  assert.equal(narrowed.passed, false);
  // The exact recomputed path keeps the repair authorized:
  const exact = compareAnalysisV2Revisions(baseline, next, {
    sources: [dragSource()],
    findings: [{ id: 'A-05', kind: 'grounding', message: 'fabricated quote', affected: ['/overview/keyPoints/0/quote'] }],
  });
  assert.equal(exact.passed, true, exact.message);
  // A finding naming a check that passed on recomputation unlocks nothing:
  const wrongCheck = compareAnalysisV2Revisions(baseline, next, {
    sources: [dragSource()],
    findings: [{ id: 'A-10', kind: 'grounding', message: 'x', affected: ['/overview/keyPoints/0/quote'] }],
  });
  assert.equal(wrongCheck.passed, false);
});

test('repair: without sources the comparator fails closed on any change', () => {
  const baseline = brokenBaseline();
  const next = clone(usableAnalysis());
  assert.equal(compareAnalysisV2Revisions(baseline, next, {}).passed, false);
  assert.equal(compareAnalysisV2Revisions(baseline, clone(baseline), {}).passed, true); // identical: nothing to authorize
});

test('repair: an id may be renamed only where the authority names the id itself', () => {
  const baseline = clone(usableAnalysis());
  baseline.overview.keyPoints[0]!.quote = 'A fabricated sentence that never appeared on the drag page.';
  baseline.overview.keyPoints[0]!.id = 'Bad ID'; // A-07 names /overview/keyPoints/0/id
  const authority = analysisV2RepairAuthority(baseline, [dragSource()]);
  assert.ok(authority.allowed.includes('/overview/keyPoints/0/id'));
  const next = clone(usableAnalysis()); // good quote, id 'drag-equation'
  const ok = compareAnalysisV2Revisions(baseline, next, { sources: [dragSource()] });
  assert.equal(ok.passed, true, ok.message);
  // Renaming to ANOTHER baseline id of the same list impersonates a preserved item
  // ('density' alone would be fine: ids are list-scoped and keyTerms legitimately reuses ids):
  const bad = clone(next);
  bad.overview.keyPoints[0]!.id = 'drag-coefficient';
  const check = compareAnalysisV2Revisions(baseline, bad, { sources: [dragSource()] });
  assert.equal(check.passed, false);
  assert.match(check.message, /impersonate/);
});

test('repair authority helper recomputes from revision 1', () => {
  const { report, allowed } = analysisV2RepairAuthority(brokenBaseline(), [dragSource()]);
  assert.deepEqual(allowed, affectedPathsOf(report));
  // The fabricated quote is named by A-05; since the gate also runs OV-06 (S6R-01) the point that
  // no longer overlaps the fabricated quote joins the same recomputed authority.
  assert.deepEqual([...allowed].sort(), ['/overview/keyPoints/0/point', '/overview/keyPoints/0/quote']);
});
