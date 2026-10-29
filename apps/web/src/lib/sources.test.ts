/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { USER_LICENSES, USER_SOURCE_LIMITS, validateUserSourceInput } from '../../../../packages/contracts/index.ts';
import {
  demoFaultOptions, demoFaultToSend, disclosureText, EMPTY_FORM, FREE_CREDITS_NOTE, isHttpUrl, licenseLabel, licenseOptions, problemMessage,
  problemsByField, RIGHTS_LABEL, sourceLicenseText, sourceOptionLabel, sourcePublisher, textCount, validateSourceForm,
  reuseNotice,
} from './sources.ts';
import type { SourceFormValues } from './sources.ts';

const L = USER_SOURCE_LIMITS;
const good = (over: Partial<SourceFormValues> = {}): SourceFormValues => ({
  title: 'Lift basics', text: 'Lift is the force that holds an aircraft up. '.repeat(10), license: 'own-work', attribution: 'Ms Lee, physics teacher',
  link: '', rights: true, ...over,
});

test('textCount: counts the normalised text the server sees, with status and hints', () => {
  const empty = textCount('');
  assert.equal(empty.status, 'empty');
  assert.equal(empty.label, '0 / 8,000 characters');
  const short = textCount('x'.repeat(L.textMin - 1));
  assert.equal(short.status, 'short');
  assert.equal(short.hint, '1 more characters needed (minimum 300).');
  assert.equal(textCount('x'.repeat(L.textMin)).status, 'ok');
  assert.equal(textCount('x'.repeat(L.textMin)).hint, null);
  assert.equal(textCount('x'.repeat(L.textMax)).status, 'ok');
  assert.equal(textCount('x'.repeat(L.textMax)).label, '8,000 / 8,000 characters');
  const long = textCount('x'.repeat(L.textMax + 5));
  assert.equal(long.status, 'long');
  assert.ok(long.hint?.startsWith('5 characters too many'));
  // CRLF counts once, surrounding whitespace is trimmed, control characters are removed (like normalizeUserText)
  assert.equal(textCount('  ab\r\ncd  ').count, 5);
  assert.equal(textCount('a\u0000b\u0007c').count, 3);
});

test('validateSourceForm accepts a good form and returns the contract input', () => {
  const r = validateSourceForm(good({ link: 'https://example.org/lift' }));
  assert.ok(r.ok);
  assert.equal(r.input.title, 'Lift basics');
  assert.equal(r.input.license, 'own-work');
  assert.equal(r.input.locator, 'https://example.org/lift');
  assert.equal(r.input.rightsConfirmed, true);
  const noLink = validateSourceForm(good());
  assert.ok(noLink.ok);
  assert.equal('locator' in noLink.input, false);
});

test('validateSourceForm mirrors USER_SOURCE_LIMITS on every boundary (and agrees with the contract)', () => {
  const cases: { over: Partial<SourceFormValues>; field: string | null }[] = [
    { over: { title: 'ab' }, field: 'title' },
    { over: { title: 'abc' }, field: null },
    { over: { title: 'x'.repeat(L.titleMax) }, field: null },
    { over: { title: 'x'.repeat(L.titleMax + 1) }, field: 'title' },
    { over: { title: '   ' }, field: 'title' },
    { over: { text: 'x'.repeat(L.textMin - 1) }, field: 'text' },
    { over: { text: 'x'.repeat(L.textMin) }, field: null },
    { over: { text: 'x'.repeat(L.textMax) }, field: null },
    { over: { text: 'x'.repeat(L.textMax + 1) }, field: 'text' },
    { over: { attribution: 'ab' }, field: 'attribution' },
    { over: { attribution: 'x'.repeat(L.attributionMax) }, field: null },
    { over: { attribution: 'x'.repeat(L.attributionMax + 1) }, field: 'attribution' },
    { over: { license: '' }, field: 'license' },
    { over: { rights: false }, field: 'rights' },
    { over: { link: 'https://example.org/' + 'a'.repeat(L.locatorMax) }, field: 'link' },
    { over: { link: 'javascript:alert(1)' }, field: 'link' },
    { over: { link: 'example.org/no-scheme' }, field: 'link' },
    { over: { link: '   ' }, field: null },
  ];
  for (const { over, field } of cases) {
    const form = good(over);
    const r = validateSourceForm(form);
    if (field === null) assert.ok(r.ok, JSON.stringify(over).slice(0, 80));
    else {
      assert.ok(!r.ok, JSON.stringify(over).slice(0, 80));
      assert.ok(r.problems[field as keyof typeof r.problems] !== undefined, `${field} for ${JSON.stringify(over).slice(0, 60)}`);
    }
    // the contract validator (what the server runs) agrees on everything except the extra http(s)-only link rule
    if (field !== 'link' && over.link === undefined) {
      const raw = { title: form.title, text: form.text, license: form.license, attribution: form.attribution, rightsConfirmed: form.rights };
      assert.equal(validateUserSourceInput(raw).ok, field === null);
    }
  }
});

test('validateSourceForm reports every problem at once, in plain language', () => {
  const r = validateSourceForm(EMPTY_FORM);
  assert.ok(!r.ok);
  assert.deepEqual(Object.keys(r.problems).sort(), ['attribution', 'license', 'rights', 'text', 'title']);
  assert.equal(r.problems.rights, 'Tick the box to confirm you may use this text with AI models and that it has no personal or student data.');
  assert.equal(r.problems.title, 'The title must be 3–120 characters.');
  assert.equal(r.problems.text, 'The text must be 300–8,000 characters after trimming.');
});

test('problemMessage / problemsByField turn server SOURCE_INVALID codes into field messages', () => {
  assert.equal(problemMessage('LICENSE_INVALID'), 'Choose one of the license options.');
  assert.equal(problemMessage('NOT_AN_OBJECT'), 'The form data was not understood. Reload the page and try again.');
  assert.equal(problemMessage('WEIRD'), 'The server rejected the text (WEIRD).');
  assert.deepEqual(Object.keys(problemsByField(['TEXT_LENGTH', 'RIGHTS_NOT_CONFIRMED', 'LOCATOR_LENGTH'])).sort(), ['link', 'rights', 'text']);
  assert.ok(problemsByField(['WEIRD']).form !== undefined);
});

test('license labels cover every USER_LICENSE and match the stored labels', () => {
  assert.deepEqual(licenseOptions().map((o) => o.value), [...USER_LICENSES]);
  assert.equal(licenseLabel('cc-by'), 'CC BY 4.0');
  assert.equal(licenseLabel('cc-by-sa'), 'CC BY-SA 4.0');
  assert.equal(licenseLabel('public-domain'), 'Public domain');
  assert.equal(licenseLabel('own-work'), "Teacher's own work");
  assert.equal(licenseLabel('permission-granted'), 'Permission granted by the rights holder');
  assert.equal(licenseLabel('mystery'), 'mystery');
  for (const o of licenseOptions()) assert.ok(o.label.length > 3);
});

test('source labels: teacher sources carry the tag and licence, library sources are unchanged', () => {
  const teacher = { title: 'My lift notes', license: 'cc-by', kind: 'user' as const, licenseLabel: 'CC BY 4.0' };
  const library = { title: 'NASA lift', license: 'NASA media guidelines', kind: 'library' as const };
  assert.equal(sourceOptionLabel(teacher), 'My lift notes — Teacher source · CC BY 4.0');
  assert.equal(sourceOptionLabel(library), 'NASA lift');
  assert.equal(sourceOptionLabel({ title: 'Old server source', license: 'x' }), 'Old server source');
  assert.equal(sourceLicenseText(teacher), 'CC BY 4.0');
  assert.equal(sourceLicenseText({ title: 't', license: 'own-work', kind: 'user' }), "Teacher's own work");
  assert.equal(sourceLicenseText(library), 'NASA media guidelines');
});

test('disclosureText names the model that made the activity (OW-3): Spark Open is never credited as Spark 1.3', () => {
  const open = 'Muse Spark Open (Meta’s open weights, hosted on Modal)';
  assert.equal(disclosureText(null, open), `AI-generated with ${open}. The source's publisher has not reviewed or endorsed this lesson.`);
  assert.ok(disclosureText({ title: 't', license: 'cc-by', kind: 'user', licenseLabel: 'CC BY 4.0' }, open).startsWith(`AI-generated with ${open} from a teacher-provided text (`));
  assert.ok(!disclosureText(null, open).includes('1.3'));
});

// ---- P0: the library disclosure names the source's real publisher (never NASA by default) ----------------------

const MADE = 'Muse Spark 1.3 (Meta)';
const publisherSentence = (publisher: string): string =>
  `AI-generated with ${MADE}. Includes material from ${publisher}; ${publisher} has not reviewed or endorsed this lesson.`;
const library = (attribution?: string) =>
  ({ title: 'Library source', license: 'public domain', kind: 'library' as const, ...(attribution === undefined ? {} : { attribution }) });

test('sourcePublisher reads the first comma-separated segment after "Source material:"', () => {
  assert.equal(sourcePublisher("Source material: U.S. Geological Survey, 'Fossils, Rocks, and Time' (1997). Credit: USGS."), 'U.S. Geological Survey');
  assert.equal(sourcePublisher('Source material:  NASA Glenn Research Center , Beginner’s Guide to Aeronautics.'), 'NASA Glenn Research Center');
  assert.equal(sourcePublisher('Source material: U.S. Nuclear Regulatory Commission.'), 'U.S. Nuclear Regulatory Commission');
  // no publisher to name: project-team texts, teacher texts, empty or missing attribution
  assert.equal(sourcePublisher('Written by the Make knowledge interactive project team for testing.'), null);
  assert.equal(sourcePublisher('Provided by a teacher (pasted text)'), null);
  assert.equal(sourcePublisher('Source material: , unnamed work'), null);
  assert.equal(sourcePublisher(''), null);
  assert.equal(sourcePublisher(undefined), null);
});

test('disclosureText names each agency publisher, never NASA by default (P0)', () => {
  const cases: { attribution: string; publisher: string }[] = [
    {
      attribution: "Source material: NASA Glenn Research Center, Beginner's Guide to Aeronautics. NASA content is generally not subject to copyright in the United States.",
      publisher: 'NASA Glenn Research Center',
    },
    {
      attribution: "Source material: National Archives and Records Administration, Milestone Documents, 'Bill of Rights (1791)'. Works of the U.S. Government are in the public domain.",
      publisher: 'National Archives and Records Administration',
    },
    {
      attribution: "Source material: Consumer Financial Protection Bureau, Ask CFPB, 'How does compound interest work?'. Information created by the CFPB.",
      publisher: 'Consumer Financial Protection Bureau',
    },
    {
      attribution: 'Source material: NOAA Office of Ocean Exploration and Research (NOAA Ocean Exploration), education materials, \'Fueling Life on Earth\'.',
      publisher: 'NOAA Office of Ocean Exploration and Research (NOAA Ocean Exploration)',
    },
    {
      attribution: "Source material: U.S. Nuclear Regulatory Commission, 'Backgrounder on Plutonium', Fact Sheets & Brochures.",
      publisher: 'U.S. Nuclear Regulatory Commission',
    },
    {
      attribution: "Source material: U.S. Geological Survey, 'Geologic Age: Using Radioactive Decay to Determine Geologic Age' (1997). Credit: U.S. Geological Survey.",
      publisher: 'U.S. Geological Survey',
    },
    {
      attribution: "Source material: National Institute of Justice, 'Population Genetics and Statistics for Forensic Analysts — Hardy-Weinberg Equilibrium'.",
      publisher: 'National Institute of Justice',
    },
  ];
  for (const { attribution, publisher } of cases) {
    assert.equal(disclosureText(library(attribution)), publisherSentence(publisher), publisher);
    assert.equal(sourcePublisher(attribution), publisher, publisher);
    if (!publisher.includes('NASA')) assert.ok(!disclosureText(library(attribution)).includes('NASA'), publisher);
  }
  // NASA keeps its full agency naming rather than the bare acronym
  assert.ok(disclosureText(library(cases[0]!.attribution)).includes('NASA Glenn Research Center has not reviewed'));
});

test('disclosureText: project-team texts, missing attribution and teacher sources (P0)', () => {
  assert.equal(
    disclosureText(library('Written by the Make knowledge interactive project team for testing.')),
    `AI-generated with ${MADE} from a text written by the project team.`,
  );
  assert.equal(
    disclosureText(library('Written by the Make knowledge interactive project team as a safety test.')),
    `AI-generated with ${MADE} from a text written by the project team.`,
  );
  // no attribution at all: never claim NASA
  assert.equal(disclosureText(library()), `AI-generated with ${MADE}. The source's publisher has not reviewed or endorsed this lesson.`);
  assert.equal(disclosureText(null), `AI-generated with ${MADE}. The source's publisher has not reviewed or endorsed this lesson.`);
  assert.equal(disclosureText({ title: 't', license: 'x' }), `AI-generated with ${MADE}. The source's publisher has not reviewed or endorsed this lesson.`);
  assert.ok(!disclosureText(library()).includes('NASA'));
  // teacher sources are unchanged, even without attribution
  const t = disclosureText({ title: 't', license: 'cc-by', kind: 'user', licenseLabel: 'CC BY 4.0' });
  assert.ok(!t.includes('NASA'));
  assert.ok(t.includes('teacher-provided text (CC BY 4.0)'));
  assert.ok(t.startsWith('AI-generated with Muse Spark 1.3 (Meta)'));
  assert.ok(!disclosureText({ title: 't', license: 'cc-by', kind: 'user', licenseLabel: 'CC BY 4.0', attribution: 'Source material: NASA, x' }).includes('NASA'));
});

test('isHttpUrl only accepts absolute http(s) links', () => {
  assert.equal(isHttpUrl('https://example.org/a?b=1'), true);
  assert.equal(isHttpUrl('http://127.0.0.1:5173/'), true);
  assert.equal(isHttpUrl('javascript:alert(1)'), false);
  assert.equal(isHttpUrl('Provided by a teacher (pasted text)'), false);
  assert.equal(isHttpUrl('ftp://example.org'), false);
  assert.equal(isHttpUrl(''), false);
});

test('required wording is exact', () => {
  assert.equal(FREE_CREDITS_NOTE, 'Requests on the free Meta credits may be used to improve Meta’s models — paste only public-domain, openly licensed or your own text.');
  assert.equal(RIGHTS_LABEL, 'I have the right to use this text with AI models and it contains no personal or student data');
});

test('demo fault options: none + both faults, only system-made faults are ever sent', () => {
  assert.deepEqual(demoFaultOptions().map((o) => o.value), ['none', 'wrong-answer', 'fabricated-quote']);
  assert.equal(demoFaultToSend('none'), undefined);
  assert.equal(demoFaultToSend('wrong-answer'), 'wrong-answer');
  assert.equal(demoFaultToSend('fabricated-quote'), 'fabricated-quote');
});

test('S5-07: a reused source is disclosed with its stored title and licence', () => {
  assert.equal(reuseNotice({ id: 'user-abc', title: 'New title', kind: 'user', reused: false }), null);
  assert.equal(reuseNotice({ id: 'user-abc', title: 'New title', kind: 'user' }), null);
  assert.equal(
    reuseNotice({ id: 'user-abc', title: 'First title', kind: 'user', reused: true, licenseLabel: 'CC BY 4.0' }),
    'This text was already saved as “First title” (CC BY 4.0). Using the existing source; its title, licence and attribution were not changed.',
  );
  assert.equal(
    reuseNotice({ id: 'user-abc', title: 'First title', kind: 'user', reused: true }),
    'This text was already saved as “First title”. Using the existing source; its title, licence and attribution were not changed.',
  );
});
