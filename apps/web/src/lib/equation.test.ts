/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { ENGINE_IDS } from '../../../../packages/contracts/index.ts';
import { engineEquation, equationText, explorerEquation } from './equation.ts';
import { engineOutput, formatOutputValue } from './engines.ts';

const text = (eq: ReturnType<typeof engineEquation>, concealed = false): string => {
  assert.ok(eq);
  return equationText(eq, concealed);
};

test('projectile: the Moon case reads y_max = V0² / (2 · g) = 15² / (2 · 1.62) = 69.444 m', () => {
  const eq = engineEquation('projectile-v1', { horizontalSpeedMps: 20, verticalSpeedMps: 15, gravityMps2: 1.62 });
  assert.equal(text(eq), 'y_max = V0² / (2 · g) = 15² / (2 · 1.62) = 69.444 m');
});

test('every engine has a template, and its result is the engine’s own output in the readout format', () => {
  const cases: Record<string, Record<string, number>> = {
    'forces-1d-v1': { massKg: 12, netForceN: 30 },
    'projectile-v1': { horizontalSpeedMps: 20, verticalSpeedMps: 15, gravityMps2: 1.62 },
    'lift-equation-v1': { liftCoefficient: 0.5, airDensityKgM3: 1.225, airspeedMps: 70, wingAreaM2: 16 },
    'speed-of-sound-v1': { gamma: 1.4, gasConstantJPerKgK: 287, temperatureK: 293 },
    'compound-interest-v1': { principalUSD: 1000, annualRatePercent: 5, compoundsPerYear: 12, years: 10 },
    'hardy-weinberg-v1': { alleleFrequencyP: 0.3 },
    'half-life-v1': { initialAmount: 100, halfLife: 5, elapsedTime: 10 },
  };
  assert.deepEqual(Object.keys(cases).sort(), [...ENGINE_IDS].sort(), 'all engines covered');
  for (const engine of ENGINE_IDS) {
    const eq = engineEquation(engine, cases[engine] as Record<string, number>);
    assert.ok(eq, engine);
    const out = engineOutput(engine, cases[engine] as Record<string, number>) as number;
    assert.equal(eq.value, out, `${engine}: result is the engine value`);
    assert.ok(eq.result.includes(formatOutputValue(engine, out).replace(/^-/, '−')), `${engine}: ${eq.result}`);
  }
});

test('the other six templates, substituted', () => {
  assert.equal(text(engineEquation('forces-1d-v1', { massKg: 12, netForceN: 30 })), 'a = F_net / m = 30 / 12 = 2.5 m/s²');
  assert.equal(
    text(engineEquation('lift-equation-v1', { liftCoefficient: 0.5, airDensityKgM3: 1.225, airspeedMps: 70, wingAreaM2: 16 })),
    'L = ½ · C_l · ρ · V² · A = ½ · 0.5 · 1.225 · 70² · 16 = 24,010 N',
  );
  assert.equal(
    text(engineEquation('speed-of-sound-v1', { gamma: 1.4, gasConstantJPerKgK: 287, temperatureK: 293 })),
    'a = √(γ · R · T) = √(1.4 · 287 · 293) = 343.11 m/s',
  );
  assert.equal(
    text(engineEquation('compound-interest-v1', { principalUSD: 1000, annualRatePercent: 5, compoundsPerYear: 12, years: 10 })),
    'A = P · (1 + r / (100 · n))^(n · t) = $1,000.00 · (1 + 5 / (100 · 12))^(12 · 10) = $1,647.01',
  );
  assert.equal(text(engineEquation('hardy-weinberg-v1', { alleleFrequencyP: 0.3 })), '2pq = 2 · p · (1 − p) = 2 · 0.3 · (1 − 0.3) = 0.42');
  assert.equal(
    text(engineEquation('half-life-v1', { initialAmount: 100, halfLife: 5, elapsedTime: 10 })),
    'N = N0 · (½)^(t / T) = 100 · (½)^(10 / 5) = 25',
  );
});

test('a negative input is bracketed, so a square or a product still reads correctly', () => {
  assert.equal(
    text(engineEquation('lift-equation-v1', { liftCoefficient: -0.2, airDensityKgM3: 1.225, airspeedMps: 70, wingAreaM2: 16 })),
    'L = ½ · C_l · ρ · V² · A = ½ · (−0.2) · 1.225 · 70² · 16 = −9,604 N',
  );
  assert.equal(text(engineEquation('forces-1d-v1', { massKg: 4, netForceN: -10 })), 'a = F_net / m = (−10) / 4 = −2.5 m/s²');
});

test('concealed: the substituted numbers stay, the result becomes ? (no unit)', () => {
  const eq = engineEquation('projectile-v1', { horizontalSpeedMps: 20, verticalSpeedMps: 15, gravityMps2: 1.62 });
  assert.equal(text(eq, true), 'y_max = V0² / (2 · g) = 15² / (2 · 1.62) = ?');
});

test('inputs the engine rejects give no equation', () => {
  assert.equal(engineEquation('projectile-v1', { horizontalSpeedMps: 20, verticalSpeedMps: 15, gravityMps2: 0 }), null);
  assert.equal(engineEquation('half-life-v1', { initialAmount: 100 }), null);
});

// ---- formula explorer: the parsed expression (packages/validation/expression.ts) with values put in ----------------

const ex = (expression: string, inputs: Record<string, number>, output: number, lhs = 'y'): string => {
  const eq = explorerEquation(expression, Object.keys(inputs), lhs, inputs, output);
  assert.ok(eq, expression);
  return equationText(eq);
};

test('explorer: symbolic = substituted = calculator output', () => {
  assert.equal(ex('v^2/(2*a)', { v: 10, a: 2 }, 25, 'd'), 'd = v² / (2 · a) = 10² / (2 · 2) = 25');
  assert.equal(ex('m*g*h', { m: 2, g: 9.8, h: 10 }, 196, 'E'), 'E = m · g · h = 2 · 9.8 · 10 = 196');
});

test('explorer: brackets only where precedence needs them', () => {
  assert.equal(ex('(a+b)*c', { a: 1, b: 2, c: 3 }, 9), 'y = (a + b) · c = (1 + 2) · 3 = 9');
  assert.equal(ex('a/(b*c)', { a: 6, b: 1, c: 2 }, 3), 'y = a / (b · c) = 6 / (1 · 2) = 3');
  assert.equal(ex('a-(b-c)', { a: 5, b: 3, c: 1 }, 3), 'y = a − (b − c) = 5 − (3 − 1) = 3');
  assert.equal(ex('a-b+c', { a: 5, b: 3, c: 1 }, 3), 'y = a − b + c = 5 − 3 + 1 = 3');
  assert.equal(ex('a^(b+1)', { a: 2, b: 2 }, 8), 'y = a^(b + 1) = 2^(2 + 1) = 8');
  assert.equal(ex('(a*b)^2', { a: 2, b: 3 }, 36), 'y = (a · b)² = (2 · 3)² = 36');
  assert.equal(ex('-x^2+3', { x: -2 }, -1), 'y = −x² + 3 = −(−2)² + 3 = −1');
  assert.equal(ex('sqrt(2*g*h)', { g: 9.8, h: 5 }, Math.sqrt(98)), 'y = √(2 · g · h) = √(2 · 9.8 · 5) = 9.89949');
  assert.equal(ex('pi*r^2', { r: 2 }, 12.566371), 'y = π · r² = π · 2² = 12.5664');
  assert.equal(ex('exp(-k*t)', { k: 0.5, t: 2 }, 0.367879), 'y = exp(−k · t) = exp(−0.5 · 2) = 0.367879');
});

test('explorer: an unparseable expression gives no line; an undefined output reads “not defined”', () => {
  assert.equal(explorerEquation('2x', ['x'], 'y', { x: 1 }, 2), null);
  const eq = explorerEquation('1/x', ['x'], 'y', { x: 0 }, Number.NaN);
  assert.ok(eq);
  assert.equal(equationText(eq), 'y = 1 / x = 1 / 0 = not defined');
});
