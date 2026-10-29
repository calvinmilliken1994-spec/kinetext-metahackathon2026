import type { Health } from '../api.ts';

/** API connection status in the title bar: quiet text, coloured only when something is wrong. */
export function ApiStatus({ health, down }: { health: Health | null; down: boolean }) {
  let tone = 'neutral';
  let label = 'Connecting…';
  if (down) { tone = 'bad'; label = 'API unreachable'; }
  else if (health !== null) label = health.live ? 'Live generation on' : 'Live generation off · stored runs only';
  return <span className={`api-status tone-${tone}`} role="status">{label}</span>;
}
