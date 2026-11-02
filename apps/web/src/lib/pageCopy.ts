// Stage 10c slice D (docs/reviews/ux-pair-review-2-2026-11-02.md: H3, M2, M8 and the Results polish): wording that says what
// the product claims, kept in one place so a test can pin it. What the checks do is stated exactly: they match each quote to
// the stored page and recompute each number; they do not check whether the page itself is right. Pure: no React, no DOM.

/** The line under "Checks behind this lesson" (the checks drawer and the trust receipt). */
export const CHECKS_INTRO = 'Code matches every quote to the page and recomputes every number it calculates. It does not check whether the page itself is right. Open a part to see what it checked.';

/** Where a How it works step can be seen: the entry's NavId in the sidebar. */
export type HowNav = 'checks' | 'demo' | 'results' | 'review';

export interface HowStep {
  title: string;
  body: string;
  /** A link to where a judge can see the step; null for the two steps that happen inside Muse. */
  link: { label: string; nav: HowNav } | null;
}

export const HOW_STEPS: readonly HowStep[] = [
  {
    title: 'Muse Spark reads the page',
    body: 'It decides the subject, writes a short AI-written summary whose key points are tied to the sentences they came from, and plans which interactive parts suit the page.',
    link: null,
  },
  {
    title: 'Muse writes each part from the page',
    body: 'Quiz cards that ask for a prediction first, sequences, sorts, compare tables, formula explorers, simulations, timelines and diagrams to label. Muse writes data for tested components, never code.',
    link: null,
  },
  {
    title: 'Code checks every part',
    body: 'Deterministic checks, not a model: every quote must appear word for word in the stored page, numbers are recomputed by tested engines, and formulas are evaluated by our own parser. The checks match a part to its page, not whether the page itself is right.',
    link: { label: 'See a lesson’s checks', nav: 'checks' },
  },
  {
    title: 'Muse repairs a part that fails a check',
    body: 'The failed checks go back to Muse, which revises only what they name, at most twice. A part that still fails is left out rather than shown without passing its checks.',
    link: { label: 'Watch a repair in the Demo', nav: 'demo' },
  },
  {
    title: 'SAM 3.1 and Muse locate diagram parts',
    body: 'For a diagram to label, Muse Spark locates each part on the figure and SAM 3.1, Meta’s segmentation model, confirms where it is.',
    link: { label: 'See the diagram runs in Results', nav: 'results' },
  },
  {
    title: 'A teacher reviews it',
    body: 'Every lesson is marked AI-written and “Needs review” until a teacher has checked it. Publishing happens on Review and publish: the teacher reads each part, ticks it, and publishes that one lesson.',
    link: { label: 'Open Review and publish', nav: 'review' },
  },
];

/** The summary, described as it is: AI-written, and only the linked quotes are the page's own words (UX review 2, M2). New lesson and the first-run hint reuse it. */
export const AI_SUMMARY_PHRASE = 'a short AI-written summary, each point tied to the sentence it came from';

/** The How it works lede. `pages` is the library phrase ("97 licensed public pages in 10 subjects"). */
export function howLede(pages: string): string {
  return `A teacher picks a page from a library of ${pages}, or pastes their own. Muse Spark, Meta’s model, turns it into a lesson to teach from: ${AI_SUMMARY_PHRASE}, then interactive parts a class can try, each one checked against the page.`;
}

/** The Results page's in-page index: the seven sections, in page order. `key` is the section's element id suffix. */
export const RESULTS_SECTIONS: readonly { key: string; label: string }[] = [
  { key: 'headline', label: 'Headline' },
  { key: 'compare', label: 'Side by side' },
  { key: 'funnel', label: 'What reaches the lesson' },
  { key: 'subjects', label: 'By subject' },
  { key: 'retest', label: 'Timeout retest' },
  { key: 'diagrams', label: 'Diagram lessons' },
  { key: 'method', label: 'How it was made' },
];

/** Under the headline bars: what the bar length means. */
export const BAR_SCALE_NOTE = 'Bars are drawn on a 0–100% scale.';
