import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { execSync } from "child_process";
import { WIKI_DIR, FLYD_DIR } from "../lib/config.js";
import { WIKI_FOLDERS, wikiExists } from "../lib/wiki.js";

const OBSIDIAN_CONFIG = {
  "app.json": {
    newLinkFormat: "shortest",
    useMarkdownLinks: false,
    showLineNumber: false,
    showUnsupportedFiles: false,
    attachmentFolderPath: "./",
    alwaysUpdateLinks: true,
    promptDelete: false,
    defaultViewMode: "source",
    livePreview: true,
    showFrontmatter: true,
    readableLineLength: false,
    strictLineBreaks: false,
    showInlineTitle: false,
    propertiesInDocument: "source",
  },
  "core-plugins.json": {
    "file-explorer": true,
    "global-search": true,
    "switcher": true,
    "graph": true,
    "backlink": true,
    "outgoing-link": true,
    "tag-pane": true,
    "properties": true,
    "page-preview": true,
    "daily-notes": false,
    "templates": false,
    "note-composer": true,
    "command-palette": true,
    "slash-command": false,
    "editor-status": true,
    "bookmarks": true,
    "markdown-importer": true,
    "zk-prefixer": false,
    "random-note": false,
    "outline": true,
    "word-count": true,
    "slides": false,
    "audio-recorder": false,
    "workspaces": false,
    "file-recovery": true,
    "publish": false,
    "sync": false,
    "webviewer": false,
  },
  "graph.json": {
    "collapse-filter": false,
    "search": "",
    "showTags": false,
    "showAttachments": false,
    "hideUnresolved": false,
    "showOrphans": true,
    "collapse-color-groups": false,
    "colorGroups": [],
    "collapse-display": false,
    "showArrow": true,
    "textFadeMultiplier": 0,
    "nodeSizeMultiplier": 1,
    "lineSizeMultiplier": 1,
    "collapse-forces": false,
    "centerStrength": 0.518713,
    "repelStrength": 10,
    "linkStrength": 1,
    "linkDistance": 250,
    "scale": 1,
    "close": true,
  },
};

function writeObsidianConfig(): void {
  const obsidianDir = join(WIKI_DIR, ".obsidian");
  mkdirSync(obsidianDir, { recursive: true });
  for (const [filename, content] of Object.entries(OBSIDIAN_CONFIG)) {
    writeFileSync(join(obsidianDir, filename), JSON.stringify(content, null, 2) + "\n", "utf8");
  }
}

const SCHEMA_TEMPLATE = `# Wiki Schema

Flyd wiki conventions. Read by human and LLM.

## Folder structure

| Folder | Type | Description |
|--------|------|-------------|
| skills/ | skill | Technical and soft skills |
| education/ | education | Degrees, certifications, courses |
| career/ | career | Work history — roles, companies, dates |
| awards/ | award | Recognition and achievements |
| testimonials/ | testimonial | Endorsements and recommendations |
| projects/ | project | What was built — portfolio, campaigns |
| people/ | person | Contacts, collaborators, mentors |
| constraints/ | constraint | Behavioral rules, non-negotiables |
| topics/ | topic | Knowledge — concepts, entities, insights |
| flyd/ | flyd | Flyd tool internals — commands, architecture, workflows |

## Frontmatter fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| type | string | yes | One of the folder types above |
| source | string | no | How this page was created (ingest-auto, ask-synthesis, manual) |
| confidence | string | no | Reliability (high, medium, low) |
| tags | list | no | Classification tags for Dataview/Obsidian |
| aliases | list | no | Alternative names |
| created | date | no | ISO date when created |
| updated | date | no | ISO date when last modified |
| links | object list | no | Cross-references to other wiki pages |

## Links format

\`\`\`yaml
links:
  - target: topics/memory-capture
    type: related
    confidence: 0.9
\`\`\`

## How the LLM interacts with the wiki

1. Read \`index.md\` first to discover what exists
2. For new knowledge: create pages in the appropriate folder
3. For updates: read existing page, propose changes
4. Use \`[[wiki links]]\` in body text for Obsidian graph view
5. Log all changes via \`appendLog()\`
6. Regenerate \`index.md\` after any changes

## Opening in Obsidian

File → Open Vault → select \`~/.flyd/wiki/\`

The wiki is a git repo of markdown files. Commit before batch ingests.

## Agent operations

The wiki is designed for both CLI and direct LLM agent access.
In agent mode, the LLM reads this schema on startup and follows these conventions:

- To ingest new sources: read raw captures from \`~/.flyd/raw/\`, create wiki pages
- To answer questions: read index.md, then drill into relevant pages
- To maintain: run \`flyd consolidate\` for dedup + staleness + synthesis + reindex
- To check health: run \`flyd check\`
- Wiki pages are source of truth. Do not contradict them silently.
`;

export async function runWikiInit(opts: { git?: boolean; open?: boolean; force?: boolean } = {}): Promise<void> {
  const hasObsidian = existsSync(join(WIKI_DIR, ".obsidian"));

  if (wikiExists() && existsSync(join(WIKI_DIR, "schema.md")) && hasObsidian && !opts.force) {
    console.log("wiki already initialized — run 'flyd wiki init --force' to re-create schema");
    return;
  }

  mkdirSync(WIKI_DIR, { recursive: true });
  mkdirSync(join(WIKI_DIR, "meta"), { recursive: true });

  for (const folder of Object.values(WIKI_FOLDERS)) {
    mkdirSync(join(WIKI_DIR, folder), { recursive: true });
  }

  if (!hasObsidian || opts.force) {
    writeObsidianConfig();
  }

  if (!existsSync(join(WIKI_DIR, "schema.md")) || opts.force) {
    writeFileSync(join(WIKI_DIR, "schema.md"), SCHEMA_TEMPLATE, "utf8");
  }

  if (!existsSync(join(WIKI_DIR, "index.md")) || opts.force) {
    writeFileSync(
      join(WIKI_DIR, "index.md"),
      `# Wiki Index\nGenerated: ${new Date().toISOString().split("T")[0]}\n\nwiki has no pages yet — use flyd ingest to add knowledge.\n`,
      "utf8"
    );
  }

  if (!existsSync(join(WIKI_DIR, "log.md")) || opts.force) {
    const logEntry = `## [${new Date().toISOString().replace("T", " ").slice(0, 19)}] init | wiki created\n\nflyd wiki initialized. Schema and structure created.\n`;
    writeFileSync(join(WIKI_DIR, "log.md"), logEntry, "utf8");
  }

  if (opts.git) {
    try {
      execSync("git init", { cwd: WIKI_DIR, stdio: "pipe" });
      writeFileSync(join(WIKI_DIR, ".gitignore"), "meta/last-ingest.json\nmeta/index-cache.json\n", "utf8");
      console.log("  git repo initialized in wiki directory");
    } catch {
      // git not available, skip
    }
  }

  console.log("wiki initialized");
  console.log(`  schema:    wiki/schema.md`);
  console.log(`  index:     wiki/index.md`);
  console.log(`  log:       wiki/log.md`);
  console.log(`  obsidian:  wiki/.obsidian/ (vault config ready)`);
  console.log(`\nOpen in Obsidian: File → Open Vault → ${WIKI_DIR}`);

  if (opts.open) {
    try {
      execSync(`open -a Obsidian "${WIKI_DIR}"`, { stdio: "pipe" });
    } catch {
      console.log("Obsidian not found — install from https://obsidian.md");
    }
  }
}
