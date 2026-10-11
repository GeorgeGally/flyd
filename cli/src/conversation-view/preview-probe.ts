import { lookupPortServer, sameServer, type PortLookup, type PortServer } from "./port-server.js";
import type { PreviewState } from "./rail.js";

// Whether a live page the right column wants to frame actually answers. A
// frame pointed at a port nothing serves is a blank white box; asked from the
// server first, the column can say "not running" instead. Each page is asked
// at most once per interval, with a short timeout, and pages the column still
// shows are asked again so one that comes up (or goes down) changes the card.
// With each ask it also looks, read-only, at which server listens on the port,
// and remembers when that server changed: a different process, command or
// folder, or the port going quiet or coming back.

const TIMEOUT_MS = 1_500;
const RECHECK_MS = 10_000;
/** A page the column stopped naming is forgotten after this long. */
const FORGET_MS = 5 * 60_000;
/** How long a change of server stays on the card. */
const NOTICE_MS = 30 * 60_000;

/** The server behind a port changed: what it was, what it is now, and when. */
export interface ServerChange {
  at: string;
  was: PortServer | null;
  now: PortServer | null;
}

/** The server last seen on a port (null: nothing listens), and its latest change while still news. */
export interface ServedBy {
  server: PortServer | null;
  change?: ServerChange;
}

interface PortEntry {
  /** Undefined until first seen. */
  server?: PortServer | null;
  change?: ServerChange;
}

type Fetch = (url: string, init: { method: string; redirect: "manual"; signal: AbortSignal }) => Promise<{
  status: number;
  headers?: { get(name: string): string | null };
  body?: { cancel(): Promise<void> } | null;
}>;

/** A page that says it may not be framed by another site: X-Frame-Options, or frame-ancestors without a wildcard. */
export function refusesFraming(headers: { get(name: string): string | null } | undefined): boolean {
  if (!headers) return false;
  if (/\b(?:deny|sameorigin)\b/i.test(headers.get("x-frame-options") ?? "")) return true;
  const ancestors = /(?:^|;)\s*frame-ancestors\s+([^;]*)/i.exec(headers.get("content-security-policy") ?? "")?.[1];
  return ancestors !== undefined && !/(?:^|\s)(?:\*|https?:\/\/(?:127\.0\.0\.1|localhost):\*)(?:\s|$)/.test(ancestors);
}

interface Entry {
  state: PreviewState;
  checkedAt: number;
  wantedAt: number;
  inFlight: boolean;
}

export class PreviewProbe {
  private readonly entries = new Map<string, Entry>();
  private readonly ports = new Map<string, PortEntry>();
  private readonly listeners = new Set<() => void>();
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly fetchFn: Fetch = fetch as unknown as Fetch,
    private readonly now: () => number = Date.now,
    private readonly lookup: PortLookup = lookupPortServer,
  ) {}

  /** What the page did when last asked; "checking" until the first answer. Starts a check when due. */
  state(url: string): PreviewState {
    const at = this.now();
    let entry = this.entries.get(url);
    if (!entry) {
      entry = { state: "checking", checkedAt: 0, wantedAt: at, inFlight: false };
      this.entries.set(url, entry);
    }
    entry.wantedAt = at;
    if (!entry.inFlight && at - entry.checkedAt >= RECHECK_MS) void this.check(url, entry);
    this.schedule();
    return entry.state;
  }

  /** Which server serves a page's port, once looked at, and its latest change while it is still news. */
  servedBy(url: string): ServedBy | undefined {
    const entry = this.ports.get(portKey(url));
    if (!entry || entry.server === undefined) return undefined;
    const fresh = entry.change && this.now() - Date.parse(entry.change.at) < NOTICE_MS ? { change: entry.change } : {};
    return { server: entry.server, ...fresh };
  }

  /** Called when a page's state or its server changes; returns the unsubscribe. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Any HTTP answer below 500 is a page to show, unless it refuses framing; refused, timed out or a server error is not. */
  async check(url: string, entry = this.entries.get(url)): Promise<PreviewState> {
    if (!entry) return "checking";
    entry.inFlight = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let state: PreviewState;
    const port = portKey(url);
    const looked = port ? this.lookup(Number(port)).catch(() => null) : Promise.resolve(null);
    try {
      const response = await this.fetchFn(url, { method: "GET", redirect: "manual", signal: controller.signal });
      void response.body?.cancel().catch(() => undefined);
      state = response.status >= 500 ? "down" : refusesFraming(response.headers) ? "blocked" : "up";
    } catch {
      state = "down";
    } finally {
      clearTimeout(timeout);
      entry.inFlight = false;
    }
    entry.checkedAt = this.now();
    const changed = entry.state !== state;
    entry.state = state;
    if (changed) this.announce();
    // The server behind the port lands on its own, so a slow lookup never holds up the page's answer.
    if (port) void looked.then((server) => { if (this.saw(port, server, state)) this.announce(); });
    return state;
  }

  private announce(): void {
    for (const listener of this.listeners) listener();
  }

  /**
   * What the port's server is now. Nothing listening only counts when the page
   * is also down, and a server only when it answers, so a lookup that could
   * not see the process never reads as the server stopping.
   */
  private saw(port: string, server: PortServer | null, state: PreviewState): boolean {
    if (server ? state === "down" : state !== "down") return false;
    const entry = this.ports.get(port) ?? {};
    this.ports.set(port, entry);
    if (entry.server !== undefined && sameServer(entry.server, server)) return false;
    if (entry.server !== undefined) entry.change = { at: new Date(this.now()).toISOString(), was: entry.server, now: server };
    entry.server = server;
    return true;
  }

  private schedule(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      const at = this.now();
      for (const [url, entry] of this.entries) {
        if (at - entry.wantedAt > FORGET_MS) {
          this.entries.delete(url);
          const port = portKey(url);
          if (![...this.entries.keys()].some((other) => portKey(other) === port)) this.ports.delete(port);
        } else if (!entry.inFlight && at - entry.checkedAt >= RECHECK_MS) void this.check(url, entry);
      }
      if (this.entries.size === 0) this.close();
    }, RECHECK_MS);
    this.timer.unref?.();
  }
}

/** A loopback page's port, as text; "" when the URL has none to look at. */
function portKey(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.port || (parsed.protocol === "https:" ? "443" : parsed.protocol === "http:" ? "80" : "");
  } catch {
    return "";
  }
}
