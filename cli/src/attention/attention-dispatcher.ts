import type {
  AttentionDecision,
  CandidateEvent,
  SceneClaim,
  DispatchResult,
  ActionProposal,
  PreparedArtifact,
} from "./types.js";

export interface SceneClaimQueue {
  claims: SceneClaim[];
  maxClaims: number;
}

export class AttentionDispatcher {
  private rememberCallback: ((decision: AttentionDecision, candidate: CandidateEvent) => void) | null = null;
  private sceneQueue: SceneClaimQueue = { claims: [], maxClaims: 3 };
  private preparedArtifacts: Map<string, PreparedArtifact> = new Map();
  private notifyNowQueue: Array<{ decision: AttentionDecision; candidate: CandidateEvent }> = [];
  private permissionRequests: Array<{ decision: AttentionDecision; candidate: CandidateEvent }> = [];
  private actEnvelopes: Array<{ decision: AttentionDecision; candidate: CandidateEvent }> = [];

  onRemember(callback: (decision: AttentionDecision, candidate: CandidateEvent) => void): void {
    this.rememberCallback = callback;
  }

  dispatch(decision: AttentionDecision, candidate: CandidateEvent): DispatchResult {
    const baseResult: Omit<DispatchResult, "surfaceId" | "error"> = {
      decisionId: `disp_${decision.candidateId}`,
      candidateId: decision.candidateId,
      dispatched: false,
    };

    switch (decision.disposition) {
      case "ignore":
        return { ...baseResult, dispatched: true };

      case "remember":
        if (this.rememberCallback) {
          try {
            this.rememberCallback(decision, candidate);
          } catch {
            return { ...baseResult, dispatched: false, error: "Remember callback failed" };
          }
        }
        return { ...baseResult, dispatched: true };

      case "prepare": {
        const artifact = this.preparedArtifacts.get(candidate.id);
        if (artifact) {
          return { ...baseResult, dispatched: true, surfaceId: artifact.artifact.id };
        }
        return { ...baseResult, dispatched: true, surfaceId: `prepare-queued-${candidate.id}` };
      }

      case "next_scene": {
        const claim = this.createSceneClaim(candidate, decision);
        this.sceneQueue.claims.push(claim);
        if (this.sceneQueue.claims.length > this.sceneQueue.maxClaims) {
          this.sceneQueue.claims.shift();
        }
        return { ...baseResult, dispatched: true, surfaceId: claim.id };
      }

      case "notify_now": {
        this.notifyNowQueue.push({ decision, candidate });
        return { ...baseResult, dispatched: true, surfaceId: `notify-${candidate.id}` };
      }

      case "ask_permission": {
        this.permissionRequests.push({ decision, candidate });
        return { ...baseResult, dispatched: true, surfaceId: `permission-${candidate.id}` };
      }

      case "act": {
        this.actEnvelopes.push({ decision, candidate });
        return { ...baseResult, dispatched: true, surfaceId: `act-${candidate.id}` };
      }

      default:
        return { ...baseResult, dispatched: false, error: "Unknown disposition" };
    }
  }

  private createSceneClaim(candidate: CandidateEvent, decision: AttentionDecision): SceneClaim {
    const now = new Date().toISOString();
    const expiry = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();

    return {
      id: `claim_${candidate.id}`,
      candidateId: candidate.id,
      rank: this.sceneQueue.claims.length + 1,
      headline: headlineFromCandidate(candidate),
      whyNow: reasonFromDecision(decision),
      evidence: decision.evidence,
      proposedActions: proposedActionsFromCandidate(candidate),
      expiresAt: expiry,
    };
  }

  getSceneClaims(limit?: number): SceneClaim[] {
    const valid = this.sceneQueue.claims.filter((c) => {
      if (!c.expiresAt) return true;
      return new Date(c.expiresAt).getTime() > Date.now();
    });
    const sorted = valid.sort((a, b) => b.rank - a.rank);
    return limit ? sorted.slice(0, limit) : sorted;
  }

  clearSceneClaims(): void {
    this.sceneQueue.claims = [];
  }

  getNotifyNowQueue(): Array<{ decision: AttentionDecision; candidate: CandidateEvent }> {
    const items = [...this.notifyNowQueue];
    this.notifyNowQueue = [];
    return items;
  }

  getPermissionRequests(): Array<{ decision: AttentionDecision; candidate: CandidateEvent }> {
    const items = [...this.permissionRequests];
    this.permissionRequests = [];
    return items;
  }

  getActEnvelopes(): Array<{ decision: AttentionDecision; candidate: CandidateEvent }> {
    const items = [...this.actEnvelopes];
    this.actEnvelopes = [];
    return items;
  }

  recordPreparedArtifact(candidateId: string, artifact: PreparedArtifact): void {
    this.preparedArtifacts.set(candidateId, artifact);
  }

  getPreparedArtifact(candidateId: string): PreparedArtifact | undefined {
    return this.preparedArtifacts.get(candidateId);
  }

  get all(): {
    sceneClaims: SceneClaim[];
    preparedArtifacts: PreparedArtifact[];
    notifyNowCount: number;
    permissionCount: number;
    actCount: number;
  } {
    return {
      sceneClaims: this.getSceneClaims(),
      preparedArtifacts: [...this.preparedArtifacts.values()],
      notifyNowCount: this.notifyNowQueue.length,
      permissionCount: this.permissionRequests.length,
      actCount: this.actEnvelopes.length,
    };
  }
}

function headlineFromCandidate(candidate: CandidateEvent): string {
  switch (candidate.type) {
    case "deadline_due": return `Deadline approaching: ${candidate.subject.label}`;
    case "delegation_blocked": return `Delegation blocked: ${candidate.subject.label}`;
    case "delegation_completed": return `Delegation completed: ${candidate.subject.label}`;
    case "delegation_failed": return `Delegation failed: ${candidate.subject.label}`;
    case "explicit_reminder": return `Reminder: ${candidate.subject.label}`;
    case "commitment_suggested": return `Commitment suggested: ${candidate.subject.label}`;
    default: return candidate.subject.label;
  }
}

function reasonFromDecision(decision: AttentionDecision): string {
  return decision.reasonCodes.join(", ").toLowerCase().replace(/_/g, " ");
}

function proposedActionsFromCandidate(candidate: CandidateEvent): ActionProposal[] {
  return candidate.type === "delegation_blocked"
    ? [{
        actionId: `unblock-${candidate.id}`,
        description: "Check what's blocking this task",
        kind: "inspect",
        target: candidate.subject,
        consequences: ["No side effects"],
        reversibility: "reversible",
        requiresPermission: false,
        requiresConfirmation: false,
      }]
    : [];
}

export const attentionDispatcher = new AttentionDispatcher();
