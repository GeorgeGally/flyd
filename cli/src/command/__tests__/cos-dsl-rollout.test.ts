import { afterEach, describe, expect, it } from "vitest";
import { IntelligenceEventStore } from "../../intelligence/event-store.js";
import { questionFor, predicateThreshold } from "../../cognition/system-one/registry.js";
import type { PredicateEvaluation } from "../../cognition/system-one/types.js";
import { judgeRecovery, type RecoveryInput } from "../cos/recovery.js";
import {
  dslMode, runRecoveryDsl, selectedForCanary, supportsAgentRunNode, type DslExecutor,
} from "../cos/decision-workflows/recovery-runner.js";
import { recoveryWorkflow, recoveryWorkflowDigest } from "../cos/decision-workflows/recovery-workflow.js";
import { recordDslRollout } from "../cos/decision-workflows/rollout-audit.js";

const input: RecoveryInput = {
  objective: {
    id: "obj-dsl-test", briefRevision: 2,
    words: "Fix the component test", adaptations: [],
  },
  run: { key: "r1", team: "coding", outcome: "Fix unit test", attempt: 1, ref: "domain-run-internal" },
  failure: "component test fails", retryable: true, effectKnownInternal: true,
};
const q = questionFor("cos_recovery_tactic");
function evaluation(choice = "rebrief_with_different_tactic", p = 0.97): PredicateEvaluation {
  return {
    evaluator: "jev", ok: true, rubricVersion: "test",
    projectionHash: "opaque", latencyMs: 1, evaluatedAt: "2026-11-22T00:00:00Z",
    answers: {
      cos_recovery_tactic: {
        id: "cos_recovery_tactic", type: "choice", choice, probability: p, confidence: p,
        probabilities: {
          rebrief_with_different_tactic: choice === "rebrief_with_different_tactic" ? p : 1 - p,
          hold_for_evidence: choice === "hold_for_evidence" ? p : 1 - p,
        },
      },
    },
  };
}
const adapter: DslExecutor = {
  validateWorkflow: () => ({ ok: true }),
  async runWorkflow(_workflow, _input, deps) {
    const a = await deps.runEffect({
      node: { via: "tool", tool: "cos.internal-evidence" },
      input: { key: _input.sourceKey },
    });
    const result = await deps.runJudge({
      kind: "judge",
      state: {
        source_kind: "domain_failure",
        source_state: _input.source_state,
        summary: _input.summary,
        question: _input.question,
        options: _input.options,
        goal_context: _input.goal_context,
        evidence_refs: a.references,
      },
      questions: {
        cos_recovery_tactic: { type: "choice", instructions: q.instructions, criteria: q.criteria },
      },
    });
    const answer = result.answers.cos_recovery_tactic;
    await deps.recordDecision({
      status: "answered", id: "decision-stable", state_sha256: "redacted-hash",
      answers: result.answers, model: result.model, cost_usd: result.cost_usd,
    });
    const gate = predicateThreshold("cos_recovery_tactic");
    const allowed = a.verified && answer.choice === "rebrief_with_different_tactic"
      && answer.confidence >= gate && answer.probabilities[answer.choice] >= gate;
    return { status: "complete", output: { action: allowed ? "rebrief" : "hold" } };
  },
};
const old = {
  FLYD_COS: process.env.FLYD_COS,
  FLYD_COS_DECISION_DSL: process.env.FLYD_COS_DECISION_DSL,
  FLYD_COS_DSL_SHADOW_CALLS: process.env.FLYD_COS_DSL_SHADOW_CALLS,
  FLYD_COS_DSL_CANARY_PERCENT: process.env.FLYD_COS_DSL_CANARY_PERCENT,
  FLYD_COS_DSL_PRIVATE_REASONING: process.env.FLYD_COS_DSL_PRIVATE_REASONING,
};
afterEach(() => {
  for (const [key, value] of Object.entries(old)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("bounded live CoS DSL rollout", () => {
  it("has a source-controlled v2 workflow with no external-effect nodes", () => {
    const doc = recoveryWorkflow();
    expect(doc.v).toBe(2);
    expect(recoveryWorkflowDigest()).toMatch(/^[a-f0-9]{64}$/);
    const serialized = JSON.stringify(doc);
    expect(serialized).not.toMatch(/"via":"shell"|"tool":"send"|"tool":"exec"/);
    expect(serialized).toContain("cos.internal-evidence");
  });

  it("defaults to off; cohort selection is deterministic and false for invalid percentages", () => {
    expect(dslMode("unknown")).toBe("off");
    expect(selectedForCanary("objective:r1", "0")).toBe(false);
    expect(selectedForCanary("objective:r1", "abc")).toBe(false);
    expect(selectedForCanary("objective:r1", "100")).toBe(true);
    expect(selectedForCanary("objective:r1", "13")).toBe(selectedForCanary("objective:r1", "13"));
    expect(supportsAgentRunNode("22.16.0")).toBe(false);
    expect(supportsAgentRunNode("24.22.2")).toBe(false);
    expect(supportsAgentRunNode("24.22.3")).toBe(true);
  });

  it("writes an idempotent, redacted decision before branching and reuses it after restart", async () => {
    const store = new IntelligenceEventStore({ path: ":memory:" });
    let calls = 0;
    const options = {
      store, executor: adapter,
      evaluate: async () => { calls++; return evaluation(); },
    };
    try {
      const first = await runRecoveryDsl(input, {
        source_state: "coding", summary: "private secret sk-not-allowed-in-a-record",
        question: "Fix test", options: ["rebrief", "hold"],
        goal_context: "Fix code",
      }, options);
      expect(first).toMatchObject({ kind: "decided", action: "rebrief", replayed: false });
      expect(calls).toBe(1);
      const second = await runRecoveryDsl(input, {
        source_state: "coding", summary: "private secret sk-not-allowed-in-a-record",
        question: "Fix test", options: ["rebrief", "hold"],
        goal_context: "Fix code",
      }, options);
      expect(second).toMatchObject({ kind: "decided", action: "rebrief", replayed: true });
      expect(calls).toBe(1);
      const all = store.readSource("cos.dsl.recovery");
      expect(all).toHaveLength(2);
      const payloads = JSON.stringify(all);
      expect(payloads).not.toContain("sk-not-allowed-in-a-record");
      expect(payloads).not.toContain("Fix test");
      expect(payloads).not.toContain("private secret");
      expect(all.map((e) => e.payload?.phase)).toEqual(["started", "answered"]);
    } finally { store.close(); }
  });

  it("never reuses a prior decision after provider policy or source consent changes", async () => {
    const store = new IntelligenceEventStore({ path: ":memory:" });
    const state = {
      source_state: "coding", summary: "test", question: "safe recovery",
      options: ["rebrief", "hold"], goal_context: "test",
    };
    let calls = 0;
    try {
      const initial = await runRecoveryDsl(input, state, {
        store, executor: adapter, model: { provider: "jev", model: "jev-1.13.0" },
        evaluate: async () => { calls++; return evaluation(); },
      });
      expect(initial.kind).toBe("decided");
      const changed = await runRecoveryDsl(input, state, {
        store, executor: adapter, model: { provider: "gemini", model: "gemini-decision-1" },
        evaluate: async () => { calls++; return evaluation(); },
      });
      expect(changed.kind).toBe("decided");
      expect(calls).toBe(2); // separate version-bound requests, never stale replay
      store.eraseSource("domain-run:" + input.run.ref);
      const revoked = await runRecoveryDsl(input, state, {
        store, executor: adapter, model: { provider: "jev", model: "jev-1.13.0" },
        evaluate: async () => { calls++; return evaluation(); },
      });
      expect(revoked.kind).toBe("hold");
      expect(calls).toBe(2);
    } finally { store.close(); }
  });

  it("records an uncertain provider request once and never asks a second time", async () => {
    const store = new IntelligenceEventStore({ path: ":memory:" });
    let calls = 0;
    const options = {
      store, executor: adapter,
      evaluate: async (): Promise<PredicateEvaluation> => {
        calls++; return { ...evaluation(), ok: false, answers: {}, error: "jev_http_503" };
      },
    };
    try {
      const first = await runRecoveryDsl(input, { source_state: "coding", summary: "test", question: "fix",
        options: ["rebrief", "hold"], goal_context: "test" }, options);
      expect(first.kind).toBe("hold");
      const second = await runRecoveryDsl(input, { source_state: "coding", summary: "test", question: "fix",
        options: ["rebrief", "hold"], goal_context: "test" }, options);
      expect(second.kind).toBe("hold");
      expect(calls).toBe(1);
    } finally { store.close(); }
  });

  it("records only rollout categories and latency, never source text or raw prompts", () => {
    const store = new IntelligenceEventStore({ path: ":memory:" });
    try {
      const decision = { kind: "decided" as const, action: "rebrief" as const, reason: "sensitive recovery secret", replayed: false };
      const comparison = {
        legacy: { action: "hold" as const, reason: "private source content" },
        latencyMs: 12.4,
      };
      expect(recordDslRollout(store, input, "shadow", decision, comparison)).toBe(true);
      expect(recordDslRollout(store, input, "shadow", decision, comparison)).toBe(true);
      const logs = store.readSource("cos.dsl.rollout");
      expect(logs).toHaveLength(1);
      expect(logs[0]?.payload).toMatchObject({
        mode: "shadow", candidate: "decided", candidateAction: "rebrief",
        legacyAction: "hold", latencyMs: 12,
      });
      expect(JSON.stringify(logs)).not.toContain("sensitive recovery secret");
      expect(JSON.stringify(logs)).not.toContain("private source content");
      expect(JSON.stringify(logs)).not.toContain(input.objective.words);
    } finally { store.close(); }
  });

  it("atomically claims the judge request so concurrent CoS ticks cannot double-call", async () => {
    const store = new IntelligenceEventStore({ path: ":memory:" });
    const state = {
      source_state: "coding", summary: "test", question: "safe recovery",
      options: ["rebrief", "hold"], goal_context: "test",
    };
    let calls = 0;
    let release!: () => void;
    const pause = new Promise<void>((resolve) => { release = resolve; });
    const options = {
      store, executor: adapter,
      evaluate: async () => { calls++; await pause; return evaluation(); },
    };
    try {
      const first = runRecoveryDsl(input, state, options);
      const second = runRecoveryDsl(input, state, options);
      // Both invocations have been started before releasing the sole judge.
      release();
      const [a, b] = await Promise.all([first, second]);
      expect([a.kind, b.kind].sort()).toEqual(["decided", "hold"]);
      expect(calls).toBe(1);
    } finally { store.close(); }
  });

  it("rejects a changed objective without starting a provider call", async () => {
    let calls = 0;
    const result = await runRecoveryDsl(input, {}, {
      executor: adapter, testOnlyUndurable: true,
      current: () => false, evaluate: async () => { calls++; return evaluation(); },
    });
    expect(result.kind).toBe("hold");
    expect(calls).toBe(0);
  });

  it("keeps legacy recovery with the switch off, and safely holds protected work", async () => {
    process.env.FLYD_COS = "1";
    process.env.FLYD_COS_DECISION_DSL = "off";
    let calls = 0;
    const run = () => judgeRecovery(input, { dslExecutor: adapter, evaluate: async () => { calls++; return evaluation(); } });
    expect((await run()).action).toBe("rebrief");
    expect(calls).toBe(1);
    process.env.FLYD_COS_DECISION_DSL = "on";
    const forbidden = { ...input, objective: { ...input.objective, words: "Send email to client" } };
    expect((await judgeRecovery(forbidden, { dslExecutor: adapter, evaluate: async () => {
      calls++; return evaluation();
    } })).action).toBe("hold");
    expect(calls).toBe(1);
  });

  it("uses one live DSL path and does not double-call the legacy provider", async () => {
    process.env.FLYD_COS = "1";
    process.env.FLYD_COS_DECISION_DSL = "on";
    const store = new IntelligenceEventStore({ path: ":memory:" });
    let calls = 0;
    try {
      const selected = await judgeRecovery(input, {
        store, dslExecutor: adapter,
        evaluate: async () => { calls++; return evaluation(); },
      });
      expect(selected.action).toBe("rebrief");
      expect(calls).toBe(1);
    } finally { store.close(); }
  });

  it("escalates computational effort privately once, not George's attention", async () => {
    process.env.FLYD_COS = "1";
    process.env.FLYD_COS_DECISION_DSL = "on";
    process.env.FLYD_COS_DSL_PRIVATE_REASONING = "1";
    const store = new IntelligenceEventStore({ path: ":memory:" });
    let fastCalls = 0, privateCalls = 0;
    const opts = {
      store, dslExecutor: adapter,
      evaluate: async () => { fastCalls++; return evaluation("rebrief_with_different_tactic", 0.5); },
      strategic: async () => {
        privateCalls++;
        return { kind: "internal" as const, reason: "test", message: "Investigate new evidence and verify." };
      },
    };
    try {
      const first = await judgeRecovery(input, opts);
      expect(first.action).toBe("rebrief");
      expect(first.reason).toMatch(/Investigate new evidence/);
      const second = await judgeRecovery(input, opts);
      expect(second.action).toBe("hold");
      expect(fastCalls).toBe(1);
      expect(privateCalls).toBe(1);
      const trail = store.readSource("cos.dsl.private");
      expect(trail).toHaveLength(1);
      expect(JSON.stringify(trail)).not.toContain(input.failure);
    } finally { store.close(); }
  });

  it("keeps shadow candidate decisions invisible and opt-in", async () => {
    process.env.FLYD_COS = "1";
    process.env.FLYD_COS_DECISION_DSL = "shadow";
    let calls = 0; const shadows: string[] = [];
    const options = {
      dslExecutor: adapter,
      evaluate: async () => { calls++; return evaluation("hold_for_evidence", 0.96); },
      onDslResult: (_mode: "shadow" | "canary" | "on", result: {kind:string}) => { shadows.push(result.kind); },
    };
    expect((await judgeRecovery(input, options)).action).toBe("hold");
    expect(calls).toBe(1);
    process.env.FLYD_COS_DSL_SHADOW_CALLS = "1";
    expect((await judgeRecovery(input, options)).action).toBe("hold");
    expect(calls).toBe(3);
    expect(shadows).toEqual(["decided"]);
  });

  it("falls back to the legacy handler when a compatible interpreter is unavailable", async () => {
    process.env.FLYD_COS = "1";
    process.env.FLYD_COS_DECISION_DSL = "on";
    // No injected Node 24 interpreter and no decision store; this is proven pre-send.
    const decision = await judgeRecovery(input, { evaluate: async () => evaluation() });
    expect(decision.action).toBe("rebrief");
  });
});
