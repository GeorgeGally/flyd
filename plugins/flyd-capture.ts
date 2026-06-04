import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { execSync } from "child_process";
import type { PluginInput, Hooks } from "@opencode-ai/plugin";

const FLYD_ROOT = join(homedir(), ".flyd");
const FLYD_RAW = join(FLYD_ROOT, "raw");
const FLYD_WIKI = join(FLYD_ROOT, "wiki");
const FLYD_CACHE = join(FLYD_ROOT, "cache");
const FLYD_CONFIG = join(FLYD_ROOT, "config.json");
const FLYD_RESOLVER = join(FLYD_ROOT, "RESOLVER.md");
const FLYD_INTERESTS = join(FLYD_ROOT, "interests.json");
const FLYD_INTERESTS_CACHE = join(FLYD_CACHE, "interest-alerts");
const INGEST_QUEUE_PATH = join(FLYD_CACHE, "ingest-queue.json");
// ─── helpers ─────────────────────────────────────────────

function detectProject(cwd: string): { name: string; path: string } {
  try {
    const url = execSync("git remote get-url origin", {
      cwd, stdio: "pipe", encoding: "utf8", timeout: 3000,
    }).trim();
    if (url) {
      const ghMatch = url.match(/(?:github\.com[:/])([^\/]+\/[^\/]+?)(?:\.git)?$/);
      if (ghMatch) return { name: ghMatch[1], path: cwd };

      const genericMatch = url.match(/[:/]([^\/]+\/[^\/]+?)(?:\.git)?$/);
      if (genericMatch) return { name: genericMatch[1], path: cwd };

      const repoMatch = url.match(/([^\/]+?)(?:\.git)?$/);
      if (repoMatch) return { name: repoMatch[1], path: cwd };
    }
  } catch {}
  return { name: cwd.split("/").pop() || "unknown", path: cwd };
}

function timestamp(): string {
  return new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
}

function getConfigValue(key: string): string | null {
  try {
    const cfg = JSON.parse(readFileSync(FLYD_CONFIG, "utf8"));
    return cfg[key] || null;
  } catch { return null; }
}

async function queryLLM(prompt: string, apiKey: string, timeout = 5000): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: prompt }], temperature: 0.2 }),
      signal: ctrl.signal,
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as any;
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch { return null; }
  finally { clearTimeout(timer); }
}

// ─── cache layer ─────────────────────────────────────────────

const CACHE_DIRS: Record<string, string> = {
  raw: "raw",       // latest raw conversation
  distill: "notes", // latest distilled note
  gist: "gist",     // last Gist metadata
};

function cachePath(project: string, type: string): string {
  const safe = project.replace(/[^a-zA-Z0-9_-]/g, "_");
  const dir = CACHE_DIRS[type] ?? "raw";
  return join(FLYD_CACHE, dir, `${safe}.md`);
}

function readCache(project: string, type: string): string | null {
  try {
    const p = cachePath(project, type);
    if (!existsSync(p)) return null;
    return readFileSync(p, "utf8").trim();
  } catch { return null; }
}

function writeCache(project: string, type: string, content: string): void {
  try {
    const p = cachePath(project, type);
    mkdirSync(join(FLYD_CACHE, CACHE_DIRS[type] ?? "raw"), { recursive: true });
    writeFileSync(p, content, "utf8");
  } catch { /* non-fatal */ }
}

// ─── ingest queue ─────────────────────────────────────────

function isTrivialCapture(text: string): boolean {
  const stripped = text.replace(/[^\w\s]/g, " ").trim();
  const words = stripped.split(/\s+/).filter((w) => w.length > 2);
  return words.length < 10 || stripped.length < 100;
}

function addToIngestQueue(filename: string): void {
  try {
    if (!existsSync(join(FLYD_RAW, filename))) return;
    const content = readFileSync(join(FLYD_RAW, filename), "utf8");
    const bodyStart = content.indexOf("\n\n") + 2;
    const body = bodyStart > 1 ? content.slice(bodyStart).trim() : content;
    if (isTrivialCapture(body)) return;

    mkdirSync(FLYD_CACHE, { recursive: true });
    let queue: any[] = [];
    try {
      if (existsSync(INGEST_QUEUE_PATH)) {
        queue = JSON.parse(readFileSync(INGEST_QUEUE_PATH, "utf8"));
      }
    } catch {}

    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    queue.push({ id, capture_path: filename, queued_at: new Date().toISOString(), body });
    writeFileSync(INGEST_QUEUE_PATH, JSON.stringify(queue, null, 2), "utf8");
  } catch { /* non-fatal */ }
}

function getQueueSize(): number {
  try {
    if (!existsSync(INGEST_QUEUE_PATH)) return 0;
    return JSON.parse(readFileSync(INGEST_QUEUE_PATH, "utf8")).length;
  } catch { return 0; }
}

function triggerBatchIngest(): void {
  try {
    execSync("flyd ingest --write", { cwd: process.cwd(), stdio: "pipe", timeout: 30000 });
  } catch { /* fire-and-forget, don't block */ }
}

function getWikiStatus(): { pages: number; logLine: string } {
  try {
    if (!existsSync(join(FLYD_WIKI, "index.md"))) return { pages: 0, logLine: "" };
    const wikiFiles = readdirSync(FLYD_WIKI, { recursive: true } as any)
      .filter((f: string) => f.endsWith(".md") && !f.includes("/meta/") && f !== "index.md" && f !== "rejected.md" && f !== "log.md");
    let logLine = "";
    if (existsSync(join(FLYD_WIKI, "log.md"))) {
      const log = readFileSync(join(FLYD_WIKI, "log.md"), "utf8");
      const entries = log.match(/^## \[.*$/gm);
      if (entries && entries.length) logLine = entries[entries.length - 1].replace("## ", "");
    }
    return { pages: wikiFiles.length, logLine };
  } catch { return { pages: 0, logLine: "" }; }
}

// ─── resolver ────────────────────────────────────────────

const DEFAULT_RESOLVER = `# flyd Resolver

Routing table for memory.

## Memory domains

| Domain | What lives there | Path |
|--------|-----------------|------|
| identity | Who the user is — name, skills, education, background | wiki/identity/ |
| career | Work history — roles, companies, dates | wiki/career/ |
| projects | What was built — portfolio, campaigns, tech stacks | wiki/projects/ |
| sessions | Recent session distills — structured notes from each session | cache/notes/ |
| raw | Full capture history — per-exchange markdown | raw/ |

## Routing rules

| Pattern | Route to |
|---------|----------|
| "who is", "tell me about yourself", "background" | identity/ + latest distill |
| "what did you build", "portfolio", "projects" | projects/ |
| "timeline", "when did", "history" | career/ + projects/ |
| "why did we", "decision", "reasoning" | distills (decisions section) |
| "how does * work", "architecture", "patterns" | distills (patterns section) |
| "what are we working on", "current status" | latest distill (accomplishments + open questions) |
| "*anything else*" | search raw/ then fall back to wiki/ |

## Rules
- wiki/ entries are source of truth. Do not contradict them silently.
- Distill notes are observations, not facts. They may be stale.
- If information conflicts between domains, surface the conflict.

## Wiki entry format
New wiki entries should follow this schema:

## State
[What is currently true — updated in place as understanding changes]

## Timeline
[Append-only chronological record. Newest last.]

## Sources
[Links to raw/ captures or cache/notes/ distill entries that informed this entry]

For **wiki/people/** entries, use this variant:

## State
[Current role, focus areas, what they're working on — updated in place]

## Timeline
[Encounters in chronological order. Include date, context, and what was discussed.]

## Open threads
[Things pending with this person — follow-ups, action items, decisions deferred]

## Sources
[Raw captures or distill entries that informed this entry]

function getResolver(): string {
  try {
    if (existsSync(FLYD_RESOLVER)) {
      return readFileSync(FLYD_RESOLVER, "utf8").trim();
    }
  } catch { /* fall through to default */ }
  return DEFAULT_RESOLVER;
}

// ─── Gist save ────────────────────────────────────────────

async function saveToGist(token: string, content: string, description: string): Promise<string | null> {
  const body = {
    description,
    public: false,
    files: {
      [`${description.replace(/[^a-zA-Z0-9]/g, "-").slice(0, 60)}.md`]: { content },
    },
  };
  try {
    const resp = await fetch("https://api.github.com/gists", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as any;
    return data.html_url ?? null;
  } catch { return null; }
}

// ─── capture helpers ──────────────────────────────────────

interface Exchange {
  userMessageID: string;
  userText: string;
  assistantParts: Map<string, string>;
  tools: Array<{ name: string; title: string }>;
  agent: string;
  sessionID: string;
  startedAt: string;
}

const exchanges = new Map<string, Exchange>();

// ─── session-level conversation buffer ───────────────────────

const sessionConversations = new Map<string, string>();

function appendToConversation(sessionID: string, chunk: string) {
  if (!sessionConversations.has(sessionID)) {
    sessionConversations.set(sessionID, "");
  }
  sessionConversations.set(sessionID, sessionConversations.get(sessionID)! + chunk + "\n");
}

function drainConversation(sessionID: string): string {
  const conv = sessionConversations.get(sessionID) ?? "";
  sessionConversations.delete(sessionID);
  return conv;
}

function flushExchange(sessionID: string, cwd: string) {
  const ex = exchanges.get(sessionID);
  if (!ex) return;
  exchanges.delete(sessionID);
  if (!ex.userText.trim()) return;

  const project = detectProject(cwd);
  const ts = timestamp();
  const filename = ts.replace(/[ :]/g, "-") + ".md";
  const assistantText = [...ex.assistantParts.values()].join("\n").trim();

  let body = `## Question\n${ex.userText}\n`;
  if (ex.tools.length) {
    body += `\n## Tools\n`;
    for (const t of ex.tools) body += `- ${t.name}: ${t.title}\n`;
  }
  if (assistantText) body += `\n## Assistant\n${assistantText}\n`;

  const frontmatter = [
    "---", `source: auto`, `project: ${project.name}`, `project_path: ${project.path}`,
    `timestamp: ${ts}`, `session_id: ${sessionID}`, `agent: ${ex.agent}`, "---",
  ].join("\n");

  try {
    mkdirSync(FLYD_RAW, { recursive: true });
    writeFileSync(join(FLYD_RAW, filename), `${frontmatter}\n\n${body}`, "utf8");
    addToIngestQueue(filename);
  } catch { /* non-fatal */ }

  appendToConversation(sessionID, body);
}

function extractUserText(msgOutput: any): string {
  return (msgOutput.parts as any[])
    .filter((p: any) => {
      if (p.type !== "text") return false;
      if (p.synthetic || p.ignored) return false;
      return p.messageID === msgOutput.message.id;
    })
    .map((p: any) => p.text)
    .join("\n");
}

// ─── session-start injection ──────────────────────────────

// ─── interests ──────────────────────────────────────────────

function readActiveInterests(project: string): string[] {
  try {
    if (!existsSync(FLYD_INTERESTS)) return [];
    const store = JSON.parse(readFileSync(FLYD_INTERESTS, "utf8")) as {
      global: Array<{ topic: string; priority: string; last_active: string; staleness_days: number }>;
      projects: Record<string, string[]>;
    };
    const now = Date.now();
    const active: string[] = [];

    const projectTopics = store.projects?.[project]
      ? new Set(store.projects[project])
      : null;

    for (const i of store.global) {
      if (projectTopics && !projectTopics.has(i.topic)) continue;
      const lastActive = new Date(i.last_active.replace(" ", "T") + "Z").getTime();
      const daysSince = (now - lastActive) / (1000 * 60 * 60 * 24);
      if (daysSince <= (i.staleness_days ?? 30)) {
        active.push(`${i.topic} (${i.priority})`);
      }
    }
    return active;
  } catch { return []; }
}

function readInterestAlerts(): string | null {
  try {
    if (!existsSync(FLYD_INTERESTS_CACHE)) return null;
    const alerts = readFileSync(FLYD_INTERESTS_CACHE, "utf8").trim();
    // Clear after read
    writeFileSync(FLYD_INTERESTS_CACHE, "", "utf8");
    return alerts || null;
  } catch { return null; }
}

function matchInterests(text: string): string[] {
  try {
    if (!existsSync(FLYD_INTERESTS)) return [];
    const store = JSON.parse(readFileSync(FLYD_INTERESTS, "utf8")) as {
      global: Array<{ topic: string; keywords: string[]; priority: string }>;
    };
    const lower = text.toLowerCase();
    const matched: string[] = [];

    for (const i of store.global) {
      if (lower.includes(i.topic.toLowerCase())) {
        matched.push(i.topic);
        continue;
      }
      for (const kw of i.keywords ?? []) {
        if (lower.includes(kw.toLowerCase())) {
          matched.push(i.topic);
          break;
        }
      }
    }

    return matched;
  } catch { return []; }
}

function buildStartupInjection(cwd: string): string {
  const project = detectProject(cwd).name;
  const parts: string[] = [];

  // 1. Inject structured distill with timestamp
  const distill = readCache(project, "distill");
  if (distill) {
    const lines = distill.split("\n");
    const generatedLine = lines[0].startsWith("_distilled:") ? lines[0] : null;
    const body = generatedLine ? lines.slice(1).join("\n") : distill;
    parts.push(`[memory: ${project} — ${generatedLine ?? "unknown time"}]\n${body}`);
  } else {
    const rawNote = readCache(project, "raw");
    if (rawNote) {
      parts.push(`[memory: ${project} — no distill yet]\nRaw captures exist. Use search to retrieve specific details.`);
    }
  }

  // 2. Inject wiki status
  const wiki = getWikiStatus();
  const queueSize = getQueueSize();
  if (wiki.pages > 0 || queueSize > 0) {
    const wikiLines = [`[flyd wiki]`];
    if (wiki.pages > 0) wikiLines.push(`${wiki.pages} wiki pages`);
    if (queueSize > 0) wikiLines.push(`${queueSize} captures queued for ingest`);
    if (wiki.logLine) wikiLines.push(`last: ${wiki.logLine}`);
    parts.push(wikiLines.join("\n"));
  }

  // 3. Always inject resolver
  parts.push(`[routing]\n${getResolver()}`);

  // 4. Inject active interests
  const active = readActiveInterests(project);
  if (active.length > 0) {
    parts.push(`[interests]\nActive interests: ${active.join(", ")}`);
  }

  // 5. Inject interest alerts
  const alerts = readInterestAlerts();
  if (alerts) {
    parts.push(`[alerts]\n${alerts}`);
  }

  return parts.join("\n\n");
}



// ─── session-end: save + distill ────────────────────────────

async function onSessionEnd(sessionID: string, cwd: string): Promise<void> {
  const conversation = drainConversation(sessionID);
  if (!conversation || conversation.trim().length < 200) return;

  const project = detectProject(cwd).name;
  const apiKey = getConfigValue("OPENAI_API_KEY");
  const gistToken = getConfigValue("GITHUB_TOKEN");

  // 1. Save raw conversation to local cache (instant, synchronous)
  writeCache(project, "raw", conversation);

  // 2. Interest matching — check if this session's content matches any interests
  const matchedTopics = matchInterests(conversation);
  try {
    mkdirSync(join(homedir(), ".flyd", "cache"), { recursive: true });
    if (matchedTopics.length > 0) {
      const alerts = matchedTopics.map(t => `⚡ New session content matches interest: "${t}"`).join("\n");
      writeFileSync(FLYD_INTERESTS_CACHE, alerts, "utf8");
    } else {
      writeFileSync(FLYD_INTERESTS_CACHE, "", "utf8");
    }
  } catch { /* non-fatal */ }

  // 3. Save to Gist (async, non-blocking)
  const gistPromise: Promise<void> = (async () => {
    if (!gistToken) return;
    const desc = `flyd session ${project} ${timestamp().slice(0, 10)}`;
    const url = await saveToGist(gistToken, conversation, desc);
    if (url) writeCache(project, "gist", url);
  })();

  // 3. Distill in background (async, non-blocking) — rich structured output
  const distillPromise: Promise<void> = (async () => {
    if (!apiKey) return;
    const prompt = `Distill this work session into a structured memory document.

Sections:

## Accomplishments
What was built, fixed, changed, or decided. Be concrete.

## Decisions
Architecture choices, design tradeoffs, rejected alternatives. Include reasoning where visible.

## Files changed
Paths and what was done to each. Use \`path:line\` notation where relevant.

## Patterns
Recurring themes, weak signals, things that keep coming up across sessions. What's the signal in the noise?

## Open questions
Unresolved threads, things to follow up, decisions deferred. These are actionable — the next session should know them.

## People
Names and roles of anyone collaborated with, reviewed by, or discussed decisions with. Propose wiki/people/{name}.md entries or updates for people relevant to ongoing work.
- wiki/people/name.md → add: first encounter this session, context ({date})
- wiki/people/name.md → update: current focus area or role
If no one new or relevant was encountered, omit this section.

## Contradictions found
If this session conflicts with a known wiki entry (wiki/*.md), name the entry and the proposed correction. If none, omit this section.
NEVER write wiki entries automatically. Contradictions are surfaced for human review only.

## Entity updates
Proposed wiki additions based on this session — decisions, facts, or design choices that are durable and would still be true in 6 months. Each entry is a wiki path + proposed change, for human review only.
Before proposing, check if wiki/[relevant path] already contains this information. Only propose updates for genuinely new facts or changed understanding. Skip implementation details, session-specific context, and anything already captured in the wiki.
- wiki/path/entry.md → add: {fact or decision} ({date})
- wiki/path/entry.md → update: {changed understanding} ({date})
If no durable changes resulted from this session, omit this section.

## Constraints established
Behavioral rules discovered this session that must survive into future sessions.
Format: "do not X — reason." Only include if a concrete constraint was learned
(a test assumption, a naming dependency, an integration contract). Skip implementation
details. Omit if none.

Rules:
- Reference wiki entries by path (wiki/projects/foo.md) — never paste their content.
- Reference raw captures by path if relevant.
- Write in present tense as established facts.
- If the session was trivial (no accomplishments, decisions, or file changes), respond with exactly: No significant memory.

Project: ${project}
Conversation:
${conversation.slice(0, 4000)}`;

    const raw = await queryLLM(prompt, apiKey, 15000);
    if (!raw || raw === "No significant memory." || raw.trim().length < 20) return;

    writeCache(project, "distill", `_distilled: ${timestamp()}\n${raw.trim()}`);
  })();

  // Don't await either — fire and forget
  gistPromise.catch(() => {});
  distillPromise.catch(() => {});
}

// ─── plugin state: startup scans ──────────────────────────

const startupContexts = new Map<string, string>();

// ─── main plugin ──────────────────────────────────────────

export const server = async (input: PluginInput): Promise<Hooks> => {
  const cwd = input.directory;

  return {
    "chat.message": async (msgInput, msgOutput) => {
      try {
        const sessionID = msgInput.sessionID;

        // flush previous exchange
        flushExchange(sessionID, cwd);

        const userText = extractUserText(msgOutput);
        if (!userText.trim()) return;

        // inject startup context (first message only)
        const startupNote = startupContexts.get(sessionID);
        if (startupNote) {
          startupContexts.delete(sessionID);
          (msgOutput.parts as any[]).push({
            id: `flyd-startup-${sessionID}`,
            sessionID,
            messageID: msgOutput.message.id,
            type: "text",
            text: startupNote,
          });
        }

        // start new exchange buffer
        exchanges.set(sessionID, {
          userMessageID: msgOutput.message.id,
          userText,
          assistantParts: new Map(),
          tools: [],
          agent: msgInput.agent || "unknown",
          sessionID,
          startedAt: timestamp(),
        });
      } catch {
        // never block OpenCode
      }
    },

    "tool.execute.after": async (toolInput, toolOutput) => {
      try {
        const sessionID = toolInput.sessionID;
        const ex = exchanges.get(sessionID);
        if (!ex) return;
        ex.tools.push({ name: toolInput.tool, title: toolOutput.title });
      } catch {
        // never block OpenCode
      }
    },

    event: async ({ event }) => {
      try {
        // accumulate assistant text
        if (event.type === "message.part.updated") {
          const { part } = event.properties as any;
          if (part.type !== "text") return;
          if (part.synthetic || part.ignored) return;

          const sessionID = part.sessionID;
          const ex = exchanges.get(sessionID);
          if (!ex) return;

          if (part.messageID !== ex.userMessageID) {
            ex.assistantParts.set(part.id, part.text);
          }
          return;
        }

        // flush + save + distill + auto-ingest + auto-maintain
        if (event.type === "session.idle") {
          const sessionID = (event.properties as any).sessionID;
          if (sessionID) flushExchange(sessionID, cwd);
          await onSessionEnd(sessionID, cwd);

          // trigger batch ingest if queue is full
          if (getQueueSize() >= 5) {
            triggerBatchIngest();
          }

          return;
        }

        // flush on delete
        if (event.type === "session.deleted") {
          const sessionID = (event.properties as any).info?.id;
          if (sessionID) {
            flushExchange(sessionID, cwd);
            await onSessionEnd(sessionID, cwd);
          }
          return;
        }

        // session start: compute memory context + resolver
        if (event.type === "session.created") {
          const sessionID = (event.properties as any).info?.id;
          if (sessionID) {
            startupContexts.set(sessionID, buildStartupInjection(cwd));
          }
        }
      } catch {
        // never block OpenCode
      }
    },
  };
};
