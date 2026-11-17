/**
 * Real AgentRun interpreter -> actual Flyd System-1 contract.
 * Runs offline: injected model, read-only evidence, no CoS dispatch.
 * Invoke with tsx from cli/ after installing the pinned experiment package.
 */
import assert from "node:assert/strict";
import { runWorkflow, validateWorkflow } from "@parcha/agentrun-dsl";
import {
  createRecoveryDslJudge, PilotJudgmentError, RECOVERY_PREDICATE,
} from "../../cli/src/command/cos/decision-workflows/system-one-contract.js";
import { questionFor, predicateThreshold } from "../../cli/src/cognition/system-one/registry.js";
import type { PredicateEvaluation } from "../../cli/src/cognition/system-one/types.js";

const q = questionFor(RECOVERY_PREDICATE);
const criteria = q.criteria as Record<string, string>;
const gate = predicateThreshold(RECOVERY_PREDICATE);

const workflow = {
  v: 2,
  name: "flyd-recovery-bridge-offline",
  schemas: {
    Input: {
      type: "object", additionalProperties: false,
      properties: {
        domain: { type: "string" },
        summary: { type: "string" },
        question: { type: "string" },
        options: { type: "array", items: { type: "string" } },
        goal_context: { type: "string" },
      },
      required: ["domain", "summary", "question", "options", "goal_context"],
    },
    Source: {
      type: "object", additionalProperties: false,
      properties: {
        verified: { type: "boolean" },
        references: { type: "array", items: { type: "string" } },
      },
      required: ["verified", "references"],
    },
    Decision: {
      type: "object", additionalProperties: false,
      properties: {
        [RECOVERY_PREDICATE]: {
          type: "string", enum: Object.keys(criteria),
          description: q.instructions, criteria,
        },
      },
      required: [RECOVERY_PREDICATE],
    },
    Result: {
      type: "object", additionalProperties: false,
      properties: { action: { type: "string" }, reason: { type: "string" } },
      required: ["action", "reason"],
    },
  },
  input: { schemaId: "Input" },
  output: { schemaId: "Result", path: "result" },
  root: {
    node: "chain", steps: [
      { node: "call", label: "read-existing-internal-receipt",
        via: "tool", tool: "read.internal.receipt",
        args: { domain: "{domain}" }, out: "Source", as: "source", deadline_s: 5 },
      { node: "judge", label: "flyd-approved-recovery-question",
        out: "Decision", as: "judgment",
        state: {
          source_kind: "domain_failure",
          source_state: "{domain}",
          summary: "{summary}",
          question: "{question}",
          options: "{options}",
          goal_context: "{goal_context}",
          evidence_refs: "{source.references}",
        },
      },
      { node: "code", label: "enforce-flyd-policy",
        code: "(s) => { const a = s['judgment$answers']?.answers?.cos_recovery_tactic; const ok = s.source.verified === true && a?.type === 'choice' && a.choice === 'rebrief_with_different_tactic' && a.confidence >= " + gate + " && a.probabilities?.[a.choice] >= " + gate + "; return { safeRoute: ok ? 'rebrief' : 'hold' }; }",
      },
      { node: "route", label: "return-only-a-proposal", valuePath: "safeRoute",
        otherwise: "hold", branches: {
          rebrief: { body: { node: "code", label: "rebrief-proposal",
            code: "() => ({ result: { action: 'rebrief', reason: 'CoS still owns authorization and verification' } })" } },
          hold: { body: { node: "code", label: "safe-hold",
            code: "() => ({ result: { action: 'hold', reason: 'Evidence or policy insufficient' } })" } },
        },
      },
    ],
  },
};

const input = {
  domain: "coding",
  summary: "An internal component test failed",
  question: "What is the sound next internal recovery?",
  options: ["rebrief", "hold"],
  goal_context: "Make the component test pass",
};

function fakeEvaluation(probability: number, confidence: number): PredicateEvaluation {
  return {
    ok: true, evaluator: "jev", model: "fake-offline",
    rubricVersion: "test", projectionHash: "redacted-hash",
    evaluatedAt: new Date(0).toISOString(), latencyMs: 1,
    answers: {
      [RECOVERY_PREDICATE]: {
        id: RECOVERY_PREDICATE, type: "choice", choice: "rebrief_with_different_tactic",
        probability, confidence,
        probabilities: {
          rebrief_with_different_tactic: probability,
          hold_for_evidence: 1 - probability,
        },
      },
    },
  };
}

async function example(probability: number, verified: boolean, modelFailed = false) {
  let sent = 0, read = 0;
  const receipts: Array<{ id: string; status: string; state_sha256: string }> = [];
  const judge = createRecoveryDslJudge({
    evaluate: async () => {
      sent++;
      if (modelFailed) return { ...fakeEvaluation(0, 0), ok: false, answers: {}, error: "jev_http_503" };
      return fakeEvaluation(probability, probability);
    },
  });
  const deps = {
    runEffect: async ({ node }: { node: { tool: string } }) => {
      read++;
      assert.equal(node.tool, "read.internal.receipt");
      return { verified, references: ["domain-run:internal-r1"] };
    },
    runJudge: judge,
    recordDecision: async (receipt: { id: string; status: string; state_sha256: string }) => {
      // Keep only the canonical metadata fields; not raw state, question or evidence.
      receipts.push({ id: receipt.id, status: receipt.status, state_sha256: receipt.state_sha256 });
    },
  };
  const result = await runWorkflow(workflow as any, input, deps as any);
  assert.equal(read, 1);
  assert.equal(sent, 1);
  assert.equal(receipts.length, 1);
  assert.equal(Object.keys(receipts[0]!).includes("state"), false);
  return result;
}

const validation = validateWorkflow(workflow as any);
assert.equal(validation.ok, true, JSON.stringify(validation));
const good = await example(0.93, true);
assert.equal(good.status, "complete");
assert.equal(good.output?.action, "rebrief");
const uncertain = await example(0.5, true);
assert.equal(uncertain.status, "complete");
assert.equal(uncertain.output?.action, "hold");
const missing = await example(0.99, false);
assert.equal(missing.status, "complete");
assert.equal(missing.output?.action, "hold");
await assert.rejects(() => example(0.95, true, true));
console.log("Flyd System-1 ↔ AgentRun v2 offline integration: PASS");
