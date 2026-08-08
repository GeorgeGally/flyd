import type {
  CandidateEvent,
  AttentionDecision,
  AttentionState,
  Disposition,
  ReasonCode,
  EvidenceRef,
  AuthorityDecision,
  ActionProposal,
  PolicyConfig,
  KillSwitch,
} from "./types.js";

const DEFAULT_POLICY_VERSION = "1.0.0";

const DEFAULT_CONFIG: PolicyConfig = {
  globalProactivityEnabled: true,
  interruptionBudget: "normal",
  dailyInterruptionLimit: 5,
  notifyNowAllowlist: ["deadline_due", "delegation_failed", "delegation_blocked", "explicit_reminder"],
  protectedHours: { startHour: 22, endHour: 7 },
  cooldownsMs: {
    default: 30 * 60 * 1000,
    deadline_due: 15 * 60 * 1000,
    delegation_blocked: 15 * 60 * 1000,
    explicit_reminder: 10 * 60 * 1000,
  },
  scoreWeights: {
    urgency: 0.25,
    consequence: 0.25,
    userRelevance: 0.20,
    novelty: 0.10,
    evidenceQuality: 0.10,
    interruptionCost: -0.25,
    irreversibility: -0.15,
    lowConfidence: -0.10,
  },
  scoreBandThresholds: {
    ignore: { min: 0, max: 0.1 },
    remember: { min: 0.1, max: 0.3 },
    prepare: { min: 0.3, max: 0.5 },
    nextScene: { min: 0.5, max: 0.8 },
    notifyNow: { min: 0.8, max: 1.0 },
  },
  confidenceThresholds: {
    minCandidateConfidence: 0.3,
    minDecisionConfidence: 0.5,
  },
};

export interface PolicyGateResult {
  allowed: boolean;
  reasonCodes: ReasonCode[];
  maxDisposition: Disposition;
}

export class AttentionPolicyEngine {
  private config: PolicyConfig = { ...DEFAULT_CONFIG };
  private killSwitch: KillSwitch = { global: false, sources: new Set(), eventClasses: new Set() };
  private policyVersion = DEFAULT_POLICY_VERSION;
  private cooldowns: Map<string, number> = new Map();
  private interruptionsDeliveredToday = 0;
  private lastDayReset = new Date().toDateString();

  getConfig(): PolicyConfig {
    return { ...this.config };
  }

  updateConfig(patch: Partial<PolicyConfig>): PolicyConfig {
    this.config = { ...this.config, ...patch };
    return this.getConfig();
  }

  getPolicyVersion(): string {
    return this.policyVersion;
  }

  bumpPolicyVersion(change: string): string {
    const parts = this.policyVersion.split(".").map(Number);
    parts[2] = (parts[2] ?? 0) + 1;
    this.policyVersion = parts.join(".");
    return this.policyVersion;
  }

  isKilled(source?: string, eventClass?: string): boolean {
    if (this.killSwitch.global) return true;
    if (source && this.killSwitch.sources.has(source)) return true;
    if (eventClass && this.killSwitch.eventClasses.has(eventClass)) return true;
    return false;
  }

  setKillSwitch(global?: boolean, source?: string, eventClass?: string): void {
    if (global !== undefined) this.killSwitch.global = global;
    if (source) this.killSwitch.sources.add(source);
    if (eventClass) this.killSwitch.eventClasses.add(eventClass);
  }

  releaseKillSwitch(source?: string, eventClass?: string): void {
    if (source) this.killSwitch.sources.delete(source);
    if (eventClass) this.killSwitch.eventClasses.delete(eventClass);
    if (!source && !eventClass) {
      this.killSwitch.global = false;
      this.killSwitch.sources.clear();
      this.killSwitch.eventClasses.clear();
    }
  }

  hardGate(candidate: CandidateEvent): PolicyGateResult {
    const reasonCodes: ReasonCode[] = [];

    if (this.isKilled(undefined, candidate.type)) {
      return { allowed: false, reasonCodes: ["PROACTIVITY_DISABLED"], maxDisposition: "remember" };
    }

    if (!this.config.globalProactivityEnabled) {
      return { allowed: false, reasonCodes: ["PROACTIVITY_DISABLED"], maxDisposition: "remember" };
    }

    if (candidate.evidenceQuality < 0.1) {
      reasonCodes.push("MISSING_PROVENANCE");
      return { allowed: false, reasonCodes, maxDisposition: "remember" };
    }

    if (candidate.status === "expired" || (candidate.expiresAt && new Date(candidate.expiresAt).getTime() < Date.now())) {
      reasonCodes.push("EXPIRED");
      return { allowed: false, reasonCodes, maxDisposition: "ignore" };
    }

    if (candidate.confidence < this.config.confidenceThresholds.minCandidateConfidence) {
      reasonCodes.push("BELOW_CONFIDENCE_THRESHOLD");
      return { allowed: true, reasonCodes, maxDisposition: "remember" };
    }

    const cooldownMs = this.config.cooldownsMs[candidate.suppressionKey] ?? this.config.cooldownsMs.default ?? 30 * 60 * 1000;
    const lastCooldown = this.cooldowns.get(candidate.suppressionKey);
    if (lastCooldown && Date.now() - lastCooldown < cooldownMs) {
      reasonCodes.push("DUPLICATE");
      return { allowed: false, reasonCodes, maxDisposition: "ignore" };
    }

    const now = new Date();
    const hour = now.getHours();
    const inProtectedHours = (hour >= this.config.protectedHours.startHour || hour < this.config.protectedHours.endHour);

    if (inProtectedHours) {
      const isAllowlisted = this.config.notifyNowAllowlist.includes(candidate.type);
      if (!isAllowlisted) {
        return { allowed: true, reasonCodes: ["PROTECTED_PERIOD"], maxDisposition: "next_scene" };
      }
    }

    return { allowed: true, reasonCodes: [], maxDisposition: "notify_now" };
  }

  gateDisposition(desiredDisposition: Disposition, gateResult: PolicyGateResult): Disposition {
    if (!gateResult.allowed) return gateResult.maxDisposition;

    const ranking: Disposition[] = ["ignore", "remember", "prepare", "next_scene", "notify_now", "ask_permission", "act"];
    const desiredIdx = ranking.indexOf(desiredDisposition);
    const maxIdx = ranking.indexOf(gateResult.maxDisposition);

    if (desiredIdx <= maxIdx) return desiredDisposition;
    return gateResult.maxDisposition;
  }

  computePriorityScore(candidate: CandidateEvent): number {
    const w = this.config.scoreWeights;
    const benefit =
      candidate.urgency * (w.urgency ?? 0.25) +
      candidate.consequence * (w.consequence ?? 0.25) +
      candidate.userRelevance * (w.userRelevance ?? 0.20) +
      candidate.novelty * (w.novelty ?? 0.10) +
      candidate.evidenceQuality * (w.evidenceQuality ?? 0.10);

    const risk =
      candidate.interruptionCost * Math.abs(w.interruptionCost ?? -0.25) +
      (1 - candidate.reversibility) * Math.abs(w.irreversibility ?? -0.15) +
      (1 - candidate.confidence) * Math.abs(w.lowConfidence ?? -0.10);

    return Math.max(0, Math.min(1, benefit - risk));
  }

  scoreToDisposition(score: number): Disposition {
    for (const [disposition, band] of Object.entries(this.config.scoreBandThresholds)) {
      if (score >= band.min && score < band.max) {
        switch (disposition) {
          case "ignore": return "ignore";
          case "remember": return "remember";
          case "prepare": return "prepare";
          case "nextScene": return "next_scene";
          case "notifyNow": return "notify_now";
          default: break;
        }
      }
    }
    return "next_scene";
  }

  recordCooldown(suppressionKey: string): void {
    this.cooldowns.set(suppressionKey, Date.now());
  }

  recordInterruption(): void {
    this.resetDailyIfNeeded();
    this.interruptionsDeliveredToday++;
  }

  getRemainingInterruptionBudget(): number {
    this.resetDailyIfNeeded();
    if (this.config.interruptionBudget === "none") return 0;
    if (this.config.interruptionBudget === "critical_only") return 1;
    return Math.max(0, this.config.dailyInterruptionLimit - this.interruptionsDeliveredToday);
  }

  canInterrupt(): boolean {
    this.resetDailyIfNeeded();
    return this.getRemainingInterruptionBudget() > 0;
  }

  evaluateAuthority(
    _candidate: CandidateEvent,
    _proposedAction?: ActionProposal,
    allowed: Disposition[] = ["ignore", "remember", "prepare", "next_scene", "notify_now"],
  ): AuthorityDecision {
    return {
      actionType: _proposedAction?.kind ?? "unknown",
      allowed: allowed.includes("act"),
      scope: [],
      conditions: [],
      reason: "authority_evaluation_not_implemented",
    };
  }

  buildDecision(
    candidate: CandidateEvent,
    score: number,
    disposition: Disposition,
    gateResult: PolicyGateResult,
    evidence: EvidenceRef[] = [],
    confidence = 0.5,
  ): AttentionDecision {
    const gatedDisposition = this.gateDisposition(disposition, gateResult);
    const reasonCodes = [...gateResult.reasonCodes];

    if (gatedDisposition === "ignore") reasonCodes.push("LOW_PRIORITY");
    if (candidate.confidence < 0.5) reasonCodes.push("LOW_CONFIDENCE");

    return {
      candidateId: candidate.id,
      disposition: gatedDisposition,
      reasonCodes,
      evidence,
      confidence,
      policyVersion: this.policyVersion,
      decidedAt: new Date().toISOString(),
    };
  }

  private resetDailyIfNeeded(): void {
    const today = new Date().toDateString();
    if (today !== this.lastDayReset) {
      this.lastDayReset = today;
      this.interruptionsDeliveredToday = 0;
    }
  }
}

export const attentionPolicyEngine = new AttentionPolicyEngine();
