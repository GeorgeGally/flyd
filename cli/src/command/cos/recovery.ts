import { evaluateExecutivePredicates, type DecisionModelOptions } from "../../cognition/system-one/decision-provider.js";
import { familyEgress, questionFor } from "../../cognition/system-one/registry.js";
import { projectJevState } from "../../cognition/system-one/jev.js";
import type { PredicateEvaluation } from "../../cognition/system-one/types.js";
import type { Objective, PlannedRun } from "./types.js";
import type { IntelligenceEventStore } from "../../intelligence/event-store.js";
import { dslMode, runRecoveryDsl, selectedForCanary, type DslExecutor, type DslOutcome } from "./decision-workflows/recovery-runner.js";
import { resolveStrategicQuestion } from "./strategic-judgment.js";
import { validateEnvelope, type ContextEnvelope } from "../../intelligence/context-envelope.js";
import { createHash } from "node:crypto";

/** Never infer permission to retry an effect that may already have happened. */
const UNSAFE_EFFECT = /\b(?:send|email|message a client|whatsapp|book|reserve|buy|purchase|pay|transfer|publish|push|merge|deploy|delete|erase|destroy|migrate production|change permissions|rotate credentials|charge)\b/i;
const DEFAULT_ATTEMPTS = 3;

export function maxAutonomousAttempts(raw = process.env.FLYD_COS_MAX_ATTEMPTS): number {
  const value = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(value) ? Math.max(2, Math.min(value, 5)) : DEFAULT_ATTEMPTS;
}

export interface RecoveryInput {
  objective: Pick<Objective, "words" | "brief" | "adaptations" | "urgency"> & Partial<Pick<Objective, "id" | "briefRevision">>;
  run: Pick<PlannedRun, "key" | "team" | "outcome" | "sent" | "attempt" | "prior" | "failure" | "ref">;
  failure: string;
  retryable: boolean;
  /** Code may have executed before it failed; this must be confirmed by the domain's receipt. */
  effectKnownInternal: boolean;
}
export type RecoveryDisposition =
  | { action: "rebrief"; reason: string; evidence?: PredicateEvaluation }
  | { action: "hold"; reason: string; evidence?: PredicateEvaluation };

export interface RecoveryJudgeOptions {
  evaluate?: typeof evaluateExecutivePredicates;
  model?: DecisionModelOptions;
  strategic?: typeof resolveStrategicQuestion;
  maxAttempts?: number;
  /** Existing canonical event store owned by the CoS tick; never a second journal. */
  store?: IntelligenceEventStore;
  /** Injectable interpreter for offline tests; live execution uses the pinned AgentRun package. */
  dslExecutor?: DslExecutor;
  /** Current-objective authority/revision check, called after judgment as well. */
  current?: () => boolean;
  /** For metrics and shadow comparisons; never dispatches a domain run. */
  onDslResult?: (mode: "shadow" | "canary" | "on", result: DslOutcome, comparison?: {
    legacy?: RecoveryDisposition; latencyMs: number;
  }) => void;
}

export function canRecoverInternally(input: RecoveryInput, maxAttempts = maxAutonomousAttempts()): boolean {
  if (!input.retryable || !input.effectKnownInternal) return false;
  if (input.run.team === "life" || input.run.ref?.startsWith("crew:") || input.run.ref?.startsWith("job:")) return false;
  if (input.run.attempt >= maxAttempts) return false;
  if (UNSAFE_EFFECT.test([input.objective.words, input.run.outcome, input.run.sent ?? "", input.failure].join(" "))) return false;
  return true;
}

export async function judgeRecovery(input: RecoveryInput, options: RecoveryJudgeOptions = {}): Promise<RecoveryDisposition> {
  if (!canRecoverInternally(input, options.maxAttempts)) {
    return { action: "hold", reason: "recoveries exhausted or a possible outward effect cannot be safely repeated" };
  }
  const repeated = (input.run.failure ?? "").trim() === input.failure.trim() && Boolean(input.run.failure);
  const state = projectJevState({
    source_kind: "domain_failure",
    source_state: input.run.team,
    summary: input.run.outcome.slice(0, 300),
    question: ("What is the sound next internal recovery after attempt " + input.run.attempt + ": " + input.failure).slice(0, 500),
    options: ["rebrief", "hold"],
    goal_context: (input.objective.brief?.outcome ?? input.objective.words).slice(0, 500),
    evidence_refs: (input.run.prior ?? []).slice(0, 8),
  });
  const flag = process.env.FLYD_COS === "1" ? dslMode() : "off";
  const cohort = String(input.objective.id ?? "") + ":" + input.run.key;
  const selected = flag === "on" || (flag === "canary" && selectedForCanary(cohort));
  const runCandidate = async (shadow = false): Promise<DslOutcome> => {
    return runRecoveryDsl(input, state, {
      store: shadow ? undefined : options.store,
      testOnlyUndurable: shadow || Boolean(options.dslExecutor && !options.store),
      ...(options.dslExecutor ? { executor: options.dslExecutor } : {}),
      evaluate: options.evaluate, model: options.model, current: options.current,
    });
  };
  if (selected) {
    const started = Date.now();
    const chosen = await runCandidate();
    options.onDslResult?.(flag === "on" ? "on" : "canary", chosen, { latencyMs: Date.now() - started });
    // A missing interpreter or Node incompatibility is a *pre-send* fallback.
    // Once a DSL decision may have reached the model, never call it again.
    if (chosen.kind === "hold") return { action: "hold", reason: chosen.reason };
    if (chosen.kind === "decided") {
      if (chosen.action === "hold" && chosen.reason === "low_confidence" &&
          process.env.FLYD_COS_DSL_PRIVATE_REASONING === "1" && options.store &&
          input.objective.id && canRecoverInternally(input, options.maxAttempts) &&
          (options.current?.() ?? true)) {
        // At most one private higher-reasoning request per version/attempt.
        // Its marker is committed before the model call: an interrupted one
        // cannot be repeated after restart. No user-visible escalation.
        const key = createHash("sha256").update(JSON.stringify([
          input.objective.id, input.objective.briefRevision ?? 0,
          input.run.key, input.run.attempt, "cos.dsl.private.v1",
        ])).digest("hex");
        const sourceId = "cos.dsl.private";
        const store = options.store;
        const claimed = store.transaction(() => {
          if (store.findByIdempotencyKey(sourceId, key)) return false;
          const envelope: ContextEnvelope = {
            pathKind: "executive", kind: "executive_decision", sourceId,
            consent: { grantedAt: new Date().toISOString(), scopes: [] },
            retentionClass: "local_default", payloadClassification: "operational",
            provenance: "cos.dsl.private.v1", policyVersion: "cos.dsl.private.v1",
            idempotencyKey: key, correlationId: input.objective.id,
            payload: { phase: "requested", run: input.run.key, attempt: input.run.attempt },
          };
          if (!validateEnvelope(envelope, { consentLookup: store }).ok) return false;
          store.append(envelope);
          return true;
        });
        if (!claimed) return { action: "hold", reason: "private recovery investigation already attempted" };
        const strategy = await (options.strategic ?? resolveStrategicQuestion)({
          domain: input.run.team,
          goal: (input.objective.brief?.outcome ?? input.objective.words).slice(0, 400),
          question: ("A confirmed internal attempt failed: " + input.failure).slice(0, 400),
          options: ["Investigate the internal failure and choose a different bounded repair"],
          evidenceRefs: (input.run.prior ?? []).slice(0, 8),
          screenedInternal: true,
        }, "Fast System-1 recovery judgment was inconclusive").catch(() => ({ kind: "hold" as const, reason: "private review unavailable" }));
        if (strategy.kind === "internal" && canRecoverInternally(input, options.maxAttempts) &&
            (options.current?.() ?? true)) {
          return { action: "rebrief", reason: strategy.message };
        }
        return { action: "hold", reason: strategy.reason };
      }
      return chosen.action === "rebrief"
        ? { action: "rebrief", reason: repeated
            ? "A prior attempt failed identically; use a fundamentally different internal approach and verify it."
            : "Try a different authorized internal approach and verify against done_when." }
        : { action: "hold", reason: chosen.reason };
    }
  }

  const judged = await (options.evaluate ?? evaluateExecutivePredicates)(
    state,
    [questionFor("cos_recovery_tactic")],
    options.model,
    familyEgress("executive"),
  ).catch(() => undefined);
  // The incumbent's result always wins in shadow. We compare without
  // dispatching or mutating the objective and store only non-personal metrics.
  let shadow: DslOutcome | undefined;
  let shadowLatencyMs = 0;
  if (flag === "shadow" && process.env.FLYD_COS_DSL_SHADOW_CALLS === "1") {
    const started = Date.now();
    shadow = await runCandidate(true);
    shadowLatencyMs = Date.now() - started;
  }
  const answer = judged?.answers.cos_recovery_tactic;
  const strongHold = judged?.ok && answer?.confidence !== undefined
    && answer.confidence >= 0.8 && answer.probability >= 0.8
    && answer.choice === "hold_for_evidence";
  const reason = repeated
    ? "A prior attempt failed the same way; choose a fundamentally different internal approach, diagnose the recurring cause, and verify it."
    : "Use the failure evidence to select a different internal approach, then verify against done_when.";
  const legacy: RecoveryDisposition = strongHold
    ? { action: "hold", reason: "the evidence does not justify another attempt", evidence: judged }
    : { action: "rebrief", reason, ...(judged ? { evidence: judged } : {}) };
  if (shadow) options.onDslResult?.("shadow", shadow, { legacy, latencyMs: shadowLatencyMs });
  return legacy;
}
