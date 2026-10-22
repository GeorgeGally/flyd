import { describe, expect, it } from "vitest";
import { assessDelivery } from "../delivery-evidence.js";

describe("delivery evidence", () => {
  it("keeps a merged pull request unknown until the running build contains its commit", () => {
    const pullRequest = { merged: true, mergeCommitSha: "a".repeat(40) };
    const runningHealth = { buildCommit: "b".repeat(40) };

    expect(assessDelivery(pullRequest, runningHealth)).toEqual({
      attribution: "unknown",
      completed: false,
    });
  });
});
