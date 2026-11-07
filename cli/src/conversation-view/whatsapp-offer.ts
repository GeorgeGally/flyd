import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { FLYD_DIR } from "../lib/config.js";

/**
 * The WhatsApp card stays in the side column until he finishes with it. Done is
 * for good: the record outlives Core, so nothing brings the card back. Linking
 * is always there under People.
 */

interface OfferRecord {
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
      return (JSON.parse(readFileSync(this.path, "utf8")) as { dismissed?: unknown }).dismissed === true ? { dismissed: true } : {};
    } catch {
      return {};
    }
  }

  private write(): void {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    writeFileSync(this.path, JSON.stringify(this.record), { mode: 0o600 });
  }

  /** Whether he is done with it. */
  dismissed(): boolean {
    return this.record.dismissed === true;
  }

  /** He said Done, or linked: it never comes back. */
  dismiss(): void {
    this.record = { dismissed: true };
    try { this.write(); } catch { /* It stays gone for as long as this Core runs. */ }
  }
}
