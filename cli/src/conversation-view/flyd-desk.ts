import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { inFlydsVoice } from "./flyd-voice.js";
import { ANSWERING } from "./living.js";
import type { ConversationMessage, Exchange, SentMessage } from "./types.js";
import { collectRoutingCase, routingHash, safeRoutingValue, type RoutingTrace } from "../runtime/routing-learning.js";
import type { RouteReading } from "../runtime/turn-plan.js";

// Flyd is the voice of the conversation window. A question that is not
// software or fleet work (what to do in Bangkok tonight) is Flyd's to answer,
// with its own assistant turn, and never reaches firstmate. Each question and
// its answer are kept as one file under ~/.flyd/view/asks, so they survive the
// view restarting.

/** Who answers a message sent from the window. */
export type Route = "flyd" | "firstmate";

/** One model call: the prompt in, the model's text out. */
export type Complete = (prompt: string) => Promise<string>;
export type DeskPrediction = RouteReading & { decided: boolean; needsCode: boolean | null };
export interface DeskRoutingOptions {
  mode?: "off" | "shadow" | "live";
  predict?: (text: string, recent: ConversationMessage[]) => Promise<DeskPrediction | null>;
  collect?: (trace: RoutingTrace) => void | Promise<void>;
}
/** Ownership follows intent and code access, not the occurrence of a repo name. */
export function deskOwnerFor(prediction: DeskPrediction | null): Route | null {
  if (!prediction?.decided) return null;
  if (prediction.needsCode === true) return "firstmate";
  if (prediction.route === "delegate") return prediction.domain === "coding" ? "firstmate"
    : prediction.domain && prediction.domain !== "general" ? "flyd" : null;
  return prediction.needsCode === false ? "flyd" : null;
}
async function defaultDeskPrediction(text: string, recent: ConversationMessage[]): Promise<DeskPrediction | null> {
  if (process.env.VITEST) return null;
  const { routeWithJev } = await import("../runtime/turn-plan.js");
  return routeWithJev(text, recent.map((message) => ({
    role: message.role, content: (message.aside ? "Firstmate update: " : "") + message.text,
  })));
}

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
    "Flyd answers everything that is not software work itself, from its own memory of him and the web: questions about his own life and history (where he studied, worked or lived, people he knows, what he said or did before), his calendar and plans, travel, places, facts, the news, writing, his day.",
    "Firstmate is the engineering lead who runs his software fleet. It takes requests that require inspecting or changing code, repositories, pull requests, builds, bugs, deployments or crew work, and replies to something firstmate asked him (a choice like \"A\", a yes/no, \"go ahead\"). Mere discussion of software, Flyd or firstmate is Flyd's unless inspecting the code or work state is needed. Planning-only requests keep their no-implementation constraint.",
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
  input: { text: string; images: number; files?: number; command?: string; recent: ConversationMessage[]; sessionId?: string },
  complete: Complete,
  timeoutMs = ROUTE_TIMEOUT_MS,
  options: DeskRoutingOptions = {},
): Promise<Route> {
  // Attachments are read by firstmate; Flyd's own turn only sees words.
  if (input.command || input.images > 0 || (input.files ?? 0) > 0 || !input.text.trim()) return "firstmate";
  const started = Date.now();
  const mode = options.mode ?? (process.env.FLYD_ROUTING_CASCADE === "live" ? "live" : process.env.FLYD_ROUTING_CASCADE === "off" ? "off" : "shadow");
  const fast = mode === "off" ? null : await (options.predict ?? defaultDeskPrediction)(input.text, input.recent).catch(() => null);
  const candidate = deskOwnerFor(fast);
  const prompt = routePrompt(input.text, input.recent);
  const record = (owner: Route, source: string, fallbackReason?: string): void => {
    if (process.env.FLYD_ROUTING_LEARNING === "0") return;
    const trace: RoutingTrace = {
      version: 1, surface: "desk", at: new Date().toISOString(),
      sessionId: input.sessionId ?? "desk-unknown",
      input: safeRoutingValue({ text: input.text, fallbackPrompt: prompt,
        ...(fast?.evidence?.input ?? { conversation_recap: input.recent.slice(-4) }),
      }) as Record<string, unknown>,
      contextComplete: true, policyVersion: routingHash(["desk.routing.v2", fast?.evidence?.policyVersion, mode]),
      observed: { owner }, source, latencyMs: Date.now() - started,
      ...(fast ? { confidence: fast.confidence, model: fast.evidence?.model, judgments: fast.evidence?.judgments } : {}),
      models: { ...(fast?.evidence?.model ? { jev: fast.evidence.model } : {}), ...(source !== "jev" ? { fallback: process.env.FLYD_ROUTING_FALLBACK_MODEL ?? "incumbent-desk-classifier" } : {}) },
      ...(candidate ? { candidate: { owner: candidate } } : {}),
      ...(fallbackReason ? { fallbackReason } : {}),
    };
    // Detached, bounded local capture: never delays dispatch or turns a send
    // into an error; an injected collector is also isolated.
    void Promise.resolve().then(async () => {
      if (options.collect) await options.collect(trace);
      else if (!process.env.VITEST) {
        const { FLYD_DIR } = await import("../lib/config.js");
        collectRoutingCase(FLYD_DIR, randomBytes(16).toString("hex"), trace);
      }
    }).catch(() => undefined);
  };
  if (mode === "live" && candidate) { record(candidate, "jev"); return candidate; }
  let timer: NodeJS.Timeout | undefined;
  try {
    const answer = await Promise.race([
      complete(prompt),
      new Promise<string>((resolve) => {
        timer = setTimeout(() => resolve(""), timeoutMs);
      }),
    ]);
    const valid = /^(?:FLYD|FIRSTMATE)[.!]?$/i.test(answer.trim());
    const owner = valid ? /^flyd/i.test(answer.trim()) ? "flyd" : "firstmate" : mode === "live" ? "flyd" : "firstmate";
    record(owner, valid ? "llm" : "incumbent_failure", !valid ? "fallback_failed" : candidate && mode === "shadow" ? "shadow_only" : fast ? "uncertain_route_or_domain" : "jev_unavailable");
    return owner;
  } catch {
    const owner = mode === "live" ? "flyd" : "firstmate";
    record(owner, "incumbent_failure", "fallback_failed");
    return owner;
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
  /** Parsed records by file name, with the size and mtime they were read at; a file is read again only when those change. */
  private readonly parsed = new Map<string, { stamp: string; record: AskRecord | null }>();

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
    const names = new Set(readdirSync(this.dir).filter((name) => name.endsWith(".json")));
    for (const name of this.parsed.keys()) if (!names.has(name)) this.parsed.delete(name);
    const records: AskRecord[] = [];
    for (const name of names) {
      const record = this.read(name);
      if (record) records.push(record);
    }
    return records.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  }

  private read(name: string): AskRecord | null {
    const path = join(this.dir, name);
    let stamp: string;
    try {
      const stat = statSync(path);
      stamp = `${stat.size}:${stat.mtimeMs}`;
    } catch {
      return null;
    }
    const known = this.parsed.get(name);
    if (known?.stamp === stamp) return known.record;
    let record: AskRecord | null = null;
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as AskRecord;
      if (typeof parsed.id === "string" && typeof parsed.at === "string" && typeof parsed.text === "string") record = parsed;
    } catch {
      // A torn or foreign file: not one of ours.
    }
    this.parsed.set(name, { stamp, record });
    return record;
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
    return { id: `ask:${record.id}`, timestamp: record.at, waiting: ANSWERING };
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
        : this.inFlight.has(record.id) ? ANSWERING : "Flyd was interrupted before answering; send it again";
      return { question, waiting };
    });
  }
}
