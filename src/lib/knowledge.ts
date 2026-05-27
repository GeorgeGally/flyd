import { readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { KNOWLEDGE_DIR } from "./config.js";

export function keywordSearch(question: string): string | null {
  const concepts = join(KNOWLEDGE_DIR, "concepts");
  if (!existsSync(concepts)) return null;

  const qWords = new Set(
    question.toLowerCase().split(/\s+/).filter((w) => w.length > 2)
  );

  const scored: { score: number; path: string }[] = [];
  for (const file of readdirSync(concepts).filter((f) => f.endsWith(".md"))) {
    const text = readFileSync(join(concepts, file), "utf8").toLowerCase();
    const hits = [...qWords].filter((w) => text.includes(w)).length;
    if (hits > 0) scored.push({ score: hits, path: join(concepts, file) });
  }

  if (!scored.length) return null;

  scored.sort((a, b) => b.score - a.score);
  return scored
    .slice(0, 3)
    .map(({ path }) => readFileSync(path, "utf8"))
    .join("\n\n---\n\n");
}

export function buildQueryPrompt(question: string, context: string): string {
  return `You are a personal knowledge query engine. Answer using only the knowledge below. Cite sources.

## Knowledge
${context}

## Question
${question}`;
}
