import type { ReactNode } from 'react';
import { IconChecks, IconLesson, IconNewLesson, IconRuns, IconSourcePanel } from './icons.tsx';

interface RailButtonProps {
  label: string;
  /** Visible tooltip text; defaults to the label. */
  tip?: string;
  icon: ReactNode;
  onClick: () => void;
  pressed?: boolean;
  disabled?: boolean;
}

function RailButton({ label, tip, icon, onClick, pressed, disabled = false }: RailButtonProps) {
  return (
    <li>
      <button type="button" className={`rail-btn${pressed === true ? ' rail-on' : ''}`} aria-label={label} aria-pressed={pressed} onClick={onClick} disabled={disabled}>
        {icon}
        <span className="rail-tip" aria-hidden="true">{tip ?? label}</span>
      </button>
    </li>
  );
}

export interface IconRailProps {
  showSource: boolean;
  showSide: boolean;
  /** Show the source panel and put focus on the source picker. */
  onPickSource: () => void;
  /** Scroll the lesson column to the top and focus it. */
  onLesson: () => void;
  /** Show the side panel and scroll to the checks behind the selected run. */
  onChecks: () => void;
  hasChecks: boolean;
  onToggleSource: () => void;
  onToggleSide: () => void;
}

/** The narrow left rail of the window. Every button acts on UI that exists: it moves focus, scrolls or shows/hides a panel. */
export function IconRail(p: IconRailProps) {
  return (
    <nav className="rail" aria-label="Workspace">
      <ul className="rail-group">
        <RailButton label="New lesson: pick a source page" tip="New lesson · pick a page" icon={<IconNewLesson />} onClick={p.onPickSource} />
        <RailButton label="Go to the lesson" tip="Lesson" icon={<IconLesson />} onClick={p.onLesson} />
        <RailButton
          label="Checks behind this run"
          tip={p.hasChecks ? 'Checks behind this run' : 'Checks · select a run first'}
          icon={<IconChecks />}
          onClick={p.onChecks}
          disabled={!p.hasChecks}
        />
      </ul>
      <span className="rail-sep" aria-hidden="true" />
      <ul className="rail-group">
        <RailButton label="Source page panel" tip={p.showSource ? 'Hide source page' : 'Show source page'} icon={<IconSourcePanel />} onClick={p.onToggleSource} pressed={p.showSource} />
        <RailButton label="Runs and steps panel" tip={p.showSide ? 'Hide runs & steps' : 'Show runs & steps'} icon={<IconRuns />} onClick={p.onToggleSide} pressed={p.showSide} />
      </ul>
    </nav>
  );
}
