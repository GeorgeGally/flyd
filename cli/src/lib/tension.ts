import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "fs";
import { join } from "path";
import { WIKI_DIR } from "./config.js";
import { parse, serialize } from "./frontmatter.js";
import { loadCaptureDocs, type CaptureDoc } from "./attention.js";

export interface Goal {
  slug: string;
  title: string;
  deadline: string | null;
  status: "active" | "paused" | "achieved" | "abandoned";
  created: string;
  lastReviewed: string;
  topics: string[];
  source: "manual" | "extracted" | "inferred";
}

export interface TensionScore {
  goal: Goal;
  tension: number;
  progressRate: number;
  deadlinePressure: number;
  blockers: number;
  recentActivity: number;
  details: string[];
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function parseGoalFromContent(content: string): Goal | null {
  if (!content.startsWith("---")) return null;
  const parsed = parse(content);
  const meta = parsed.metadata;

  if (meta.type !== "goal") return null;

  return {
    slug: String(meta.slug ?? ""),
    title: (parsed.body.match(/^# (.+)/m)?.[1]) ?? String(meta.title ?? ""),
    deadline: typeof meta.deadline === "string" ? meta.deadline : null,
    status: ["active", "paused", "achieved", "abandoned"].includes(String(meta.status))
      ? String(meta.status) as Goal["status"]
      : "active",
    created: String(meta.created ?? ""),
    lastReviewed: String(meta.last_reviewed ?? ""),
    topics: Array.isArray(meta.topics) ? meta.topics.map(String) : [],
    source: ["manual", "extracted", "inferred"].includes(String(meta.source ?? ""))
      ? String(meta.source) as Goal["source"]
      : "manual",
  };
}

export function loadGoals(): Goal[] {
  const goalsDir = join(WIKI_DIR, "goals");
  if (!existsSync(goalsDir)) return [];

  const goals: Goal[] = [];
  for (const entry of readdirSync(goalsDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".md")) {
      try {
        const content = readFileSync(join(goalsDir, entry.name), "utf8");
        const goal = parseGoalFromContent(content);
        if (goal) goals.push(goal);
      } catch {}
    }
  }

  return goals.sort((a, b) => b.created.localeCompare(a.created));
}

export function createGoal(title: string, deadline: string | null = null, topics: string[] = []): Goal {
  const slug = slugify(title);
  const now = new Date().toISOString().split("T")[0];

  const goalDir = join(WIKI_DIR, "goals");
  mkdirSync(goalDir, { recursive: true });

  const content = serialize(
    {
      type: "goal",
      slug,
      title,
      status: "active",
      created: now,
      last_reviewed: now,
      deadline: deadline ?? "",
      topics,
      source: "manual",
      confidence: "high",
      tags: ["goal"],
    },
    `# ${title}\n\nDeadline: ${deadline ?? "No deadline set"}\n\n## Status\n\nActive — created ${now}\n\n## Progress Log\n\n`
  );

  writeFileSync(join(goalDir, `${slug}.md`), content, "utf8");

  return {
    slug,
    title,
    deadline,
    status: "active",
    created: now,
    lastReviewed: now,
    topics,
    source: "manual",
  };
}

export function updateGoal(slug: string, updates: Partial<Pick<Goal, "status" | "deadline">>): Goal | null {
  const goalsDir = join(WIKI_DIR, "goals");
  const goalPath = join(goalsDir, `${slug}.md`);
  if (!existsSync(goalPath)) return null;

  const content = readFileSync(goalPath, "utf8");
  const parsed = parse(content);
  const goal = parseGoalFromContent(content);
  if (!goal) return null;

  if (updates.status) goal.status = updates.status;
  if (updates.deadline !== undefined) goal.deadline = updates.deadline;

  const updatedMeta = {
    ...parsed.metadata,
    status: goal.status,
    deadline: goal.deadline ?? "",
    last_reviewed: new Date().toISOString().split("T")[0],
  };

  const newContent = serialize(updatedMeta, parsed.body);
  writeFileSync(goalPath, newContent, "utf8");

  return goal;
}

export function extractGoalsFromCaptures(docs: CaptureDoc[]): Array<{ title: string; deadline: string | null; topics: string[] }> {
  const candidates: Array<{ title: string; deadline: string | null; topics: string[] }> = [];

  for (const doc of docs) {
    if (doc.eventType !== "goal") continue;
    if (!doc.body || doc.body.length < 20) continue;

    const body = doc.body.slice(0, 500);
    const deadlineMatch = body.match(/\b(?:by|before|until|by the end of)\s+(q[1-4]\s*\d{4}|january|february|march|april|may|june|july|august|september|october|november|december\s+\d{4}|\d{4}-\d{2}-\d{2})/i);
    const deadline = deadlineMatch ? deadlineMatch[1].trim() : null;

    const title = body.split(/[.\n]/)[0].slice(0, 100).trim();
    if (title.length < 5) continue;

    candidates.push({ title, deadline, topics: doc.topics });
  }

  return candidates;
}

export function computeTension(goals: Goal[], docs: CaptureDoc[]): TensionScore[] {
  const scores: TensionScore[] = [];

  for (const goal of goals) {
    if (goal.status !== "active") {
      scores.push({
        goal,
        tension: goal.status === "achieved" ? 0 : 1,
        progressRate: goal.status === "achieved" ? 1 : 0,
        deadlinePressure: 0,
        blockers: 0,
        recentActivity: 0,
        details: [`Status: ${goal.status}`],
      });
      continue;
    }

    const goalTopics = goal.topics.length > 0 ? goal.topics : [slugify(goal.title)];
    const relevantDocs = docs.filter((d) =>
      d.topics.some((t) => goalTopics.some((gt) => t.includes(gt) || gt.includes(t))) ||
      d.body.toLowerCase().includes(goal.title.toLowerCase())
    );

    const now = Date.now();
    const thirtyDays = now - 30 * 24 * 60 * 60 * 1000;
    const recentDocs = relevantDocs.filter((d) => {
      const ms = new Date(d.date.replace(" ", "T") + "Z").getTime();
      return !isNaN(ms) && ms > thirtyDays;
    });

    const recentActivity = recentDocs.length;

    const blockerDocs = relevantDocs.filter((d) =>
      d.outcome === "blocked" || d.outcome === "declined" ||
      d.signal === "blocked" || d.signal === "delayed" || d.signal === "budget_resistance"
    );
    const blockers = blockerDocs.length;

    const progressDocs = relevantDocs.filter((d) =>
      d.signal === "progress" || d.signal === "milestone_reached" ||
      d.signal === "launched" || d.signal === "deal_closed" || d.signal === "team_growth"
    );
    const progressRate = relevantDocs.length > 0
      ? Math.min(1, progressDocs.length / Math.max(1, relevantDocs.length))
      : 0;

    let deadlinePressure = 0;
    if (goal.deadline) {
      try {
        const dl = new Date(goal.deadline).getTime();
        const created = new Date(goal.created).getTime();
        const totalDuration = dl - created;
        const elapsed = now - created;
        deadlinePressure = totalDuration > 0
          ? Math.min(1, Math.max(0, (elapsed / totalDuration) - progressRate))
          : 0;
      } catch {
        deadlinePressure = 0;
      }
    }

    const tension = Math.min(1, Math.max(0,
      0.3 * Math.max(0, 0.5 - progressRate) +
      0.3 * deadlinePressure +
      0.4 * Math.min(1, blockers / 3)
    ));

    const details: string[] = [];
    if (recentActivity === 0) details.push("No recent activity");
    else details.push(`${recentActivity} recent events`);
    if (blockers > 0) details.push(`${blockers} blockers detected`);
    if (progressRate < 0.3) details.push("Low progress rate");
    if (deadlinePressure > 0.5) details.push("High deadline pressure");
    if (tension >= 0.5) details.push("At risk");
    if (tension >= 0.8) details.push("Critical");

    scores.push({
      goal,
      tension: Math.round(tension * 100) / 100,
      progressRate: Math.round(progressRate * 100) / 100,
      deadlinePressure: Math.round(deadlinePressure * 100) / 100,
      blockers,
      recentActivity,
      details,
    });
  }

  return scores.sort((a, b) => b.tension - a.tension);
}

export function formatTensionReport(scores: TensionScore[]): string {
  const now = new Date().toISOString().split("T")[0];
  const lines = [`# Tension Report — ${now}`, ""];

  if (!scores.length) {
    lines.push("No goals tracked. Create goals with `flyd goal <title>`");
    return lines.join("\n");
  }

  lines.push("| Goal | Deadline | Progress | Tension | Status |");
  lines.push("|------|----------|----------|---------|--------|");

  for (const s of scores) {
    const status = s.tension >= 0.8 ? "⚠ Critical" :
      s.tension >= 0.5 ? "⚠ At risk" :
      s.tension <= 0.1 ? "✓ On track" : "— Active";

    const deadlineStr = s.goal.deadline?.slice(0, 10) ?? "—";
    lines.push(
      `| ${s.goal.title} | ${deadlineStr} | ${(s.progressRate * 100).toFixed(0)}% | ${(s.tension * 100).toFixed(0)}% | ${status} |`,
    );
  }

  lines.push("");

  for (const s of scores) {
    if (s.tension >= 0.5 || s.details.length > 2) {
      lines.push(`### ${s.goal.title}`);
      lines.push(`- Tension: ${(s.tension * 100).toFixed(0)}%`);
      for (const d of s.details) lines.push(`- ${d}`);
      if (s.blockers > 0) {
        lines.push(`- Blockers: ${s.blockers} events found (budget issues, declines, blocked signals)`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}
