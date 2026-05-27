import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { FLYD_DIR, RAW_DIR, KNOWLEDGE_DIR, hasApiKey, defaultModel } from "../lib/config.js";
import { loadState, saveState, fileHash } from "../lib/state.js";
import { query } from "../lib/llm.js";

interface ConceptArticle {
  filename: string;
  content: string;
}

export async function runCompile(opts: { force?: boolean; model?: string } = {}): Promise<void> {
  const model = opts.model ?? defaultModel();
  const state = loadState();

  const changed = getChangedFiles(state, opts.force ?? false);
  if (!changed.length) {
    console.log("nothing to compile");
    return;
  }

  if (!hasApiKey(model)) {
    console.log(`compile requires an API key — run 'flyd setup'`);
    return;
  }

  ensureDirs();

  const existing = readExistingKnowledge();
  const rawSections = changed.map(({ path, content }) =>
    `## ${path}\n\n${content}`
  );

  const prompt = buildCompilePrompt(existing, rawSections);
  console.log(`compiling ${changed.length} file(s)...`);

  const response = await query(prompt, model);
  const articles = parseArticles(response);

  for (const { filename, content } of articles) {
    const dest = join(KNOWLEDGE_DIR, "concepts", filename);
    writeFileSync(dest, content, "utf8");
    console.log(`  wrote concepts/${filename}`);
  }

  const now = new Date().toISOString();
  for (const { path, content } of changed) {
    state.raw[path] = { hash: fileHash(content), compiled_at: now };
  }
  saveState(state);

  updateIndex();
  appendLog(changed.map(({ path }) => path), articles.map(({ filename }) => `concepts/${filename}`));
  console.log(`done`);
}

function getChangedFiles(state: State, force: boolean): { path: string; content: string }[] {
  if (!existsSync(RAW_DIR)) return [];
  const files = readdirSync(RAW_DIR).filter((f) => f.endsWith(".md")).sort();
  const changed: { path: string; content: string }[] = [];
  for (const file of files) {
    const absPath = join(RAW_DIR, file);
    const content = readFileSync(absPath, "utf8");
    const relPath = `raw/${file}`;
    const hash = fileHash(content);
    if (force || state.raw[relPath]?.hash !== hash) {
      changed.push({ path: relPath, content });
    }
  }
  return changed;
}

function readExistingKnowledge(): string {
  const concepts = join(KNOWLEDGE_DIR, "concepts");
  if (!existsSync(concepts)) return "(none)";
  const files = readdirSync(concepts).filter((f) => f.endsWith(".md"));
  if (!files.length) return "(none)";
  return files
    .map((f) => `## concepts/${f}\n\n${readFileSync(join(concepts, f), "utf8")}`)
    .join("\n\n---\n\n");
}

function buildCompilePrompt(existing: string, rawSections: string[]): string {
  const today = new Date().toISOString().split("T")[0];
  return `You are a personal knowledge compiler.

Extract facts, projects, people, preferences, skills, education, awards, testimonials, and career history from the raw captures below.

Rules:
1. Prefer updating existing articles over creating duplicates.
2. Every article must have YAML frontmatter: title, status (working), sources (list), created, updated.
3. Write concise encyclopedia-style articles — no chatty summaries.
4. Do not invent facts not present in sources.
5. Respond with a JSON array only — no other text.

Response format:
[
  { "filename": "slug.md", "content": "---\\ntitle: ...\\n---\\n# ...\\n" },
  ...
]

Compiled date: ${today}

## Existing Knowledge
${existing}

## Raw Captures to Compile
${rawSections.join("\n\n---\n\n")}`;
}

function parseArticles(response: string): ConceptArticle[] {
  const match = response.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    return JSON.parse(match[0]) as ConceptArticle[];
  } catch {
    return [];
  }
}

function ensureDirs(): void {
  for (const sub of ["concepts", "connections", "qa"]) {
    mkdirSync(join(KNOWLEDGE_DIR, sub), { recursive: true });
  }
  const index = join(KNOWLEDGE_DIR, "index.md");
  if (!existsSync(index)) writeFileSync(index, "# Knowledge Index\n\n| Article | Summary | Updated |\n|---------|---------|--------|\n", "utf8");
  const log = join(KNOWLEDGE_DIR, "log.md");
  if (!existsSync(log)) writeFileSync(log, "# Build Log\n", "utf8");
}

function updateIndex(): void {
  const concepts = join(KNOWLEDGE_DIR, "concepts");
  const files = existsSync(concepts) ? readdirSync(concepts).filter((f) => f.endsWith(".md")) : [];
  const today = new Date().toISOString().split("T")[0];
  const rows = files.map((f) => {
    const text = readFileSync(join(concepts, f), "utf8");
    const title = text.match(/^title:\s*(.+)$/m)?.[1] ?? f.replace(".md", "");
    return `| [[concepts/${f.replace(".md", "")}]] | ${title} | ${today} |`;
  });
  const content = "# Knowledge Index\n\n| Article | Summary | Updated |\n|---------|---------|--------|\n" + rows.join("\n") + "\n";
  writeFileSync(join(KNOWLEDGE_DIR, "index.md"), content, "utf8");
}

function appendLog(sources: string[], articles: string[]): void {
  const log = join(KNOWLEDGE_DIR, "log.md");
  const today = new Date().toISOString().split("T")[0];
  const existing = existsSync(log) ? readFileSync(log, "utf8") : "# Build Log\n";
  const entry = `\n## [${today}] compile\n- Sources: ${sources.join(", ")}\n- Articles:\n${articles.map((a) => `  - ${a}`).join("\n")}\n`;
  writeFileSync(log, existing.trimEnd() + entry, "utf8");
}

// Type import for State
import type { State } from "../lib/state.js";
