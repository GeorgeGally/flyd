import type { PreviewState } from "./rail.js";

// Whether a live page the right column wants to frame actually answers. A
// frame pointed at a port nothing serves is a blank white box; asked from the
// server first, the column can say "not running" instead. Each page is asked
// at most once per interval, with a short timeout, and pages the column still
// shows are asked again so one that comes up (or goes down) changes the card.

const TIMEOUT_MS = 1_500;
const RECHECK_MS = 10_000;
/** A page the column stopped naming is forgotten after this long. */
const FORGET_MS = 5 * 60_000;

type Fetch = (url: string, init: { method: string; redirect: "manual"; signal: AbortSignal }) => Promise<{ status: number; body?: { cancel(): Promise<void> } | null }>;

interface Entry {
  state: PreviewState;
  checkedAt: number;
  wantedAt: number;
  inFlight: boolean;
}

export class PreviewProbe {
  private readonly entries = new Map<string, Entry>();
  private readonly listeners = new Set<() => void>();
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly fetchFn: Fetch = fetch as unknown as Fetch, private readonly now: () => number = Date.now) {}

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

  /** Called when a page's state changes; returns the unsubscribe. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Any HTTP answer below 500 is a page to show; refused, timed out or a server error is not. */
  async check(url: string, entry = this.entries.get(url)): Promise<PreviewState> {
    if (!entry) return "checking";
    entry.inFlight = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let state: PreviewState;
    try {
      const response = await this.fetchFn(url, { method: "GET", redirect: "manual", signal: controller.signal });
      void response.body?.cancel().catch(() => undefined);
      state = response.status < 500 ? "up" : "down";
    } catch {
      state = "down";
    } finally {
      clearTimeout(timeout);
      entry.inFlight = false;
    }
    entry.checkedAt = this.now();
    const changed = entry.state !== state;
    entry.state = state;
    if (changed) for (const listener of this.listeners) listener();
    return state;
  }

  private schedule(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      const at = this.now();
      for (const [url, entry] of this.entries) {
        if (at - entry.wantedAt > FORGET_MS) this.entries.delete(url);
        else if (!entry.inFlight && at - entry.checkedAt >= RECHECK_MS) void this.check(url, entry);
      }
      if (this.entries.size === 0) this.close();
    }, RECHECK_MS);
    this.timer.unref?.();
  }
}
