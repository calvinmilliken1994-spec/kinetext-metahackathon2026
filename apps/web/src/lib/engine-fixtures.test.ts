/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { sha256 } from '../../../../packages/sources/index.ts';
import { validateSpec } from '../../../../packages/validation/validate.ts';
import { computeOutput } from '../../../../packages/activities/registry.ts';
import {
  COMPOUND_SHA256, HALF_LIFE_SHA256, HARDY_WEINBERG_SHA256, compoundSourceDoc, halfLifeSourceDoc, hardyWeinbergSourceDoc,
  makeCompoundInterestSpec, makeHalfLifeSpec, makeHardyWeinbergSpec,
} from './engine-fixtures.ts';

test('fixture source texts match their pinned sha256', () => {
  assert.equal(sha256(compoundSourceDoc().text), COMPOUND_SHA256);
  assert.equal(sha256(hardyWeinbergSourceDoc().text), HARDY_WEINBERG_SHA256);
  assert.equal(sha256(halfLifeSourceDoc().text), HALF_LIFE_SHA256);
});

test('the three web fixture specs pass the real validator (so UI tests use genuinely valid specs)', () => {
  const cases = [
    { spec: makeCompoundInterestSpec(), doc: compoundSourceDoc() },
    { spec: makeHardyWeinbergSpec(), doc: hardyWeinbergSourceDoc() },
    { spec: makeHalfLifeSpec(), doc: halfLifeSourceDoc() },
  ];
  for (const { spec, doc } of cases) {
    const report = validateSpec(spec, [doc]);
    const failed = report.checks.filter((c) => !c.passed).map((c) => c.id);
    assert.deepEqual(failed, [], `${spec.simulation.engine}: ${failed.join(', ')}`);
  }
});

test('fixture predictions match what the engines compute', () => {
  for (const spec of [makeCompoundInterestSpec(), makeHardyWeinbergSpec(), makeHalfLifeSpec()]) {
    for (const p of spec.predictions) {
      const engine = spec.simulation.engine;
      const expected = Object.entries(p).find(([k]) => k.startsWith('expected'))?.[1] as number;
      assert.ok(Math.abs(computeOutput(engine, p) - expected) <= p.tolerance, `${engine} ${p.id}`);
    }
  }
});
