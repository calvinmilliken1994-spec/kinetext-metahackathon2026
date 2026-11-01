// Stage 10b slice R (docs/specs/STAGE-10b-review-and-results.md): Review and publish, a main-area page for the open lesson.
// A teacher reads each part's wording, ticks it, may hide parts from the lesson and the slides, then publishes: that ONE
// lesson's status reads "Reviewed by a teacher · published <date>" and its parts "AI-written · teacher-reviewed". Unpublish
// puts everything back. Read-only visitors (judge gate on, no session) see the checklist disabled with the access form.
import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../api.ts';
import type { JobDetail } from '../api.ts';
import type { Access } from '../lib/access.ts';
import {
  clearDraft, getDraft, notifyReviewChanged, publishBody, publishReadiness, requestPartFocus, reviewAccess, reviewAvailability, reviewDate,
  reviewedStatus, reviewErrorMessage, reviewModel, setDraft, toggleChecked, toggleHidden, REVIEW_ACCESS_INTRO,
} from '../lib/review.ts';
import type { ReviewDraft, ReviewRow } from '../lib/review.ts';
import type { ReviewState } from '../lib/reviewState.ts';
import { AccessForm } from './AccessForm.tsx';
import { IconExternal, Mark } from './icons.tsx';
import '../styles/review.css';

export interface ReviewPageProps {
  /** The open lesson's detail (App's `ready`); null when no lesson is open or it has not loaded yet. */
  detail: JobDetail | null;
  /** The open lesson's page title, or null when no lesson is open. */
  title: string | null;
  /** Judge access (useAccess): who may publish. */
  access: Access;
  onAccess: (a: Access) => void;
  /** Back to the lesson in the main area (navigate('lesson')). */
  onShowLesson: () => void;
  /** To All lessons (navigate('lessons')), for the visitor who has no lesson open. */
  onBrowseLessons: () => void;
}

const HEADING = 'Review and publish';

function Shell({ children, lede }: { children?: ReactNode; lede: ReactNode }) {
  return (
    <div className="page page-review" data-testid="review-page">
      <header className="page-head">
        <h1 className="page-title" tabIndex={-1} data-view-title>{HEADING}</h1>
        <p className="page-lede">{lede}</p>
      </header>
      {children}
    </div>
  );
}

export function ReviewPage(p: ReviewPageProps) {
  const { detail } = p;
  if (detail === null) {
    return p.title === null ? (
      <Shell lede="Open a lesson to read its wording, hide parts you would not teach, and publish it.">
        <p><button type="button" className="btn btn-primary" onClick={p.onBrowseLessons}>Choose a lesson</button></p>
      </Shell>
    ) : <Shell lede="Loading the lesson…" />;
  }
  const availability = reviewAvailability(detail);
  if (availability !== 'ready') {
    const why = availability === 'building' ? 'This lesson is still being built. Review opens when it has finished.'
      : availability === 'activity' ? 'This is a single-activity run, not a lesson. Teacher review applies to lessons.'
      : 'No part of this lesson passed its checks, so there is nothing to review.';
    return (
      <Shell lede={why}>
        <p><button type="button" className="btn" onClick={p.onShowLesson}>Back to the lesson</button></p>
      </Shell>
    );
  }
  return <ReviewBody key={detail.summary.jobId} {...p} detail={detail} />;
}

type Override = { review: ReviewState | null } | null;
const sameReview = (a: ReviewState | null, b: ReviewState | null): boolean => (a === null ? b === null : b !== null && a.publishedAt === b.publishedAt);

function ReviewBody({ detail, title, access, onAccess, onShowLesson }: ReviewPageProps & { detail: JobDetail }) {
  const uid = useId();
  const jobId = detail.summary.jobId;
  const stored = detail.lessonData?.review ?? null;
  // Right after a publish or unpublish the page shows the server's answer; it lets go once the lesson has been read again.
  const [override, setOverride] = useState<Override>(null);
  useEffect(() => { if (override !== null && sameReview(override.review, stored)) setOverride(null); }, [override, stored]);
  const review = override === null ? stored : override.review;
  const model = reviewModel(detail, review);
  const [draft, setDraftState] = useState<ReviewDraft>(() => getDraft(jobId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justDone, setJustDone] = useState<'published' | 'unpublished' | null>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const who = reviewAccess(access);
  const canEdit = who === 'open' && !busy;
  const published = review !== null;

  // After a publish or unpublish the result sentence takes focus, so a keyboard or screen-reader user lands on it.
  useEffect(() => { if (justDone !== null) statusRef.current?.focus({ preventScroll: true }); }, [justDone]);
  const change = (next: ReviewDraft): void => { setDraftState(next); setDraft(jobId, next); setJustDone(null); setError(null); };
  const ready = publishReadiness(model.parts, draft);
  const lessonTitle = title ?? 'This lesson';

  const refuse = (e: unknown): void => {
    setError(reviewErrorMessage(e));
    // A session that ended or a lesson that changed: re-read who may publish, so the page says so.
    if (typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'ACCESS_REQUIRED') void api.getAccess().then(onAccess);
  };
  const done = (next: ReviewState | null, kind: 'published' | 'unpublished'): void => {
    setOverride({ review: next });
    setJustDone(kind);
    if (kind === 'published') { clearDraft(jobId); setDraftState(getDraft(jobId)); }
    notifyReviewChanged(jobId);
  };
  const publish = (): void => {
    if (!ready.canPublish || !canEdit) return;
    setBusy(true);
    setError(null);
    api.postReview(jobId, publishBody(model.parts, draft)).then(
      (r) => { if (r === null) setError(reviewErrorMessage(null)); else done(r, 'published'); },
      refuse,
    ).finally(() => setBusy(false));
  };
  const unpublish = (): void => {
    if (!canEdit) return;
    setBusy(true);
    setError(null);
    api.postReview(jobId, { action: 'unpublish' }).then(() => done(null, 'unpublished'), refuse).finally(() => setBusy(false));
  };
  const open = (row: ReviewRow): void => { requestPartFocus(row.id); onShowLesson(); };

  const inLesson = model.parts.filter((r) => !(published ? r.hidden : draft.hidden.includes(r.id)));
  const hiddenNow = model.parts.filter((r) => (published ? r.hidden : draft.hidden.includes(r.id)));

  const lede = published && review !== null
    ? `${lessonTitle} was published by a teacher on ${reviewDate(review.publishedAt)}.`
    : 'Read each part’s wording, tick it when you are happy with it, and hide anything you would not teach. Publishing marks this lesson as reviewed.';

  return (
    <Shell lede={lede}>
      <section className="rv-lesson" aria-label="The lesson under review">
        <div className="rv-lesson-text">
          <p className="rv-lesson-title">{lessonTitle}</p>
          <p className={`rv-state${published ? ' is-published' : ''}`} data-testid="review-state">
            {published && review !== null ? <><Mark kind="ok" />{reviewedStatus(review)}</> : 'Draft · not reviewed yet · Teacher review pending'}
          </p>
        </div>
        <button type="button" className="btn" onClick={onShowLesson}>Back to the lesson</button>
      </section>

      <p ref={statusRef} className="rv-status" tabIndex={-1} role="status" aria-live="polite" data-testid="review-status-message">
        {justDone === 'published' && review !== null && `Published. ${lessonTitle} now reads “${reviewedStatus(review)}”.`}
        {justDone === 'unpublished' && 'Unpublished. The lesson reads “Teacher review pending” again and every part is back in it.'}
      </p>
      {error !== null && <p className="callout callout-error" role="alert" data-testid="review-error">{error}</p>}

      {who === 'locked' && (
        <div className="rv-access" data-testid="review-read-only">
          <AccessForm onAccess={onAccess} intro={REVIEW_ACCESS_INTRO} submitLabel="Unlock publishing" />
        </div>
      )}

      <section className="rv-section" aria-labelledby={`${uid}-parts`}>
        <h2 id={`${uid}-parts`} className="rv-h">{published ? 'Parts in the lesson' : 'Parts to review'}</h2>
        {inLesson.length === 0 ? <p className="muted">Every part is hidden, so nothing would be left in the lesson.</p> : (
          <ul className="rv-list" data-testid="review-parts">
            {inLesson.map((row) => (
              <li key={row.id} className="rv-row" data-part={row.id}>
                <div className="rv-row-main">
                  <p className="rv-row-title">{row.title}</p>
                  <p className="rv-row-meta">{row.label !== row.title && <span>{row.label}</span>}<span>AI-written</span><span className="rv-row-ok"><Mark kind="ok" />{row.status}</span></p>
                </div>
                <div className="rv-row-actions">
                  {published ? (
                    <p className="rv-read"><Mark kind="ok" />Read by a teacher</p>
                  ) : (
                    <>
                      <label className="rv-check">
                        <input
                          type="checkbox" checked={draft.checked.includes(row.id)} disabled={!canEdit}
                          onChange={() => change(toggleChecked(draft, row.id))}
                        />
                        <span>I’ve read the wording<span className="sr-only"> of {row.title}</span></span>
                      </label>
                      <label className="rv-switch">
                        <input type="checkbox" role="switch" checked={false} disabled={!canEdit} onChange={() => change(toggleHidden(draft, row.id))} />
                        <span className="rv-switch-track" aria-hidden="true" />
                        <span>Hide from the lesson<span className="sr-only">: {row.title}</span></span>
                      </label>
                    </>
                  )}
                  <button type="button" className="rv-open" onClick={() => open(row)} aria-label={`Open ${row.title} in the lesson`}>
                    Open<IconExternal size={14} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {hiddenNow.length > 0 && (
        <section className="rv-section" aria-labelledby={`${uid}-hidden`}>
          <h2 id={`${uid}-hidden`} className="rv-h">Hidden from the lesson</h2>
          <ul className="rv-list rv-list-quiet" data-testid="review-hidden">
            {hiddenNow.map((row) => (
              <li key={row.id} className="rv-row is-hidden" data-part={row.id}>
                <div className="rv-row-main">
                  <p className="rv-row-title">{row.title}</p>
                  <p className="rv-row-meta"><span>{row.label}</span><span>{published ? 'Not in the lesson or the slides' : 'Will not be in the lesson or the slides'}</span></p>
                </div>
                {!published && (
                  <div className="rv-row-actions">
                    <label className="rv-switch">
                      <input type="checkbox" role="switch" checked disabled={!canEdit} onChange={() => change(toggleHidden(draft, row.id))} />
                      <span className="rv-switch-track" aria-hidden="true" />
                      <span>Hide from the lesson<span className="sr-only">: {row.title}</span></span>
                    </label>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {model.held.length > 0 && (
        <section className="rv-section" aria-labelledby={`${uid}-held`} data-testid="review-held">
          <h2 id={`${uid}-held`} className="rv-h">Held back by the checks; not in the lesson</h2>
          <ul className="rv-list rv-list-quiet">
            {model.held.map((h) => (
              <li key={h.id} className="rv-row is-held">
                <div className="rv-row-main">
                  <p className="rv-row-title">{h.title}</p>
                  <p className="rv-row-meta"><span>{h.label}</span></p>
                  <p className="rv-row-note">{h.sentence}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rv-publish" aria-labelledby={`${uid}-pub`}>
        <h2 id={`${uid}-pub`} className="sr-only">{published ? 'Unpublish' : 'Publish'}</h2>
        {published ? (
          <>
            <p className="rv-note">Unpublishing puts “Teacher review pending” back on this lesson and brings back any hidden parts. It changes this lesson only.</p>
            <div className="rv-bar">
              <button type="button" className="btn" onClick={unpublish} disabled={!canEdit}>{busy ? 'Working…' : 'Unpublish'}</button>
            </div>
          </>
        ) : (
          <>
            <p className="rv-note" data-testid="review-note">
              Publishing changes this lesson only. Its status reads “Reviewed by a teacher · published {reviewDate(new Date().toISOString())}”, each part reads
              “AI-written · teacher-reviewed”, and hidden parts leave the lesson and its slides. The wording stays marked AI-written, and building the
              lesson again starts a new review.
            </p>
            <div className="rv-bar">
              <button type="button" className="btn btn-primary" onClick={publish} disabled={!ready.canPublish || !canEdit} aria-describedby={`${uid}-need`}>
                {busy ? 'Publishing…' : 'Publish lesson'}
              </button>
              <p id={`${uid}-need`} className="rv-need" data-testid="review-need">
                {who === 'locked' ? 'Enter the access code above to publish.'
                  : ready.why === 'nothing' ? 'Keep at least one part in the lesson.'
                  : ready.why === 'unticked' ? `${ready.ticked} of ${ready.visible} ${ready.visible === 1 ? 'part' : 'parts'} read. Tick every part you keep.`
                  : `All ${ready.visible} ${ready.visible === 1 ? 'part' : 'parts'} read${hiddenNow.length > 0 ? `, ${hiddenNow.length} hidden` : ''}. Ready to publish.`}
              </p>
            </div>
          </>
        )}
      </section>
    </Shell>
  );
}
