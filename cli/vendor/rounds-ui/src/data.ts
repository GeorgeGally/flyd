export type Version = { at: number; hash: string };
export type Page = { id: string; url: string; title: string; thread: string | null; project: string; at: number; versions: Version[]; topic?: string; posted?: boolean };
/** A thread gone from this Mac (its transcript cleaned up, its desktop record deleted) keeps its work on the canvas. */
export type Thread = { id: string; title: string; cwd: string; archived: boolean; at: number; recap: string; project: string; days?: Record<string, number>; gone?: boolean };
export type Comment = {
  id: string; page: string; hash: string; x: number; y: number; text: string; at: number;
  thread: string | null; state: "queued" | "sent" | "kept"; delivery?: string;
  /** how it reaches its session: the desktop relay, the notes hook, or not at all */
  route?: "relay" | "hook" | "kept"; threadTitle?: string | null;
  reply?: { text: string; at: number };
};
export type Shot = { hash: string; ext: string; w: number; h: number; name: string };
/** A set of screens a thread showed him in one go, with the caption it gave them. */
export type Commit = { sha: string; subject: string };
/** A set of screens a thread showed him (or posted), with the caption it gave them. A change carries
 *  its commits, and screens can carry their before, one per screen in the same order. */
export type ShotSet = {
  id: string; thread: string | null; project: string; at: number; caption: string; shots: Shot[];
  topic?: string; kind?: "screens" | "page" | "change" | "push"; before?: Shot[]; commits?: Commit[]; files?: string[];
};
/** What a project's screens were about, across sends and days; filed by Claude. */
export type Topic = { id: string; title: string; sets: string[] };
/** A session's changes to one project file: when each came, and the lines it added and removed. */
export type Changed = { thread: string; repo: string; file: string; edits: [number, number, number][] };
/** One change as Claude Code recorded it: hunks of lines, each marked " ", "+" or "-", from line o
 *  of the old file and line n of the new. A long change keeps its first lines; `cut` more followed. */
export type Edit = { at: number; add: number; del: number; hunks: { o: number; n: number; lines: string[] }[]; cut?: number; created?: boolean };
export type Index = { builtAt: number; projects: Record<string, string>; threads: Thread[]; pages: Page[]; sets: ShotSet[]; changed?: Changed[]; topics?: Record<string, Topic[]>; comments: Comment[]; previews?: boolean; unavailable?: string; complete?: boolean };

/** The embedded Rounds UI uses only Flyd's token-protected work namespace. */
export const authUrl = (path: string): string => {
  const token = document.querySelector<HTMLMetaElement>('meta[name="flyd-work-token"]')?.content ?? "";
  return path + (path.includes("?") ? "&" : "?") + "token=" + encodeURIComponent(token);
};

export async function loadIndex(fresh = false): Promise<Index> {
  const r = await fetch(authUrl(`/api/work/index${fresh ? "?fresh" : ""}`));
  if (!r.ok) throw new Error(`index: ${r.status}`);
  return r.json();
}

export async function loadEdits(thread: string, repo: string, file: string): Promise<Edit[]> {
  const r = await fetch(authUrl(`/api/work/edits/${encodeURIComponent(thread)}?repo=${encodeURIComponent(repo)}&file=${encodeURIComponent(file)}`));
  if (!r.ok) throw new Error(`edits: ${r.status}`);
  return r.json();
}

export const shot = (hash: string, _full = false) => authUrl(`/api/work/media/${encodeURIComponent(hash)}`);
export const thumb = (hash: string) => authUrl(`/api/work/media/${encodeURIComponent(hash)}`);
/** A kept screen, at a width the canvas can afford, or the original. */
export const img = (s: Shot, _w?: 240 | 480 | 960 | 1600) => authUrl(`/api/work/media/${encodeURIComponent(s.hash)}`);
export const pageSrc = (_hash: string) => "about:blank"; // HTML previews remain disabled.
export const threadLink = (_id: string) => "/";

export async function postComment(_c: { page: string; hash: string; x: number; y: number; text: string; set?: string }): Promise<Comment> {
  throw new Error("Review comments are not enabled in the read-only work canvas.");
}

const DAY = 864e5;
export function when(at: number) {
  const d = new Date(at);
  const age = Date.now() - at;
  if (age < DAY && d.getDate() === new Date().getDate()) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

// What he has looked at, per page, kept in this browser only. On the first visit, anything
// published in the last two days counts as new.
const SEEN = "wb.seen.v1";
export function readSeen(): { since: number; pages: Record<string, number> } {
  try {
    const v = JSON.parse(localStorage.getItem(SEEN) || "null");
    if (v && typeof v.since === "number") return v;
  } catch {}
  const v = { since: Date.now() - 2 * 864e5, pages: {} };
  try { localStorage.setItem(SEEN, JSON.stringify(v)); } catch {}
  return v;
}
export function markSeen(id: string) {
  const v = readSeen();
  v.pages[id] = Date.now();
  try { localStorage.setItem(SEEN, JSON.stringify(v)); } catch {}
  return v;
}

/** Titles as he would write them: no em dashes. */
export const clean = (t: string) => t.replace(/\s*[\u2014\u2013]\s*/g, ": ").replace(/\s*\u00b7\s*/g, ", ");
