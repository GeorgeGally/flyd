import { createHash } from "node:crypto";
import { validateEnvelope, type ContextEnvelope } from "../context-envelope.js";
import type { IntelligenceEventStore, StoredEvent } from "../event-store.js";
import { EXPERIENCE_RUNTIME_CONTRACT } from "../sensors/source-contracts.js";

export const DREAM_INSIGHT_SCHEMA = "flyd.dream-insight.v1";
export const DREAM_EXPERIENCE_CHECKPOINT = "dream-experience-v1";

export type DreamInsightKind = "correction_cluster" | "repeated_failure";

export interface DreamInsight {
  version: 1;
  schema: typeof DREAM_INSIGHT_SCHEMA;
  kind: DreamInsightKind;
  signature: string;
  generatedAt: string;
  supportCount: number;
  confidence: number;
  summary: string;
  consumer: "self_improve";
  evidenceRefs: string[];
  facets: {
    failureClasses?: string[];
    repairTargets?: string[];
    route?: string;
    memoryVerdict?: string;
    failedTools?: string[];
    retried?: boolean;
  };
}

interface TraceShape {
  receiptId?: string;
  route?: string;
  context?: { memoryVerdict?: string };
  execution?: {
    tools?: Array<{ name?: string; succeeded?: boolean }>;
    failedToolCallCount?: number;
    retryCount?: number;
  };
  outcome?: { status?: string };
}

interface FeedbackShape {
  receiptId?: string;
  failureClasses?: unknown;
  repairTargets?: unknown;
}

interface TraceRecord {
  event: StoredEvent;
  trace: TraceShape;
}

interface FeedbackRecord {
  event: StoredEvent;
  feedback: FeedbackShape;
}

const MILESTONES = [3, 5, 10] as const;

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))].sort()
    : [];
}

function highestMilestone(count: number): number | null {
  return [...MILESTONES].reverse().find((value) => count >= value) ?? null;
}

function signature(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);
}

function payloadType(event: StoredEvent): string | undefined {
  return event.payload && typeof event.payload.type === "string" ? event.payload.type : undefined;
}

export function isExperienceInputEvent(event: StoredEvent): boolean {
  if (event.erased || !event.payload) return false;
  const type = payloadType(event);
  return type === "experience_trace" || type === "experience_feedback";
}

function traceRecords(events: StoredEvent[]): TraceRecord[] {
  return events.flatMap((event) => {
    if (event.erased || payloadType(event) !== "experience_trace") return [];
    const trace = event.payload?.trace;
    return trace && typeof trace === "object" ? [{ event, trace: trace as TraceShape }] : [];
  });
}

function feedbackRecords(events: StoredEvent[]): FeedbackRecord[] {
  return events.flatMap((event) => {
    if (event.erased || payloadType(event) !== "experience_feedback") return [];
    const feedback = event.payload?.feedback;
    return feedback && typeof feedback === "object" ? [{ event, feedback: feedback as FeedbackShape }] : [];
  });
}

function specificFailureClasses(value: unknown): string[] {
  const all = strings(value);
  const specific = all.filter((item) => item !== "answer_quality");
  return specific.length ? specific : all;
}

function specificRepairTargets(value: unknown): string[] {
  const all = strings(value);
  const specific = all.filter((item) => item !== "behavioral regression evaluation");
  return specific.length ? specific : all;
}

function confidenceFor(kind: DreamInsightKind, milestone: number): number {
  const base = kind === "correction_cluster" ? 0.82 : 0.76;
  return Math.min(0.96, base + (milestone >= 10 ? 0.12 : milestone >= 5 ? 0.08 : 0.04));
}

function evidenceFor(records: Array<{ event: StoredEvent }>, milestone: number): string[] {
  return records
    .slice()
    .sort((a, b) => a.event.sequence - b.event.sequence)
    .slice(-milestone)
    .map(({ event }) => `event:${event.sequence}`);
}

export function consolidateExperience(events: StoredEvent[], now = new Date()): DreamInsight[] {
  const traces = traceRecords(events);
  const feedback = feedbackRecords(events);
  const insights: DreamInsight[] = [];
  const tracesByReceipt = new Map(
    traces.flatMap((record) => record.trace.receiptId ? [[record.trace.receiptId, record] as const] : []),
  );

  const correctionGroups = new Map<string, { key: Record<string, unknown>; records: FeedbackRecord[] }>();
  for (const record of feedback) {
    const failures = specificFailureClasses(record.feedback.failureClasses);
    const targets = specificRepairTargets(record.feedback.repairTargets);
    if (!failures.length && !targets.length) continue;
    const associated = record.feedback.receiptId ? tracesByReceipt.get(record.feedback.receiptId) : undefined;
    const key = {
      failureClasses: failures,
      repairTargets: targets,
      route: associated?.trace.route ?? "unknown",
    };
    const id = JSON.stringify(key);
    const group = correctionGroups.get(id) ?? { key, records: [] as FeedbackRecord[] };
    group.records.push(record);
    correctionGroups.set(id, group);
  }

  for (const { key, records } of correctionGroups.values()) {
    const milestone = highestMilestone(records.length);
    if (!milestone) continue;
    const failureClasses = key.failureClasses as string[];
    const repairTargets = key.repairTargets as string[];
    const route = String(key.route);
    const phrase = failureClasses.length ? failureClasses.join(", ") : repairTargets.join(", ");
    const target = repairTargets.length ? `; focus on ${repairTargets.join(", ")}` : "";
    const sig = signature({ kind: "correction_cluster", ...key });
    insights.push({
      version: 1,
      schema: DREAM_INSIGHT_SCHEMA,
      kind: "correction_cluster",
      signature: sig,
      generatedAt: now.toISOString(),
      supportCount: milestone,
      confidence: confidenceFor("correction_cluster", milestone),
      summary: `At least ${milestone} explicit corrections share ${phrase || "the same failure pattern"} on route ${route}${target}.`,
      consumer: "self_improve",
      evidenceRefs: evidenceFor(records, milestone),
      facets: { failureClasses, repairTargets, route },
    });
  }

  const failureGroups = new Map<string, {
    key: { route: string; memoryVerdict: string; failedTools: string[]; retried: boolean };
    records: TraceRecord[];
  }>();
  for (const record of traces) {
    const execution = record.trace.execution ?? {};
    const failedTools = strings(
      (execution.tools ?? []).filter((tool) => tool?.succeeded === false).map((tool) => tool?.name),
    );
    const failed = record.trace.outcome?.status === "failed"
      || Number(execution.failedToolCallCount ?? 0) > 0
      || Number(execution.retryCount ?? 0) > 0;
    if (!failed) continue;
    const key = {
      route: record.trace.route ?? "unknown",
      memoryVerdict: record.trace.context?.memoryVerdict ?? "unknown",
      failedTools,
      retried: Number(execution.retryCount ?? 0) > 0,
    };
    const id = JSON.stringify(key);
    const group = failureGroups.get(id) ?? { key, records: [] as TraceRecord[] };
    group.records.push(record);
    failureGroups.set(id, group);
  }

  for (const { key, records } of failureGroups.values()) {
    const milestone = highestMilestone(records.length);
    if (!milestone) continue;
    const problem = key.failedTools.length
      ? `failures in ${key.failedTools.join(", ")}`
      : key.retried ? "retries after a failed attempt" : "failed turns";
    const sig = signature({ kind: "repeated_failure", ...key });
    insights.push({
      version: 1,
      schema: DREAM_INSIGHT_SCHEMA,
      kind: "repeated_failure",
      signature: sig,
      generatedAt: now.toISOString(),
      supportCount: milestone,
      confidence: confidenceFor("repeated_failure", milestone),
      summary: `At least ${milestone} turns on route ${key.route} show ${problem}; memory verdict was ${key.memoryVerdict}.`,
      consumer: "self_improve",
      evidenceRefs: evidenceFor(records, milestone),
      facets: {
        route: key.route,
        memoryVerdict: key.memoryVerdict,
        failedTools: key.failedTools,
        retried: key.retried,
      },
    });
  }

  return insights.sort((a, b) => b.confidence - a.confidence || a.signature.localeCompare(b.signature));
}

export function persistDreamInsights(store: IntelligenceEventStore, insights: DreamInsight[]): number {
  let written = 0;
  for (const insight of insights) {
    const idempotencyKey = `dream:${insight.schema}:${insight.kind}:${insight.signature}:${insight.supportCount}`;
    if (store.findByIdempotencyKey(EXPERIENCE_RUNTIME_CONTRACT.sourceId, idempotencyKey)) continue;
    const envelope: ContextEnvelope = {
      pathKind: "executive",
      kind: "observation",
      sourceId: EXPERIENCE_RUNTIME_CONTRACT.sourceId,
      consent: { grantedAt: insight.generatedAt, scopes: EXPERIENCE_RUNTIME_CONTRACT.scopes },
      retentionClass: EXPERIENCE_RUNTIME_CONTRACT.retentionClass,
      payloadClassification: "personal",
      provenance: "intelligence:dream:experience",
      idempotencyKey,
      correlationId: `dream:${insight.signature}`,
      evidenceRefs: insight.evidenceRefs,
      policyVersion: DREAM_INSIGHT_SCHEMA,
      payload: { type: "dream_insight", insight },
    };
    const validation = validateEnvelope(envelope, { consentLookup: store });
    if (!validation.ok) continue;
    if (store.append(envelope)) written += 1;
  }
  return written;
}
