import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { RAW_DIR, CACHE_DIR, defaultModel } from "../lib/config.js";
import { parse } from "../lib/frontmatter.js";
import { query } from "../lib/llm.js";

interface ProjectCapture {
  timestamp: string;
  body: string;
}

const DISTILL_PROMPT = `Distill these captures into a structured memory document. Read every capture — they span different sessions but share a project.

Sections:

## Accomplishments
What was built, fixed, changed, or decided across these captures. Be concrete. List each accomplishment separately.

## Decisions
Architecture choices, design tradeoffs, rejected alternatives. Include reasoning where visible.

## Files changed
Paths and what was done to each.

## Patterns
Recurring themes, weak signals, things that keep coming up. What's the signal in the noise?

## Open questions
Unresolved threads, things to follow up, decisions deferred.

## Contradictions found
If any capture conflicts with another, name the conflict and the proposed resolution. Omit if none.

Rules:
- Write in present tense as established facts.
- If the captures are trivial or empty, respond with exactly: No significant memory.`;

export async function runDistill(opts: { project?: string; limit?: number; model?: string }): Promise<void> {
  const m = opts.model ?? defaultModel();

  if (!existsSync(RAW_DIR)) {
    console.log("no raw captures found");
    return;
  }

  const files = readdirSync(RAW_DIR).filter(f => f.endsWith(".md")).sort();

  // Group by project
  const byProject = new Map<string, ProjectCapture[]>();
  for (const file of files) {
    try {
      const content = readFileSync(join(RAW_DIR, file), "utf8");
      const { metadata, body } = parse(content);
      const project = String(metadata.project ?? "unknown");
      const timestamp = String(metadata.timestamp ?? file.replace(/\.md$/, ""));

      if (opts.project && project !== opts.project) continue;
      if (!byProject.has(project)) byProject.set(project, []);
      byProject.get(project)!.push({ timestamp, body });
    } catch { /* skip unreadable files */ }
  }

  if (byProject.size === 0) {
    console.log("no captures found");
    return;
  }

  const sorted = [...byProject.entries()].sort(([, a], [, b]) => a.length - b.length);
  const toProcess = sorted.slice(0, opts.limit ?? sorted.length);

  mkdirSync(join(CACHE_DIR, "notes"), { recursive: true });

  let done = 0;
  let skipped = 0;

  for (const [project, captures] of toProcess) {
    const captureText = captures
      .map(c => `[${c.timestamp}]\n${c.body.trim().slice(0, 500)}`)
      .join("\n\n---\n\n");

    const prompt = `${DISTILL_PROMPT}

Project: ${project}
Captures (${captures.length} total):
${captureText.slice(0, 5000)}`;

    try {
      const raw = await query(prompt, m);
      if (!raw || raw === "No significant memory." || raw.trim().length < 20) {
        skipped++;
        continue;
      }

      const safeName = project.replace(/[^a-zA-Z0-9_-]/g, "_");
      writeFileSync(join(CACHE_DIR, "notes", `${safeName}.md`), raw.trim(), "utf8");
      done++;
      console.log(`  ${project}: ${captures.length} captures → cache/notes/${safeName}.md`);
    } catch {
      skipped++;
    }
  }

  console.log(`\ndone. ${done} projects distilled, ${skipped} skipped.`);
}
