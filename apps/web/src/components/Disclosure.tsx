export function Disclosure({ text }: { text: string }) {
  return (
    <aside className="disclosure" aria-label="AI-generation disclosure">
      <span className="disclosure-icon" aria-hidden="true">ⓘ</span>
      <p>{text}</p>
    </aside>
  );
}
