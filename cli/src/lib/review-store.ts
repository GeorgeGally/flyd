import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import { REVIEW_STATE_PATH } from "./config.js";
import { generateReviewItemsFromRaw } from "./review-generator.js";
import {
  type ReviewItem,
  type ReviewRating,
  computeNextReview,
  isDue,
  makeReviewItem,
} from "./review-scheduler.js";

interface ReviewStoreData {
  version: number;
  updated: string;
  items: ReviewItem[];
}

function loadStore(): ReviewStoreData {
  if (!existsSync(REVIEW_STATE_PATH)) {
    return { version: 1, updated: new Date().toISOString(), items: [] };
  }
  try {
    return JSON.parse(readFileSync(REVIEW_STATE_PATH, "utf8"));
  } catch {
    return { version: 1, updated: new Date().toISOString(), items: [] };
  }
}

function saveStore(data: ReviewStoreData): void {
  mkdirSync(dirname(REVIEW_STATE_PATH), { recursive: true });
  data.updated = new Date().toISOString();
  writeFileSync(REVIEW_STATE_PATH, JSON.stringify(data, null, 2), "utf8");
}

export function getDueItems(): ReviewItem[] {
  const data = loadStore();
  return data.items.filter(isDue).sort((a, b) => {
    return new Date(a.nextReview).getTime() - new Date(b.nextReview).getTime();
  });
}

export function getAllItems(): ReviewItem[] {
  return loadStore().items;
}

export function getItemCounts(): { total: number; due: number; reviewed: number } {
  const data = loadStore();
  const due = data.items.filter(isDue).length;
  const reviewed = data.items.filter(i => i.reviewCount > 0).length;
  return { total: data.items.length, due, reviewed };
}

export function recordReview(
  itemId: string,
  rating: ReviewRating,
): ReviewItem | null {
  const data = loadStore();
  const idx = data.items.findIndex(i => i.id === itemId);
  if (idx === -1) return null;

  const item = data.items[idx];
  const { stability, difficulty, intervalDays } = computeNextReview(
    rating,
    item.stability,
    item.difficulty,
  );

  const now = new Date();
  const nextDate = new Date(now.getTime() + intervalDays * 24 * 60 * 60 * 1000);

  const updated: ReviewItem = {
    ...item,
    lastReview: now.toISOString(),
    nextReview: nextDate.toISOString(),
    stability,
    difficulty,
    reviewCount: item.reviewCount + 1,
    lapses: rating === "again" ? item.lapses + 1 : item.lapses,
  };

  data.items[idx] = updated;
  saveStore(data);
  return updated;
}

export async function generateReviewItems(opts?: { force?: boolean }): Promise<number> {
  const data = loadStore();

  // Skip if items already exist (unless forced)
  if (data.items.length > 0 && !opts?.force) {
    return 0;
  }

  const items = await generateReviewItemsFromRaw();
  data.items = items ?? [];
  saveStore(data);
  return data.items.length;
}

export function addItem(item: ReviewItem): void {
  const data = loadStore();
  const existing = data.items.findIndex(i => i.id === item.id);
  if (existing >= 0) {
    data.items[existing] = item;
  } else {
    data.items.push(item);
  }
  saveStore(data);
}

export function removeItem(id: string): boolean {
  const data = loadStore();
  const before = data.items.length;
  data.items = data.items.filter(i => i.id !== id);
  if (data.items.length !== before) {
    saveStore(data);
    return true;
  }
  return false;
}

export function getStats(): { total: number; due: number; reviewedToday: number; avgStability: number } {
  const data = loadStore();
  const due = data.items.filter(isDue).length;
  const today = new Date().toISOString().split("T")[0];
  const reviewedToday = data.items.filter(
    i => i.lastReview?.startsWith(today),
  ).length;
  const stabilities = data.items.map(i => i.stability);
  const avgStability = stabilities.length > 0
    ? stabilities.reduce((a, b) => a + b, 0) / stabilities.length
    : 0;
  return { total: data.items.length, due, reviewedToday, avgStability: Math.round(avgStability * 10) / 10 };
}
