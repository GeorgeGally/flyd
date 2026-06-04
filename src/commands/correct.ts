import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { WIKI_DIR, defaultModel } from "../lib/config.js";
import { parse, serialize } from "../lib/frontmatter.js";
import { walkWikiFiles } from "../lib/wiki.js";
import { query } from "../lib/llm.js";

export async function runCorrect(topic: string, correction: string, model?: string): Promise<void> {
  const m = model ?? defaultModel();

  // Search wiki entries for the topic — pick the best match by mention frequency
  let targetPath: string | null = null;
  let bestScore = 0;
  if (existsSync(WIKI_DIR)) {
    const topicLower = topic.toLowerCase();
    const files = walkWikiFiles();
    for (const file of files) {
      const content = readFileSync(file, "utf8").toLowerCase();
      const score = content.split(topicLower).length - 1;
      if (score > bestScore) {
        bestScore = score;
        targetPath = file;
      }
    }
  }

  const ts = new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
  const slug = topic.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase().slice(0, 60);

  if (targetPath) {
    // Append correction to existing wiki entry
    const content = readFileSync(targetPath, "utf8");
    const parsed = parse(content);
    const updated = `${content.trim()}\n\n### Correction (${ts})\n${correction}\n`;
    writeFileSync(targetPath, updated, "utf8");
    const rel = targetPath.replace(WIKI_DIR + "/", "");
    console.log(`appended correction to ${rel}`);
    return;
  }

  // Use LLM to determine the best path
  let bestPath = `corrections/${slug}`;
  try {
    const prompt = `Given a topic and correction, determine the best wiki directory to file this under.

Available directories: identity, career, projects, skills, education, awards, testimonials, people, constraints, corrections

Topic: "${topic}"
Correction: "${correction}"

Respond with ONLY the directory name. If uncertain, use "corrections".`;
    const dir = await query(prompt, m);
    const dirLower = dir.trim().toLowerCase();
    const knownDirs = ["identity", "career", "projects", "skills", "education", "awards", "testimonials", "people", "constraints"];
    const matchedDir = knownDirs.find(d => dirLower.includes(d));
    if (matchedDir) {
      bestPath = `${matchedDir}/${slug}`;
    }
  } catch { /* fall back to corrections */ }

  const fullPath = join(WIKI_DIR, `${bestPath}.md`);
  mkdirSync(join(WIKI_DIR, bestPath.split("/")[0]), { recursive: true });

  const metadata = {
    source: "correction",
    type: "correction",
    topic,
    timestamp: ts,
  };
  const body = `# ${topic}\n\n${correction}`;
  const output = serialize(metadata, body);
  writeFileSync(fullPath, output, "utf8");

  console.log(`wrote correction to wiki/${bestPath}.md`);
}
