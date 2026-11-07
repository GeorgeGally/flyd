import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { FLYD_DIR } from "../lib/config.js";

/**
 * The offer to link WhatsApp is said once. The first page to open takes it and
 * keeps it until it closes or he dismisses it; a reload, another window or a
 * restart never brings it back, because the record outlives Core. Linking is
 * always there under People.
 */

interface OfferRecord {
  /** When the offer was made. */
  shown?: string;
  dismissed?: boolean;
}

export class WhatsAppOffer {
  private readonly path: string;
  private record: OfferRecord;

  constructor(dir: string = FLYD_DIR) {
    this.path = join(dir, "connectors", "whatsapp", "offer.json");
    this.record = this.read();
  }

  private read(): OfferRecord {
    try {
      const raw = JSON.parse(readFileSync(this.path, "utf8")) as { shown?: unknown; dismissed?: unknown };
      return { ...(typeof raw.shown === "string" ? { shown: raw.shown } : {}), ...(raw.dismissed === true ? { dismissed: true } : {}) };
    } catch {
      return {};
    }
  }

  private write(): void {
    // Written first: if this fails the offer is not shown, so a broken disk can never make it repeat.
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    writeFileSync(this.path, JSON.stringify(this.record), { mode: 0o600 });
  }

  /** Takes the one showing. True once, ever. */
  claim(now = new Date()): boolean {
    if (this.record.shown || this.record.dismissed) return false;
    try {
      this.record = { shown: now.toISOString() };
      this.write();
      return true;
    } catch {
      this.record = {};
      return false;
    }
  }

  /** Whether he has put it away. */
  dismissed(): boolean {
    return this.record.dismissed === true;
  }

  /** He put it away, or linked: it never comes back. */
  dismiss(): void {
    this.record = { ...this.record, dismissed: true };
    try { this.write(); } catch { /* It stays gone for as long as this Core runs. */ }
  }
}
