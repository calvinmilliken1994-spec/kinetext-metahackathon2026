/// <reference types="node" />
// Stage 8d: an open-weights diagram lesson credits both models by name: the parts were located by Muse Spark Open
// (open weights, Modal) and the regions came from SAM 3.1 (Meta API). It never implies a single provider.
import test from 'node:test';
import assert from 'node:assert/strict';
import { creditLine, madeWithOf, SAM_CREDIT, withSamNote } from './presentation.ts';
import type { DeckPart } from './presentation.ts';

const SOURCE = {
  id: 'ph', title: 'The water cycle — NOAA National Weather Service', locator: 'https://www.noaa.gov/', license: 'US-Gov-Work',
  attribution: 'NOAA.', kind: 'library' as const,
};
const OPEN_DISCLOSURE = 'AI-generated with Muse Spark Open (Meta’s open weights, hosted on Modal). Includes material from NOAA, which has not reviewed or endorsed this lesson.';
const META_DISCLOSURE = 'AI-generated with Muse Spark 1.3 (Meta). Includes material from NOAA, which has not reviewed or endorsed this lesson.';
const diagram = { kind: 'kit', spec: { componentId: 'label-diagram-v1', regions: [{ partId: 'a', x1: 0, y1: 0, x2: 1, y2: 1, confidence: 1 }] } } as unknown as DeckPart;
const noRegions = { kind: 'kit', spec: { componentId: 'label-diagram-v1', regions: [] } } as unknown as DeckPart;
const OPEN_CREDIT = 'diagram parts located by Muse Spark Open (open weights, Modal) · regions by SAM 3.1 (Meta API)';

test('hook credit: an open-weights diagram lesson names Muse Spark Open (open weights, Modal) and SAM 3.1 (Meta API)', () => {
  const line = creditLine({ source: SOURCE, disclosure: OPEN_DISCLOSURE, parts: [diagram] }) ?? '';
  assert.ok(line.endsWith(` · ${OPEN_CREDIT}`), line);
  assert.match(line, /AI-written with Muse Spark Open \(Meta’s open weights\), teacher review pending/);
  assert.doesNotMatch(line, /SAM 3\.1 \(Meta\)$/, 'never the single-provider wording');
});

test('hook credit: Spark 1.3 keeps the one-provider credit; no diagram or no regions means no diagram credit on either model', () => {
  assert.ok((creditLine({ source: SOURCE, disclosure: META_DISCLOSURE, parts: [diagram] }) ?? '').endsWith(` · ${SAM_CREDIT}`));
  assert.equal(SAM_CREDIT, 'diagram regions: SAM 3.1 (Meta)');
  assert.doesNotMatch(creditLine({ source: SOURCE, disclosure: OPEN_DISCLOSURE, parts: [noRegions] }) ?? '', /SAM|located/);
  assert.doesNotMatch(creditLine({ source: SOURCE, disclosure: OPEN_DISCLOSURE, parts: [] }) ?? '', /SAM|located/);
});

test('title-slide disclosure: open-weights diagram lessons say who located the parts and who drew the regions, once', () => {
  const said = withSamNote(OPEN_DISCLOSURE, [diagram]);
  assert.equal(said, `${OPEN_DISCLOSURE} Diagram parts located by Muse Spark Open (open weights, Modal); regions by SAM 3.1 (Meta API).`);
  assert.equal(withSamNote(said, [diagram]), said, 'said once');
  assert.equal(madeWithOf(said), 'Muse Spark Open (Meta’s open weights, hosted on Modal)', 'the model still reads back');
  assert.equal(withSamNote(OPEN_DISCLOSURE, [noRegions]), OPEN_DISCLOSURE);
  // Spark 1.3 unchanged
  assert.equal(withSamNote(META_DISCLOSURE, [diagram]), `${META_DISCLOSURE} Diagram regions by SAM 3.1 (Meta).`);
});
