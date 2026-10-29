import type { ReactNode } from 'react';
import type { DrawerMode } from './RunsDrawer.tsx';
import { IconChecks, IconLesson, IconNewLesson, IconRuns, IconSourcePanel } from './icons.tsx';

interface RailButtonProps {
  /** Visible label under the icon. */
  label: string;
  /** Longer accessible name when the short label needs it. */
  name?: string;
  icon: ReactNode;
  onClick: () => void;
  pressed?: boolean;
  disabled?: boolean;
  /** Extra hint for the tooltip and screen readers (e.g. why the button is disabled). */
  hint?: string;
  /** A small dot on the icon (e.g. a run is in progress). */
  dot?: boolean;
}

function RailButton({ label, name, icon, onClick, pressed, disabled = false, hint, dot = false }: RailButtonProps) {
  return (
    <li>
      <button
        type="button"
        className={`rail-btn${pressed === true ? ' rail-on' : ''}`}
        aria-label={name}
        aria-pressed={pressed}
        aria-description={hint}
        title={hint}
        onClick={onClick}
        disabled={disabled}
      >
        <span className="rail-icon">{icon}{dot && <span className="rail-dot" aria-hidden="true" />}</span>
        <span className="rail-label">{label}</span>
      </button>
    </li>
  );
}

export interface IconRailProps {
  showSource: boolean;
  /** Which drawer panel is open, if any. */
  drawer: DrawerMode | null;
  onNewLesson: () => void;
  /** Scroll the lesson column to the top and focus it. */
  onLesson: () => void;
  /** Open the runs drawer at the checks behind the selected run. */
  onChecks: () => void;
  hasChecks: boolean;
  onToggleSource: () => void;
  onRuns: () => void;
  /** A run is being generated. */
  busy: boolean;
}

/** The left rail of the window, with a visible label under every icon. Every button acts on UI that exists. */
export function IconRail(p: IconRailProps) {
  return (
    <nav className="rail" aria-label="Workspace">
      <ul className="rail-group">
        <RailButton label="New lesson" icon={<IconNewLesson />} onClick={p.onNewLesson} pressed={p.drawer === 'new'} />
        <RailButton label="Lesson" name="Go to the lesson" icon={<IconLesson />} onClick={p.onLesson} />
        <RailButton label="Source" name="Source page" icon={<IconSourcePanel />} onClick={p.onToggleSource} pressed={p.showSource} hint={p.showSource ? 'Hide the source page' : 'Show the source page'} />
      </ul>
      <span className="rail-sep" aria-hidden="true" />
      <ul className="rail-group">
        <RailButton label="Runs" name="Runs and steps" icon={<IconRuns />} onClick={p.onRuns} pressed={p.drawer === 'runs'} dot={p.busy} hint={p.busy ? 'A run is in progress' : undefined} />
        <RailButton label="Checks" name="Checks behind this lesson" icon={<IconChecks />} onClick={p.onChecks} disabled={!p.hasChecks} hint={p.hasChecks ? undefined : 'Select a run first'} />
      </ul>
    </nav>
  );
}
