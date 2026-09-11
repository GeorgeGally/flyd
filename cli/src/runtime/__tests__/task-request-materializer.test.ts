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
  it("uses observed repository identity and preserves request provenance in orientation", () => {
    const request = buildRuntimeTaskRequest({
      intent: "Fix the scheduler",
      contextSnapshot: { projectRoot: "/tmp/untrusted", projectName: "fake" },
      observationRefs: ["obs-1"],
      invocationId: "inv-1",
    });

    const materialized = materializeRuntimeTaskRequest(request, repository);

    expect(materialized.createTask.projectName).toBe("bloom");
    expect(materialized.createTask.projectRoot).toBe("/work/bloom");
    expect(materialized.createTask.repository).toEqual(repository);
    expect(materialized.createTask.intendedOutcome).toBe("Fix the scheduler");
    expect(materialized.createTask.idempotencyKey).toBe(`runtime-task-request:${request.requestId}:create`);
    expect(materialized.orientation.contextSnapshot.runtime_task_request).toMatchObject({
      request_id: request.requestId,
      invocation_id: "inv-1",
      task_intent: "ship",
      observation_refs: ["obs-1"],
      source: "manifest",
    });
    expect(materialized.orientation.repositorySnapshot).toMatchObject({
      root: "/work/bloom",
      branch: "main",
      head: "abc123",
      status_digest: "clean",
    });
    expect(materialized.orientation.recommendedNextAction).toMatch(/minimum required grant/i);
  });

  it("makes scout materialization explicitly read-oriented", () => {
    const request = buildRuntimeTaskRequest({
      intent: "Investigate why pulls stopped",
      taskIntent: "scout",
    });

    const materialized = materializeRuntimeTaskRequest(request, repository);
    expect(materialized.orientation.recommendedNextAction).toMatch(/without modifying/i);
  });

  it("rejects disagreement between a resolved request root and observed reality", () => {
    const request = buildRuntimeTaskRequest({
      intent: "Fix the scheduler",
      projectRoot: "/work/other",
    });

    expect(() => materializeRuntimeTaskRequest(request, repository)).toThrow(/disagrees/i);
  });
});
