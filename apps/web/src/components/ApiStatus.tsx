import type { Health } from '../api.ts';

/** API connection status, shown in the window's title bar. */
export function ApiStatus({ health, down }: { health: Health | null; down: boolean }) {
  let cls = 'pill pill-wait';
  let label = 'Connecting to API…';
  if (down) { cls = 'pill pill-bad'; label = 'API unreachable'; }
  else if (health !== null) {
    cls = health.live ? 'pill pill-live' : 'pill pill-off';
    label = health.live ? 'API online · live generation on' : 'API online · live generation off (recorded runs)';
  }
  return <span className={cls} role="status"><span className="dot" aria-hidden="true" />{label}</span>;
}
