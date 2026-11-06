import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** What fits one note, each line cut short. */
const ASK_AT_ONCE = 25;
/** A backfill reaches him as a few quiet notes an hour to firstmate, never a burst. */
const ASK_GAP_MS = 15 * 60_000;
/** A note firstmate never answered stops holding up the next one. */
const GIVE_UP_MS = 6 * 60 * 60_000;

export function defaultProjectTagFile(): string {
  return join(homedir(), ".flyd", "view", "project-tags.json");
}

interface OpenAsk { requestId: string; sentAt: number; turns: Record<string, string> }
interface Kept { tags: Record<string, string | null>; open?: OpenAsk; lastSent?: number }

const hashed = (text: string): string => createHash("sha256").update(text).digest("hex");

/**
 * Firstmate's word on which project a turn is about, for the turns Flyd cannot
 * place itself. It knows the fleet, and nothing leaves the machine. One note at a
 * time goes through firstmate's inbox, and the answers are kept by hash, so the
 * same history is asked once. What its reply does not place stays unplaced: Other.
 */
export class ProjectAsker {
  private readonly tags = new Map<string, string | null>();
  private open?: OpenAsk;
  private lastSent = 0;

  constructor(private readonly options: {
    /** Hands firstmate the note; false when it is not taking notes now. */
    send: (body: string, requestId: string) => Promise<boolean>;
    reply: (requestId: string) => string | undefined;
    names: string[];
    file?: string;
    now?: () => number;
  }) {
    if (!options.file) return;
    try {
      const kept = JSON.parse(readFileSync(options.file, "utf8")) as Partial<Kept>;
      for (const [key, value] of Object.entries(kept.tags ?? {})) if (typeof value === "string" || value === null) this.tags.set(key, value);
      this.open = kept.open;
      this.lastSent = kept.lastSent ?? 0;
    } catch { /* Nothing kept yet, or unreadable: firstmate is asked again. */ }
  }

  /** The project firstmate placed this turn in, null for none of them, undefined when never answered. */
  known(turn: string): string | null | undefined {
    return this.tags.get(hashed(turn));
  }

  /** Reads an answer if one came, else sends the next note when it is due. True when something was learned. */
  async ask(cases: Array<{ turn: string; line: string }>): Promise<boolean> {
    const now = (this.options.now ?? Date.now)();
    if (this.open) {
      const reply = this.options.reply(this.open.requestId);
      if (reply) { this.learn(reply, this.open); return true; }
      if (now - this.open.sentAt <= GIVE_UP_MS) return false;
      this.learn("", this.open);
    }
    const batch = cases.filter((item) => this.known(item.turn) === undefined).slice(0, ASK_AT_ONCE);
    if (!batch.length || now - this.lastSent < ASK_GAP_MS) return false;
    const requestId = `flyd-project-threads-${now}`;
    const ids = batch.map((item) => ({ ...item, id: hashed(item.turn).slice(0, 8) }));
    if (!await this.options.send(this.note(ids), requestId)) return false;
    this.open = { requestId, sentAt: now, turns: Object.fromEntries(ids.map((item) => [item.id, hashed(item.turn)])) };
    this.lastSent = now;
    this.save();
    return false;
  }

  private note(items: Array<{ id: string; line: string }>): string {
    return [
      "Flyd's own note, no work asked and nothing for George. Flyd splits his conversations by project and could not place these exchanges. From what you know of the fleet and these conversations, say which project each is about.",
      `Reply to this note with one line per id, "id: Project", using one of: ${this.options.names.join(", ")}. Write "id: Other" when it is about none of them or you cannot tell. Answer from what you know; spawn nobody.`,
      "",
      ...items.map((item) => `${item.id} | ${item.line}`),
    ].join("\n");
  }

  private learn(reply: string, open: OpenAsk): void {
    const names = new Map(this.options.names.map((name) => [name.toLowerCase(), name]));
    const said = new Map([...reply.matchAll(/\b([0-9a-f]{8})\b\s*[:=|-]+\s*([^\n",|]+)/g)].map((match) => [match[1]!, match[2]!.trim().toLowerCase()]));
    for (const [id, turn] of Object.entries(open.turns)) {
      const answer = said.get(id);
      const name = names.get(answer ?? "");
      if (name || answer === "other") {
        this.tags.set(turn, name ?? null);
      }
    }
    delete this.open;
    this.save();
  }

  private save(): void {
    const { file } = this.options;
    if (!file) return;
    const temporary = `${file}.${process.pid}.tmp`;
    try {
      mkdirSync(dirname(file), { recursive: true });
      const kept: Kept = { tags: Object.fromEntries(this.tags), ...(this.open ? { open: this.open } : {}), lastSent: this.lastSent };
      writeFileSync(temporary, JSON.stringify(kept), { mode: 0o600 });
      renameSync(temporary, file);
    } catch (error) {
      console.warn(`[view] could not keep project tags: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
