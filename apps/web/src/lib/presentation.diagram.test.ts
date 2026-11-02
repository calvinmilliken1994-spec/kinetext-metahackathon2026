/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { DIAGRAM_FIGURE_BOX, DIAGRAM_STAGE, diagramStageWidth } from './presentation.ts';
import { stageFigureSize } from './labelDiagramView.ts';

// UX pair review 2, H5: the label-diagram slide's figure filled only about 60% of the slide's height. The slide now puts
// its heading over the side column (the figure runs the full stage height) and lays the part out at a design width
// whose shape matches the stage, so StageFit scales it by the height and the figure fills the stage top to bottom.

const part = (fig: { width: number; height: number }) => stageFigureSize(fig, DIAGRAM_FIGURE_BOX.maxW, DIAGRAM_FIGURE_BOX.maxH);

test('the water-cycle figure (572×504) is laid out at the stage shape, so the height decides the scale', () => {
  const fig = { width: 572, height: 504 };
  const w = diagramStageWidth(fig);
  const h = part(fig).height + DIAGRAM_STAGE.padBottom;
  assert.ok(Math.abs(w / h - DIAGRAM_STAGE.aspect) / DIAGRAM_STAGE.aspect < 0.02, `aspect ${w / h}`);
  // The side column (heading, question, names, numbers) keeps a usable width beside the figure.
  assert.ok(w - part(fig).width - DIAGRAM_STAGE.gap >= DIAGRAM_STAGE.sideMin);
});

test('a square figure (DNA, 600×600) gets the same stage shape', () => {
  const fig = { width: 600, height: 600 };
  const w = diagramStageWidth(fig);
  assert.equal(part(fig).height, DIAGRAM_FIGURE_BOX.maxH);
  assert.ok(Math.abs(w / (DIAGRAM_FIGURE_BOX.maxH + DIAGRAM_STAGE.padBottom) - DIAGRAM_STAGE.aspect) < 0.05);
});

test('a wide figure keeps the side column its minimum width (it cannot be height-bound past the figure cap)', () => {
  const fig = { width: 600, height: 363 };
  assert.equal(diagramStageWidth(fig), 600 + DIAGRAM_STAGE.gap + DIAGRAM_STAGE.sideMin);
});

test('the stage aspect is no wider than the narrowest target stage, so every target size is height-bound', () => {
  // Stage boxes measured at 2560×1440, 1920×1080 and 1366×768 once the heading moved beside the figure.
  for (const [w, h] of [[2227, 1051], [1670, 774], [1189, 525]] as const) assert.ok(DIAGRAM_STAGE.aspect <= w / h + 0.01, `${w}×${h}`);
});

test('an unknown figure size still gives a positive width', () => {
  assert.ok(diagramStageWidth({ width: 0, height: 0 }) > 0);
});
