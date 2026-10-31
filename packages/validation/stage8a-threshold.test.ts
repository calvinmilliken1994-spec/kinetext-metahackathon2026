// Stage 8a V-B — threshold-v1 validator tests (TH-01..TH-07, docs/specs/STAGE-8a-subject-engines.md §1c).
// Every positive gen quotes a REAL licensed library page verbatim (or is a labelled synthetic); every
// check gets at least one negative. The honest usagov-impeachment outcome is part of the suite: the
// page says "simple majority" but states no total, so a gen claiming total 435 must fail TH-02 —
// the page cannot ground it.
// Run: node --test packages/validation/stage8a-threshold.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';

import { checkIdsFor } from '../contracts/kit.ts';
import type { ThresholdGen } from '../contracts/kit.ts';
import type { SourceDocument } from '../contracts/index.ts';
import { validateKitComponent } from './kit/index.ts';
import { validateThreshold } from './kit/threshold.ts';
import { loadSource } from '../sources/index.ts';
import { checkOf, clone, expectFailures, failedIds, failureDetail, stage6Fixture, synthSource } from './fixtures/stage6.ts';

const AMENDMENT = 'nara-constitutional-amendment-process';
const ELECTORAL = 'nara-what-is-the-electoral-college';
const IMPEACH = 'usagov-impeachment';

const amendmentSource = (): SourceDocument => loadSource(AMENDMENT);
const electoralSource = (): SourceDocument => loadSource(ELECTORAL);
const impeachmentSource = (): SourceDocument => loadSource(IMPEACH);

export const goldenThreshold = (): ThresholdGen => stage6Fixture<ThresholdGen>('threshold.gen.json');

const TH_IDS = ['schema.gen', ...checkIdsFor('threshold-v1')];

/** NARA "What is the Electoral College?": "A majority of 270 electoral votes is required…" (538 electors). */
function electoralGen(): ThresholdGen {
  return {
    schemaVersion: 'threshold-v1',
    title: 'Electing the President',
    stages: [{
      id: 'electors', body: 'electoral votes', total: 538, rule: 'majority', numerator: 0, denominator: 0, statedCount: 270,
      sourceId: ELECTORAL,
      quote: 'A majority of 270 electoral votes is required to elect the President.',
      totalQuote: 'The Electoral College consists of 538 electors.',
    }],
    scenarios: [
      { id: 'one-short', label: 'One vote short of half plus one', yes: [269] },
      { id: 'narrow', label: 'A narrow win', yes: [270] },
      { id: 'landslide', label: 'A landslide', yes: [365] },
    ],
  };
}

/** The golden amendment fixture with three try-it scenarios (the committed golden has one). */
function amendmentWithScenarios(): ThresholdGen {
  return {
    ...goldenThreshold(),
    title: 'Ratifying an amendment',
    scenarios: [
      { id: 'thirty-five', label: 'Most states agree', yes: [35] },
      { id: 'thirty-eight', label: 'Just enough states', yes: [38] },
      { id: 'all', label: 'Every state agrees', yes: [50] },
    ],
  };
}

/**
 * USA.gov "How federal impeachment works": the page states the RULE ("simple majority vote") but
 * never states the House total, so a gen claiming total 435 is honest about the rule and UNGROUNDED
 * about the total — TH-02 must fail (that is the honest outcome, not a checker bug).
 */
function impeachmentGen(): ThresholdGen {
  return {
    schemaVersion: 'threshold-v1',
    title: 'Impeachment votes in the House',
    stages: [{
      id: 'house-vote', body: 'The House of Representatives', total: 435, rule: 'majority', numerator: 0, denominator: 0, statedCount: 0,
      sourceId: IMPEACH,
      quote: 'If the House adopts the articles by a simple majority vote, the official has been impeached.',
      totalQuote: 'If the House adopts the articles by a simple majority vote, the official has been impeached.',
    }],
    scenarios: [
      { id: 'passes', label: 'The articles pass', yes: [218] },
      { id: 'fails', label: 'The articles fail', yes: [200] },
    ],
  };
}

/** Labelled synthetic for the 'count' rule (no real library page states a bare count threshold with its total). */
function quorumSource(): SourceDocument {
  return synthSource('synthetic-quorum', 'Synthetic voting rules', 'The committee has 21 members. A motion carries only with 15 affirmative votes.');
}
function quorumGen(): ThresholdGen {
  return {
    schemaVersion: 'threshold-v1',
    title: 'Committee motion',
    stages: [{
      id: 'members', body: 'members', total: 21, rule: 'count', numerator: 0, denominator: 0, statedCount: 15,
      sourceId: 'synthetic-quorum',
      quote: 'A motion carries only with 15 affirmative votes.',
      totalQuote: 'The committee has 21 members.',
    }],
    scenarios: [
      { id: 'carries', label: 'Enough yes votes', yes: [15] },
      { id: 'defeated', label: 'Too few yes votes', yes: [14] },
    ],
  };
}

/** Labelled synthetic two-stage layout check (fraction then majority; both stages must pass). */
function twoStageSource(): SourceDocument {
  return synthSource(
    'synthetic-two-stage',
    'Synthetic two-stage vote',
    'A proposal needs two-thirds of the chamber. The chamber has 120 members.\n\nIt then needs a majority of the regions. There are 9 regions.',
  );
}
function twoStageGen(): ThresholdGen {
  return {
    schemaVersion: 'threshold-v1',
    title: 'Two-stage vote (synthetic layout check)',
    stages: [
      {
        id: 'chamber', body: 'members of the chamber', total: 120, rule: 'fraction', numerator: 2, denominator: 3, statedCount: 0,
        sourceId: 'synthetic-two-stage', quote: 'A proposal needs two-thirds of the chamber.', totalQuote: 'The chamber has 120 members.',
      },
      {
        id: 'regions', body: 'regions', total: 9, rule: 'majority', numerator: 0, denominator: 0, statedCount: 0,
        sourceId: 'synthetic-two-stage', quote: 'It then needs a majority of the regions.', totalQuote: 'There are 9 regions.',
      },
    ],
    scenarios: [
      { id: 'strong-chamber', label: 'Strong in the chamber, weak in the regions', yes: [90, 4] },
      { id: 'both', label: 'Enough in both', yes: [80, 5] },
    ],
  };
}

/* ------------------------------------------------------------------ */
/* Positives                                                           */
/* ------------------------------------------------------------------ */

test('golden threshold (38 = three-fourths of 50, NARA amendment process) passes every check', () => {
  const report = validateKitComponent('threshold-v1', goldenThreshold(), [amendmentSource()]);
  assert.deepEqual(report.checks.map(c => c.id), TH_IDS);
  assert.deepEqual(failedIds(report), [], failureDetail(report));
  assert.equal(report.publishable, true);
  assert.match(checkOf(report, 'TH-04').message, /38/);
});

test('electoral college (270 = majority of 538, NARA) passes; TH-04 shows the engine count', () => {
  const report = validateKitComponent('threshold-v1', electoralGen(), [electoralSource()]);
  assert.deepEqual(report.checks.map(c => c.id), TH_IDS);
  assert.deepEqual(failedIds(report), [], failureDetail(report));
  assert.match(checkOf(report, 'TH-04').message, /270/);
  assert.match(checkOf(report, 'TH-05').message, /passes/);
});

test('amendment fixture with three scenarios passes; the engine runs each scenario', () => {
  const report = validateKitComponent('threshold-v1', amendmentWithScenarios(), [amendmentSource()]);
  assert.deepEqual(failedIds(report), [], failureDetail(report));
});

test('usagov impeachment is honest about the rule and fails TH-02: the page states no total', () => {
  const report = validateKitComponent('threshold-v1', impeachmentGen(), [impeachmentSource()]);
  expectFailures(report, ['TH-02']);
  const th02 = checkOf(report, 'TH-02');
  assert.match(th02.message, /435/);
  assert.ok((th02.affected ?? []).includes('/stages/0/total'));
  assert.ok((th02.affected ?? []).includes('/stages/0/totalQuote'));
  // TH-01/TH-03 pass: the quotes are verbatim and the page really says "simple majority".
  assert.equal(checkOf(report, 'TH-01').passed, true);
  assert.equal(checkOf(report, 'TH-03').passed, true);
});

test('count rule on a synthetic page: statedCount 15 is a whole token in the quote', () => {
  const report = validateKitComponent('threshold-v1', quorumGen(), [quorumSource()]);
  assert.deepEqual(failedIds(report), [], failureDetail(report));
});

test('two-stage synthetic (two-thirds of 120, majority of 9) passes; TH-05 reports the engine outcomes', () => {
  const report = validateKitComponent('threshold-v1', twoStageGen(), [twoStageSource()]);
  assert.deepEqual(failedIds(report), [], failureDetail(report));
  assert.match(checkOf(report, 'TH-05').message, /falls short/);
});

/* ------------------------------------------------------------------ */
/* Negatives — one per check                                           */
/* ------------------------------------------------------------------ */

test('TH-01: a fabricated quote fails even when it still states the rule and the count', () => {
  const gen = clone(goldenThreshold());
  gen.stages[0]!.quote = 'A proposed amendment becomes part of the Constitution as soon as it is ratified by three-fourths of the Nations (38 of 50 Nations).';
  const report = validateKitComponent('threshold-v1', gen, [amendmentSource()]);
  expectFailures(report, ['TH-01']);
  assert.ok((checkOf(report, 'TH-01').affected ?? []).includes('/stages/0/quote'));
});

test('TH-02: a total the quote does not print fails (see also the honest impeachment case)', () => {
  const gen = clone(goldenThreshold());
  gen.stages[0]!.total = 51;
  const report = validateKitComponent('threshold-v1', gen, [amendmentSource()]);
  assert.ok(failedIds(report).includes('TH-02'), failureDetail(report));
  assert.ok((checkOf(report, 'TH-02').affected ?? []).includes('/stages/0/total'));
});

test('TH-03: a "two-thirds" quote cannot carry numerator 3 / denominator 4', () => {
  const gen = clone(goldenThreshold());
  gen.stages[0]!.quote = 'an amendment may be proposed either by the Congress with a two-thirds majority vote in both the House of Representatives and the Senate';
  const report = validateKitComponent('threshold-v1', gen, [amendmentSource()]);
  expectFailures(report, ['TH-03']);
  const affected = checkOf(report, 'TH-03').affected ?? [];
  assert.ok(affected.includes('/stages/0/quote'));
  assert.ok(affected.includes('/stages/0/numerator'));
  assert.ok(affected.includes('/stages/0/denominator'));
});

test('TH-04: statedCount 269 disagrees with the engine majority of 538 (270)', () => {
  const gen = electoralGen();
  gen.stages[0]!.statedCount = 269;
  const report = validateKitComponent('threshold-v1', gen, [electoralSource()]);
  expectFailures(report, ['TH-04']);
  const th04 = checkOf(report, 'TH-04');
  assert.match(th04.message, /269/);
  assert.match(th04.message, /270/);
  assert.ok((th04.affected ?? []).includes('/stages/0/statedCount'));
});

test('TH-05: a scenario yes count above the stage total fails', () => {
  const gen = electoralGen();
  gen.scenarios[0]!.yes = [600];
  const report = validateKitComponent('threshold-v1', gen, [electoralSource()]);
  expectFailures(report, ['TH-05']);
  assert.ok((checkOf(report, 'TH-05').affected ?? []).includes('/scenarios/0/yes'));
});

test('TH-05: two scenarios with identical yes counts fail', () => {
  const gen = electoralGen();
  gen.scenarios[1]!.yes = [269]; // same as scenarios[0]
  const report = validateKitComponent('threshold-v1', gen, [electoralSource()]);
  expectFailures(report, ['TH-05']);
});

test('TH-06: a title number that is not on the page fails N-01', () => {
  const gen = electoralGen();
  gen.title = 'The 280-vote path';
  const report = validateKitComponent('threshold-v1', gen, [electoralSource()]);
  expectFailures(report, ['TH-06']);
  assert.ok((checkOf(report, 'TH-06').affected ?? []).includes('/title'));
});

test('TH-07: nonzero numerator/denominator sentinels under a majority rule fail', () => {
  const gen = electoralGen();
  gen.stages[0]!.numerator = 1;
  gen.stages[0]!.denominator = 2;
  const report = validateKitComponent('threshold-v1', gen, [electoralSource()]);
  expectFailures(report, ['TH-07']);
  const affected = checkOf(report, 'TH-07').affected ?? [];
  assert.ok(affected.includes('/stages/0/numerator'));
  assert.ok(affected.includes('/stages/0/denominator'));
});

test('TH-07: four scenarios exceed the frozen 1-3 count (count-only Ajv violations do not short-circuit)', () => {
  const gen = electoralGen();
  gen.scenarios.push({ id: 'extra', label: 'Another try', yes: [300] });
  const report = validateKitComponent('threshold-v1', gen, [electoralSource()]);
  expectFailures(report, ['TH-07']);
  assert.ok((checkOf(report, 'TH-07').affected ?? []).includes('/scenarios'));
});

test('schema.gen: an id-like violation (bad stage id) fails the structural gate only', () => {
  const gen = clone(goldenThreshold());
  gen.stages[0]!.id = 'Stage One';
  const report = validateKitComponent('threshold-v1', gen, [amendmentSource()]);
  assert.deepEqual(failedIds(report), ['schema.gen'], failureDetail(report));
  assert.equal(report.publishable, false);
  assert.ok((checkOf(report, 'schema.gen').affected ?? []).includes('/stages/0/id'));
});

/* ------------------------------------------------------------------ */
/* Robustness                                                          */
/* ------------------------------------------------------------------ */

test('a type-invalid threshold gen short-circuits at the Ajv gate', () => {
  const broken = { schemaVersion: 'threshold-v1', title: 42, stages: [], scenarios: [] };
  const report = validateKitComponent('threshold-v1', broken, []);
  assert.equal(report.checks.length, 1);
  assert.equal(report.checks[0]?.id, 'schema.gen');
  assert.equal(report.publishable, false);
});

test('the validator never throws on junk and still emits every frozen id', () => {
  for (const junk of [null, undefined, 42, 'x', [], {}]) {
    const report = validateThreshold(junk as unknown as ThresholdGen, []);
    assert.equal(report.publishable, false);
    assert.deepEqual(report.checks.map(c => c.id), TH_IDS);
  }
});
