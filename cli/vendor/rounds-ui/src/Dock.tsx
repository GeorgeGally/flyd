// The dock along the bottom: the day the canvas shows, which opens the timeline, search, and
// while the canvas shows one session, its name, which shows everything again.
// Panning, zooming and pinning a note need no tool: the canvas and the viewer carry them.
import { useRef, useState } from "react";
import { Glyph } from "./glyphs";

export type Tool = "move" | "hand" | "comment";

// Each key names itself in a small glass label above the dock, with its shortcut.
const tipOf = (label: string) => {
  const m = label.match(/^(.*?)\s*\((.+)\)$/);
  return m ? { text: m[1], kbd: m[2] } : { text: label, kbd: "" };
};

function Key({ label, on, accent, onClick, children }: { label: string; on?: boolean; accent?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      aria-pressed={on}
      data-tip={label}
      className="grid h-11 w-11 shrink-0 place-items-center rounded-full transition-[background,color,transform] duration-200 active:scale-95"
      style={{ background: on ? (accent ? "var(--honey)" : "var(--ink)") : "transparent", color: on ? "white" : "var(--ink)" }}
    >
      {children}
    </button>
  );
}
// Groups part with a hairline and 8 points of air on each side; inside a group, keys sit
// edge to edge at 44 so the pressed circle stays concentric with the dock (6 in from its ends).
const Rule = () => <span className="mx-2 h-5 w-px shrink-0" style={{ background: "rgba(21,24,29,0.1)" }} />;

export function Dock({ hidden, timeOn, away, onTime, onSearch, session, onAll }: {
  hidden: boolean; timeOn: boolean; away: string | null;
  onTime: (from: DOMRect) => void; onSearch: () => void;
  session: string | null; onAll: () => void;
}) {
  const timeBtn = useRef<HTMLButtonElement>(null);
  const dock = useRef<HTMLDivElement>(null);
  // a short pause before the first label; after that they follow the pointer at once
  const [tip, setTip] = useState<{ label: string; x: number } | null>(null);
  const tipTimer = useRef(0);
  const over = (e: React.PointerEvent) => {
    const b = (e.target as HTMLElement).closest("[data-tip]") as HTMLElement | null;
    clearTimeout(tipTimer.current);
    if (!b || !dock.current) { tipTimer.current = window.setTimeout(() => setTip(null), 120); return; }
    const r = b.getBoundingClientRect(), d = dock.current.getBoundingClientRect();
    const next = { label: b.dataset.tip!, x: r.left + r.width / 2 - d.left };
    if (tip) setTip(next);
    else tipTimer.current = window.setTimeout(() => setTip(next), 450);
  };

  return (
    <div
      ref={dock}
      data-chrome
      onPointerOver={over}
      onPointerLeave={() => { clearTimeout(tipTimer.current); setTip(null); }}
      onPointerDownCapture={() => { clearTimeout(tipTimer.current); setTip(null); }}
      className="glass lite dock fixed bottom-6 left-1/2 flex h-14 items-center rounded-full px-1.5"
      style={{
        transform: `translate(-50%, ${hidden ? 24 : 0}px)`,
        opacity: hidden ? 0 : 1,
        pointerEvents: hidden ? "none" : "auto",
        transition: "transform 420ms var(--ease-out), opacity 300ms var(--ease-out)",
      }}
      onPointerDown={(e) => e.stopPropagation()}
      // a click leaves no focus on the dock, so Space pans the canvas instead of pressing a button
      onMouseDown={(e) => { if ((e.target as HTMLElement).closest("button")) e.preventDefault(); }}
    >
      {/* time: the day the canvas shows (today, or the day you went back to); opens the timeline */}
      <button
        ref={timeBtn}
        onClick={() => timeBtn.current && onTime(timeBtn.current.getBoundingClientRect())}
        aria-label={`${away ?? new Date().toLocaleDateString([], { month: "short", day: "numeric" })}, Timeline`}
        aria-keyshortcuts="T"
        aria-pressed={timeOn}
        data-away={away ?? undefined}
        data-tip="Timeline (T)"
        className="flex h-11 shrink-0 items-center gap-2 rounded-full transition-[background,color,padding] duration-200 active:scale-95"
        style={{ background: timeOn ? "var(--ink)" : away ? "var(--honey-wash)" : "transparent", color: timeOn ? "white" : "var(--ink)", paddingInline: 16 }}
      >
        <span className="whitespace-nowrap text-[13px] font-[560] tracking-[-0.01em] [font-variant-numeric:tabular-nums]">
          {away ?? new Date().toLocaleDateString([], { month: "short", day: "numeric" })}
        </span>
      </button>
      <Rule />
      <Key label="Search (/)" onClick={onSearch}><Glyph name="search" /></Key>
      {session && (
        <>
          <Rule />
          <button
            key={session}
            onClick={onAll}
            aria-label={`${session}, show all sessions`}
            aria-keyshortcuts="Escape"
            data-tip="Show all (Esc)"
            className="flex h-11 min-w-0 max-w-[280px] items-center gap-2 rounded-full pl-3.5 pr-3 text-[var(--ink)] transition-transform duration-200 active:scale-95"
            style={{ background: "var(--honey-wash)", animation: "wb-chip 260ms var(--ease-out) both" }}
          >
            <Glyph name="comment" size={16} className="shrink-0" />
            <span className="min-w-0 truncate text-[13px] font-[560] tracking-[-0.01em]">{session}</span>
            <Glyph name="close" size={12} className="shrink-0 text-[var(--muted)]" />
          </button>
        </>
      )}
      {tip && (() => {
        const t = tipOf(tip.label);
        return (
          <span
            className="glass thick pointer-events-none flex h-8 items-center gap-2 whitespace-nowrap rounded-full pl-3 text-[13px] font-[520] text-[var(--ink)]"
            style={{ position: "absolute", left: tip.x, bottom: 56 + 10, transform: "translateX(-50%)", paddingRight: t.kbd ? 6 : 12, animation: "wb-tip 160ms var(--ease-out) both" }}
          >
            {t.text}
            {t.kbd && <kbd className="type-mono grid h-5 min-w-5 place-items-center rounded-[6px] px-1 text-[11px] text-[var(--muted)]" style={{ background: "rgba(21,24,29,0.06)" }}>{t.kbd}</kbd>}
          </span>
        );
      })()}
      <style>{`@keyframes wb-tip { from { opacity: 0; transform: translate(-50%, 3px) } } @keyframes wb-chip { from { opacity: 0; transform: scale(0.94) } }`}</style>
    </div>
  );
}
