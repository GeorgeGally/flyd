import { describe, expect, it } from "vitest";
import { buildRuntimeTaskRequest } from "../delegation-request.js";
import { materializeRuntimeTaskRequest } from "../task-request-materializer.js";
import type { RepositorySnapshot } from "../types.js";

const repository: RepositorySnapshot = {
  root: "/work/bloom",
  name: "bloom",
  remote: "git@github.com:GeorgeGally/bloom.git",
  branch: "main",
  head: "abc123",
  dirty: false,
  statusLines: [],
  statusDigest: "clean",
};

describe("materializeRuntimeTaskRequest", () => {
  it("uses observed repository identity rather than request context", () => {
    const request = buildRuntimeTaskRequest({
      intent: "Fix the scheduler",
      contextSnapshot: { projectRoot: "/tmp/untrusted", projectName: "fake" },
      observationRefs: ["obs-1"],
      invocationId: "inv-1",
    });

    const input = materializeRuntimeTaskRequest(request, repository);

    expect(input.projectName).toBe("bloom");
    expect(input.projectRoot).toBe("/work/bloom");
    expect(input.repository).toEqual(repository);
    expect(input.intendedOutcome).toBe("Fix the scheduler");
    expect(input.idempotencyKey).toBe(`runtime-task-request:${request.requestId}`);
    expect(input.contextSnapshot.runtime_task_request).toMatchObject({
      request_id: request.requestId,
      invocation_id: "inv-1",
      task_intent: "ship",
      observation_refs: ["obs-1"],
      source: "manifest",
    });
  });

  it("rejects disagreement between a resolved request root and observed reality", () => {
    const request = buildRuntimeTaskRequest({
      intent: "Fix the scheduler",
      projectRoot: "/work/other",
    });

    expect(() => materializeRuntimeTaskRequest(request, repository)).toThrow(/disagrees/i);
  });
});
