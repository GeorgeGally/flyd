import { randomUUID } from "node:crypto";
import type { OutcomeEvent, OutcomeKind, AttentionDecision, SuppressionRule, TimingPreference } from "./types.js";

export class OutcomeRecorder {
  private outcomes: OutcomeEvent[] = [];
  private suppressionRules: SuppressionRule[] = [];
  private timingPreferences: TimingPreference[] = [];
  private maxOutcomes = 500;
  private listenerCallback: ((outcome: OutcomeEvent) => void) | null = null;

  onOutcome(callback: (outcome: OutcomeEvent) => void): void {
    this.listenerCallback = callback;
  }

  record(
    decision: AttentionDecision,
    kind: OutcomeKind,
    params?: {
      correctionText?: string;
      correctionKind?: "irrelevant" | "wrong_time" | "wrong_fact" | "never_this";
      resultSummary?: string;
      linkedMemoryId?: string;
      linkedCommitmentId?: string;
    },
  ): OutcomeEvent {
    const outcome: OutcomeEvent = {
      id: randomUUID(),
      decisionId: `disp_${decision.candidateId}`,
      candidateId: decision.candidateId,
      kind,
      occurredAt: new Date().toISOString(),
      ...params,
    };

    this.outcomes.push(outcome);
    if (this.outcomes.length > this.maxOutcomes) {
      this.outcomes = this.outcomes.slice(-this.maxOutcomes);
    }

    this.applyImmediateLearning(outcome, decision);

    if (this.listenerCallback) {
      try {
        this.listenerCallback(outcome);
      } catch {
        // listener errors must not block recording
      }
    }

    return outcome;
  }

  recordOpened(decision: AttentionDecision): OutcomeEvent {
    return this.record(decision, "opened");
  }

  recordDismissed(decision: AttentionDecision): OutcomeEvent {
    return this.record(decision, "dismissed");
  }

  recordSnoozed(decision: AttentionDecision): OutcomeEvent {
    return this.record(decision, "snoozed");
  }

  recordActed(decision: AttentionDecision, resultSummary?: string): OutcomeEvent {
    return this.record(decision, "acted", { resultSummary });
  }

  recordCorrected(
    decision: AttentionDecision,
    correctionText: string,
    correctionKind: "irrelevant" | "wrong_time" | "wrong_fact" | "never_this",
  ): OutcomeEvent {
    return this.record(decision, "corrected", { correctionText, correctionKind });
  }

  recordApproved(decision: AttentionDecision): OutcomeEvent {
    return this.record(decision, "approved");
  }

  recordRejected(decision: AttentionDecision): OutcomeEvent {
    return this.record(decision, "rejected");
  }

  recordActionSucceeded(decision: AttentionDecision, resultSummary?: string): OutcomeEvent {
    return this.record(decision, "action_succeeded", { resultSummary });
  }

  recordActionFailed(decision: AttentionDecision, resultSummary?: string): OutcomeEvent {
    return this.record(decision, "action_failed", { resultSummary });
  }

  recordExpiredUnseen(decision: AttentionDecision): OutcomeEvent {
    return this.record(decision, "expired_unseen");
  }

  getOutcomesForCandidate(candidateId: string): OutcomeEvent[] {
    return this.outcomes.filter((o) => o.candidateId === candidateId);
  }

  getOutcomeStats(candidateType?: string): {
    total: number;
    opened: number;
    dismissed: number;
    corrected: number;
    approved: number;
    rejected: number;
    acted: number;
    actionSucceeded: number;
    actionFailed: number;
  } {
    let filtered = this.outcomes;
    if (candidateType) {
      filtered = filtered.filter((o) => {
        return o.candidateId.includes(candidateType);
      });
    }

    return {
      total: filtered.length,
      opened: filtered.filter((o) => o.kind === "opened").length,
      dismissed: filtered.filter((o) => o.kind === "dismissed").length,
      corrected: filtered.filter((o) => o.kind === "corrected").length,
      approved: filtered.filter((o) => o.kind === "approved").length,
      rejected: filtered.filter((o) => o.kind === "rejected").length,
      acted: filtered.filter((o) => o.kind === "acted").length,
      actionSucceeded: filtered.filter((o) => o.kind === "action_succeeded").length,
      actionFailed: filtered.filter((o) => o.kind === "action_failed").length,
    };
  }

  private applyImmediateLearning(outcome: OutcomeEvent, _decision: AttentionDecision): void {
    if (outcome.kind === "dismissed") {
      const existingRule = this.suppressionRules.find((r) =>
        r.causeEventClass === outcome.candidateId,
      );
      if (existingRule) {
        existingRule.dismissalCount++;
      }
    }

    if (outcome.kind === "corrected" && outcome.correctionKind === "never_this") {
      this.suppressionRules.push({
        id: randomUUID(),
        causeEventClass: outcome.candidateId,
        suppressionKey: outcome.candidateId,
        source: "user_never",
        createdAt: new Date().toISOString(),
        dismissalCount: 1,
      });
    }
  }

  get suppression(): SuppressionRule[] {
    return [...this.suppressionRules];
  }

  get timingPrefs(): TimingPreference[] {
    return [...this.timingPreferences];
  }

  get all(): OutcomeEvent[] {
    return [...this.outcomes];
  }

  clear(): void {
    this.outcomes = [];
    this.suppressionRules = [];
    this.timingPreferences = [];
  }
}

export const outcomeRecorder = new OutcomeRecorder();
