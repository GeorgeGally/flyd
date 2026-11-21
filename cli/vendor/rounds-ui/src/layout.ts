import type { Commit, Index, Page, Shot, ShotSet, Thread, Topic } from "./data";
import { clean } from "./data";
import { dayKey } from "./days";

// The canvas as an atlas. Each project is a column: its name, its days of activity, then
// its work as groups of screens laid straight onto the paper, newest first. A group is what
// a thread showed him in one sitting (sends from the same thread close together merge), with
// the thread's own caption as its title. A published page joins the group its thread was
// making at the time, as its first screen.

export const ROW_H = 260; // every screen in a row stands this tall
const ITEM_GAP = 20;
const MAX_ROW_W = 1760;
const MIN_COL_W = 972;
const HEAD = 184;
const TITLE_H = 44; // a group's title line and the air under it
const GROUP_GAP = 88;
const THREAD_ROW = 40;
export const COL_GAP = 320;
const ROW_GAP = 360;
const WORLD_ROW_W = 10400; // columns wrap onto a new row past this: about the shape of a wide window
const WINDOW = 21 * 864e5; // what counts as recent, on today's canvas
const MERGE = 45 * 60e3; // sends from one thread this close are one sitting
const JOIN = 3 * 3600e3; // a page joins a sitting this close to its publish
const GROUPS_PER_PROJECT = 10;
const MAX_ROWS = 2; // past this a group folds; the rest is a step away on the stage

/** A file a session changed: the lines it added and removed, and the other sessions that changed
 *  the same file around the same time, newest first. */
export type FileRow = { repo: string; file: string; add: number; del: number; last: number; also: { id: string; title: string }[] };

export type Item =
  | { kind: "shot"; key: string; shot: Shot; before?: Shot; set: string; thread: string | null; w: number; h: number }
  | { kind: "note"; key: string; title: string; commits: Commit[]; files: string[]; at: number; w: number; h: number }
  | { kind: "files"; key: string; thread: string; title: string; rows: FileRow[]; w: number; h: number }
  | { kind: "page"; key: string; page: Page; hash: string; layers: number; w: number; h: number };
export type PlacedItem = Item & { x: number; y: number; dw: number; dh: number; more?: number };
export type Group = {
  id: string;
  title: string;
  thread: string | null;
  gone?: boolean; // its session is no longer on this Mac
  at: number;
  x: number; y: number; w: number; h: number;
  items: PlacedItem[]; // only what lies on the canvas
  all: Item[]; // everything in the group, for the stage
};
export type Cluster = {
  key: string;
  name: string;
  x: number; y: number; w: number; h: number;
  at: number;
  groups: Group[];
  threads: { item: Thread; x: number; y: number }[];
  pages: Page[]; // for the activity field
};

// A caption's first clause makes the title; a thread's name stands in when there is none.
function titleFrom(caption: string, fallback: string) {
  const first = clean(caption).split(/(?<=[a-z0-9)])[.:;!?](?:\s|$)/i)[0].trim();
  const t = first || clean(fallback);
  return t.length > 72 ? `${t.slice(0, 70).replace(/\s+\S*$/, "")}…` : t;
}

const widthOf = (it: Item) => Math.round(Math.min(ROW_H * (it.w / it.h), MAX_ROW_W));
// A group's screens in rows, folding past the last; then its files sheets. `reserve` is the room
// the last row keeps for the sheets.
function lay(rest: Item[], sheets: Item[], reserve: number) {
  const LAST = MAX_ROWS - 1;
  const items: PlacedItem[] = [];
  let x = 0, y = TITLE_H, w = 0, row = 0, k = 0;
  const put = (it: Item, dw: number) => { items.push({ ...it, x, y, dw, dh: ROW_H }); x += dw + ITEM_GAP; w = Math.max(w, x - ITEM_GAP); };
  const room = () => (row === LAST ? MAX_ROW_W - reserve : MAX_ROW_W);
  for (; k < rest.length; k++) {
    const dw = widthOf(rest[k]);
    if (x > 0 && x + dw > room()) {
      if (row >= LAST) break;
      row++; x = 0; y += ROW_H + ITEM_GAP;
    }
    if (x === 0 && reserve && row === LAST && dw > room()) break;
    put(rest[k], dw);
  }
  const folded = rest.length - k;
  if (folded && items.length) items[items.length - 1].more = folded;
  for (const it of sheets) {
    const dw = widthOf(it);
    if (x > 0 && x + dw > MAX_ROW_W) { row++; x = 0; y += ROW_H + ITEM_GAP; }
    put(it, dw);
  }
  return { items, w, h: y + ROW_H, rows: row + 1, folded };
}

// The files each session changed from `start` to the end of the day shown, newest first; and for
// each file the other sessions (from `every`, the whole canvas) that changed it within a day of
// this one.
const NEAR = 864e5;
function filesBy(index: Index, every: Index, start: number, end: number) {
  const named = new Map(every.threads.map((t) => [t.id, t]));
  const others = new Map<string, { thread: string; at: number }[]>();
  for (const c of every.changed || []) {
    const k = `${c.repo}\n${c.file}`;
    const l = others.get(k) || [];
    for (const [at] of c.edits) if (at <= end) l.push({ thread: c.thread, at });
    others.set(k, l);
  }
  const out = new Map<string, FileRow[]>();
  for (const c of index.changed || []) {
    const mine = c.edits.filter(([at]) => at >= start && at <= end);
    if (!mine.length) continue;
    const first = mine[0][0], last = mine[mine.length - 1][0];
    const also = new Map<string, number>();
    for (const o of others.get(`${c.repo}\n${c.file}`) || []) {
      if (o.thread !== c.thread && named.has(o.thread) && o.at >= first - NEAR && o.at <= last + NEAR) also.set(o.thread, Math.max(also.get(o.thread) || 0, o.at));
    }
    const row: FileRow = {
      repo: c.repo, file: c.file, last,
      add: mine.reduce((n, e) => n + e[1], 0), del: mine.reduce((n, e) => n + e[2], 0),
      also: [...also].sort((a, b) => b[1] - a[1]).map(([id]) => ({ id, title: clean(named.get(id)!.title) })),
    };
    out.set(c.thread, [...(out.get(c.thread) || []), row]);
  }
  for (const rows of out.values()) rows.sort((a, b) => b.last - a.last);
  return out;
}

// Today's canvas is the last three weeks. An earlier day (`asOf`, the end of it) is that day
// alone: what was made on it, and the sessions that ran. With `all`, nothing ages out and no
// project stops at ten groups: one session's whole history. `every` is the whole canvas when
// `index` is one session's part of it: who else changed a file.
export function layout(index: Index, asOf: number | null = null, all = false, every: Index = index): { clusters: Cluster[]; w: number; h: number; nameCap: number } {
  const end = asOf ?? Date.now();
  const day = asOf != null && !all;
  const start = all ? -Infinity : day ? new Date(end).setHours(0, 0, 0, 0) : end - WINDOW;
  const today = dayKey(new Date(end));
  const threadById = new Map(index.threads.map((t) => [t.id, t]));
  // A topic gathers every send filed under it, across threads and days; a send no topic
  // holds yet stays its own sitting, merged with sends from its thread close in time.
  type G = { id: string; thread: string | null; first: number; last: number; caption: string; topic: boolean; sets: ShotSet[]; items: Item[] };

  const proj = Object.keys(index.projects).map((key) => {
    const topicOf = new Map<string, Topic>();
    for (const t of index.topics?.[key] || []) for (const id of t.sets) topicOf.set(id, t);
    const gs: G[] = [];
    const byTopic = new Map<string, G>();
    for (const s of index.sets) {
      if (s.project !== key || s.at > end || s.at < start) continue;
      const t = topicOf.get(s.id);
      if (t) {
        let g = byTopic.get(t.id);
        if (!g) { g = { id: `t-${t.id}`, thread: s.thread, first: s.at, last: s.at, caption: t.title, topic: true, sets: [], items: [] }; byTopic.set(t.id, g); gs.push(g); }
        g.sets.push(s); g.first = Math.min(g.first, s.at); if (s.at >= g.last) { g.last = s.at; g.thread = s.thread; }
        continue;
      }
      const prev = [...gs].reverse().find((g) => !g.topic && g.thread === s.thread);
      if (prev && s.thread && s.at - prev.last < MERGE) { prev.sets.push(s); prev.last = s.at; }
      else gs.push({ id: s.id, thread: s.thread, first: s.at, last: s.at, caption: s.caption, topic: false, sets: [s], items: [] });
    }
    // newest send first inside a group, each send's screens in the order it showed them
    for (const g of gs) {
      const seen = new Set<string>();
      for (const s of [...g.sets].sort((a, b) => b.at - a.at)) {
        s.shots.forEach((shot, k) => {
          if (seen.has(shot.hash)) return;
          seen.add(shot.hash);
          g.items.push({ kind: "shot", key: `${g.id}-${shot.hash}`, shot, before: s.before?.[k], set: s.id, thread: s.thread, w: shot.w, h: shot.h });
        });
        // a push recorded without screens: its commits, set like a page of notes
        if (!s.shots.length && s.commits?.length) g.items.push({ kind: "note", key: `${g.id}-note-${s.id}`, title: s.caption, commits: s.commits, files: s.files || [], at: s.at, w: 520, h: 325 });
      }
    }
    // pages, each as it stood at the end of the day being shown
    for (const page of index.pages) {
      if (page.project !== key) continue;
      const shown = page.versions.filter((v) => v.at <= end);
      if (!shown.length) continue;
      const v = shown[shown.length - 1];
      if (v.at < start) continue;
      const item: Item = { kind: "page", key: `page-${page.id}`, page, hash: v.hash, layers: Math.min(2, shown.length - 1), w: 1280, h: 800 };
      // a page posted under a topic joins it; otherwise the sitting its thread was in
      const named = page.topic && gs.find((g) => g.topic && g.caption.toLowerCase() === page.topic!.toLowerCase());
      const home = named || (page.thread && gs.find((g) => g.sets.some((s) => s.thread === page.thread && Math.abs(s.at - v.at) < JOIN)));
      if (home) { home.items.unshift(item); home.last = Math.max(home.last, v.at); }
      else gs.push({ id: `p-${page.id}`, thread: page.thread, first: v.at, last: v.at, caption: page.topic || page.title, topic: true, sets: [], items: [item] });
    }
    gs.sort((a, b) => b.last - a.last);
    return { key, groups: all ? gs : gs.slice(0, GROUPS_PER_PROJECT) };
  });

  // Each session's files go on a sheet at the end of its newest group: the screens are what it
  // made, the sheet what it changed to make them. Seen on its own or on an earlier day, a session
  // that only changed files has a group of its own for them.
  const files = filesBy(index, every, day ? start : -Infinity, end);
  const home = new Map<string, G>();
  for (const p of proj) for (const g of p.groups) {
    const by = new Set([g.thread, ...g.sets.map((s) => s.thread), ...g.items.map((it) => (it.kind === "page" ? it.page.thread : null))]);
    for (const t of by) { const h = t && files.has(t) ? home.get(t) : null; if (t && files.has(t) && (!h || h.last < g.last)) home.set(t, g); }
  }
  for (const [t, rows] of files) {
    const th = threadById.get(t);
    let g = home.get(t);
    if (!g) {
      const p = (all || day) && th ? proj.find((p) => p.key === th.project) : null;
      if (!p) continue;
      g = { id: `f-${t}`, thread: t, first: rows[0].last, last: rows[0].last, caption: th!.title, topic: true, sets: [], items: [] };
      p.groups.push(g);
      p.groups.sort((a, b) => b.last - a.last);
    }
    g.items.push({ kind: "files", key: `${g.id}-files-${t}`, thread: t, title: clean(th?.title || ""), rows, w: 520, h: 325 });
  }

  const raw = proj.map(({ key, groups }) => {
    const threads = index.threads
      .filter((t) => t.project === key && !t.archived && !t.gone && (day ? !!t.days?.[today] : t.at <= end + 864e5 && (all || end - t.at < WINDOW)))
      .filter((t) => !groups.some((g) => g.thread === t.id))
      .sort((a, b) => b.at - a.at)
      .slice(0, 6);
    const at = Math.max(0, ...groups.map((g) => g.last), ...threads.map((t) => Math.min(t.at, end)));
    return { key, name: index.projects[key], groups, threads, at };
  })
    .filter((c) => c.groups.length || c.threads.length)
    .sort((a, b) => b.at - a.at);

  // Columns flow left to right, newest project first, wrapping into rows.
  const clusters: Cluster[] = [];
  let cx = 0, cy = 0, rowH = 0;
  for (const c of raw) {
    // each group's screens laid out in rows of even height, wrapping at the column's width
    const laid = c.groups.map((g) => {
      const sheets = g.items.filter((it) => it.kind === "files");
      const rest = g.items.filter((it) => it.kind !== "files");
      let r = lay(rest, sheets, 0);
      // when its screens fold, the files sheet still holds its place at the end of the last row
      if (sheets.length && (r.folded || r.rows > MAX_ROWS)) r = lay(rest, sheets, sheets.reduce((n, it) => n + widthOf(it) + ITEM_GAP, 0));
      return { g, items: r.items, w: r.w, h: r.h };
    });
    const colW = Math.max(MIN_COL_W, ...laid.map((l) => l.w));
    if (cx > 0 && cx + colW > WORLD_ROW_W) { cx = 0; cy += rowH + ROW_GAP; rowH = 0; }
    let y = cy + HEAD;
    const groups: Group[] = laid.map(({ g, items, w, h }) => {
      const t = g.thread ? threadById.get(g.thread) : null;
      const out: Group = {
        id: g.id,
        title: g.topic ? clean(g.caption) : titleFrom(g.caption, t?.title || ""),
        thread: g.thread,
        ...(t?.gone ? { gone: true } : {}),
        at: g.last,
        x: cx, y, w, h,
        items: items.map((it) => ({ ...it, x: cx + it.x, y: y + it.y })),
        all: g.items,
      };
      y += h + GROUP_GAP;
      return out;
    });
    if (!groups.length) y += 8;
    const threads = c.threads.map((item, i) => ({ item, x: cx, y: y + i * THREAD_ROW }));
    y += threads.length * THREAD_ROW;
    const h = y - cy;
    clusters.push({
      key: c.key, name: c.name, x: cx, y: cy, w: colW, h, at: c.at, groups, threads,
      pages: index.pages.filter((p) => p.project === c.key),
    });
    cx += colW + COL_GAP;
    rowH = Math.max(rowH, h);
  }
  const w = Math.max(...clusters.map((c) => c.x + c.w), 1);
  const h = Math.max(...clusters.map((c) => c.y + c.h), 1);
  // the largest size every project name can share without running into the next column
  const nameCap = Math.floor(Math.min(...clusters.map((c) => (c.w + COL_GAP * 0.75) / (c.name.length * 0.56)), 400));
  return { clusters, w, h, nameCap };
}
