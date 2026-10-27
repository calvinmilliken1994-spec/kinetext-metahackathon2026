export const DISCLOSURE_TEXT =
  'AI-generated with Muse Spark 1.3 (Meta). Includes NASA source material; NASA has not reviewed or endorsed this activity.';

export function Disclosure() {
  return (
    <aside className="disclosure" aria-label="AI-generation disclosure">
      <span className="disclosure-icon" aria-hidden="true">ⓘ</span>
      <p>{DISCLOSURE_TEXT}</p>
    </aside>
  );
}
