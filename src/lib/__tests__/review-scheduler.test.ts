import { describe, it, expect } from "vitest";

describe("review-scheduler", () => {
  describe("computeNextReview", () => {
    it("increases stability on good rating", async () => {
      const { computeNextReview } = await import("../review-scheduler.js");
      const result = computeNextReview("good", 1, 5);
      expect(result.stability).toBeGreaterThan(1);
      expect(result.intervalDays).toBeGreaterThan(0);
    });

    it("resets stability on again rating", async () => {
      const { computeNextReview } = await import("../review-scheduler.js");
      const result = computeNextReview("again", 10, 5);
      expect(result.stability).toBeLessThan(1);
      expect(result.intervalDays).toBeLessThan(1);
    });

    it("increases difficulty on hard rating", async () => {
      const { computeNextReview } = await import("../review-scheduler.js");
      const result = computeNextReview("hard", 1, 5);
      expect(result.difficulty).toBeGreaterThan(5);
    });

    it("decreases difficulty on easy rating", async () => {
      const { computeNextReview } = await import("../review-scheduler.js");
      const result = computeNextReview("easy", 1, 5);
      expect(result.difficulty).toBeLessThan(5);
    });

    it("easy rating gives longest interval", async () => {
      const { computeNextReview } = await import("../review-scheduler.js");
      const good = computeNextReview("good", 1, 5);
      const easy = computeNextReview("easy", 1, 5);
      expect(easy.stability).toBeGreaterThan(good.stability);
    });
  });

  describe("isDue", () => {
    it("returns true for past due date", async () => {
      const { isDue, makeReviewItem } = await import("../review-scheduler.js");
      const item = makeReviewItem("test.md", "raw", "test", "q?", "a!");
      item.nextReview = "2020-01-01T00:00:00.000Z";
      expect(isDue(item)).toBe(true);
    });

    it("returns false for future due date", async () => {
      const { isDue, makeReviewItem } = await import("../review-scheduler.js");
      const item = makeReviewItem("test.md", "raw", "test", "q?", "a!");
      item.nextReview = "2099-01-01T00:00:00.000Z";
      expect(isDue(item)).toBe(false);
    });
  });

  describe("makeReviewItem", () => {
    it("creates item with correct initial values", async () => {
      const { makeReviewItem } = await import("../review-scheduler.js");
      const item = makeReviewItem("test.md", "raw", "Test Title", "What is X?", "X is Y");
      expect(item.id).toBeTruthy();
      expect(item.stability).toBe(1);
      expect(item.difficulty).toBe(5);
      expect(item.reviewCount).toBe(0);
      expect(item.lapses).toBe(0);
      expect(item.title).toBe("Test Title");
      expect(item.question).toBe("What is X?");
      expect(item.answer).toBe("X is Y");
    });
  });

  describe("daysUntilReview", () => {
    it("returns negative for past due items", async () => {
      const { daysUntilReview, makeReviewItem } = await import("../review-scheduler.js");
      const item = makeReviewItem("test.md", "raw", "test", "q?", "a!");
      item.nextReview = "2020-01-01T00:00:00.000Z";
      expect(daysUntilReview(item)).toBeLessThan(0);
    });
  });
});
