// Search: every topic, send and page by what it's called, what the thread said when it showed
// it, and the thread's own name. Pick one and the canvas flies to it, back in time if needed.
// A session itself turns up too, by its name: pick it and the canvas shows only what it made.
import { useEffect, useMemo, useRef, useState } from "react";
import { clean, img, thumb, when, type Index } from "./data";
import { Glyph } from "./glyphs";

export type Hit = { key: string; kind: "topic" | "set" | "page" | "chat"; title: string; project: string; at: number; pic: string; text: string; find: string };

export function entries(index: Index): Hit[] {
  const threads = new Map(index.threads.map((t) => [t.id, t.title]));
  const sets = new Map(index.sets.map((s) => [s.id, s]));
  const out: Hit[] = [];
  const filed = new Set<string>();
  for (const [project, topics] of Object.entries(index.topics || {})) {
    for (const t of topics) {
      const member = t.sets.map((id) => sets.get(id)).filter(Boolean) as Index["sets"];
      if (!member.length) continue;
      member.forEach((s) => filed.add(s.id));
      const last = member.reduce((a, b) => (b.at > a.at ? b : a));
      out.push({
        key: `t-${t.id}`, kind: "topic", title: t.title, project, at: last.at, pic: last.shots[0] ? img(last.shots[0], 480) : "",
        text: [t.title, ...member.map((s) => s.caption), ...member.map((s) => threads.get(s.thread || "") || "")].join(" ").toLowerCase(),
        find: last.id,
      });
    }
  }
  for (const s of index.sets) {
    if (filed.has(s.id)) continue;
    out.push({
      key: s.id, kind: "set", title: clean(s.caption.split(/(?<=[a-z0-9)])[.:;!?](?:\s|$)/i)[0] || threads.get(s.thread || "") || "Screens"), project: s.project,
      at: s.at, pic: s.shots[0] ? img(s.shots[0], 480) : "", text: `${s.caption} ${threads.get(s.thread || "") || ""}`.toLowerCase(), find: s.id,
    });
  }
  for (const p of index.pages) {
    const v = p.versions[p.versions.length - 1];
    out.push({ key: `page-${p.id}`, kind: "page", title: clean(p.title), project: p.project, at: v.at, pic: thumb(v.hash), text: `${p.title} ${threads.get(p.thread || "") || ""}`.toLowerCase(), find: `page-${p.id}` });
  }
  // sessions that made something (screens, pages, changes to files), by when they last did
  const last = new Map<string, number>();
  const made = (id: string | null, at: number) => { if (id && at > (last.get(id) ?? 0)) last.set(id, at); };
  for (const s of index.sets) made(s.thread, s.at);
  for (const p of index.pages) for (const v of p.versions) made(p.thread, v.at);
  for (const c of index.changed || []) made(c.thread, c.edits[c.edits.length - 1][0]);
  for (const t of index.threads) {
    const at = last.get(t.id);
    if (at && t.title) out.push({ key: `chat-${t.id}`, kind: "chat", title: clean(t.title), project: t.project, at, pic: "", text: t.title.toLowerCase(), find: t.id });
  }
  return out.sort((a, b) => b.at - a.at);
}

export function Search({ index, onPick, onClose }: { index: Index; onPick: (h: Hit) => void; onClose: () => void }) {
  const all = useMemo(() => entries(index), [index]);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  // closed, the keyboard goes back to where it was
  const [was] = useState(() => document.activeElement as HTMLElement | null); // before the canvas goes out of reach
  useEffect(() => () => { requestAnimationFrame(() => { if (was?.isConnected && was !== document.body) was.focus({ preventScroll: true }); }); }, []);
  useEffect(() => input.current?.focus(), []);

  const hits = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return all.filter((h) => h.kind !== "set" && h.kind !== "chat").slice(0, 7);
    const scored = all
      .filter((h) => words.every((w) => h.text.includes(w) || index.projects[h.project]?.toLowerCase().includes(w)))
      .map((h) => ({ h, s: words.filter((w) => h.title.toLowerCase().includes(w)).length * 2 + (h.kind === "chat" ? 2 : h.kind === "topic" ? 1 : 0) }));
    scored.sort((a, b) => b.s - a.s || b.h.at - a.h.at);
    return scored.slice(0, 8).map((x) => x.h);
  }, [q, all]);
  useEffect(() => setSel(0), [q]);

  const go = (h?: Hit) => { if (h) onPick(h); };

  return (
    // Esc closes it from anywhere inside, the field or a result
    <div data-chrome onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); } }}>
      <div className="fixed inset-0" style={{ background: "rgba(244,246,247,0.4)", animation: "wb-fade 200ms var(--ease-out) both" }} onPointerDown={(e) => { e.stopPropagation(); onClose(); }} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        className="glass thick fixed left-1/2 top-[14vh] w-[min(600px,calc(100vw-48px))] -translate-x-1/2 overflow-hidden rounded-[24px]"
        style={{ animation: "wb-drop 240ms var(--ease-out) both", transformOrigin: "50% 30%" }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="flex h-14 items-center gap-3 px-5">
          <Glyph name="search" className="shrink-0 text-[var(--muted)]" />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") { e.preventDefault(); onClose(); }
              if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(hits.length - 1, s + 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
              if (e.key === "Enter") { e.preventDefault(); go(hits[sel]); }
            }}
            className="h-full flex-1 bg-transparent text-[17px] tracking-[-0.01em] text-[var(--ink)] outline-none placeholder:text-[var(--quiet)] focus-visible:outline-none"
            placeholder="Search"
            aria-label="Search"
            role="combobox"
            aria-expanded={hits.length > 0}
            aria-controls="search-results"
            aria-activedescendant={hits[sel] ? `hit-${sel}` : undefined}
            spellCheck={false}
          />
        </div>
        {q.trim() && !hits.length && (
          <div className="border-t px-5 py-4 text-[14px] text-[var(--muted)]" style={{ borderColor: "rgba(21,24,29,0.07)" }} role="status">No results</div>
        )}
        {hits.length > 0 && (
          <div id="search-results" role="listbox" aria-label="Results" className="border-t px-2 py-2" style={{ borderColor: "rgba(21,24,29,0.07)" }}>
            {hits.map((h, i) => (
              <button
                key={h.key}
                id={`hit-${i}`}
                role="option"
                aria-selected={i === sel}
                onPointerEnter={() => setSel(i)}
                onClick={() => go(h)}
                className="flex h-14 w-full items-center gap-3.5 rounded-[14px] px-3 text-left"
                style={{ background: i === sel ? "rgba(21,24,29,0.05)" : "transparent" }}
              >
                <span className="grid h-9 w-14 shrink-0 place-items-center overflow-hidden rounded-[6px] bg-[var(--wall-deep)] text-[var(--muted)] shadow-[inset_0_0_0_0.5px_rgba(21,24,29,0.12)]">
                  {h.kind === "chat" && <Glyph name="comment" size={18} />}
                  {h.pic && <img src={h.pic} alt="" onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} className="h-full w-full object-cover object-top" draggable={false} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-[520] tracking-[-0.01em] text-[var(--ink)]">{h.title}</span>
                  <span className="block truncate text-[13px] text-[var(--quiet)]">{index.projects[h.project] || h.project}</span>
                </span>
                <span className="type-mono shrink-0 text-[var(--quiet)]">{when(h.at)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <style>{`@keyframes wb-fade { from { opacity: 0 } } @keyframes wb-drop { from { opacity: 0; transform: scale(0.97) } }`}</style>
    </div>
  );
}
