// Fixture data-table specs for the W-B engine harness (?engine-demo=b) and tests. Pure: the golden gen JSON is passed in.
// Hand-written fixture data quoting real library pages exactly (tests check every quote against data/sources), NOT model
// output.

import { assembleKitSpec, kitSpecId } from '../../../../packages/contracts/kit.ts';
import type { DataCellGen, DataTableGen, DataTableSpec } from '../../../../packages/contracts/kit.ts';
import type { Provenance, SourceDocument } from '../../../../packages/contracts/index.ts';

export const IRS_SOURCE = 'irs-tax-inflation-adjustments-2026';
export const FED_SOURCE = 'federalreserve-open-market-operations';
export const PLANETS_SOURCE = 'nasa-nssdc-planetary-fact-sheet-metric';

const irs = (value: string, quote: string): DataCellGen => ({ value, sourceId: IRS_SOURCE, quote });

/**
 * IRS tax year 2026 marginal rates for single filers (and the joint figures beside them). The page gives the lowest rate
 * as "10% … $12,400 or less", which has no "over" threshold, so the schedule here starts at the 12% bracket and the
 * calculator shows income below $12,400 as outside this table.
 */
export const irsGen: DataTableGen = {
  schemaVersion: 'data-table-v1',
  title: 'Marginal tax rates for tax year 2026',
  labelHeader: 'Bracket',
  columns: [
    { header: 'rate', unit: '%', numeric: true, sourceId: IRS_SOURCE, quote: 'For tax year 2026, the top tax rate remains 37% for individual single taxpayers with incomes greater than $640,600' },
    { header: 'single taxpayers', unit: '$', numeric: true, sourceId: IRS_SOURCE, quote: 'For tax year 2026, the top tax rate remains 37% for individual single taxpayers with incomes greater than $640,600' },
    { header: 'married couples filing jointly', unit: '$', numeric: true, sourceId: IRS_SOURCE, quote: '35% for incomes over $256,225 ($512,450 for married couples filing jointly)' },
  ],
  rows: [
    ['12%', '$12,400', '$24,800', '12% for incomes over $12,400 ($24,800 for married couples filing jointly)'],
    ['22%', '$50,400', '$100,800', '22% for incomes over $50,400 ($100,800 for married couples filing jointly)'],
    ['24%', '$105,700', '$211,400', '24% for incomes over $105,700 ($211,400 for married couples filing jointly)'],
    ['32%', '$201,775', '$403,550', '32% for incomes over $201,775 ($403,550 for married couples filing jointly)'],
    ['35%', '$256,225', '$512,450', '35% for incomes over $256,225 ($512,450 for married couples filing jointly)'],
    ['37%', '$640,600', '$768,700', '37% for individual single taxpayers with incomes greater than $640,600 ($768,700 for married couples filing jointly)'],
  ].map(([rate, single, joint, quote]) => ({
    label: rate as string, sourceId: IRS_SOURCE, quote: quote as string,
    values: [irs(rate as string, quote as string), irs(single as string, quote as string), irs(joint as string, quote as string)],
  })),
  questions: [
    { id: 'rate-over-105700', kind: 'lookup', rowIndex: 2, columnIndex: 1 },
    { id: 'top-threshold', kind: 'largest', rowIndex: -1, columnIndex: 1 },
  ],
  chartColumnIndex: -1,
  brackets: { enabled: true, rateColumnIndex: 0, overColumnIndex: 1, exampleIncome: 100000 },
};

const FED_HEAD = 'Date | Increase | Decrease | Level (%)';
const fed = (value: string, quote: string): DataCellGen => ({ value, sourceId: FED_SOURCE, quote });

/** Federal Reserve: the FOMC target-range changes listed under 2022 (basis points), as printed. */
export const fedGen: DataTableGen = {
  schemaVersion: 'data-table-v1',
  title: 'Target federal funds rate changes',
  labelHeader: 'Date',
  columns: [
    { header: 'Increase', unit: 'basis points', numeric: true, sourceId: FED_SOURCE, quote: FED_HEAD },
    { header: 'Decrease', unit: 'basis points', numeric: true, sourceId: FED_SOURCE, quote: FED_HEAD },
    { header: 'Level (%)', unit: '', numeric: false, sourceId: FED_SOURCE, quote: FED_HEAD },
  ],
  rows: [
    ['December 15', '50', '0', '4.25-4.50'],
    ['November 3', '75', '0', '3.75-4.00'],
    ['September 22', '75', '0', '3.00-3.25'],
    ['July 28', '75', '0', '2.25-2.50'],
    ['June 16', '75', '0', '1.50-1.75'],
    ['May 5', '50', '0', '0.75-1.00'],
    ['March 17', '25', '0', '0.25-0.50'],
  ].map(([date, up, down, level]) => {
    const quote = `${date} | ${up} | ${down} | ${level}`;
    return { label: date as string, sourceId: FED_SOURCE, quote, values: [fed(up as string, quote), fed(down as string, quote), fed(level as string, quote)] };
  }),
  questions: [
    { id: 'smallest-increase', kind: 'smallest', rowIndex: -1, columnIndex: 0 },
    { id: 'level-november', kind: 'lookup', rowIndex: 1, columnIndex: 2 },
  ],
  chartColumnIndex: 0,
  brackets: { enabled: false, rateColumnIndex: -1, overColumnIndex: -1, exampleIncome: 0 },
};

export interface DataTableDemo { id: string; tab: string; note: string; spec: DataTableSpec; sourceId: string }

export function buildDataTableDemos(golden: DataTableGen, provenance: Provenance, sources: Record<string, SourceDocument>): DataTableDemo[] {
  const make = (gen: DataTableGen, job: string, sourceId: string, seed: number): DataTableSpec => {
    const doc = sources[sourceId];
    return assembleKitSpec(gen, 'data-table-v1', { id: kitSpecId(job, 'data-table-v1', 1), sources: doc === undefined ? [] : [doc], provenance, seed });
  };
  return [
    { id: 'irs', tab: 'IRS 2026 tax brackets', note: 'IRS tax year 2026 marginal rates with the progressive tax calculator.', spec: make(irsGen, 'demo-irs', IRS_SOURCE, 4), sourceId: IRS_SOURCE },
    { id: 'planets', tab: 'Planets (golden)', note: 'tests/fixtures/stage6/data-table.gen.json as committed: NASA planetary fact sheet.', spec: make(golden, 'demo-planets', PLANETS_SOURCE, 6), sourceId: PLANETS_SOURCE },
    { id: 'fed', tab: 'Fed rate changes', note: 'Federal Reserve FOMC target-range changes (2022 rows), with a bar chart of the increases.', spec: make(fedGen, 'demo-fed', FED_SOURCE, 8), sourceId: FED_SOURCE },
  ];
}
