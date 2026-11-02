// Stage 10 (docs/specs/STAGE-10-navigation-and-access.md, section B): the main view and the sidebar. The view lives in
// the URL (`?view=new|lessons|review|results|how`, none = the lesson). The sidebar is always expanded, in labelled
// sections; every entry opens something in the main area, except Source page (a toggle on the lesson), Present, Demo,
// Show the welcome again and "Checks and run details" (the open lesson's details drawer). Pure: no React, no DOM.

export type MainView = 'lesson' | 'new' | 'lessons' | 'review' | 'results' | 'how';

const OTHER_VIEWS: readonly MainView[] = ['new', 'lessons', 'review', 'results', 'how'];

export const VIEW_TITLES: Readonly<Record<MainView, string>> = {
  lesson: 'Lesson', new: 'New lesson', lessons: 'All lessons', review: 'Review and publish', results: 'Results', how: 'How it works',
};

export function viewFromSearch(search: string): MainView {
  const v = new URLSearchParams(search).get('view');
  return v !== null && (OTHER_VIEWS as readonly string[]).includes(v) ? v as MainView : 'lesson';
}

/** The search string showing `view`, every other parameter kept (the lesson view has no `view` parameter). */
export function searchForView(search: string, view: MainView): string {
  const q = new URLSearchParams(search);
  if (view === 'lesson') q.delete('view'); else q.set('view', view);
  // `path` belongs to New lesson only.
  if (view !== 'new') q.delete('path');
  const out = q.toString();
  return out === '' ? '' : `?${out}`;
}

/** Stage 10c: which path New lesson opens on (`?path=own` from the Demo's "Try your own page"), or null. */
export type LessonPath = 'library' | 'own';
export function pathFromSearch(search: string): LessonPath | null {
  const p = new URLSearchParams(search).get('path');
  return p === 'own' || p === 'library' ? p : null;
}

/** The search string with New lesson's path: `own` is written, the library (the default) leaves no parameter. */
export function searchForPath(search: string, path: LessonPath): string {
  const q = new URLSearchParams(search);
  if (path === 'own') q.set('path', 'own'); else q.delete('path');
  const out = q.toString();
  return out === '' ? '' : `?${out}`;
}

export type NavId = 'new-lesson' | 'all-lessons' | 'open-lesson' | 'lesson' | 'source' | 'present' | 'checks' | 'review' | 'results' | 'demo' | 'how' | 'welcome';
export type NavAction = 'source' | 'present' | 'checks' | 'demo' | 'welcome';

export interface NavItem {
  id: NavId;
  label: string;
  /** view: opens a page in the main area; toggle: on/off (aria-pressed); action: does one thing (present, demo). */
  kind: 'view' | 'toggle' | 'action';
  /** 'page' = the view on screen; 'true' = the open lesson, marked in the Lessons list whatever the view. */
  current: 'page' | 'true' | false;
  /** Toggles and panels that are open. */
  pressed: boolean | null;
  disabled: boolean;
  /** Why it is disabled or what it does, for the tooltip and screen readers. */
  hint: string | null;
  /** A quiet word after the label ("Building"). */
  badge: string | null;
  /** Anchor the demo points at. */
  tour: string | null;
}

export interface NavSection { id: 'create' | 'lessons' | 'lesson' | 'results' | 'help'; heading: string; items: NavItem[] }

export interface SidebarInput {
  view: MainView;
  /** The open lesson's title, or null when no lesson is open. */
  lessonTitle: string | null;
  showSource: boolean;
  canPresent: boolean;
  touring: boolean;
  /** The "Checks and run details" drawer is open. */
  checksOpen: boolean;
  /** The open lesson is being built live, or a recorded build is replaying. */
  activity: 'building' | 'replay' | null;
}

const TARGETS: Readonly<Record<NavId, { view: MainView } | { action: NavAction }>> = {
  'new-lesson': { view: 'new' }, 'all-lessons': { view: 'lessons' }, 'open-lesson': { view: 'lesson' }, lesson: { view: 'lesson' },
  source: { action: 'source' }, present: { action: 'present' }, checks: { action: 'checks' }, review: { view: 'review' },
  results: { view: 'results' }, demo: { action: 'demo' }, how: { view: 'how' }, welcome: { action: 'welcome' },
};

export function navTarget(id: NavId): { view: MainView } | { action: NavAction } {
  return TARGETS[id];
}

export function sidebarSections(s: SidebarInput): NavSection[] {
  const it = (id: NavId, label: string, o: Partial<NavItem> = {}): NavItem => {
    const t = TARGETS[id];
    const isView = 'view' in t;
    return {
      id, label, kind: isView ? 'view' : 'action',
      current: isView && t.view === s.view && id !== 'open-lesson' ? 'page' : false,
      pressed: null, disabled: false, hint: null, badge: null, tour: null, ...o,
    };
  };
  // Stage 10c, L3: no heading over a single entry. New lesson leads the Lessons section; Results joins Help.
  const sections: NavSection[] = [
    {
      id: 'lessons', heading: 'Lessons', items: [
        it('new-lesson', 'New lesson', { tour: 'new-lesson' }),
        it('all-lessons', 'All lessons'),
        ...(s.lessonTitle === null ? [] : [it('open-lesson', s.lessonTitle, {
          current: 'true', badge: s.activity === 'building' ? 'Building' : s.activity === 'replay' ? 'Replay' : null, hint: 'The lesson open now',
        })]),
      ],
    },
  ];
  if (s.lessonTitle !== null) {
    sections.push({
      id: 'lesson', heading: 'This lesson', items: [
        it('lesson', 'Lesson'),
        it('source', 'Source page', {
          kind: 'toggle', pressed: s.view === 'lesson' && s.showSource,
          hint: s.view === 'lesson' && s.showSource ? 'Hide the page beside the lesson' : 'Show the page beside the lesson',
        }),
        it('present', 'Present', {
          disabled: !s.canPresent, hint: s.canPresent ? 'Full screen, one step at a time' : 'Open a finished lesson to present it',
        }),
        it('checks', 'Checks and run details', { pressed: s.checksOpen, hint: 'How this lesson was built and checked' }),
        it('review', 'Review and publish'),
      ],
    });
  }
  sections.push({
    id: 'help', heading: 'Results and help', items: [
      it('results', 'Results'),
      it('demo', 'Demo', { pressed: s.touring, hint: 'Watch a lesson being built, from a recorded build' }),
      it('how', 'How it works'),
      it('welcome', 'Show the welcome again', { hint: 'The first screen and the short guide round the pages' }),
    ],
  });
  return sections;
}
