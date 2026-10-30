// Stage 7e: one tested sanitiser for model text on screen. Control characters, zero-width characters and bidi overrides
// never reach the page; ordinary text, newlines, tabs and the page's own soft hyphens are kept.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanDisplayText, cleanModelStrings } from './displayText.ts';
import { normaliseJobDetail } from './lessonJob.ts';

const HIDDEN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/u;

test('cleanDisplayText drops control, zero-width and bidi-override characters', () => {
  assert.equal(cleanDisplayText('Ball\u200b on the\u200c Moon\u200d'), 'Ball on the Moon');
  assert.equal(cleanDisplayText('\ufeffMoon surface\u0000 with\u0007 no air\u007f'), 'Moon surface with no air');
  assert.equal(cleanDisplayText('abc\u202edef\u202c'), 'abcdef');
  assert.equal(cleanDisplayText('a\u2066b\u2069c\u2060d'), 'abcd');
  assert.equal(cleanDisplayText('one\u2028two\u2029three'), 'one two three', 'line/paragraph separators read as spaces');
  assert.equal(cleanDisplayText('line\r\nnext'), 'line\nnext');
});

test('cleanDisplayText keeps ordinary text, newlines, tabs, accents, symbols and soft hyphens', () => {
  for (const s of ['Bernoulli’s equation', 'y = V₀² / (2·g)', 'tab\there', 'two\nlines', 'café — ρ, γ, 1.62 m/s²', 'kilo\u00admetre', '']) {
    assert.equal(cleanDisplayText(s), s);
  }
});

test('the scene label that broke the Mach run (thousands of zero-width characters) reads as its words', () => {
  const label = `Air${'\u200b\u200c\u200d\ufeff'.repeat(500)} at sea level`;
  assert.equal(cleanDisplayText(label), 'Air at sea level');
});

test('cleanModelStrings cleans every string in a job detail except the page quotes', () => {
  const raw = {
    title: 'Moon\u200b throw',
    nested: [{ label: 'g\u0007', quote: 'page\u200bwords' }, 3, null, true],
    focusQuote: 'kept\u200b',
  };
  const out = cleanModelStrings(raw) as typeof raw;
  assert.equal(out.title, 'Moon throw');
  assert.equal((out.nested[0] as { label: string }).label, 'g');
  assert.equal((out.nested[0] as { quote: string }).quote, 'page\u200bwords', 'a quote stays verbatim (it must match the page text)');
  assert.equal(out.focusQuote, 'kept\u200b');
  assert.deepEqual(out.nested.slice(1), [3, null, true]);
  assert.equal(raw.title, 'Moon\u200b throw', 'the input is not changed');
});

test('normaliseJobDetail: no hidden characters in model text of a lesson job (headline, labels, reasons)', () => {
  const detail = normaliseJobDetail({
    summary: { jobId: 'job-x', sourceId: 's', status: 'succeeded', flow: 'lesson' },
    events: [{ stage: 'component', status: 'failed', message: 'CT-02\u200b: x' }],
    lesson: {
      jobId: 'job-x', analysisRef: '', overview: null,
      components: [{ componentId: 'compare-table-v1', specId: 'c1', status: 'failed', reason: 'CT-02:\u202e cells', revision: 2 }],
    },
    analysisV2: {
      analysisVersion: 2, subject: 'physics', usable: true, declineCode: '', declineSummary: '', pageCoverage: 'covers\u200b all',
      overview: { headline: 'Ballistic\u200d flight', keyPoints: [{ id: 'p1', point: 'Students\u0007 learn', sourceId: 's', quote: 'page\u200b' }], keyTerms: [] },
      componentPlan: [],
    },
  });
  const strings: string[] = [];
  const walk = (v: unknown, key: string): void => {
    if (typeof v === 'string') { if (key !== 'quote') strings.push(v); return; }
    if (Array.isArray(v)) { for (const x of v) walk(x, key); return; }
    if (typeof v === 'object' && v !== null) for (const [k, x] of Object.entries(v)) walk(x, k);
  };
  walk(detail, '');
  assert.ok(strings.length > 10);
  for (const s of strings) assert.doesNotMatch(s, HIDDEN, JSON.stringify(s));
  assert.equal(detail.lessonData?.analysis?.overview.headline, 'Ballistic flight');
  assert.equal(detail.lessonData?.lesson?.components[0]?.reason, 'CT-02: cells');
});
