import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import type { Signal, SignalKind, SignalSource, EntityRef, EvidenceRef, OutcomeEvent } from "./types.js";

type SignalListener = (signal: Signal) => void;

const SIGNAL_EXPIRY_MS = 24 * 60 * 60 * 1000;

export class SignalBus {
  private listeners: Set<SignalListener> = new Set();
  private history: Signal[] = [];
  private maxHistory = 1000;

  emit(params: {
    kind: SignalKind;
    source: SignalSource;
    subject: EntityRef;
    payload: unknown;
    evidence?: EvidenceRef[];
    sensitivity?: "normal" | "private" | "restricted";
  }): Signal {
    const now = new Date().toISOString();
    const fingerprint = computeFingerprint(params.kind, params.source, params.subject.id, params.payload);
    const signal: Signal = {
      id: randomUUID(),
      kind: params.kind,
      source: params.source,
      occurredAt: now,
      observedAt: now,
      subject: params.subject,
      payload: params.payload,
      evidence: params.evidence ?? [],
      sensitivity: params.sensitivity ?? "normal",
      fingerprint,
    };

    this.history.push(signal);
    if (this.history.length > this.maxHistory) {
      this.history = this.history.slice(-this.maxHistory);
    }

    for (const listener of this.listeners) {
      try {
        listener(signal);
      } catch {
        // listener errors must not block the bus
      }
    }

    return signal;
  }

  emitFromOutcome(outcome: OutcomeEvent, subject: EntityRef): Signal {
    return this.emit({
      kind: "user_feedback",
      source: "scene_feedback",
      subject,
      payload: {
        outcomeId: outcome.id,
        outcomeKind: outcome.kind,
        correctionText: outcome.correctionText,
        correctionKind: outcome.correctionKind,
      },
      evidence: [{
        sourceId: outcome.id,
        sourceKind: "outcome_event",
        description: `User ${outcome.kind} the decision${outcome.correctionText ? ` with correction: ${outcome.correctionText}` : ""}`,
        observedAt: outcome.occurredAt,
      }],
    });
  }

  subscribe(listener: SignalListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  listenerCount(): number {
    return this.listeners.size;
  }

  getHistory(sinceMs?: number): Signal[] {
    if (!sinceMs) return [...this.history];
    const cutoff = Date.now() - sinceMs;
    return this.history.filter((s) => new Date(s.observedAt).getTime() >= cutoff);
  }

  findDuplicates(signal: Signal, windowMs = 60_000): Signal[] {
    const cutoff = Date.now() - windowMs;
    return this.history.filter(
      (s) => s.fingerprint === signal.fingerprint && s.id !== signal.id && new Date(s.observedAt).getTime() >= cutoff,
    );
  }

  clearHistory(): void {
    this.history = [];
  }

  removeAllListeners(): void {
    this.listeners.clear();
  }
}

function computeFingerprint(kind: SignalKind, source: SignalSource, subjectId: string, payload: unknown): string {
  const hash = createHash("sha256");
  hash.update(`${kind}|${source}|${subjectId}|${JSON.stringify(payload)}`);
  return hash.digest("hex").slice(0, 32);
}

export function computeFingerprintFromPayload(
  kind: SignalKind,
  source: SignalSource,
  subjectId: string,
  payload: unknown,
): string {
  return computeFingerprint(kind, source, subjectId, payload);
}

export const signalBus = new SignalBus();
