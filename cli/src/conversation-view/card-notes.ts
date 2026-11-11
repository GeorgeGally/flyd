import { randomBytes } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FLYD_DIR } from "../lib/config.js";

/**
 * His notes from the chat box under an artefact. Routing one (a decision answer is checked
 * against a fresh fleet read first) can take a minute and more, and he must never wait on
 * that: a note is accepted the moment Core has it on disk, routed in the order he sent it,
 * and the card learns where it went by asking after its accepted id.
 */

/** How long a note may take to route before he is told it was accepted and routing goes on behind. */
export const NOTE_ACCEPT_MS = 2_500;
/** How long a settled note's outcome is kept for a card still asking after it. */
const SETTLED_KEEP_MS = 24 * 60 * 60_000;
/** Most client ids remembered, so a resend of the same note never routes it twice. */
const CLIENT_IDS = 500;

/** What routing a note said: the HTTP status and JSON body the card would have been told. */
export interface NoteResult {
  status: number;
  body: Record<string, unknown>;
}

/** Where an accepted note went: the id its route gave it, or that it could not be delivered. */
export type NoteOutcome = { id: string } | { failed: string };

/** A stand-in response that keeps what routing would have said, so it can be told now or later. */
export class HeldResponse {
  status = 0;
  body = "";
  headersSent = false;
  writeHead(status: number): this {
    this.status = status;
    this.headersSent = true;
    return this;
  }
  end(body?: string): this {
    this.body = body ?? "";
    this.headersSent = true;
    return this;
  }
  result(): NoteResult {
    let body: Record<string, unknown> = {};
    try { body = JSON.parse(this.body || "{}") as Record<string, unknown>; } catch { /* not JSON: an empty body */ }
    return { status: this.status || 502, body: this.status ? body : { error: "The note could not be delivered" } };
  }
}

/** The plain line a card shows when a note it was told was accepted could not be delivered after all. */
export const NOT_DELIVERED = "Not delivered. Try again.";

type Spooled = { payload: unknown; at: number } | { outcome: NoteOutcome; at: number };

export class CardNotes {
  private readonly root: string;
  private readonly acceptMs: number;
  /** Notes route one at a time, in the order they came: a later one never overtakes an earlier one. */
  private chain: Promise<unknown> = Promise.resolve();
  private readonly byClient = new Map<string, Promise<NoteResult>>();
  private readonly settled = new Map<string, NoteOutcome>();

  constructor(options: { root?: string; acceptMs?: number } = {}) {
    this.root = options.root ?? join(FLYD_DIR, "view", "card-notes");
    this.acceptMs = options.acceptMs ?? NOTE_ACCEPT_MS;
  }

  /**
   * Takes one note: routes it in order and answers with the route's own result when that comes
   * quickly, else with an accepted receipt while routing goes on. The same client id sent again
   * (a resend after a timeout, a second copy of the card) gets the same answer, never a second route.
   */
  accept(payload: unknown, clientId: string | undefined, route: (res: HeldResponse) => Promise<void>): Promise<NoteResult> {
    const known = clientId ? this.byClient.get(clientId) : undefined;
    if (known) return known;
    // Only a note that went is remembered: a failure, told now or after it was accepted, is his to send again, and that must route.
    const forget = () => { if (clientId && this.byClient.get(clientId) === result) this.byClient.delete(clientId); };
    const result: Promise<NoteResult> = this.take(payload, route, forget).then((outcome) => {
      if (outcome.status >= 400) forget();
      return outcome;
    });
    if (clientId) {
      this.byClient.set(clientId, result);
      while (this.byClient.size > CLIENT_IDS) this.byClient.delete(this.byClient.keys().next().value!);
    }
    return result;
  }

  /** Where an accepted note stands: undefined while it is still routing or unknown. */
  outcome(id: string): NoteOutcome | undefined {
    const held = this.settled.get(id);
    if (held) return held;
    const spooled = this.read(id);
    return spooled && "outcome" in spooled ? spooled.outcome : undefined;
  }

  /** Whether an accepted note is still on its way. */
  routing(id: string): boolean {
    if (this.settled.has(id)) return false;
    const spooled = this.read(id);
    return Boolean(spooled && "payload" in spooled);
  }

  /** Notes accepted before a restart and never routed go now, oldest first; old outcomes are dropped. */
  resume(route: (payload: unknown, res: HeldResponse) => Promise<void>): void {
    let names: string[] = [];
    try { names = readdirSync(this.root).filter((name) => name.endsWith(".json")).sort(); } catch { return; }
    for (const name of names) {
      const id = `pending:${name.slice(0, -5)}`;
      const spooled = this.read(id);
      if (!spooled) continue;
      if ("outcome" in spooled) {
        if (Date.now() - spooled.at > SETTLED_KEEP_MS) rmSync(this.path(id), { force: true });
        continue;
      }
      void this.queue(id, (res) => route(spooled.payload, res));
    }
  }

  private async take(payload: unknown, route: (res: HeldResponse) => Promise<void>, forget: () => void): Promise<NoteResult> {
    // Ids sort in the order notes came, so a restart replays them in that order too.
    const id = `pending:${Date.now().toString().padStart(15, "0")}-${randomBytes(6).toString("hex")}`;
    try {
      this.write(id, { payload, at: Date.now() });
    } catch {
      // Nowhere to keep it: routed in place, and he waits for the answer as before.
      const res = new HeldResponse();
      await this.serial(() => route(res));
      return res.result();
    }
    const routed = this.queue(id, route).then((result) => {
      if (result.status >= 400) forget();
      return result;
    });
    let timer: NodeJS.Timeout | undefined;
    const slow = new Promise<"slow">((resolve) => { timer = setTimeout(() => resolve("slow"), this.acceptMs); timer.unref?.(); });
    const first = await Promise.race([routed, slow]);
    clearTimeout(timer);
    if (first !== "slow") return first;
    return { status: 200, body: { id, timestamp: new Date().toISOString(), waiting: "Sent to Flyd" } };
  }

  /** Routes one spooled note in its turn and records where it went. */
  private queue(id: string, route: (res: HeldResponse) => Promise<void>): Promise<NoteResult> {
    return this.serial(async () => {
      const res = new HeldResponse();
      try { await route(res); } catch { /* an empty response is a failed delivery */ }
      const result = res.result();
      const outcome: NoteOutcome = result.status < 400 && typeof result.body.id === "string"
        ? { id: result.body.id }
        : { failed: NOT_DELIVERED };
      this.settled.set(id, outcome);
      try { this.write(id, { outcome, at: Date.now() }); } catch { /* kept in memory for this run */ }
      return result;
    });
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.chain.then(work, work);
    this.chain = next.catch(() => undefined);
    return next;
  }

  private path(id: string): string {
    return join(this.root, `${id.slice("pending:".length).replace(/[^0-9a-z-]/gi, "")}.json`);
  }

  private read(id: string): Spooled | undefined {
    if (!id.startsWith("pending:")) return undefined;
    try {
      const spooled = JSON.parse(readFileSync(this.path(id), "utf8")) as Spooled;
      return spooled && typeof spooled === "object" ? spooled : undefined;
    } catch {
      return undefined;
    }
  }

  private write(id: string, value: Spooled): void {
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    const path = this.path(id);
    const temp = `${path}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(value), { mode: 0o600 });
    renameSync(temp, path);
  }
}

