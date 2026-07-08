import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { RAW_DIR, PROJECT, defaultModel } from "../lib/config.js";
import { serialize } from "../lib/frontmatter.js";
import { query } from "../lib/llm.js";
import { updateRaw, embedRaw } from "../lib/qmd.js";

const RESEARCH_PROMPT = `You are an expert researcher. Your task is to research the following topic and produce a comprehensive, factual summary.

Topic: {{topic}}

Structure your response as follows:

## Overview
[2-3 sentence high-level summary]

## Key Facts
[Bullet points of concrete, factual information about this topic]

## Current Landscape
[Recent developments, state of the art, major players or contributors]

## Connections
[Related topics, technologies, people, or projects this connects to]

## Open Questions
[Things that are debated, uncertain, or worth investigating further]

## Sources
[Note: these come from your training data — mark clearly if uncertain]

Rules:
- Only state facts you are confident about. Mark uncertain claims with a question mark.
- Be specific — include names, numbers, dates, and version numbers where known.
- If the topic is ambiguous (e.g. "Rails" could be Ruby on Rails or physical rails), note the ambiguity and cover the most likely interpretation first.
- Keep it dense and factual. Aim for 300-800 words.`;

export async function runResearch(topic: string, model?: string): Promise<void> {
  const m = model ?? defaultModel();
  const prompt = RESEARCH_PROMPT.replace("{{topic}}", topic);

  console.log(`researching: "${topic}"\n`);

  const result = await query(prompt, m);

  // Capture the research result
  mkdirSync(RAW_DIR, { recursive: true });

  const now = new Date();
  const timestamp = now
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d+Z$/, "");
  const filename = timestamp.replace(/[ :]/g, "-") + ".md";
  const filepath = join(RAW_DIR, filename);

  const content = serialize(
    {
      source: "research",
      type: "research",
      topic,
      project: PROJECT.name,
      project_path: PROJECT.path,
      timestamp,
    },
    result
  );

  writeFileSync(filepath, content, "utf8");

  // Print the result
  console.log(result);
  console.log(`\n---\nstored as ${filename}`);

  // Re-index
  if (!process.env.VITEST) {
    await updateRaw();
    await embedRaw();
  }
}
