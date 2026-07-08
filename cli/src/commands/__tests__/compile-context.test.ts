import { describe, it, expect } from "vitest";
import { bucketFor, scoreMatch, bundleBody } from "../compile-context.js";
import type { MemoryMatch } from "../../lib/wiki.js";

function makeMatch(
  overrides: Partial<MemoryMatch["metadata"]> = {},
  path = "/fake/wiki/skills/test.md",
  body = "# Test\n\nBody.",
): MemoryMatch {
  return {
    path,
    metadata: {
      type: "skill",
      status: "working",
      confidence: 0.8,
      time_shape: "current",
      life_phase: "current",
      ...overrides,
    },
    body,
    score: 5,
  };
}

describe("bucketFor", () => {
  it("buckets dormant status into dormant_context", () => {
    const m = makeMatch({ status: "dormant" });
    expect(bucketFor(m)).toBe("dormant_context");
  });

  it("buckets past life_phase career into dormant_context", () => {
    const m = makeMatch({ type: "career", life_phase: "past" });
    expect(bucketFor(m)).toBe("dormant_context");
  });

  it("does not bucket past education into dormant_context (permanent identity)", () => {
    const m = makeMatch({ type: "education", life_phase: "past" });
    expect(bucketFor(m)).not.toBe("dormant_context");
  });

  it("does not bucket past skill into dormant_context (permanent identity)", () => {
    const m = makeMatch({ type: "skill", life_phase: "past" });
    expect(bucketFor(m)).not.toBe("dormant_context");
  });

  it("does not bucket past award into dormant_context (permanent identity)", () => {
    const m = makeMatch({ type: "award", life_phase: "past" });
    expect(bucketFor(m)).not.toBe("dormant_context");
  });

  it("does not bucket past testimonial into dormant_context (permanent identity)", () => {
    const m = makeMatch({ type: "testimonial", life_phase: "past" });
    expect(bucketFor(m)).not.toBe("dormant_context");
  });

  it("buckets active projects into active_projects", () => {
    const m = makeMatch({ type: "project", time_shape: "current", life_phase: "current" });
    expect(bucketFor(m)).toBe("active_projects");
  });

  it("buckets stable projects into active_projects", () => {
    const m = makeMatch({ type: "project", time_shape: "stable", life_phase: "current" });
    expect(bucketFor(m)).toBe("active_projects");
  });

  it("buckets past projects into dormant_context", () => {
    const m = makeMatch({ type: "project", life_phase: "past" });
    expect(bucketFor(m)).toBe("dormant_context");
  });

  it("buckets constraints into current_constraints", () => {
    const m = makeMatch({ type: "constraint" });
    expect(bucketFor(m)).toBe("current_constraints");
  });

  it("buckets episodic or phase-specific into recent_history", () => {
    const m = makeMatch({ time_shape: "episodic" });
    expect(bucketFor(m)).toBe("recent_history");
  });

  it("buckets phase-specific into recent_history", () => {
    const m = makeMatch({ time_shape: "phase-specific" });
    expect(bucketFor(m)).toBe("recent_history");
  });

  it("defaults to current_identity", () => {
    const m = makeMatch({ type: "person" });
    expect(bucketFor(m)).toBe("current_identity");
  });
});

describe("scoreMatch", () => {
  it("scores based on confidence, status, and time_shape", () => {
    const score = scoreMatch({
      type: "career",
      status: "canon",
      confidence: 1,
      time_shape: "stable",
    });
    expect(score).toBe(22);
  });

  it("adds bonus for last_confirmed", () => {
    const withConfirmed = scoreMatch({
      type: "career",
      status: "working",
      confidence: 0.5,
      time_shape: "current",
      last_confirmed: "2026-01-01",
    });
    const withoutConfirmed = scoreMatch({
      type: "career",
      status: "working",
      confidence: 0.5,
      time_shape: "current",
    });
    expect(withConfirmed).toBe(withoutConfirmed + 1);
  });

  it("penalizes episodic and contradictory statuses", () => {
    const working = scoreMatch({ status: "working", confidence: 0.5, time_shape: "current" });
    const episodic = scoreMatch({ status: "episodic", confidence: 0.5, time_shape: "current" });
    const contradictory = scoreMatch({ status: "contradictory", confidence: 0.5, time_shape: "current" });
    const dormant = scoreMatch({ status: "dormant", confidence: 0.5, time_shape: "current" });
    expect(episodic).toBeLessThan(working);
    expect(contradictory).toBeLessThan(episodic);
    expect(dormant).toBeLessThan(contradictory);
  });

  it("handles zero confidence", () => {
    const score = scoreMatch({ status: "working", confidence: 0, time_shape: "stable" });
    expect(score).toBe(9);
  });
});

describe("bundleBody", () => {
  it("generates a header from the bundle name", () => {
    const body = bundleBody("current_identity", []);
    expect(body).toContain("# Current Identity");
  });

  it("includes 'No compiled context' for empty matches", () => {
    const body = bundleBody("active_projects", []);
    expect(body).toContain("No compiled context");
  });

  it("includes each match path as a section header", () => {
    const m = makeMatch({}, "skills/deno.md", "# Deno\n\nRuntime.");
    const body = bundleBody("current_identity", [m]);
    expect(body).toContain("## skills/deno.md");
    expect(body).toContain("# Deno");
  });

  it("adds caution for dormant context bundle", () => {
    const body = bundleBody("dormant_context", [makeMatch()]);
    expect(body).toContain("Dormant / past context is real and vetted");
  });

  it("adds caution for questioned entries", () => {
    const m = makeMatch({ status: "questioned", questioned_reason: "needs review" });
    const body = bundleBody("current_identity", [m]);
    expect(body).toContain("Caution: questioned");
    expect(body).toContain("needs review");
  });

  it("renders the match body text", () => {
    const m = makeMatch({}, "skills/go.md", "# Go\n\nAwesome language.");
    const body = bundleBody("current_identity", [m]);
    expect(body).toContain("# Go");
    expect(body).toContain("Awesome language.");
  });
});
