import { useEffect, useState } from "react";
import { Glyph } from "./glyphs";

const DEMO = "npx github:krispuckett/rounds --demo";

// A canvas with nothing on it yet: where work comes from, the pushes it can bring in from the
// last 30 days (server/history.mjs), and how to see it full.
export function Empty({ onImported }: { onImported: () => void }) {
  const [copied, setCopied] = useState(false);
  const [found, setFound] = useState(0);
  const [bringing, setBringing] = useState(false);
  useEffect(() => {
    fetch("/api/history").then((r) => r.json()).then((h) => setFound(h.pushes || 0)).catch(() => {});
  }, []);
  const bring = async () => {
    setBringing(true);
    try { await fetch("/api/history", { method: "POST" }); onImported(); } catch { setBringing(false); }
  };
  const copy = async () => {
    let ok = false;
    try { await navigator.clipboard.writeText(DEMO); ok = true; } catch {
      // the older way, for browsers that keep the clipboard API from this page
      const t = document.createElement("textarea");
      t.value = DEMO; t.style.position = "fixed"; t.style.opacity = "0";
      document.body.append(t); t.select();
      try { ok = document.execCommand("copy"); } catch {}
      t.remove();
    }
    if (!ok) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  return (
    <div className="pointer-events-none fixed inset-0 grid place-items-center pb-24">
      <div className="flex max-w-[440px] flex-col items-center px-6 text-center" style={{ animation: "wb-empty 500ms var(--ease-out) both" }}>
        <div className="text-[30px] font-semibold tracking-[-0.02em] text-[var(--ink)]">Nothing here yet</div>
        <p className="mt-3 text-[15px] leading-[1.5] text-[var(--muted)]">
          When a Claude session shows you a screen, publishes a page or pushes to main, it lands here, under its project.
        </p>
        {found > 0 && (
          <button
            onClick={bring}
            disabled={bringing}
            className="press pointer-events-auto mt-7 h-11 rounded-full bg-[var(--ink)] px-5 text-[14px] font-[560] text-white transition-opacity duration-200 disabled:opacity-60"
            style={{ animation: "wb-empty 400ms var(--ease-out) both" }}
          >
            {bringing ? "Bringing them in…" : `Bring in ${found} ${found === 1 ? "push" : "pushes"} from the last 30 days`}
          </button>
        )}
        <button
          onClick={copy}
          className="press type-mono pointer-events-auto mt-4 flex h-11 items-center gap-2.5 rounded-full px-4 text-[13px] text-[var(--quiet)] transition-colors duration-200 hover:bg-black/[0.04] hover:text-[var(--ink)]"
          aria-label={copied ? "Copied" : "Copy the demo command"}
        >
          {DEMO}
          <Glyph name={copied ? "done" : "copy"} size={14} />
        </button>
      </div>
      <style>{"@keyframes wb-empty { from { opacity: 0; transform: translateY(6px) } }"}</style>
    </div>
  );
}
