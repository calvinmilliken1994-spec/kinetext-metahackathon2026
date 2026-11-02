// A printed label in the singular on a page that only uses the plural ("Jet Engine" on a page that says "jet engines",
// Calvin's airplane, 3 Nov). The page names the part, so the label counts and a part named by the label passes LD-02.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pageWordingOfLabel, phraseOrPluralOccurs } from './kit/label-diagram.ts';

test('pageWordingOfLabel: a singular label is named by the page plural (s or es), and keeps the label wording', () => {
  assert.equal(pageWordingOfLabel('Jet Engine', ['Fighter aircraft often have the jet engines buried inside the fuselage.']), 'jet engine');
  assert.equal(pageWordingOfLabel('Branch', ['The three branches of government.']), 'branch');
  assert.equal(pageWordingOfLabel('Wing', ['The wings generate lift.']), 'wing');
});

test('pageWordingOfLabel: unchanged where the page already uses the label, and still null when the page never names it', () => {
  assert.equal(pageWordingOfLabel('Surface Runoff', ['Water flows as runoff.']), 'runoff');
  assert.equal(pageWordingOfLabel('Evaporation', ['Evaporation is the change of state.']), 'evaporation');
  assert.equal(pageWordingOfLabel('Cockpit', ['The pilots sit up front.']), null);
  assert.equal(pageWordingOfLabel('Jet Engine', ['Jet engineering is a field.']), null, 'only s or es, not any longer word');
});

test('phraseOrPluralOccurs: the name, or the name plus s or es, as a whole phrase of the quote', () => {
  assert.equal(phraseOrPluralOccurs('the jet engines buried inside the fuselage', 'jet engine'), true);
  assert.equal(phraseOrPluralOccurs('three branches of government', 'branch'), true);
  assert.equal(phraseOrPluralOccurs('the wing generates lift', 'wing'), true);
  assert.equal(phraseOrPluralOccurs('jet engineering', 'jet engine'), false);
  assert.equal(phraseOrPluralOccurs('the fuselage', 'jet engine'), false);
});
