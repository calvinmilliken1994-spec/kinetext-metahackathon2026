// Web-side fixtures: hand-written VALID specs for the three non-physics engines (compound interest,
// Hardy-Weinberg, half-life). packages/validation/fixtures only carries the physics engines, and the web
// workspace may not edit packages/, so these live here. Browser-safe (no node imports); engine-fixtures.test.ts
// proves they pass the real validator, so UI tests and local previews run on specs that are genuinely valid.
// Source texts are original, authored for this repository (CC0-1.0). sha256 values are pinned literals.
import type {
  CompoundInterestActivitySpec, HalfLifeActivitySpec, HardyWeinbergActivitySpec, SourceDocument,
} from '../../../../packages/contracts/index.ts';

const EXECUTION = { maxWallTimeMs: 2000, maxRepairAttempts: 2, network: false, generatedCodeAllowed: false } as const;

function provenance() {
  return {
    provider: 'meta' as const,
    requestedModel: 'muse-spark-1.3',
    returnedModel: 'muse-spark-1.3',
    responseId: 'web-fixture-not-a-real-response',
    runId: 'web-fixture',
    promptVersion: 'fixture',
    revision: 1,
    repairOf: null,
    generatedAt: '2026-10-28T00:00:00.000Z',
  };
}

const LOCATOR = 'apps/web/src/lib/engine-fixtures.ts';
const ATTRIBUTION = 'Original test text authored for this repository; dedicated CC0-1.0.';

export const COMPOUND_TEXT =
  'Compound interest is interest earned on both the original amount and the interest already added. ' +
  'A balance of $1,000 at 5 percent interest compounded once a year grows to $1,628.89 after 10 years. ' +
  'Compounding more often each year makes the balance grow slightly faster.\n';
export const COMPOUND_SHA256 = 'fcf14ebad0b00caf8cd8563ad0f6ec70179ccb0b8c48173947290fd3fd6ecc00';

export const HARDY_WEINBERG_TEXT =
  'In a population in Hardy-Weinberg equilibrium with two alleles, the allele frequencies p and q add up to 1. ' +
  'The expected genotype frequencies are p squared, 2pq and q squared. ' +
  'The heterozygote frequency 2pq is largest, 0.5, when p equals 0.5.\n';
export const HARDY_WEINBERG_SHA256 = '54398af10c0bf6ceb8621b2f29d94dad930167c68a30be07a8cdd2cefba5c560';

export const HALF_LIFE_TEXT =
  'After one half-life, half of a radioactive sample remains. After two half-lives, one quarter remains, and after three, one eighth. ' +
  'The amount left is the starting amount times one half raised to the number of half-lives that have passed.\n';
export const HALF_LIFE_SHA256 = 'e1c58f47c4b8b829f72c18ba772b763efc06604d268d17fb6a0540a0bca6392d';

export function compoundSourceDoc(): SourceDocument {
  return {
    id: 'web-fixture-compound-source', title: 'Compound interest fixture source', locator: LOCATOR,
    license: 'CC0-1.0', attribution: ATTRIBUTION, sha256: COMPOUND_SHA256, text: COMPOUND_TEXT,
  };
}
export function hardyWeinbergSourceDoc(): SourceDocument {
  return {
    id: 'web-fixture-hw-source', title: 'Hardy-Weinberg fixture source', locator: LOCATOR,
    license: 'CC0-1.0', attribution: ATTRIBUTION, sha256: HARDY_WEINBERG_SHA256, text: HARDY_WEINBERG_TEXT,
  };
}
export function halfLifeSourceDoc(): SourceDocument {
  return {
    id: 'web-fixture-half-life-source', title: 'Half-life fixture source', locator: LOCATOR,
    license: 'CC0-1.0', attribution: ATTRIBUTION, sha256: HALF_LIFE_SHA256, text: HALF_LIFE_TEXT,
  };
}

function sourceRef(d: SourceDocument) {
  return { id: d.id, title: d.title, locator: d.locator, license: d.license, attribution: d.attribution, sha256: d.sha256 };
}

/** 1000 @ 5% yearly 10y -> 1628.894626777442; 2000 @ 6% monthly 5y -> 2697.700305098615; 1000 @ 5% daily 10y -> 1648.6648137652346. */
export function makeCompoundInterestSpec(): CompoundInterestActivitySpec {
  const src = compoundSourceDoc();
  return structuredClone({
    schemaVersion: '0.3.0',
    id: 'compound-web-fixture',
    title: 'Compound interest: how a balance grows',
    learningObjectives: ['Predict how a balance grows when interest is added to the interest already earned.'],
    sources: [sourceRef(src)],
    explanations: [
      {
        id: 'interest-on-interest',
        text: 'Each period the interest is calculated on the whole balance, including interest already added.',
        evidence: [{ sourceId: src.id, quote: 'Compound interest is interest earned on both the original amount and the interest already added' }],
      },
      {
        id: 'more-often',
        text: 'Adding interest more often makes the balance grow slightly faster.',
        evidence: [{ sourceId: src.id, quote: 'Compounding more often each year makes the balance grow slightly faster' }],
      },
    ],
    simulation: {
      engine: 'compound-interest-v1',
      equation: 'A=P*(1+r/(100*n))^(n*t)',
      principalUSD: { unit: 'USD', min: 100, max: 10000, default: 1000 },
      annualRatePercent: { unit: '%', min: 0, max: 15, default: 5 },
      compoundsPerYear: { unit: 'per year', min: 1, max: 365, default: 1 },
      years: { unit: 'years', min: 1, max: 40, default: 10 },
      scenario: { objectLabel: 'Savings account', settingLabel: 'Fixed annual rate' },
    },
    behavioralTests: [
      { name: 'worked example from the source', principalUSD: 1000, annualRatePercent: 5, compoundsPerYear: 1, years: 10, expectedAmountUSD: 1628.89, tolerance: 0.01 },
      { name: 'monthly compounding', principalUSD: 2000, annualRatePercent: 6, compoundsPerYear: 12, years: 5, expectedAmountUSD: 2697.7, tolerance: 0.01 },
    ],
    predictions: [
      {
        id: 'ten-years-yearly',
        prompt: 'You put $1,000 in an account paying 5% a year, compounded once a year. How much is in it after 10 years?',
        principalUSD: 1000, annualRatePercent: 5, compoundsPerYear: 1, years: 10, expectedAmountUSD: 1628.89, tolerance: 0.01,
      },
      {
        id: 'daily-compounding',
        prompt: 'The same $1,000 at 5% is now compounded every day. What is the balance after 10 years?',
        principalUSD: 1000, annualRatePercent: 5, compoundsPerYear: 365, years: 10, expectedAmountUSD: 1648.66, tolerance: 0.01,
      },
    ],
    execution: EXECUTION,
    provenance: provenance(),
  } satisfies CompoundInterestActivitySpec);
}

/** p=0.3 -> 2pq 0.42; p=0.5 -> 0.5; p=0.9 -> 0.18 (0.17999999999999997). */
export function makeHardyWeinbergSpec(): HardyWeinbergActivitySpec {
  const src = hardyWeinbergSourceDoc();
  return structuredClone({
    schemaVersion: '0.3.0',
    id: 'hardy-weinberg-web-fixture',
    title: 'Hardy-Weinberg: genotype frequencies from allele frequencies',
    learningObjectives: ['Predict how common heterozygotes are when you know the allele frequencies.'],
    sources: [sourceRef(src)],
    explanations: [
      {
        id: 'genotype-frequencies',
        text: 'With allele frequencies p and q, the genotype frequencies are p squared, 2pq and q squared.',
        evidence: [{ sourceId: src.id, quote: 'The expected genotype frequencies are p squared, 2pq and q squared' }],
      },
      {
        id: 'peak',
        text: 'Heterozygotes are most common, at 0.5, when the two alleles are equally frequent.',
        evidence: [{ sourceId: src.id, quote: 'The heterozygote frequency 2pq is largest, 0.5, when p equals 0.5' }],
      },
    ],
    simulation: {
      engine: 'hardy-weinberg-v1',
      equation: '2pq, q=1-p',
      alleleFrequencyP: { unit: '1', min: 0, max: 1, default: 0.3 },
      scenario: { objectLabel: 'Flower colour gene', settingLabel: 'Large random-mating population' },
    },
    behavioralTests: [
      { name: 'uneven alleles', alleleFrequencyP: 0.3, expectedHeterozygoteFrequency: 0.42, tolerance: 0.001 },
      { name: 'even alleles give the peak', alleleFrequencyP: 0.5, expectedHeterozygoteFrequency: 0.5, tolerance: 0.001 },
    ],
    predictions: [
      {
        id: 'common-allele',
        prompt: 'In a population the first allele has frequency p = 0.9. What fraction of individuals are heterozygotes?',
        alleleFrequencyP: 0.9, expectedHeterozygoteFrequency: 0.18, tolerance: 0.001,
      },
    ],
    execution: EXECUTION,
    provenance: provenance(),
  } satisfies HardyWeinbergActivitySpec);
}

/** N0=80, T=8, t=24 -> 10; N0=200, T=10, t=30 -> 25; N0=80, T=8, t=12 -> 28.284271247461902. */
export function makeHalfLifeSpec(): HalfLifeActivitySpec {
  const src = halfLifeSourceDoc();
  return structuredClone({
    schemaVersion: '0.3.0',
    id: 'half-life-web-fixture',
    title: 'Half-life: how much is left?',
    learningObjectives: ['Predict how much of a radioactive sample remains after a given time.'],
    sources: [sourceRef(src)],
    explanations: [
      {
        id: 'halving',
        text: 'Every half-life, half of what is left disappears, so the amount falls by the same factor each time.',
        evidence: [{ sourceId: src.id, quote: 'After one half-life, half of a radioactive sample remains' }],
      },
      {
        id: 'formula',
        text: 'The remaining amount is the starting amount times one half raised to the number of half-lives passed.',
        evidence: [{ sourceId: src.id, quote: 'The amount left is the starting amount times one half raised to the number of half-lives that have passed' }],
      },
    ],
    simulation: {
      engine: 'half-life-v1',
      equation: 'N=N0*(1/2)^(t/T)',
      initialAmount: { unit: '1', min: 10, max: 200, default: 80 },
      halfLife: { unit: 'time', min: 1, max: 20, default: 8 },
      elapsedTime: { unit: 'time', min: 0, max: 80, default: 24 },
      scenario: { objectLabel: 'Radioactive sample', settingLabel: 'Sealed laboratory container' },
    },
    behavioralTests: [
      { name: 'three half-lives', initialAmount: 80, halfLife: 8, elapsedTime: 24, expectedRemaining: 10, tolerance: 0.001 },
      { name: 'one half-life', initialAmount: 100, halfLife: 5, elapsedTime: 5, expectedRemaining: 50, tolerance: 0.001 },
    ],
    predictions: [
      {
        id: 'three-half-lives',
        prompt: 'A sample starts at 200 and its half-life is 10. How much is left after 30 time units?',
        initialAmount: 200, halfLife: 10, elapsedTime: 30, expectedRemaining: 25, tolerance: 0.001,
      },
      {
        id: 'one-and-a-half',
        prompt: 'A sample starts at 80 with a half-life of 8. How much is left after 12 time units?',
        initialAmount: 80, halfLife: 8, elapsedTime: 12, expectedRemaining: 28.284, tolerance: 0.001,
      },
    ],
    execution: EXECUTION,
    provenance: provenance(),
  } satisfies HalfLifeActivitySpec);
}
