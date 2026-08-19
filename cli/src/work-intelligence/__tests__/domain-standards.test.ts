import { describe, expect, it } from "vitest";
import { DOMAIN_STANDARDS, type WorkDomain } from "../domain-standards.js";

describe("domain standards", () => {
  it("includes coach as a valid WorkDomain with a populated standard", () => {
    expect('coach' in DOMAIN_STANDARDS).toBe(true);
    const coach = DOMAIN_STANDARDS.coach;
    expect(coach.domain).toBe("coach");
    expect(coach.evaluationDimensions.length).toBeGreaterThan(0);
    expect(coach.focusPrompt.length).toBeGreaterThan(0);
    expect(coach.avoidances.length).toBeGreaterThan(0);
  });

  it("carries a structural anti-generic-advice avoidance", () => {
    const avoidances = DOMAIN_STANDARDS.coach.avoidances.join(" ").toLowerCase();
    expect(avoidances).toContain("generic");
    expect(avoidances).toContain("grounding");
  });

  it("is a valid WorkDomain type member", () => {
    const coachDomain: WorkDomain = "coach";
    expect(DOMAIN_STANDARDS[coachDomain].domain).toBe("coach");
  });
});
