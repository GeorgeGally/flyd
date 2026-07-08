import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { PLANS_DIR } from "../lib/config.js";
import { parse } from "../lib/frontmatter.js";

function listPlans(): { filename: string; topic: string; status: string; timestamp: string }[] {
  if (!existsSync(PLANS_DIR)) return [];
  const files = readdirSync(PLANS_DIR)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .reverse();

  return files.map((f) => {
    const content = readFileSync(join(PLANS_DIR, f), "utf8");
    const { metadata } = parse(content);
    return {
      filename: f,
      topic: String(metadata.topic ?? f.replace(/\.md$/, "")),
      status: String(metadata.status ?? "draft"),
      timestamp: String(metadata.timestamp ?? ""),
    };
  });
}

function findPlan(query: string): string | null {
  if (!existsSync(PLANS_DIR)) return null;
  const files = readdirSync(PLANS_DIR).filter((f) => f.endsWith(".md")).sort().reverse();
  const q = query.toLowerCase();

  for (const f of files) {
    if (f.toLowerCase().includes(q)) {
      return join(PLANS_DIR, f);
    }
  }

  // Search by topic in frontmatter
  for (const f of files) {
    try {
      const content = readFileSync(join(PLANS_DIR, f), "utf8");
      const { metadata } = parse(content);
      if (String(metadata.topic ?? "").toLowerCase().includes(q)) {
        return join(PLANS_DIR, f);
      }
    } catch { /* skip */ }
  }

  return null;
}

function printChecklist(content: string): void {
  const { metadata, body } = parse(content);

  console.log(`Plan: ${metadata.topic}`);
  console.log(`Status: ${metadata.status}`);
  if (metadata.timestamp) console.log(`Created: ${metadata.timestamp}`);
  console.log("");

  // Find and print implementation steps as checklist
  const lines = body.split("\n");
  let inSteps = false;
  let inCriteria = false;

  for (const line of lines) {
    if (/^## Implementation steps/i.test(line)) {
      inSteps = true;
      inCriteria = false;
      console.log("Implementation steps:");
      console.log("");
      continue;
    }
    if (/^## Acceptance criteria/i.test(line)) {
      inSteps = false;
      inCriteria = true;
      console.log("");
      console.log("Acceptance criteria:");
      console.log("");
      continue;
    }
    if (/^## /.test(line)) {
      inSteps = false;
      inCriteria = false;
    }
    if (inSteps || inCriteria) {
      if (/^- \[.?\]/.test(line)) {
        console.log(line);
      } else if (line.trim() && !inSteps && !inCriteria) {
        console.log(line);
      }
    }
  }

  // Print full body as reference
  console.log("");
  console.log("─".repeat(40));
  console.log("");
  console.log(body.trim());
}

export async function runWork(query?: string): Promise<void> {
  const plans = listPlans();

  if (!plans.length) {
    console.log("no plans found — run 'flyd plan <topic>' first");
    return;
  }

  // No query: show latest plan
  if (!query) {
    const latest = plans[0];
    const content = readFileSync(join(PLANS_DIR, latest.filename), "utf8");
    printChecklist(content);
    return;
  }

  // --list flag
  if (query === "--list") {
    console.log("plans:\n");
    for (const p of plans) {
      const label = p.status === "draft" ? "" : ` [${p.status}]`;
      console.log(`  ${p.filename}${label}`);
      console.log(`    topic: ${p.topic}`);
      console.log("");
    }
    return;
  }

  // Find by query
  const found = findPlan(query);
  if (!found) {
    console.log(`no plan found matching "${query}"`);
    console.log("run 'flyd work --list' to see all plans");
    return;
  }

  const content = readFileSync(found, "utf8");
  printChecklist(content);
}
