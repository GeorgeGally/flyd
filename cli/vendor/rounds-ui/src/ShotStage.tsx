// A screen opened from the canvas: it flies up from where it lay to fill the stage at its own
// proportions, the rest of its group a step away with the arrows. Pin a comment anywhere on it
// and it goes to the thread that showed it to him.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { img, postComment, threadLink, when, type Comment, type Shot } from "./data";
import type { Group } from "./layout";
import { Btn, Composer, Pin } from "./Stage";
import { Glyph } from "./glyphs";
import { reducedMotion } from "./look";
import type { Rect } from "./Stage";

export type ShotOpening = { group: Group; i: number; from: Rect; place?: boolean };
type ShotItem = Extract<Group["all"][number], { kind: "shot" }>;

const shotKey = (s: Shot) => `shot-${s.hash}`;

function fitRect(s: Shot): Rect {
  const maxW = innerWidth - 2 * 64, maxH = innerHeight - 40 - 112;
  const k = Math.min(maxW / s.w, maxH / s.h, 1.5);
  const w = Math.round(s.w * k), h = Math.round(s.h * k);
  return { x: Math.round((innerWidth - w) / 2), y: 40 + Math.round((maxH - h) / 2), w, h };
}

const flight = (from: Rect, to: Rect) =>
  `translate(${from.x - to.x}px, ${from.y - to.y}px) scale(${from.w / to.w}, ${from.h / to.h})`;

// A step to the next screen morphs: each screen keeps its own size the whole way, so a phone
// never shows cropped inside a desktop frame, and only the frame changes shape around them. The
// larger lies underneath, solid, and the smaller crossfades on top, so the frame always closes
// in on, or opens out onto, a real picture.

// A critically damped spring as an easing: it leaves gently, never overshoots, and settles
// without a long crawl. `response` is Apple's: roughly how long the move takes, in seconds.
function spring(response: number, ms: number, n = 48) {
  const w = (2 * Math.PI) / response, f = (t: number) => 1 - (1 + w * t) * Math.exp(-w * t), end = f(ms / 1000);
  const pts = Array.from({ length: n + 1 }, (_, k) => (f((ms / 1000) * (k / n)) / end).toFixed(4));
  return typeof CSS !== "undefined" && CSS.supports("transition-timing-function", "linear(0, 1)") ? `linear(${pts.join(", ")})` : "cubic-bezier(0.33, 0, 0.2, 1)";
}
const FRAME_MS = 620, FADE_MS = 440;
const FRAME = spring(0.48, FRAME_MS), FADE = spring(0.34, FADE_MS);
type Leaving = { key: string; src: string; at: Rect; id: number };
// the screen as the canvas holds it, already loaded: shown under the larger image until it arrives
const tileSrc = (key: string) => (document.querySelector(`[data-key="${key}"] img`) as HTMLImageElement | null)?.currentSrc || "";

export function ShotStage({ opening, comments, gone, onComment, onStep, onClosing, onClose }: {
  opening: ShotOpening; comments: Comment[]; gone: Set<string>;
  onComment: (c: Comment) => void; onStep: (key: string) => void; onClosing?: () => void; onClose: () => void;
}) {
  const { group } = opening;
  const shots = group.all.filter((it): it is ShotItem => it.kind === "shot");
  const [i, setI] = useState(() => Math.max(0, shots.findIndex((s) => s.key === group.items[opening.i]?.key)));
  // The screen as the canvas already holds it, loaded and decoded: it lies under the larger image,
  // so the card never flies up blank (the canvas's copy hides the moment this one shows).
  const unders = useRef(new Map<string, string>());
  const underOf = (key: string) => { if (!unders.current.has(key)) unders.current.set(key, tileSrc(key)); return unders.current.get(key)!; };
  underOf(shots[i].key);
  const [leaving, setLeaving] = useState<Leaving | null>(null);
  const s = shots[i].shot;
  const thread = shots[i].thread; // a topic gathers sends from many threads; each screen keeps its own
  const [rect, setRect] = useState(() => fitRect(s));
  const [landed, setLanded] = useState(false);
  const [full, setFull] = useState(false);
  // before and after: the before shows to the left of the divider; drag it, or hold space
  const bef = shots[i].before;
  const [wipe, setWipe] = useState(0);
  const [flip, setFlip] = useState(false);
  const wiping = useRef(false);
  useEffect(() => {
    if (!bef) return;
    const down = (e: KeyboardEvent) => { if (e.key !== " " || e.repeat || (e.target as HTMLElement)?.closest?.("textarea")) return; e.preventDefault(); setFlip(true); setWipe(1); };
    const up = (e: KeyboardEvent) => { if (e.key !== " ") return; setWipe(0); setTimeout(() => setFlip(false), 300); };
    addEventListener("keydown", down); addEventListener("keyup", up);
    return () => { removeEventListener("keydown", down); removeEventListener("keyup", up); };
  }, [bef]);
  const [closing, setClosing] = useState(false);
  const [placing, setPlacing] = useState(!!opening.place);
  const [draft, setDraft] = useState<{ x: number; y: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  // the keyboard comes into the viewer, and goes back to where it was when the viewer closes
  const dialog = useRef<HTMLDivElement>(null);
  const [was] = useState(() => document.activeElement as HTMLElement | null); // before the canvas goes out of reach
  useEffect(() => {
    dialog.current?.focus({ preventScroll: true });
    return () => { requestAnimationFrame(() => { if (was?.isConnected && was !== document.body) was.focus({ preventScroll: true }); }); };
  }, []);
  const notes = comments.filter((c) => c.page === shotKey(s));
  // this screen's own size, worked out now rather than a render later, so it never shows at the
  // last screen's size; and which of the two is the larger, for the morph
  const own = fitRect(s);
  const oldOver = !leaving || leaving.at.w * leaving.at.h >= own.w * own.h;

  useEffect(() => { setRect(fitRect(s)); setFull(false); setDraft(null); setWipe(0); onStep(shots[i].key); }, [i]);
  // the screens either side, loaded before they're asked for
  useEffect(() => { for (const j of [i - 1, i + 1]) if (shots[j]) { underOf(shots[j].key); new Image().src = img(shots[j].shot, 960); } }, [i]);
  // the old screen goes once it has had its moment
  useEffect(() => { if (!leaving) return; const t = setTimeout(() => setLeaving(null), FRAME_MS + 40); return () => clearTimeout(t); }, [leaving]);
  useEffect(() => {
    const r = () => setRect(fitRect(s));
    addEventListener("resize", r);
    return () => removeEventListener("resize", r);
  }, [s]);

  // Fly up from the paper; transform only, so it holds frame.
  const flyUp = useRef<Animation | null>(null);
  useLayoutEffect(() => {
    const a = reducedMotion()
      ? box.current!.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: "ease-out" })
      : box.current!.animate(
        [{ transform: flight(opening.from, rect), borderRadius: `${10 * (rect.w / opening.from.w)}px` }, { transform: "none", borderRadius: "14px" }],
        { duration: 560, easing: "cubic-bezier(0.3, 0.7, 0.1, 1)" },
      );
    flyUp.current = a;
    a.onfinish = () => setLanded(true);
    return () => a.cancel();
  }, []);

  // Close back to wherever this screen lies on the canvas now.
  const close = () => {
    if (closing) return;
    setClosing(true);
    onClosing?.(); // the canvas clears as the card flies back, not after it lands
    const el = document.querySelector(`[data-key="${shots[i].key}"]`) as HTMLElement | null;
    const r = el?.getBoundingClientRect();
    const to = r ? { x: r.left, y: r.top, w: r.width, h: r.height } : opening.from;
    // from wherever the card is now: closed mid-flight, it turns around instead of jumping to full size
    const now = getComputedStyle(box.current!);
    const at = { transform: now.transform, borderRadius: now.borderRadius };
    flyUp.current?.cancel();
    const a = reducedMotion()
      ? box.current!.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, easing: "ease-in", fill: "forwards" })
      : box.current!.animate(
        [at, { transform: flight(to, rect), borderRadius: `${10 * (rect.w / to.w)}px` }],
        { duration: 420, easing: "cubic-bezier(0.4, 0, 0.2, 1)", fill: "forwards" },
      );
    a.onfinish = onClose;
  };

  const step = (d: number) => {
    const j = Math.max(0, Math.min(shots.length - 1, i + d));
    if (j === i || closing || !landed) return;
    // the screen being left, as sharp as it was showing, at its own size
    setLeaving({ key: shots[i].key, src: full ? img(s) : img(s, 960), at: own, id: performance.now() });
    setI(j);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.("textarea, input") || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape") { if (draft) setDraft(null); else if (placing) setPlacing(false); else close(); }
      if (e.key === "c") setPlacing((p) => !p);
      if (e.key === "ArrowLeft") step(-1);
      if (e.key === "ArrowRight") step(1);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [draft, placing, closing, i, full, landed]);

  const send = async (text: string) => {
    if (!draft) return;
    const c = await postComment({ page: shotKey(s), hash: s.hash, set: shots[i].set, x: draft.x, y: draft.y, text });
    onComment(c);
    setDraft(null);
    setPlacing(false);
  };

  const place = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setDraft({ x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height });
  };

  return (
    <div ref={dialog} role="dialog" aria-modal="true" aria-label={`${group.title}, ${shots.length > 1 ? `screen ${i + 1} of ${shots.length}` : "screen"}`} tabIndex={-1} className="outline-none">
      <div className="fixed inset-0" onClick={() => (draft ? setDraft(null) : close())} />

      <div
        ref={box}
        className="fixed bg-[var(--wall-deep)]"
        style={{
          left: rect.x, top: rect.y, width: rect.w, height: rect.h, borderRadius: 14, transformOrigin: "0 0",
          boxShadow: "var(--shadow-stage)",
          transition: landed ? ["left", "top", "width", "height"].map((p) => `${p} ${FRAME_MS}ms ${FRAME}`).join(", ") : "none",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* its own layer, so its rounded corners clip the sharp copy fading in (Chrome let it square them) */}
        <div className="absolute inset-0 overflow-hidden" style={{ borderRadius: "inherit", willChange: "transform" }}>
          {/* morph: the screen being left, at its own size; underneath and solid when it's the larger */}
          {leaving && oldOver && (
            <img key={`l${leaving.id}`} src={leaving.src} alt="" draggable={false} className="absolute left-1/2 top-1/2 max-w-none object-cover object-top" style={{ width: leaving.at.w, height: leaving.at.h, transform: "translate(-50%, -50%)" }} />
          )}
          {/* the screen at its own size, centered: the frame changes shape around it, never the
              picture; when it's the smaller, it fades in over the one it replaces */}
          <div key={`c${s.hash}`} className="absolute left-1/2 top-1/2" style={{ width: own.w, height: own.h, transform: "translate(-50%, -50%)", animation: leaving && oldOver ? `wb-fade-in ${FADE_MS}ms ${FADE} both` : undefined }}>
            {underOf(shots[i].key) && <img src={underOf(shots[i].key)} alt="" draggable={false} className="absolute inset-0 h-full w-full object-cover object-top" />}
            <img key={`m${s.hash}`} src={img(s, 960)} alt="" draggable={false} className="absolute inset-0 h-full w-full object-cover object-top" />
            {landed && (
              <img
                key={`f${s.hash}`}
                src={img(s)}
                alt=""
                draggable={false}
                onLoad={() => setFull(true)}
                className="absolute inset-0 h-full w-full object-cover object-top"
                style={{ opacity: full ? 1 : 0, transition: "opacity 260ms var(--ease-out)" }}
              />
            )}
            {bef && (
              <div className="absolute inset-0" style={{ clipPath: `inset(0 ${(1 - wipe) * 100}% 0 0)`, transition: flip ? "clip-path 280ms var(--ease-out)" : "none" }}>
                <img key={`b${bef.hash}`} src={img(bef, 1600)} alt="" draggable={false} className="absolute inset-0 h-full w-full object-cover object-top" />
              </div>
            )}
          </div>
          {leaving && !oldOver && (
            <img key={`l${leaving.id}`} src={leaving.src} alt="" draggable={false} className="absolute left-1/2 top-1/2 max-w-none object-cover object-top" style={{ width: leaving.at.w, height: leaving.at.h, transform: "translate(-50%, -50%)", animation: `wb-fade-out ${FADE_MS}ms ${FADE} both` }} />
          )}
          <span className="pointer-events-none absolute inset-0 shadow-[inset_0_0_0_0.5px_rgba(28,25,20,0.14)]" style={{ borderRadius: "inherit" }} />
        </div>
        {bef && !placing && (
          <div
            className="absolute inset-y-0 cursor-ew-resize touch-none"
            style={{ left: `clamp(0px, calc(${wipe * 100}% - 22px), calc(100% - 44px))`, width: 44, transition: flip ? "left 280ms var(--ease-out)" : "none", opacity: landed && !closing && !leaving ? 1 : 0 }}
            onPointerDown={(e) => { wiping.current = true; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); }}
            onPointerMove={(e) => { if (!wiping.current) return; const r = box.current!.getBoundingClientRect(); setWipe(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))); }}
            onPointerUp={() => { wiping.current = false; }}
            role="slider"
            aria-label="Before and after"
            aria-valuenow={Math.round(wipe * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuetext={`Before shown across ${Math.round(wipe * 100)}%`}
            tabIndex={0}
            onKeyDown={(e) => {
              const k = { ArrowLeft: -0.1, ArrowRight: 0.1, Home: -1, End: 1 }[e.key];
              if (k == null) return;
              e.preventDefault(); e.stopPropagation();
              setWipe((w) => Math.min(1, Math.max(0, w + k)));
            }}
          >
            <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-white shadow-[0_0_0_0.5px_rgba(28,25,20,0.25)]" />
            <div className="glass absolute left-1/2 top-1/2 flex h-11 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center gap-[3px] rounded-full" style={{ position: "absolute" }}>
              <span className="h-3.5 w-px bg-[var(--ink)] opacity-50" />
              <span className="h-3.5 w-px bg-[var(--ink)] opacity-50" />
            </div>
          </div>
        )}
        {placing && <div className="absolute inset-0" style={{ cursor: "crosshair" }} onClick={place} />}
        <div className="pointer-events-none absolute inset-0 [&>*]:pointer-events-auto" style={{ opacity: landed && !closing && !leaving ? 1 : 0, transition: "opacity 200ms var(--ease-out)" }}>
          {notes.map((n, k) => <Pin key={n.id} n={k + 1} x={n.x * rect.w} y={n.y * rect.h} note={n} faded={false} />)}
          {draft && <Composer x={draft.x * rect.w} y={draft.y * rect.h} n={notes.length + 1} onSend={send} onCancel={() => setDraft(null)} />}
        </div>
      </div>

      <div
        className="glass fixed bottom-7 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full p-1.5"
        style={{ animation: closing ? "wb-down 300ms var(--ease-out) both" : "wb-up 520ms var(--ease-fly) 160ms both" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 pl-4 pr-3">
          <span className="type-card max-w-[340px] truncate">{group.title}</span>
          <span className="type-mono text-[var(--muted)]">{shots.length > 1 ? `${i + 1} of ${shots.length}` : when(group.at)}</span>
        </div>
        {shots.length > 1 && (
          <>
            <Btn onClick={() => step(-1)} label="Previous" disabled={i === 0}><span style={{ opacity: i === 0 ? 0.3 : 1 }}><Glyph name="back" /></span></Btn>
            <Btn onClick={() => step(1)} label="Next" disabled={i === shots.length - 1}><span style={{ opacity: i === shots.length - 1 ? 0.3 : 1 }}><Glyph name="next" /></span></Btn>
          </>
        )}
        <Btn on={placing} onClick={() => setPlacing((p) => !p)} label="Comment" honey><Glyph name="comment" /></Btn>
        {thread && !gone.has(thread) && (
          <a href={threadLink(thread)} target="_blank" rel="noreferrer" className="grid h-11 w-11 place-items-center rounded-full text-[var(--ink)] transition-colors hover:bg-black/5" aria-label="Open thread">
            <Glyph name="open" />
          </a>
        )}
        <Btn onClick={close} label="Close"><Glyph name="close" /></Btn>
        <style>{`@keyframes wb-up { from { opacity: 0; transform: translateY(16px) } } @keyframes wb-down { to { opacity: 0; transform: translateY(12px) } } @keyframes wb-pin { from { transform: scale(0.4); opacity: 0 } } @keyframes wb-pop { from { opacity: 0; transform: translateY(4px) } } @keyframes wb-fade-in { from { opacity: 0 } } @keyframes wb-fade-out { to { opacity: 0 } }`}</style>
      </div>
    </div>
  );
}
