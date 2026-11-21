import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { reducedTransparency } from "./look";
import { clean, loadIndex, authUrl, readSeen, markSeen, type Index, type Page } from "./data";
import { layout, type Cluster, type Group } from "./layout";
import { useCamera, fit, type Cam } from "./camera";
import { Stage, type Opening } from "./Stage";
import { ClusterView, type FilesSheet } from "./Cluster";
import { FileStage, type FileOpening } from "./FileStage";
import { Ground } from "./Ground";
import { dayKey, endOfDay } from "./days";
import { Dock, type Tool } from "./Dock";
import { TimeRail } from "./TimeRail";
import { Search, type Hit } from "./Search";
import { ShotStage, type ShotOpening } from "./ShotStage";
import { Empty } from "./Empty";

// The day in two tones: what you'd call it, then the date.
function dayName(d: Date): [string, string] {
  const today = new Date();
  const y = new Date(); y.setDate(today.getDate() - 1);
  const date = d.toLocaleDateString([], { month: "short", day: "numeric" });
  if (dayKey(d) === dayKey(today)) return ["Today", date];
  if (dayKey(d) === dayKey(y)) return ["Yesterday", date];
  return [d.toLocaleDateString([], { weekday: "long" }), date];
}

// In the time machine the canvas becomes the front sheet of a stack of days: it shrinks
// back from the window's edges and the days before it wait behind, each a step higher.
const SHEET = { s: 0.86, top: 156 };
// The few things drawn at a constant size on screen whatever the zoom (project names, the drop
// ring) read it as --z, set on them alone: set on the whole world, WebKit restyled every screen
// on every frame of a pinch.
const zoomed = typeof document === "undefined" ? [] : document.getElementsByClassName("wb-z");
const setZoomVar = (z: number) => { for (const n of zoomed as HTMLCollectionOf<HTMLElement>) n.style.setProperty("--z", String(z)); };
// Far out (50% and less) in Safari the world splits into a layer per group, name and thread line
// (styles.css says why); Safari is told apart by its gesture events. Chrome rasters off its main
// thread and pans the one layer at full speed, so it keeps it.
const SPLITS = typeof window !== "undefined" && "GestureEvent" in window;
const SPLIT_Z = 0.5;
// Safari draws each of those layers at full resolution however far out it sits, so the split
// costs about the groups' own area in memory. A canvas past this stays one layer.
const SPLIT_BYTES = 640e6;
// keys typed into a field are the field's; a file picker's hidden input is no field to type in
const typing = (e: KeyboardEvent) => !!(e.target as HTMLElement)?.closest?.("textarea, input:not([type=file]), [contenteditable]");
const RAIL_SHIFT = 56; // with the time rail out, the stack steps left to make room
const STEP = 34;

// The world as it shows in the window, for the outgoing day to fade with: the projects and
// screens on screen, not the whole canvas (copying all of it cost WebKit a frame or more).
function onScreen(w: HTMLElement) {
  const off = (el: Element) => { const r = el.getBoundingClientRect(); return r.right < 0 || r.left > innerWidth || r.bottom < 0 || r.top > innerHeight; };
  const copy = w.cloneNode(false) as HTMLElement;
  copy.removeAttribute("data-split"); // the copy paints once and fades: one layer is cheaper
  for (const child of w.children) {
    if (off(child)) continue;
    const tiles = [...child.querySelectorAll("[data-key]")].map(off);
    const c = child.cloneNode(true) as HTMLElement;
    c.querySelectorAll("[data-key]").forEach((t, i) => { if (tiles[i]) t.remove(); });
    copy.appendChild(c);
  }
  return copy;
}

export default function App() {
  const [index, setIndex] = useState<Index | null>(null);
  const [openPage_, setOpen] = useState<Opening | null>(null);
  const [shots, setShots] = useState<ShotOpening | null>(null);
  const [shotKey, setShotKey] = useState<string | null>(null);
  const [fileOpen, setFileOpen] = useState<FileOpening | null>(null);
  const open = openPage_ || shots || fileOpen;
  // the canvas behind a screen or page blurs and dims with its flight in, and clears with its flight back
  const [leaving, setLeaving] = useState(false);
  const veiled = !!open && !leaving;
  const [focus, setFocus] = useState<string | null>(null);
  const [asOf, setAsOf] = useState<number | null>(null);
  const [scrub, setScrub] = useState(false);
  const [tool, setTool] = useState<Tool>("move");
  const [timeOpen, setTimeOpen] = useState<DOMRect | null>(null);
  const [searching, setSearching] = useState(false);
  const [lit, setLit] = useState<string | null>(null);
  // one session, picked in search: the canvas and the timeline show only what it made, all of it
  const [chat, setChat] = useState<string | null>(null);
  // after the canvas re-forms for a session (or for everything again): where the camera lands
  const refit = useRef<{ to: "session" | "all"; find?: string } | null>(null);
  const finding = useRef<{ id: string; at: number; back: boolean; still?: boolean } | null>(null);
  const [findTick, setFindTick] = useState(0);
  const zoomEl = useRef<HTMLButtonElement | null>(null);
  const [timeShown, setTimeShown] = useState(false);
  const tm = asOf != null || scrub || timeShown;
  const tmNow = useRef(tm);
  tmNow.current = tm;
  // window point to a point on the sheet, so zoom and pan stay under the hand at any size
  const local = (x: number, y: number) => {
    const { s, top, dx } = sheet.current;
    return { x: (x - dx - innerWidth / 2) / s + innerWidth / 2, y: (y - top) / s };
  };
  const incoming = useRef<HTMLDivElement>(null);
  const anchor = useRef<{ key: string; x: number; y: number } | null>(null);
  const outgoing = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(readSeen);
  const [far, setFar] = useState(true);
  const [near, setNear] = useState(false);
  const [view, setView] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const worldEl = useRef<HTMLDivElement>(null);
  const camRef = useRef<Cam>({ x: 0, y: 0, z: 0.3 });
  const sheet = useRef({ s: 1, top: 0, dx: 0 });
  sheet.current = tm ? { ...SHEET, dx: timeShown ? -RAIL_SHIFT : 0 } : { s: 1, top: 0, dx: 0 };
  const settleT = useRef(0);
  const camera = useCamera((c, settled) => {
    camRef.current = c;
    const el = worldEl.current;
    if (el) {
      el.style.transform = `translate3d(${c.x}px, ${c.y}px, 0) scale(${c.z})`;
      setZoomVar(c.z);
    }
    // only when it changes: rewriting the same text redrew the dock's glass on every frame of a pan
    const pct = `${Math.round(c.z * 100)}%`;
    if (zoomEl.current && zoomEl.current.textContent !== pct) zoomEl.current.textContent = pct;
    // When the camera comes to rest: note what's in view (far screens let their images go).
    // The world keeps its will-change through every zoom. Dropping it for a frame to redraw text
    // sharp made Chrome rebuild all ~290 of the canvas's layers, and for a frame or three the
    // screens, names and dock went blank. Chrome redraws at the new scale on its own, and
    // WebKit's drawing scale never moved with it.
    clearTimeout(settleT.current);
    if (settled) settleT.current = window.setTimeout(() => {
      updateView(c);
      setNear(c.z > 0.5); // close in, screens load sharper: decided at rest, not mid-gesture
      split();
    }, 180);
    setFar(c.z < 0.42); // a no-op unless the line is crossed
    // mid-move too, a few times a second once it has gone a good way: a long pan back finds its
    // screens already loading instead of grey until the hand stops
    const lv = lastView.current;
    if (!settled && performance.now() - lv.t > 180 && (Math.abs(c.x - lv.x) > innerWidth * 0.4 || Math.abs(c.y - lv.y) > innerHeight * 0.4 || Math.abs(Math.log(c.z / lv.z)) > 0.3)) updateView(c);
  });
  // Safari far out: a layer per group, decided at rest. Not in the time machine, where each step
  // through the days would draw every group's layer anew.
  const splitFits = useRef(false);
  function split() {
    if (SPLITS) worldEl.current?.toggleAttribute("data-split", splitFits.current && !tmNow.current && camRef.current.z <= SPLIT_Z);
  }
  // what's near the view, so far screens can let their images go
  const lastView = useRef({ t: 0, x: 0, y: 0, z: 1 });
  function updateView(c: Cam) {
    lastView.current = { t: performance.now(), x: c.x, y: c.y, z: c.z };
    const s = sheet.current;
    const x0 = (innerWidth / 2 - innerWidth / 2 / s.s - c.x) / c.z, y0 = (-s.top / s.s - c.y) / c.z;
    const w = innerWidth / s.s / c.z, h = innerHeight / s.s / c.z;
    setView({ x: x0 - w, y: y0 - h, w: w * 3, h: h * 3 });
  }
  const shown = useMemo(() => (!index || !chat ? index : {
    ...index,
    threads: index.threads.filter((t) => t.id === chat),
    sets: index.sets.filter((s) => s.thread === chat),
    pages: index.pages.filter((p) => p.thread === chat),
    changed: index.changed?.filter((c) => c.thread === chat),
  }), [index, chat]);
  const world = useMemo(() => (shown && index ? layout(shown, asOf, !!chat, index) : null), [shown, index, asOf, chat]);
  useLayoutEffect(() => {
    if (!SPLITS || !world) return;
    let area = 0;
    for (const c of world.clusters) for (const g of c.groups) area += g.w * g.h;
    splitFits.current = area * devicePixelRatio ** 2 * 4 <= SPLIT_BYTES;
    split();
  }, [world, tm]);
  // names that just appeared take the zoom at once, not at the next move
  useLayoutEffect(() => setZoomVar(camRef.current.z));
  const root = useRef<HTMLDivElement>(null);
  const placed = useRef(false);

  // While a screen, a page or search is open, what's behind it is out of reach: no tabbing into
  // the canvas behind the veil, and VoiceOver reads only what's open.
  useLayoutEffect(() => {
    const on = !!open || searching;
    worldEl.current?.toggleAttribute("inert", on);
    for (const el of document.querySelectorAll("[data-chrome]")) if (!el.querySelector('[role="combobox"]')) el.toggleAttribute("inert", on);
  }, [open, searching]);

  const [unreachable, setUnreachable] = useState(false);
  useEffect(() => {
    loadIndex().catch(() => { setUnreachable(true); return null; }).then((i) => {
      if (!i) return;
      setIndex(i);
      // a link to one post (#id, as the MCP server gives it) opens the canvas on it
      const id = decodeURIComponent(location.hash.slice(1));
      if (id) { finding.current = { id, at: Date.now(), back: false }; setFindTick((n) => n + 1); }
    });
    const t = setInterval(() => loadIndex().then((i) => { setIndex(i); setUnreachable(false); }, () => {}), 60e3);
    // what sessions post shows within seconds, lit where it lands; notes and replies too
    let last: { posted: number; comments: number } | null = null;
    const s = setInterval(async () => {
      const now = await fetch(authUrl("/api/work/stamp")).then((r) => r.json()).catch(() => null);
      if (!now) return;
      if (last && (now.posted > last.posted || now.comments > last.comments)) {
        const i = await loadIndex();
        const newest = [...i.sets].sort((a, b) => b.at - a.at)[0];
        setIndex(i);
        if (now.posted > last.posted && newest) { finding.current = { id: newest.id, at: newest.at, back: false, still: true }; setFindTick((n) => n + 1); }
      }
      last = now;
    }, 3000);
    return () => { clearInterval(t); clearInterval(s); };
  }, []);

  // Everything, or when everything can't fit, the whole width from the top: the newest
  // projects' names are always in view.
  const overview = () => {
    if (!world!.clusters.length) return { z: 1, x: 0, y: 0 }; // nothing yet: rest at actual size
    const f = fit({ x: 0, y: 0, w: world!.w, h: world!.h }, innerWidth, innerHeight - 96, 96);
    if (world!.h * f.z > innerHeight - 220) f.y = 96;
    return f;
  };
  const fitAll = useCallback((glide: boolean) => {
    if (!world) return;
    const next = overview();
    glide ? camera.glide(next) : camera.jump(next);
  }, [world]);

  // First view: the whole studio, settling in from a touch closer.
  useEffect(() => {
    if (!world || placed.current) return;
    if (!world.clusters.length) { camera.jump(overview()); return; } // the first work to land gets the settle
    placed.current = true;
    const end = overview();
    const s = 1.06;
    camera.jump({ z: end.z * s, x: innerWidth / 2 - (innerWidth / 2 - end.x) * s, y: innerHeight / 2 - (innerHeight / 2 - end.y) * s });
    requestAnimationFrame(() => camera.glide(end));
  }, [world]);

  // Until he moves the camera, the whole studio stays fitted to the window.
  const touched = useRef(false);
  useEffect(() => {
    const r = () => { if (!touched.current && !open) fitAll(false); };
    addEventListener("resize", r);
    return () => removeEventListener("resize", r);
  }, [fitAll, open]);

  // A trackpad's two-finger scroll pans and a pinch zooms about the fingers (⌘ or ctrl scroll
  // zooms with a mouse wheel). In the time machine, scrolling up and down steps through the
  // days instead, a sheet at a time. Safari reports a pinch as gesture events rather than ctrl
  // scroll: those zoom the canvas too, and never the page itself. Hold space and drag to pan
  // from anywhere, or drag the paper itself.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let pinch: { z: number } | null = null;
    const zoomAt = (to: number, cx: number, cy: number) => {
      const c = camera.now;
      const z = Math.min(2.4, Math.max(0.08, to));
      const k = z / c.z, p = local(cx, cy);
      camera.jump({ z, x: p.x - (p.x - c.x) * k, y: p.y - (p.y - c.y) * k });
    };
    // Scrolling pans the canvas, in the time machine too; over the time rail it travels the
    // days instead (the rail's own handler).
    const onWheel = (e: WheelEvent) => {
      if (open || (e.target as HTMLElement).closest?.("[data-chrome]")) return;
      e.preventDefault();
      if (pinch) return; // Safari's pinch is already arriving as a gesture
      touched.current = true;
      setFocus(null); // a project's hover dim lets go once the canvas moves under the pointer
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? innerHeight : 1;
      const dx = e.deltaX * unit, dy = e.deltaY * unit;
      if (e.ctrlKey || e.metaKey) return zoomAt(camera.now.z * Math.exp(-dy * (e.ctrlKey ? 0.012 : 0.0028)), e.clientX, e.clientY);
      const c = camera.now, s = sheet.current.s;
      camera.jump({ ...c, x: c.x - dx / s, y: c.y - dy / s });
    };
    const onGesture = (e: Event) => {
      e.preventDefault();
      if (open) return;
      const g = e as Event & { scale: number; clientX: number; clientY: number };
      if (e.type === "gesturestart") { pinch = { z: camera.now.z }; touched.current = true; }
      else if (e.type === "gestureend") pinch = null;
      else if (pinch) zoomAt(pinch.z * g.scale, g.clientX, g.clientY);
    };
    const GESTURES = ["gesturestart", "gesturechange", "gestureend"];
    el.addEventListener("wheel", onWheel, { passive: false });
    for (const t of GESTURES) el.addEventListener(t, onGesture);
    return () => { el.removeEventListener("wheel", onWheel); for (const t of GESTURES) el.removeEventListener(t, onGesture); };
  }, [open]);
  // Safari zooms the whole page on a pinch anywhere else (the dock, the rail): never
  useEffect(() => {
    const no = (e: Event) => e.preventDefault();
    document.addEventListener("gesturestart", no);
    // nor Chrome on a pinch (or ⌘ scroll) over the viewer, the dock or search
    const noZoom = (e: WheelEvent) => { if (e.ctrlKey || e.metaKey) e.preventDefault(); };
    document.addEventListener("wheel", noZoom, { passive: false });
    return () => { document.removeEventListener("gesturestart", no); document.removeEventListener("wheel", noZoom); };
  }, []);

  const [space, setSpace] = useState(false);
  const [grabbing, setGrabbing] = useState(false);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      // a focused button or slider takes Space as a press, as everywhere on the Mac
      if (e.key !== " " || open || typing(e) || (e.target as HTMLElement)?.closest?.("button, a, [role=slider]")) return;
      e.preventDefault();
      setSpace(true);
    };
    // a space let go while a file picker (or another window) had the keyboard never comes back
    // up here, so coming back to the page lets go of it too
    const up = (e: KeyboardEvent) => { if (e.key === " ") { setSpace(false); if (!typing(e)) e.preventDefault(); } };
    const blur = () => setSpace(false);
    const seen = () => { if (document.visibilityState === "visible") setSpace(false); };
    addEventListener("keydown", down);
    addEventListener("keyup", up);
    addEventListener("blur", blur);
    addEventListener("focus", blur);
    document.addEventListener("visibilitychange", seen);
    return () => { removeEventListener("keydown", down); removeEventListener("keyup", up); removeEventListener("blur", blur); removeEventListener("focus", blur); document.removeEventListener("visibilitychange", seen); };
  }, [open]);

  const drag = useRef<{ x: number; y: number; cx: number; cy: number; vx: number; vy: number; t: number; moved: boolean; space: boolean; caught: boolean } | null>(null);
  const begin = (e: React.PointerEvent, withSpace: boolean) => {
    // a press while the canvas still glides catches it where it is, and is no click
    const n = camera.now, t = camera.target;
    const caught = Math.abs(t.x - n.x) > 2 || Math.abs(t.y - n.y) > 2 || Math.abs(t.z / n.z - 1) > 0.01;
    if (caught) camera.jump(n);
    const c = camera.now;
    drag.current = { x: e.clientX, y: e.clientY, cx: c.x, cy: c.y, vx: 0, vy: 0, t: performance.now(), moved: false, space: withSpace, caught };
  };
  // With space held, the press belongs to the canvas, whatever is under it.
  const onPointerDownCapture = (e: React.PointerEvent) => {
    if (open || e.button !== 0 || !(space || tool === "hand")) return;
    // the dock, the time rail and search float over the canvas: their buttons stay buttons
    if ((e.target as HTMLElement).closest("[data-chrome]")) return;
    e.stopPropagation();
    e.preventDefault();
    begin(e, true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setGrabbing(true);
  };
  const onPointerDown = (e: React.PointerEvent) => {
    if (open || e.button !== 0 || drag.current) return;
    begin(e, false);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.moved && !d.space && Math.hypot(dx, dy) < 4) return;
    if (!d.moved) {
      d.moved = true; touched.current = true; setGrabbing(true); setFocus(null);
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
    const now = performance.now(), dt = Math.max(1, now - d.t);
    const c = camera.now;
    const nx = d.cx + dx / sheet.current.s, ny = d.cy + dy / sheet.current.s;
    d.vx = (nx - c.x) / dt; d.vy = (ny - c.y) / dt; d.t = now;
    camera.jump({ ...c, x: nx, y: ny });
  };
  const onPointerUp = () => {
    const d = drag.current;
    setGrabbing(false);
    // let the click that follows a drag see it, then forget it
    setTimeout(() => { if (drag.current === d) drag.current = null; }, 0);
    if (!d?.moved) return;
    const c = camera.now;
    // momentum, projected the way a scroll view decelerates; a hand held still before letting go
    // throws nothing
    if (performance.now() - d.t > 100) return;
    const proj = (v: number) => (v * 0.998) / (1 - 0.998);
    camera.glide({ ...c, x: c.x + proj(d.vx), y: c.y + proj(d.vy) });
  };
  const suppressClick = () => !!drag.current?.moved || !!drag.current?.space || !!drag.current?.caught || space || tool === "hand";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (open || searching || typing(e)) return;
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || e.key === "/") { e.preventDefault(); setSearching(true); return; }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // the arrows walk the days that had work: an earlier day shows only its own, so a day
      // with none would be a blank sheet
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        step.current(e.key === "ArrowLeft" ? -1 : 1);
        return;
      }
      if (e.key === "t" || e.key === "T") { toggleTime(); return; }
      if (e.key === "Escape" && timeShown) { closeTime(); return; }
      if (e.key === "Escape" && tool !== "move") { setTool("move"); return; }
      if (e.key === "Escape" && asOf != null) { changeDay(null); return; }
      if (e.key === "Escape" && chat) { showSession(null); return; }
      if (e.key === "0" || e.key === "Escape") fitAll(true);
      if (e.key === "=" || e.key === "+") zoomBy(1.4);
      if (e.key === "-") zoomBy(1 / 1.4);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [open, fitAll, asOf, searching, tool, timeShown, chat]);
  // The time machine is one switch: open, the canvas can be on any day; closed, it's today.
  const toggleTime = (from?: DOMRect) => {
    if (from) setTimeOpen(from);
    if (timeShown) closeTime(); else setTimeShown(true);
  };
  const closeTime = () => {
    setTimeShown(false);
    if (asOf != null) changeDay(null);
  };

  const zoomBy = (f: number) => {
    const c = camera.target;
    const z = Math.min(2.4, Math.max(0.08, c.z * f)), k = z / c.z;
    const p = local(innerWidth / 2, innerHeight / 2);
    camera.glide({ z, x: p.x - (p.x - c.x) * k, y: p.y - (p.y - c.y) * k });
  };

  // Frame a group: its screens fill the width, its title near the top of what you see.
  const groupView = (g: Group) => {
    const s = sheet.current;
    // in the time machine the sheet is the window: its own width, from its top edge down
    const lw = innerWidth, lh = (innerHeight - s.top) / s.s;
    const z = Math.min(1.1, (lw - 192) / Math.max(g.w, 640), (lh - 280) / g.h);
    return { z, x: lw / 2 - (g.x + g.w / 2) * z, y: (s.top ? 110 : 140) - g.y * z };
  };
  const frameGroup = (g: Group) => {
    touched.current = true;
    camera.glide(groupView(g));
  };

  // A search pick: go back to the day it lived in if today's canvas no longer holds it, then
  // fly to its group and light it.
  const find = (h: Hit) => {
    setSearching(false);
    if (h.kind === "chat") return showSession(h.find);
    finding.current = { id: h.find, at: h.at, back: false };
    const recent = h.at > Date.now() - 20 * 864e5;
    const target = recent ? null : endOfDay(new Date(h.at));
    if (target !== asOf) changeDay(target);
    setFindTick((n) => n + 1);
  };
  useEffect(() => {
    const f = finding.current;
    if (!f || !world) return;
    const id = f.id;
    for (const c of world.clusters) for (const g of c.groups) {
      if (g.id === id || g.all.some((it) => (it.kind === "shot" ? it.set === id : it.key === id))) {
        finding.current = null;
        if (!f.still) frameGroup(g); // a post arriving on its own is lit where it lands, not flown to
        setLit(g.id);
        return;
      }
    }
    // Today's canvas keeps each project's newest groups; an older one waits on its own day.
    if (!f.back && !f.still) { f.back = true; changeDay(endOfDay(new Date(f.at))); }
    else finding.current = null;
  }, [world, findTick]);
  useEffect(() => { if (!lit) return; const t = setTimeout(() => setLit(null), 2400); return () => clearTimeout(t); }, [lit]);

  // A project fills the width, its name near the top; the rest is a scroll away.
  const framed = (c: Cluster) => {
    const z = Math.min(1.1, (innerWidth - 2 * 96) / Math.max(c.w, 3 * 300 + 72));
    return { z, x: innerWidth / 2 - (c.x + c.w / 2) * z, y: 72 - c.y * z };
  };
  const focusCluster = (c: Cluster) => {
    touched.current = true;
    setFocus(null);
    camera.glide(framed(c));
  };

  const openPage = (page: Page, el: HTMLElement, hash?: string) => {
    const r = el.getBoundingClientRect();
    setFocus(null);
    setOpen({ page, from: { x: r.left, y: r.top, w: r.width, h: r.height }, hash, place: tool === "comment" });
    setSeen(markSeen(page.id));
  };
  const openItem = (g: Group, i: number, el: HTMLElement) => {
    const it = g.items[i];
    if (it.kind === "page") return openPage(it.page, el, it.hash);
    const r = el.getBoundingClientRect();
    setFocus(null);
    setShotKey(it.key);
    setShots({ group: g, i, from: { x: r.left, y: r.top, w: r.width, h: r.height }, place: tool === "comment" });
  };

  // Changing the day: the canvas you were on lifts toward you and fades (or, going forward in
  // time, falls back), and the day you picked comes up out of the haze in its place.
  const reform = (back: boolean) => {
    const w = worldEl.current, out = outgoing.current, inc = incoming.current;
    if (!w || !out || !inc || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    out.getAnimations().forEach((a) => a.cancel());
    out.replaceChildren(onScreen(w));
    const ease = "cubic-bezier(0.3, 0.7, 0.1, 1)";
    const o = out.animate([{ transform: "none", opacity: 1 }, { transform: `scale(${back ? 1.08 : 0.92})`, opacity: 0 }], { duration: 440, easing: ease, fill: "forwards" });
    o.onfinish = () => { out.replaceChildren(); o.cancel(); };
    inc.getAnimations().forEach((a) => a.cancel());
    inc.animate([{ transform: `scale(${back ? 0.93 : 1.07})`, opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 520, easing: ease });
  };
  // One session (or everything again): the canvas re-forms the same way, going in as going back
  // a day, and lands on the session's newest work at the top, its older work a scroll down.
  // From a group's title in the timeline, the day holds and the camera lands on that group.
  const showSession = (id: string | null, find?: string) => {
    if (id === chat) { if (id) { refit.current = { to: "session", find }; setFindTick((n) => n + 1); } return; }
    reform(!!id);
    refit.current = id ? { to: "session", find } : { to: "all" };
    touched.current = true;
    setChat(id);
    if (!find) setAsOf(null);
  };
  // In the timeline a group's title shows its session; elsewhere it opens the thread in Claude,
  // when the thread is still on this Mac.
  const titleClick = (g: Group) => {
    if (!g.thread || (!timeShown && !g.gone)) return false;
    // a topic gathers sends from many sessions: find this group again by one of its session's own
    const mine = g.all.find((it) => (it.kind === "shot" && it.thread === g.thread) || (it.kind === "page" && it.page.thread === g.thread));
    showSession(g.thread, mine ? (mine.kind === "shot" ? mine.set : mine.key) : g.id);
    return true;
  };
  const lastChange = useRef(0);
  const changeDay = (t: number | null) => {
    if (t != null) setTimeShown(true); // an earlier day is only ever seen in the time machine
    const today = endOfDay(new Date());
    const cur = asOf ?? today, next = t ?? today;
    // Stepping quickly (a flick through the days), each day just takes over: a fade per step is
    // noise at that pace, and copying the outgoing day costs WebKit a frame each time.
    const quick = performance.now() - lastChange.current < 380;
    lastChange.current = performance.now();
    if (cur !== next && !quick) reform(next < cur);
    // keep the project you're looking at under you as the canvas re-forms around it
    if (world && cur !== next) {
      const c = camRef.current;
      const p = local(innerWidth / 2, innerHeight / 2);
      const wx = (p.x - c.x) / c.z, wy = (p.y - c.y) / c.z;
      const gap = (k: Cluster) => Math.hypot(Math.max(k.x - wx, 0, wx - k.x - k.w), Math.max(k.y - wy, 0, wy - k.y - k.h));
      const near = [...world.clusters].sort((a, b) => gap(a) - gap(b))[0];
      if (near) anchor.current = { key: near.key, x: near.x, y: near.y };
    }
    setAsOf(t);
  };
  // When the canvas re-forms for any other reason (new work arriving re-sorts the projects),
  // the project nearest the middle of the view stays where it is on screen.
  const prevWorld = useRef<typeof world>(null);
  useLayoutEffect(() => {
    const before = prevWorld.current;
    prevWorld.current = world;
    if (!before || !world || before === world || anchor.current || refit.current || !placed.current) return;
    const c = camRef.current;
    const p = local(innerWidth / 2, innerHeight / 2);
    const wx = (p.x - c.x) / c.z, wy = (p.y - c.y) / c.z;
    const gap = (k: Cluster) => Math.hypot(Math.max(k.x - wx, 0, wx - k.x - k.w), Math.max(k.y - wy, 0, wy - k.y - k.h));
    const was = [...before.clusters].sort((a, b) => gap(a) - gap(b))[0];
    const now = was && world.clusters.find((k) => k.key === was.key);
    if (!now || (now.x === was.x && now.y === was.y)) return;
    camera.jump({ ...c, x: c.x - (now.x - was.x) * c.z, y: c.y - (now.y - was.y) * c.z });
  }, [world]);
  useLayoutEffect(() => {
    const a = anchor.current;
    anchor.current = null;
    const n = a && world?.clusters.find((c) => c.key === a.key);
    // Before he's moved the camera, or on a day that project had nothing, the day is fitted to
    // the window (an earlier day is one day's work, smaller than the three weeks of today), never
    // closer than actual size.
    if (a && world && (!touched.current || !n)) {
      const f = overview(), z = Math.min(f.z, 1);
      camera.jump(z === f.z ? f : { z, x: innerWidth / 2 - (world.w / 2) * z, y: (innerHeight - 96) / 2 - (world.h / 2) * z });
      updateView(camera.now);
      return;
    }
    if (!a || !n) return;
    let c = camera.now;
    if (n.x !== a.x || n.y !== a.y) {
      c = { ...c, x: c.x - (n.x - a.x) * c.z, y: c.y - (n.y - a.y) * c.z };
      camera.jump(c);
    }
    // that day the project may be shorter: if nothing of it is left in view, frame it
    const s = sheet.current;
    const vx0 = (innerWidth / 2 - innerWidth / 2 / s.s - c.x) / c.z, vy0 = (0 - c.y) / c.z;
    const vx1 = vx0 + innerWidth / s.s / c.z, vy1 = vy0 + (innerHeight - s.top) / s.s / c.z;
    const seen = n.groups.some((g) => g.x < vx1 && g.x + g.w > vx0 && g.y < vy1 && g.y + g.h > vy0) || (n.y < vy1 && n.y + 120 > vy0);
    if (!seen) focusCluster(n);
    updateView(camera.now); // the new day's screens near the view load now, not after a gesture
  }, [world]);
  useLayoutEffect(() => {
    const r = refit.current;
    refit.current = null;
    if (!r || !world) return;
    const f = r.find;
    const g = f && world.clusters.flatMap((c) => c.groups).find((g) => g.id === f || g.all.some((it) => (it.kind === "shot" ? it.set === f : it.key === f)));
    if (g) { camera.jump(groupView(g)); setLit(g.id); }
    else camera.jump(r.to === "session" && world.clusters[0] ? framed(world.clusters[0]) : overview());
    updateView(camera.now);
  }, [world, findTick]);

  // Days that had work, newest first: the stack behind the sheet.
  const activeDays = useMemo(() => {
    if (!shown) return [] as string[];
    const set = new Set<string>();
    for (const t of shown.threads) for (const d of Object.keys(t.days || {})) set.add(d);
    for (const p of shown.pages) for (const v of p.versions) set.add(dayKey(new Date(v.at)));
    for (const st of shown.sets || []) set.add(dayKey(new Date(st.at)));
    return [...set].sort().reverse();
  }, [shown]);
  // one sheet newer (+1) or older (-1): through the days that had work, then today
  const step = useRef<(dir: number) => void>(() => {});
  step.current = (dir) => {
    const k = dayKey(new Date(asOf ?? Date.now())), today = dayKey(new Date());
    const at = (d: string) => endOfDay(new Date(`${d}T12:00`));
    if (dir < 0) { const d = activeDays.find((x) => x < k); if (d) changeDay(at(d)); return; }
    if (asOf == null) return;
    const d = [...activeDays].reverse().find((x) => x > k && x < today);
    changeDay(d ? at(d) : null);
  };
  const shownDay = new Date(asOf ?? Date.now());
  const behind = activeDays.filter((k) => k < dayKey(shownDay)).slice(0, 4).map((k) => new Date(`${k}T12:00`));
  const projectsOn = (d: Date) => {
    const k = dayKey(d);
    const keys = new Set<string>();
    for (const t of shown?.threads || []) if (t.days?.[k]) keys.add(t.project);
    for (const st of shown?.sets || []) if (dayKey(new Date(st.at)) === k) keys.add(st.project);
    return [...keys].slice(0, 4).map((x) => index!.projects[x] || x);
  };

  // Drop images or HTML files onto the canvas: they join the project nearest where they land.
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current = 0;
    addFiles([...e.dataTransfer.files], e.clientX, e.clientY);
  };
  // the project nearest a point on the window: where a drop lands
  const projectAt = (x: number, y: number) => {
    if (!world) return null;
    const c = camRef.current;
    const p = local(x, y);
    const wx = (p.x - c.x) / c.z, wy = (p.y - c.y) / c.z;
    const gap = (k: Cluster) => Math.hypot(Math.max(k.x - wx, 0, wx - k.x - k.w), Math.max(k.y - wy, 0, wy - k.y - k.h));
    return [...world.clusters].sort((a, b) => gap(a) - gap(b))[0] || null;
  };
  // While files are dragged over the canvas, the project they'd join lights up and its name
  // rides beside the pointer. After the drop the canvas flies to what was added and lights it.
  const [dropping, setDropping] = useState<{ key: string; name: string; x: number; y: number; n: number } | null>(null);
  const dragDepth = useRef(0);
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    const c = projectAt(e.clientX, e.clientY);
    if (c) setDropping({ key: c.key, name: c.name, x: e.clientX, y: e.clientY, n: e.dataTransfer.items?.length || 1 });
  };
  const addFiles = async (all: File[], x: number, y: number) => {
    setDropping(null);
    const files = all.filter((f) => /\.(png|jpe?g|webp|html?)$/i.test(f.name));
    if (!files.length || !world) return;
    const project = projectAt(x, y)?.key || "studio";
    const drop = String(Date.now());
    let last: { key?: string; at?: number } = {};
    for (const f of files) {
      const data = await new Promise<string>((r) => { const fr = new FileReader(); fr.onload = () => r(String(fr.result)); fr.readAsDataURL(f); });
      last = await (await fetch("/api/work/unsupported-drop", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: f.name, data, project, drop }) })).json();
    }
    if (asOf != null) changeDay(null);
    setIndex(await loadIndex());
    if (last.key) { finding.current = { id: last.key, at: last.at || Date.now(), back: true }; setFindTick((n) => n + 1); }
  };

  // Clusters only draw again when something about them changed: steady handlers, and for each
  // cluster the list of its groups near the view as one string.
  const openKey = openPage_ ? `page-${openPage_.page.id}` : shots ? shotKey ?? undefined : undefined;
  // Screens within a screen of the view load; ones already loaded let go only two screens out,
  // so panning back and forth never finds them grey.
  const wasLive = useRef(new Set<string>());
  const live = useMemo(() => {
    const m = new Map<string, string>();
    if (!world) return m;
    type A = { x: number; y: number; w: number; h: number };
    const hit = (g: A, a: A) => g.x < a.x + a.w && g.x + g.w > a.x && g.y < a.y + a.h && g.y + g.h > a.y;
    const keep = view && { x: view.x - view.w / 3, y: view.y - view.h / 3, w: (view.w * 5) / 3, h: (view.h * 5) / 3 };
    const now = new Set<string>();
    for (const c of world.clusters) {
      const ids = c.groups.filter((g) => !view || hit(g, view) || (wasLive.current.has(g.id) && hit(g, keep!))).map((g) => g.id);
      for (const id of ids) now.add(id);
      m.set(c.key, ids.join(" "));
    }
    wasLive.current = now;
    return m;
  }, [world, view]);
  // a file on a session's sheet opens what it changed there; the sheet grows into the page
  const openFile = (sheet: FilesSheet, i: number, el: HTMLElement) => {
    const r = (el.closest("[data-sheet]") || el).getBoundingClientRect();
    setFocus(null);
    setFileOpen({ sheet, i, from: { x: r.left, y: r.top, w: r.width, h: r.height } });
  };
  const latest = useRef({ focusCluster, openItem, suppressClick, titleClick, openFile, showSession });
  latest.current = { focusCluster, openItem, suppressClick, titleClick, openFile, showSession };
  const onHover = useCallback((key: string, on: boolean) => setFocus(on ? key : null), []);
  const onFocus = useCallback((c: Cluster) => { if (!latest.current.suppressClick()) latest.current.focusCluster(c); }, []);
  const onOpen = useCallback((g: Group, i: number, el: HTMLElement) => { if (!latest.current.suppressClick()) latest.current.openItem(g, i, el); }, []);
  const onTitle = useCallback((g: Group) => latest.current.titleClick(g), []);
  const onFile = useCallback((sheet: FilesSheet, i: number, el: HTMLElement) => { if (!latest.current.suppressClick()) latest.current.openFile(sheet, i, el); }, []);
  const onSession = useCallback((id: string) => { if (!latest.current.suppressClick()) latest.current.showSession(id); }, []);

  const noted = useMemo(() => new Set((index?.comments ?? []).map((c) => c.page)), [index]);
  const gone = useMemo(() => new Set((index?.threads ?? []).filter((t) => t.gone).map((t) => t.id)), [index]);
  // Tab walks the canvas: the camera brings what has focus into view. The window itself never
  // scrolls; a focused card off screen would otherwise shift the whole canvas and leave it there.
  const onFocusIn = (e: React.FocusEvent) => {
    const r0 = root.current;
    if (r0) { r0.scrollTop = 0; r0.scrollLeft = 0; }
    const el = e.target as HTMLElement;
    if (!el.matches?.(":focus-visible") || !worldEl.current?.contains(el)) return;
    const r = el.getBoundingClientRect(), m = 96;
    const dx = r.left < m ? m - r.left : r.right > innerWidth - m ? innerWidth - m - r.right : 0;
    const dy = r.top < m ? m - r.top : r.bottom > innerHeight - 120 ? innerHeight - 120 - r.bottom : 0;
    if (dx || dy) { const c = camRef.current; camera.glide({ ...c, x: c.x + dx, y: c.y + dy }); }
  };
  const solidGlass = reducedTransparency();
  const fresh = useMemo(() => new Set((index?.pages ?? []).filter((p) => p.at > (seen.pages[p.id] ?? seen.since)).map((p) => p.id)), [index, seen]);

  return (
    <div
      ref={root}
      className="grain fixed inset-0 select-none overflow-hidden"
      style={{ cursor: grabbing ? "grabbing" : space || tool === "hand" ? "grab" : tool === "comment" ? "crosshair" : "default", touchAction: "none" }}
      onPointerDownCapture={onPointerDownCapture}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onFocus={onFocusIn}
      onScroll={(e) => { e.currentTarget.scrollTop = 0; e.currentTarget.scrollLeft = 0; }}
    >
      <Ground cam={camRef} dim={veiled} />

      {/* the days before this one, waiting behind it */}
      {/* drawn deepest first, so each nearer day lies over the one behind it */}
      {behind.map((d, i) => ({ d, i })).reverse().map(({ d, i }) => {
        const k = i + 1;
        const sc = SHEET.s * (1 - 0.045 * k);
        const [name, date] = dayName(d);
        return (
          <div
            key={dayKey(d)}
            className="absolute inset-0 cursor-pointer overflow-hidden rounded-[34px]"
            style={{
              transformOrigin: "50% 0",
              transform: tm ? `translate(${timeShown ? -RAIL_SHIFT : 0}px, ${SHEET.top - k * STEP}px) scale(${sc})` : `translateY(${-k * 8}px) scale(${1 - 0.02 * k})`,
              opacity: tm ? 1 - 0.16 * i : 0,
              pointerEvents: tm && !open ? "auto" : "none",
              background: "linear-gradient(180deg, #fdfcf9, #f7f4ee 240px)",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.9), inset 0 0 0 0.5px rgba(28,25,20,0.07), 0 -12px 26px -20px rgba(40,30,15,0.24)",
              transition: "transform 620ms var(--ease-fly), opacity 420ms var(--ease-out)",
            }}
            onClick={() => changeDay(endOfDay(d))}
          >
            <div className="flex items-center justify-between" style={{ height: STEP / sc, paddingInline: 40 / sc }}>
              <span className="flex shrink-0 items-baseline gap-2 whitespace-nowrap" style={{ fontSize: 14 / sc, fontWeight: 560, letterSpacing: "-0.015em" }}>
                <span className="text-[var(--ink)]">{name}</span>
                <span className="text-[var(--quiet)]">{date}</span>
              </span>
              {/* the projects give way first when the window is narrow: they clip and fade, never collide */}
              <span
                className="type-mono flex min-w-0 justify-end gap-4 overflow-hidden whitespace-nowrap text-[var(--quiet)]"
                style={{ fontSize: 11 / sc, marginLeft: 32 / sc, WebkitMaskImage: "linear-gradient(90deg, transparent, #000 24px)", maskImage: "linear-gradient(90deg, transparent, #000 24px)" }}
              >
                {projectsOn(d).map((n) => <span key={n}>{n}</span>)}
              </span>
            </div>
            <div className="pointer-events-none absolute inset-0" style={{ background: "#f1ede4", opacity: 0.1 + 0.14 * i }} />
          </div>
        );
      })}

      {/* the canvas: full bleed today, the front sheet in the time machine */}
      <div
        className="absolute inset-0"
        style={{
          transformOrigin: "50% 0",
          transform: tm ? `translate(${timeShown ? -RAIL_SHIFT : 0}px, ${SHEET.top}px) scale(${SHEET.s})` : "none",
          borderRadius: tm ? 34 / SHEET.s : 0,
          overflow: tm ? "hidden" : "visible",
          background: tm ? "var(--wall)" : "transparent",
          boxShadow: tm ? "inset 0 1px 0 rgba(255,255,255,0.9), 0 -14px 30px -20px rgba(40,30,15,0.28), 0 40px 90px -40px rgba(40,30,15,0.3)" : "none",
          transition: "transform 620ms var(--ease-fly), border-radius 620ms var(--ease-fly), background 300ms var(--ease-out), box-shadow 420ms var(--ease-out)",
        }}
      >
      <div ref={incoming} className="absolute inset-0">
      <div
        ref={worldEl}
        className="absolute left-0 top-0 origin-top-left will-change-transform"
      >
        {world?.clusters.map((c) => (
          <ClusterView
            key={c.key}
            c={c}
            cap={world.nameCap}
            far={far}
            near={near}
            live={live.get(c.key) ?? ""}
            dimmed={!!focus && focus !== c.key}
            openKey={openKey && c.groups.some((g) => g.items.some((it) => it.key === openKey)) ? openKey : undefined}
            noted={noted}
            fresh={fresh}
            threadsAll={shown!.threads}
            onHover={onHover}
            onFocus={onFocus}
            onOpen={onOpen}
            onTitle={onTitle}
            onFile={onFile}
            onSession={onSession}
          />
        ))}
        {/* the project a drop would join */}
        {dropping && world?.clusters.filter((c) => c.key === dropping.key).map((c) => (
          <div
            key={`drop-${c.key}`}
            className="wb-z pointer-events-none absolute"
            style={{
              left: c.x - 40, top: c.y - 24, width: c.w + 80, height: c.h + 48,
              borderRadius: "calc(28px / var(--z, 1))",
              boxShadow: "0 0 0 calc(1.5px / var(--z, 1)) var(--honey), 0 0 0 calc(10px / var(--z, 1)) var(--honey-wash)",
              background: "color-mix(in srgb, var(--honey) 4%, transparent)",
              transition: "left 200ms var(--ease-out), top 200ms var(--ease-out), width 200ms var(--ease-out), height 200ms var(--ease-out)",
            }}
          />
        ))}
        {/* a found group, lit for a moment */}
        {lit && world?.clusters.flatMap((c) => c.groups).filter((g) => g.id === lit).map((g) => (
          <div
            key={`lit-${g.id}-${findTick}`}
            className="pointer-events-none absolute rounded-[22px]"
            style={{
              left: g.x - 20, top: g.y - 16, width: g.w + 40, height: g.h + 32,
              boxShadow: "0 0 0 1.5px var(--honey), 0 0 0 8px var(--honey-wash)",
              animation: "wb-lit 2400ms var(--ease-out) both",
            }}
          />
        ))}
        <style>{`@keyframes wb-lit { 0% { opacity: 0; transform: scale(1.02) } 12% { opacity: 1; transform: none } 70% { opacity: 1 } 100% { opacity: 0 } }`}</style>
      </div>
      </div>
      <div ref={outgoing} className="pointer-events-none absolute inset-0" />
      {/* the front sheet's own day, at its top edge */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 flex items-baseline gap-2.5 whitespace-nowrap"
        style={{
          height: 76, paddingTop: 28, paddingInline: 48,
          background: "linear-gradient(180deg, var(--wall) 40%, transparent)",
          opacity: tm && !timeShown ? 1 : 0, transition: "opacity 300ms var(--ease-out)",
          fontSize: 20, fontWeight: 600, letterSpacing: "-0.02em",
        }}
      >
        <span className="text-[var(--ink)]">{dayName(shownDay)[0]}</span>
        <span className="text-[var(--quiet)]">{dayName(shownDay)[1]}</span>
      </div>
      </div>

      {/* Behind an open screen: the canvas blurred and veiled, fading in on the card's own timing
          as it flies up and out as it flies back. One fixed layer that blurs what's behind it:
          a filter on the whole world cost WebKit a 45-70 ms frame as each screen opened. The
          blur is what the world's own 10px came to at this zoom. */}
      <div
        className="pointer-events-none fixed inset-0"
        style={{
          background: `color-mix(in srgb, var(--wall) ${solidGlass ? 90 : 42}%, transparent)`,
          backdropFilter: open && !solidGlass ? `blur(${10 * camRef.current.z * sheet.current.s}px) saturate(0.85)` : "none",
          WebkitBackdropFilter: open && !solidGlass ? `blur(${10 * camRef.current.z * sheet.current.s}px) saturate(0.85)` : "none",
          opacity: veiled ? 1 : 0,
          transition: veiled ? "opacity 560ms cubic-bezier(0.3, 0.7, 0.1, 1)" : "opacity 420ms cubic-bezier(0.4, 0, 0.2, 1)",
        }}
      />

      {index && !index.sets.length && !index.pages.length && <Empty onImported={() => loadIndex().then(setIndex)} />}
      {!index && unreachable && (
        <div className="fixed inset-0 grid place-items-center pb-24" role="alert">
          <div className="flex flex-col items-center px-6 text-center">
            <div className="text-[22px] font-semibold tracking-[-0.02em] text-[var(--ink)]">Can't reach Flyd work</div>
            <p className="mt-2 text-[15px] text-[var(--muted)]">Check that Flyd's conversation service is running, then try again.</p>
            <button onClick={() => location.reload()} className="press mt-6 h-11 rounded-full bg-[var(--ink)] px-5 text-[14px] font-[560] text-white">Try again</button>
          </div>
        </div>
      )}
      {index && (
        <Dock
          hidden={!!open}
          timeOn={timeShown}
          away={asOf == null ? null : new Date(asOf).toLocaleDateString([], { month: "short", day: "numeric" })}
          onTime={toggleTime}
          onSearch={() => setSearching(true)}
          session={chat ? clean(index.threads.find((t) => t.id === chat)?.title || "") || "Session" : null}
          onAll={() => showSession(null)}
        />
      )}
      {index && (
        <TimeRail
          index={shown!}
          asOf={asOf}
          open={timeShown && !open}
          onDay={changeDay}
          onClose={closeTime}
        />
      )}
      {dropping && (
        <div
          className="glass thick pointer-events-none fixed flex h-9 items-center gap-2 whitespace-nowrap rounded-full pl-2.5 pr-3.5 text-[13px] font-[560] text-[var(--ink)]"
          style={{ left: dropping.x + 18, top: dropping.y + 18, zIndex: 60 }}
        >
          <span className="grid h-6 min-w-6 place-items-center rounded-full px-1.5 text-[12px] text-white" style={{ background: "var(--honey)" }}>{dropping.n}</span>
          {dropping.name}
        </div>
      )}
      {searching && index && <Search index={index} onPick={find} onClose={() => setSearching(false)} />}

      {shots && index && (
        <ShotStage
          key={shots.group.id}
          opening={shots}
          comments={index.comments}
          gone={gone}
          onComment={(c) => setIndex((i) => (i ? { ...i, comments: [...i.comments, c] } : i))}
          onStep={setShotKey}
          onClosing={() => setLeaving(true)}
          onClose={() => { setShots(null); setShotKey(null); setLeaving(false); }}
        />
      )}

      {fileOpen && (
        <FileStage
          key={fileOpen.sheet.key}
          opening={fileOpen}
          onSession={(id) => showSession(id)}
          onClosing={() => setLeaving(true)}
          onClose={() => { setFileOpen(null); setLeaving(false); }}
        />
      )}

      {openPage_ && index && (
        <Stage
          key={openPage_.page.id}
          opening={openPage_}
          index={index}
          onComment={(c) => setIndex((i) => (i ? { ...i, comments: [...i.comments, c] } : i))}
          onClosing={() => setLeaving(true)}
          onClose={() => { setOpen(null); setLeaving(false); }}
        />
      )}
    </div>
  );
}
