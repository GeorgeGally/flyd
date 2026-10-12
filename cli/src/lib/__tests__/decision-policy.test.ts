import { afterEach, describe, expect, it, vi } from "vitest";
import { decisionBrief, decisionPolicyBlock, decisionPolicyVersion, DECISION_POLICY_VERSION } from "../decision-policy.js";

afterEach(() => vi.unstubAllEnvs());

describe("proportional decision guidance", () => {
  it("does not require effort classification or a decision brief for routine or emotional turns", () => {
    for (const need of ["do", "ask", "chat", "vent", "unknown"]) expect(decisionBrief(need)).toBe("");
    expect(decisionPolicyBlock().split(/\s+/).length).toBeLessThan(160);
    expect(decisionPolicyVersion()).toBe(DECISION_POLICY_VERSION);
  });

  it("uses an existing decision reading for targeted evidence and bounded experiments", () => {
    expect(decisionBrief("think")).toBe(decisionBrief("decide"));
    expect(decisionBrief("decide")).toContain("count cumulative effort");
    expect(decisionBrief("decide")).toContain("not proof of its cause");
  });

  it("can roll back on an existing process without cached policy state", () => {
    vi.stubEnv("FLYD_OPTIMISTIC_DECISIONS", "0");
    expect(decisionPolicyBlock()).toBe("");
    expect(decisionBrief("decide")).toBe("");
    expect(decisionPolicyVersion()).toBeUndefined();
    vi.stubEnv("FLYD_OPTIMISTIC_DECISIONS", "1");
    expect(decisionPolicyVersion()).toBe(DECISION_POLICY_VERSION);
  });
});
