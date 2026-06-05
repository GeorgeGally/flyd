import { existsSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { WIKI_DIR } from "../lib/config.js";
import { loadGoals, createGoal, updateGoal, computeTension, formatTensionReport, extractGoalsFromCaptures } from "../lib/tension.js";
import { loadCaptureDocs } from "../lib/attention.js";

export async function runGoal(title: string, deadline?: string, ...topics: string[]): Promise<void> {
  const goal = createGoal(title, deadline ?? null, topics);
  console.log(`Goal created: ${goal.title}`);
  if (deadline) console.log(`  deadline: ${deadline}`);
  if (topics.length) console.log(`  topics: ${topics.join(", ")}`);
  console.log(`  saved to wiki/goals/${goal.slug}.md`);
}

export async function runGoalList(): Promise<void> {
  const goals = loadGoals();
  if (!goals.length) {
    console.log("No goals found. Create one with: flyd goal <title> [--deadline <date>]");
    return;
  }

  console.log("");
  for (const g of goals) {
    const statusEmoji = g.status === "active" ? "●" : g.status === "achieved" ? "✓" : g.status === "paused" ? "⏸" : "✗";
    console.log(`  ${statusEmoji} ${g.title}`);
    console.log(`    status: ${g.status} | deadline: ${g.deadline || "none"} | created: ${g.created}`);
  }
  console.log("");
}

export async function runGoalUpdate(slug: string, status: string): Promise<void> {
  if (!["active", "paused", "achieved", "abandoned"].includes(status)) {
    console.log(`Invalid status: ${status}. Use: active, paused, achieved, abandoned`);
    return;
  }
  const goal = updateGoal(slug, { status: status as "active" | "paused" | "achieved" | "abandoned" });
  if (goal) {
    console.log(`Goal "${goal.title}" updated to ${status}`);
  } else {
    console.log(`Goal "${slug}" not found`);
  }
}

export async function runTension(): Promise<void> {
  const goals = loadGoals();

  if (!goals.length) {
    // Try to extract goals from captures
    console.log("No manual goals found. Checking captures for goal-like events...");
    const docs = loadCaptureDocs();
    const extracted = extractGoalsFromCaptures(docs);

    if (!extracted.length) {
      console.log("No goals detected. Create one with: flyd goal <title> [--deadline <date>]");
      return;
    }

    console.log(`Found ${extracted.length} potential goals in captures:`);
    for (const g of extracted) {
      console.log(`  - ${g.title}${g.deadline ? ` (deadline: ${g.deadline})` : ""}`);
      console.log(`    topics: ${g.topics.join(", ") || "none"}`);
    }
    console.log("\nRun 'flyd goal \"<title>\"' to track these as explicit goals.");
    return;
  }

  const docs = loadCaptureDocs();
  const scores = computeTension(goals, docs);

  // Display summary
  console.log("");
  const active = goals.filter((g) => g.status === "active");
  console.log(`${active.length} active goals, ${goals.length - active.length} completed/paused`);
  console.log("");

  const highTension = scores.filter((s) => s.tension >= 0.5 && s.goal.status === "active");
  if (highTension.length > 0) {
    console.log("⚠ High Tension Goals:");
    for (const s of highTension) {
      console.log(`  ${s.goal.title}: ${(s.tension * 100).toFixed(0)}% tension`);
      console.log(`    ${s.details.join(", ")}`);
    }
    console.log("");
  }

  const onTrack = scores.filter((s) => s.tension <= 0.3 && s.goal.status === "active");
  if (onTrack.length > 0) {
    console.log("✓ On Track:");
    for (const s of onTrack) {
      console.log(`  ${s.goal.title}: ${(s.tension * 100).toFixed(0)}% tension (${s.recentActivity} recent events)`);
    }
    console.log("");
  }

  // Write report to wiki
  if (existsSync(WIKI_DIR)) {
    const report = formatTensionReport(scores);
    const reportPath = join(WIKI_DIR, "tension-report.md");
    mkdirSync(WIKI_DIR, { recursive: true });
    writeFileSync(reportPath, report, "utf8");
    console.log("Full report written to wiki/tension-report.md");
  }
}
