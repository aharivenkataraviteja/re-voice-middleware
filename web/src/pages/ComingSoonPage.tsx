export function ComingSoonPage({ title }: { title: string }) {
  return (
    <div>
      <h1 style={{ fontFamily: "var(--serif)", fontSize: "1.9rem", marginBottom: "0.5rem" }}>{title}</h1>
      <p style={{ color: "var(--ink-soft)" }}>Coming in the next milestone.</p>
    </div>
  );
}
