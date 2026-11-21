import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { clean, pageSrc, postComment, shot, thumb, threadLink, when, type Comment, type Index, type Page } from "./data";
import { diffBoxes, type Box } from "./diff";
import { blockChanges, type Changes } from "./blocks";
import { Glyph } from "./glyphs";
import { reducedMotion } from "./look";

export type Rect = { x: number; y: number; w: number; h: number };
export type Opening = { page: Page; from: Rect; hash?: string; place?: boolean };

const PAGE_W = 1280; // pages render at desktop width and scale to the stage

function target(): Rect {
  const w = Math.min(1320, innerWidth - 2 * 64);
  const top = 40, bottom = 112;
  return { x: (innerWidth - w) / 2, y: top, w, h: innerHeight - top - bottom };
}

export function Stage({ opening, index, onComment, onClosing, onClose }: {
  opening: Opening; index: Index; onComment: (c: Comment) => void; onClosing?: () => void; onClose: () => void;
}) {
  const { page, from } = opening;
  const versions = page.versions;
  const [vi, setVi] = useState(() => { const i = versions.findIndex((v) => v.hash === opening.hash); return i >= 0 ? i : versions.length - 1; });
  // the compare is drawn from page previews: with none on this machine, a page opens live
  const canPreview = index.previews !== false;
  const [changes, setChanges] = useState(versions.length > 1 && canPreview);
  const [landed, setLanded] = useState(false);
  const [closing, setClosing] = useState(false);
  const [surfaceReady, setSurfaceReady] = useState(false);
  const [placing, setPlacing] = useState(!!opening.place);
  const [draft, setDraft] = useState<{ x: number; y: number } | null>(null);
  // the canvas reloads its notes when one is added, delivered or answered
  const notes = useMemo(() => index.comments.filter((c) => c.page === page.id), [index.comments, page.id]);
  const [rect, setRect] = useState(target);
  const box = useRef<HTMLDivElement>(null);
  const thread = index.threads.find((t) => t.id === page.thread);

  const v = versions[vi];
  const prev = vi > 0 ? versions[vi - 1] : null;
  const showChanges = changes && !!prev;
  const scale = rect.w / PAGE_W;

  useEffect(() => {
    const r = () => setRect(target());
    addEventListener("resize", r);
    return () => removeEventListener("resize", r);
  }, []);

  // the keyboard comes into the viewer, and goes back to where it was when the viewer closes
  const dialog = useRef<HTMLDivElement>(null);
  const [was] = useState(() => document.activeElement as HTMLElement | null); // before the canvas goes out of reach
  useEffect(() => {
    dialog.current?.focus({ preventScroll: true });
    return () => { requestAnimationFrame(() => { if (was?.isConnected && was !== document.body) was.focus({ preventScroll: true }); }); };
  }, []);

  // Fly from the card into place; transform only, so it holds frame.
  const flyUp = useRef<Animation | null>(null);
  useLayoutEffect(() => {
    const el = box.current!;
    const t = target();
    const a = reducedMotion() ? el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: "ease-out" }) : el.animate(
      [
        { transform: `translate(${from.x - t.x}px, ${from.y - t.y}px) scale(${from.w / t.w}, ${from.h / t.h})`, borderRadius: `${14 * (t.w / from.w)}px / ${14 * (t.h / from.h)}px` },
        { transform: "none", borderRadius: "18px" },
      ],
      { duration: 560, easing: "cubic-bezier(0.3, 0.7, 0.1, 1)" },
    );
    flyUp.current = a;
    a.onfinish = () => setLanded(true);
    return () => a.cancel();
  }, []);

  const close = () => {
    if (closing) return;
    setClosing(true);
    onClosing?.(); // the canvas clears as the page flies back, not after it lands
    const el = box.current!;
    const t = rect;
    // back to where the page's card lies now (a new post may have moved it), from wherever the
    // card is: closed mid-flight, it turns around instead of jumping to full size first
    const r = document.querySelector(`[data-key="page-${page.id}"]`)?.getBoundingClientRect();
    const to = r ? { x: r.left, y: r.top, w: r.width, h: r.height } : from;
    const now = getComputedStyle(el);
    flyUp.current?.cancel();
    const a = reducedMotion() ? el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, easing: "ease-in", fill: "forwards" }) : el.animate(
      [
        { transform: now.transform, borderRadius: now.borderRadius },
        { transform: `translate(${to.x - t.x}px, ${to.y - t.y}px) scale(${to.w / t.w}, ${to.h / t.h})`, borderRadius: `${14 * (t.w / to.w)}px / ${14 * (t.h / to.h)}px` },
      ],
      { duration: 420, easing: "cubic-bezier(0.4, 0, 0.2, 1)", fill: "forwards" },
    );
    a.onfinish = onClose;
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.("textarea, input") || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape") { if (draft) setDraft(null); else if (placing) setPlacing(false); else close(); }
      if (e.key === "c") setPlacing((p) => !p);
      if (e.key === "d" && prev) setChanges((c) => !c);
      if (e.key === "ArrowLeft") setVi((i) => Math.max(0, i - 1));
      if (e.key === "ArrowRight") setVi((i) => Math.min(versions.length - 1, i + 1));
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [draft, placing, prev, closing]);

  const send = async (text: string) => {
    if (!draft) return;
    const c = await postComment({ page: page.id, hash: v.hash, x: draft.x, y: draft.y, text });
    onComment(c);
    setDraft(null);
    setPlacing(false);
  };

  return (
    <div ref={dialog} role="dialog" aria-modal="true" aria-label={`${clean(page.title)}, page`} tabIndex={-1} className="outline-none">
      <div className="fixed inset-0" onClick={() => (draft ? setDraft(null) : close())} />

      <div
        ref={box}
        className="fixed overflow-hidden bg-[#fbfaf7]"
        style={{
          left: rect.x, top: rect.y, width: rect.w, height: rect.h,
          borderRadius: 18, transformOrigin: "0 0", boxShadow: "var(--shadow-stage)",
        }}
      >
        {/* the version's first screen holds the stage until the live page or the comparison is
            ready, so it never sits blank; a hairline runs along the top while it works */}
        <img
          src={thumb(v.hash)}
          alt=""
          onError={(e) => { e.currentTarget.style.visibility = "hidden"; }}
          className="absolute left-0 top-0 w-full"
          style={{ opacity: surfaceReady && !closing ? 0 : 1, transition: "opacity 260ms var(--ease-out) 120ms" }}
        />
        {landed && !surfaceReady && (
          <div className="pointer-events-none absolute inset-x-0 top-0 h-[2px] overflow-hidden">
            <div className="h-full w-1/3" style={{ background: "linear-gradient(90deg, transparent, var(--honey), transparent)", animation: "wb-work 1100ms var(--ease-out) infinite" }} />
            <style>{`@keyframes wb-work { from { transform: translateX(-100%) } to { transform: translateX(300%) } }`}</style>
          </div>
        )}
        {landed && (
          <Surface
            onReady={setSurfaceReady}
            key={`${v.hash}${showChanges ? "c" : ""}`}
            hash={v.hash}
            before={showChanges ? prev!.hash : null}
            scale={scale}
            height={rect.h}
            placing={placing}
            notes={notes}
            draft={draft}
            current={v.hash}
            onPlace={(x, y) => setDraft({ x, y })}
            onSend={send}
            onCancel={() => setDraft(null)}
            hidden={closing}
          />
        )}
      </div>

      <Controls
        page={page}
        vi={vi}
        setVi={setVi}
        canCompare={!!prev && canPreview}
        changes={showChanges}
        toggleChanges={() => setChanges((c) => !c)}
        placing={placing}
        togglePlacing={() => setPlacing((p) => !p)}
        thread={thread && !thread.gone ? thread.id : undefined}
        closing={closing}
        onClose={close}
      />
    </div>
  );
}

/** The page itself (live and scrollable), or its before and after with what changed marked. */
function Surface({ hash, before, scale, height, placing, notes, draft, current, onPlace, onSend, onCancel, hidden, onReady }: {
  hash: string; before: string | null; scale: number; height: number; placing: boolean;
  notes: Comment[]; draft: { x: number; y: number } | null; current: string;
  onPlace: (x: number, y: number) => void; onSend: (t: string) => void; onCancel: () => void; hidden: boolean;
  onReady: (r: boolean) => void;
}) {
  const [scroll, setScroll] = useState(0);
  const [ready, setReady] = useState(false);
  useEffect(() => { onReady(ready); }, [ready]);
  const frame = useRef<HTMLIFrameElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [changes, setChanges] = useState<Changes>(null);
  const [pageH, setPageH] = useState(0);
  const [wipe, setWipe] = useState(0);

  useEffect(() => {
    if (!before) return;
    let live = true;
    const img = new Image();
    img.src = shot(hash, true);
    const height = new Promise<number>((r) => { img.onload = () => r(img.naturalHeight); img.onerror = () => r(800); });
    (async () => {
      let c: Changes = null;
      try { c = await blockChanges(pageSrc(before), pageSrc(hash)); } catch {}
      if (!c) {
        try { const d = await diffBoxes(shot(before, true), shot(hash, true)); c = { added: d.boxes, removed: [] }; } catch {}
      }
      const h = await height;
      if (!live) return;
      setPageH(h);
      setChanges(c);
      setReady(true);
      // Start at the first change.
      const first = c && [...c.added, ...c.removed].sort((p, q) => p.y - q.y)[0];
      if (first) requestAnimationFrame(() => scroller.current?.scrollTo({ top: Math.max(0, first.y * scale - 120) }));
    })();
    return () => { live = false; };
  }, [before, hash]);

  // Hold space to see the before; let go for the after.
  const flip = useRef(false);
  useEffect(() => {
    if (!before) return;
    const down = (e: KeyboardEvent) => {
      if (e.key !== " " || e.repeat || (e.target as HTMLElement)?.closest?.("textarea")) return;
      e.preventDefault();
      flip.current = true;
      setWipe(1);
    };
    const up = (e: KeyboardEvent) => {
      if (e.key !== " ") return;
      setWipe(0);
      setTimeout(() => (flip.current = false), 300);
    };
    addEventListener("keydown", down);
    addEventListener("keyup", up);
    return () => { removeEventListener("keydown", down); removeEventListener("keyup", up); };
  }, [before]);

  const onFrameLoad = () => {
    setReady(true);
    const w = frame.current?.contentWindow;
    if (!w) return;
    w.addEventListener("scroll", () => setScroll(w.scrollY), { passive: true });
    // Esc and the comment keys work while the page has focus.
    w.addEventListener("keydown", (e) => {
      if ((e.target as HTMLElement)?.closest?.("textarea, input, select, [contenteditable]")) return;
      dispatchEvent(new KeyboardEvent("keydown", { key: e.key, metaKey: e.metaKey, ctrlKey: e.ctrlKey, altKey: e.altKey, shiftKey: e.shiftKey }));
    });
  };

  const place = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    // In the compare view the layer scrolls with the page; over the live page it stays put.
    const top = before ? 0 : scroll * scale;
    onPlace((e.clientX - r.left) / scale, (e.clientY - r.top + top) / scale);
  };

  const offset = before ? 0 : scroll * scale; // pins ride with the page
  const pins = (
    <>
      {notes.map((n, i) => (
        <Pin key={n.id} n={i + 1} x={n.x * scale} y={n.y * scale - offset} note={n} faded={n.hash !== current} />
      ))}
      {draft && <Composer x={draft.x * scale} y={draft.y * scale - offset} n={notes.length + 1} onSend={onSend} onCancel={onCancel} />}
    </>
  );

  return (
    <div className="absolute inset-0" style={{ opacity: ready && !hidden ? 1 : 0, transition: "opacity 320ms var(--ease-out)" }}>
      {before ? (
        <div ref={scroller} className="absolute inset-0 overflow-y-auto overflow-x-hidden" style={{ scrollbarWidth: "none" }}>
          <Compare before={shot(before, true)} after={shot(hash, true)} changes={changes} pageH={pageH} scale={scale} wipe={wipe} setWipe={setWipe} animate={flip.current} />
          {placing && <div className="absolute inset-0" style={{ cursor: "crosshair", height: pageH * scale }} onClick={place} />}
          <div className="pointer-events-none absolute inset-0 [&>*]:pointer-events-auto">{pins}</div>
        </div>
      ) : null}
      {before && (
        <div
          className="glass pointer-events-none absolute top-1/2 flex h-11 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center gap-[3px] rounded-full"
          style={{ left: `clamp(22px, ${wipe * 100}%, calc(100% - 22px))`, transition: flip.current ? "left 280ms var(--ease-out)" : "none" }}
        >
          <span className="h-3.5 w-px bg-[var(--ink)] opacity-50" />
          <span className="h-3.5 w-px bg-[var(--ink)] opacity-50" />
        </div>
      )}
      {before ? null : (
        <>
          <iframe
            ref={frame}
            src={pageSrc(hash)}
            onLoad={onFrameLoad}
            className="absolute left-0 top-0 origin-top-left border-0 bg-white"
            style={{ width: PAGE_W, height: height / scale, transform: `scale(${scale})` }}
          />
          {placing && <div className="absolute inset-0" style={{ cursor: "crosshair" }} onClick={place} />}
          <div className="pointer-events-none absolute inset-0 overflow-hidden [&>*]:pointer-events-auto">{pins}</div>
        </>
      )}
    </div>
  );
}

function Compare({ before, after, changes, pageH, scale, wipe, setWipe, animate }: {
  before: string; after: string; changes: Changes; pageH: number;
  scale: number; wipe: number; setWipe: (w: number) => void; animate: boolean;
}) {
  const ease = animate ? "clip-path 280ms var(--ease-out), left 280ms var(--ease-out)" : "none";
  const el = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const h = pageH * scale;
  const move = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    const r = el.current!.getBoundingClientRect();
    setWipe(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)));
  };
  const marks = (boxes: Box[], tone: "added" | "removed") =>
    boxes.map((b, i) => (
      <div
        key={`${tone}${i}`}
        className="pointer-events-none absolute rounded-[10px]"
        style={{
          left: b.x * scale - 8, top: b.y * scale - 6, width: b.w * scale + 16, height: b.h * scale + 12,
          boxShadow: tone === "added"
            ? "0 0 0 1.5px var(--honey), 0 0 0 7px var(--honey-wash)"
            : "0 0 0 1.5px rgba(108, 103, 91, 0.55), 0 0 0 7px rgba(108, 103, 91, 0.1)",
          animation: `wb-in 520ms var(--ease-out) ${120 + Math.min(i, 8) * 50}ms both`,
        }}
      />
    ));
  return (
    <div ref={el} className="relative w-full" style={{ height: h }} onPointerMove={move} onPointerUp={() => (dragging.current = false)}>
      {/* after, with what is new marked in honey */}
      <div className="absolute inset-0" style={{ clipPath: `inset(0 0 0 ${wipe * 100}%)`, transition: ease }}>
        <img src={after} alt="" draggable={false} className="absolute left-0 top-0 w-full" />
        {changes && marks(changes.added, "added")}
      </div>
      {/* before, with what was cut marked in grey */}
      <div className="absolute inset-0" style={{ clipPath: `inset(0 ${(1 - wipe) * 100}% 0 0)`, transition: ease }}>
        <img src={before} alt="" draggable={false} className="absolute left-0 top-0 w-full" />
        {changes && marks(changes.removed, "removed")}
      </div>
      <div
        className="absolute top-0 cursor-ew-resize"
        style={{ left: `clamp(8px, calc(${wipe * 100}% - 14px), calc(100% - 36px))`, width: 28, height: h, touchAction: "none", transition: ease }}
        onPointerDown={(e) => { dragging.current = true; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); }}
        onPointerMove={move}
        onPointerUp={() => (dragging.current = false)}
      >
        <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-white shadow-[0_0_0_0.5px_rgba(28,25,20,0.22)]" />
      </div>
      <style>{`@keyframes wb-in { from { opacity: 0; transform: scale(1.03) } to { opacity: 1; transform: none } }`}</style>
    </div>
  );
}

/** Where a note goes, in a line: to its session now, with the next message there, or nowhere. */
function whereTo(note: Comment) {
  const to = note.threadTitle ? `“${note.threadTitle}”` : "its session";
  if (note.reply) return note.threadTitle ? `“${note.threadTitle}” replied` : "Its session replied";
  if (note.state === "sent") return `Sent to ${to}`;
  if (note.state === "kept" || note.route === "kept") return note.thread ? "Stays here: its session is no longer on this Mac" : "Stays here: no session made this";
  if (note.route === "relay") return `On its way to ${to}`;
  return `Goes to ${to} with your next message there`;
}

export function Pin({ n, x, y, note, faded }: { n: number; x: number; y: number; note: Comment; faded: boolean }) {
  const [hover, setHover] = useState(false);
  const kept = note.state === "kept" && !note.reply;
  const done = note.state === "sent" || !!note.reply;
  return (
    <div className="absolute" style={{ left: x, top: y, opacity: faded ? 0.5 : 1 }} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <div
        className="type-mono absolute grid h-7 min-w-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full px-1.5 text-[12px] font-medium text-white"
        style={{ background: kept ? "var(--quiet)" : "var(--honey)", boxShadow: "0 0 0 3px rgba(255,255,255,0.9), var(--shadow-glass)", animation: "wb-pin 420ms var(--spring) both" }}
        aria-label={`Note ${n}: ${whereTo(note)}`}
      >
        {done ? <Glyph name="done" size={13} /> : n}
      </div>
      {hover && (
        <div className="glass thick absolute left-5 top-[-14px] w-72 rounded-[14px] px-3.5 py-3 text-[13px] leading-snug" style={{ animation: "wb-pop 220ms var(--ease-out) both" }}>
          {note.text}
          <div className="mt-2 text-[12px] text-[var(--muted)]">{whereTo(note)}</div>
          {note.reply && <div className="mt-2.5 border-t border-[var(--faint)] pt-2.5">{note.reply.text}</div>}
          <div className="type-mono mt-2 text-[11px] text-[var(--quiet)]">{when(note.reply?.at ?? note.at)}</div>
        </div>
      )}
      <style>{`@keyframes wb-pin { from { transform: scale(0.4); opacity: 0 } } @keyframes wb-pop { from { opacity: 0; transform: translateY(4px) } }`}</style>
    </div>
  );
}

export function Composer({ x, y, n, onSend, onCancel }: { x: number; y: number; n: number; onSend: (t: string) => void | Promise<void>; onCancel: () => void }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const go = async () => {
    if (!text.trim() || sending) return;
    setSending(true); setFailed(false);
    // if it doesn't reach Rounds, the words stay and it says so
    try { await onSend(text); } catch { setFailed(true); setSending(false); }
  };
  return (
    <div className="absolute" style={{ left: x, top: y }} onClick={(e) => e.stopPropagation()}>
      <div
        className="type-mono absolute grid h-7 min-w-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full text-[12px] font-medium text-white"
        style={{ background: "var(--honey)", boxShadow: "0 0 0 3px rgba(255,255,255,0.9), var(--shadow-glass)", animation: "wb-pin 420ms var(--spring) both" }}
      >
        {n}
      </div>
      <div className="glass thick absolute left-6 top-[-22px] flex w-80 items-end gap-2 rounded-[18px] p-2 pl-4" style={{ animation: "wb-pop 260ms var(--ease-out) both" }}>
        {failed && <div role="alert" className="absolute left-4 top-full mt-1.5 text-[12px] text-[var(--muted)]">Couldn't send. Try again.</div>}
        <textarea
          ref={ref}
          rows={1}
          aria-label="Note"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = `${e.target.scrollHeight}px`;
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); go(); }
            if (e.key === "Escape") onCancel();
          }}
          className="max-h-48 min-h-[28px] flex-1 resize-none bg-transparent py-1 text-[14px] leading-[20px] outline-none focus-visible:outline-none"
        />
        <button
          onClick={go}
          disabled={!text.trim()}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-white transition-[opacity,transform] duration-200 disabled:opacity-25 active:scale-95"
          style={{ background: "var(--ink)" }}
          aria-label="Send"
        >
          <Glyph name="send" size={16} />
        </button>
      </div>
    </div>
  );
}

function Controls({ page, vi, setVi, canCompare, changes, toggleChanges, placing, togglePlacing, thread, closing, onClose }: {
  page: Page; vi: number; setVi: (i: number) => void; canCompare: boolean; changes: boolean; toggleChanges: () => void;
  placing: boolean; togglePlacing: () => void; thread?: string; closing: boolean; onClose: () => void;
}) {
  const versions = page.versions;
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? vi;
  const date = useMemo(() => when(versions[shown].at), [shown]);
  return (
    <div
      className="fixed bottom-7 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full p-1.5 glass"
      style={{ animation: closing ? "wb-down 300ms var(--ease-out) both" : "wb-up 520ms var(--ease-fly) 160ms both" }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-3 pl-4 pr-3">
        <span className="type-card max-w-[300px] truncate">{clean(page.title)}</span>
        <span className="type-mono text-[var(--muted)]">{date}</span>
      </div>
      {versions.length > 1 && (
        <div className="flex h-11 items-center px-2" onMouseLeave={() => setHover(null)}>
          {/* one block per publish, left to right in time, the one on stage in ink */}
          {versions.map((_, i) => (
            <button
              key={i}
              className="grid h-11 w-[15px] place-items-center"
              onMouseEnter={() => setHover(i)}
              onClick={() => setVi(i)}
              aria-label={`Version ${i + 1}`}
            >
              <span
                className="block h-[10px] w-[10px] rounded-[2.5px] transition-[background,transform] duration-300"
                style={{
                  background: i === vi ? "var(--ink)" : hover === i ? "rgba(28,25,20,0.5)" : "rgba(28,25,20,0.2)",
                  transform: i === vi ? "scale(1.12)" : "none",
                  transitionTimingFunction: "var(--spring)",
                  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.3)",
                }}
              />
            </button>
          ))}
        </div>
      )}
      {canCompare && <Btn on={changes} onClick={toggleChanges} label="Changes"><Glyph name="eye" /></Btn>}
      <Btn on={placing} onClick={togglePlacing} label="Comment" honey><Glyph name="comment" /></Btn>
      {thread && (
        <a href={threadLink(thread)} target="_blank" rel="noreferrer" className="grid h-11 w-11 place-items-center rounded-full text-[var(--ink)] transition-colors hover:bg-black/5" aria-label="Open thread">
          <Glyph name="open" />
        </a>
      )}
      <Btn onClick={onClose} label="Close"><Glyph name="close" /></Btn>
      <style>{`@keyframes wb-up { from { opacity: 0; transform: translateY(16px) } } @keyframes wb-down { to { opacity: 0; transform: translateY(12px) } }`}</style>
    </div>
  );
}

export function Btn({ on, honey, disabled, onClick, label, children }: { on?: boolean; honey?: boolean; disabled?: boolean; onClick: () => void; label: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={on}
      className="grid h-11 w-11 place-items-center rounded-full transition-[background,color,transform] duration-200 active:scale-95"
      style={{ background: on ? (honey ? "var(--honey)" : "var(--ink)") : "transparent", color: on ? "white" : "var(--ink)" }}
    >
      {children}
    </button>
  );
}
