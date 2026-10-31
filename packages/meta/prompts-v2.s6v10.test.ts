import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { KIT_COMPONENT_GUIDANCE, STAGE6_PROMPT_VERSION } from './prompts-v2.ts';

const TEXT: string = KIT_COMPONENT_GUIDANCE['label-diagram-v1'];

describe('s6-v10 label-diagram-v1 design text', () => {
  it('bumps STAGE6_PROMPT_VERSION to s6-v10', () => {
    assert.equal(STAGE6_PROMPT_VERSION, 's6-v10');
  });

  it('forbids the whole figure and vague parts', () => {
    assert.match(TEXT, /never choose the whole figure/i);
    assert.match(TEXT, /overall structure/i);
    assert.match(TEXT, /double helix/i);
    assert.match(TEXT, /no single drawn shape/i);
  });

  it('forbids bands of a continuous scale', () => {
    assert.match(TEXT, /band of a continuous scale/i);
  });

  it('requires separately drawn parts or no component', () => {
    assert.match(TEXT, /separately drawn objects or components/i);
    assert.match(TEXT, /do not write the component/i);
  });

  it('requires the point at the visual centre on ink away from printed text', () => {
    assert.match(TEXT, /visual centre/i);
    assert.match(TEXT, /on ink/i);
    assert.match(TEXT, /well away from any printed text/i);
    assert.match(TEXT, /not inside any printed word/i);
  });

  it('requires one tight label box per printed label at the same vertical position', () => {
    assert.match(TEXT, /tightly encloses exactly one printed label/i);
    assert.match(TEXT, /same vertical position/i);
    assert.match(TEXT, /top and bottom edges/i);
    assert.match(TEXT, /no neighbouring words/i);
  });

  it('keeps the still-true base contract', () => {
    assert.match(TEXT, /page TEXT/i);
    assert.match(TEXT, /verbatim quote/i);
    assert.match(TEXT, /0\.\.1000 integers/i);
    assert.match(TEXT, /x right, y down/i);
    assert.match(TEXT, /all-zero box when the part has no printed label/i);
    assert.match(TEXT, /lowercase kebab/i);
    assert.match(TEXT, /compact JSON/i);
  });
});
