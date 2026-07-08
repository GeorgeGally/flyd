import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { RAW_DIR, WIKI_DIR, CRYSTALLIZE_STATE_PATH, defaultModel } from "./config.js";
import { parse } from "./frontmatter.js";
import { agentLoop } from "./llm.js";
import { walkWikiFiles } from "./wiki.js";
import { pushGraphEdge, type BodyEdge } from "./graph.js";
import { updateRaw } from "./qmd.js";

interface CrystallizeState {
  version: number;
  updated: string;
  processedPaths: string[];
  pendingActions: CrystallizeAction[];
}

interface CrystallizeAction {
  type: "new_page" | "update_page" | "add_link" | "add_graph_edge";
  targetPath: string;
  content: string;
  summary: string;
}

function loadState(): CrystallizeState {
  if (!existsSync(CRYSTALLIZE_STATE_PATH)) {
    return { version: 1, updated: new Date().toISOString(), processedPaths: [], pendingActions: [] };
  }
  try {
    return JSON.parse(readFileSync(CRYSTALLIZE_STATE_PATH, "utf8"));
  } catch {
    return { version: 1, updated: new Date().toISOString(), processedPaths: [], pendingActions: [] };
  }
}

function saveState(state: CrystallizeState): void {
  mkdirSync(dirname(CRYSTALLIZE_STATE_PATH), { recursive: true });
  state.updated = new Date().toISOString();
  writeFileSync(CRYSTALLIZE_STATE_PATH, JSON.stringify(state, null, 2), "utf8");
}

function getUnprocessedCaptures(state: CrystallizeState): Array<{ path: string; body: string; metadata: Record<string, unknown> }> {
  if (!existsSync(RAW_DIR)) return [];

  const files = readdirSync(RAW_DIR)
    .filter(f => f.endsWith(".md"))
    .sort()
    .slice(-200);

  const results: Array<{ path: string; body: string; metadata: Record<string, unknown> }> = [];

  for (const f of files) {
    if (state.processedPaths.includes(f)) continue;
    try {
      const content = readFileSync(join(RAW_DIR, f), "utf8");
      const { body, metadata } = parse(content);
      if (body.trim().length < 200) continue; // Skip short captures
      results.push({ path: f, body: body.slice(0, 1500), metadata });
    } catch { /* skip unreadable */ }
  }

  return results;
}

function getWikiContext(): string {
  if (!existsSync(WIKI_DIR)) return "No wiki pages yet.";

  const files = walkWikiFiles();
  return files
    .map(f => {
      const rel = f.replace(WIKI_DIR + "/", "");
      const content = readFileSync(f, "utf8");
      const { metadata } = parse(content);
      const title = String(metadata.title ?? metadata.type ?? rel);
      return `- ${rel}: ${title}`;
    })
    .join("\n");
}

type CrystallizeTool = {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, { type: string; description?: string; enum?: string[] }>;
    required?: string[];
  };
};

export async function runCrystallize(opts: { dryRun?: boolean; maxActions?: number } = {}): Promise<void> {
  const state = loadState();
  const captures = getUnprocessedCaptures(state);

  if (captures.length === 0) {
    console.log("  no new captures to crystallize");
    return;
  }

  console.log(`  analyzing ${captures.length} unprocessed captures...`);

  const wikiContext = getWikiContext();
  const maxActionsPerBatch = opts.maxActions ?? 5;

  const systemPrompt = `You are a knowledge crystallizer. Your job is to extract durable knowledge from raw conversation captures and add it to a wiki.

You have these tools:
- read_wiki_page(path): read an existing wiki page
- propose_new_page(path, content, summary): propose a new wiki page
- propose_update(path, new_content, summary): propose updating an existing wiki page
- propose_link(from_path, to_path, label): propose adding a wikilink between pages
- propose_graph_edge(from_entity, to_entity, relation, confidence): propose adding a graph edge

Rules:
1. Only extract durable, factual knowledge — skip opinions, chit-chat, and meta-conversation
2. Link new knowledge to existing wiki pages when relevant
3. Keep wiki pages focused on a single topic
4. Propose at most ${maxActionsPerBatch} actions per batch
5. Use markdown for wiki page content
6. Wiki pages go in subdirectories by type: projects/, skills/, concepts/, people/, tools/, corrections/

Current wiki structure:
${wikiContext}`;

  // Process captures in batches of 5
  const batchSize = 5;
  let totalActions = 0;

  for (let i = 0; i < captures.length; i += batchSize) {
    const batch = captures.slice(i, i + batchSize);
    const batchText = batch
      .map((c, idx) => `[Capture ${idx + 1}: ${c.path}]
${c.body}`)
      .join("\n\n---\n\n");

    const userMessage = `Analyze these captures and propose wiki actions:\n\n${batchText}`;

    const mktool = (name: string, desc: string, props: Record<string, { type: string; description?: string }>, required: string[]): CrystallizeTool => ({
      name,
      description: desc,
      input_schema: { type: "object", properties: props, required },
    });

    const tools: CrystallizeTool[] = [
      mktool("read_wiki_page", "Read the full content of an existing wiki page", {
        path: { type: "string", description: "Wiki page relative path" },
      }, ["path"]),
      mktool("propose_new_page", "Propose creating a new wiki page", {
        path: { type: "string", description: "Relative path (e.g. projects/my-project.md)" },
        content: { type: "string", description: "Full markdown content" },
        summary: { type: "string", description: "One-line summary" },
      }, ["path", "content", "summary"]),
      mktool("propose_update", "Propose updating an existing wiki page", {
        path: { type: "string", description: "Wiki page relative path" },
        new_content: { type: "string", description: "New markdown content" },
        summary: { type: "string", description: "What changed and why" },
      }, ["path", "new_content", "summary"]),
      mktool("propose_link", "Propose adding a wikilink between existing wiki pages", {
        from_path: { type: "string", description: "Source wiki page" },
        to_path: { type: "string", description: "Target wiki page" },
        label: { type: "string", description: "Link text" },
      }, ["from_path", "to_path", "label"]),
      mktool("propose_graph_edge", "Propose adding an edge to the knowledge graph", {
        from_entity: { type: "string", description: "Source entity (slug)" },
        to_entity: { type: "string", description: "Target entity (slug)" },
        relation: { type: "string", description: "Relationship type" },
        confidence: { type: "number", description: "Confidence 0-1" },
      }, ["from_entity", "to_entity", "relation", "confidence"]),
    ];

    const actions: CrystallizeAction[] = [];

    const handleToolCall = (name: string, input: Record<string, unknown>): string => {
      switch (name) {
        case "read_wiki_page": {
          const path = String(input.path);
          const full = join(WIKI_DIR, path);
          if (!existsSync(full)) return `Wiki page "${path}" does not exist.`;
          try {
            const content = readFileSync(full, "utf8");
            return content;
          } catch {
            return `Error reading "${path}".`;
          }
        }
        case "propose_new_page": {
          actions.push({
            type: "new_page",
            targetPath: String(input.path),
            content: String(input.content),
            summary: String(input.summary),
          });
          return `Accepted: new page "${input.path}" proposed.`;
        }
        case "propose_update": {
          actions.push({
            type: "update_page",
            targetPath: String(input.path),
            content: String(input.new_content),
            summary: String(input.summary),
          });
          return `Accepted: update "${input.path}" proposed.`;
        }
        case "propose_link": {
          actions.push({
            type: "add_link",
            targetPath: `${input.from_path} → ${input.to_path}`,
            content: JSON.stringify(input),
            summary: `Link: ${input.label}`,
          });
          return `Accepted: link "${input.from_path} → ${input.to_path}" proposed.`;
        }
        case "propose_graph_edge": {
          actions.push({
            type: "add_graph_edge",
            targetPath: String(input.from_entity) + " → " + String(input.to_entity),
            content: JSON.stringify({
              from: String(input.from_entity),
              to: String(input.to_entity),
              rel_type: String(input.relation),
              confidence: Number(input.confidence),
              source: "body-extraction",
            }),
            summary: `Edge: ${input.relation}`,
          });
          return `Accepted: graph edge "${input.from_entity} ${input.relation} ${input.to_entity}" proposed.`;
        }
        default:
          return `Unknown tool: ${name}`;
      }
    };

    try {
      await agentLoop(systemPrompt, userMessage, tools, handleToolCall, defaultModel(), 10);
    } catch (e) {
      console.log(`  batch ${Math.floor(i / batchSize) + 1}: LLM error — ${e}`);
      continue;
    }

    // Execute actions
    if (actions.length === 0) {
      console.log(`  batch ${Math.floor(i / batchSize) + 1}: no actions proposed`);
    } else {
      console.log(`  batch ${Math.floor(i / batchSize) + 1}: ${actions.length} proposed actions`);

      for (const action of actions) {
        if (opts.dryRun) {
          console.log(`    [dry-run] ${action.summary} (${action.type}: ${action.targetPath})`);
          continue;
        }

        try {
          switch (action.type) {
            case "new_page":
            case "update_page": {
              const fullPath = join(WIKI_DIR, action.targetPath);
              mkdirSync(dirname(fullPath), { recursive: true });
              writeFileSync(fullPath, action.content, "utf8");
              console.log(`    ${action.type}: ${action.targetPath} — ${action.summary}`);
              break;
            }
            case "add_link":
              console.log(`    add_link: ${action.targetPath} — ${action.summary}`);
              break;
            case "add_graph_edge": {
              const edge = JSON.parse(action.content) as BodyEdge;
              pushGraphEdge(edge);
              console.log(`    add_graph_edge: ${edge.from} ${edge.rel_type} ${edge.to} — ${action.summary}`);
              break;
            }
          }
          totalActions++;
        } catch (e) {
          console.log(`    FAILED: ${action.targetPath} — ${e}`);
        }
      }
    }

    // Mark batch as processed
    for (const c of batch) {
      state.processedPaths.push(c.path);
    }
  }

  // Reindex after updates
  if (totalActions > 0) {
    try {
      await updateRaw();
      console.log("  reindexed");
    } catch {
      console.log("  reindex skipped (qmd not available)");
    }
  }

  saveState(state);
  console.log(`  ${totalActions} actions executed` +
    (opts.dryRun ? " (dry-run)" : ""));
}
