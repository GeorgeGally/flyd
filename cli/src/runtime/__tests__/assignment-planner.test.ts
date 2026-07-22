import { describe, expect, it } from "vitest";
import { currentPlanAssignments, planAssignments } from "../assignment-planner.js";
import type { AgentTask, TaskAssignment } from "../types.js";

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

  it("redacts credentials before asking the planner model", async () => {
    let prompt = "";
    await planAssignments({
      outcome: "Fix deployment with API_KEY=super-secret-value",
      repository,
      memory: { verdict: "sufficient", matches: [{ id: "memory-1", path: "notes", excerpt: "token: hidden-token-value", stale: false }] },
      generate: async (value) => {
        prompt = value;
        throw new Error("stop after capture");
      },
    });

    expect(prompt).not.toContain("super-secret-value");
    expect(prompt).not.toContain("hidden-token-value");
    expect(prompt).toContain("[REDACTED]");
  });

  it("falls back to read-only analysis for a project status request", async () => {
    const plan = await planAssignments({
      outcome: "I want you to look at the status of this project",
      repository,
      memory: { verdict: "insufficient", matches: [] },
      generate: async () => { throw new Error("offline"); },
    });

    expect(plan.source).toBe("fallback");
    expect(plan.assignments).toEqual([expect.objectContaining({
      capabilityRequirements: ["analysis", "review"],
    })]);
    expect(plan.successCriteria).toEqual([
      "The requested assessment is grounded in repository evidence and returns a concrete conclusion",
    ]);
  });

  it("keeps the original read-only intent when the resume action is generic", async () => {
    const plan = await planAssignments({
      outcome: "I want you to look at the status of this project",
      nextAction: "Re-check the current repository before continuing the task",
      repository,
      memory: { verdict: "insufficient", matches: [] },
      generate: async () => { throw new Error("offline"); },
    });

    expect(plan.assignments).toEqual([expect.objectContaining({
      title: "Re-check the current repository before continuing the task",
      instructions: "Re-check the current repository before continuing the task",
      capabilityRequirements: ["analysis", "review"],
    })]);
  });

  it("keeps implementation requirements when a review request also asks for fixes", async () => {
    const plan = await planAssignments({
      outcome: "Review the pull request and fix the issues you find",
      repository,
      memory: { verdict: "insufficient", matches: [] },
      generate: async () => { throw new Error("offline"); },
    });

    expect(plan.assignments[0].capabilityRequirements).toEqual(["implementation", "testing"]);
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
            repositoryRoot: repository.root,
            title: "Implement adapter",
            instructions: "Implement the Codex adapter contract",
            capabilityRequirements: ["implementation", "testing"],
            dependencyKeys: [],
            declaredFileScope: ["cli/src/runtime"],
          },
          {
            key: "docs",
            repositoryRoot: repository.root,
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
        { key: "one", repositoryRoot: repository.root, title: "One", instructions: "One", capabilityRequirements: ["implementation"], dependencyKeys: [], declaredFileScope: ["cli/src"] },
        { key: "two", repositoryRoot: repository.root, title: "Two", instructions: "Two", capabilityRequirements: ["testing"], dependencyKeys: [], declaredFileScope: ["cli/src/runtime"] },
      ],
    },
    {
      name: "dependency cycle",
      assignments: [
        { key: "one", repositoryRoot: repository.root, title: "One", instructions: "One", capabilityRequirements: ["implementation"], dependencyKeys: ["two"], declaredFileScope: ["app"] },
        { key: "two", repositoryRoot: repository.root, title: "Two", instructions: "Two", capabilityRequirements: ["testing"], dependencyKeys: ["one"], declaredFileScope: ["test"] },
      ],
    },
    {
      name: "unsupported capability",
      assignments: [
        { key: "one", repositoryRoot: repository.root, title: "One", instructions: "One", capabilityRequirements: ["deploy"], dependencyKeys: [], declaredFileScope: ["app"] },
      ],
    },
    {
      name: "scope outside the repository",
      assignments: [
        { key: "one", repositoryRoot: repository.root, title: "One", instructions: "One", capabilityRequirements: ["implementation"], dependencyKeys: [], declaredFileScope: ["../secrets"] },
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

  it("accepts overlapping relative scopes when assignments target different approved repositories", async () => {
    const secondRepository = { ...repository, root: "/work/skill", name: "skill", head: "def456" };
    const plan = await planAssignments({
      outcome: "Update Flyd and install the companion skill",
      repository,
      repositories: [repository, secondRepository],
      memory: { verdict: "sufficient", matches: [] },
      generate: async () => JSON.stringify({
        successCriteria: ["Both repositories are updated"],
        verificationCriteria: ["Run each repository's tests"],
        assignments: [
          {
            key: "flyd",
            repositoryRoot: repository.root,
            title: "Update Flyd",
            instructions: "Update the Flyd integration",
            capabilityRequirements: ["implementation", "testing"],
            dependencyKeys: [],
            declaredFileScope: ["."],
          },
          {
            key: "skill",
            repositoryRoot: secondRepository.root,
            title: "Update skill",
            instructions: "Update the companion skill",
            capabilityRequirements: ["implementation", "testing"],
            dependencyKeys: [],
            declaredFileScope: ["."],
          },
        ],
      }),
    });

    expect(plan.source).toBe("model");
    expect(plan.assignments.map((assignment) => assignment.repositoryRoot))
      .toEqual([repository.root, secondRepository.root]);
  });

  it("rejects a model plan that targets a repository outside the approved set", async () => {
    const plan = await planAssignments({
      outcome: "Update another repository",
      repository,
      repositories: [repository],
      memory: { verdict: "sufficient", matches: [] },
      generate: async () => JSON.stringify({
        successCriteria: ["Done"],
        verificationCriteria: ["Tests pass"],
        assignments: [{
          key: "outside",
          repositoryRoot: "/work/not-approved",
          title: "Update outside repository",
          instructions: "Change files outside the grant",
          capabilityRequirements: ["implementation"],
          dependencyKeys: [],
          declaredFileScope: ["."],
        }],
      }),
    });

    expect(plan.source).toBe("fallback");
    expect(plan.assignments[0].repositoryRoot).toBe(repository.root);
  });

  it("selects only runnable assignments from the task's current plan", () => {
    const assignments = [
      {
        id: "1", assignmentKey: "old", status: "cancelled",
      },
      {
        id: "2", assignmentKey: "current", status: "pending", baseHead: repository.head,
      },
    ] as TaskAssignment[];
    const task: Pick<AgentTask, "plan"> = {
      plan: { source: "fallback", assignment_keys: ["current"] },
    };

    expect(currentPlanAssignments(task, assignments, repository.head).map((assignment) => assignment.assignmentKey))
      .toEqual(["current"]);
    expect(currentPlanAssignments(
      { ...task, plan: { source: "fallback", assignment_keys: ["old"] } },
      assignments,
      repository.head,
    )).toEqual([]);
  });

  it("does not reuse a current-plan assignment recorded against an older repository head", () => {
    const assignments = [
      {
        id: "1", assignmentKey: "stale", status: "pending", baseHead: "old-head",
      },
      {
        id: "2", assignmentKey: "current", status: "pending", baseHead: repository.head,
      },
    ] as TaskAssignment[];

    expect(currentPlanAssignments(
      { plan: { assignment_keys: [ "stale" ] } },
      assignments,
      repository.head,
    )).toEqual([]);
    expect(currentPlanAssignments(
      { plan: { assignment_keys: [ "current" ] } },
      assignments,
      repository.head,
    ).map((assignment) => assignment.assignmentKey)).toEqual([ "current" ]);
  });
});
