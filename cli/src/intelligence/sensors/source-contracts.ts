import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type { RetentionClass } from "../context-envelope.js";

/**
 * LEARN source contracts (flyd-personal-intelligence-prd.md §3.2, plan U5).
 *
 * Each LEARN source has one explicit contract covering purpose, sensitivity,
 * retention, egress, and controls. Nothing may emit a personal event without
 * an enabled contract. OS permission never substitutes for consent.
 *
 * ponytail: file-backed JSON beside the other ~/.flyd stores — inspectable,
 * diffable, and trivially erasable; moves into the spine if volume demands.
 */

export type SourceStatus = "disabled" | "enabled" | "paused" | "revoked";
export type SourceSensitivity = "low" | "medium" | "high";

export interface SourceContract {
  sourceId: string;
  displayName: string;
  sensitivity: SourceSensitivity;
  /** Consent scopes this source grants to captured data. */
  scopes: string[];
  retentionClass: RetentionClass;
  /** Days raw/derived values from this source are kept. */
  retentionDays?: number;
  /** Destinations data may leave for. Empty array = local-only by design. */
  egressDestinations: string[];
  /** Human-readable purpose line shown in privacy UI. */
  purpose: string;
}

export interface SourceConsentState {
  status: SourceStatus;
  changedAt: string;
}

const DEFAULT_SENSITIVE_SOURCES: ReadonlySet<string> = new Set([
  "screen.raw_text",
  "clipboard",
  "microphone.content",
  "communications",
  "location",
  "health",
  "finance",
]);

/** The U5 launch proof: exactly one low-sensitivity, non-work source. */
export const CALENDAR_METADATA_CONTRACT: SourceContract = {
  sourceId: "calendar.metadata",
  displayName: "Calendar metadata",
  sensitivity: "low",
  scopes: ["calendar.metadata"],
  retentionClass: "local_default",
  retentionDays: 90,
  egressDestinations: [],
  purpose: "Ground daily briefings and scheduling awareness in event times, not content.",
};

export class SourceContractRegistry {
  private readonly contracts = new Map<string, SourceContract>();
  private readonly states = new Map<string, SourceConsentState>();
  private readonly path: string;

  constructor(options: { path?: string } = {}) {
    this.path = options.path ?? join(
      process.env.FLYD_DIR?.trim() || join(homedir(), ".flyd"),
      "intelligence",
      "source-consents.json",
    );
    this.load();
  }

  /** High-sensitivity sources cannot be registered as LEARN sources at all. */
  register(contract: SourceContract): void {
    if (DEFAULT_SENSITIVE_SOURCES.has(contract.sourceId) || contract.sensitivity === "high") {
      throw new Error(`Refusing to register high-sensitivity LEARN source: ${contract.sourceId}`);
    }
    // The PRESENT complaint transport keeps its separate bounded contract —
    // it must never become a LEARN source (PRD §3.1, plan U5).
    if (contract.sourceId.startsWith("present.")) {
      throw new Error(`Refusing to register a PRESENT path as a LEARN source: ${contract.sourceId}`);
    }
    this.contracts.set(contract.sourceId, contract);
    if (!this.states.has(contract.sourceId)) {
      this.states.set(contract.sourceId, { status: "disabled", changedAt: new Date().toISOString() });
    }
    this.persist();
  }

  contract(sourceId: string): SourceContract | undefined {
    return this.contracts.get(sourceId);
  }

  status(sourceId: string): SourceStatus | undefined {
    return this.states.get(sourceId)?.status;
  }

  setStatus(sourceId: string, status: SourceStatus): void {
    const current = this.states.get(sourceId);
    if (!current) throw new Error(`No LEARN source contract for ${sourceId}`);
    // Revocation is terminal until the contract is re-registered fresh.
    if (current.status === "revoked" && status !== "revoked") {
      throw new Error(`Source ${sourceId} was revoked; re-registration required`);
    }
    this.states.set(sourceId, { status, changedAt: new Date().toISOString() });
    this.persist();
  }

  list(): Array<{ contract: SourceContract; state: SourceConsentState }> {
    return [...this.contracts.entries()]
      .map(([sourceId, contract]) => ({ contract, state: this.states.get(sourceId)! }))
      .sort((a, b) => a.contract.sourceId.localeCompare(b.contract.sourceId));
  }

  private load(): void {
    if (!existsSync(this.path)) return;
    try {
      const parsed = JSON.parse(readFileSync(this.path, "utf8")) as {
        contracts?: SourceContract[];
        states?: Record<string, SourceConsentState>;
      };
      for (const contract of parsed.contracts ?? []) {
        if (!(DEFAULT_SENSITIVE_SOURCES.has(contract.sourceId) || contract.sensitivity === "high")) {
          this.contracts.set(contract.sourceId, contract);
        }
      }
      for (const [id, state] of Object.entries(parsed.states ?? {})) {
        if (this.contracts.has(id)) this.states.set(id, state);
      }
    } catch {
      // corrupted consent file fails closed: nothing is enabled
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    writeFileSync(
      this.path,
      JSON.stringify(
        {
          contracts: [...this.contracts.values()],
          states: Object.fromEntries(this.states.entries()),
        },
        null,
        2,
      ),
      { encoding: "utf8", mode: 0o600 },
    );
  }
}
