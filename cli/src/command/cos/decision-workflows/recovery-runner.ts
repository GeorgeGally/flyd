import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { validateEnvelope, type ContextEnvelope } from "../../../intelligence/context-envelope.js";
import type { IntelligenceEventStore } from "../../../intelligence/event-store.js";
import { predicateThreshold, questionFingerprint } from "../../../cognition/system-one/registry.js";
import { createRecoveryDslJudge, PilotJudgmentError, RECOVERY_PREDICATE, recoveryGate } from "./system-one-contract.js";
import { RECOVERY_DSL_PACKAGE_VERSION, RECOVERY_WORKFLOW_POLICY, recoveryWorkflow, recoveryWorkflowDigest } from "./recovery-workflow.js";
import type { DecisionModelOptions } from "../../../cognition/system-one/decision-provider.js";
import type { PredicateEvaluation } from "../../../cognition/system-one/types.js";
import { canRecoverInternally, type RecoveryInput } from "../recovery.js";

const SOURCE = "cos.dsl.recovery";
export type DslMode = "off" | "shadow" | "canary" | "on";
export type DslOutcome =
  | { kind: "unavailable"; reason: string }
  | { kind: "decided"; action: "hold" | "rebrief"; reason: string; replayed: boolean }
  | { kind: "hold"; reason: string };

export interface DslExecutor {
  validateWorkflow: (workflow: any) => { ok: boolean; errors?: string[] };
  runWorkflow: (workflow: any, input: Record<string, unknown>, deps: any) => Promise<{
    status: string; output?: unknown;
  }>;
}

export interface DslRecoveryOptions {
  store?: IntelligenceEventStore;
  evaluate?: (typeof import("../../../cognition/system-one/decision-provider.js"))["evaluateExecutivePredicates"];
  model?: DecisionModelOptions;
  /** Only offline tests supply an executor on Node 22; production loads the real AgentRun package. */
  executor?: DslExecutor;
  /** Offline fixtures without a writable event store must never dispatch; the return is a proposal only. */
  testOnlyUndurable?: boolean;
  /** Must check the original CoS revision immediately before any proposed action is adopted. */
  current?: () => boolean;
}

export function dslMode(value = process.env.FLYD_COS_DECISION_DSL): DslMode {
  return value === "on" || value === "shadow" || value === "canary" ? value : "off";
}
export function supportsAgentRunNode(version = process.versions.node): boolean {
  const [major = 0, minor = 0, patch = 0] = version.split(".").map(Number);
  return major > 24 || (major === 24 && (minor > 22 || (minor === 22 && patch >= 3)));
}

/** Cohort membership is stable across processes, retries, restarts and machines. */
export function selectedForCanary(key: string, percentage = process.env.FLYD_COS_DSL_CANARY_PERCENT): boolean {
  const value = Number(percentage ?? "0");
  if (!Number.isFinite(value) || value <= 0) return false;
  if (value >= 100) return true;
  const bucket = createHash("sha256").update(key).digest().readUInt32BE(0) / 0x100000000;
  return bucket < value / 100;
}

async function loadExecutor(): Promise<DslExecutor> {
  if (!supportsAgentRunNode()) throw new Error("Node 24.22.3 or later required");
  // The package is intentionally not a Node 22 Core dependency. An installed
  // compatible Core may use the exact package in the runtime's own node_modules;
  // the test host can point this at its pinned, isolated installation.
  const moduleId: string = process.env.FLYD_COS_DSL_MODULE || "@parcha/agentrun-dsl";
  const url = import.meta.resolve(moduleId);
  const packageMeta = JSON.parse(readFileSync(new URL("../package.json", url), "utf8")) as { name?: string; version?: string };
  if (packageMeta.name !== "@parcha/agentrun-dsl" || packageMeta.version !== RECOVERY_DSL_PACKAGE_VERSION) {
    throw new Error("AgentRun DSL version does not match frozen workflow");
  }
  const imported = await import(url) as Partial<DslExecutor>;
  if (typeof imported.runWorkflow !== "function" || typeof imported.validateWorkflow !== "function") {
    throw new Error("Invalid pinned AgentRun DSL module");
  }
  return imported as DslExecutor;
}

function event(
  store: IntelligenceEventStore,
  id: string,
  key: string,
  type: "started" | "answered" | "failed",
  payload: Record<string, unknown>,
): void {
  // Only derived, non-personal metadata may be persisted here. Never write
  // receipt.state, evidence text, question prompts or provider error messages.
  const envelope: ContextEnvelope = {
    pathKind: "executive", kind: "executive_decision", sourceId: SOURCE,
    consent: { grantedAt: new Date().toISOString(), scopes: [] },
    retentionClass: "local_default", payloadClassification: "operational",
    provenance: RECOVERY_WORKFLOW_POLICY, idempotencyKey: key + ":" + type,
    correlationId: id, policyVersion: RECOVERY_WORKFLOW_POLICY,
    payload: { ...payload, phase: type },
  };
  const validation = validateEnvelope(envelope, { consentLookup: store });
  if (!validation.ok) throw new Error("DSL decision receipt denied");
  store.append(envelope);
}

function decisionKey(input: RecoveryInput, state: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify({
    id: input.objective.id,
    rev: input.objective.briefRevision ?? 0,
    run: input.run.key,
    attempt: input.run.attempt,
    failure: input.failure,
    source: input.run.ref ?? "",
    state,
    digest: recoveryWorkflowDigest(),
    question: questionFingerprint(RECOVERY_PREDICATE),
  })).digest("hex");
}

function approvedCurrent(input: RecoveryInput, options: DslRecoveryOptions): boolean {
  return canRecoverInternally(input) && Boolean(options.current?.() ?? true);
}

/**
 * Runs a single trusted, read-only DSL procedure. CoS, not AgentRun, owns
 * objective and effects; the output is a candidate and cannot grant a retry.
 * Unknown sent requests hold instead of being re-issued.
 */
export async function runRecoveryDsl(
  input: RecoveryInput, state: Record<string, unknown>,
  options: DslRecoveryOptions = {},
): Promise<DslOutcome> {
  if (!approvedCurrent(input, options)) return { kind: "hold", reason: "stale or unauthorized recovery" };
  if (!options.store && !options.testOnlyUndurable) return { kind: "unavailable", reason: "durable CoS decision store unavailable" };
  let runtime: DslExecutor;
  try { runtime = options.executor ?? await loadExecutor(); }
  catch { return { kind: "unavailable", reason: "compatible pinned AgentRun runtime not installed" }; }

  const workflow = recoveryWorkflow();
  const check = runtime.validateWorkflow(workflow);
  if (!check.ok) return { kind: "hold", reason: "trusted recovery workflow failed validation" };
  const requestKey = decisionKey(input, state);
  const store = options.store;
  const existing = store?.findByIdempotencyKey(SOURCE, requestKey + ":answered");
  if (existing) {
    const p = existing.payload;
    if (p?.workflow === recoveryWorkflowDigest() && p.question === questionFingerprint(RECOVERY_PREDICATE)
      && (p.action === "hold" || p.action === "rebrief") && approvedCurrent(input, options)) {
      return { kind: "decided", action: p.action,
        reason: p.reason === "low_confidence" || p.reason === "evidence_hold" || p.reason === "grounded_recovery"
          ? p.reason : "replayed_validated_decision", replayed: true };
    }
    return { kind: "hold", reason: "decision version or authority changed" };
  }
  if (store?.findByIdempotencyKey(SOURCE, requestKey + ":started")) {
    return { kind: "hold", reason: "earlier model request may have completed; reconcile without asking again" };
  }

  const sourceKey = input.run.ref ?? input.run.key;
  let started = false;
  let recorded = false;
  let answeredAction: "rebrief" | "hold" | null = null;
  let answeredReason: "low_confidence" | "evidence_hold" | "grounded_recovery" | null = null;
  const judge = createRecoveryDslJudge({ evaluate: options.evaluate, model: options.model });
  try {
    const result = await runtime.runWorkflow(workflow, {
      sourceKey,
      source_state: String(state.source_state ?? ""),
      summary: String(state.summary ?? ""),
      question: String(state.question ?? ""),
      options: Array.isArray(state.options) ? state.options : [],
      goal_context: String(state.goal_context ?? ""),
    }, {
      runEffect: async ({ node, input: args }: { node: { via: string; tool: string }; input: { key?: string } }) => {
        if (node.via !== "tool" || node.tool !== "cos.internal-evidence" || args.key !== sourceKey ||
            !approvedCurrent(input, options)) throw new Error("read-only source or objective changed");
        return {
          verified: true, // already confirmed by CoS internal-only receipt classification
          references: (input.run.prior ?? []).slice(0, 8).map((ref) => String(ref)).concat(sourceKey),
        };
      },
      runJudge: async (request: Parameters<typeof judge>[0]) => {
        if (!approvedCurrent(input, options)) throw new PilotJudgmentError("cancelled");
        if (store) {
          // The request marker must be an atomic claim across competing Core
          // processes. Merely appending an idempotent duplicate and continuing
          // would still issue two paid (possibly state-changing) requests.
          const claimed = store.transaction(() => {
            if (store.findByIdempotencyKey(SOURCE, requestKey + ":started") ||
                store.findByIdempotencyKey(SOURCE, requestKey + ":answered")) return false;
            event(store, input.objective.id ?? input.run.key, requestKey, "started", {
              workflow: recoveryWorkflowDigest(), question: questionFingerprint(RECOVERY_PREDICATE),
              threshold: predicateThreshold(RECOVERY_PREDICATE), attempt: input.run.attempt,
            });
            return true;
          });
          if (!claimed) throw new PilotJudgmentError("unknown_provider_outcome");
        }
        started = true;
        return judge(request);
      },
      recordDecision: async (receipt: {
        status: "answered" | "failed" | "cancelled";
        answers?: Record<string, { type: string; choice?: string; confidence?: number; probabilities?: Record<string, number> }>;
        id: string; state_sha256: string; model?: string | null; cost_usd?: number | null;
      }) => {
        // Upstream awaits this before it branches. A journal event alone is NOT an effect receipt.
        if (receipt.status !== "answered") return;
        const a = receipt.answers?.[RECOVERY_PREDICATE];
        if (!a || a.type !== "choice" || typeof a.choice !== "string" ||
            typeof a.confidence !== "number" || !a.probabilities) {
          throw new Error("Cannot persist an incomplete DSL decision");
        }
        answeredAction = recoveryGate({
          type: "choice", choice: a.choice, confidence: a.confidence,
          probabilities: a.probabilities,
        });
        const p = a.probabilities[a.choice];
        const gate = predicateThreshold(RECOVERY_PREDICATE);
        answeredReason = typeof p !== "number" || p < gate || a.confidence < gate
          ? "low_confidence"
          : a.choice === "hold_for_evidence" ? "evidence_hold" : "grounded_recovery";
        if (store) {
          event(store, input.objective.id ?? input.run.key, requestKey, "answered", {
            workflow: recoveryWorkflowDigest(), question: questionFingerprint(RECOVERY_PREDICATE),
            decisionId: receipt.id, stateHash: receipt.state_sha256,
            action: answeredAction, reason: answeredReason,
            threshold: predicateThreshold(RECOVERY_PREDICATE),
            model: receipt.model ?? null, costUSD: receipt.cost_usd ?? null,
          });
        }
        recorded = true;
      },
    });
    if (result.status !== "complete" || !result.output || typeof result.output !== "object")
      return { kind: "hold", reason: "DSL did not return a complete decision" };
    const action = (result.output as Record<string, unknown>).action;
    if (!recorded || !answeredAction || !approvedCurrent(input, options) ||
        action !== answeredAction || (action !== "hold" && action !== "rebrief")) {
      return { kind: "hold", reason: "unverified or stale DSL disposition" };
    }
    return { kind: "decided", action,
      reason: answeredReason ?? "replayed_validated_decision", replayed: false };
  } catch (error) {
    const reason = error instanceof PilotJudgmentError ? error.kind : started
      ? "decision interrupted or failed" : "internal source check failed";
    return { kind: "hold", reason };
  }
}
