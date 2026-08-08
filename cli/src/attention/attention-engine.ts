import { signalBus } from "./signal-bus.js";
import { candidateBuilder } from "./candidate-builder.js";
import { attentionPolicyEngine } from "./attention-policy-engine.js";
import { attentionJudge } from "./attention-judge.js";
import { attentionDispatcher } from "./attention-dispatcher.js";
import { outcomeRecorder } from "./outcome-recorder.js";
import { commitmentStore } from "./commitment-store.js";
import type {
  Signal,
  CandidateEvent,
  AttentionDecision,
  EngineTickReport,
  EngineMetrics,
  Disposition,
  AttentionState,
  EntityRef,
  OutcomeEvent,
} from "./types.js";

export interface EngineConfig {
  shadowMode: boolean;
  logDecisions: boolean;
  autoExpireMs: number;
}

const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  shadowMode: true,
  logDecisions: true,
  autoExpireMs: 24 * 60 * 60 * 1000,
};

export class AttentionEngine {
  private config: EngineConfig = { ...DEFAULT_ENGINE_CONFIG };
  private running = false;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private decisionLog: AttentionDecision[] = [];
  private metrics: EngineMetrics = {
    candidatesCreated: 0,
    candidatesDeduplicated: 0,
    surfacesGenerated: 0,
    interruptionsDelivered: 0,
    interruptionsBudgetRemaining: 0,
    actionsAuthorized: 0,
    actionsRejected: 0,
    policyVersions: 1,
  };
  private tickSubscribers: Array<(report: EngineTickReport) => void> = [];
  private unsubscribeSignalBus: (() => void) | null = null;

  constructor() {
    attentionDispatcher.onRemember((decision, candidate) => {
      if (this.config.logDecisions) {
        console.log(`[AttentionEngine] Remember: ${candidate.subject.label} (${decision.reasonCodes.join(", ")})`);
      }
    });

    outcomeRecorder.onOutcome((outcome: OutcomeEvent) => {
      const candidate = candidateBuilder.getCandidate(outcome.candidateId);
      if (candidate) {
        signalBus.emitFromOutcome(outcome, candidate.subject);
      }
    });
  }

  start(config?: Partial<EngineConfig>, tickIntervalMs = 5000): void {
    if (this.running) return;
    if (config) {
      this.config = { ...this.config, ...config };
    }
    this.running = true;

    this.unsubscribeSignalBus = signalBus.subscribe((signal) => {
      this.handleSignal(signal);
    });

    this.tickTimer = setInterval(() => {
      this.tick();
    }, tickIntervalMs);
    if (this.tickTimer && typeof this.tickTimer.unref === "function") {
      this.tickTimer.unref();
    }

    console.log(`[AttentionEngine] Started (shadow=${this.config.shadowMode})`);
  }

  stop(): void {
    this.running = false;
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    if (this.unsubscribeSignalBus) {
      this.unsubscribeSignalBus();
      this.unsubscribeSignalBus = null;
    }
    console.log("[AttentionEngine] Stopped");
  }

  isRunning(): boolean {
    return this.running;
  }

  private handleSignal(signal: Signal): void {
    const candidate = candidateBuilder.ingestSignal(signal);
    if (candidate) {
      this.metrics.candidatesCreated++;
    }
  }

  async tick(): Promise<EngineTickReport> {
    const now = new Date().toISOString();
    candidateBuilder.expireSuppressed();

    const pending = candidateBuilder.getPendingCandidates();
    const decisions: AttentionDecision[] = [];
    const dispatched: Record<string, import("./types.js").DispatchResult> = {};

    for (const candidate of pending) {
      candidateBuilder.updateStatus(candidate.id, "evaluating");

      const gateResult = attentionPolicyEngine.hardGate(candidate);
      if (!gateResult.allowed && gateResult.maxDisposition === "ignore") {
        candidateBuilder.updateStatus(candidate.id, "suppressed");
        attentionPolicyEngine.recordCooldown(candidate.suppressionKey);
        this.metrics.candidatesDeduplicated++;
        continue;
      }

      const score = attentionPolicyEngine.computePriorityScore(candidate);
      const deterministicDisposition = attentionPolicyEngine.scoreToDisposition(score);

      const maxDisposition = gateResult.allowed
        ? deterministicDisposition
        : gateResult.maxDisposition;

      const allowedDispositions = this.getAllowedDispositions(maxDisposition);

      const decision = await attentionJudge.evaluate({
        candidate,
        relatedCommitments: candidate.commitmentId
          ? [commitmentStore.get(candidate.commitmentId)].filter(Boolean) as import("./types.js").Commitment[]
          : [],
        attentionState: this.getCurrentAttentionState(),
        allowedDispositions,
        policyConstraints: {
          maxDisposition: gateResult.maxDisposition,
          reasonCodes: gateResult.reasonCodes,
        },
        deterministicScore: score,
        deterministicDisposition,
      });

      decision.confidence = Math.max(0.1, Math.min(1, decision.confidence));

      if (decision.disposition === "ignore" || decision.disposition === "remember") {
        candidateBuilder.updateStatus(candidate.id, "resolved");
      } else if (decision.disposition === "notify_now") {
        if (attentionPolicyEngine.canInterrupt()) {
          attentionPolicyEngine.recordInterruption();
          this.metrics.interruptionsDelivered++;
        } else {
          decision.disposition = "next_scene";
        }
      }

      decisions.push(decision);

      const result = attentionDispatcher.dispatch(decision, candidate);
      dispatched[decision.candidateId] = result;

      if (decision.disposition === "next_scene" || decision.disposition === "notify_now") {
        this.metrics.surfacesGenerated++;
        candidateBuilder.updateStatus(candidate.id, "surfaced");
      } else if (decision.disposition === "prepare") {
        candidateBuilder.updateStatus(candidate.id, "deferred");
      }
    }

    this.decisionLog.push(...decisions);
    if (this.decisionLog.length > 1000) {
      this.decisionLog = this.decisionLog.slice(-1000);
    }

    this.metrics.interruptionsBudgetRemaining = attentionPolicyEngine.getRemainingInterruptionBudget();

    const report: EngineTickReport = {
      tickAt: now,
      signalsReceived: signalBus.getHistory(10000).length,
      candidatesCreated: this.metrics.candidatesCreated,
      candidatesDeduplicated: this.metrics.candidatesDeduplicated,
      candidatesEvaluated: decisions.length,
      decisions,
      dispatched,
      prepared: [],
      attentionState: this.getCurrentAttentionState(),
      metrics: { ...this.metrics },
    };

    for (const sub of this.tickSubscribers) {
      try { sub(report); } catch { /* ok */ }
    }

    return report;
  }

  private getAllowedDispositions(maxDisposition: Disposition): Disposition[] {
    const all: Disposition[] = ["ignore", "remember", "prepare", "next_scene", "notify_now", "ask_permission", "act"];
    const maxIdx = all.indexOf(maxDisposition);
    return all.slice(0, maxIdx + 1);
  }

  private getCurrentAttentionState(): AttentionState {
    return {
      interactionMode: "active",
      interruptionBudget: attentionPolicyEngine.getConfig().interruptionBudget ?? "normal",
    };
  }

  get isShadowMode(): boolean {
    return this.config.shadowMode;
  }

  setShadowMode(enabled: boolean): void {
    this.config.shadowMode = enabled;
    console.log(`[AttentionEngine] Shadow mode ${enabled ? "enabled" : "disabled"}`);
  }

  getDecisionLog(): AttentionDecision[] {
    return [...this.decisionLog];
  }

  getMetrics(): EngineMetrics {
    return { ...this.metrics };
  }

  getSceneClaims(): import("./types.js").SceneClaim[] {
    return attentionDispatcher.getSceneClaims();
  }

  recordOutcome(
    candidateId: string,
    kind: import("./types.js").OutcomeKind,
    params?: {
      correctionText?: string;
      correctionKind?: "irrelevant" | "wrong_time" | "wrong_fact" | "never_this";
      resultSummary?: string;
    },
  ): OutcomeEvent | null {
    const decisions = this.decisionLog.filter((d) => d.candidateId === candidateId);
    if (decisions.length === 0) return null;
    const latestDecision = decisions[decisions.length - 1];
    if (!latestDecision) return null;
    return outcomeRecorder.record(latestDecision, kind, params);
  }

  getEngineReport(): {
    running: boolean;
    shadowMode: boolean;
    metrics: EngineMetrics;
    pendingCandidates: number;
    sceneClaims: number;
    policyVersion: string;
    outcomes: ReturnType<typeof outcomeRecorder["getOutcomeStats"]>;
  } {
    return {
      running: this.running,
      shadowMode: this.config.shadowMode,
      metrics: this.getMetrics(),
      pendingCandidates: candidateBuilder.getPendingCandidates().length,
      sceneClaims: attentionDispatcher.getSceneClaims().length,
      policyVersion: attentionPolicyEngine.getPolicyVersion(),
      outcomes: outcomeRecorder.getOutcomeStats(),
    };
  }

  kill(name: "global" | "source" | "eventClass", value?: string): void {
    switch (name) {
      case "global":
        attentionPolicyEngine.setKillSwitch(true);
        break;
      case "source":
        if (value) attentionPolicyEngine.setKillSwitch(undefined, value);
        break;
      case "eventClass":
        if (value) attentionPolicyEngine.setKillSwitch(undefined, undefined, value);
        break;
    }
  }

  release(name: "global" | "source" | "eventClass", value?: string): void {
    switch (name) {
      case "global":
        attentionPolicyEngine.releaseKillSwitch();
        break;
      case "source":
        if (value) attentionPolicyEngine.releaseKillSwitch(value);
        break;
      case "eventClass":
        if (value) attentionPolicyEngine.releaseKillSwitch(undefined, value);
        break;
    }
  }

  emitSignal(params: {
    kind: import("./types.js").SignalKind;
    source: import("./types.js").SignalSource;
    subject: EntityRef;
    payload: unknown;
  }): Signal {
    return signalBus.emit(params);
  }

  reset(): void {
    this.decisionLog = [];
    this.metrics = {
      candidatesCreated: 0,
      candidatesDeduplicated: 0,
      surfacesGenerated: 0,
      interruptionsDelivered: 0,
      interruptionsBudgetRemaining: 0,
      actionsAuthorized: 0,
      actionsRejected: 0,
      policyVersions: 1,
    };
    candidateBuilder.clear();
    attentionDispatcher.clearSceneClaims();
    outcomeRecorder.clear();
  }
}

export const attentionEngine = new AttentionEngine();
