/** Read-only work canvas: no live history import or automatic agent activity. */
export function Empty({ unavailable }: { onImported: () => void; unavailable?: string }) {
  return (
    <div className="pointer-events-none fixed inset-0 grid place-items-center pb-24">
      <div className="flex max-w-[420px] flex-col items-center px-6 text-center">
        <h1 className="text-[28px] font-semibold tracking-[-0.02em] text-[var(--ink)]">{unavailable ? "First Mate data unavailable" : "No captured screens yet"}</h1>
        <p className="mt-3 text-[15px] leading-[1.5] text-[var(--muted)]">{unavailable ? "The latest First Mate snapshot could not be read. Flyd will show existing work when evidence is available, not treat the outage as an empty history." : "Screenshots surfaced by First Mate will appear here under their projects. This view does not reconstruct missing work or start new agents."}</p>
        <a href="/" className="pointer-events-auto mt-6 rounded-full border border-black/10 px-4 py-2 text-[13px] text-[var(--ink)]">Return to Flyd</a>
      </div>
    </div>
  );
}
