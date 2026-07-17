import { describe, expect, it } from "vitest";
import { planAssignments } from "../assignment-planner.js";

const repository = {
  root: "/work/flyd",
  name: "flyd",
  remote: "git@github.com:GeorgeGally/flyd.git",
  branch: "main",
  head: "abc123",
  dirty: false,
  statusLines: [],
  statusDigest: "clean",
};

describe("assignment planner", () => {
  it("falls back to one grounded assignment when model planning is unavailable", async () => {
    const plan = await planAssignments({
      outcome: "Fix the continuity harness",
      repository,
      memory: { verdict: "insufficient", matches: [] },
      generate: async () => { throw new Error("offline"); },
    });

    expect(plan.source).toBe("fallback");
    expect(plan.assignments).toEqual([expect.objectContaining({
      key: "primary",
      title: "Fix the continuity harness",
      instructions: "Fix the continuity harness",
      capabilityRequirements: ["implementation", "testing"],
      dependencyKeys: [],
    })]);
    expect(plan.successCriteria).toEqual(["The intended outcome is implemented and independently verified"]);
  });

  it("accepts two independent bounded assignments from Flyd", async () => {
    const plan = await planAssignments({
      outcome: "Add adapters and documentation",
      repository,
      memory: { verdict: "partial", matches: [] },
      generate: async () => JSON.stringify({
        successCriteria: ["Both adapters pass contract tests"],
        verificationCriteria: ["npm test"],
        assignments: [
          {
            key: "adapter",
            title: "Implement adapter",
            instructions: "Implement the Codex adapter contract",
            capabilityRequirements: ["implementation", "testing"],
            dependencyKeys: [],
            declaredFileScope: ["cli/src/runtime"],
          },
          {
            key: "docs",
            title: "Document controls",
            instructions: "Document worker controls",
            capabilityRequirements: ["analysis", "implementation"],
            dependencyKeys: [],
            declaredFileScope: ["README.md", "AGENTS.md"],
          },
        ],
      }),
    });

    expect(plan.source).toBe("model");
    expect(plan.assignments.map((assignment) => assignment.key)).toEqual(["adapter", "docs"]);
  });

  it.each([
    {
      name: "overlapping scopes",
      assignments: [
        { key: "one", title: "One", instructions: "One", capabilityRequirements: ["implementation"], dependencyKeys: [], declaredFileScope: ["cli/src"] },
        { key: "two", title: "Two", instructions: "Two", capabilityRequirements: ["testing"], dependencyKeys: [], declaredFileScope: ["cli/src/runtime"] },
      ],
    },
    {
      name: "dependency cycle",
      assignments: [
        { key: "one", title: "One", instructions: "One", capabilityRequirements: ["implementation"], dependencyKeys: ["two"], declaredFileScope: ["app"] },
        { key: "two", title: "Two", instructions: "Two", capabilityRequirements: ["testing"], dependencyKeys: ["one"], declaredFileScope: ["test"] },
      ],
    },
    {
      name: "unsupported capability",
      assignments: [
        { key: "one", title: "One", instructions: "One", capabilityRequirements: ["deploy"], dependencyKeys: [], declaredFileScope: ["app"] },
      ],
    },
    {
      name: "scope outside the repository",
      assignments: [
        { key: "one", title: "One", instructions: "One", capabilityRequirements: ["implementation"], dependencyKeys: [], declaredFileScope: ["../secrets"] },
      ],
    },
  ])("rejects $name instead of trusting an unsafe plan", async ({ assignments }) => {
    const plan = await planAssignments({
      outcome: "Safely implement work",
      repository,
      memory: { verdict: "sufficient", matches: [] },
      generate: async () => JSON.stringify({
        successCriteria: ["Done"],
        verificationCriteria: ["npm test"],
        assignments,
      }),
    });

    expect(plan.source).toBe("fallback");
    expect(plan.assignments).toHaveLength(1);
  });
});
