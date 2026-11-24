import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { RetentionClass } from "../context-envelope.js";
import { withFileLock, writeJsonFile } from "../../command/store.js";

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
  /** When true, registration enables the source instead of the disabled default. */
  enabledByDefault?: boolean;
}

export interface SourceConsentState {
  status: SourceStatus;
  changedAt: string;
  /** Distinguishes a default registration from an explicit source-control choice. */
  explicitlyConfigured?: boolean;
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

/**
 * Consequence-learning transition sources (transition-log plan U1/D1).
 * Low sensitivity, local retention, enabled by default and revocable like
 * every other LEARN source.
 */
/** Optional personal care: event title is more sensitive than time-only metadata.
 * Existing calendar.metadata consent does not authorize reading titles.
 */
export const MEETING_PREP_CONTRACT: SourceContract = {
  sourceId: "calendar.meeting-prep",
  displayName: "Upcoming Calendar meeting titles and times",
  sensitivity: "medium",
  scopes: ["calendar.meeting-prep"],
  retentionClass: "local_default",
  egressDestinations: [],
  purpose: "Locally match upcoming meeting titles and start times with confirmed People memory for quiet preparation; never read attendees, notes, location or email.",
};

export const TRANSITION_OVERLAY_CONTRACT: SourceContract = {
  sourceId: "transition.overlay",
  displayName: "Overlay transitions",
  sensitivity: "low",
  scopes: ["transition.overlay"],
  retentionClass: "local_default",
  retentionDays: 90,
  egressDestinations: [],
  purpose: "Record invocation actions and their outcomes so Flyd learns what worked.",
  enabledByDefault: true,
};

export const TRANSITION_CLI_CHAT_CONTRACT: SourceContract = {
  sourceId: "transition.cli-chat",
  displayName: "CLI chat transitions",
  sensitivity: "low",
  scopes: ["transition.cli-chat"],
  retentionClass: "local_default",
  retentionDays: 90,
  egressDestinations: [],
  purpose: "Record CLI chat turns and their outcomes so Flyd learns what worked.",
  enabledByDefault: true,
};

export const TRANSITION_HARNESS_CONTRACT: SourceContract = {
  sourceId: "transition.harness",
  displayName: "Harness verification verdicts",
  sensitivity: "low",
  scopes: ["transition.harness"],
  retentionClass: "local_default",
  retentionDays: 90,
  egressDestinations: [],
  purpose: "Record deterministic worker verification verdicts as outcome signals.",
  enabledByDefault: true,
};

export const TRANSITION_JUDGE_CONTRACT: SourceContract = {
  sourceId: "transition.judge",
  displayName: "Transition judge",
  sensitivity: "low",
  scopes: ["transition.judge"],
  retentionClass: "local_default",
  retentionDays: 90,
  egressDestinations: [],
  purpose: "Record background evaluative judgments of ambiguous transitions.",
  enabledByDefault: true,
};

/**
 * Separate opt-in to generalizing explicit outcome ratings. A review can
 * appear on the user's screen without this grant. Only an explicit user
 * enablement may pass aggregated negative patterns to the configured
 * improvement model; no personal source text is forwarded.
 */
export const OUTCOME_REVIEW_LEARNING_CONTRACT: SourceContract = {
  sourceId: "learning.outcome-reviews",
  displayName: "Learn from my outcome ratings",
  sensitivity: "low",
  scopes: ["explicit.outcome-review.learning"],
  retentionClass: "local_default",
  retentionDays: 90,
  egressDestinations: ["configured.improvement.model"],
  purpose: "Summarize repeated explicit usefulness feedback on independently verified work for human-gated Flyd improvements; never auto-activate policies.",
  enabledByDefault: false,
};

/** Independent initiative is a separate local LEARN purpose. It is not
 * authorization to read additional accounts or transmit private context.
 * Explicit source consent is required before creating derived hypotheses.
 */
export const INITIATIVE_CURATED_CONTRACT: SourceContract = {
  sourceId: "initiative.curated",
  displayName: "Local initiative from already-curated work",
  sensitivity: "medium",
  scopes: ["initiative.curated"],
  retentionClass: "local_default",
  retentionDays: 30,
  egressDestinations: [],
  purpose: "Find and privately record evidence-backed opportunities across the already-curated project, Scout, Council and CoS records. No extra sensing, external model egress or automatic external actions.",
  enabledByDefault: false,
};

/**
 * Public-only, background research is a separate, renewable opt-in.
 * The destination is the evidence engine's public retrieval path; it never
 * authorizes transmitting local project facts, private repos or chat text.
 */
export const INITIATIVE_PUBLIC_RESEARCH_CONTRACT: SourceContract = {
  sourceId: "initiative.public-research",
  displayName: "Background research into public references",
  sensitivity: "low",
  scopes: ["initiative.public-research"],
  retentionClass: "local_default",
  retentionDays: 30,
  egressDestinations: ["evidence:public"],
  purpose: "Bounded public-source lookup from already-public Scout material only; compare with private work locally.",
  enabledByDefault: false,
};

/** A separate, explicit user-authored, short-lived delegation remit.
 * This is NEVER inferred from user interests or the public-research opt-in.
 */
/** Optional quick-model interpretation of public reference snippets ONLY.
 * No private project context, accounts, repo paths or personal memories.
 */
export const INITIATIVE_PUBLIC_SYNTHESIS_CONTRACT: SourceContract = {
  sourceId: "initiative.public-synthesis",
  displayName: "Public-source hypothesis synthesis",
  sensitivity: "low",
  scopes: ["initiative.public-synthesis"],
  retentionClass: "local_default",
  retentionDays: 30,
  egressDestinations: ["configured.quick.model"],
  purpose: "One bounded optional interpretation of already public source evidence; private project comparison remains entirely local.",
  enabledByDefault: false,
};

export const INITIATIVE_MANDATE_CONTRACT: SourceContract = {
  sourceId: "initiative.mandate",
  displayName: "Authorized read-only initiative follow-through",
  sensitivity: "medium",
  scopes: ["initiative.read-only-mandate"],
  retentionClass: "local_default",
  retentionDays: 30,
  egressDestinations: [],
  purpose: "Preserve explicitly granted, expiring, project-bound permission for read-only research follow-through; not repo edits, external messages, purchases or publishing.",
  enabledByDefault: false,
};

export const EXPERIENCE_RUNTIME_CONTRACT: SourceContract = {
  sourceId: "experience.runtime",
  displayName: "Runtime experience traces",
  sensitivity: "low",
  scopes: ["experience.runtime"],
  retentionClass: "local_default",
  retentionDays: 90,
  egressDestinations: [],
  purpose: "Record compact execution traces and explicit corrections for governed self-improvement.",
  enabledByDefault: true,
};

export const TRANSITION_SOURCE_CONTRACTS: readonly SourceContract[] = [
  TRANSITION_OVERLAY_CONTRACT,
  TRANSITION_CLI_CHAT_CONTRACT,
  TRANSITION_HARNESS_CONTRACT,
  TRANSITION_JUDGE_CONTRACT,
];

export class SourceContractRegistry {
  private readonly contracts = new Map<string, SourceContract>();
  private readonly states = new Map<string, SourceConsentState>();
  private readonly path: string;
  /** A damaged consent file can never restore opt-in or default-on grants. */
  private damaged = false;

  constructor(options: { path?: string } = {}) {
    this.path = options.path ?? join(
      process.env.FLYD_DIR?.trim() || join(homedir(), ".flyd"),
      "intelligence",
      "source-consents.json",
    );
    this.load();
  }

  /** High-sensitivity sources and PRESENT may never enter LEARN. */
  register(contract: SourceContract): void {
    if (DEFAULT_SENSITIVE_SOURCES.has(contract.sourceId) || contract.sensitivity === "high") {
      throw new Error(`Refusing to register high-sensitivity LEARN source: ${contract.sourceId}`);
    }
    if (contract.sourceId.startsWith("present.")) {
      throw new Error(`Refusing to register a PRESENT path as a LEARN source: ${contract.sourceId}`);
    }
    this.update(() => {
      this.contracts.set(contract.sourceId, contract);
      if (!this.states.has(contract.sourceId)) {
        // Corrupt consent must not silently recover an enabled-by-default source.
        this.states.set(contract.sourceId, {
          status: this.damaged ? "disabled" : contract.enabledByDefault ? "enabled" : "disabled",
          changedAt: new Date().toISOString(),
        });
      }
    });
  }

  contract(sourceId: string): SourceContract | undefined {
    this.load();
    return this.contracts.get(sourceId);
  }

  /** Reload on every read so a different Core/CLI process can revoke in-flight work. */
  status(sourceId: string): SourceStatus | undefined {
    this.load();
    return this.states.get(sourceId)?.status;
  }

  setStatus(sourceId: string, status: SourceStatus): void {
    this.update(() => {
      const current = this.states.get(sourceId);
      if (!current) throw new Error(`No LEARN source contract for ${sourceId}`);
      if (current.status === "revoked" && status !== "revoked") {
        throw new Error(`Source ${sourceId} was revoked; re-registration required`);
      }
      this.states.set(sourceId, { status, changedAt: new Date().toISOString(), explicitlyConfigured: true });
    });
  }

  /** Starts a fresh, disabled generation for a revoked source; old events remain erased. */
  renew(sourceId: string): void {
    this.update(() => {
      if (this.states.get(sourceId)?.status !== "revoked") {
        throw new Error(`Source ${sourceId} is not revoked`);
      }
      this.states.set(sourceId, {
        status: "disabled", changedAt: new Date().toISOString(), explicitlyConfigured: true,
      });
    });
  }

  list(): Array<{ contract: SourceContract; state: SourceConsentState }> {
    this.load();
    return [...this.contracts.entries()]
      .filter(([sourceId]) => this.states.has(sourceId))
      .map(([sourceId, contract]) => ({ contract, state: this.states.get(sourceId)! }))
      .sort((a, b) => a.contract.sourceId.localeCompare(b.contract.sourceId));
  }

  /** Every mutation merges with the current persisted state under ONE file lock. */
  private update(work: () => void): void {
    withFileLock(this.path, () => {
      this.load();
      work();
      writeJsonFile(this.path, {
        contracts: [...this.contracts.values()],
        states: Object.fromEntries(this.states.entries()),
      });
      this.damaged = false;
    });
  }

  private load(): void {
    this.contracts.clear();
    this.states.clear();
    this.damaged = false;
    if (!existsSync(this.path)) return;
    try {
      const parsed = JSON.parse(readFileSync(this.path, "utf8")) as {
        contracts?: SourceContract[];
        states?: Record<string, SourceConsentState>;
      };
      if (!parsed || !Array.isArray(parsed.contracts) || !parsed.states
        || typeof parsed.states !== "object" || Array.isArray(parsed.states)) {
        throw new Error("Invalid consent file");
      }
      for (const contract of parsed.contracts) {
        if (!contract || typeof contract.sourceId !== "string"
          || typeof contract.sensitivity !== "string"
          || DEFAULT_SENSITIVE_SOURCES.has(contract.sourceId)
          || contract.sensitivity === "high" || contract.sourceId.startsWith("present.")) continue;
        this.contracts.set(contract.sourceId, contract);
      }
      for (const [id, state] of Object.entries(parsed.states)) {
        if (!this.contracts.has(id) || !state
          || !["enabled", "disabled", "paused", "revoked"].includes(state.status)
          || typeof state.changedAt !== "string"
          || !Number.isFinite(Date.parse(state.changedAt))) continue;
        this.states.set(id, state);
      }
    } catch {
      // A corrupt or partially replaced consent file removes ALL grants.
      this.contracts.clear();
      this.states.clear();
      this.damaged = true;
    }
  }
}
