import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { RAW_DIR, PROJECT, defaultModel } from "../lib/config.js";
import { serialize, parse } from "../lib/frontmatter.js";
import { query } from "../lib/llm.js";
import { search as qmdSearch, updateRaw, embedRaw } from "../lib/qmd.js";

const COMPOUND_PROMPT = `You are a learning document writer. Synthesize the following captures about a topic into a structured learning document.

Topic: {{topic}}

Captures:
{{captures}}

Write a learning document with these sections:

## Context
[What was the situation? What problem were we solving?]

## What We Learned
[Key insights, discoveries, and decisions. Be specific — include file paths, function names, and patterns where relevant.]

## Key Decisions
[Important choices made and why. Include alternatives considered and why they were rejected.]

## Patterns to Follow
[Reusable approaches, code patterns, or conventions discovered. Include concrete examples.]

## Open Questions
[Things still uncertain or worth investigating further.]

Rules:
- Only synthesize what's actually in the captures. Don't invent.
- Be specific — include names, paths, code patterns.
- If the captures contradict each other, note the contradiction.
- Keep it actionable. Someone reading this should be able to pick up where we left off.`;

export async function runCompound(topic: string, model?: string): Promise<void> {
  const m = model ?? defaultModel();

  const results = await qmdSearch(topic, "flyd-raw", 20);
  if (!results.length) {
    console.log(`no captures found for "${topic}"`);
    return;
  }

  const captureTexts: string[] = [];
  for (const r of results) {
    const fullPath = join(RAW_DIR, r.path);
    if (!existsSync(fullPath)) continue;
    const content = readFileSync(fullPath, "utf8");
    const { metadata, body } = parse(content);
    const ts = metadata.timestamp ? ` [${metadata.timestamp}]` : "";
    captureTexts.push(`--- Capture: ${r.path}${ts} (score=${r.score}%)\n${body.trim()}`);
  }

  const captures = captureTexts.join("\n\n");
  const prompt = COMPOUND_PROMPT
    .replace("{{topic}}", topic)
    .replace("{{captures}}", captures);

  console.log(`compounding knowledge on: "${topic}"\n`);

  const result = await query(prompt, m);

  const now = new Date();
  const timestamp = now
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d+Z$/, "");
  const filename = timestamp.replace(/[ :]/g, "-") + ".md";
  const filepath = join(RAW_DIR, filename);

  const content = serialize(
    {
      source: "compound",
      type: "compound",
      topic,
      captures_used: results.length,
      project: PROJECT.name,
      project_path: PROJECT.path,
      timestamp,
    },
    result
  );

  mkdirSync(RAW_DIR, { recursive: true });
  writeFileSync(filepath, content, "utf8");

  console.log(result);
  console.log(`\n---\nstored as ${filename}`);

  if (!process.env.VITEST) {
    await updateRaw();
    await embedRaw();
  }
}
