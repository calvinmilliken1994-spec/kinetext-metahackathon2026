/// <reference types="node" />
// The explorer's slide layout (presentation={{mode:'stage'}}): sliders in a left column, a large graph filling the rest.
// The graph is drawn at its own wide size, so it fills its column at the slide's design width without stretching text.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { FormulaExplorerSpec } from '../../../../packages/contracts/kit.ts';
import { GRAPH_SIZE, STAGE_GRAPH_SIZE, STAGE_LAYOUT, buildExplorer, curveSamples, defaultInputs, evalAt, graphGeometry } from './explorer.ts';
import { loadDemoLessons } from './stage6-fixtures.ts';

const drag = loadDemoLessons().find((l) => l.id === 'drag');
const spec = Object.values(drag?.specs ?? {}).find((s) => s.componentId === 'formula-explorer-v1') as FormulaExplorerSpec;
const model = buildExplorer(spec);
if (!model.ok) throw new Error('fixture explorer should build');

test('the stage graph is larger than the lesson graph and wide like a slide', () => {
  assert.ok(STAGE_GRAPH_SIZE.width > GRAPH_SIZE.width && STAGE_GRAPH_SIZE.height > GRAPH_SIZE.height);
  const aspect = STAGE_GRAPH_SIZE.width / STAGE_GRAPH_SIZE.height;
  assert.ok(aspect >= 1.7 && aspect <= 2.3, `aspect ${aspect}`);
});

test('the stage graph fills the column beside the sliders exactly, so its 13–14 px labels are drawn at 1:1', () => {
  assert.equal(STAGE_LAYOUT.sideWidth + STAGE_LAYOUT.gap + STAGE_GRAPH_SIZE.width, STAGE_LAYOUT.width);
});

test('the slide fits a 1366×768 stage (~1189×453 px) at zoom ≥ 0.85 when its height stays within the design budget', () => {
  const zoom = Math.min(1189 / STAGE_LAYOUT.width, 453 / STAGE_LAYOUT.maxHeight);
  assert.ok(zoom >= 0.85, `zoom ${zoom}`);
  // The graph plus its equation row (measured ~58 px: a 1 px rule, 10 px padding, the 26 px result, the column gap) stay
  // inside that budget.
  assert.ok(STAGE_GRAPH_SIZE.height + 64 <= STAGE_LAYOUT.maxHeight);
});

test('geometry drawn at the stage size uses the whole frame: plot margins as in the lesson graph', () => {
  const inputs = defaultInputs(spec);
  const g = graphGeometry(curveSamples(model, spec, inputs), { x: inputs[spec.xVariable] ?? 0, y: evalAt(model, inputs) }, STAGE_GRAPH_SIZE);
  assert.equal(g.width, STAGE_GRAPH_SIZE.width);
  assert.equal(g.height, STAGE_GRAPH_SIZE.height);
  assert.equal(g.plot.r, STAGE_GRAPH_SIZE.width - 18);
  assert.equal(g.plot.b, STAGE_GRAPH_SIZE.height - 46);
  assert.ok(g.current.defined && g.current.py !== null && g.current.py >= g.plot.t && g.current.py <= g.plot.b);
});
