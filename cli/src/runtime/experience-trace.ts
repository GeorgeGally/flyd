import { join } from "node:path";
import { IntelligenceEventStore, type StoredEvent } from "../intelligence/event-store.js";
import { validateEnvelope, type ContextEnvelope } from "../intelligence/context-envelope.js";
import {
  EXPERIENCE_RUNTIME_CONTRACT,
  SourceContractRegistry,
} from "../intelligence/sensors/source-contracts.js";
import { safeRoutingValue } from "./routing-learning.js";
import type { TurnReceipt } from "./turn-receipt.js";

export const EXPERIENCE_TRACE_SCHEMA = "flyd.experience.v1";
export const EXPERIENCE_SOURCE_ID = EXPERIENCE_RUNTIME_CONTRACT.sourceId;

export interface ExperienceSystemSnapshot {
  traceSchema: typeof EXPERIENCE_TRACE_SCHEMA;
  routingPolicy?: string;
  decisionPolicy?: string;
  routeSource?: string;
  model: string;
  providerIdentity: string;
}

export interface ExperienceTrace {
  version: 1;
  receiptId: string;
  sessionId: string;
  turnNumber: number;
  recordedAt: string;
  intent: string;
  route: string;
  context: {
    memoryVerdict?: string;
    memories: Array<{
      path: string;
      authority?: string;
      outcome?: string;
      stale?: boolean;
    }>;
  };
  execution: {
    tools: Array<{
      name: string;
      succeeded: boolean;
      error?: string;
    }>;
    toolCallCount: number;
    failedToolCallCount: number;
    retryCount: number;
  };
  outcome: {
    status: TurnReceipt["status"];
    answerChars: number;
    error?: string;
  };
  system: ExperienceSystemSnapshot;
}

export interface ExperienceFeedback {
  version: 1;
  receiptId: string;
  repairId: string;
  recordedAt: string;
  source: "explicit_command" | "foreground_feedback" | "chat_correction";
  signal: "correction";
  feedback: string;
  failureClasses: string[];
  repairTargets: string[];
}

interface ExperienceOptions {
  flydDir: string;
}

function registryFor(flydDir: string): SourceContractRegistry {
  const registry = new SourceContractRegistry({
    path: join(flydDir, "intelligence", "source-consents.json"),
  });
  registry.register(EXPERIENCE_RUNTIME_CONTRACT);
  return registry;
}

function appendExperience(
  flydDir: string,
  envelope: ContextEnvelope,
): StoredEvent | null {
  const registry = registryFor(flydDir);
  if (registry.status(EXPERIENCE_SOURCE_ID) !== "enabled") return null;
  const validation = validateEnvelope(envelope, {
    consentLookup: { isRevoked: (sourceId) => registry.status(sourceId) === "revoked" },
  });
  if (!validation.ok) return null;

  const store = new IntelligenceEventStore({
    path: join(flydDir, "intelligence.sqlite"),
  });
  try {
    return store.append(envelope);
  } finally {
    store.close();
  }
}

function consentSnapshot() {
  return {
    grantedAt: new Date().toISOString(),
    scopes: EXPERIENCE_RUNTIME_CONTRACT.scopes,
  };
}

/**
 * Normalize an ordinary turn receipt into the compact execution evidence
 * future diagnosis/replay needs. Keep raw answer text and tool inputs in the
 * receipt; the canonical experience trace stores only outcome metadata.
 */
export function experienceTraceFromReceipt(receipt: TurnReceipt): ExperienceTrace {
  const memoryMatches = Array.isArray(receipt.memory.matches) ? receipt.memory.matches : [];
  const tools = receipt.toolCalls.map((call) => ({
    name: call.name,
    succeeded: call.succeeded,
    ...(call.error ? { error: call.error.slice(0, 500) } : {}),
  }));
  const route = receipt.plan?.route ?? receipt.routing?.observed.route ?? receipt.route;
  const previouslyFailed = new Set<string>();
  let retryCount = 0;
  for (const call of receipt.toolCalls) {
    if (previouslyFailed.has(call.name)) retryCount += 1;
    if (!call.succeeded) previouslyFailed.add(call.name);
  }
  return {
    version: 1,
    receiptId: receipt.id,
    sessionId: receipt.sessionId,
    turnNumber: receipt.turnNumber,
    recordedAt: receipt.recordedAt,
    intent: receipt.message,
    route,
    context: {
      ...(receipt.memory.verdict ? { memoryVerdict: receipt.memory.verdict } : {}),
      memories: memoryMatches.slice(0, 40).map((match) => ({
        path: match.path,
        ...(match.authority ? { authority: match.authority } : {}),
        ...(match.outcome ? { outcome: match.outcome } : {}),
        ...(match.stale !== undefined ? { stale: match.stale } : {}),
      })),
    },
    execution: {
      tools,
      toolCallCount: tools.length,
      failedToolCallCount: tools.filter((tool) => !tool.succeeded).length,
      retryCount,
    },
    outcome: {
      status: receipt.status,
      answerChars: receipt.answer.length,
      ...(receipt.error ? { error: receipt.error.slice(0, 500) } : {}),
    },
    system: {
      traceSchema: EXPERIENCE_TRACE_SCHEMA,
      ...(receipt.routing?.policyVersion ? { routingPolicy: receipt.routing.policyVersion } : {}),
      ...(receipt.decisionPolicy ? { decisionPolicy: receipt.decisionPolicy } : {}),
      ...(receipt.plan?.source ? { routeSource: receipt.plan.source } : {}),
      model: receipt.model,
      providerIdentity: receipt.providerIdentity,
    },
  };
}

export function recordExperienceTrace(
  receipt: TurnReceipt,
  options: ExperienceOptions,
): StoredEvent | null {
  const trace = experienceTraceFromReceipt(receipt);
  const envelope: ContextEnvelope = {
    pathKind: "interface",
    kind: "observation",
    sourceId: EXPERIENCE_SOURCE_ID,
    consent: consentSnapshot(),
    retentionClass: EXPERIENCE_RUNTIME_CONTRACT.retentionClass,
    payloadClassification: "personal",
    provenance: "runtime:experience-trace",
    idempotencyKey: `trace:${receipt.id}`,
    correlationId: receipt.id,
    policyVersion: [
      trace.system.routingPolicy,
      trace.system.decisionPolicy,
      trace.system.traceSchema,
    ].filter(Boolean).join(":"),
    payload: safeRoutingValue({ type: "experience_trace", trace }) as Record<string, unknown>,
  };
  return appendExperience(options.flydDir, envelope);
}

export function recordExperienceFeedback(
  input: ExperienceFeedback,
  options: ExperienceOptions,
): StoredEvent | null {
  const envelope: ContextEnvelope = {
    pathKind: "interface",
    kind: "observation",
    sourceId: EXPERIENCE_SOURCE_ID,
    consent: consentSnapshot(),
    retentionClass: EXPERIENCE_RUNTIME_CONTRACT.retentionClass,
    payloadClassification: "personal",
    provenance: "runtime:experience-feedback",
    idempotencyKey: `feedback:${input.repairId}`,
    correlationId: input.receiptId,
    payload: safeRoutingValue({ type: "experience_feedback", feedback: input }) as Record<string, unknown>,
  };
  return appendExperience(options.flydDir, envelope);
}
