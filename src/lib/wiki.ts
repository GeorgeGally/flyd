import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { WIKI_DIR } from "./config.js";
import { parse, type ParsedMarkdown } from "./frontmatter.js";

export const WIKI_FOLDERS: Record<string, string> = {
  skill: "skills",
  education: "education",
  career: "career",
  award: "awards",
  testimonial: "testimonials",
  project: "projects",
  person: "people",
  constraint: "constraints",
};

export interface MemoryMatch {
  path: string;
  metadata: Record<string, unknown>;
  body: string;
  score: number;
}

export function readWikiFile(path: string): ParsedMarkdown {
  return parse(readFileSync(path, "utf8"));
}

export function walkWikiFiles(): string[] {
  if (!existsSync(WIKI_DIR)) return [];
  const results: string[] = [];
  const stack = [WIKI_DIR];
  while (stack.length) {
    const dir = stack.pop()!;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "meta") stack.push(full);
      } else if (
        entry.isFile() &&
        entry.name.endsWith(".md") &&
        entry.name !== "rejected.md" &&
        entry.name !== "index.md"
      ) {
        results.push(full);
      }
    }
  }
  return results.sort();
}
