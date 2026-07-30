import { describe, expect, it } from "vitest";
import { classifyResearchIntent, planEvidence } from "../query-planner.js";

describe("evidence query planning", () => {
  it("prioritises community sources for opinion queries", () => {
    const plan = planEvidence(
      "what are people saying about this?",
      ["web", "github", "reddit", "x", "youtube", "hackernews"],
      "quick",
    );

    expect(plan.intent).toBe("opinion");
    expect(plan.subqueries[0].capabilities).toEqual(["reddit", "x", "youtube"]);
  });

  it("prioritises market evidence for predictions", () => {
    const plan = planEvidence(
      "what are the odds this acquisition happens?",
      ["web", "x", "polymarket", "reddit"],
      "quick",
    );

    expect(plan.intent).toBe("prediction");
    expect(plan.subqueries[0].capabilities[0]).toBe("polymarket");
  });

  it("uses only healthy/available capabilities supplied by the registry", () => {
    const plan = planEvidence(
      "compare these tools",
      ["github", "web"],
      "quick",
    );

    expect(plan.intent).toBe("comparison");
    expect(plan.subqueries[0].capabilities).toEqual(["github", "web"]);
  });

  it("classifies current reaction as breaking news before generic opinion", () => {
    expect(classifyResearchIntent("what is the latest reaction to this announcement today?")).toBe("breaking_news");
  });
});
