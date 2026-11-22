import { createHash } from "node:crypto";
import { validateEnvelope, type ContextEnvelope } from "../../../intelligence/context-envelope.js";
import type { IntelligenceEventStore } from "../../../intelligence/event-store.js";
import type { RecoveryDisposition, RecoveryInput } from "../recovery.js";
import type { DslOutcome, DslMode } from "./recovery-runner.js";
import { recoveryWorkflowDigest, RECOVERY_WORKFLOW_POLICY } from "./recovery-workflow.js";

const SOURCE = "cos.dsl.rollout";

/** Audit only disposition categories and measured latency, never prompt/state,
 * raw receipts, trace errors, source text, private evidence or model tokens. */
export function recordDslRollout(
  store: IntelligenceEventStore,
  input: RecoveryInput,
  mode: Exclude<DslMode, "off">,
  candidate: DslOutcome,
  comparison?: { legacy?: RecoveryDisposition; latencyMs: number },
): boolean {
  if (!input.objective.id || !Number.isFinite(input.run.attempt)) return false;
  const digest = recoveryWorkflowDigest();
  const key = createHash("sha256").update(JSON.stringify([
    input.objective.id, input.objective.briefRevision ?? 0,
    input.run.key, input.run.attempt, mode, digest,
  ])).digest("hex");
  const envelope: ContextEnvelope = {
    pathKind: "executive", kind: "policy_event", sourceId: SOURCE,
    consent: { grantedAt: new Date().toISOString(), scopes: [] },
    retentionClass: "local_default", payloadClassification: "operational",
    provenance: RECOVERY_WORKFLOW_POLICY, policyVersion: RECOVERY_WORKFLOW_POLICY,
    idempotencyKey: key, correlationId: input.objective.id,
    payload: {
      mode, workflow: digest, candidate: candidate.kind,
      candidateAction: candidate.kind === "decided" ? candidate.action : null,
      legacyAction: comparison?.legacy?.action ?? null,
      latencyMs: typeof comparison?.latencyMs === "number" && Number.isFinite(comparison.latencyMs)
        ? Math.max(0, Math.round(comparison.latencyMs)) : null,
      replayed: candidate.kind === "decided" ? candidate.replayed : null,
    },
  };
  const valid = validateEnvelope(envelope, { consentLookup: store });
  if (!valid.ok) return false;
  store.append(envelope);
  return true;
}
