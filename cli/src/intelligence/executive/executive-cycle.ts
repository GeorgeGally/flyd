import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type { IntelligenceEventStore } from "../event-store.js";

/**
 * Durable executive cycle (flyd-personal-intelligence-prd.md §5, plan U6).
 *
 * Consumes opportunities derived from projected state under a lease, ranks
 * them, and persists a decision to remain silent, bundle, notify, propose,
 * or act — always with a concise why-now / why-me trace. Delivery surfaces
 * (daily brief, notifications) consume the decision queue; they never own
 * intelligence.
 *
 * ponytail: executive bookkeeping (leases, budgets, kill switch) is a JSON
 * file beside the other ~/.flyd stores; decisions themselves live on the
 * event spine with digest-keyed idempotency, so restarts resume without
 * duplicate interruptions by construction.
 */

export type ExecutiveAction = "silent" | "bundle" | "notify" | "propose" | "act";

export interface Opportunity {
  /** Stable semantic key (e.g. "calendar.conflict.flight"). */
  key: string;
  /** Expected benefit, 0..1. */
  benefit: number;
  /** Time pressure, 0..1. */
  urgency: number;
  /** Evidence confidence, 0..1. */
  confidence: number;
  /** Interruption cost, 0..1. */
  interruptionCost: number;
  whyNow: string;
  whyMe: string;
}

export interface DecisionRecord {
  opportunityKey: string;
  digest: string;
  action: ExecutiveAction;
  reason: string;
  whyNow: string;
  whyMe: string;
  score: number;
  decidedAt: string;
}

export interface ExecutiveConfig {
  policyVersion: string;
  /** Minutes-of-day window during which delivery is suppressed, e.g. [0, 420]. */
  quietHours?: [number, number];
  /** Minimum minutes between interrupting decisions. */
  cooldownMinutes: number;
  /** Max interrupting (notify/propose/act) decisions per day. */
  dailyInterruptionBudget: number;
}

const DEFAULT_CONFIG: ExecutiveConfig = {
  policyVersion: "v0",
  cooldownMinutes: 45,
  dailyInterruptionBudget: 3,
};

interface ExecutiveStateFile {
  killed: boolean;
  pausedUntil?: string;
  lease?: { holder: string; expiresAt: string };
  lastInterruptedAt?: string;
  budgetDay?: string;
  budgetUsed?: number;
  decidedDigests?: Record<string, { action: ExecutiveAction; at: string }>;
}

function defaultState(): ExecutiveStateFile {
  return { killed: false, decidedDigests: {} };
}

export function opportunityDigest(key: string, worldStateDigest: string, policyVersion: string): string {
  return createHash("sha256").update(`${key}|${worldStateDigest}|${policyVersion}`).digest("hex");
}

export class ExecutiveCycle {
  private readonly store: IntelligenceEventStore;
  private readonly config: ExecutiveConfig;
  private readonly statePath: string;

  constructor(options: { store: IntelligenceEventStore; config?: Partial<ExecutiveConfig>; statePath?: string }) {
    this.store = options.store;
    this.config = { ...DEFAULT_CONFIG, ...options.config };
    this.statePath = options.statePath ?? join(
      process.env.FLYD_DIR?.trim() || join(homedir(), ".flyd"),
      "intelligence",
      "executive-state.json",
    );
  }

  // -- control plane --------------------------------------------------------

  killSwitch(on: boolean): void {
    const state = this.load();
    state.killed = on;
    this.persist(state);
  }

  pause(until: Date): void {
    const state = this.load();
    state.pausedUntil = until.toISOString();
    this.persist(state);
  }

  isPaused(now = new Date()): boolean {
    const state = this.load();
    return !!state.pausedUntil && Date.parse(state.pausedUntil) > now.getTime();
  }

  get killed(): boolean {
    return this.load().killed;
  }

  /**
   * Lease prevents concurrent cycles from double-interrupting. Expired
   * leases are taken over; a healthy lease makes consider() a no-op.
   */
  acquireLease(holder: string, ttlMs = 60_000, now = new Date()): boolean {
    const state = this.load();
    if (state.lease && Date.parse(state.lease.expiresAt) > now.getTime() && state.lease.holder !== holder) {
      return false;
    }
    state.lease = { holder, expiresAt: new Date(now.getTime() + ttlMs).toISOString() };
    this.persist(state);
    return true;
  }

  releaseLease(holder: string): void {
    const state = this.load();
    if (state.lease?.holder === holder) {
      delete state.lease;
      this.persist(state);
    }
  }

  // -- the cycle ------------------------------------------------------------

  /**
   * Evaluate one batch of opportunities against current context. Idempotent
   * per digest: a repeated consideration returns the recorded decision and
   * appends nothing new. Interrupting decisions become spine events.
   */
  consider(opportunities: Opportunity[], worldStateDigest: string, now = new Date()): DecisionRecord[] {
    const state = this.load();

    if (!this.acquireLease("cycle", 60_000, now)) {
      return [];
    }
    try {
      this.rollBudgetIfNeeded(state, now);

      const ranked = opportunities
        .map((o) => ({ ...o, score: o.benefit * o.confidence - o.interruptionCost }))
        .sort((a, b) => b.score - a.score || b.urgency - a.urgency);

      const decisions: DecisionRecord[] = [];
      let interruptedAt: number | undefined = state.lastInterruptedAt ? Date.parse(state.lastInterruptedAt) : undefined;
      let used = state.budgetUsed ?? 0;

      for (const opportunity of ranked) {
        const digest = opportunityDigest(opportunity.key, worldStateDigest, this.config.policyVersion);
        const prior = state.decidedDigests?.[digest];
        if (prior) {
          decisions.push(this.record(opportunity, digest, prior.action, "already_decided", now));
          continue;
        }

        let action: ExecutiveAction;
        let reason: string;

        if (state.killed) {
          action = "silent";
          reason = "kill_switch";
        } else if (this.isPaused(now)) {
          action = "silent";
          reason = "paused";
        } else if (this.inQuietHours(now)) {
          action = "silent";
          reason = "quiet_hours";
        } else if (interruptedAt !== undefined && now.getTime() - interruptedAt < this.config.cooldownMinutes * 60_000) {
          action = "bundle";
          reason = "cooldown";
        } else if (used >= this.config.dailyInterruptionBudget) {
          action = "silent";
          reason = "interruption_budget_exhausted";
        } else {
          action = opportunity.confidence >= 0.6 ? "propose" : "notify";
          reason = "ranked_opportunity";
          used += 1;
          interruptedAt = now.getTime();
        }

        decisions.push(this.record(opportunity, digest, action, reason, now));
        state.decidedDigests = { ...(state.decidedDigests ?? {}), [digest]: { action, at: now.toISOString() } };

        if (action === "notify" || action === "propose") {
          this.appendDecisionEvent(digest, opportunity, action, reason, now);
        }
      }

      state.lastInterruptedAt = interruptedAt !== undefined ? new Date(interruptedAt).toISOString() : state.lastInterruptedAt;
      state.budgetUsed = used;
      this.persist(state);
      return decisions;
    } finally {
      this.releaseLease("cycle");
    }
  }

  /** Undelivered interrupting decisions, newest first — the delivery queue. */
  pendingInterventions(): Array<DecisionRecord & { eventId: string }> {
    const out: Array<DecisionRecord & { eventId: string }> = [];
    for (const event of this.store.readFrom(0)) {
      if (event.kind !== "executive_decision" || !event.payload) continue;
      const p = event.payload as Record<string, unknown>;
      const action = p.action as ExecutiveAction;
      if (action === "silent" || action === "bundle") continue;
      out.push({
        opportunityKey: String(p.opportunity_key),
        digest: String(p.digest),
        action,
        reason: String(p.reason),
        whyNow: String(p.why_now),
        whyMe: String(p.why_me),
        score: Number(p.score),
        decidedAt: event.capturedAt,
        eventId: event.id,
      });
    }
    return out.reverse();
  }

  private record(opportunity: Opportunity, digest: string, action: ExecutiveAction, reason: string, now: Date): DecisionRecord {
    return {
      opportunityKey: opportunity.key,
      digest,
      action,
      reason,
      whyNow: opportunity.whyNow,
      whyMe: opportunity.whyMe,
      score: Number((opportunity.benefit * opportunity.confidence - opportunity.interruptionCost).toFixed(4)),
      decidedAt: now.toISOString(),
    };
  }

  private appendDecisionEvent(digest: string, opportunity: Opportunity, action: ExecutiveAction, reason: string, now: Date): void {
    this.store.append({
      pathKind: "executive",
      kind: "executive_decision",
      sourceId: "executive.cycle",
      consent: { grantedAt: now.toISOString(), scopes: ["executive"] },
      retentionClass: "local_default",
      payloadClassification: "operational",
      provenance: `executive:${this.config.policyVersion}`,
      idempotencyKey: `exec:${digest}`,
      payload: {
        opportunity_key: opportunity.key,
        digest,
        action,
        reason,
        why_now: opportunity.whyNow,
        why_me: opportunity.whyMe,
        score: opportunity.benefit * opportunity.confidence - opportunity.interruptionCost,
      },
    });
  }

  private inQuietHours(now: Date): boolean {
    if (!this.config.quietHours) return false;
    // UTC minute-of-day keeps behavior deterministic across machines.
    const minuteOfDay = now.getUTCHours() * 60 + now.getUTCMinutes();
    const [start, end] = this.config.quietHours;
    return start <= end ? minuteOfDay >= start && minuteOfDay < end : minuteOfDay >= start || minuteOfDay < end;
  }

  private rollBudgetIfNeeded(state: ExecutiveStateFile, now: Date): void {
    const day = now.toISOString().slice(0, 10);
    if (state.budgetDay !== day) {
      state.budgetDay = day;
      state.budgetUsed = 0;
    }
  }

  private load(): ExecutiveStateFile {
    if (!existsSync(this.statePath)) return defaultState();
    try {
      return { ...defaultState(), ...(JSON.parse(readFileSync(this.statePath, "utf8")) as ExecutiveStateFile) };
    } catch {
      return defaultState();
    }
  }

  private persist(state: ExecutiveStateFile): void {
    mkdirSync(dirname(this.statePath), { recursive: true, mode: 0o700 });
    writeFileSync(this.statePath, JSON.stringify(state, null, 2), { encoding: "utf8", mode: 0o600 });
  }
}
