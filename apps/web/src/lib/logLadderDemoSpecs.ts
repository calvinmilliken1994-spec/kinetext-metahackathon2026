// Stage 8a slice W-A: a hand-written log-ladder gen for the dev harness (?engine-demo=a), shaped like Muse's output and
// quoting the USGS "pH and Water" page verbatim (data/sources/usgs-wss-ph-and-water). Fixture data written for this
// repository, NOT model output; lib/algorithmDemoSpecs.test.ts checks every quote against the stored page text.
import type { LogLadderGen } from '../../../../packages/contracts/kit.ts';

export const PH_LADDER_GEN: LogLadderGen = {
  schemaVersion: 'log-ladder-v1',
  title: 'How much more acidic? Climbing the pH scale',
  quantity: 'pH',
  factor: 10,
  factorText: '10-fold',
  effectPhrase: 'more acidic',
  increasing: false,
  sourceId: 'usgs-wss-ph-and-water',
  quote: 'pH is reported in "logarithmic units". Each number represents a 10-fold change in the acidity/basicness of the water.',
  rungs: [
    { id: 'rung-1', label: 'neutral', value: 7, sourceId: 'usgs-wss-ph-and-water', quote: 'The range goes from 0 to 14, with 7 being neutral.' },
    { id: 'rung-2', label: 'normal rainfall', value: 5.6, sourceId: 'usgs-wss-ph-and-water', quote: 'Normal rainfall has a pH of about 5.6—slightly acidic due to carbon dioxide gas from the atmosphere.' },
    { id: 'rung-3', label: 'water from an abandoned coal mine', value: 2, sourceId: 'usgs-wss-ph-and-water', quote: 'water coming out of an abandoned coal mine can have a pH of 2, which is very acidic' },
  ],
  cases: [
    { id: 'case-1', fromValue: 7, toValue: 2 },
    { id: 'case-2', fromValue: 7, toValue: 5.6 },
  ],
};
