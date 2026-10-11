import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { firstmateHome } from "../lib/firstmate-home.js";
import { clipKeepingLinks } from "./line-links.js";
import { LineFollower } from "./line-follower.js";
import type { Exchange } from "./types.js";

// Firstmate hands most of George's notes to a crewmate and goes quiet, so its own session says nothing while the work
// happens. This reads the crewmate's side instead: which task's brief carries his note's words, and what that
// crewmate's own Claude Code session is doing now, as one short plain line ("Checking how you like spacing",
// "Looking at the footer"). Read-only: briefs, task records and transcripts are never written.

const STEP_CHARS = 90;
/** Steps are re-read at most this often; the window polls far faster. */
const REFRESH_MS = 1_500;
/** A note's opening words that must appear in a brief, in order, for that brief to be its task. */
const NOTE_WORDS = 10;
const MIN_NOTE_WORDS = 3;
/** A brief written this long before the note cannot be the note's task. */
const BRIEF_SLACK_MS = 60_000;

export interface Task {
  id: string;
  worktree?: string;
  harness?: string;
  /** The brief's captain's-intent words, and each later message firstmate passed on to the crewmate, normalized. */
  intents: string[];
  /** When the brief was written: the task started then. */
  since: number;
}

/** What a crewmate's session last said it was doing, read incrementally. */
interface Follow {
  follower: LineFollower;
  step?: string;
}

export class CrewProgress {
  private readonly home: string;
  private readonly claudeProjects: string;
  private readonly now: () => number;
  private readonly briefs = new Map<string, { mtimeMs: number; intent: string }>();
  private readonly messages = new Map<string, string>();
  private readonly follows = new Map<string, Follow>();
  private cached?: { at: number; key: string; steps: Map<string, string> };

  constructor(options: { home?: string; claudeProjects?: string; now?: () => number } = {}) {
    this.home = options.home ?? firstmateHome();
    this.claudeProjects = options.claudeProjects ?? join(homedir(), ".claude", "projects");
    this.now = options.now ?? Date.now;
  }

  /** The current step of the crewmate working on each unanswered note, by the note's question id. */
  steps(exchanges: Exchange[]): Map<string, string> {
    const open = exchanges.filter((exchange) => exchange.question.id.startsWith("note:") && !exchange.answer && !exchange.answered && !exchange.settled);
    const key = open.map((exchange) => exchange.question.id).join(",");
    const now = this.now();
    if (this.cached && this.cached.key === key && now - this.cached.at < REFRESH_MS) return this.cached.steps;
    const steps = new Map<string, string>();
    if (open.length) {
      let tasks: Task[] = [];
      try {
        tasks = this.tasks();
      } catch {
        tasks = [];
      }
      for (const exchange of open) {
        const task = taskFor(exchange, tasks);
        const step = task && this.stepOf(task);
        if (step) steps.set(exchange.question.id, step);
      }
    }
    this.cached = { at: now, key, steps };
    return steps;
  }

  /** Every task firstmate has in flight, with its brief. */
  private tasks(): Task[] {
    const state = join(this.home, "state");
    if (!existsSync(state)) return [];
    return readdirSync(state)
      .filter((name) => name.endsWith(".meta"))
      .flatMap((name): Task[] => {
        const id = name.slice(0, -".meta".length);
        const meta = fields(readQuietly(join(state, name)));
        const brief = this.brief(join(this.home, "data", id, "brief.md"));
        if (!brief) return [];
        const intents = [brief.intent, ...this.passedOn(join(state, `${id}.inbox`))];
        return [{ id, ...(meta.worktree ? { worktree: meta.worktree } : {}), ...(meta.harness ? { harness: meta.harness } : {}), intents, since: brief.mtimeMs }];
      });
  }

  private brief(path: string): { mtimeMs: number; intent: string } | undefined {
    let mtimeMs: number;
    try {
      mtimeMs = statSync(path).mtimeMs;
    } catch {
      return undefined;
    }
    const cached = this.briefs.get(path);
    if (cached && cached.mtimeMs === mtimeMs) return cached;
    const brief = { mtimeMs, intent: normalized(intentOf(readQuietly(path))) };
    this.briefs.set(path, brief);
    return brief;
  }

  /** What firstmate passed on to the crewmate after its brief: his later notes, in its steering inbox. Each message is read once. */
  private passedOn(inbox: string): string[] {
    const out: string[] = [];
    for (const dir of [inbox, join(inbox, "handled")]) {
      let names: string[];
      try {
        names = readdirSync(dir).filter((name) => name.endsWith(".msg"));
      } catch {
        continue;
      }
      for (const name of names) {
        const path = join(dir, name);
        // Acknowledging a message moves it into handled/ under the same name.
        const key = `${inbox}/${name}`;
        let text = this.messages.get(key);
        if (text === undefined) {
          text = normalized(readQuietly(path).replace(/^[\s\S]*?^--$/m, ""));
          if (text) this.messages.set(key, text);
        }
        out.push(text);
      }
    }
    return out;
  }

  /** The crewmate's own latest step, else what its task record says of it. */
  private stepOf(task: Task): string | undefined {
    const status = lastStatus(readQuietly(join(this.home, "state", `${task.id}.status`)));
    if (status?.state === "done") return "Finished, checking it over";
    if (status?.state === "needs-decision") return "Waiting on a decision";
    if (status?.state === "blocked") return "Held up, sorting it out";
    if (status?.state === "failed") return undefined;
    const session = task.harness === "claude" || !task.harness ? this.sessionStep(task) : undefined;
    return session ?? (status ? plainStep(status.text) : undefined);
  }

  private sessionStep(task: Task): string | undefined {
    if (!task.worktree) return undefined;
    const dir = join(this.claudeProjects, task.worktree.replace(/[^A-Za-z0-9]/g, "-"));
    let newest: { path: string; mtimeMs: number } | undefined;
    try {
      for (const name of readdirSync(dir)) {
        if (!name.endsWith(".jsonl")) continue;
        const path = join(dir, name);
        const { mtimeMs } = statSync(path);
        if (mtimeMs >= task.since && (!newest || mtimeMs > newest.mtimeMs)) newest = { path, mtimeMs };
      }
    } catch {
      return undefined;
    }
    if (!newest) return undefined;
    let follow = this.follows.get(newest.path);
    if (!follow) {
      follow = { follower: new LineFollower(newest.path) };
      this.follows.set(newest.path, follow);
    }
    const into = follow;
    try {
      into.follower.readNew(
        (line) => {
          const step = stepIn(line);
          if (step) into.step = step;
        },
        () => {
          delete into.step;
        },
      );
    } catch {
      // The session went away; keep what it last said.
    }
    return into.step;
  }
}

/** The task whose brief carries this note's opening words; the newest when several do. */
export function taskFor(exchange: Exchange, tasks: Task[]): Task | undefined {
  const words = normalized(exchange.question.text.replace(/\[(?:image|file): [^\]]*\]/g, " ")).split(" ").filter(Boolean).slice(0, NOTE_WORDS);
  if (words.length < MIN_NOTE_WORDS) return undefined;
  const phrase = ` ${words.join(" ")} `;
  const sent = Date.parse(exchange.question.timestamp ?? "");
  return tasks
    .filter((task) => {
      const [brief = "", ...later] = task.intents;
      // A note after the brief can only reach the crewmate as a passed-on message.
      return (` ${brief} `.includes(phrase) && (Number.isNaN(sent) || task.since >= sent - BRIEF_SLACK_MS)) || later.some((text) => ` ${text} `.includes(phrase));
    })
    .sort((a, b) => b.since - a.since)[0];
}

/** The brief's "Captain's intent" section: George's own words, as firstmate passed them on. */
function intentOf(brief: string): string {
  const match = /^##\s+Captain's intent\s*$([\s\S]*?)(?=^##\s|(?![\s\S]))/m.exec(brief);
  return match?.[1] ?? "";
}

function normalized(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9']+/g, " ")
    .replace(/'/g, "")
    .trim();
}

function fields(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const at = line.indexOf("=");
    if (at > 0) out[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return out;
}

function lastStatus(text: string): { state: string; text: string } | undefined {
  const line = text.trimEnd().split("\n").at(-1) ?? "";
  const match = /^([a-z-]+)(?:\s*\[[^\]]*\])?:\s*(.*)$/.exec(line);
  return match ? { state: match[1]!, text: match[2]! } : undefined;
}

function readQuietly(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

const TASTE_SKILL = /^flyd-taste-(.+)$/;
const MEMORY_SKILL = /^(?:flyd-ask|productivity:memory-management)$/;

/** The step one transcript line shows, if it shows one: the crewmate's own words before a tool, or the tool's purpose. */
export function stepIn(line: string): string | undefined {
  let entry: unknown;
  try {
    entry = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isRecord(entry) || entry.type !== "assistant" || entry.isSidechain === true) return undefined;
  const message = isRecord(entry.message) ? entry.message : undefined;
  const content = Array.isArray(message?.content) ? message.content.filter(isRecord) : [];
  let step: string | undefined;
  for (const block of content) {
    const found = block.type === "text" ? said(String(block.text ?? "")) : block.type === "tool_use" ? toolStep(block) : undefined;
    if (found) step = found;
  }
  return step;
}

/** Short words said between steps; a long report is an answer, not a step. */
function said(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 240 || trimmed.includes("\n\n")) return undefined;
  return plainStep(trimmed);
}

function toolStep(block: Record<string, unknown>): string | undefined {
  const input = isRecord(block.input) ? block.input : {};
  const name = String(block.name ?? "");
  if (name === "Skill") {
    const skill = String(input.skill ?? "");
    const taste = TASTE_SKILL.exec(skill)?.[1];
    if (taste === "spacing") return "Checking how you like spacing";
    if (taste === "interface") return "Checking how you like interfaces to look";
    if (taste) return "Checking your taste for this project";
    if (MEMORY_SKILL.test(skill)) return "Checking memory";
    return undefined;
  }
  if (name === "Read" && /(?:^|\/)(?:MEMORY|USER|TASTE)\.md$|\/memory\//.test(String(input.file_path ?? ""))) return "Checking memory";
  if (name === "TodoWrite" && Array.isArray(input.todos)) {
    const doing = input.todos.filter(isRecord).find((todo) => todo.status === "in_progress");
    return doing ? plainStep(String(doing.activeForm ?? doing.content ?? "")) : undefined;
  }
  if (name === "Bash" || name === "Agent" || name === "Task") return plainStep(String(input.description ?? ""));
  return undefined;
}

/** Machinery George never needs to read: paths, code, tools and the crew behind Flyd. */
const MACHINERY =
  /[/\\_`{}()\[\]=$<>|#@]|--|\.[a-z]{1,5}\b|\b(?:firstmate|first mate|crewmate|crew|worktree|inbox|brief|herdr|tmux|axi|git|grep|sed|jq|npm|npx|tsc|vitest|json|jsonl|stdout|regex|diff|HEAD|repo|branch|rebase|commit|typecheck|lint|bash|subagent|agent|transcript|status file|function|helper|module|probe|config|deps|env|PR|CI)\b/i;
/** An identifier in code: "stepIn", "fileName". */
const CAMEL = /[a-z][A-Z]/;
const STALL = /^(?:(?:ok(?:ay)?|now|next|so|good|right|then|first)[,.]?\s+)*(?:let me|let's|i'll|i will|i'm going to|i need to|i'm)\s+/i;

/** One short plain line, or nothing when it reads as machinery. */
export function plainStep(raw: string): string | undefined {
  const line = (raw.split("\n")[0] ?? "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/^(?:captain|george|sir)[,!:]\s*/i, "")
    .replace(STALL, "")
    .replace(/[:…]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (line.length < 6 || MACHINERY.test(line.replace(/https?:\/\/\S+/g, "link")) || CAMEL.test(line)) return undefined;
  const text = line[0]!.toUpperCase() + line.slice(1);
  return clipKeepingLinks(text.replace(/\.$/, ""), STEP_CHARS, 40);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
