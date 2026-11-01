/// <reference types="node" />
// UX pair review 2026-11-01, quick wins: one clean credit line, one page claim on the binary-search slide, notes-only decks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { deckFromLesson, figureCredit, NOTES_ONLY_LINE, stageClaim } from './presentation.ts';
import type { KitSpec, LessonSpec } from '../../../../packages/contracts/kit.ts';

test('figureCredit: a licence that repeats the credit names the publisher once', () => {
  assert.equal(
    figureCredit({ credit: 'Credit: U.S. National Library of Medicine', license: 'U.S. Government work (U.S. National Library of Medicine), public domain' }),
    'U.S. National Library of Medicine · U.S. Government work, public domain',
  );
  assert.equal(
    figureCredit({ credit: 'U.S. National Library of Medicine', license: 'U.S. Government work (U.S. National Library of Medicine), public domain' }),
    'U.S. National Library of Medicine · U.S. Government work, public domain',
  );
});

test('figureCredit: conditions after the licence (policy text) are never printed', () => {
  assert.equal(
    figureCredit({ credit: '', license: 'U.S. Government work (NOAA National Weather Service, JetStream), public domain; credit NOAA; AI edits must be disclosed' }),
    'U.S. Government work (NOAA National Weather Service, JetStream), public domain',
  );
  assert.equal(
    figureCredit({ credit: '', license: "U.S. Government work (NASA Glenn Research Center, Beginner's Guide to Aeronautics), generally not subject to copyright; NASA acknowledged as source; no NASA insignia in the figure" }),
    "U.S. Government work (NASA Glenn Research Center, Beginner's Guide to Aeronautics), generally not subject to copyright",
  );
  for (const out of [
    figureCredit({ credit: '', license: 'U.S. Government work (NOAA), public domain; credit NOAA; AI edits must be disclosed' }),
    figureCredit({ credit: 'NOAA', license: 'Public domain. AI edits must be disclosed.' }),
  ]) {
    assert.doesNotMatch(out, /must|disclos/i, out);
  }
});

test('figureCredit: plain cases', () => {
  assert.equal(figureCredit({ credit: 'Jane Doe', license: 'CC BY 4.0' }), 'Jane Doe · CC BY 4.0');
  assert.equal(figureCredit({ credit: '  ', license: '' }), '');
  assert.equal(figureCredit({ credit: 'Credit: NOAA', license: '' }), 'NOAA');
  // a bracket that is NOT the credit stays
  assert.equal(figureCredit({ credit: 'NOAA', license: 'U.S. Government work (NASA), public domain' }), 'NOAA · U.S. Government work (NASA), public domain');
});

test('stageClaim: one page claim on the slide, the one about comparisons the trace counts', () => {
  const claims = [
    { id: 'a', kind: 'running-time', text: 'Run time is O(ln n).', quote: 'Note: Run time is O(ln n).', sourceId: 's' },
    { id: 'b', kind: 'property', text: 'it only performs O(log n) comparisons', quote: 'q', sourceId: 's' },
  ];
  assert.equal(stageClaim(claims)?.id, 'b');
  assert.equal(stageClaim([claims[0]!])?.id, 'a');
  assert.equal(stageClaim([]), null);
  const noCompare = [{ id: 'p', kind: 'property', text: 'Works on sorted lists', quote: 'q', sourceId: 's' }, { id: 'r', kind: 'running-time', text: 'O(n log n) in the worst case', quote: 'q', sourceId: 's' }];
  assert.equal(stageClaim(noCompare)?.id, 'r', 'without a comparisons claim, the running time');
});

function lesson(statuses: readonly ('passed' | 'failed')[]): { lesson: LessonSpec; specs: Record<string, KitSpec> } {
  const specs: Record<string, KitSpec> = {};
  const components = statuses.map((status, i) => {
    const specId = `job:quiz-cards-v1:r${i + 1}`;
    if (status === 'passed') {
      specs[specId] = { componentId: 'quiz-cards-v1', id: specId, title: 'Quiz', cards: [] } as unknown as KitSpec;
    }
    return { componentId: 'quiz-cards-v1', specId, status, revision: 1, reason: '', failedChecks: status === 'passed' ? [] : ['x'], message: status === 'passed' ? '' : 'held back' };
  });
  return {
    lesson: { overview: { headline: 'Water', keyPoints: [{ point: 'p', sourceId: 's', quote: 'q' }], keyTerms: [] }, components } as unknown as LessonSpec,
    specs,
  };
}

test('a lesson whose parts all failed today is a notes-only deck that says so on its title slide', () => {
  const { lesson: l, specs } = lesson(['failed', 'failed']);
  const deck = deckFromLesson({ jobId: 'j', source: null, disclosure: 'AI-generated with Muse Spark 1.3 (Meta).', checks: null, quotes: null, lesson: l, specs, premium: null, analysis: null, fallbackTitle: 'x' });
  assert.equal(deck.parts.length, 0);
  assert.equal(deck.notesOnly, true);
  assert.ok(deck.disclosure.startsWith(NOTES_ONLY_LINE), deck.disclosure);
  assert.equal(NOTES_ONLY_LINE, 'Notes only: no activity passed today’s checks.');
});

test('a lesson with a working part is not notes-only', () => {
  const { lesson: l, specs } = lesson(['passed', 'failed']);
  const deck = deckFromLesson({ jobId: 'j', source: null, disclosure: 'AI-generated.', checks: null, quotes: null, lesson: l, specs, premium: null, analysis: null, fallbackTitle: 'x' });
  assert.equal(deck.notesOnly, false);
  assert.equal(deck.disclosure, 'AI-generated.');
});
