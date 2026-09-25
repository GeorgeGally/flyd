import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyRoute } from "../../router.js";
import { interpretIntent } from "../interpret.js";
import { PREDICATE_THRESHOLDS, systemOnePolicyFingerprint } from "../system-one/policy.js";
import {
  familyEgress,
  familyQuestions,
  PREDICATE_DEFINITIONS,
  predicateDefinition,
  predicateThreshold,
  questionFingerprint,
  questionFor,
} from "../system-one/registry.js";
import { decide, replayPredicates, type ReplayCase } from "../system-one/replay.js";
import type { JudgmentTrace } from "../system-one/types.js";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

interface Captured { state: Record<string, unknown>; questions: Record<string, unknown>; model: string }

function capture(answers: Record<string, unknown>, sink: Captured[]): typeof fetch {
  return (async (_url: string, init: RequestInit) => {
    sink.push(JSON.parse(String(init.body)) as Captured);
    return { ok: true, status: 200, json: async () => ({ model: "jev-1.13.0", answers, usage: { input_tokens: 10, output_tokens: 1 } }) };
  }) as unknown as typeof fetch;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("System-1 predicate registry", () => {
  it("declares every predicate with a unique id, projection, threshold, failure mode and evaluator version", () => {
    const ids = PREDICATE_DEFINITIONS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const d of PREDICATE_DEFINITIONS) {
      expect(d.instructions.length, d.id).toBeGreaterThan(0);
      expect(d.evaluatorVersion, d.id).toMatch(/\.v\d+$/);
      expect(d.threshold === null || (d.threshold > 0 && d.threshold < 1), d.id).toBe(true);
      expect(d.failureMode, d.id).toBeTruthy();
      expect(Array.isArray(d.projection), d.id).toBe(true);
      if (d.status !== "policy_threshold") expect(d.projection.length, d.id).toBeGreaterThan(0);
      if (d.type === "choice") expect(Object.keys(d.criteria ?? {}).length, d.id).toBeGreaterThanOrEqual(2);
      if (d.use === "gate" || d.use === "argmax") expect(d.threshold, d.id).not.toBeNull();
    }
  });

  it("keeps the policy thresholds byte-identical to the pre-registry table", () => {
    expect(PREDICATE_THRESHOLDS).toEqual({
      same_entity: 0.90,
      evidence_supported: 0.85,
      supersedes_existing_claim: 0.90,
      contradicts_existing_claim: 0.90,
      relevant_to_request: 0.70,
      useful_as_current_context: 0.72,
      requires_current_verification: 0.75,
      is_correction: 0.85,
      changes_current_state: 0.85,
      refers_to_previous_action: 0.80,
      needs_reasoning_model: 0.70,
    });
    expect(predicateThreshold("evidence_supported", "lifecycle")).toBe(0.80);
    expect(predicateThreshold("changes_current_state", "lifecycle")).toBe(0.80);
    expect(predicateThreshold("is_correction", "lifecycle")).toBe(0.85);
    expect(predicateThreshold("consequential")).toBe(0.65);
  });

  it("defines the new predicates for replay only, with no production call site", () => {
    const proposed = ["outcome_supported", "learning_supported_by_trace", "needs_reasoning_model"];
    for (const id of proposed) expect(predicateDefinition(id).status).toBe("proposed");

    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) {
          if (!["__tests__", "evals", "system-one"].includes(entry)) walk(path);
        } else if (path.endsWith(".ts")) {
          const text = readFileSync(path, "utf8");
          for (const id of [...proposed, "invocation_mode", "needs_web"]) {
            if (text.includes(`"${id}"`)) offenders.push(`${relative(SRC, path)}: ${id}`);
          }
        }
      }
    };
    walk(SRC);
    expect(offenders).toEqual([]);
  });

  it("fingerprints questions and the whole policy so wording, threshold or model changes are visible", () => {
    expect(questionFingerprint("current_state")).toMatch(/^[0-9a-f]{16}$/);
    expect(questionFingerprint("current_state")).not.toBe(questionFingerprint("task_resume"));
    expect(systemOnePolicyFingerprint("jev-1.13.0")).not.toBe(systemOnePolicyFingerprint("jev-latest"));
    expect(questionFor("candidate_relevant", { index: 3 }, "candidate_3_relevant")).toEqual({
      id: "candidate_3_relevant",
      instructions: "Is candidate 3 materially useful for answering the user's request now?",
    });
  });
});

describe("System-1 call sites read the registry", () => {
  it("router sends the same questions it asked before the registry", async () => {
    vi.stubEnv("FLYD_JEV_ENABLED", "true");
    vi.stubEnv("TYPESAFE_API_KEY", "test");
    const sink: Captured[] = [];
    vi.stubGlobal("fetch", capture({
      route_kind: { type: "choice", choice: "ask_answer", confidence: 0.9, probabilities: { ask_answer: 0.95 } },
      placement: { type: "choice", choice: "answer_panel", confidence: 0.9, probabilities: { answer_panel: 0.95 } },
      scene: { type: "choice", choice: "concise_answer", confidence: 0.9, probabilities: { concise_answer: 0.95 } },
      target: { type: "choice", choice: "text_in_focus", confidence: 0.9, probabilities: { text_in_focus: 0.95 } },
      consequential: { type: "noul", noul: 0.1 },
    }, sink));

    const route = await classifyRoute("what is a monad", { appName: "Chrome", elementRole: "AXStaticText" }, "text", null);
    expect(route?.route.kind).toBe("ask_answer");
    expect(Object.keys(sink[0].state)).toEqual(["intent", "app_name", "element_role", "modality"]);
    expect(sink[0].questions).toEqual(Object.fromEntries(familyQuestions("router").map((q) => [q.id, {
      type: q.type ?? "noul",
      instructions: q.instructions,
      criteria: q.criteria ?? { true: "The state satisfies this criterion.", false: "The state does not satisfy this criterion." },
    }])));
    expect(sink[0].questions).toMatchObject({
      route_kind: { type: "choice", instructions: "Choose the overlay route kind that best matches the user's intent.", criteria: {
        ask_answer: "The user wants an answer or explanation shown to them.",
        draft_insert: "The user wants composed or rewritten text inserted into the focused field.",
        dictate_insert: "The user is dictating text to insert nearly verbatim.",
      } },
      consequential: { type: "noul", instructions: "Would fulfilling this intent itself send, submit, publish, purchase, delete, deploy, or otherwise act outside the focused text field?" },
      verb_publish: { type: "noul", instructions: "Does the consequential action publish or deploy something?" },
    });
    expect(Object.keys(sink[0].questions)).toEqual([
      "route_kind", "placement", "scene", "purpose", "consequential", "target",
      "verb_create", "verb_modify", "verb_send", "verb_purchase", "verb_delete", "verb_publish",
    ]);
  });

  it("curator asks the same five questions it asked before the registry", () => {
    expect(familyQuestions("curator")).toEqual([
      { id: "is_correction", instructions: "Is the user correcting a prior fact, assumption, task, or current state?" },
      { id: "changes_current_state", instructions: "Does the statement materially change what is currently true or actionable?" },
      { id: "marks_completed", instructions: "Does the user explicitly state that the referenced project/event/task is completed, over, finished, or already happened?" },
      { id: "marks_cancelled", instructions: "Does the user explicitly state that the referenced project/event/task is cancelled or no longer happening?" },
      { id: "evidence_supported", instructions: "Is the proposed state change directly supported by the user's statement itself?" },
    ]);
    expect(familyEgress("curator").allowedFields).toEqual(["statement", "project_ids", "intent_kind", "temporal_frame", "referents", "source_event"]);
  });

  it("interpretation sends no regex guess and scopes its questions to the user's own state", async () => {
    const sink: Captured[] = [];
    const interpretation = await interpretIntent("who runs OpenAI now", {
      jev: { apiKey: "test", fetchFn: capture({ current_state: { noul: 0.02 }, action: { noul: 0.05 }, correction: { noul: 0.01 }, task_resume: { noul: 0.01 }, historical_recall: { noul: 0.03 } }, sink) },
    });
    expect(sink[0].state).toEqual({ utterance: "who runs OpenAI now", conversation_recap: "" });
    expect(Object.keys(sink[0].questions)).toEqual([
      "current_state", "task_resume", "historical_recall", "action", "correction", "needs_deep_memory", "needs_current_state",
    ]);
    expect(JSON.stringify(sink[0].questions.current_state)).toMatch(/their own current work/);
    expect(JSON.stringify(sink[0].questions.needs_current_state)).toMatch(/user's own current work state/);
    expect(interpretation.source).toBe("deterministic");
  });
});

describe("System-1 replay harness", () => {
  const cases: ReplayCase[] = [
    { id: "a", suite: "unit", synthetic: true, inputs: { utterance: "hi", conversation_recap: "" }, labels: { current_state: false } },
    { id: "b", suite: "unit", synthetic: true, inputs: { utterance: "what am I doing", conversation_recap: "" }, labels: { current_state: true } },
  ];
  const trace = (caseId: string, noul: number, fingerprint = questionFingerprint("current_state")): JudgmentTrace => ({
    caseId, predicateId: "current_state", evaluatorVersion: predicateDefinition("current_state").evaluatorVersion,
    questionFingerprint: fingerprint, projectionHash: "x", model: "jev-1.13.0",
    answer: { type: "noul", noul }, latencyMs: 300, recordedAt: "2026-09-25T00:00:00.000Z",
  });

  it("decides with an abstain band around the threshold", () => {
    const noul = predicateDefinition("current_state");
    expect(decide(noul, { id: "x", probability: 0.71, confidence: 0 })).toBe(true);
    expect(decide(noul, { id: "x", probability: 0.29, confidence: 0 })).toBe(false);
    expect(decide(noul, { id: "x", probability: 0.5, confidence: 0 })).toBe("abstain");
    expect(decide(predicateDefinition("invocation_mode"), { id: "x", probability: 0.6, confidence: 0.5, choice: "recall" })).toBe("abstain");
    expect(decide(predicateDefinition("route_kind"), { id: "x", probability: 0.6, confidence: 0.1, choice: "ask_answer" })).toBe("ask_answer");
  });

  it("scores recorded judgments against labels and the current behaviour, and flags stale recordings", async () => {
    const report = await replayPredicates(cases, {
      mode: "recorded",
      recordings: [trace("a", 0.1), trace("b", 0.9, "0000000000000000")],
      baselines: { current_state: () => false },
    });
    const [p] = report.predicates;
    expect(p.unreplayable.stale).toEqual(["b"]);
    expect(p.jev).toMatchObject({ correct: 1, abstained: 1, accuracy: 0.5, decidedAccuracy: 1, latencyMs: { p50: 300, p90: 300 } });
    expect(p.baseline).toMatchObject({ available: true, correct: 1, wrong: 1, accuracy: 0.5 });
    expect(p.hybrid).toEqual({ correct: 1, accuracy: 0.5 });
  });

  it("refuses a case that lacks a field its predicate projects", async () => {
    await expect(replayPredicates([{ ...cases[0], inputs: { utterance: "hi" } }], { mode: "recorded" })).rejects.toThrow(/lacks field "conversation_recap"/);
  });
});
