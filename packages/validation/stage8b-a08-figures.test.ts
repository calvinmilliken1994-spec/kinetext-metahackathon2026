// Stage 8b V — the A-08 figure rule (docs/specs/STAGE-8b-label-diagram.md, Flow step 1):
// a componentPlan entry 'label-diagram-v1' may only be planned when the analysis message listed
// at least one figure for the source. The caller passes that list as the new `figures` option of
// AnalysisV2ValidateOptions; when the option is absent or empty, A-08 fails the entry with an
// affected pointer at /componentPlan/i/componentId. Every pre-existing A-08 behaviour is kept:
// plans without label-diagram-v1 validate exactly as before, with or without the option.
// Run: node --test packages/validation/stage8b-a08-figures.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';

import type { SourceAnalysisV2 } from '../contracts/index.ts';
import { validateAnalysisV2, validateLessonAnalysisGate } from './analysis-v2.ts';
import { checkOf, clone, dragSource, failedIds, failureDetail, usableAnalysis } from './fixtures/stage6.ts';

/** The drag golden with the kit slot re-planned as label-diagram-v1 (quote/reason untouched). */
function labelPlanAnalysis(): SourceAnalysisV2 {
  const a = clone(usableAnalysis());
  a.componentPlan[1]!.componentId = 'label-diagram-v1';
  return a;
}

const DNA_FIGURE = [{ id: 'medlineplus-dna-structure-1' }];

test('A-08: label-diagram-v1 without the figures option fails and names the plan entry', () => {
  const a = labelPlanAnalysis();
  const report = validateAnalysisV2(a, [dragSource()]);
  assert.deepEqual(failedIds(report), ['A-08'], failureDetail(report));
  const affected = checkOf(report, 'A-08').affected ?? [];
  assert.ok(affected.includes('/componentPlan/1/componentId'), affected.join(', '));
  assert.match(checkOf(report, 'A-08').message, /figure/i);
  assert.equal(report.publishable, false);
});

test('A-08: an empty (or junk) figure list fails the same way', () => {
  const a = labelPlanAnalysis();
  for (const figures of [[], [{}], [{ id: '' }]]) {
    const report = validateAnalysisV2(a, [dragSource()], { figures: figures as { id: string }[] });
    assert.deepEqual(failedIds(report), ['A-08'], `${JSON.stringify(figures)}: ${failureDetail(report)}`);
  }
});

test('A-08: label-diagram-v1 with a listed figure passes, and the lesson gate agrees', () => {
  const a = labelPlanAnalysis();
  const report = validateAnalysisV2(a, [dragSource()], { figures: DNA_FIGURE });
  assert.equal(report.publishable, true, failureDetail(report));
  assert.equal(checkOf(report, 'A-08').passed, true);
  const gated = validateLessonAnalysisGate(a, [dragSource()], { figures: DNA_FIGURE });
  assert.equal(gated.publishable, true, failureDetail(gated));
  // ... while the gate without the figure list still fails A-08 (fail closed):
  const noFigures = validateLessonAnalysisGate(a, [dragSource()]);
  assert.ok(failedIds(noFigures).includes('A-08'), failureDetail(noFigures));
});

test('A-08: plans without label-diagram-v1 keep every existing behaviour, with or without figures', () => {
  const golden = usableAnalysis();
  const without = validateAnalysisV2(golden, [dragSource()]);
  assert.equal(without.publishable, true, failureDetail(without));
  const withFigures = validateAnalysisV2(clone(golden), [dragSource()], { figures: DNA_FIGURE });
  assert.equal(withFigures.publishable, true, failureDetail(withFigures));
  // The pre-existing rules still fire alongside the figure rule (duplicate family + no figures):
  const dup = labelPlanAnalysis();
  dup.componentPlan.push({ componentId: 'label-diagram-v1', pedagogicalReason: 'A duplicate family entry for the same figure.', focusQuote: 'Drag depends on the density of the air', focusSourceId: 'nasa-grc-drag-equation' });
  const report = validateAnalysisV2(dup, [dragSource()]);
  assert.deepEqual(failedIds(report), ['A-08'], failureDetail(report));
  const affected = checkOf(report, 'A-08').affected ?? [];
  assert.ok(affected.includes('/componentPlan/1/componentId') && affected.includes('/componentPlan/2/componentId'), affected.join(', '));
});
