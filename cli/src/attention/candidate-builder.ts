import { randomUUID } from "node:crypto";
import type {
  Signal,
  CandidateEvent,
  CandidateType,
  CandidateStatus,
  EntityRef,
  EvidenceRef,
} from "./types.js";

const CANDIDATE_EXPIRY_MS = 24 * 60 * 60 * 1000;

function classificationForSignal(signal: Signal): CandidateType | null {
  switch (signal.kind) {
    case "commitment_stated":
    case "commitment_updated":
      return "commitment_suggested";
    case "deadline_approaching":
      return "deadline_due";
    case "delegation_changed":
      if (signal.payload && typeof signal.payload === "object" && "status" in signal.payload) {
        const p = signal.payload as { status: string };
        if (p.status === "blocked") return "delegation_blocked";
        if (p.status === "completed") return "delegation_completed";
        if (p.status === "failed") return "delegation_failed";
      }
      return "delegation_completed";
    case "action_failed":
      return "delegation_failed";
    case "user_feedback":
      return "feedback_received";
    case "explicit_reminder":
      return "explicit_reminder";
    case "context_changed":
      return "context_shift";
    default:
      return null;
  }
}

function extractSubject(signal: Signal): EntityRef {
  return signal.subject;
}

function extractCommitmentId(signal: Signal): string | undefined {
  if (signal.payload && typeof signal.payload === "object" && "commitmentId" in signal.payload) {
    const id = (signal.payload as { commitmentId: unknown }).commitmentId;
    if (typeof id === "string") return id;
  }
  return undefined;
}

function defaultDimensions(candidateType: CandidateType, signalCount: number): Omit<CandidateEvent, "id" | "type" | "subject" | "commitmentId" | "signalIds" | "evidence" | "suppressionKey" | "firstSeenAt" | "lastSeenAt" | "status" | "expiresAt"> {
  const base = {
    novelty: Math.min(1, 1 / (signalCount + 1)),
    confidence: Math.min(1, 0.3 + signalCount * 0.1),
    reversibility: 0.8,
    userRelevance: 0.5,
    interruptionCost: 0.3,
    evidenceQuality: Math.min(1, 0.4 + signalCount * 0.1),
  };

  switch (candidateType) {
    case "deadline_due":
      return { ...base, urgency: 0.9, consequence: 0.7, userRelevance: 0.8, interruptionCost: 0.4 };
    case "delegation_blocked":
      return { ...base, urgency: 0.7, consequence: 0.6, userRelevance: 0.8, interruptionCost: 0.5 };
    case "delegation_failed":
      return { ...base, urgency: 0.8, consequence: 0.7, userRelevance: 0.9, interruptionCost: 0.5, reversibility: 0.2 };
    case "delegation_completed":
      return { ...base, urgency: 0.4, consequence: 0.3, userRelevance: 0.7, interruptionCost: 0.2, reversibility: 0.9 };
    case "explicit_reminder":
      return { ...base, urgency: 0.7, consequence: 0.5, userRelevance: 1.0, interruptionCost: 0.3 };
    case "feedback_received":
      return { ...base, urgency: 0.3, consequence: 0.2, userRelevance: 0.6, interruptionCost: 0.1, reversibility: 0.9 };
    default:
      return { ...base, urgency: 0.4, consequence: 0.3, userRelevance: 0.5 };
  }
}

export class CandidateBuilder {
  private candidates: Map<string, CandidateEvent> = new Map();
  private suppressionGroups: Map<string, string> = new Map();

  ingestSignal(signal: Signal): CandidateEvent | null {
    const candidateType = classificationForSignal(signal);
    if (!candidateType) return null;

    const suppressionKey = computeSuppressionKey(candidateType, signal.subject.id);

    const existingId = this.suppressionGroups.get(suppressionKey);
    if (existingId) {
      const existing = this.candidates.get(existingId);
      if (existing) {
        existing.signalIds.push(signal.id);
        existing.lastSeenAt = signal.observedAt;
        existing.novelty = Math.min(1, existing.novelty + 0.05);
        existing.confidence = Math.min(1, existing.confidence + 0.05);
        existing.evidenceQuality = Math.min(1, existing.evidenceQuality + 0.05);
        existing.evidence.push(...signal.evidence);
        return existing;
      }
    }

    const subject = extractSubject(signal);
    const commitmentId = extractCommitmentId(signal);
    const now = signal.observedAt;
    const dims = defaultDimensions(candidateType, 1);

    const candidate: CandidateEvent = {
      id: randomUUID(),
      type: candidateType,
      subject,
      commitmentId,
      signalIds: [signal.id],
      firstSeenAt: now,
      lastSeenAt: now,
      status: "pending",
      ...dims,
      evidence: [...signal.evidence],
      suppressionKey,
      expiresAt: new Date(Date.now() + CANDIDATE_EXPIRY_MS).toISOString(),
    };

    this.candidates.set(candidate.id, candidate);
    this.suppressionGroups.set(suppressionKey, candidate.id);
    return candidate;
  }

  getCandidate(id: string): CandidateEvent | undefined {
    return this.candidates.get(id);
  }

  updateStatus(id: string, status: CandidateStatus): CandidateEvent | undefined {
    const candidate = this.candidates.get(id);
    if (!candidate) return undefined;
    candidate.status = status;
    return candidate;
  }

  getPendingCandidates(): CandidateEvent[] {
    const now = Date.now();
    return [...this.candidates.values()].filter((c) => {
      if (c.status !== "pending") return false;
      if (c.expiresAt && new Date(c.expiresAt).getTime() < now) {
        c.status = "expired";
        return false;
      }
      return true;
    });
  }

  expireSuppressed(): number {
    let count = 0;
    for (const candidate of this.candidates.values()) {
      if (candidate.status === "suppressed" || candidate.status === "resolved") continue;
      if (candidate.expiresAt && new Date(candidate.expiresAt).getTime() < Date.now()) {
        candidate.status = "expired";
        count++;
      }
    }
    return count;
  }

  getAllCandidates(): CandidateEvent[] {
    return [...this.candidates.values()];
  }

  clear(): void {
    this.candidates.clear();
    this.suppressionGroups.clear();
  }

  getStats(): { total: number; pending: number; expired: number; suppressed: number } {
    const all = [...this.candidates.values()];
    return {
      total: all.length,
      pending: all.filter((c) => c.status === "pending").length,
      expired: all.filter((c) => c.status === "expired").length,
      suppressed: all.filter((c) => c.status === "suppressed").length,
    };
  }
}

function computeSuppressionKey(candidateType: CandidateType, subjectId: string): string {
  return `${candidateType}::${subjectId}`;
}

function deduplicateSignals(signals: Signal[]): Signal[] {
  const seen = new Set<string>();
  return signals.filter((s) => {
    if (seen.has(s.fingerprint)) return false;
    seen.add(s.fingerprint);
    return true;
  });
}

export function normalizeAndDeduplicate(signals: Signal[]): Signal[] {
  const withFingerprints = signals.filter((s) => s.fingerprint);
  return deduplicateSignals(withFingerprints);
}

export const candidateBuilder = new CandidateBuilder();
