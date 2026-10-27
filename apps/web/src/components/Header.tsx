import type { Health } from '../api.ts';

export function Header({ health, down }: { health: Health | null; down: boolean }) {
  let cls = 'pill pill-wait';
  let label = 'Connecting to API…';
  if (down) { cls = 'pill pill-bad'; label = 'API unreachable'; }
  else if (health !== null) {
    cls = health.live ? 'pill pill-live' : 'pill pill-off';
    label = health.live ? 'API online · live generation on' : 'API online · live generation off (recorded runs)';
  }
  return (
    <header className="app-header">
      <div className="brand">
        <svg className="logo" viewBox="0 0 32 32" aria-hidden="true">
          <rect width="32" height="32" rx="8" fill="currentColor" />
          <path d="M7 21 L13 11 L18 17 L22 9 L25 9" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="25" cy="9" r="2.3" fill="#fff" />
        </svg>
        <div>
          <h1>Make knowledge interactive</h1>
          <p>Source → Muse Spark → verified interactive activity</p>
        </div>
      </div>
      <span className={cls} role="status"><span className="dot" aria-hidden="true" />{label}</span>
    </header>
  );
}
