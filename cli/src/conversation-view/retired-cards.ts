import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { FLYD_DIR } from "../lib/config.js";
import { questionIdentityOf, type ArtefactRow } from "./artefact.js";

// The calls George said are old, moot or done. "I'll stop raising it" is kept
// here, not only said: the feed never shows a retired call again (artefact.ts),
// and firstmate is told to close it with his words (retire.ts). One retirement
// covers one question: the hold raised again later is a new question, and asks.

export interface RetiredCard {
  task: string;
  /** The question's identity when he retired it (artefact.ts `questionIdentityOf`). */
  identity: string;
  /** What the card said, so the record reads on its own. */
  label: string;
  /** His own words. */
  words: string;
  at: string;
}

const KEEP = 300;

export function retiredCardsPath(): string {
  return join(process.env.FLYD_DIR || FLYD_DIR, "view", "retired-cards.json");
}

/** The record, shared by every process (the conversation's tool writes it; the view reads it). Never throws. */
export class RetiredCards {
  private cached?: { mtimeMs: number; cards: RetiredCard[] };
  private memory: RetiredCard[] = [];

  /** Tests keep the record in memory unless they name a file: never George's real one. */
  constructor(private readonly file: string | null = process.env.VITEST ? null : retiredCardsPath()) {}

  list(): RetiredCard[] {
    if (!this.file) return this.memory;
    try {
      if (!existsSync(this.file)) return [];
      const mtimeMs = statSync(this.file).mtimeMs;
      if (this.cached?.mtimeMs === mtimeMs) return this.cached.cards;
      const parsed = JSON.parse(readFileSync(this.file, "utf8")) as { cards?: unknown };
      const cards = Array.isArray(parsed.cards) ? parsed.cards.filter((card): card is RetiredCard =>
        Boolean(card) && typeof card === "object" && typeof (card as RetiredCard).task === "string" && typeof (card as RetiredCard).identity === "string") : [];
      this.cached = { mtimeMs, cards };
      return cards;
    } catch {
      return [];
    }
  }

  /** Whether he retired this very question. */
  has(row: ArtefactRow): boolean {
    if (!row.task) return false;
    const identity = questionIdentityOf(row);
    return this.list().some((card) => card.task === row.task && card.identity === identity);
  }

  retire(card: RetiredCard): void {
    const cards = [card, ...this.list().filter((known) => !(known.task === card.task && known.identity === card.identity))].slice(0, KEEP);
    if (!this.file) {
      this.memory = cards;
      return;
    }
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify({ cards }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, this.file);
    this.cached = undefined;
  }
}
