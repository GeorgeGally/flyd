import { describe, expect, it } from "vitest";
import {
  buildDelegationEnvelope,
  validateDelegationCompletion,
  type DelegationCompletion,
} from "../delegation.js";
import type { ArtifactCheckResult, HandoffReport } from "../verification-types.js";

const passingCheck = (path: string): ArtifactCheckResult => ({
  claim: { kind: "file", path, description: "output" },
  passed: true,
  failures: [],
  checkedAt: new Date(Date.now() - 5000).toISOString(),
});

const handoff = (location = "/Users/x/Documents/out.md"): HandoffReport => ({
  what: "Research summary",
  where: { kind: "file", location },
  contains: "Findings with sources",
  artifactChecks: [passingCheck(location)],
  verifiedAt: new Date(Date.now() - 2000).toISOString(),
});

const completed = (overrides: Partial<DelegationCompletion> = {}): DelegationCompletion => ({
  delegationId: "del-1",
  invocationId: "inv-1",
  status: "completed",
  handoff: handoff(),
  activity: ["searched sources", "wrote summary"],
  verification: {
    artifactChecks: [passingCheck("/Users/x/Documents/out.md")],
    verifiedAt: new Date(Date.now() - 2000).toISOString(),
  },
  claimedAt: new Date().toISOString(),
  ...overrides,
});

describe("buildDelegationEnvelope", () => {
  it("carries identity, finish condition, and completion contract", () => {
    const envelope = buildDelegationEnvelope("research topic x", {}, [], null);
    expect(envelope.delegationId).toBeTruthy();
    expect(envelope.finishCondition).toContain("research topic x");
    expect(envelope.completionContract.requiresHandoff).toBe(true);
    expect(envelope.completionContract.requiresVerifiedArtifacts).toBe(true);
    expect(envelope.grant.writeAllowed).toBe(false);
  });

  it("mints a unique delegationId per envelope", () => {
    const a = buildDelegationEnvelope("x", {}, [], null);
    const b = buildDelegationEnvelope("x", {}, [], null);
    expect(a.delegationId).not.toBe(b.delegationId);
  });
});

describe("validateDelegationCompletion — the completion rule", () => {
  it("accepts a verified completion", () => {
    expect(validateDelegationCompletion(completed())).toBeNull();
  });

  it("rejects completed status with no handoff (activity is not completion)", () => {
    const error = validateDelegationCompletion(completed({ handoff: null }));
    expect(error).toContain("activity_is_not_completion");
  });

  it("rejects completed status with no verification evidence", () => {
    const error = validateDelegationCompletion(completed({ verification: null }));
    expect(error).toContain("activity_is_not_completion");
  });

  it("rejects verification containing zero checks and zero commands", () => {
    const error = validateDelegationCompletion(completed({
      verification: { artifactChecks: [], verifiedAt: new Date().toISOString() },
    }));
    expect(error).toContain("activity_is_not_completion");
  });

  it("rejects completion with a failing artifact check", () => {
    const failing: ArtifactCheckResult = {
      ...passingCheck("/Users/x/Documents/out.md"),
      passed: false,
      failures: [{ check: "exists", detail: "File not found" }],
    };
    const error = validateDelegationCompletion(completed({
      verification: { artifactChecks: [failing], verifiedAt: new Date().toISOString() },
    }));
    expect(error).toContain("failing artifact check");
  });

  it("rejects verification timestamped after the claim", () => {
    const error = validateDelegationCompletion(completed({
      claimedAt: new Date(Date.now() - 60_000).toISOString(),
    }));
    expect(error).toContain("precede");
  });

  it("accepts command-only verification evidence", () => {
    const c = completed({
      handoff: { ...handoff(), where: { kind: "repository", location: "/Users/x/project @ abc123" }, artifactChecks: [] },
      verification: {
        artifactChecks: [],
        commands: [{ command: "npm test", exitStatus: 0, outputDigest: "sha256:abc" }],
        verifiedAt: new Date(Date.now() - 2000).toISOString(),
      },
    });
    expect(validateDelegationCompletion(c)).toBeNull();
  });

  it("requires a blocker description for blocked status", () => {
    const error = validateDelegationCompletion(completed({ status: "blocked", blocker: "  " }));
    expect(error).toContain("blocker");
  });

  it("allows failed status without handoff", () => {
    const c = completed({ status: "failed", handoff: null, verification: null });
    expect(validateDelegationCompletion(c)).toBeNull();
  });
});
