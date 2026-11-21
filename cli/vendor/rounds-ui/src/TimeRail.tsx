// Time, as a rail down the right edge, the way Time Machine keeps it: today at the bottom,
// older days rising toward the stack of sheets behind the canvas. The playhead stands still at
// the rail's middle with the day's name beside it; time moves under it. Scroll or drag along
// the rail to travel (it carries on at your hand's speed, then settles on a day), pinch or
// ⌘/ctrl scroll to see days, weeks or months, tap a day to go there.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { reducedTransparency } from "./look";
import type { Index } from "./data";
import { dayKey, endOfDay } from "./days";

const DAY = 864e5;
const W = 148; // the band along the right edge the rail lives in
const TOP = 24, FOOT = 24; // air above and below; the Today row on the rail is how you get home
const DOCK_CLEAR = 24 + 56 + 20; // the rail ends above the dock, at any window width
const MIN_PPD = 3, MAX_PPD = 64;
const BASE = 100; // x of the spine: lines grow left of it, ticks and labels to its right

const startOf = (k: number) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - k); return d; };

export function TimeRail({ index, asOf, open, onDay, onClose }: {
  index: Index; asOf: number | null; open: boolean; onDay: (t: number | null) => void; onClose: () => void;
}) {
  const solid = reducedTransparency();
  const [vh, setVh] = useState(innerHeight);
  useEffect(() => { const r = () => setVh(innerHeight); addEventListener("resize", r); return () => removeEventListener("resize", r); }, []);
  const H = vh - DOCK_CLEAR; // from the top of the window down to just above the dock
  const RH = H - TOP - FOOT; // ruler height

  // how much happened each day, k days ago, scaled to his own busy days
  const { load, span, peak } = useMemo(() => {
    const byKey = new Map<string, number>();
    const add = (k: string, n: number) => byKey.set(k, (byKey.get(k) || 0) + n);
    for (const t of index.threads) for (const [d, n] of Object.entries(t.days || {})) add(d, n);
    for (const p of index.pages) for (const v of p.versions) add(dayKey(new Date(v.at)), 6);
    for (const s of index.sets || []) add(dayKey(new Date(s.at)), 3);
    let first = Date.now();
    for (const k of byKey.keys()) first = Math.min(first, new Date(`${k}T12:00`).getTime());
    const span = Math.max(30, Math.ceil((Date.now() - first) / DAY) + 2);
    const load = new Float32Array(span + 1);
    for (let k = 0; k <= span; k++) load[k] = byKey.get(dayKey(startOf(k))) || 0;
    const busy = [...load].filter((n) => n > 0).sort((a, b) => a - b);
    const peak = busy.length ? busy[Math.floor(busy.length * 0.9)] : 1;
    return { load, span, peak };
  }, [index]);

  const shownK = asOf == null ? 0 : Math.max(0, Math.round((endOfDay(new Date()) - asOf) / DAY));
  const s = useRef({ d: shownK, target: shownK, ppd: 14, dragging: false, committed: shownK, lastCommit: 0, hover: null as number | null, following: false });
  const canvas = useRef<HTMLCanvasElement>(null);
  const raf = useRef(0);
  const [label, setLabel] = useState(shownK);
  const rail = useRef<HTMLDivElement>(null);
  useEffect(() => { if (rail.current) (rail.current as any).inert = !open; }, [open]);

  // follow day changes made elsewhere (arrows, search); its own commits come back too
  useEffect(() => {
    const st = s.current;
    if (st.dragging || shownK === st.committed) return;
    // a day picked elsewhere: glide there (or jump, while closed) without reporting the days
    // passed on the way, or the canvas would be pulled back through each of them
    st.committed = shownK;
    st.target = shownK;
    if (!open) { st.d = shownK; setLabel(shownK); draw(); return; }
    st.following = true;
    kick();
  }, [shownK]);

  const commit = (k: number, force = false) => {
    const st = s.current;
    const now = performance.now();
    if (st.following) { if (force) st.following = false; return; }
    if (k === st.committed || (!force && now - st.lastCommit < 90)) return;
    st.committed = k; st.lastCommit = now;
    onDay(k === 0 ? null : endOfDay(startOf(k)));
  };

  // Each day a hairline growing left from the baseline, as long as the day was busy; the
  // calendar's ticks to its right (each day, longer on Mondays, longest on a month's first)
  // with month names and Today beside them. Lines near the playhead swell a little.
  const draw = () => {
    const c = canvas.current;
    if (!c) return;
    const st = s.current;
    const dpr = Math.min(2, devicePixelRatio);
    if (c.height !== Math.round(RH * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(RH * dpr); }
    const g = c.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, RH);
    const css = getComputedStyle(document.documentElement);
    const quiet = css.getPropertyValue("--quiet").trim() || "#9aa2ad";
    const ink = "21,24,29";
    const ppd = st.ppd, mid = RH / 2;
    const maxL = 72;
    const lw = ppd >= 30 ? 2 : ppd >= 9 ? 1.5 : 1;
    const at = (k: number) => Math.round((mid - (k - st.d) * ppd) * 2) / 2; // older is higher
    g.lineCap = "round";
    g.fillStyle = `rgba(${ink},0.1)`;
    g.fillRect(BASE, 0, 1, RH);
    const kMin = Math.floor(st.d - mid / ppd) - 1;
    const kMax = Math.min(span + 1, Math.ceil(st.d + mid / ppd) + 1);
    for (let k = kMin; k <= kMax; k++) {
      const y = at(k);
      if (y < -4 || y > RH + 4) continue;
      const day = startOf(k);
      const month = day.getDate() === 1, week = day.getDay() === 1;
      if (ppd >= 6 || week || month) {
        g.strokeStyle = `rgba(${ink},${k < 0 ? 0.08 : month ? 0.42 : week ? 0.26 : 0.14})`;
        g.lineWidth = 1;
        g.beginPath(); g.moveTo(BASE + 4, y); g.lineTo(BASE + 4 + (month ? 8 : week ? 5 : 3), y); g.stroke();
      }
      if (k < 0) continue;
      const n = load[k] || 0;
      const a = n ? Math.pow(Math.min(1, n / peak), 0.8) : 0;
      const m = Math.max(0, 1 - Math.abs(y - mid) / 64);
      const len = (n ? 6 + a * (maxL - 6) : 2.5) * (1 + 0.3 * m * m);
      const ahead = k < st.d - 0.5;
      g.strokeStyle = `rgba(${ink},${Math.min(0.9, (n ? 0.2 + 0.45 * a : 0.12) * (ahead ? 0.45 : 1) + 0.22 * m)})`;
      g.lineWidth = lw * (1 + 0.35 * m);
      g.beginPath(); g.moveTo(BASE, y); g.lineTo(BASE - len, y); g.stroke();
    }
    if (st.hover != null && !st.dragging) {
      const k = Math.max(0, Math.min(span, Math.round(st.d + (mid - st.hover) / ppd)));
      const y = at(k);
      if (Math.abs(y - mid) > 3) {
        g.strokeStyle = "rgba(63,111,224,0.45)";
        g.lineWidth = 1;
        g.beginPath(); g.moveTo(BASE - maxL - 6, y); g.lineTo(BASE, y); g.stroke();
      }
    }
    // labels to the right of the ticks: Today and month names first, then day numbers that fit
    g.font = `500 10px ${css.getPropertyValue("--font-mono") || "monospace"}`;
    g.textAlign = "left";
    g.textBaseline = "middle";
    const cand: { y: number; text: string; rank: number; future: boolean }[] = [];
    for (let k = kMin; k <= kMax; k++) {
      const y = at(k);
      if (y < 8 || y > RH - 8) continue;
      const day = startOf(k);
      const first = day.getDate() === 1, monday = day.getDay() === 1;
      if (k === 0) cand.push({ y, text: "Today", rank: 0, future: false });
      else if (first) cand.push({ y, text: day.toLocaleDateString([], { month: "short" }), rank: 1, future: k < 0 });
      else if (ppd >= 20 || (ppd >= 10 && monday)) cand.push({ y, text: String(day.getDate()), rank: 2, future: k < 0 });
    }
    cand.sort((a, b) => a.rank - b.rank);
    const placed: number[] = [];
    for (const l of cand) {
      if (placed.some((p) => Math.abs(p - l.y) < 15)) continue;
      // keep clear of the playhead's own row
      if (Math.abs(l.y - mid) < 9 && l.rank > 0) continue;
      placed.push(l.y);
      g.fillStyle = l.rank < 2 ? `rgba(${ink},0.85)` : quiet;
      g.globalAlpha = l.future ? 0.45 : 1;
      g.fillText(l.text, BASE + 15, l.y + 0.5);
      g.globalAlpha = 1;
    }
  };

  const last = useRef(0);
  const tick = (now: number) => {
    const st = s.current;
    const dt = Math.min(0.05, (now - (last.current || now)) / 1000 || 1 / 60);
    last.current = now;
    st.d += (st.target - st.d) * (1 - Math.exp(-dt / 0.14));
    const done = Math.abs(st.target - st.d) < 0.002;
    if (done) st.d = st.target;
    draw();
    const day = Math.max(0, Math.min(span, Math.round(st.d)));
    setLabel(day);
    commit(day, done);
    raf.current = done ? 0 : requestAnimationFrame(tick);
  };
  const kick = () => { if (!raf.current) { last.current = 0; raf.current = requestAnimationFrame(tick); } };
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  useLayoutEffect(() => { draw(); }, [RH, load, open, peak]);

  const clamp = (d: number) => Math.max(0, Math.min(span, d));
  const band = (d: number) => (d < 0 ? d * 0.25 : d > span ? span + (d - span) * 0.25 : d);

  const drag = useRef<{ y: number; d: number; t: number; v: number; moved: boolean } | null>(null);
  const local = (e: React.PointerEvent) => e.clientY - (e.currentTarget as HTMLElement).getBoundingClientRect().top;
  const onDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    s.current.dragging = true;
    s.current.following = false;
    cancelAnimationFrame(raf.current); raf.current = 0;
    drag.current = { y: e.clientY, d: s.current.d, t: performance.now(), v: 0, moved: false };
  };
  const onMove = (e: React.PointerEvent) => {
    const g = drag.current;
    const st = s.current;
    if (!g) { st.hover = local(e); if (!raf.current) draw(); return; }
    const dy = e.clientY - g.y;
    if (!g.moved && Math.abs(dy) < 3) return;
    g.moved = true;
    // drag the days down and older ones come down to the playhead
    const nd = band(g.d + dy / st.ppd);
    const now = performance.now();
    g.v = (nd - st.d) / Math.max(1, now - g.t); g.t = now;
    st.d = st.target = nd;
    draw();
    const day = Math.round(clamp(st.d));
    setLabel(day);
    commit(day);
  };
  const onUp = (e: React.PointerEvent) => {
    const g = drag.current;
    drag.current = null;
    const st = s.current;
    st.dragging = false;
    if (g && !g.moved) st.target = clamp(Math.round(st.d + (RH / 2 - local(e)) / st.ppd));
    else if (g) st.target = clamp(Math.round(st.d + (performance.now() - g.t > 100 ? 0 : (g.v * 0.998) / (1 - 0.998))));
    kick();
  };

  // scroll travels along the rail; pinch (or ⌘/ctrl scroll) zooms time about the playhead
  const ruler = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ruler.current;
    if (!el) return;
    const settle = { t: 0 };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const st = s.current;
      st.following = false;
      if (e.ctrlKey || e.metaKey) {
        st.ppd = Math.max(MIN_PPD, Math.min(MAX_PPD, st.ppd * Math.exp(-e.deltaY * 0.01)));
        draw();
        return;
      }
      st.d = st.target = clamp(st.d - e.deltaY / st.ppd);
      cancelAnimationFrame(raf.current); raf.current = 0;
      draw();
      const day = Math.round(st.d);
      setLabel(day);
      commit(day);
      clearTimeout(settle.t);
      settle.t = window.setTimeout(() => { st.target = clamp(Math.round(st.d)); kick(); }, 120);
    };
    // Safari's pinch comes as gesture events: over the rail it zooms time, not the canvas
    let pinch = 0;
    const onGesture = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      const st = s.current;
      if (e.type === "gesturestart") pinch = st.ppd;
      else if (e.type === "gesturechange" && pinch) { st.ppd = Math.max(MIN_PPD, Math.min(MAX_PPD, pinch * (e as Event & { scale: number }).scale)); draw(); }
      else pinch = 0;
    };
    const GESTURES = ["gesturestart", "gesturechange", "gestureend"];
    el.addEventListener("wheel", onWheel, { passive: false });
    for (const t of GESTURES) el.addEventListener(t, onGesture);
    return () => { el.removeEventListener("wheel", onWheel); for (const t of GESTURES) el.removeEventListener(t, onGesture); };
  }, [span, RH]);

  const go = (k: number) => { s.current.following = false; s.current.target = clamp(k); kick(); };
  const day = startOf(label);
  const name = label === 0 ? "Today" : label === 1 ? "Yesterday" : day.toLocaleDateString([], { weekday: "long" });
  const date = day.toLocaleDateString([], { month: "short", day: "numeric", year: day.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });

  return (
    <div
      ref={rail}
      data-chrome
      className="fixed"
      style={{
        top: 0, right: 0, width: W, height: H,
        transform: open ? "none" : "translateX(48px)",
        opacity: open ? 1 : 0,
        pointerEvents: open ? "auto" : "none",
        transition: open ? "transform 560ms cubic-bezier(0.22, 1, 0.36, 1), opacity 320ms var(--ease-out)" : "transform 360ms var(--ease-out), opacity 240ms var(--ease-out)",
        zIndex: 40,
      }}
      onPointerDown={(e) => e.stopPropagation()}
      aria-hidden={!open}
    >
      {/* no card: the edge of the window softens behind the rail, a blur that fades in toward
          the edge, so the lines hold over anything without a box around them */}
      <div
        className="pointer-events-none absolute inset-y-0 right-0"
        style={{
          width: W + 72,
          WebkitBackdropFilter: solid ? "none" : "blur(14px) saturate(1.15)",
          backdropFilter: solid ? "none" : "blur(14px) saturate(1.15)",
          background: `linear-gradient(270deg, color-mix(in srgb, var(--wall) ${solid ? 97 : 82}%, transparent) 30%, color-mix(in srgb, var(--wall) 0%, transparent))`,
          WebkitMaskImage: "linear-gradient(270deg, #000 38%, transparent), linear-gradient(180deg, #000 70%, transparent)",
          maskImage: "linear-gradient(270deg, #000 38%, transparent), linear-gradient(180deg, #000 70%, transparent)",
          WebkitMaskComposite: "source-in",
          maskComposite: "intersect",
        }}
      />
      <div
        ref={ruler}
        className="absolute inset-x-0 touch-none select-none outline-none"
        style={{
          top: TOP, height: RH, cursor: "ns-resize",
          // the ends dissolve, so time reads as going on past them
          WebkitMaskImage: "linear-gradient(180deg, transparent, #000 9%, #000 91%, transparent)",
          maskImage: "linear-gradient(180deg, transparent, #000 9%, #000 91%, transparent)",
        }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onPointerLeave={() => { s.current.hover = null; if (!raf.current) draw(); }}
        role="slider"
        aria-orientation="vertical"
        aria-label="Day"
        aria-valuetext={`${name} ${date}`}
        aria-valuenow={label}
        aria-valuemin={0}
        aria-valuemax={span}
        tabIndex={0}
        onKeyDown={(e) => {
          const to = { ArrowUp: label + 1, ArrowDown: label - 1, PageUp: label + 7, PageDown: label - 7, Home: 0, End: span }[e.key];
          if (to == null) return;
          e.preventDefault(); e.stopPropagation(); go(to);
        }}
      >
        <canvas ref={canvas} className="absolute inset-0" style={{ width: W, height: RH }} />
      </div>
      {/* the playhead stands still across the rail, the day's name beside it */}
      <div className="pointer-events-none absolute" style={{ top: TOP + RH / 2 - 1, left: BASE - 84, width: 84 + 8, height: 2 }}>
        <div className="h-full w-full rounded-full" style={{ background: "linear-gradient(90deg, transparent, var(--honey) 28%)" }} />
        <div className="absolute right-0 top-1/2 h-[9px] w-[9px] -translate-y-1/2 translate-x-1/2 rounded-full" style={{ background: "var(--honey)", boxShadow: "0 0 0 2px rgba(255,255,255,0.95), 0 1px 4px rgba(20,30,60,0.25)" }} />
      </div>
      <div
        className="glass thick pointer-events-none absolute flex h-9 items-center gap-1.5 whitespace-nowrap rounded-full px-4"
        style={{ top: TOP + RH / 2, right: W - BASE + 92, transform: "translateY(-50%)" }}
      >
        <span className="text-[14px] font-[600] tracking-[-0.01em] text-[var(--ink)]">{name}</span>
        <span className="text-[14px] font-[600] tracking-[-0.01em] text-[var(--quiet)]">{date}</span>
      </div>
    </div>
  );
}
