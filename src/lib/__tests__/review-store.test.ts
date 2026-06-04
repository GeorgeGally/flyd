import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

const testReviewStatePath = join(tmpdir(), `flyd-test-review-${randomUUID()}.json`);

vi.mock("../../lib/config.js", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    REVIEW_STATE_PATH: testReviewStatePath,
  };
});

beforeEach(() => {
  if (existsSync(testReviewStatePath)) rmSync(testReviewStatePath, { force: true });
});

afterEach(() => {
  if (existsSync(testReviewStatePath)) rmSync(testReviewStatePath, { force: true });
  vi.restoreAllMocks();
});

describe("review-store", () => {
  describe("getItemCounts", () => {
    it("returns zero counts for empty store", async () => {
      const { getItemCounts } = await import("../../lib/review-store.js");
      const counts = getItemCounts();
      expect(counts.total).toBe(0);
      expect(counts.due).toBe(0);
    });
  });

  describe("addItem and getDueItems", () => {
    it("adds item and finds it as due", async () => {
      const { addItem, getDueItems } = await import("../../lib/review-store.js");
      const { makeReviewItem } = await import("../review-scheduler.js");
      const item = makeReviewItem("test.md", "raw", "Test", "Q?", "A!");
      item.nextReview = "2020-01-01T00:00:00.000Z";
      addItem(item);

      const due = getDueItems();
      expect(due.length).toBeGreaterThanOrEqual(1);
      expect(due.some((i: { id: string }) => i.id === item.id)).toBe(true);
    });
  });

  describe("recordReview", () => {
    it("updates item on good rating", async () => {
      const { addItem, recordReview } = await import("../../lib/review-store.js");
      const { makeReviewItem } = await import("../review-scheduler.js");
      const item = makeReviewItem("test.md", "raw", "Test", "Q?", "A!");
      item.nextReview = "2020-01-01T00:00:00.000Z";
      addItem(item);

      const updated = recordReview(item.id, "good");
      expect(updated).not.toBeNull();
      expect(updated!.reviewCount).toBe(1);
      expect(updated!.stability).toBeGreaterThan(1);
      expect(updated!.lastReview).not.toBeNull();
    });

    it("returns null for nonexistent item", async () => {
      const { recordReview } = await import("../../lib/review-store.js");
      const result = recordReview("nonexistent", "good");
      expect(result).toBeNull();
    });
  });

  describe("removeItem", () => {
    it("removes item by id", async () => {
      const { addItem, removeItem, getItemCounts } = await import("../../lib/review-store.js");
      const { makeReviewItem } = await import("../review-scheduler.js");
      const item = makeReviewItem("test.md", "raw", "Test", "Q?", "A!");
      addItem(item);

      const removed = removeItem(item.id);
      expect(removed).toBe(true);

      const counts = getItemCounts();
      expect(counts.total).toBe(0);
    });
  });

  describe("generateReviewItems", () => {
    it("skips when items exist", async () => {
      const { addItem, generateReviewItems } = await import("../../lib/review-store.js");
      const { makeReviewItem } = await import("../review-scheduler.js");
      addItem(makeReviewItem("test.md", "raw", "Test", "Q?", "A!"));
      const count = await generateReviewItems();
      expect(count).toBe(0);
    });
  });

  describe("getAllItems", () => {
    it("returns all items", async () => {
      const { addItem, getAllItems } = await import("../../lib/review-store.js");
      const { makeReviewItem } = await import("../review-scheduler.js");
      addItem(makeReviewItem("test.md", "raw", "Test", "Q?", "A!"));
      const all = getAllItems();
      expect(all.length).toBeGreaterThanOrEqual(1);
    });
  });
});
