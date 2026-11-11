import { randomBytes } from "node:crypto";

/**
 * His notes from the chat box under an artefact. Routing one (a decision answer is checked
 * against a fresh fleet read first) can take a minute and more, and he must never wait on
 * that: a note is accepted the moment Core has it, routed in the order he sent it,
 * and the card learns where it went by asking after its accepted id.
 */

/** How long a note may take to route before he is told it was accepted and routing goes on behind. */
export const NOTE_ACCEPT_MS = 2_500;
/** Most client ids and settled outcomes remembered, so a resend never routes twice and a card still asking is told. */
const REMEMBERED = 500;

/** What routing a note said: the HTTP status and JSON body the card would have been told. */
export interface NoteResult {
  status: number;
  body: Record<string, unknown>;
}

/** Where an accepted note went: the id its route gave it with what else the route said, or that it could not be delivered. */
export type NoteOutcome = { id: string; followUp?: unknown; pictureFailed?: true; warning?: unknown } | { failed: string };

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

/** Routes one note into a held response; a route that throws is a failed delivery, never a rejection. */
async function routed(route: (res: HeldResponse) => Promise<void>): Promise<NoteResult> {
  const res = new HeldResponse();
  try { await route(res); } catch { /* an empty response is a failed delivery */ }
  return res.result();
}

export class CardNotes {
  private readonly acceptMs: number;
  /** Each card's notes route one at a time, in the order they came: a later one never overtakes an earlier one, and cards never wait on each other. */
  private readonly chains = new Map<string, Promise<unknown>>();
  private readonly byClient = new Map<string, Promise<NoteResult>>();
  private readonly settled = new Map<string, NoteOutcome>();
  private readonly pending = new Set<string>();

  constructor(options: { acceptMs?: number } = {}) {
    this.acceptMs = options.acceptMs ?? NOTE_ACCEPT_MS;
  }

  /**
   * Takes one note: routes it in order and answers with the route's own result when that comes
   * quickly, else with an accepted receipt while routing goes on. The same client id sent again
   * (a resend after a timeout, a second copy of the card) gets the same answer, never a second route.
   */
  accept(clientId: string | undefined, card: string, route: (res: HeldResponse) => Promise<void>): Promise<NoteResult> {
    const known = clientId ? this.byClient.get(clientId) : undefined;
    if (known) return known;
    // Only a note that went is remembered: a failure, told now or after it was accepted, is his to send again, and that must route.
    const forget = () => { if (clientId && this.byClient.get(clientId) === result) this.byClient.delete(clientId); };
    const result: Promise<NoteResult> = this.take(card, route, forget).then((outcome) => {
      if (outcome.status >= 400) forget();
      return outcome;
    });
    if (clientId) {
      this.byClient.set(clientId, result);
      while (this.byClient.size > REMEMBERED) this.byClient.delete(this.byClient.keys().next().value!);
    }
    return result;
  }

  /** Where an accepted note stands: undefined while it is still routing or unknown. */
  outcome(id: string): NoteOutcome | undefined {
    return this.settled.get(id);
  }

  /** Whether an accepted note is still on its way. */
  routing(id: string): boolean {
    return this.pending.has(id);
  }

  private async take(card: string, route: (res: HeldResponse) => Promise<void>, forget: () => void): Promise<NoteResult> {
    const id = `pending:${randomBytes(9).toString("hex")}`;
    const delivered = this.queue(id, card, route).then((result) => {
      if (result.status >= 400) forget();
      return result;
    });
    let timer: NodeJS.Timeout | undefined;
    const slow = new Promise<"slow">((resolve) => { timer = setTimeout(() => resolve("slow"), this.acceptMs); timer.unref?.(); });
    const first = await Promise.race([delivered, slow]);
    clearTimeout(timer);
    if (first !== "slow") return first;
    return { status: 200, body: { id, timestamp: new Date().toISOString(), waiting: "Sent to Flyd" } };
  }

  /** Routes one accepted note in its turn and records where it went. */
  private queue(id: string, card: string, route: (res: HeldResponse) => Promise<void>): Promise<NoteResult> {
    this.pending.add(id);
    return this.serial(card, async () => {
      const result = await routed(route);
      const { followUp, pictureFailed, warning } = result.body;
      const outcome: NoteOutcome = result.status < 400 && typeof result.body.id === "string"
        ? { id: result.body.id, ...(followUp ? { followUp } : {}), ...(pictureFailed === true ? { pictureFailed: true as const } : {}), ...(warning ? { warning } : {}) }
        : { failed: NOT_DELIVERED };
      this.pending.delete(id);
      this.settled.set(id, outcome);
      while (this.settled.size > REMEMBERED) this.settled.delete(this.settled.keys().next().value!);
      return result;
    });
  }

  private serial<T>(card: string, work: () => Promise<T>): Promise<T> {
    const next = (this.chains.get(card) ?? Promise.resolve()).then(work, work);
    const tail = next.then(() => undefined, () => undefined).then(() => { if (this.chains.get(card) === tail) this.chains.delete(card); });
    this.chains.set(card, tail);
    return next;
  }
}
