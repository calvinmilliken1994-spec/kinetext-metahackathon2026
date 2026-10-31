import type { ReactNode } from 'react';
import type { DrawerMode } from './RunsDrawer.tsx';
import { IconLesson, IconNewLesson, IconRuns, IconSourcePanel } from './icons.tsx';
import { IconPresent } from './presentation/icons.tsx';
import { IconTour } from './Onboarding.tsx';

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
  /** Stage 9b: an anchor the first-run tour points at. */
  tour?: string;
}

function RailButton({ label, name, icon, onClick, pressed, disabled = false, hint, dot = false, tour }: RailButtonProps) {
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
        data-tour={tour}
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
  /** Open (or, when open, close) the New lesson drawer. */
  onNewLesson: () => void;
  /** Scroll the lesson column to the top and focus it. */
  onLesson: () => void;
  onToggleSource: () => void;
  /** Open (or, when open, close) the Runs and checks drawer. */
  onRuns: () => void;
  /** A run is being generated. */
  busy: boolean;
  /** Open the lesson in presentation mode (Stage 7c). */
  onPresent: () => void;
  /** The open lesson can be presented (a finished, checked lesson or activity). */
  canPresent: boolean;
  /** Stage 9b: reopen the first-run tour. */
  onTour?: () => void;
  touring?: boolean;
}

/**
 * The left rail of the window, with a visible label under every icon. It is the one set of controls for the drawer:
 * "New lesson" and "Runs" open it on that panel (pressed while open) and close it when pressed again. A lesson's
 * checks open from its trust receipt, so there is no separate Checks entry.
 */
export function IconRail(p: IconRailProps) {
  return (
    <nav className="rail" aria-label="Workspace">
      <ul className="rail-group">
        <RailButton label="New lesson" name="New lesson panel" icon={<IconNewLesson />} onClick={p.onNewLesson} pressed={p.drawer === 'new'} tour="new-lesson" />
        <RailButton label="Lesson" name="Go to the lesson" icon={<IconLesson />} onClick={p.onLesson} />
        <RailButton label="Source" name="Source page" icon={<IconSourcePanel />} onClick={p.onToggleSource} pressed={p.showSource} hint={p.showSource ? 'Hide the source page' : 'Show the source page'} />
        <RailButton label="Present" name="Present this lesson" icon={<IconPresent />} onClick={p.onPresent} disabled={!p.canPresent} hint={p.canPresent ? 'Full screen, one step at a time' : 'Open a finished lesson to present it'} />
      </ul>
      <span className="rail-sep" aria-hidden="true" />
      <ul className="rail-group">
        <RailButton label="Runs" name="Runs and checks panel" icon={<IconRuns />} onClick={p.onRuns} pressed={p.drawer === 'runs'} dot={p.busy} hint={p.busy ? 'A run is in progress' : undefined} />
        {p.onTour !== undefined && (
          <RailButton label="Tour" name="Take the tour" icon={<IconTour />} onClick={p.onTour} pressed={p.touring === true} hint="A short walk through the app, using a recorded build" />
        )}
      </ul>
    </nav>
  );
}
