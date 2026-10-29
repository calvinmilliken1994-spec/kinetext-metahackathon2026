// TASK-020 — timeline no-weakening rules for repair (Stage 5b plan, Muse design review disposition #6,
// simplified). Every attack below is a probe from the TASK-020 brief: changing a passing event's date,
// relabelling a passing event into a different event, adding a new event, dropping below 5 events, and
// swapping a test's pair when no finding names it. Repairs may re-ground or remove FAILING events and
// may change exactly the pairs that failed. The comparison is always against the immutable baseline.
// Run: npm test (node --test packages/validation/timeline.compare.test.ts)
import test from 'node:test';
import assert from 'node:assert/strict';

import { compareRevisions, repairFindings, validateSpec } from './validate.ts';
import {
  declarationSpecAndSource,
  harborSourceDoc,
  makeHarborTimelineSpec,
  makeTreatyTimelineSpec,
  treatySourceDoc,
} from './fixtures/timeline-specs.ts';
import { makeProjectileSpec, projectileSourceDoc } from './fixtures/engine-specs.ts';
import { sha256 } from '../sources/index.ts';
import type {
  RepairFinding,
  SourceDocument,
  TimelineActivitySpec,
  TimelineEvent,
  ValidationReport,
} from '../contracts/index.ts';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function failedIds(report: ValidationReport): string[] {
  return report.checks.filter(c => !c.passed).map(c => c.id);
}

function decl() {
  return declarationSpecAndSource();
}

/** The Declaration baseline with event e6's year corrupted to 1777 (fails timeline.date-grounded only). */
function declWithBadE6(): { spec: TimelineActivitySpec; source: SourceDocument; report: ValidationReport; findings: RepairFinding[] } {
  const { spec, source } = decl();
  spec.simulation.events[5]!.year = 1777;
  const report = validateSpec(spec, [source]);
  assert.deepEqual(failedIds(report), ['timeline.date-grounded'], 'the corrupted baseline fails exactly date grounding');
  return { spec, source, report, findings: repairFindings(report, spec) };
}

function eventsOf(spec: TimelineActivitySpec): TimelineEvent[] {
  return spec.simulation.events;
}

/* ------------------------------------------------------------------ */
/* Pass path + byte-stable message                                     */
/* ------------------------------------------------------------------ */

test('identical timeline revisions pass with the byte-stable pass message', () => {
  const { spec, source } = decl();
  const check = compareRevisions(spec, structuredClone(spec), [], { sources: [source] });
  assert.equal(check.id, 'repair.no-weakening');
  assert.equal(check.passed, true);
  assert.equal(
    check.message,
    'no weakening: engine timeline-v1 unchanged, every event that passed date grounding on the baseline keeps its id, label, date and quotes, no events were added, the event count (6) stayed within [5, 6], and every behavioral test (4) and prediction (2) keeps its (name, occurrence) identity and pair',
  );
});

test('engine changes involving timeline-v1 always fail, in both directions', () => {
  const { spec } = decl();
  const toNumeric = compareRevisions(spec, makeProjectileSpec(), []);
  assert.equal(toNumeric.passed, false);
  assert.match(toNumeric.message, /engine changed from timeline-v1 to projectile-v1/);
  const fromNumeric = compareRevisions(makeProjectileSpec(), spec, []);
  assert.equal(fromNumeric.passed, false);
  assert.match(fromNumeric.message, /engine changed from projectile-v1 to timeline-v1/);
});

test('junk timeline inputs fail closed and never throw', () => {
  const junk = { simulation: { engine: 'timeline-v1' } } as unknown as TimelineActivitySpec;
  assert.doesNotThrow(() => compareRevisions(junk, null as unknown as TimelineActivitySpec, []));
  const check = compareRevisions(junk, junk, []);
  assert.equal(check.passed, false);
});

/* ------------------------------------------------------------------ */
/* Attacks on passing events                                           */
/* ------------------------------------------------------------------ */

test('attack: changing a passing event\'s date is weakening, even while fixing a real failure', () => {
  const bad = declWithBadE6();
  const next = structuredClone(bad.spec);
  eventsOf(next)[5]!.year = 1776; // honest fix of e6 ...
  eventsOf(next)[3]!.day = 6; // ... plus a silent rewrite of passing e4 (July 5 -> July 6)
  const check = compareRevisions(bad.spec, next, failedIds(bad.report), { sources: [bad.source], findings: bad.findings });
  assert.equal(check.passed, false);
  assert.match(check.message, /event "e4" changed \(day 5 -> 6\) even though its date check passed on the baseline/);
  assert.ok(!check.message.includes('event "e6" changed'), 'the failing event e6 may be re-grounded');
});

test('attack: relabelling a passing event into a different event is weakening', () => {
  const { spec, source } = decl();
  const next = structuredClone(spec);
  eventsOf(next)[2]!.label = eventsOf(spec)[0]!.label; // e3 relabelled as e1's event
  const check = compareRevisions(spec, next, [], { sources: [source] });
  assert.equal(check.passed, false);
  assert.match(check.message, /event "e3" changed \(label /);
});

test('attack: the title-year-grounded event e1 ("on June 10") is frozen like any passing event — with and without sources', () => {
  const { spec, source } = decl();
  const next = structuredClone(spec);
  eventsOf(next)[0]!.day = 11;
  assert.equal(compareRevisions(spec, next, [], { sources: [source] }).passed, false);
  // Without sources the title still comes from the baseline spec's own SourceRef title ("... (1776)"),
  // so e1 is known to have passed and stays frozen.
  const noSources = compareRevisions(spec, next, []);
  assert.equal(noSources.passed, false);
  assert.match(noSources.message, /event "e1" changed \(day 10 -> 11\)/);
});

test('attack: adding a new event is weakening, even when the new event is perfectly grounded', () => {
  const { spec, source } = decl();
  const next = structuredClone(spec);
  eventsOf(next).push({
    id: 'e7',
    label: 'Engrossed copy signed',
    year: 1776,
    month: 8,
    day: 2,
    evidence: [{ sourceId: source.id, quote: 'On August 2nd John Hancock, the President of the Congress, signed the engrossed copy with a bold signature.' }],
  });
  const check = compareRevisions(spec, next, [], { sources: [source] });
  assert.equal(check.passed, false);
  assert.match(check.message, /event "e7" is new in the repair/);
  assert.match(check.message, /event count grew from 6 to 7/);
});

test('attack: dropping below 5 events is weakening (and removing passing events is weakening)', () => {
  const { spec, source } = decl();
  const next = structuredClone(spec);
  next.simulation.events = eventsOf(next).slice(0, 4); // drop e5 and e6, both passing
  const check = compareRevisions(spec, next, [], { sources: [source] });
  assert.equal(check.passed, false);
  assert.match(check.message, /event count dropped to 4, expected >= 5/);
  assert.match(check.message, /event "e5"[^;]*was removed even though its date check passed/);
});

test('attack: swapping a test\'s pair when no finding names it is weakening', () => {
  const { spec, source } = decl();
  const next = structuredClone(spec);
  const t1 = next.behavioralTests[0]!;
  [t1.earlierEventId, t1.laterEventId] = [t1.laterEventId, t1.earlierEventId];
  const check = compareRevisions(spec, next, [], { sources: [source], findings: [] });
  assert.equal(check.passed, false);
  assert.match(check.message, /"committee-before-adoption" changed its pair/);
  assert.match(check.message, /strictly ordered on the baseline/);
});

/* ------------------------------------------------------------------ */
/* Legitimate repairs                                                  */
/* ------------------------------------------------------------------ */

test('repair: re-grounding the failing event passes with sources; WITHOUT sources it fails closed (S5B-17)', () => {
  const bad = declWithBadE6();
  const next = structuredClone(bad.spec);
  eventsOf(next)[5]!.year = 1776; // the quote "on August 2, 1776" grounds it again
  const failed = failedIds(bad.report);
  assert.equal(compareRevisions(bad.spec, next, failed, { sources: [bad.source], findings: bad.findings }).passed, true);
  assert.equal(compareRevisions(bad.spec, next, failed, { sources: [bad.source] }).passed, true);
  // ROUND-3 FLIP (S5B-17): without the source documents the baseline cannot be recomputed, so
  // date/evidence mutation fails closed — even honest findings or a failed-id list no longer
  // authorize the re-ground (the old textual quoteGroundsDate fallback was a second authority
  // that disagreed with the source-span validator and unlocked PASSING events in the worker).
  assert.equal(compareRevisions(bad.spec, next, failed, { findings: bad.findings }).passed, false);
  assert.equal(compareRevisions(bad.spec, next, failed).passed, false);
  // The repaired revision is publishable on its own.
  assert.equal(validateSpec(next, [bad.source]).publishable, true);
});

test('repair: re-grounding the failing event to a DIFFERENT grounded date passes (its cases may follow the new date)', () => {
  // ROUND-3 CHANGE: the old declaration quote 'Jefferson drafted the statement between June 11
  // and 28' is now (correctly) rejected by the clean-context guard ('between' bound + 'and 28'
  // connector), so the different-date re-grounding uses the harbor fixture's separately stated
  // 'An earlier office opened January 1, 1888.' sentence instead.
  const source = harborSourceDoc();
  source.text += '\nAn earlier office opened January 1, 1888.';
  source.sha256 = sha256(source.text);
  const spec = makeHarborTimelineSpec();
  spec.sources[0]!.sha256 = source.sha256;
  eventsOf(spec)[4]!.year = 1891; // s5 (February 9, 1890) fails timeline.date-grounded only
  const report = validateSpec(spec, [source]);
  assert.deepEqual(failedIds(report), ['timeline.date-grounded']);

  const next = structuredClone(spec);
  const s5 = eventsOf(next)[4]!;
  s5.year = 1888;
  s5.month = 1;
  s5.day = 1;
  s5.label = 'Earlier office opens';
  s5.evidence = [{ sourceId: source.id, quote: 'An earlier office opened January 1, 1888.' }];
  // The two predictions comparing s5 flip because s5 was legitimately re-grounded EARLIER.
  next.predictions[0]!.earlierEventId = 's5';
  next.predictions[0]!.laterEventId = 's1';
  next.predictions[1]!.earlierEventId = 's5';
  next.predictions[1]!.laterEventId = 's4';
  const check = compareRevisions(spec, next, failedIds(report), { sources: [source], findings: repairFindings(report, spec) });
  assert.equal(check.passed, true, check.message);
  assert.equal(validateSpec(next, [source]).publishable, true, failedIds(validateSpec(next, [source])).join(','));
});

test('repair: removing the failing event and re-pointing its cases at a passing event passes', () => {
  const bad = declWithBadE6();
  const next = structuredClone(bad.spec);
  next.simulation.events = eventsOf(next).filter(e => e.id !== 'e6'); // 5 events remain (>= 5)
  for (const t of next.behavioralTests) {
    if (t.laterEventId === 'e6') t.laterEventId = 'e5'; // July 4 < July 19 keeps the order
  }
  for (const p of next.predictions) {
    if (p.laterEventId === 'e6') p.laterEventId = 'e5';
  }
  const check = compareRevisions(bad.spec, next, failedIds(bad.report), { sources: [bad.source], findings: bad.findings });
  assert.equal(check.passed, true, check.message);
  assert.equal(validateSpec(next, [bad.source]).publishable, true);
});

test('attack: removing a PASSING event while another event is failing is weakening', () => {
  const bad = declWithBadE6();
  const next = structuredClone(bad.spec);
  next.simulation.events = eventsOf(next).filter(e => e.id !== 'e3'); // e3 passed on the baseline
  const check = compareRevisions(bad.spec, next, failedIds(bad.report), { sources: [bad.source], findings: bad.findings });
  assert.equal(check.passed, false);
  assert.match(check.message, /event "e3"[^;]*was removed even though its date check passed/);
});

test('repair: fixing a pair that failed timeline.case-order on the baseline passes; an unrelated pair stays frozen', () => {
  const { spec, source } = decl();
  spec.behavioralTests[0]!.earlierEventId = 'e3'; // corrupt t1 into a wrong answer
  spec.behavioralTests[0]!.laterEventId = 'e1';
  const report = validateSpec(spec, [source]);
  assert.deepEqual(failedIds(report), ['timeline.case-order']);
  const findings = repairFindings(report, spec);

  const next = structuredClone(spec);
  next.behavioralTests[0]!.earlierEventId = 'e1'; // honest fix of the named pair
  next.behavioralTests[0]!.laterEventId = 'e3';
  assert.equal(compareRevisions(spec, next, failedIds(report), { sources: [source], findings }).passed, true);
  // ... but swapping a DIFFERENT, passing pair in the same repair is weakening.
  const sneaky = structuredClone(next);
  const t3 = sneaky.behavioralTests[2]!;
  [t3.earlierEventId, t3.laterEventId] = [t3.laterEventId, t3.earlierEventId];
  const check = compareRevisions(spec, sneaky, failedIds(report), { sources: [source], findings });
  assert.equal(check.passed, false);
  assert.match(check.message, /"printing-before-engrossing-order" changed its pair/);
});

test('repair: a failing pair may also be fixed by re-grounding the event it compares (scoped exceptions compose)', () => {
  // Baseline: e6 year corrupted -> date-grounded fails; t4 (e3, e6) still ordered, so it passes.
  const bad = declWithBadE6();
  const next = structuredClone(bad.spec);
  eventsOf(next)[5]!.year = 1776;
  // The pair is untouched; only the frozen-unless-failing event changed.
  const check = compareRevisions(bad.spec, next, failedIds(bad.report), { sources: [bad.source] });
  assert.equal(check.passed, true, check.message);
});

test('attack: a case-order finding never unlocks event dates (scoped per failing check id)', () => {
  const { spec, source } = decl();
  spec.behavioralTests[0]!.earlierEventId = 'e3';
  spec.behavioralTests[0]!.laterEventId = 'e1';
  const report = validateSpec(spec, [source]);
  const findings = repairFindings(report, spec);
  assert.deepEqual(findings.map(f => f.id), ['timeline.case-order']);

  const next = structuredClone(spec);
  next.behavioralTests[0]!.earlierEventId = 'e1'; // fix the pair ...
  next.behavioralTests[0]!.laterEventId = 'e3';
  eventsOf(next)[1]!.day = 3; // ... and silently shift passing e2 (July 2 -> July 3)
  const check = compareRevisions(spec, next, failedIds(report), { sources: [source], findings });
  assert.equal(check.passed, false);
  assert.match(check.message, /event "e2" changed \(day 2 -> 3\)/);
});

/* ------------------------------------------------------------------ */
/* Strictness without sources (fail-closed documentation)              */
/* ------------------------------------------------------------------ */

test('fail-closed: without sources or findings a textually grounded event whose quote is not verbatim stays frozen', () => {
  const { spec, source } = decl();
  // Fabricated quote: textually it grounds July 4, 1776, but it is not verbatim in the source.
  spec.simulation.events[2]!.evidence = [
    { sourceId: source.id, quote: 'The Continental Congress adopted the Declaration of Independence on July 4, 1776, at high noon.' },
  ];
  const report = validateSpec(spec, [source]);
  assert.deepEqual(failedIds(report), ['timeline.date-grounded', 'grounding.quotes']);

  const next = structuredClone(spec);
  next.simulation.events[2]!.evidence = [
    { sourceId: source.id, quote: 'The Continental Congress adopted the Declaration of Independence on July 4, 1776.' },
  ];
  // Without sources AND without findings the comparison cannot prove e3 failed, so it fails closed ...
  assert.equal(compareRevisions(spec, next, failedIds(report)).passed, false);
  // S5B-15: without source context, caller-supplied findings can NEVER unlock date/evidence/pair
  // scopes either — even honest repairFindings fail closed here (the baseline cannot be recomputed,
  // and reflected finding metadata is caller-supplied). The honest repair needs the sources ...
  assert.equal(compareRevisions(spec, next, failedIds(report), { findings: repairFindings(report, spec) }).passed, false);
  // ... and with sources the exact recomputation allows it without any findings.
  assert.equal(compareRevisions(spec, next, failedIds(report), { sources: [source] }).passed, true);
});

/* ------------------------------------------------------------------ */
/* Identity rules mirror the numeric engines                           */
/* ------------------------------------------------------------------ */

test('case identity is (name/id, occurrence): deleting a passing baseline case is weakening, adding one is fine', () => {
  const { spec, source } = decl();
  const deleted = structuredClone(spec);
  deleted.behavioralTests = deleted.behavioralTests.slice(0, 3);
  const delCheck = compareRevisions(spec, deleted, [], { sources: [source] });
  assert.equal(delCheck.passed, false);
  assert.match(delCheck.message, /behavioralTests "adoption-before-signing" from the baseline is missing from the repair/);

  const added = structuredClone(spec);
  added.behavioralTests.push({ name: 'committee-before-printing', earlierEventId: 'e1', laterEventId: 'e4' });
  assert.equal(compareRevisions(spec, added, [], { sources: [source] }).passed, true);
});

test('a publisher-violating case name may be renamed by position (the numeric S5-09 exception)', () => {
  const spec = makeTreatyTimelineSpec();
  const source = treatySourceDoc();
  spec.behavioralTests[0]!.name = 'according-to-NASA stone check';
  const report = validateSpec(spec, [source]);
  assert.ok(failedIds(report).includes('policy.no-publisher-attribution'));

  const next = structuredClone(spec);
  next.behavioralTests[0]!.name = 'stone-before-treaty-check';
  const check = compareRevisions(spec, next, failedIds(report), { sources: [source], findings: repairFindings(report, spec) });
  assert.equal(check.passed, true, check.message);

  // Renaming a CLEAN baseline case is still weakening.
  const clean = makeTreatyTimelineSpec();
  const renamed = structuredClone(clean);
  renamed.behavioralTests[0]!.name = 'something-else';
  assert.equal(compareRevisions(clean, renamed, [], { sources: [source] }).passed, false);
});

test('harbor: a legitimate duplicate-date repair (re-grounding the named event to its own stated date) passes', () => {
  const spec = makeHarborTimelineSpec();
  const source = harborSourceDoc();
  // Make s4 a duplicate of s3's date via the grounded customs sentence -> distinct-dates fails.
  const s4 = eventsOf(spec)[3]!;
  s4.year = 1889;
  s4.month = 7;
  s4.day = 1;
  s4.evidence = [{ sourceId: source.id, quote: 'The customs office reopened on July 1, 1889 after repairs.' }];
  const report = validateSpec(spec, [source]);
  assert.deepEqual(failedIds(report), ['timeline.distinct-dates']);

  // Repair: the event the finding names is re-grounded to the seawall date the source states for it.
  const next = structuredClone(spec);
  const nextS4 = eventsOf(next)[3]!;
  nextS4.month = 11;
  nextS4.day = 30;
  nextS4.evidence = [{ sourceId: source.id, quote: 'A storm delayed the seawall, which was finished on November 30.' }];
  const check = compareRevisions(spec, next, failedIds(report), { sources: [source], findings: repairFindings(report, spec) });
  assert.equal(check.passed, true, check.message);
  assert.equal(validateSpec(next, [source]).publishable, true);
});

test('BUG-003 (timeline): an over-long prediction id may be renamed to a valid id; the pair stays frozen', () => {
  const { spec, source } = decl();
  const long = 'which-came-first-adoption-or-signing-of-it'; // 42 chars
  spec.predictions[0]!.id = long;
  const r1Report = validateSpec(spec, [source]);
  assert.deepEqual(failedIds(r1Report), ['schema.full']);
  const r2 = structuredClone(spec);
  r2.predictions[0]!.id = 'adoption-or-signing';
  assert.equal(validateSpec(r2, [source]).publishable, true);
  const ok = compareRevisions(spec, r2, failedIds(r1Report), { sources: [source] });
  assert.equal(ok.passed, true, ok.message);
  const swapped = structuredClone(r2);
  const p0 = swapped.predictions[0]!;
  [p0.earlierEventId, p0.laterEventId] = [p0.laterEventId, p0.earlierEventId];
  const bad = compareRevisions(spec, swapped, failedIds(r1Report), { sources: [source] });
  assert.equal(bad.passed, false, 'renaming never unlocks the pair');
});
