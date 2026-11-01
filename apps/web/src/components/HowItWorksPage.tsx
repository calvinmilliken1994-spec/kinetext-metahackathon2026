// Stage 10 (docs/specs/STAGE-10-navigation-and-access.md, section B): How it works, a short honest page, plus the calm
// placeholders for Review and publish and Results (a later slice builds those pages). Wording reuses the README, the
// demo and the model picker; nothing here claims more than the product does.
import { useId } from 'react';
import type { Access } from '../lib/access.ts';
import { formatUSD } from '../lib/access.ts';
import { MODAL_PROVIDER_MODEL, MODEL_EXPLAINER } from '../lib/models.ts';
import { IconDemo } from './navIcons.tsx';
import { IconNewLesson } from './icons.tsx';

export interface HowItWorksProps {
  /** Active licensed pages and subjects, once the list has loaded. */
  library: { pages: number; subjects: number } | null;
  access: Access;
  onDemo: () => void;
  onNewLesson: () => void;
  onEnterCode: () => void;
}

const STEPS: { title: string; body: string }[] = [
  {
    title: 'Muse Spark reads the page',
    body: 'It decides the subject, writes a short summary whose key points are tied to the sentences they came from, and plans which interactive parts suit the page.',
  },
  {
    title: 'Muse writes each part from the page',
    body: 'Quiz cards that ask for a prediction first, sequences, sorts, compare tables, formula explorers, simulations, timelines and diagrams to label. Muse writes data for tested components, never code.',
  },
  {
    title: 'Code checks every part',
    body: 'Deterministic checks, not a model: every quote must appear word for word in the stored page, numbers are recomputed by tested engines, and formulas are evaluated by our own parser.',
  },
  {
    title: 'Muse repairs a part that fails a check',
    body: 'The failed checks go back to Muse, which revises only what they name, at most twice. A part that still fails is left out of the lesson rather than shown wrong.',
  },
  {
    title: 'SAM 3.1 and Muse locate diagram parts',
    body: 'For a diagram to label, Muse Spark locates each part on the figure and SAM 3.1, Meta’s segmentation model, confirms where it is.',
  },
  {
    title: 'A teacher reviews it',
    body: 'Every lesson is marked AI-written and “Teacher review pending” until a teacher has checked it.',
  },
];

export function HowItWorksPage({ library, access, onDemo, onNewLesson, onEnterCode }: HowItWorksProps) {
  const uid = useId();
  const pages = library === null ? 'licensed public pages' : `${library.pages} licensed public pages in ${library.subjects} subjects`;
  return (
    <div className="page page-how" data-testid="how-page">
      <header className="page-head">
        <h1 className="page-title" tabIndex={-1} data-view-title>How it works</h1>
        <p className="page-lede">
          A teacher picks a page from a library of {pages}, or pastes their own. Muse Spark, Meta’s model, turns it into a
          lesson to teach from: a short summary in the page’s own words, then interactive parts a class can try, each one
          checked against the page.
        </p>
      </header>

      <section className="how-section" aria-labelledby={`${uid}-steps`}>
        <h2 id={`${uid}-steps`}>How a lesson is built</h2>
        <ol className="how-steps">
          {STEPS.map((s) => (
            <li key={s.title}>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="how-section" aria-labelledby={`${uid}-models`}>
        <h2 id={`${uid}-models`}>Two models, one pipeline</h2>
        <dl className="how-models">
          <div>
            <dt>Muse Spark 1.3</dt>
            <dd>Meta’s hosted model, called through the Meta Model API.<code>muse-spark-1.3</code></dd>
          </div>
          <div>
            <dt>Muse Spark Open</dt>
            <dd>Meta’s open-weight model, hosted on Modal.<code>{MODAL_PROVIDER_MODEL}</code></dd>
          </div>
        </dl>
        <p className="how-note">{MODEL_EXPLAINER} You choose the model for each build on the New lesson page.</p>
      </section>

      <section className="how-section" aria-labelledby={`${uid}-you`}>
        <h2 id={`${uid}-you`}>What you can do here</h2>
        <div className="how-can">
          <div>
            <h3>Without an access code</h3>
            <ul>
              <li>Open any finished lesson from All lessons and try its parts as a student would.</li>
              <li>Present a lesson full screen, one step at a time.</li>
              <li>Watch a recorded build in the Demo, and read each lesson’s checks and run details.</li>
            </ul>
          </div>
          <div>
            <h3>With the judge access code</h3>
            <ul>
              <li>Build new lessons from library pages or from your own text.</li>
              <li>Choose either model for each build.</li>
              <li>
                Builds share one budget
                {access.state === 'granted' || access.state === 'locked' ? ` of ${formatUSD(access.info.capUSD)}` : ''}; when it is used up,
                everything else keeps working.
              </li>
            </ul>
          </div>
        </div>
        {access.state === 'granted' && (
          <p className="how-state" role="status">Judge access is on: {formatUSD(access.info.remainingUSD)} of {formatUSD(access.info.capUSD)} left.</p>
        )}
      </section>

      <div className="how-actions">
        <button type="button" className="btn btn-primary" onClick={onDemo}><IconDemo size={18} />Start the demo</button>
        <button type="button" className="btn" onClick={onNewLesson}><IconNewLesson size={18} />New lesson</button>
        {access.state === 'locked' && <button type="button" className="btn btn-quiet" onClick={onEnterCode}>Enter access code</button>}
      </div>
    </div>
  );
}
