import { describe, expect, it } from "vitest";
import { buildWorkIntelligencePrompt, parseWorkIntelligenceResponse } from "../intervention.js";
import { DOMAIN_STANDARDS } from "../domain-standards.js";
import type { CurrentWork } from "../types.js";

function currentWork(): CurrentWork {
  const evidence = <T>(value: T) => ({
    value,
    source: "foreground" as const,
    confidence: "high" as const,
    provenance: "test",
    sourceTimestamp: "2026-09-13T00:00:00.000Z",
    isHypothesis: false,
  });
  return {
    project: evidence("flyd"),
    objective: evidence("Ship useful planner behavior"),
    artifact: { kind: "code", title: "planner.ts", contentDigest: "digest" },
    stage: evidence("execution" as const),
    constraints: evidence([]),
    openLoops: [],
    nextAction: evidence({ description: "Continue", readiness: "ready" as const }),
    evidenceSummary: {
      sources: ["foreground"],
      snapshotTimestamp: "2026-09-13T00:00:00.000Z",
      foregroundApp: "Terminal",
      repositoryRoot: "/flyd",
      branch: "main",
      activeWindowTitle: "flyd",
    },
    uncertainty: [],
    confidence: [],
  };
}

describe("bounded Work Intelligence action candidates", () => {
  it("keeps malformed model output out of the user-facing intervention", () => {
    const result = parseWorkIntelligenceResponse("<not-json>");

    expect(result.intervention.content).toBe("I couldn't prepare a useful plan from this moment. Try again from the work you want me to help with.");
    expect(result.intervention.content).not.toContain("JSON");
    expect(result.intervention.content).not.toContain("structured response");
  });

  it("asks the model for a bounded candidate set", () => {
    const prompt = buildWorkIntelligencePrompt({
      currentWork: currentWork(),
      domainStandard: DOMAIN_STANDARDS.code,
      intent: "Fix the planner",
    });

    expect(prompt).toContain('"proposed_actions"');
    expect(prompt).toContain("1-3 DISTINCT bounded candidate actions");
    expect(prompt).toContain("include a read/grep/inspect/verify candidate");
  });

  it("parses at most three candidate actions and preserves the first as compatibility fallback", () => {
    const raw = JSON.stringify({
      diagnosis: { primary_issue: {} },
      intervention: {
        content: "Choose the best next move",
        proposed_actions: [
          { kind: "file_grep", description: "Inspect", finish_condition: "Evidence found", file_operations: [{ kind: "grep", path: "cli/src", pattern: "planner" }] },
          { kind: "repository_action", description: "Implement", finish_condition: "Tests pass" },
          { kind: "task_plan", description: "Plan", finish_condition: "Plan exists", task_intent: "Plan the fix" },
          { kind: "repository_action", description: "Ignored fourth", finish_condition: "Never parsed" },
        ],
      },
    });

    const result = parseWorkIntelligenceResponse(raw);

    expect(result.candidateActions).toHaveLength(3);
    expect(result.candidateActions.map((action) => action.description)).toEqual(["Inspect", "Implement", "Plan"]);
    expect(result.intervention.proposedAction?.description).toBe("Inspect");
  });

  it("retains legacy single proposed_action responses", () => {
    const raw = JSON.stringify({
      diagnosis: { primary_issue: {} },
      intervention: {
        content: "Legacy response",
        proposed_action: { kind: "repository_action", description: "Implement", finish_condition: "Tests pass" },
      },
    });

    const result = parseWorkIntelligenceResponse(raw);

    expect(result.candidateActions).toHaveLength(1);
    expect(result.intervention.proposedAction?.description).toBe("Implement");
  });
});
