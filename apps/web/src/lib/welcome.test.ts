// Stage 10c section 1 (docs/specs/STAGE-10c-first-launch-and-fixes.md): the first-launch Welcome screen, the page
// guide and its Demo prompt. Pure rules only; the screens are checked in the browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  APP_NAME, WELCOME_STATEMENT, demoLengthWords, firstLaunch, guideSteps, nextAllowed, NEXT_GUARD_MS, shouldShowWelcome, welcomeAccess, welcomeCard, welcomeNext, WELCOME_CREDENTIALS,
  WELCOME_STORAGE_KEY,
} from './welcome.ts';
import type { GuideInput } from './welcome.ts';
import type { AccessInfo } from './access.ts';

const info = (o: Partial<AccessInfo> = {}): AccessInfo => ({ gate: true, granted: false, capUSD: 50, spentUSD: 0, remainingUSD: 50, buildsEnabled: true, ...o });

test('Welcome v3: the app name is one constant (provisional) and the statement is one line', () => {
  assert.equal(APP_NAME, 'Make knowledge interactive');
  assert.equal(WELCOME_STATEMENT, 'Turn a page into a lesson you can teach.');
  assert.ok(!/\n/.test(WELCOME_STATEMENT));
});

test('the welcome key is mki.welcome', () => {
  assert.equal(WELCOME_STORAGE_KEY, 'mki.welcome');
});

test('a first plain visit shows the Welcome; once done it does not', () => {
  assert.equal(shouldShowWelcome(null, ''), true);
  assert.equal(shouldShowWelcome('done', ''), false);
  assert.equal(shouldShowWelcome('anything-else', ''), true, 'only "done" counts');
});

test('?welcome=1 forces it, ?welcome=0 suppresses it', () => {
  assert.equal(shouldShowWelcome('done', '?welcome=1'), true);
  assert.equal(shouldShowWelcome(null, '?welcome=0'), false);
});

test('deep links skip the Welcome (lessons, slides, replays, views, the Demo, dev harnesses)', () => {
  for (const q of ['?job=x', '?present=x', '?replay=x', '?view=results', '?tour=1', '?demo=1', '?demo=0', '?lesson-demo=1', '?engine-demo=a']) {
    assert.equal(shouldShowWelcome(null, q), false, q);
  }
  assert.equal(shouldShowWelcome(null, '?job=x&welcome=1'), true, 'an explicit ?welcome=1 still wins');
});

test('first launch: the Welcome replaces the old Demo auto-start; the Demo only opens by itself when forced', () => {
  assert.deepEqual(firstLaunch({ welcome: null, search: '' }), { welcome: true, demo: false });
  assert.deepEqual(firstLaunch({ welcome: 'done', search: '' }), { welcome: false, demo: false }, 'a returning visitor lands on the app');
  assert.deepEqual(firstLaunch({ welcome: null, search: '?tour=1' }), { welcome: false, demo: true }, 'the scripted film path');
  assert.deepEqual(firstLaunch({ welcome: null, search: '?demo=1' }), { welcome: false, demo: true });
  assert.deepEqual(firstLaunch({ welcome: null, search: '?job=x' }), { welcome: false, demo: false });
});

test('welcomeAccess: what the access half of the Welcome shows', () => {
  assert.equal(welcomeAccess({ state: 'loading' }, true), 'checking');
  assert.equal(welcomeAccess({ state: 'locked', info: info() }, true), 'locked');
  assert.equal(welcomeAccess({ state: 'granted', info: info({ granted: true }) }, true), 'granted');
  assert.equal(welcomeAccess({ state: 'off' }, true), 'open');
  assert.equal(welcomeAccess({ state: 'off' }, false), 'live-off', 'gate off but live generation off: never claim builds are open');
  assert.equal(welcomeAccess({ state: 'off' }, null), 'checking');
  assert.equal(welcomeAccess({ state: 'error' }, true), 'unknown');
});

test('welcomeCard: locked, one card with the code field (focused, Enter submits), an or, and Explore read-only', () => {
  const c = welcomeCard('locked', info());
  assert.equal(c.field, 'enabled');
  assert.equal(c.placeholder, 'Enter your access code');
  assert.equal(c.unlockPrimary, true, 'Unlock is the one blue button beside the field');
  assert.equal(c.divider, true);
  assert.deepEqual(c.go, { label: 'Explore read-only', primary: false });
  assert.match(c.note, /judges/i);
});

test('welcomeCard: this local server (gate off, live builds off) keeps the same layout with the field disabled and says why', () => {
  const c = welcomeCard('live-off', null);
  assert.equal(c.field, 'disabled');
  assert.equal(c.note, 'Live builds are off on this server.');
  assert.equal(c.unlockPrimary, false);
  assert.equal(c.divider, true);
  assert.deepEqual(c.go, { label: 'Explore read-only', primary: true }, 'the one thing to do is the blue button');
});

test('welcomeCard: builds open with no gate: no field, says so, and Continue (never "read-only" when builds work)', () => {
  const c = welcomeCard('open', null);
  assert.equal(c.field, 'none');
  assert.match(c.note, /Builds are open on this server/);
  assert.equal(c.divider, false);
  assert.deepEqual(c.go, { label: 'Continue', primary: true });
});

test('welcomeCard: granted shows the dollars left and a primary Continue', () => {
  const c = welcomeCard('granted', info({ granted: true, remainingUSD: 47.12 }));
  assert.equal(c.field, 'none');
  assert.equal(c.note, 'Judge access is on: $47.12 of $50 left.');
  assert.deepEqual(c.go, { label: 'Continue', primary: true });
  assert.equal(welcomeCard('granted', null).note, 'Judge access is on in this browser.');
});

test('welcomeCard: while checking or when access is unknown, the field waits disabled and read-only still works', () => {
  for (const w of ['checking', 'unknown'] as const) {
    const c = welcomeCard(w, null);
    assert.equal(c.field, 'disabled', w);
    assert.deepEqual(c.go, { label: 'Explore read-only', primary: true }, w);
  }
  assert.equal(welcomeCard('checking', null).placeholder, 'Checking access…');
  assert.match(welcomeCard('unknown', null).note, /could not be checked/);
});

test('demoLengthWords: the recorded build at the Demo speed, in plain words', () => {
  // 83 s recorded at 2× = 41 s.
  assert.equal(demoLengthWords('2026-10-31T08:11:05.946Z', '2026-10-31T08:12:28.809Z', 2), 'about 1 minute');
  assert.equal(demoLengthWords('2026-10-31T08:00:00.000Z', '2026-10-31T08:05:00.000Z', 1), 'about 5 minutes');
  assert.equal(demoLengthWords('2026-10-31T08:00:00.000Z', undefined, 2), 'about 1 minute', 'unknown length: the spec wording');
});

const base: GuideInput = {
  library: { pages: 97, subjects: 10 }, access: 'locked', demo: { available: true, length: 'about 1 minute' },
};

test('the guide walks six pages in order, then the Demo prompt', () => {
  const steps = guideSteps(base);
  assert.deepEqual(steps.map((s) => s.id), ['new', 'lesson', 'present', 'checks', 'review', 'results', 'demo']);
  assert.deepEqual(steps.filter((s) => s.counted).map((s) => s.id), ['new', 'lesson', 'present', 'checks', 'review', 'results']);
  assert.deepEqual(steps.map((s) => s.view), ['new', 'lesson', 'lesson', 'lesson', 'review', 'results', 'lesson']);
  assert.equal(steps.find((s) => s.id === 'checks')?.drawer, true, 'the checks step opens the drawer');
  assert.ok(steps.filter((s) => s.id !== 'checks').every((s) => !s.drawer));
});

test('every counted step points at real UI; the Demo prompt is a centred card with Watch / Not now', () => {
  for (const s of guideSteps(base).filter((x) => x.counted)) assert.ok(s.targets.length > 0, s.id);
  const prompt = guideSteps(base).at(-1);
  assert.deepEqual(prompt?.targets, []);
  assert.equal(prompt?.primary.label, 'Watch the demo');
  assert.equal(prompt?.primary.action, 'watch');
  assert.equal(prompt?.secondary?.label, 'Not now');
  assert.match(prompt?.title ?? '', /Watch a lesson being built/);
  assert.match(prompt?.body ?? '', /^Recorded, about 1 minute\./);
});

test('without a recording to play, the guide ends on Try your own page instead of a Demo it cannot show', () => {
  const steps = guideSteps({ ...base, demo: { available: false, length: 'about 1 minute' } });
  const last = steps.at(-1);
  assert.equal(last?.id, 'own');
  assert.equal(last?.primary.action, 'own');
  assert.equal(last?.secondary?.action, 'lessons');
});

test('the guide wording follows the data and the access state', () => {
  const s = guideSteps(base);
  assert.match(s[0]?.body ?? '', /97 licensed pages in 10 subjects/);
  assert.match(s[0]?.body ?? '', /access code/, 'locked: says builds need the code');
  const open = guideSteps({ ...base, access: 'open', library: null });
  assert.doesNotMatch(open[0]?.body ?? '', /access code/);
  assert.match(open[0]?.body ?? '', /licensed pages/);
  // M2: the summary is AI-written; only the linked sentences are the page's words.
  const lesson = s.find((x) => x.id === 'lesson')?.body ?? '';
  assert.match(lesson, /AI-written summary/);
  assert.doesNotMatch(lesson, /page’s own words|page's own words/);
  // H3: the checks never claim the page itself is right.
  const checks = s.find((x) => x.id === 'checks')?.body ?? '';
  assert.match(checks, /does not check whether the page itself is right/);
  assert.doesNotMatch(guideSteps(base).map((x) => `${x.title} ${x.body}`).join(' '), /\btour\b/i, 'it is called Demo');
});

test('L5: Next is ignored for a moment after the step changed (a click meant for the old step)', () => {
  assert.equal(nextAllowed(1000, 1000 + NEXT_GUARD_MS - 1), false);
  assert.equal(nextAllowed(1000, 1000 + NEXT_GUARD_MS), true);
  assert.ok(NEXT_GUARD_MS >= 300 && NEXT_GUARD_MS <= 500);
});

test('welcomeNext: the one line on what comes next counts the guide’s own steps', () => {
  const steps = guideSteps({ ...base, access: 'locked' }).filter((s) => s.counted).length;
  assert.equal(welcomeNext(), `Next: a ${steps}-step guide round the pages, then a recorded demo of a build if you want one.`);
});

test('credential descriptors: the field\'s words and its submit action come from one descriptor (access code wired today)', () => {
  const a = WELCOME_CREDENTIALS.accessCode;
  assert.deepEqual(
    { label: a.label, placeholder: a.placeholder, button: a.button, submit: a.submit },
    { label: 'Judge access code', placeholder: 'Enter your access code', button: 'Unlock', submit: 'access' },
  );
  const k = WELCOME_CREDENTIALS.metaKey;
  assert.deepEqual(
    { label: k.label, placeholder: k.placeholder, button: k.button, helper: k.helper, submit: k.submit },
    { label: 'Meta API key', placeholder: 'Paste your Meta API key', button: 'Turn on live builds', helper: 'Kept on this computer, used only by your local server', submit: 'meta-key' },
  );
  assert.equal(welcomeCard('locked', info()).credential, a, 'the access code is the default');
  const c = welcomeCard('locked', info(), k);
  assert.equal(c.credential, k);
  assert.equal(c.placeholder, 'Paste your Meta API key');
  assert.equal(c.note, 'Kept on this computer, used only by your local server');
  assert.equal(welcomeCard('live-off', null, k).note, 'Live builds are off on this server.', 'state lines do not change with the descriptor');
});
