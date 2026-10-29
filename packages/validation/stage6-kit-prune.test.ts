// S6-V — per-component "drop bad items while the minimum remains" helpers (design §2.2f, §2.3f,
// §2.4f, §2.5d): the pruned gen must be fully publishable, dropped items carry index/id/reason,
// and when the component cannot be saved the frozen design failure message is returned.
// Run: node --test packages/validation/stage6-kit-prune.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  pruneConceptMapLinks, pruneQuizCards, pruneSequenceSteps, pruneSortItems,
  validateKitComponent, KIT_FAILURE_MESSAGES,
} from './kit/index.ts';
import {
  clone, conceptMapGen, dragSource, failedIds, constitutionSource, nijSource,
  NUMBERED_SOURCE, numberedSequenceGen, quizGen, ROCK_SORT_SOURCE, rockSortGen,
  sequenceGen, sortGen,
} from './fixtures/stage6.ts';

test('quiz: a 4th card with a fabricated quote is dropped, 3 remain publishable', () => {
  const gen = clone(quizGen());
  gen.cards.push({
    id: 'fabricated-card',
    stem: 'Which fabricated statement mentions the coefficient only?',
    options: ['drag coefficient', 'static pressure', 'moving pressure'],
    sourceId: 'nasa-grc-drag-equation',
    quote: 'A fabricated quiz sentence naming the drag coefficient only.',
    hint: '',
  });
  assert.deepEqual(failedIds(validateKitComponent('quiz-cards-v1', gen, [dragSource()])), ['Q-01']);
  const result = pruneQuizCards(gen, [dragSource()]);
  assert.equal(result.failureMessage, null);
  assert.ok(result.gen !== null);
  assert.equal(result.gen?.cards.length, 3);
  assert.equal(result.dropped.length, 1);
  assert.equal(result.dropped[0]?.id, 'fabricated-card');
  assert.equal(result.dropped[0]?.index, 3);
  assert.ok(result.dropped[0]?.checks.includes('Q-01'));
  assert.equal(validateKitComponent('quiz-cards-v1', result.gen, [dragSource()]).publishable, true);
});

test('quiz: dropping below the 3-card minimum fails with the frozen message', () => {
  const gen = clone(quizGen());
  gen.cards[0]!.quote = 'A fabricated quiz sentence naming the drag coefficient only.';
  const result = pruneQuizCards(gen, [dragSource()]);
  assert.equal(result.gen, null);
  assert.equal(result.failureMessage, 'Quiz cards could not be verified against the page.');
  assert.equal(result.failureMessage, KIT_FAILURE_MESSAGES['quiz-cards-v1']);
  assert.equal(result.dropped.length, 0);
});

test('quiz: a non-item failure (bad title) cannot be pruned', () => {
  const gen = clone(quizGen());
  gen.title = '';
  const result = pruneQuizCards(gen, [dragSource()]);
  assert.equal(result.gen, null);
  assert.equal(result.failureMessage, KIT_FAILURE_MESSAGES['quiz-cards-v1']);
});

test('sequence: a fabricated step is dropped while 4 remain (numbered basis stays consistent)', () => {
  const gen = clone(numberedSequenceGen());
  gen.steps.push({
    id: 'fabricated-step',
    label: 'transpiration releases water from plants',
    sourceId: 'cycle-numbered',
    quote: 'Fifth, transpiration releases water from plants everywhere.',
    orderHint: '',
  });
  assert.deepEqual(failedIds(validateKitComponent('sequence-v1', gen, [NUMBERED_SOURCE()])), ['SEQ-01']);
  const result = pruneSequenceSteps(gen, [NUMBERED_SOURCE()]);
  assert.equal(result.failureMessage, null);
  assert.equal(result.gen?.steps.length, 4);
  assert.equal(result.dropped[0]?.id, 'fabricated-step');
  assert.equal(validateKitComponent('sequence-v1', result.gen, [NUMBERED_SOURCE()]).publishable, true);
});

test('sequence: dropping below 4 steps fails with the frozen message', () => {
  const gen = clone(sequenceGen());
  gen.steps[1]!.quote = 'A fabricated convention sentence with the label Federal Convention convened.';
  const result = pruneSequenceSteps(gen, [constitutionSource()]);
  assert.equal(result.gen, null);
  assert.equal(result.failureMessage, 'Steps could not be ordered from the page wording.');
});

test('sort: a bad item is dropped while 6 items and 2/group remain', () => {
  const gen = clone(rockSortGen());
  gen.items.push({
    id: 'fabricated-item',
    label: 'fabricated rock sample',
    groupId: 'igneous',
    sourceId: 'rock-sort',
    quote: 'A fabricated rock sentence naming a fabricated rock sample.',
  });
  const before = validateKitComponent('sort-groups-v1', gen, [ROCK_SORT_SOURCE()]);
  assert.ok(failedIds(before).includes('SORT-01'));
  const result = pruneSortItems(gen, [ROCK_SORT_SOURCE()]);
  assert.equal(result.failureMessage, null);
  assert.equal(result.gen?.items.length, 6);
  assert.equal(result.dropped[0]?.id, 'fabricated-item');
  assert.equal(validateKitComponent('sort-groups-v1', result.gen, [ROCK_SORT_SOURCE()]).publishable, true);
});

test('sort: an item whose group sits at the 2-item minimum is not droppable', () => {
  const gen = clone(rockSortGen());
  // Remove one igneous item so the group has exactly 2, then corrupt one of the remaining:
  gen.items = gen.items.filter(it => it.id !== 'cools-slowly');
  gen.items[0]!.quote = 'A granite sample cools slowly, fabricated ending.';
  const result = pruneSortItems(gen, [ROCK_SORT_SOURCE()]);
  // Dropping item 0 would leave 1 igneous item; dropping item 1 would too — no legal prune.
  assert.equal(result.gen, null);
  assert.equal(result.failureMessage, 'Group membership could not be verified against the page.');
});

test('concept map: a fabricated link is dropped while 3 links remain connected', () => {
  const gen = clone(conceptMapGen());
  gen.links.push({
    id: 'fabricated-link',
    fromId: 'density',
    toId: 'velocity',
    relation: 'follows',
    sourceId: 'nasa-grc-drag-equation',
    quote: 'A fabricated sentence naming density and velocity together.',
  });
  const before = validateKitComponent('concept-map-v1', gen, [dragSource()]);
  assert.ok(failedIds(before).includes('CM-01'));
  const result = pruneConceptMapLinks(gen, [dragSource()]);
  assert.equal(result.failureMessage, null);
  assert.equal(result.gen?.links.length, 3);
  assert.equal(result.dropped[0]?.id, 'fabricated-link');
  assert.equal(validateKitComponent('concept-map-v1', result.gen, [dragSource()]).publishable, true);
});

test('concept map: dropping below 3 links fails with the frozen message', () => {
  const gen = clone(conceptMapGen());
  gen.links[0]!.quote = 'A fabricated sentence about the drag coefficient and density.';
  const result = pruneConceptMapLinks(gen, [dragSource()]);
  assert.equal(result.gen, null);
  assert.equal(result.failureMessage, 'Connections could not be verified against the page.');
});

test('sort golden prunes to itself when nothing is broken', () => {
  const result = pruneSortItems(sortGen(), [nijSource()]);
  assert.equal(result.failureMessage, null);
  assert.equal(result.dropped.length, 0);
  assert.equal(result.gen?.items.length, 6);
});
