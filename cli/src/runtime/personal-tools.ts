import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { FetchLike } from "../evidence/adapters/common.js";
import { JinaSearchAdapter } from "../evidence/adapters/web-jina.js";
import type { AgentTool } from "../lib/llm.js";

// First-class personal-assistant tools for CLI chat. Without them the model
// guessed URLs for current facts and spent a dozen tool calls grepping Flyd's
// own source to discover how to set a reminder.

const execFileAsync = promisify(execFile);

export const personalTools: AgentTool[] = [
  {
    name: "web_search",
    description: "Search the web for current facts (news, prices, scores, schedules, people, docs). Returns titles, URLs, and snippets; follow up with read_url for detail.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        count: { type: "number", description: "Results to return (1-10, default 6)" },
      },
      required: ["query"],
    },
  },
  {
    name: "remember",
    description: "Save a fact, preference, decision, or note to George's long-term Flyd memory. Use when he says remember/note/save this, or states a durable personal fact. Set about_george for lasting facts about George himself (preferences, people, identity, constraints) — those also go into his editable profile (USER.md).",
    input_schema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Self-contained note, written so it makes sense on its own later" },
        about_george: { type: "boolean", description: "True for a durable fact about George himself" },
        section: { type: "string", enum: ["About me", "Work", "People", "Preferences", "Routines", "Goals", "Constraints"], description: "Profile section for an about_george fact" },
      },
      required: ["text"],
    },
  },
  {
    name: "recall",
    description: "Search George's Flyd memory (captures, notes, past decisions, conversation history) for anything beyond the memory already in the prompt.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to look for" },
      },
      required: ["query"],
    },
  },
  {
    name: "reminders",
    description: "Apple Reminders. action=list shows open reminders; action=create adds one (only when George asks for a reminder).",
    input_schema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "create"], description: "list or create" },
        title: { type: "string", description: "Reminder title (create)" },
        due: { type: "string", description: "Local due time as YYYY-MM-DD HH:MM (create, optional)" },
        notes: { type: "string", description: "Extra notes (create, optional)" },
        list: { type: "string", description: "Reminders list name (optional)" },
      },
      required: ["action"],
    },
  },
  {
    name: "schedule",
    description: "Flyd's own agenda — make Flyd do something later, on its own, and notify George with the result. Use it proactively for follow-ups (\"check tomorrow 9am whether the PR merged\"), recurring briefings (\"every weekday 08:00 brief me\"), and anything George says he wants to know later. action=create needs task + when; list shows the agenda; cancel needs id.",
    input_schema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["create", "list", "cancel"], description: "create, list, or cancel" },
        task: { type: "string", description: "What Flyd should do then, written as an instruction to itself (create)" },
        when: { type: "string", description: "Local time YYYY-MM-DD HH:MM for the first run (create)" },
        repeat: { type: "string", enum: ["none", "hourly", "daily", "weekdays", "weekly"], description: "Recurrence (default none)" },
        id: { type: "string", description: "Agenda item id (cancel)" },
      },
      required: ["action"],
    },
  },
  {
    name: "mac",
    description: "Control George's Mac. action=open opens a URL, file, or app (target); notify shows a notification (text); clipboard_read / clipboard_write (text) use the clipboard — write only when George asks to copy something, never unprompted, since it replaces what he has copied; applescript runs an AppleScript (script) to drive any app — Notes, Mail drafts, Music, Finder, Safari tabs.",
    input_schema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["open", "notify", "clipboard_read", "clipboard_write", "applescript"], description: "What to do" },
        target: { type: "string", description: "URL, file path, or app name (open)" },
        text: { type: "string", description: "Notification or clipboard text" },
        script: { type: "string", description: "AppleScript source (applescript)" },
      },
      required: ["action"],
    },
  },
  {
    name: "calendar_events",
    description: "Read George's Apple Calendar events between two local dates (read-only).",
    input_schema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Start date YYYY-MM-DD (default today)" },
        days: { type: "number", description: "Number of days to cover (1-31, default 1)" },
      },
      required: [],
    },
  },
];

export const PERSONAL_TOOL_NAMES = new Set(personalTools.map((tool) => tool.name));

/** Tools whose effect lands outside the conversation; a retry would repeat it. */
export function isMutatingToolCall(name: string, input: Record<string, unknown>): boolean {
  if (name === "edit_file" || name === "write_file" || name === "bash" || name === "remember") return true;
  if (name === "schedule" || name === "todos") return input.action !== "list";
  if (name === "work_model" || name === "speaking_style" || name === "start_coding_task") return true;
  if (name === "flyd") return input.action === "run_briefing" || input.action === "skillify";
  if (name === "mac") return input.action !== "clipboard_read";
  return name === "reminders" && input.action === "create";
}

export interface PersonalToolDependencies {
  fetchFn?: FetchLike;
  now?: () => Date;
  runOsascript?: (script: string, args: string[]) => Promise<string>;
  capture?: (text: string) => Promise<string>;
  appendProfileFact?: (text: string, section?: string) => boolean;
  recall?: (query: string) => Promise<string>;
}

async function runOsascriptOnce(script: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("osascript", ["-e", script, ...args], {
    timeout: 20_000,
    maxBuffer: 1024 * 1024,
  });
  return stdout.trim();
}

/** "…execution error: Calendar got an error: X (-600)" → "Calendar got an error: X (-600)". */
export function appleScriptError(error: unknown): string {
  const stderr = String((error as { stderr?: unknown })?.stderr ?? "");
  const detail = stderr.match(/execution error:\s*(.+)/)?.[1]
    ?? stderr.trim().split("\n").filter(Boolean).pop()
    ?? (error instanceof Error ? error.message.split("\n")[0] : String(error));
  return detail.trim();
}

const APP_NOT_RUNNING = /\(-600\)/;
const PERMISSION_WAIT_MS = 2 * 60 * 1000;
/** An app that timed out is almost always blocked on a macOS permission prompt. */
const blockedApps = new Map<string, number>();

async function defaultOsascript(script: string, args: string[]): Promise<string> {
  if (process.platform !== "darwin") throw new Error("Apple apps are only available on macOS");
  const app = script.match(/tell application "([^"]+)"/)?.[1] ?? "the app";
  if ((blockedApps.get(app) ?? 0) > Date.now()) {
    throw new Error(`${app} is still waiting on macOS permission; do not retry until George approves it`);
  }
  try {
    return await runOsascriptOnce(script, args);
  } catch (error) {
    if ((error as { killed?: boolean }).killed) {
      blockedApps.set(app, Date.now() + PERMISSION_WAIT_MS);
      throw new Error(
        `${app} did not respond in 20s. macOS is most likely showing a prompt asking to let this terminal control ${app} ` +
        `(or it is off in System Settings › Privacy & Security › Automation). Do not retry; tell George.`,
      );
    }
    if (!APP_NOT_RUNNING.test(appleScriptError(error))) throw new Error(appleScriptError(error));
    // Scripting a closed app fails with -600 from some hosts; start it hidden and retry once.
    await execFileAsync("open", ["-g", "-a", app], { timeout: 10_000 }).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    try {
      return await runOsascriptOnce(script, args);
    } catch (retryError) {
      throw new Error(appleScriptError(retryError));
    }
  }
}

async function defaultCapture(text: string): Promise<string> {
  const { runCapture } = await import("../commands/capture.js");
  const path = await runCapture(text, { quiet: true, deferIndex: true });
  // Lexical indexing is cheap; embeddings stay with the background queue.
  void import("../lib/qmd.js").then(({ updateRaw }) => updateRaw()).catch(() => undefined);
  return path;
}

async function defaultRecall(query: string): Promise<string> {
  const { queryMemory } = await import("../cognition/memory.js");
  const memory = await queryMemory({ text: query, temporalFrame: "mixed", includeHistorical: true, limit: 8 });
  const terms = query.toLowerCase().split(/\W+/).filter((term) => term.length > 2);
  const current = memory.current.filter((claim) => {
    const text = `${claim.entityId} ${claim.attribute} ${claim.value}`.toLowerCase();
    return terms.some((term) => text.includes(term));
  });
  const { readMemoryEntries, searchDailyNotes } = await import("../council/memory-store.js");
  const curated = readMemoryEntries().filter((entry) => terms.some((term) => entry.text.toLowerCase().includes(term)));
  const lines = [
    ...curated.slice(0, 8).map((entry) => `- [curated ${entry.section.toLowerCase()}, confirmed ${entry.date}] ${entry.text}`),
    ...searchDailyNotes(query).slice(0, 6).map((note) => `- [daily note] ${note}`),
    ...current.slice(0, 6).map((claim) => `- [current] ${claim.entityId} · ${claim.attribute}: ${claim.value}`),
    ...memory.relevant.slice(0, 8).map((item) =>
      `- [${item.temporalStatus === "current" ? "memory" : "older"}] ${item.content.replace(/\s+/g, " ").slice(0, 400)} (${item.source})`),
  ];
  return lines.length ? lines.join("\n") : `Nothing in Flyd memory matches "${query}".`;
}

async function braveSearch(fetchFn: FetchLike, apiKey: string, query: string, count: number): Promise<string | null> {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`;
  const response = await fetchFn(url, {
    headers: { Accept: "application/json", "X-Subscription-Token": apiKey },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`Brave search HTTP ${response.status}`);
  const body = await response.json() as {
    web?: { results?: Array<{ title?: string; url?: string; description?: string; age?: string }> };
  };
  const results = body.web?.results ?? [];
  if (results.length === 0) return null;
  return results.slice(0, count).map((result, index) => {
    const snippet = (result.description ?? "").replace(/<[^>]+>/g, "").trim();
    return `${index + 1}. ${result.title ?? result.url}${result.age ? ` (${result.age})` : ""}\n${result.url}\n${snippet}`;
  }).join("\n\n");
}

async function jinaSearch(fetchFn: FetchLike, apiKey: string, query: string, count: number): Promise<string | null> {
  const items = await new JinaSearchAdapter({ fetchFn, apiKey }).search({ query, queryLabel: "chat web_search", limit: count });
  if (items.length === 0) return null;
  return items.map((item, index) =>
    `${index + 1}. ${item.title ?? item.locator}\n${item.locator}\n${(item.content ?? "").slice(0, 400)}`).join("\n\n");
}

/**
 * OpenAI's hosted web search. Slower than a raw index but returns a cited
 * synthesis; scraped HTML engines served junk to unauthenticated clients.
 */
async function openAIWebSearch(fetchFn: FetchLike, apiKey: string, query: string): Promise<string | null> {
  const response = await fetchFn("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.FLYD_WEB_SEARCH_MODEL?.trim() || "gpt-5.6-luna",
      reasoning: { effort: "low" },
      tools: [{ type: "web_search" }],
      input: `Search the web and report the key current facts for: ${query}\nBe concise. Include dates and cite source URLs inline.`,
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) throw new Error(`OpenAI web search HTTP ${response.status}`);
  const body = await response.json() as {
    output?: Array<{ type: string; content?: Array<{ type: string; text?: string }> }>;
  };
  const text = (body.output ?? [])
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content ?? [])
    .map((part) => part.text ?? "")
    .join("\n")
    .replace(/\?utm_source=openai/g, "")
    .trim();
  return text || null;
}

/** Providers whose key was rejected stay skipped for the process lifetime. */
const rejectedSearchProviders = new Set<string>();

export async function webSearch(query: string, count: number, fetchFn: FetchLike = fetch): Promise<string> {
  const errors: string[] = [];
  const providers: Array<[string, () => Promise<string | null>]> = [];
  const brave = process.env.BRAVE_SEARCH_API_KEY?.trim();
  const jina = process.env.JINA_API_KEY?.trim();
  if (brave) providers.push(["brave", () => braveSearch(fetchFn, brave, query, count)]);
  if (jina) providers.push(["jina", () => jinaSearch(fetchFn, jina, query, count)]);
  const openai = process.env.OPENAI_API_KEY?.trim();
  if (openai) providers.push(["openai", () => openAIWebSearch(fetchFn, openai, query)]);
  for (const [name, run] of providers) {
    if (rejectedSearchProviders.has(name)) continue;
    try {
      const results = await run();
      if (results) return `Web results for "${query}" (${name}):\n\n${results}`;
      errors.push(`${name}: no results`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/HTTP (?:401|402|403|422)\b/.test(message)) rejectedSearchProviders.add(name);
      errors.push(`${name}: ${message}`);
    }
  }
  return `Error: web search failed (${errors.join("; ")})`;
}

const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?$/;

const LIST_REMINDERS = `
on run argv
  set out to ""
  tell application "Reminders"
    repeat with r in (every reminder whose completed is false)
      set d to ""
      try
        set d to (due date of r) as string
      end try
      set out to out & "- " & (name of r) & " [" & (name of container of r) & "]"
      if d is not "" then set out to out & " — due " & d
      set out to out & linefeed
    end repeat
  end tell
  return out
end run`;

const CREATE_REMINDER = `
on run argv
  set {theTitle, theNotes, theList, hasDue, y, mo, dd, hh, mi} to argv
  tell application "Reminders"
    if theList is "" then
      set targetList to default list
    else
      set targetList to list theList
    end if
    set props to {name:theTitle}
    if theNotes is not "" then set props to props & {body:theNotes}
    set r to make new reminder at end of reminders of targetList with properties props
    if hasDue is "1" then
      set d to current date
      set day of d to 1
      set year of d to (y as integer)
      set month of d to (mo as integer)
      set day of d to (dd as integer)
      set hours of d to (hh as integer)
      set minutes of d to (mi as integer)
      set seconds of d to 0
      set due date of r to d
    end if
    return (name of r) & " in " & (name of targetList)
  end tell
end run`;

const LIST_EVENTS = `
on run argv
  set {y, mo, dd, span} to argv
  set startDate to current date
  set day of startDate to 1
  set year of startDate to (y as integer)
  set month of startDate to (mo as integer)
  set day of startDate to (dd as integer)
  set time of startDate to 0
  set endDate to startDate + ((span as integer) * days)
  set out to ""
  tell application "Calendar"
    repeat with c in calendars
      try
        repeat with e in (every event of c whose start date ≥ startDate and start date < endDate)
          set out to out & ((start date of e) as string) & " | " & (summary of e) & " [" & (name of c) & "]"
          try
            if location of e is not missing value and location of e is not "" then set out to out & " @ " & (location of e)
          end try
          set out to out & linefeed
        end repeat
      end try
    end repeat
  end tell
  return out
end run`;

function localDateParts(date: Date): [string, string, string] {
  return [
    String(date.getFullYear()),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ];
}

async function runMacAction(
  input: Record<string, unknown>,
  osascript: (script: string, args: string[]) => Promise<string>,
): Promise<string> {
  if (process.platform !== "darwin") return "Error: Mac control is only available on macOS";
  try {
    switch (input.action) {
      case "open": {
        const target = String(input.target ?? "").trim();
        if (!target) return "Error: open needs a target";
        const isUrl = /^[a-z][a-z0-9+.-]*:/i.test(target);
        const isPath = target.startsWith("/") || target.startsWith("~");
        const args = isUrl || isPath ? [target.replace(/^~(?=\/)/, process.env.HOME ?? "~")] : ["-a", target];
        await execFileAsync("open", args, { timeout: 15_000 });
        return `Opened ${target}`;
      }
      case "notify": {
        const text = String(input.text ?? "").trim();
        if (!text) return "Error: notify needs text";
        await osascript("on run argv\n display notification (item 1 of argv) with title \"Flyd\"\nend run", [text.slice(0, 220)]);
        return "Notification shown";
      }
      case "clipboard_read": {
        const { stdout } = await execFileAsync("pbpaste", [], { timeout: 5_000, maxBuffer: 1024 * 1024 });
        return stdout.length > 8000 ? `${stdout.slice(0, 8000)}\n... (truncated)` : stdout || "(clipboard is empty)";
      }
      case "clipboard_write": {
        const text = String(input.text ?? "");
        await new Promise<void>((resolve, reject) => {
          const child = execFile("pbcopy", [], { timeout: 5_000 }, (error) => error ? reject(error) : resolve());
          child.stdin?.end(text);
        });
        return `Copied ${text.length} chars to the clipboard`;
      }
      case "applescript": {
        const script = String(input.script ?? "").trim();
        if (!script) return "Error: applescript needs a script";
        const out = await osascript(script, []);
        return out || "AppleScript ran (no output)";
      }
      default:
        return "Error: mac action must be open, notify, clipboard_read, clipboard_write, or applescript";
    }
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export async function runPersonalTool(
  name: string,
  input: Record<string, unknown>,
  deps: PersonalToolDependencies = {},
): Promise<string> {
  const osascript = deps.runOsascript ?? defaultOsascript;
  switch (name) {
    case "web_search": {
      const query = String(input.query ?? "").trim();
      if (!query) return "Error: web_search needs a query";
      const count = Math.min(10, Math.max(1, Number(input.count) || 6));
      return webSearch(query, count, deps.fetchFn);
    }
    case "remember": {
      const text = String(input.text ?? "").trim();
      if (!text) return "Error: remember needs text";
      try {
        await (deps.capture ?? defaultCapture)(text);
        if (input.about_george === true) {
          const profile = await import("../lib/user-profile.js");
          const section = profile.PROFILE_SECTIONS.find((name) => name.toLowerCase() === String(input.section ?? "").toLowerCase());
          const append = deps.appendProfileFact
            ?? ((fact: string, target?: string) => profile.addUserProfileFact(fact, { section: target as never }));
          const added = append(text, section);
          return `Saved to Flyd memory${added ? " and George's profile (USER.md)" : " (already in his profile)"}: ${text.slice(0, 120)}`;
        }
        return `Saved to Flyd memory: ${text.slice(0, 120)}`;
      } catch (error) {
        return `Error saving memory: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    case "recall": {
      const query = String(input.query ?? "").trim();
      if (!query) return "Error: recall needs a query";
      try {
        return await (deps.recall ?? defaultRecall)(query);
      } catch (error) {
        return `Error searching memory: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    case "reminders": {
      try {
        if (input.action === "list") {
          const out = await osascript(LIST_REMINDERS, []);
          return out || "No open reminders.";
        }
        if (input.action !== "create") return "Error: reminders action must be list or create";
        const title = String(input.title ?? "").trim();
        if (!title) return "Error: a reminder needs a title";
        const dueText = String(input.due ?? "").trim();
        const due = dueText ? dueText.match(LOCAL_DATE_TIME) : null;
        if (dueText && !due) return `Error: due must be local YYYY-MM-DD HH:MM, got "${dueText}"`;
        const created = await osascript(CREATE_REMINDER, [
          title,
          String(input.notes ?? ""),
          String(input.list ?? ""),
          due ? "1" : "0",
          due?.[1] ?? "0", due?.[2] ?? "0", due?.[3] ?? "0", due?.[4] ?? "9", due?.[5] ?? "0",
        ]);
        return `Created reminder: ${created}${due ? ` — due ${dueText}` : ""}`;
      } catch (error) {
        return `Error with Reminders: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    case "schedule": {
      const agenda = await import("./agenda.js");
      try {
        if (input.action === "list") {
          const items = agenda.upcomingAgenda();
          return items.length ? items.map(agenda.describeAgendaItem).join("\n") : "Flyd's agenda is empty.";
        }
        if (input.action === "cancel") {
          const removed = agenda.cancelAgendaItem(String(input.id ?? ""));
          return removed ? `Cancelled: ${removed.task}` : `Error: no agenda item ${String(input.id ?? "")}`;
        }
        if (input.action !== "create") return "Error: schedule action must be create, list, or cancel";
        const repeat = String(input.repeat ?? "none") as import("./agenda.js").AgendaRepeat;
        const item = agenda.addAgendaItem({ task: String(input.task ?? ""), when: String(input.when ?? ""), repeat });
        return `Scheduled ${agenda.describeAgendaItem(item)}. Flyd will run it then and notify George.`;
      } catch (error) {
        return `Error: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    case "mac":
      return runMacAction(input, osascript);
    case "calendar_events": {
      const fromText = String(input.from ?? "").trim();
      const from = fromText.match(LOCAL_DATE_TIME);
      if (fromText && !from) return `Error: from must be YYYY-MM-DD, got "${fromText}"`;
      const [y, mo, dd] = from ? [from[1], from[2], from[3]] : localDateParts((deps.now ?? (() => new Date()))());
      const days = Math.min(31, Math.max(1, Math.round(Number(input.days) || 1)));
      try {
        const out = await osascript(LIST_EVENTS, [y, mo, dd, String(days)]);
        return out || `No calendar events from ${y}-${mo}-${dd} for ${days} day(s).`;
      } catch (error) {
        return `Error reading Calendar: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    default:
      return `Unknown tool: ${name}`;
  }
}
