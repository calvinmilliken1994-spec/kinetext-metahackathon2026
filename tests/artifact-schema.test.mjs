import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv from 'ajv';

test('force activity contract accepts a bounded, source-grounded template and rejects unsafe variants', () => {
  const schema = JSON.parse(readFileSync(new URL('../schemas/learning-artifact.schema.json', import.meta.url)));
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/forces.template.json', import.meta.url)));
  const validate = new Ajv({ allErrors: true }).compile(schema);
  assert.equal(validate(fixture), true, JSON.stringify(validate.errors));
  for (const mutate of [
    x => { x.simulation.massKg.default = 0; },
    x => { x.simulation.engine = 'arbitrary-javascript'; },
    x => { x.sources = []; },
    x => { x.explanations[0].sourceIds = []; },
    x => { x.code = 'fetch("https://example.com")'; },
    x => { x.provenance.provider = 'openai'; },
    x => { x.execution.maxRepairAttempts = 99; },
  ]) {
    const copy = structuredClone(fixture);
    mutate(copy);
    assert.equal(validate(copy), false, 'Unsafe contract was accepted');
  }
});
