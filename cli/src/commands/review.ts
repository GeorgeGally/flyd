import * as readline from "readline";
import {
  getDueItems,
  getAllItems,
  getItemCounts,
  recordReview,
  generateReviewItems,
  getStats,
} from "../lib/review-store.js";
import { type ReviewRating } from "../lib/review-scheduler.js";

function rl(): readline.Interface {
  return readline.createInterface({ input: process.stdin, output: process.stdout });
}

async function askQuestion(query: string): Promise<string> {
  const line = rl();
  return new Promise(resolve => {
    line.question(query, answer => {
      line.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

export async function runReview(opts: { generate?: boolean; limit?: number } = {}): Promise<void> {
  const stats = getStats();
  console.log(`Review stats: ${stats.due} due / ${stats.total} total / ${stats.reviewedToday} reviewed today`);
  if (stats.avgStability > 0) console.log(`Avg stability: ${stats.avgStability}d`);

  if (opts.generate) {
    console.log("\nGenerating review items from captures...");
    const count = await generateReviewItems();
    console.log(`Generated ${count} new review items`);
    return;
  }

  let dueItems = getDueItems();
  if (dueItems.length === 0) {
    console.log("\nNo items due for review");

    const allItems = getAllItems().sort(
      (a, b) => new Date(a.nextReview).getTime() - new Date(b.nextReview).getTime(),
    );
    if (allItems.length > 0) {
      const next = allItems[0];
      const nextDate = new Date(next.nextReview);
      console.log(`Next review: "${next.title}" due ${nextDate.toLocaleDateString()}`);
    }
    return;
  }

  if (opts.limit && opts.limit < dueItems.length) {
    dueItems = dueItems.slice(0, opts.limit);
  }

  console.log(`\n${dueItems.length} items to review\n`);

  for (let i = 0; i < dueItems.length; i++) {
    const item = dueItems[i];

    console.log(`${"=".repeat(60)}`);
    console.log(`[${i + 1}/${dueItems.length}] ${item.sourceType}:${item.sourcePath}`);
    console.log(`\nQ: ${item.question}`);

    await askQuestion("\nPress Enter to reveal answer...");

    console.log(`\nA: ${item.answer}`);
    console.log(`\nRating:`);
    console.log(`  1 - again (forgot)`);
    console.log(`  2 - hard  (barely remembered)`);
    console.log(`  3 - good  (recalled correctly)`);
    console.log(`  4 - easy  (effortless)`);

    const answer = await askQuestion("\nRating (1-4, Enter to skip, q to quit): ");

    if (answer === "q") {
      console.log("Review session ended early");
      break;
    }

    const ratingMap: Record<string, ReviewRating> = {
      "1": "again", "2": "hard", "3": "good", "4": "easy",
    };

    const rating = ratingMap[answer];
    if (rating) {
      recordReview(item.id, rating);
      console.log(`Recorded: ${rating}`);
    } else {
      console.log("Skipped");
    }

    console.log();
  }

  const finalStats = getStats();
  console.log(`Review complete. ${finalStats.due} items remaining due.`);
}
