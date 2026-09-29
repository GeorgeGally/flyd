import { museCandidates } from "../council/muse.js";
import { existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { deterministicInterpretation } from "../cognition/interpret.js";
import { explicitLifecycleStatus } from "../cognition/curator/reconcile.js";
import { JEV_PINNED_MODEL } from "../cognition/system-one/jev.js";
import { PREDICATE_DEFINITIONS } from "../cognition/system-one/registry.js";
import {
  formatReplayReport,
  loadJudgmentTraces,
  loadReplayCases,
  replayPredicates,
  serializeJudgmentTraces,
  type BaselineFn,
  type ReplayReport,
} from "../cognition/system-one/replay.js";
import { classifyEvidenceNeed } from "../evidence/evidence-need.js";
import { memoryGate } from "../memory-gate.js";
import { routeIntent } from "../resolve.js";
import { isCompoundNlUtterance } from "../work-intelligence/compound-nl.js";
import { editableEnvironment, nonEditableEnvironment } from "./helpers.js";

// System-1 replay bench: every Jev predicate is scored against labelled,
// synthetic traces next to FLYD's current non-Jev behaviour before it is
// switched on. Deterministic by default (recorded Jev answers replayed
// through the real client). Live only with FLYD_JEV_EVAL=1 and
// TYPESAFE_API_KEY; set FLYD_JEV_EVAL_RECORD=<path> to freeze the fresh
// answers as the next recordings.

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "system-one");
const SUITES = ["front-door.jsonl", "curator-lifecycle.jsonl", "trace-predicates.jsonl", "council.jsonl", "chat-turn.jsonl", "skill-match.jsonl"];
const RECORDINGS = join(FIXTURES, "recordings.jsonl");
const LIVE = process.env.FLYD_JEV_EVAL === "1" && Boolean(process.env.TYPESAFE_API_KEY);

const text = (inputs: Record<string, unknown>, field: string) => String(inputs[field] ?? "");

// Current behaviour for each predicate, read from the production code paths.
const BASELINES: Record<string, BaselineFn> = {
  // /manifest (server.ts handleManifest): a type/write/dictate/insert prefix
  // reaches resolve(); compound NL gets a deterministic card; everything
  // else goes to Work-Intelligence.
  invocation_mode: (inputs) => {
    const utterance = text(inputs, "utterance");
    if (/^(type|write|dictate|insert)\s/i.test(utterance)) return "insert";
    if (isCompoundNlUtterance(utterance)) return null;
    return "work_help";
  },
  needs_web: (inputs) =>
    classifyEvidenceNeed({ intent: text(inputs, "utterance"), routeKind: "ask_answer", locators: [] }).level !== "none",
  route_kind: (inputs) => {
    const env = inputs.element_role === "AXTextArea" ? editableEnvironment() : nonEditableEnvironment();
    env.application.name = text(inputs, "app_name");
    return routeIntent(text(inputs, "intent"), env, "text").kind;
  },
  current_state: (inputs) => deterministicInterpretation(text(inputs, "utterance")).intentKind === "current_state",
  // Jev off: lifecycle claims follow the regex alone (corroboration fails open).
  marks_completed: (inputs) => explicitLifecycleStatus(text(inputs, "statement")) === "completed",
  marks_cancelled: (inputs) => explicitLifecycleStatus(text(inputs, "statement")) === "cancelled",
  learning_supported_by_trace: (inputs) => {
    const trace = inputs.trace as { utterance: string; correction: string | null; outcome_status: string | null };
    return memoryGate({
      intent: trace.utterance,
      resolutionMode: "augment",
      outcomeStatus: trace.outcome_status,
      correction: trace.correction,
      intentHistory: [],
      topicCount: 0,
    }).shouldRemember;
  },
  // Muse today: any local candidate with enough term overlap reaches the Muse model.
  muse_should_speak: (inputs) => museCandidates(text(inputs, "message"), text(inputs, "answer"), {
    advisories: [], notes: [],
    memory: [{ id: "c", section: "Facts", text: text(inputs, "candidate"), tier: "aging", date: "2026-09-27" }],
  }).length > 0,
  // Every invocation that reaches a model uses the main model today.
  needs_reasoning_model: () => true,
  // outcome_supported: the incumbent is an LLM judge (transitions/judge.ts); no deterministic baseline.
};

const cases = SUITES.flatMap((suite) => loadReplayCases(join(FIXTURES, suite)));

async function runReplay(): Promise<ReplayReport> {
  if (LIVE) {
    return replayPredicates(cases, {
      mode: "live",
      jev: { apiKey: process.env.TYPESAFE_API_KEY, model: process.env.FLYD_JEV_MODEL ?? JEV_PINNED_MODEL, timeoutMs: 5000 },
      baselines: BASELINES,
    });
  }
  return replayPredicates(cases, {
    mode: "recorded",
    recordings: existsSync(RECORDINGS) ? loadJudgmentTraces(RECORDINGS) : [],
    baselines: BASELINES,
  });
}

function predicateReport(report: ReplayReport, id: string) {
  const predicate = report.predicates.find((p) => p.predicateId === id);
  if (!predicate) throw new Error(`No replay report for ${id}`);
  return predicate;
}

describe("System-1 replay bench", () => {
  it("seeds only synthetic cases whose labels name registered predicates", () => {
    expect(cases.length).toBeGreaterThanOrEqual(64);
    const registered = new Set(PREDICATE_DEFINITIONS.map((d) => d.id));
    for (const c of cases) {
      expect(c.synthetic).toBe(true);
      for (const id of Object.keys(c.labels)) expect(registered.has(id)).toBe(true);
    }
    const labelled = new Set(cases.flatMap((c) => Object.keys(c.labels)));
    for (const id of ["outcome_supported", "learning_supported_by_trace", "needs_reasoning_model"]) {
      expect(labelled.has(id)).toBe(true);
    }
  });

  it("scores every predicate against labels and current behaviour", async () => {
    const report = await runReplay();
    console.log(formatReplayReport(report));

    if (LIVE) {
      if (process.env.FLYD_JEV_EVAL_RECORD) writeFileSync(process.env.FLYD_JEV_EVAL_RECORD, serializeJudgmentTraces(report.traces));
      return;
    }

    // Recordings must cover every labelled case under the current question
    // fingerprint; a reworded question needs a live re-record.
    for (const predicate of report.predicates) {
      expect(predicate.unreplayable, predicate.predicateId).toEqual({ missing: [], stale: [], errors: [] });
      expect(predicate.models).toEqual([JEV_PINNED_MODEL]);
      expect(predicate.jev.latencyMs.p50).not.toBeNull();
    }
    expect(report.predicates.map((p) => p.predicateId).sort()).toEqual([...new Set(cases.flatMap((c) => Object.keys(c.labels)))].sort());

    // Pinned findings from the recorded jev-1.13.0 run:
    // the user-scoped interpretation no longer reads a world fact as the
    // user's own current state (scout C6: "who runs OpenAI now" was 0.97)...
    expect(predicateReport(report, "current_state").rows.find((r) => r.caseId === "front-door-06")?.jev).toBe(false);

    // chat_turn_route: every turn Jev decides (confidence ≥ 0.6) is routed
    // right, the clock feature included; the unsure ones (an email to write,
    // a pick between three jobs) abstain and fall back to the room reading.
    const route = predicateReport(report, "chat_turn_route").rows;
    const decided = route.filter((r) => r.jev !== "abstain");
    expect(decided.length).toBeGreaterThanOrEqual(32);
    expect(decided.filter((r) => r.jev !== r.label)).toEqual([]);
    expect(route.find((r) => r.caseId === "chat-turn-01")?.jev).toBe("delegate");

    // chat_turn_needs_code: decided turns are right but for one scheduled PR
    // check (0.83); talk about a project's launch or status stays unsure
    // (0.35-0.46), so the responder falls back to code-only keywords there.
    const code = predicateReport(report, "chat_turn_needs_code").rows;
    const codeDecided = code.filter((r) => r.jev !== "abstain");
    expect(codeDecided.length).toBeGreaterThanOrEqual(30);
    expect(codeDecided.filter((r) => r.jev !== r.label).map((r) => r.caseId)).toEqual(["chat-turn-26"]);

    // skill_applies: every decided answer across 13 requests x 6 skills is
    // right; a mood about a launch loads no launch checklist (0.36).
    const skill = predicateReport(report, "skill_applies").rows;
    expect(skill.filter((r) => r.jev !== "abstain" && r.jev !== r.label)).toEqual([]);
    expect(skill.filter((r) => r.label === true).every((r) => r.jev === true)).toBe(true);
    // ...and Jev proposes no false lifecycle closure on the curator set, where
    // today's regex closes projects from questions.
    expect(predicateReport(report, "marks_completed").jev.wrong).toBe(0);
    expect(predicateReport(report, "marks_cancelled").jev.wrong).toBe(0);
  }, LIVE ? 600_000 : 20_000);
});
