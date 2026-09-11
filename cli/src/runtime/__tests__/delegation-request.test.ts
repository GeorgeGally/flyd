import { describe, expect, it } from "vitest";
import { buildRuntimeTaskRequest, isExplicitDelegationRequest } from "../delegation-request.js";
import { buildDelegationEnvelope } from "../../delegation.js";

describe("RuntimeTaskRequest", () => {
  it("captures intent without creating execution authority", () => {
    const request = buildRuntimeTaskRequest({
      intent: "Fix the scheduler freshness bug",
      projectRoot: "/work/bloom",
      observationRefs: ["obs-1", "obs-1", "obs-2"],
      contextSnapshot: { current_project: "bloom" },
    });

    expect(request.intendedOutcome).toBe("Fix the scheduler freshness bug");
    expect(request.taskIntent).toBe("ship");
    expect(request.projectRoot).toBe("/work/bloom");
    expect(request.observationRefs).toEqual(["obs-1", "obs-2"]);
    expect(request.confirmationRequired).toBe(true);

    // Authority belongs to TaskGrant, not to an intent/request payload.
    expect(request).not.toHaveProperty("grant");
    expect(request).not.toHaveProperty("writeAllowed");
    expect(request).not.toHaveProperty("networkAllowed");
    expect(request).not.toHaveProperty("completionContract");
  });

  it("uses read-oriented capabilities for scout requests", () => {
    const request = buildRuntimeTaskRequest({
      intent: "Investigate why pulls stopped",
      taskIntent: "scout",
    });

    expect(request.taskIntent).toBe("scout");
    expect(request.requestedCapabilities).toEqual(["analysis", "review"]);
    expect(request.requestedCapabilities).not.toContain("implementation");
  });

  it("keeps the dormant delegation builder as a runtime-task compatibility seam", () => {
    const envelope = buildDelegationEnvelope(
      "Delegate fixing the pull bug",
      { goals: [{ content: "Reliable collection" }] },
      ["el_01"],
      "/work/bloom",
    );

    expect(envelope.requestId).toMatch(/^task-request-/);
    expect(envelope.intendedOutcome).toBe("Delegate fixing the pull bug");
    expect(envelope.projectRoot).toBe("/work/bloom");
    expect(envelope.contextSnapshot).toMatchObject({ goals: [{ content: "Reliable collection" }] });
    expect(envelope).not.toHaveProperty("grant");
  });

  it("keeps explicit delegation phrase matching isolated as temporary compatibility", () => {
    expect(isExplicitDelegationRequest("delegate this to an agent")).toBe(true);
    expect(isExplicitDelegationRequest("spawn an agent to fix this")).toBe(true);
    expect(isExplicitDelegationRequest("fix the scheduler freshness bug")).toBe(false);
  });

  it("rejects empty task outcomes", () => {
    expect(() => buildRuntimeTaskRequest({ intent: "   " })).toThrow(/intended outcome/i);
  });
});
