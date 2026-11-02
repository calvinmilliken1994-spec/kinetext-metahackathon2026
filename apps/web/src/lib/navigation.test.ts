/// <reference types="node" />
// Stage 10 (docs/specs/STAGE-10-navigation-and-access.md, section B): the main view lives in the URL and the sidebar is
// one always-expanded list of labelled sections. Every entry opens something in the main area; nothing opens a panel on
// the right except "Checks and run details", which belongs to the open lesson.
import test from 'node:test';
import assert from 'node:assert/strict';
import { navTarget, pathFromSearch, searchForPath, searchForView, sidebarSections, VIEW_TITLES, viewFromSearch } from './navigation.ts';
import type { SidebarInput } from './navigation.ts';

test('viewFromSearch: ?view= names a main view; none or an unknown value means the lesson', () => {
  assert.equal(viewFromSearch(''), 'lesson');
  assert.equal(viewFromSearch('?view=new'), 'new');
  assert.equal(viewFromSearch('?view=lessons'), 'lessons');
  assert.equal(viewFromSearch('?view=review'), 'review');
  assert.equal(viewFromSearch('?view=results'), 'results');
  assert.equal(viewFromSearch('?view=how'), 'how');
  assert.equal(viewFromSearch('?view=lesson'), 'lesson');
  assert.equal(viewFromSearch('?view=settings'), 'lesson');
  assert.equal(viewFromSearch('?job=job-1&view=new'), 'new');
});

test('searchForView: sets ?view=, drops it for the lesson, and keeps every other parameter', () => {
  assert.equal(searchForView('', 'new'), '?view=new');
  assert.equal(searchForView('?job=job-1', 'lessons'), '?job=job-1&view=lessons');
  assert.equal(searchForView('?job=job-1&view=lessons', 'lesson'), '?job=job-1');
  assert.equal(searchForView('?view=how', 'lesson'), '');
  assert.equal(searchForView('?tour=0&view=new', 'how'), '?tour=0&view=how');
});

test('searchForView: the lesson view keeps ?present= and ?replay= links working', () => {
  assert.equal(searchForView('?replay=job-9&speed=4&view=new', 'lesson'), '?replay=job-9&speed=4');
  assert.equal(searchForView('?present=job-9&beat=2', 'lesson'), '?present=job-9&beat=2');
});

test('every view has a plain title', () => {
  assert.deepEqual(VIEW_TITLES, {
    lesson: 'Lesson', new: 'New lesson', lessons: 'All lessons', review: 'Review and publish', results: 'Results', how: 'How it works',
  });
});

const base: SidebarInput = {
  view: 'lesson', lessonTitle: 'How water circulates', showSource: true, canPresent: true, touring: false, checksOpen: false, activity: null,
};
const flat = (i: SidebarInput) => sidebarSections(i).flatMap((s) => s.items.map((it) => ({ ...it, section: s.id })));
const item = (i: SidebarInput, id: string) => flat(i).find((x) => x.id === id);

test('sections: no heading sits over a single entry (L3); This lesson only while a lesson is open', () => {
  // Stage 10c, L3: "Create" (only New lesson) folds into Lessons, and "Results" (only Results) into the Help section.
  assert.deepEqual(sidebarSections(base).map((s) => [s.id, s.heading]), [
    ['lessons', 'Lessons'], ['lesson', 'This lesson'], ['help', 'Results and help'],
  ]);
  assert.deepEqual(sidebarSections({ ...base, lessonTitle: null }).map((s) => s.id), ['lessons', 'help']);
  for (const i of [base, { ...base, lessonTitle: null }]) {
    for (const s of sidebarSections(i)) assert.ok(s.items.length > 1, `${s.id} has more than one entry`);
  }
});

test('the entries of each section, with Tour renamed Demo and the Welcome reachable again', () => {
  const by = (id: string) => sidebarSections(base).find((s) => s.id === id)?.items.map((x) => x.label);
  assert.deepEqual(by('lessons'), ['New lesson', 'All lessons', 'How water circulates']);
  assert.deepEqual(by('lesson'), ['Lesson', 'Source page', 'Present', 'Checks and run details', 'Review and publish']);
  assert.deepEqual(by('help'), ['Results', 'Demo', 'How it works', 'Show the welcome again']);
  assert.equal(flat(base).some((x) => /tour/i.test(x.label)), false);
  assert.equal(item(base, 'welcome')?.kind, 'action');
});

test('the current view is marked: one aria-current="page"; the open lesson is always marked as the current lesson', () => {
  const pages = (i: SidebarInput) => flat(i).filter((x) => x.current === 'page').map((x) => x.id);
  assert.deepEqual(pages(base), ['lesson']);
  assert.equal(item(base, 'open-lesson')?.current, 'true');
  assert.deepEqual(pages({ ...base, view: 'new' }), ['new-lesson']);
  assert.equal(item({ ...base, view: 'new' }, 'open-lesson')?.current, 'true');
  assert.deepEqual(pages({ ...base, view: 'lessons' }), ['all-lessons']);
  assert.deepEqual(pages({ ...base, view: 'review' }), ['review']);
  assert.deepEqual(pages({ ...base, view: 'results' }), ['results']);
  assert.deepEqual(pages({ ...base, view: 'how' }), ['how']);
});

test('Source page is a toggle, pressed only while the lesson view shows the page', () => {
  assert.equal(item(base, 'source')?.kind, 'toggle');
  assert.equal(item(base, 'source')?.pressed, true);
  assert.equal(item({ ...base, showSource: false }, 'source')?.pressed, false);
  assert.equal(item({ ...base, view: 'new' }, 'source')?.pressed, false);
});

test('Present says why it cannot run; Demo and Checks show when they are open', () => {
  assert.equal(item(base, 'present')?.disabled, false);
  const off = item({ ...base, canPresent: false }, 'present');
  assert.equal(off?.disabled, true);
  assert.equal(off?.hint, 'Open a finished lesson to present it');
  assert.equal(item({ ...base, touring: true }, 'demo')?.pressed, true);
  assert.equal(item({ ...base, checksOpen: true }, 'checks')?.pressed, true);
  assert.equal(item(base, 'new-lesson')?.tour, 'new-lesson', 'the demo still points at New lesson');
});

test('a lesson being built or replayed is named on the current lesson entry', () => {
  assert.equal(item({ ...base, activity: 'building' }, 'open-lesson')?.badge, 'Building');
  assert.equal(item({ ...base, activity: 'replay' }, 'open-lesson')?.badge, 'Replay');
  assert.equal(item(base, 'open-lesson')?.badge, null);
});

test('navTarget: views open in the main area, Source/Present/Checks/Demo are actions', () => {
  assert.deepEqual(navTarget('new-lesson'), { view: 'new' });
  assert.deepEqual(navTarget('all-lessons'), { view: 'lessons' });
  assert.deepEqual(navTarget('open-lesson'), { view: 'lesson' });
  assert.deepEqual(navTarget('lesson'), { view: 'lesson' });
  assert.deepEqual(navTarget('review'), { view: 'review' });
  assert.deepEqual(navTarget('results'), { view: 'results' });
  assert.deepEqual(navTarget('how'), { view: 'how' });
  assert.deepEqual(navTarget('source'), { action: 'source' });
  assert.deepEqual(navTarget('present'), { action: 'present' });
  assert.deepEqual(navTarget('checks'), { action: 'checks' });
  assert.deepEqual(navTarget('demo'), { action: 'demo' });
  assert.deepEqual(navTarget('welcome'), { action: 'welcome' });
});

test('New lesson can open on a path: ?path=own (the Demo\u2019s Try your own page), dropped on other views', () => {
  assert.equal(pathFromSearch('?view=new&path=own'), 'own');
  assert.equal(pathFromSearch('?view=new&path=library'), 'library');
  assert.equal(pathFromSearch('?view=new'), null);
  assert.equal(pathFromSearch('?view=new&path=nope'), null);
  assert.equal(searchForView('?view=new&path=own', 'lessons'), '?view=lessons', 'leaving New lesson drops the path');
  assert.equal(searchForView('?view=new&path=own', 'new'), '?view=new&path=own');
  assert.equal(searchForPath('?view=new', 'own'), '?view=new&path=own');
  assert.equal(searchForPath('?view=new&path=own', 'library'), '?view=new');
});
