// Fixture threshold specs for the W-B engine harness (?engine-demo=b) and tests. Pure: the golden gen JSON is passed in.
// Hand-written fixture data quoting real library pages exactly (tests check every quote against data/sources), NOT model
// output. The two-stage spec is a labelled synthetic layout check (no real page states two stages with their totals).

import { assembleKitSpec, kitSpecId } from '../../../../packages/contracts/kit.ts';
import type { ThresholdGen, ThresholdSpec } from '../../../../packages/contracts/kit.ts';
import type { Provenance, SourceDocument } from '../../../../packages/contracts/index.ts';

export const ELECTORAL_SOURCE = 'nara-what-is-the-electoral-college';
export const AMENDMENT_SOURCE = 'nara-constitutional-amendment-process';

/** NARA "What is the Electoral College?": 270 of 538, a majority. */
export const electoralGen: ThresholdGen = {
  schemaVersion: 'threshold-v1',
  title: 'Electing the President',
  stages: [{
    id: 'electors', body: 'electoral votes', total: 538, rule: 'majority', numerator: 0, denominator: 0, statedCount: 270,
    sourceId: ELECTORAL_SOURCE,
    quote: 'A majority of 270 electoral votes is required to elect the President.',
    totalQuote: 'The Electoral College consists of 538 electors.',
  }],
  scenarios: [
    { id: 'close', label: 'A close race', yes: [269] },
    { id: 'narrow', label: 'A narrow win', yes: [270] },
    { id: 'landslide', label: 'A landslide', yes: [365] },
  ],
};

/** The golden amendment fixture with three try-it scenarios (the golden has one). */
export function amendmentWithScenarios(golden: ThresholdGen): ThresholdGen {
  return {
    ...golden,
    title: 'Ratifying an amendment',
    scenarios: [
      { id: 'thirty-five', label: 'Most states agree', yes: [35] },
      { id: 'thirty-eight', label: 'Just enough states', yes: [38] },
      { id: 'all', label: 'Every state agrees', yes: [50] },
    ],
  };
}

/** Synthetic two-stage layout check (labelled as such in the harness): both stages must pass. */
export const twoStageGen: ThresholdGen = {
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

export interface ThresholdDemo { id: string; tab: string; note: string; spec: ThresholdSpec; sourceId: string }

export function buildThresholdDemos(golden: ThresholdGen, provenance: Provenance, sources: Record<string, SourceDocument>): ThresholdDemo[] {
  const make = (gen: ThresholdGen, job: string, sourceId: string, seed: number): ThresholdSpec => {
    const doc = sources[sourceId];
    return assembleKitSpec(gen, 'threshold-v1', { id: kitSpecId(job, 'threshold-v1', 1), sources: doc === undefined ? [] : [doc], provenance, seed });
  };
  return [
    { id: 'electoral', tab: 'Electoral College (270 of 538)', note: 'NARA: a majority of 538 electoral votes. 538 seats are drawn as a bar.', spec: make(electoralGen, 'demo-electoral', ELECTORAL_SOURCE, 3), sourceId: ELECTORAL_SOURCE },
    { id: 'amendment', tab: 'Amendment (¾ of 50 states)', note: 'NARA: three-fourths of the States (38 of 50). 50 states are drawn as units.', spec: make(amendmentWithScenarios(golden), 'demo-amendment', AMENDMENT_SOURCE, 5), sourceId: AMENDMENT_SOURCE },
    { id: 'golden', tab: 'Golden fixture', note: 'tests/fixtures/stage6/threshold.gen.json as committed (one scenario).', spec: make(golden, 'demo-threshold-golden', AMENDMENT_SOURCE, 7), sourceId: AMENDMENT_SOURCE },
    { id: 'two-stage', tab: 'Two stages (synthetic)', note: 'Synthetic text, not a real page: a layout check for a vote with two stages.', spec: make(twoStageGen, 'demo-two-stage', 'synthetic-two-stage', 9), sourceId: 'synthetic-two-stage' },
  ];
}
