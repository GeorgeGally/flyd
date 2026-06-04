const INITIAL_STABILITY = 1;
const INITIAL_DIFFICULTY = 5.0;
const MIN_STABILITY = 0.1;
const MAX_DIFFICULTY = 10.0;

export type ReviewRating = "again" | "hard" | "good" | "easy";

export interface ReviewItem {
  id: string;
  sourcePath: string;
  sourceType: "raw" | "wiki";
  title: string;
  question: string;
  answer: string;
  created: string;
  lastReview: string | null;
  nextReview: string;
  stability: number;
  difficulty: number;
  reviewCount: number;
  lapses: number;
}

export function computeNextReview(
  rating: ReviewRating,
  stability: number,
  difficulty: number,
): { stability: number; difficulty: number; intervalDays: number } {
  const ratingMap: Record<ReviewRating, number> = {
    again: 1,
    hard: 2,
    good: 3,
    easy: 4,
  };
  const r = ratingMap[rating];

  let newDifficulty = difficulty + (r < 3 ? 1.5 : r === 3 ? -0.5 : -1.5);
  newDifficulty = Math.max(1, Math.min(MAX_DIFFICULTY, newDifficulty));

  let newStability: number;
  if (r === 1) {
    newStability = MIN_STABILITY;
  } else {
    const factor = 1 + (r - 1) * (1.5 - 0.1 * (newDifficulty / 5));
    newStability = stability * factor;
  }
  newStability = Math.max(MIN_STABILITY, newStability);

  const intervalDays = r === 1
    ? 0.01
    : Math.round(newStability);

  return { stability: newStability, difficulty: newDifficulty, intervalDays };
}

export function isDue(item: ReviewItem): boolean {
  return new Date(item.nextReview) <= new Date();
}

export function daysUntilReview(item: ReviewItem): number {
  const now = Date.now();
  const next = new Date(item.nextReview).getTime();
  return Math.round((next - now) / (1000 * 60 * 60 * 24));
}

export function makeReviewItem(
  sourcePath: string,
  sourceType: "raw" | "wiki",
  title: string,
  question: string,
  answer: string,
): ReviewItem {
  const now = new Date().toISOString();
  return {
    id: `${sourceType}-${sourcePath.replace(/[^a-zA-Z0-9]/g, "-")}`,
    sourcePath,
    sourceType,
    title,
    question,
    answer,
    created: now,
    lastReview: null,
    nextReview: now,
    stability: INITIAL_STABILITY,
    difficulty: INITIAL_DIFFICULTY,
    reviewCount: 0,
    lapses: 0,
  };
}
