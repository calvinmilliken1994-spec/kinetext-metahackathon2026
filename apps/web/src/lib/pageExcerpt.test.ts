// Welcome v3 (docs/specs/WELCOME-V3-split.md): the clean excerpt of a source page with the one sentence a part was
// written from lit. Pure rules on real stored page text (copied from GET /api/sources/:id, all US Government works).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pageExcerpt } from './pageExcerpt.ts';
import type { PageExcerpt } from './pageExcerpt.ts';

// usagov-branches-of-government (start of the page)
const GOV = '# Branches of the U.S. government\n\nLearn about the legislative, judicial, and executive branches of the U.S. government.\n\nWhat are the three branches of government?\n\nThe Constitution of the United States divides the federal government into three branches:\n\n1. Legislative\n\n2. Judicial\n\n3. Executive\n\nThis ensures that no individual or group will have too much power.\n\nLegislative branch\n\nThe legislative branch is made up of Congress:\n\n\u2022 The U.S. Senate\n\n\u2022 The U.S. House of Representatives\n\nIt also includes special agencies and offices that provide support services to Congress.\n\nThe legislative branch\u2019s key roles include:\n\n\u2022 Drafting proposed laws\n\nJudicial branch\n\nThe judicial branch includes the Supreme Court and other federal courts.\n';

// nasa-grc-motion-of-free-falling-object (middle of the page)
const FALL = 'With algebra we can solve for the acceleration of a free falling object. The acceleration is constant and equal to the gravitational acceleration g which is 9.8 meters per square second at sea level on the Earth. The weight, size, and shape of the object are not a factor in describing a free fall. In a vacuum, a beach ball falls with the same acceleration as an airliner. Knowing the acceleration, we can determine the velocity and location of any free falling object at any time using the following equations.\n\nV = a * t\n\nX = (1 / 2) * a * t^2\n\nwhere a is the acceleration, V is the velocity, and X is the displacement from an initial location. If the object falls through the atmosphere, there is an additional drag force acting on the object and the physics involved with describing the motion of the object is more complex.\n\nTable\n\nHere is a table of calculated acceleration (meters per second squared), velocity (meters per second), and displacement (meters) at 1 second intervals.\n\n| Time/Sec | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |\n| Accel \u2013 m/sec^2 | 9.8 | 9.8 | 9.8 |\n';

// nara-voting-rights-act (start of the page)
const VRA = '# Voting Rights Act (1965)\n\nThis \u201cact to enforce the fifteenth amendment to the Constitution\u201d was signed into law 95 years after the amendment was ratified. In those years, African Americans in the South faced tremendous obstacles to voting, including poll taxes, literacy tests, and other bureaucratic restrictions to deny them the right to vote. They also risked harassment, intimidation, economic reprisals, and physical violence when they tried to register or vote. As a result, African-American voter registration was limited, along with political power.\n\nIn 1964, numerous peaceful demonstrations were organized by Civil Rights leaders.\n';

// ftc-phishing-scams (middle of the page)
const PHISHING = 'How To Protect Yourself From Phishing Attacks\n\nYour email spam filters might keep many phishing emails out of your inbox. But scammers are always trying to outsmart spam filters, so extra layers of protection can help. Here are four ways to protect yourself from phishing attacks.\n\nFour Ways To Protect Yourself From Phishing\n\n1. Protect your computer by using security software. Set the software to update automatically so it will deal with any new security threats.\n\n2. Protect your cell phone by setting software to update automatically. These updates could give you critical protection against security threats.\n';

const flat = (e: PageExcerpt): string[] => e.blocks.flatMap((b) => b.pieces.map((p) => p.text));
const lit = (e: PageExcerpt): string[] => e.blocks.flatMap((b) => b.pieces.filter((p) => p.lit).map((p) => p.text));
const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();

test('pageExcerpt: a quote that is part of a sentence lights the WHOLE page sentence, once', () => {
  const e = pageExcerpt(VRA, 'African Americans in the South faced tremendous obstacles to voting, including poll taxes, literacy tests, and other bureaucratic restrictions');
  assert.ok(e !== null);
  assert.deepEqual(lit(e), ['In those years, African Americans in the South faced tremendous obstacles to voting, including poll taxes, literacy tests, and other bureaucratic restrictions to deny them the right to vote.']);
  assert.equal(e.lit, lit(e)[0]);
});

test('pageExcerpt: neighbours round the lit sentence come from the page, in page order, within the budget', () => {
  const e = pageExcerpt(VRA, 'They also risked harassment, intimidation, economic reprisals, and physical violence when they tried to register or vote.', { before: 200, after: 120 })!;
  const texts = flat(e);
  const at = texts.map((t) => norm(VRA).indexOf(t));
  assert.ok(at.every((i) => i >= 0), 'every piece is the page’s own words');
  assert.deepEqual([...at].sort((a, b) => a - b), at, 'page order');
  const li = texts.findIndex((t) => t.startsWith('They also risked'));
  const before = texts.slice(0, li).filter((t) => !t.startsWith('Voting Rights Act')).join(' ').length;
  const after = texts.slice(li + 1).join(' ').length;
  assert.ok(before > 0 && before <= 200, `before ${before}`);
  assert.ok(after > 0 && after <= 120, `after ${after}`);
});

test('pageExcerpt: a markdown heading directly above is kept as a heading (marks stripped) and context stops there', () => {
  const e = pageExcerpt(VRA, 'This \u201cact to enforce the fifteenth amendment to the Constitution\u201d was signed into law')!;
  assert.deepEqual(e.blocks[0], { kind: 'heading', pieces: [{ text: 'Voting Rights Act (1965)', lit: false }] });
  assert.equal(e.blocks[1]!.pieces[0]!.lit, true);
});

test('pageExcerpt: a section heading bounds the context (nothing from the section before), bullets after are items', () => {
  const e = pageExcerpt(GOV, 'The legislative branch is made up of Congress:')!;
  assert.deepEqual(e.blocks.map((b) => b.kind).slice(0, 5), ['heading', 'text', 'item', 'item', 'text']);
  assert.equal(e.blocks[0]!.pieces[0]!.text, 'Legislative branch');
  assert.equal(e.lit, 'The legislative branch is made up of Congress:');
  assert.equal(e.blocks[2]!.pieces[0]!.text, '\u2022 The U.S. Senate', 'abbreviations (U.S.) never split a sentence');
  assert.ok(!flat(e).some((t) => t.startsWith('Judicial')), 'the next section heading ends the excerpt');
});

test('pageExcerpt: a formula line is lit on its own, with the prose that introduces it', () => {
  const e = pageExcerpt(FALL, 'V = a * t')!;
  assert.equal(e.lit, 'V = a * t');
  const litBlock = e.blocks.find((b) => b.pieces.some((p) => p.lit))!;
  assert.deepEqual(litBlock, { kind: 'text', pieces: [{ text: 'V = a * t', lit: true }] }, 'a line with = is not taken for a heading');
  assert.ok(flat(e).some((t) => t.startsWith('Knowing the acceleration')), 'the sentence before it on the page');
  assert.ok(!flat(e).some((t) => t.startsWith('|')), 'never a markdown table row');
});

test('pageExcerpt: a numbered list item keeps its number with its sentence', () => {
  const e = pageExcerpt(PHISHING, '1. Protect your computer by using security software.')!;
  assert.equal(e.lit, '1. Protect your computer by using security software.');
  assert.deepEqual(e.blocks[0], { kind: 'heading', pieces: [{ text: 'Four Ways To Protect Yourself From Phishing', lit: false }] });
  assert.equal(e.blocks[1]!.kind, 'item');
});

test('pageExcerpt: a quote across two sentences lights both, as one lit run', () => {
  const e = pageExcerpt(VRA, 'to deny them the right to vote. They also risked harassment')!;
  assert.equal(lit(e).length, 1);
  assert.match(e.lit, /^In those years,.*right to vote\. They also risked harassment.*register or vote\.$/);
});

test('pageExcerpt: nothing is lit that the page does not say; table rows and empty input give no excerpt', () => {
  assert.equal(pageExcerpt(VRA, 'Clouds are made of cotton.'), null);
  assert.equal(pageExcerpt(VRA, ''), null);
  assert.equal(pageExcerpt('', 'x'), null);
  assert.equal(pageExcerpt(FALL, '| Time/Sec | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |'), null, 'a table row is not a sentence to light');
});

test('pageExcerpt: whitespace and line breaks inside the page do not stop the match (PDF text)', () => {
  const pdf = 'The sooner you start saving in an account that pays interest, the faster your money can grow.\nThat\'s because of the effect of compound interest. Compound interest is when you earn interest on both the\nmoney you save and the interest you earn.';
  const e = pageExcerpt(pdf, 'Compound interest is when you earn interest on both the money you save and the interest you earn.')!;
  assert.equal(e.lit, 'Compound interest is when you earn interest on both the money you save and the interest you earn.');
});
