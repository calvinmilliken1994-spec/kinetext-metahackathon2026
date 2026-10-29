// TASK-020 — timeline-v1 fixtures: the real Declaration spec (assembled from tests/fixtures with the
// licensed NARA source) plus two synthetic sources/specs whose texts are ORIGINAL, authored for this
// repository. The synthetic specs are designed so single mutations fail exactly one check:
// - harbor: an approximate-date sentence ("circa 1895") and a second July 1, 1889 sentence for the
//   duplicate-date mutation; two events borrow the year from the "(1889)" title.
// - treaty: a BCE event ("500 B.C."), year-only events, and a month-only event that shares its year
//   with a year-only event (the ambiguous-pair mutation at shared precision).
import { readFileSync } from 'node:fs';

import { assembleTimelineSpec } from '../../contracts/index.ts';
import type {
  Provenance,
  SourceDocument,
  TimelineActivitySpec,
  TimelineGeneratedSpec,
} from '../../contracts/index.ts';
import { loadSource, sha256 } from '../../sources/index.ts';

const EXECUTION = { maxWallTimeMs: 2000, maxRepairAttempts: 2, network: false, generatedCodeAllowed: false } as const;

function provenance(): Provenance {
  return {
    provider: 'meta',
    requestedModel: 'muse-spark-1.3',
    returnedModel: 'muse-spark-1.3',
    responseId: 'fixture-not-a-real-response',
    runId: 'contract-fixture',
    promptVersion: 'fixture',
    revision: 1,
    repairOf: null,
    generatedAt: '2026-10-28T00:00:00.000Z',
  };
}

/* ------------------------------------------------------------------ */
/* The real Declaration of Independence (NARA) — title-year rule       */
/* ------------------------------------------------------------------ */

/** Assembled timeline spec over the real licensed NARA source (title "Declaration of Independence (1776)"). */
export function declarationSpecAndSource(): { spec: TimelineActivitySpec; source: SourceDocument } {
  const gen = JSON.parse(
    readFileSync(new URL('../../../tests/fixtures/timeline.declaration.gen.json', import.meta.url), 'utf8'),
  ) as TimelineGeneratedSpec;
  const prov = JSON.parse(
    readFileSync(new URL('../../../tests/fixtures/provenance.fixture.json', import.meta.url), 'utf8'),
  ) as Provenance;
  const source = loadSource('nara-declaration-of-independence');
  return {
    spec: assembleTimelineSpec(gen, { id: 'tl-declaration-fixture', sources: [source], provenance: prov }),
    source,
  };
}

/* ------------------------------------------------------------------ */
/* Synthetic: The Harbor Survey (1889)                                 */
/* ------------------------------------------------------------------ */

export const HARBOR_SOURCE_ID = 'fixture-harbor-timeline';

export const HARBOR_TEXT =
  '# The Harbor Survey (1889)\n' +
  '\n' +
  'The survey office opened on March 3, 1889 in the old customs house. Field crews began mapping the ' +
  'north shore on April 14. The first beacon was lit on July 1, 1889 after the tower was completed. ' +
  'The customs office reopened on July 1, 1889 after repairs. A storm delayed the seawall, which was ' +
  'finished on November 30. The final report was signed on February 9, 1890 and mailed to the ' +
  'capital. A later hand dated the margin notes circa 1895. The clerk\'s diary also mentions funding ' +
  'bills from the 1880s, and the crew debated about taxation without recording new dates.\n';

export function harborSourceDoc(): SourceDocument {
  return {
    id: HARBOR_SOURCE_ID,
    title: 'The Harbor Survey (1889)',
    locator: 'packages/validation/fixtures/timeline-specs.ts',
    license: 'CC0-1.0',
    attribution: 'Original test text authored for this repository; dedicated CC0-1.0.',
    sha256: sha256(HARBOR_TEXT),
    text: HARBOR_TEXT,
  };
}

function harborGen(): TimelineGeneratedSpec {
  const ev = (id: string, label: string, year: number, month: number, day: number, quote: string) => ({
    id,
    label,
    year,
    month,
    day,
    evidence: [{ sourceId: HARBOR_SOURCE_ID, quote }],
  });
  return {
    title: 'Ordering the Harbor Survey',
    learningObjectives: ['Put the main steps of the harbor survey in chronological order.'],
    explanations: [
      {
        id: 'survey-sequence',
        text: 'The survey ran from opening the office, through mapping and building, to signing the final report.',
        evidence: [{ sourceId: HARBOR_SOURCE_ID, quote: 'The first beacon was lit on July 1, 1889 after the tower was completed.' }],
      },
    ],
    simulation: {
      events: [
        ev('s1', 'Survey office opens', 1889, 3, 3, 'The survey office opened on March 3, 1889 in the old customs house.'),
        ev('s2', 'Shore mapping begins', 1889, 4, 14, 'Field crews began mapping the north shore on April 14.'),
        ev('s3', 'First beacon lit', 1889, 7, 1, 'The first beacon was lit on July 1, 1889 after the tower was completed.'),
        ev('s4', 'Seawall finished', 1889, 11, 30, 'A storm delayed the seawall, which was finished on November 30.'),
        ev('s5', 'Final report signed', 1890, 2, 9, 'The final report was signed on February 9, 1890 and mailed to the capital.'),
      ],
      scenario: { subjectLabel: 'Harbor survey', settingLabel: 'North shore' },
    },
    behavioralTests: [
      { name: 'opening-before-mapping', earlierEventId: 's1', laterEventId: 's2' },
      { name: 'mapping-before-beacon', earlierEventId: 's2', laterEventId: 's3' },
      { name: 'mapping-before-seawall', earlierEventId: 's2', laterEventId: 's4' },
    ],
    predictions: [
      {
        id: 'pred-report-after-opening',
        prompt: 'Which happened first: the survey office opening or the final report being signed?',
        earlierEventId: 's1',
        laterEventId: 's5',
      },
      {
        id: 'pred-seawall-before-report',
        prompt: 'Which came first: finishing the seawall or signing the final report?',
        earlierEventId: 's4',
        laterEventId: 's5',
      },
    ],
  };
}

export function makeHarborTimelineSpec(): TimelineActivitySpec {
  return assembleTimelineSpec(harborGen(), {
    id: 'timeline-harbor-fixture',
    sources: [harborSourceDoc()],
    provenance: provenance(),
    execution: EXECUTION,
  });
}

/* ------------------------------------------------------------------ */
/* Synthetic: The Border Treaties (1855) — BCE + year-only events      */
/* ------------------------------------------------------------------ */

export const TREATY_SOURCE_ID = 'fixture-treaty-timeline';

export const TREATY_TEXT =
  '# The Border Treaties (1855)\n' +
  '\n' +
  'An earlier border stone dates to 500 B.C. in the valley records. The first border treaty was signed ' +
  'in 1855 after long talks. The senate exchanged ratification documents in June of the signing year. ' +
  'A boundary commission began its survey in 1857. The commission published its final map in 1861. ' +
  'A follow-up conference revised the map in 1868.\n';

export function treatySourceDoc(): SourceDocument {
  return {
    id: TREATY_SOURCE_ID,
    title: 'The Border Treaties (1855)',
    locator: 'packages/validation/fixtures/timeline-specs.ts',
    license: 'CC0-1.0',
    attribution: 'Original test text authored for this repository; dedicated CC0-1.0.',
    sha256: sha256(TREATY_TEXT),
    text: TREATY_TEXT,
  };
}

function treatyGen(): TimelineGeneratedSpec {
  const ev = (id: string, label: string, year: number, month: number, day: number, quote: string) => ({
    id,
    label,
    year,
    month,
    day,
    evidence: [{ sourceId: TREATY_SOURCE_ID, quote }],
  });
  return {
    title: 'Ordering the Border Treaties',
    learningObjectives: ['Order the border-treaty milestones from the earliest record to the revised map.'],
    explanations: [
      {
        id: 'treaty-sequence',
        text: 'The valley records run from an early border stone through the first treaty, its ratification, the survey and two map milestones.',
        evidence: [{ sourceId: TREATY_SOURCE_ID, quote: 'The first border treaty was signed in 1855 after long talks.' }],
      },
    ],
    simulation: {
      events: [
        ev('b0', 'Border stone dated', -500, 0, 0, 'An earlier border stone dates to 500 B.C. in the valley records.'),
        ev('b1', 'First border treaty signed', 1855, 0, 0, 'The first border treaty was signed in 1855 after long talks.'),
        ev('b2', 'Ratification exchanged', 1855, 6, 0, 'The senate exchanged ratification documents in June of the signing year.'),
        ev('b3', 'Boundary survey begins', 1857, 0, 0, 'A boundary commission began its survey in 1857.'),
        ev('b4', 'Final map published', 1861, 0, 0, 'The commission published its final map in 1861.'),
        ev('b5', 'Map revised by conference', 1868, 0, 0, 'A follow-up conference revised the map in 1868.'),
      ],
      scenario: { subjectLabel: 'Border treaties', settingLabel: 'The river valley' },
    },
    behavioralTests: [
      { name: 'stone-before-treaty', earlierEventId: 'b0', laterEventId: 'b1' },
      { name: 'treaty-before-map', earlierEventId: 'b1', laterEventId: 'b4' },
      { name: 'map-before-revision', earlierEventId: 'b4', laterEventId: 'b5' },
    ],
    predictions: [
      {
        id: 'pred-ratification-before-survey',
        prompt: 'Which happened first: the ratification exchange or the boundary survey?',
        earlierEventId: 'b2',
        laterEventId: 'b3',
      },
      {
        id: 'pred-survey-before-map',
        prompt: 'Which came first: the survey beginning or the final map?',
        earlierEventId: 'b3',
        laterEventId: 'b4',
      },
    ],
  };
}

export function makeTreatyTimelineSpec(): TimelineActivitySpec {
  return assembleTimelineSpec(treatyGen(), {
    id: 'timeline-treaty-fixture',
    sources: [treatySourceDoc()],
    provenance: provenance(),
    execution: EXECUTION,
  });
}
