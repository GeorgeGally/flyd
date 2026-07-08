import { describe, it, expect, vi } from "vitest";

describe("decay", () => {
  describe("decayedValue", () => {
    it("returns original for zero days", async () => {
      const { decayedValue } = await import("../decay.js");
      expect(decayedValue(1.0, 0, 180)).toBe(1.0);
    });

    it("halves after halfLife days", async () => {
      const { decayedValue } = await import("../decay.js");
      expect(decayedValue(1.0, 180, 180)).toBe(0.5);
    });

    it("quarters after two half-lives", async () => {
      const { decayedValue } = await import("../decay.js");
      expect(decayedValue(1.0, 360, 180)).toBe(0.25);
    });

    it("floors at 0.1", async () => {
      const { decayedValue } = await import("../decay.js");
      const result = decayedValue(1.0, 3650, 1);
      expect(result).toBeGreaterThanOrEqual(0.1);
    });

    it("respects original confidence below 1.0", async () => {
      const { decayedValue } = await import("../decay.js");
      // 0.5 confidence after 90 days with 180 day halfLife
      const result = decayedValue(0.5, 90, 180);
      expect(result).toBeCloseTo(0.35, 1);
    });
  });

  describe("getHalfLife", () => {
    it("returns 180 for canon type", async () => {
      const { getHalfLife } = await import("../decay.js");
      expect(getHalfLife({ type: "canon" })).toBe(180);
    });

    it("returns 90 for working type", async () => {
      const { getHalfLife } = await import("../decay.js");
      expect(getHalfLife({ type: "working" })).toBe(90);
    });

    it("returns 60 for raw type", async () => {
      const { getHalfLife } = await import("../decay.js");
      expect(getHalfLife({ type: "raw" })).toBe(60);
    });

    it("returns 30 for episodic type", async () => {
      const { getHalfLife } = await import("../decay.js");
      expect(getHalfLife({ type: "episodic" })).toBe(30);
    });

    it("defaults to 60 for unknown types", async () => {
      const { getHalfLife } = await import("../decay.js");
      expect(getHalfLife({ type: "unknown" })).toBe(60);
    });
  });

  describe("getWikiEntryDaysSince", () => {
    it("returns 0 for nonexistent file", async () => {
      const { getWikiEntryDaysSince } = await import("../decay.js");
      expect(getWikiEntryDaysSince("nonexistent-file.md")).toBe(0);
    });
  });

  describe("librarian integration", () => {
    it("decayedConfidence matches decayedValue with 180 day halfLife", async () => {
      const { decayedConfidence } = await import("../librarian.js");
      const { decayedValue } = await import("../decay.js");

      const old = decayedConfidence(1.0, 180);
      const new_ = decayedValue(1.0, 180, 180);
      expect(old).toBeCloseTo(new_, 1);
    });
  });
});
