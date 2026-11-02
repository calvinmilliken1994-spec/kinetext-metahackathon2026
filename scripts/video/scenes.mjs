// The seven demo scenes (docs/video/SCRIPT.md draft 2, docs/video/CAPTURE.md). Each scene is a list of steps the driver
// plays in order; `say(line)` is a pause as long as Calvin takes to read that voiceover line (about 2.6 words a second),
// so the screen holds while he talks. Tune a beat by editing the line's pause, not the driver.

const WORDS_PER_SECOND = 2.6;
const words = (line) => line.split(/\s+/).filter((w) => /[\p{L}\d]/u.test(w)).length;
/** Hold the screen for as long as this voiceover line takes to read. */
const say = (line, extraMs = 0) => ({ pause: Math.round((words(line) / WORDS_PER_SECOND) * 1000) + extraMs, name: `say "${line.slice(0, 48)}…"` });
const hold = (ms, name = 'hold') => ({ pause: ms, name });

const nav = (id) => `nav.sidebar button[data-nav="${id}"]`;
const clearWelcome = { name: 'clear the Welcome\'s first-launch state', run: (d) => d.eval("try { localStorage.removeItem('mki.welcome') } catch {}") };

/** When a scene is played on its own, open the screen the previous scene would have left (no reload otherwise). */
const ensure = (css, path) => ({
  name: `on ${css}`,
  run: async (d) => { if (await d.find(d.norm(css)) === null) await d.goto(typeof path === 'function' ? path(d.ctx) : path); },
});

/** Scenes 4-5 act on the run scene 3 built in this session, else on --job. */
const lessonUrl = (ctx) => {
  if (ctx.job === null) throw new Error('scenes 4-5 need a run: build it in scene 3, or pass --job <id>');
  return `/?job=${encodeURIComponent(ctx.job)}&welcome=0&tour=0`;
};

/** Which number on the diagram is Magma: the app numbers parts in the order of the latest label-diagram spec. */
async function findMagma(d) {
  const res = await fetch(`${d.ctx.base}/api/jobs/${encodeURIComponent(d.ctx.job)}`);
  if (!res.ok) throw new Error(`GET job ${d.ctx.job}: HTTP ${res.status}`);
  const detail = await res.json();
  const specs = Object.values(detail.kitSpecs ?? {}).filter((s) => s.componentId === 'label-diagram-v1');
  const spec = specs.sort((a, b) => (b.provenance?.revision ?? 0) - (a.provenance?.revision ?? 0))[0];
  const i = spec?.parts.findIndex((p) => p.name.trim().toLowerCase() === 'magma') ?? -1;
  if (i < 0) throw new Error(`run ${d.ctx.job} has no "magma" on its labelled diagram`);
  d.ctx.magma = i + 1;
  console.log(`  Magma is number ${d.ctx.magma} on the diagram.`);
}

/** Tick every part's "I've read the wording" box, one at a time, the way a teacher would. */
async function tickAll(d) {
  const box = 'section.rv-section label.rv-check:has(input:not(:checked):not(:disabled))';
  let n = 0;
  for (; n < 12; n++) {
    if (await d.find(d.norm(box)) === null) break;
    await d.click(box);
    await new Promise((r) => setTimeout(r, 550));
  }
  console.log(n === 0 ? '  No boxes to tick (this run is already published, or publishing is locked).' : `  Ticked ${n} part(s).`);
}

/** Dry runs only: say whether the (unverified) model picker and Build selectors are on screen, without waiting long. */
async function probeBuild(d) {
  for (const [what, css] of [['model picker', 'label[for="model-muse-spark-1.3"]'], ['Build button', '.nl-go-btn'], ['Build area', '[data-testid="build-area"]']]) {
    const box = await d.find(d.norm(css));
    const state = box === null ? 'absent' : css === '.nl-go-btn'
      ? (await d.eval(`document.querySelector('.nl-go-btn')?.disabled`) ? 'present, disabled' : 'present, enabled')
      : 'present';
    console.log(`  ${what} (${css}): ${state}`);
  }
  if (d.opts.dry) await d.shot('scene-3-page-chosen');
}

const LINES = {
  s1: 'Hi, I\'m Calvin. I built this on my own during the hackathon. Before October 27th, this repo held a setup scaffold and no product. Everything you\'re about to see was built between October 27th and November 4th.',
  s2: 'It\'s for teachers. Pick a licensed page, or paste your own, and Meta\'s models turn it into a short lesson with interactive parts. Each part is tied to the sentence it came from and checked against the page. These are lessons it built earlier.',
  s3: 'This is a live build on Muse Spark 1.3, through Meta\'s Model API.',
  s4a: 'Students drag each name onto its number, and nothing is marked until they check.',
  s4b: 'Checks and run details shows every check behind the lesson,',
  s4c: 'and when Muse revised a part, which check failed, what it changed, and the figure before and after.',
  s5a: 'Every lesson says "Needs review" until a teacher reads each part and publishes it.',
  s5b: 'Published lessons go on the shelf: ten so far, across nine subjects.',
  s6a: 'It runs on two Meta models: Muse Spark 1.3 on Meta\'s API, and Muse Spark Open, the open-weight model, served on Modal.',
  s6b: 'I built 194 lessons with each. Spark 1.3 made a working lesson 189 times, Spark Open 178.',
  s6c: 'Muse\'s own repairs rescued 45 parts on Spark 1.3 and 70 on Spark Open.',
  s7a: 'Judges get an access code that runs live builds on my credits,',
  s7b: 'or you can explore read-only with every recorded lesson.',
  s7c: 'Kinetext: make knowledge interactive.',
};

export const SCENES = [
  {
    title: 'Before and after (Welcome montage)', scriptSecs: 14, firstLine: LINES.s1,
    steps: [
      clearWelcome,
      { goto: '/?welcome=1' },
      { wait: '[data-testid="welcome-card"]' },
      // Wait for the access check to settle, so the card never reads "Checking access…" on camera.
      { wait: '[data-testid="welcome"]:not([data-access="checking"])' },
      // Rest the cursor off the card, low on the right, so it is on screen but not in the way of the montage.
      { park: [1640, 880], ms: 600 },
      say(LINES.s1, -3500), // the load, the access check and the cursor glide cover the first seconds
      { shot: 'scene-1-welcome' },
    ],
  },
  {
    title: 'What it does (montage, then New lesson)', scriptSecs: 16, firstLine: LINES.s2,
    steps: [
      ensure('[data-testid="welcome-card"]', '/?welcome=1'),
      { wait: '[data-testid="welcome-card"]' },
      say(LINES.s2, -2000),
      // The Welcome covers the app, so its way in is "Explore read-only"; the cut goes straight to New lesson
      // (with the guide and tour off), which CAPTURE.md allows: clicking it would start the first-run guide.
      { move: '[data-testid="welcome-continue"]' },
      hold(500, 'on the way in'),
      { goto: '/?view=new&welcome=0&tour=0' },
      { wait: '[data-testid="new-lesson-page"]' },
      { shot: 'scene-2-new-lesson' },
    ],
  },
  {
    title: 'Live build (screen-only, voiced afterwards)', scriptSecs: 60, firstLine: LINES.s3,
    steps: [
      ensure('[data-testid="new-lesson-page"]', '/?view=new&welcome=0&tour=0'),
      { wait: '[data-testid="new-lesson-page"]' },
      // Only when not already on: pressing the active chip again would switch the filter off.
      { click: { css: '.page-new .subject-chip[aria-pressed="false"]', text: 'Earth & space' }, optional: true, name: 'Earth & space' },
      hold(700),
      { click: { css: '.page-new label.nl-row', text: 'What Are Volcano Hazards?' }, expect: { css: '.page-new label.nl-row.is-on', text: 'What Are Volcano Hazards?' } },
      { wait: { css: '[data-testid="page-preview"] .nl-preview-title', text: 'What Are Volcano Hazards?' } },
      hold(900, 'let the preview settle'),
      // A read-only server has no build path: only report whether the model picker and Build exist, then stop.
      { name: 'probe model picker and Build', run: probeBuild },
      { dryStop: 'Build is not pressed on a read-only server' },
      // UNVERIFIED until the live take: selectors read from ModelPicker.tsx (label for="model-<id>") and
      // NewLessonPage.tsx BuildArea (button.nl-go-btn "Build lesson"); a read-only API never renders them enabled.
      { click: 'label[for="model-muse-spark-1.3"]', expect: 'label.model-option-on[for="model-muse-spark-1.3"]' },
      hold(600),
      { move: '.nl-go-btn:not(:disabled)', name: 'cursor to Build' },
      { shot: 'scene-3-before-build' },
      { click: '.nl-go-btn:not(:disabled)', name: 'Build' },
      // The lesson view opens on the new run; keep still until the strip says how it ended (a live build: 6 min cap).
      { park: [1640, 1000], ms: 700 },
      { wait: '[data-testid="live-bar"]:not([data-state="running"])', timeout: 6 * 60_000, name: 'build finished' },
      { name: 'build outcome', run: async (d) => {
        const ok = await d.find(d.norm('[data-testid="live-bar"][data-state="ready"]'));
        console.log(ok !== null ? '  Lesson ready.' : '  WARNING: the build did not end in "Lesson ready": re-take.');
      } },
      hold(4000, 'hold on Lesson ready'),
      { shot: 'scene-3-lesson-ready' },
    ],
  },
  {
    title: 'Use it, and see how it was checked', scriptSecs: 25, firstLine: LINES.s4a,
    steps: [
      { name: 'open the lesson', run: async (d) => { if (d.ctx.builtJob === null) await d.goto(lessonUrl(d.ctx)); } },
      { name: 'which number is Magma', run: findMagma },
      // LINES.s4a is read over the scroll, the two clicks and Check.
      { scroll: '[data-testid="label-diagram"][data-mode="lesson"]', block: 'start', ms: 1000 },
      hold(300),
      // Click-to-place: choose the name in the word bank, then its number on the diagram.
      { click: '[data-testid="label-diagram"][data-mode="lesson"] button.ld-chip[aria-label^="magma" i]' },
      hold(400),
      { click: (ctx) => `[data-testid="label-diagram"][data-mode="lesson"] button.ld-marker[aria-label^="Number ${ctx.magma} on the diagram"]` },
      hold(400),
      { click: { css: '[data-testid="label-diagram"][data-mode="lesson"] .ld-actions button', text: 'Check' } },
      { shot: 'scene-4-checked' },
      hold(1000, 'the result line'),
      { click: nav('checks') },
      { wait: '[data-testid="runs-drawer"]' },
      hold(400),
      { scroll: '[data-testid="lesson-checks"]', block: 'start', ms: 900 },
      say(LINES.s4b),
      { scroll: '[data-testid="repair-story"]', block: 'start', ms: 1000, optional: true, name: 'repair story' },
      { shot: 'scene-4-drawer' },
      say(LINES.s4c, -1000),
    ],
  },
  {
    title: 'A teacher signs off', scriptSecs: 20, firstLine: LINES.s5a,
    steps: [
      ensure(nav('review'), lessonUrl),
      // The drawer from scene 4 closes when another view opens; the amber notice only shows on an unpublished lesson.
      // LINES.s5a is read from the notice through the ticks.
      { move: '[data-testid="review-notice"]', optional: true, name: 'Needs review notice' },
      hold(1500, 'on the notice'),
      { click: ['[data-testid="review-notice"] .review-notice-link', nav('review')] },
      { wait: '[data-testid="review-page"]' },
      hold(700),
      { name: 'tick each part', run: tickAll },
      { move: { css: 'section.rv-publish button.btn-primary', text: 'Publish' }, optional: true, name: 'cursor to Publish' },
      { shot: 'scene-5-ticked' },
      { click: { css: 'section.rv-publish button.btn-primary', text: 'Publish' }, skipInDry: true, name: 'Publish' },
      { wait: { css: '[data-testid="review-status-message"]', text: 'Published.' }, skipInDry: true, name: 'published' },
      hold(1200),
      { click: nav('all-lessons') },
      { wait: '[data-testid="published-shelf"]' },
      { scroll: '[data-testid="published-shelf"]', block: 'start', ms: 1000 },
      { park: [1640, 1000], ms: 600 },
      { shot: 'scene-5-shelf' },
      say(LINES.s5b, 1500),
    ],
  },
  {
    title: 'Two Meta models, measured (Results)', scriptSecs: 30, firstLine: LINES.s6a,
    steps: [
      { click: nav('results') },
      { wait: '#results-headline' },
      { park: [1640, 1000], ms: 600 },
      { shot: 'scene-6-headline' },
      say(LINES.s6a),
      say(LINES.s6b, -1000),
      { scroll: '#results-compare', block: 'start', ms: 3000, name: 'slow scroll to the comparison' },
      hold(2500, 'on the comparison'),
      { shot: 'scene-6-compare' },
      { scroll: '#results-funnel', block: 'start', ms: 3000, name: 'slow scroll to the parts funnel' },
      { shot: 'scene-6-funnel' },
      say(LINES.s6c),
    ],
  },
  {
    title: 'Try it (Welcome again)', scriptSecs: 12, firstLine: LINES.s7a,
    steps: [
      clearWelcome,
      { goto: '/?welcome=1' },
      { wait: '[data-testid="welcome-card"]' },
      // Wait for the access check to settle, so the card never reads "Checking access…" on camera.
      { wait: '[data-testid="welcome"]:not([data-access="checking"])' },
      // The access code field; on the local live server the card shows a status line instead ("No code needed here").
      { move: ['[data-testid="welcome-card"] input', '[data-testid="welcome-card"] .wl-status'] },
      { shot: 'scene-7-code' },
      say(LINES.s7a, -2500), // read over the load and the access check
      { move: '[data-testid="welcome-continue"]' },
      say(LINES.s7b),
      { shot: 'scene-7-explore' },
      hold(4000, 'closing line: ' + LINES.s7c),
    ],
  },
];
