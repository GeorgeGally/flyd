import { createHash } from "node:crypto";
import { predicateThreshold, questionFingerprint, questionFor } from "../../../cognition/system-one/registry.js";
import { RECOVERY_PREDICATE } from "./system-one-contract.js";

/**
 * One source-controlled workflow. Never load DSL documents from the web,
 * user input, model output or connected apps. A DSL result is only a CoS
 * recommendation, not an execution grant or a durable objective.
 */
export const RECOVERY_WORKFLOW_VERSION = "cos-internal-recovery-v1";
export const RECOVERY_DSL_PACKAGE_VERSION = "0.1.0-beta.43";
export const RECOVERY_WORKFLOW_POLICY = "cos.dsl.recovery.v1";

export function recoveryWorkflow(): Record<string, unknown> {
  const q = questionFor(RECOVERY_PREDICATE);
  const gate = predicateThreshold(RECOVERY_PREDICATE);
  const labels = Object.keys(q.criteria as Record<string, string>);
  // This is intentionally audited code, fixed in the repository. There is no
  // authoring interface, and the interpreter has no shell/HTTP/write adapter.
  const gateCode = "(s) => { const a = s['judgment$answers']?.answers?.cos_recovery_tactic; " +
    "const p = a?.probabilities?.[a?.choice]; " +
    "const allowed = s.evidence.verified === true && a?.type === 'choice' && " +
    "a.choice === 'rebrief_with_different_tactic' && Number.isFinite(a.confidence) && " +
    "Number.isFinite(p) && a.confidence >= " + gate + " && p >= " + gate + "; " +
    "return { safeRoute: allowed ? 'rebrief' : 'hold' }; }";
  return {
    v: 2, name: RECOVERY_WORKFLOW_VERSION,
    schemas: {
      Input: {
        type: "object", additionalProperties: false,
        properties: {
          sourceKey: { type: "string" }, source_state: { type: "string" },
          summary: { type: "string" }, question: { type: "string" },
          options: { type: "array", items: { type: "string" } },
          goal_context: { type: "string" },
        },
        required: ["sourceKey", "source_state", "summary", "question", "options", "goal_context"],
      },
      Evidence: {
        type: "object", additionalProperties: false,
        properties: {
          verified: { type: "boolean" },
          references: { type: "array", items: { type: "string" } },
        }, required: ["verified", "references"],
      },
      Decision: {
        type: "object", additionalProperties: false,
        properties: {
          [RECOVERY_PREDICATE]: {
            type: "string", enum: labels, description: q.instructions,
            criteria: q.criteria,
          },
        }, required: [RECOVERY_PREDICATE],
      },
      Result: {
        type: "object", additionalProperties: false,
        properties: {
          action: { type: "string", enum: ["rebrief", "hold"] },
        }, required: ["action"],
      },
    },
    input: { schemaId: "Input" },
    output: { schemaId: "Result", path: "result" },
    root: { node: "chain", steps: [
      {
        node: "call", label: "read-current-internal-receipt",
        via: "tool", tool: "cos.internal-evidence",
        args: { key: "{sourceKey}" }, out: "Evidence", as: "evidence",
        deadline_s: 5, retry: { attempts: 1 },
      },
      {
        node: "judge", label: "select-bounded-recovery", out: "Decision",
        as: "judgment", state: {
          source_kind: "domain_failure",
          source_state: "{source_state}",
          summary: "{summary}", question: "{question}",
          options: "{options}", goal_context: "{goal_context}",
          evidence_refs: "{evidence.references}",
        },
      },
      { node: "code", label: "host-owned-policy-gate", code: gateCode },
      {
        node: "route", label: "return-only-a-recommendation",
        valuePath: "safeRoute", otherwise: "hold",
        branches: {
          rebrief: { body: { node: "code", label: "candidate-rebrief",
            code: "() => ({ result: { action: 'rebrief' } })" } },
          hold: { body: { node: "code", label: "candidate-hold",
            code: "() => ({ result: { action: 'hold' } })" } },
        },
      },
    ] },
  };
}

export function recoveryWorkflowDigest(): string {
  return createHash("sha256")
    .update(JSON.stringify({
      workflow: recoveryWorkflow(),
      version: RECOVERY_DSL_PACKAGE_VERSION,
      question: questionFingerprint(RECOVERY_PREDICATE),
      policy: RECOVERY_WORKFLOW_POLICY,
    })).digest("hex");
}
