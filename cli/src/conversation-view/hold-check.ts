import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { firstmateHome } from "../lib/firstmate-home.js";

// Is this call still open? Firstmate's own answer, asked when a card is about to
// be shown rather than trusted from the snapshot: the snapshot can be a stand-in
// read up to half an hour old, and Flyd's list keeps rows longer still.
//
// `fm-captain-hold.sh open <task> --identity --distinguish-absent` is the
// read-only predicate firstmate's own board hygiene asks (docs/captain-hold-lifecycle.md,
// "Card hygiene"). Exit 0: still an open captain call, and it prints the call's
// lifecycle identity (hold-set stamp # answers recorded). Exit 1: present but no
// longer an open captain call. Exit 3: not in the backlog. Exit 2 or anything
// else: it could not tell. Only exit 1 settles a card; a card wrongly shown is
// recoverable and a call wrongly hidden is not, so "absent" and "cannot tell"
// keep it, as the board does.

export type HoldState =
  | { state: "open"; identity?: string }
  | { state: "closed" }
  | { state: "absent" }
  | { state: "unknown" };

/** What Flyd asks firstmate about one call: never throws, never writes. */
export interface HoldCheck {
  state(task: string): Promise<HoldState>;
}

/** How long one answer stands: refreshes that land together share it. */
const HOLD_CACHE_MS = 30_000;
/** One ask's time limit: the predicate reads one backlog row. */
const HOLD_TIMEOUT_MS = 10_000;
/** Asks in flight at once: the script is not free on a loaded Mac. */
const HOLD_CONCURRENCY = 4;

/** The predicate's exit and output, read as a state. Pure. */
export function holdStateOf(code: number | null, stdout: string): HoldState {
  if (code === 0) {
    const identity = stdout.trim().split("\n").at(-1)?.trim();
    return identity && /^[\w:.+-]*#\d+$/.test(identity) ? { state: "open", identity } : { state: "open" };
  }
  if (code === 1) return { state: "closed" };
  if (code === 3) return { state: "absent" };
  return { state: "unknown" };
}

/** Firstmate's open predicate, through its own script, read-only. */
export class FirstmateHoldCheck implements HoldCheck {
  private readonly cache = new Map<string, { at: number; state: Promise<HoldState> }>();
  private running = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly options: { home?: string; now?: () => number; timeoutMs?: number } = {}) {}

  private script(): string {
    return join(this.options.home ?? firstmateHome(), "bin", "fm-captain-hold.sh");
  }

  state(task: string): Promise<HoldState> {
    if (!/^[A-Za-z0-9._-]+$/.test(task)) return Promise.resolve({ state: "unknown" });
    const now = this.options.now?.() ?? Date.now();
    const known = this.cache.get(task);
    if (known && now - known.at < HOLD_CACHE_MS) return known.state;
    const state = this.ask(task);
    this.cache.set(task, { at: now, state });
    for (const [key, entry] of this.cache) if (now - entry.at >= HOLD_CACHE_MS) this.cache.delete(key);
    return state;
  }

  private async ask(task: string): Promise<HoldState> {
    const script = this.script();
    if (!existsSync(script)) return { state: "unknown" };
    if (this.running >= HOLD_CONCURRENCY) await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.running += 1;
    try {
      return await new Promise<HoldState>((resolve) => {
        execFile(script, ["open", task, "--identity", "--distinguish-absent"], { timeout: this.options.timeoutMs ?? HOLD_TIMEOUT_MS, encoding: "utf8" }, (error, stdout) => {
          // A non-zero exit carries its number; a timeout, a kill or a spawn failure does not, and reads "cannot tell".
          const exit = (error as { code?: unknown } | null)?.code;
          const code = !error ? 0 : typeof exit === "number" ? exit : null;
          resolve(holdStateOf(code, stdout ?? ""));
        });
      });
    } finally {
      this.running -= 1;
      this.waiting.shift()?.();
    }
  }
}
