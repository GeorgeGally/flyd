import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { inFlydsVoice } from "./flyd-voice.js";
import type { ConversationMessage, Exchange, SentMessage } from "./types.js";

// Flyd is the voice of the conversation window. A question that is not
// software or fleet work (what to do in Bangkok tonight) is Flyd's to answer,
// with its own assistant turn, and never reaches firstmate. Each question and
// its answer are kept as one file under ~/.flyd/view/asks, so they survive the
// view restarting.

/** Who answers a message sent from the window. */
export type Route = "flyd" | "firstmate";

/** One model call: the prompt in, the model's text out. */
export type Complete = (prompt: string) => Promise<string>;

const ROUTE_TIMEOUT_MS = 8_000;
const RECENT_FOR_ROUTE = 4;
const HISTORY_EXCHANGES = 4;
const MAX_ERROR_CHARS = 160;

export function routePrompt(text: string, recent: ConversationMessage[]): string {
  const context = recent
    .slice(-RECENT_FOR_ROUTE)
    .map((message) => `${message.role === "user" ? "George" : message.aside ? "Firstmate (update)" : "Flyd"}: ${message.text.replace(/\s+/g, " ").slice(0, 300)}`)
    .join("\n");
  return [
    "George is talking to Flyd, his personal assistant, in Flyd's conversation window.",
    "Flyd answers everything that is not software work itself: questions about life, travel, plans, places, people, facts, the news, writing, his day.",
    "Firstmate is the engineering lead who runs his software fleet. It takes requests about code, repositories, pull requests, builds, bugs, deployments, Flyd or firstmate themselves, crew workers, and any reply to something firstmate asked him (a choice like \"A\", a yes/no, \"go ahead\").",
    context ? `Recent conversation:\n${context}` : "",
    `New message from George: ${text.replace(/\s+/g, " ").slice(0, 1_000)}`,
    "Who should handle it? Answer with exactly one word: FLYD or FIRSTMATE.",
  ].filter(Boolean).join("\n\n");
}

/**
 * Decides who answers. Anything Flyd cannot tell, a slow or failed model
 * included, goes to firstmate: that was the window's only path before, so a
 * work request is never dropped on the floor.
 */
export async function routeMessage(
  input: { text: string; images: number; command?: string; recent: ConversationMessage[] },
  complete: Complete,
  timeoutMs = ROUTE_TIMEOUT_MS,
): Promise<Route> {
  if (input.command || input.images > 0 || !input.text.trim()) return "firstmate";
  let timer: NodeJS.Timeout | undefined;
  try {
    const answer = await Promise.race([
      complete(routePrompt(input.text, input.recent)),
      new Promise<string>((resolve) => {
        timer = setTimeout(() => resolve(""), timeoutMs);
      }),
    ]);
    return /^\W*flyd\b/i.test(answer.trim()) ? "flyd" : "firstmate";
  } catch {
    return "firstmate";
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** One question George asked Flyd from the window, as stored. */
interface AskRecord {
  id: string;
  at: string;
  text: string;
  answer?: string;
  answeredAt?: string;
  error?: string;
}

/** Flyd's own answer to a question, given the window's earlier questions and answers. */
export type Answerer = (question: string, history: Array<{ role: "user" | "assistant"; content: string }>) => Promise<string>;

export function defaultAsksDir(): string {
  return join(homedir(), ".flyd", "view", "asks");
}

export class FlydDesk {
  private readonly dir: string;
  private readonly answerer: Answerer;
  /** Questions this process is answering right now. */
  private readonly inFlight = new Set<string>();

  constructor(options: { answer: Answerer; dir?: string }) {
    this.answerer = options.answer;
    this.dir = options.dir ?? defaultAsksDir();
  }

  private write(record: AskRecord): void {
    mkdirSync(this.dir, { recursive: true });
    const path = join(this.dir, `${record.id}.json`);
    const staging = `${path}.${randomBytes(4).toString("hex")}.tmp`;
    writeFileSync(staging, JSON.stringify(record), { mode: 0o600 });
    renameSync(staging, path);
  }

  private records(): AskRecord[] {
    if (!existsSync(this.dir)) return [];
    const records: AskRecord[] = [];
    for (const name of readdirSync(this.dir)) {
      if (!name.endsWith(".json")) continue;
      try {
        const record = JSON.parse(readFileSync(join(this.dir, name), "utf8")) as AskRecord;
        if (typeof record.id === "string" && typeof record.at === "string" && typeof record.text === "string") records.push(record);
      } catch {
        // A torn or foreign file: not one of ours.
      }
    }
    return records.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  }

  /** Takes the question and starts answering it; the answer lands in a later `exchanges()`. */
  ask(text: string): SentMessage {
    const record: AskRecord = { id: `${Date.now()}-${randomBytes(4).toString("hex")}`, at: new Date().toISOString(), text: text.trim() };
    const history = this.records()
      .filter((earlier) => earlier.answer)
      .slice(-HISTORY_EXCHANGES)
      .flatMap((earlier) => [
        { role: "user" as const, content: earlier.text },
        { role: "assistant" as const, content: earlier.answer! },
      ]);
    this.write(record);
    this.inFlight.add(record.id);
    void this.answerer(record.text, history)
      .then((answer) => {
        if (!answer.trim()) throw new Error("no answer came back");
        this.write({ ...record, answer: answer.trim(), answeredAt: new Date().toISOString() });
      })
      .catch((error: unknown) => {
        this.write({ ...record, error: (error instanceof Error ? error.message : String(error)).slice(0, MAX_ERROR_CHARS) });
      })
      .finally(() => this.inFlight.delete(record.id));
    return { id: `ask:${record.id}`, timestamp: record.at };
  }

  exchanges(): Exchange[] {
    return this.records().map((record) => {
      const question: ConversationMessage = { id: `ask:${record.id}`, role: "user", text: record.text, timestamp: record.at };
      if (record.answer) {
        return {
          question,
          answer: { id: `answer:${record.id}`, role: "assistant", text: inFlydsVoice(record.answer), timestamp: record.answeredAt ?? record.at, answers: question.id },
          waiting: "",
        };
      }
      const waiting = record.error
        ? `Flyd couldn't answer this: ${record.error}`
        : this.inFlight.has(record.id) ? "Flyd is thinking…" : "Flyd was interrupted before answering; send it again";
      return { question, waiting };
    });
  }
}
