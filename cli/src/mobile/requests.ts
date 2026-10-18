import { IntelligenceEventStore } from "../intelligence/event-store.js";
import { validateEnvelope } from "../intelligence/context-envelope.js";

export type RequestStatus = "accepted" | "running" | "succeeded" | "unknown";
export interface MobileRequest {
  id: string;
  text: string;
  at: string;
  status: RequestStatus;
  answer?: string;
}
const SOURCE = "mobile.requests";
export const REQUEST_ID = /^[a-zA-Z0-9_-]{16,80}$/;

/** A projection of canonical events. Never replays an interrupted effect. */
export class MobileRequests {
  constructor(private readonly db: IntelligenceEventStore, private readonly source = SOURCE) {}
  list(): MobileRequest[] {
    const state = new Map<string, MobileRequest>();
    for (const event of this.db.readSource(this.source)) {
      if (event.payload && !event.erased) {
        const row = event.payload.request as unknown as MobileRequest;
        if (row) state.set(row.id, row);
      }
    }
    return [...state.values()];
  }
  get(id: string): MobileRequest | undefined { return this.list().find(row => row.id === id); }
  private write(row: MobileRequest): MobileRequest {
    const envelope = {
      pathKind: "interface" as const,
      kind: row.status === "accepted" ? "user_confirmed_intention" as const : "egress_receipt" as const,
      sourceId: this.source,
      consent: { grantedAt: row.at, scopes: [this.source] },
      retentionClass: "local_default" as const, payloadClassification: "personal" as const,
      provenance: "Explicit authenticated mobile request and runtime receipt; receipt is not proof of external delivery",
      correlationId: row.id, idempotencyKey: `${row.id}:${row.status}`,
      payload: { request: row },
    };
    const checked = validateEnvelope(envelope, { consentLookup: this.db });
    if (!checked.ok) throw new Error("Invalid mobile request envelope");
    const saved = this.db.append(envelope);
    if (!saved || saved.erased || !saved.payload) throw new Error("Could not persist mobile request");
    return row;
  }
  accept(id: string, text: string): MobileRequest {
    if (!REQUEST_ID.test(id) || !text.trim() || text.length > 12_000) throw new Error("Invalid request");
    return this.db.transaction(() => {
      if (this.db.isRevoked(this.source)) throw new Error("Mobile source is revoked");
      const original = this.db.findByIdempotencyKey(this.source, `${id}:accepted`);
      if (original?.erased || (original && !original.payload)) throw new Error("Erased request ids cannot be replayed");
      const previous = this.get(id);
      if (previous) {
        if (previous.text !== text.trim()) throw new Error("Request id already used for different text");
        return previous;
      }
      return this.write({ id, text: text.trim(), at: new Date().toISOString(), status: "accepted" });
    });
  }
  settle(id: string, status: Exclude<RequestStatus, "accepted">, answer?: string): MobileRequest {
    return this.db.transaction(() => {
      const row = this.get(id);
      if (!row) throw new Error("Unknown request");
      if (row.status === "succeeded" || row.status === "unknown") return row;
      return this.write({ ...row, status, ...(answer ? { answer } : {}) });
    });
  }
  recover(): void {
    for (const row of this.list()) if (row.status === "running" || row.status === "accepted") {
      this.settle(row.id, "unknown", "Flyd restarted before this request was confirmed. Check any account changes before trying again; it has not been retried.");
    }
  }
}
