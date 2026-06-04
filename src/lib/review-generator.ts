import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { RAW_DIR, WIKI_DIR, defaultModel } from "./config.js";
import { parse } from "./frontmatter.js";
import { query } from "./llm.js";
import { walkWikiFiles } from "./wiki.js";
import { type ReviewItem, makeReviewItem } from "./review-scheduler.js";

const GENERATION_PROMPT = `You are a knowledge review card generator. Given the following text, generate 1-3 review cards.

Each card has:
- question: A specific, answerable question about the content
- answer: The correct answer (1-3 sentences)

Rules:
- Questions should test factual recall, not trivia
- Focus on the most important claims in the text
- Skip vague or conversational sections
- If the text is too short or has no clear facts, return an empty array

Respond ONLY with JSON:
[
  { "question": "...", "answer": "..." }
]`;

export async function generateReviewItemsFromRaw(): Promise<ReviewItem[]> {
  const items: ReviewItem[] = [];

  // Process raw captures
  if (existsSync(RAW_DIR)) {
    const files = readdirSync(RAW_DIR)
      .filter(f => f.endsWith(".md"))
      .sort()
      .slice(-100);

    for (const f of files) {
      try {
        const content = readFileSync(join(RAW_DIR, f), "utf8");
        const { body, metadata } = parse(content);
        const title = String(metadata.title ?? metadata.project ?? metadata.type ?? f);
        const bodyTrimmed = body.trim().slice(0, 1500);

        if (bodyTrimmed.length < 100) continue;

        const cards = await extractCards(bodyTrimmed);
        for (const card of cards) {
          items.push(makeReviewItem(f, "raw", title, card.question, card.answer));
        }
      } catch { /* skip unreadable */ }
    }
  }

  // Process wiki pages
  if (existsSync(WIKI_DIR)) {
    const wikiFiles = walkWikiFiles();
    for (const f of wikiFiles) {
      try {
        const content = readFileSync(f, "utf8");
        const { body, metadata } = parse(content);
        const title = String(metadata.title ?? metadata.type ?? f);
        const rel = f.replace(WIKI_DIR + "/", "");
        const bodyTrimmed = body.trim().slice(0, 1500);

        if (bodyTrimmed.length < 100) continue;

        const cards = await extractCards(bodyTrimmed);
        for (const card of cards) {
          items.push(makeReviewItem(rel, "wiki", title, card.question, card.answer));
        }
      } catch { /* skip unreadable */ }
    }
  }

  return items;
}

async function extractCards(
  text: string,
): Promise<Array<{ question: string; answer: string }>> {
  try {
    const response = await query(`${GENERATION_PROMPT}\n\nText:\n${text}`, defaultModel());
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (c: unknown) =>
        typeof c === "object" &&
        c &&
        typeof (c as Record<string, unknown>).question === "string" &&
        typeof (c as Record<string, unknown>).answer === "string",
    ) as Array<{ question: string; answer: string }>;
  } catch {
    return [];
  }
}
